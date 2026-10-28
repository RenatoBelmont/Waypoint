/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};

  var AUTOSAVE_DELAY = 600;

  var state = {
    doc: null,
    projectId: null,
    saveStatus: 'idle',
    loaded: false,
    theme: 'dark',
  };

  var saveTimer = null;
  var importErrorTimer = null;
  var fileInput;
  var importToastEl;

  function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  }

  function readInitialTheme() {
    try {
      var stored = localStorage.getItem(GDC.THEME_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) { /* ignore */ }
    return 'light';
  }

  function applyTheme(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem(GDC.THEME_STORAGE_KEY, theme); } catch (e) { /* ignore */ }
  }

  function scheduleAutosave() {
    if (!state.loaded) return;
    if (state.readOnly) return; // cópia desatualizada do app: não grava por cima do que a mais nova salvou
    state.saveStatus = 'saving';
    GDC.ui.header.setStatus('saving');
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      var ok = GDC.saveDocumentToStorage(state.projectId, state.doc);
      state.saveStatus = ok ? 'saved' : 'error';
      GDC.ui.header.setStatus(state.saveStatus);
      // Reaproveita o mesmo debounce do autosave pra recalcular a bolinha de aviso da aba Saúde — não
      // faz sentido consultar o IndexedDB (imagens órfãs) a cada tecla digitada, só depois que o
      // usuário para de mexer, igual o autosave em si.
      if (GDC.ui.health && GDC.ui.health.refreshNotifyDot) GDC.ui.health.refreshNotifyDot(state.doc);
    }, AUTOSAVE_DELAY);
  }

  /** Grava na hora o que estiver esperando o debounce do autosave. Sem isso, fechar/recarregar a aba
   *  nos ~600 ms seguintes a uma mudança (ex.: criar uma nota e já sair) perdia essa mudança — era
   *  o caso da "nota nova em branco que some". */
  function flushAutosave() {
    if (!saveTimer || state.readOnly || !state.loaded) return;
    clearTimeout(saveTimer); saveTimer = null;
    var ok = GDC.saveDocumentToStorage(state.projectId, state.doc);
    state.saveStatus = ok ? 'saved' : 'error';
  }
  global.addEventListener('pagehide', flushAutosave);
  global.addEventListener('beforeunload', flushAutosave);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushAutosave(); });

  // ---------- Handlers: GDD ----------

  function handleTitleChange(title) {
    state.doc.title = title;
    GDC.ui.preview.update(state.doc);
    scheduleAutosave();
  }

  function handleSectionChange(id, value) {
    state.doc.sections[id] = value;
    GDC.ui.preview.update(state.doc);
    GDC.ui.builder.updateProgress(state.doc);
    scheduleAutosave();
  }

  /** Layout do GDD personalizado no modo de edição do builder. `layout` null = voltar ao padrão.
   *  `removedIds`: seções que saíram do layout — o texto delas é apagado de doc.sections (o usuário
   *  já confirmou no builder), pra não ficar dado invisível no projeto e no backup. */
  function handleLayoutChange(layout, removedIds) {
    state.doc.gddLayout = layout ? GDC.normalizeGddLayout(layout) : null;
    var stillUsed = GDC.sectionMapFor(state.doc);
    (removedIds || []).forEach(function (id) { if (!stillUsed[id]) delete state.doc.sections[id]; });
    GDC.ui.builder.reset(state.doc, true);
    GDC.ui.preview.update(state.doc);
    scheduleAutosave();
  }

  function handleTemplateSelect(template) {
    state.doc.title = state.doc.title || template.name;
    // Mescla em vez de substituir: seções personalizadas (fora do template) mantêm o texto.
    state.doc.sections = Object.assign({}, state.doc.sections, template.sections);
    state.doc.template = template.name;
    GDC.ui.builder.reset(state.doc);
    GDC.ui.preview.update(state.doc);
    GDC.ui.templates.setActive(state.doc.template);
    setTemplatesExpanded(false);
    scheduleAutosave();
  }

  function handleReset() {
    if (!global.confirm('Isso apaga o projeto atual do navegador. Deseja continuar?')) return;
    // Preserva o tipo do projeto (digital/boardgame) — "Reiniciar" limpa o conteúdo, não recria o
    // projeto do zero com outro tipo, o que bagunçaria quais abas/ferramentas devem ficar visíveis.
    state.doc = GDC.createEmptyDocument(state.doc.projectType);
    state.saveStatus = 'idle';
    GDC.ui.header.setStatus('idle');
    resyncAllUi();
    scheduleAutosave();
  }

  // ---------- Handlers: Kanban ----------

  /** Recalcula o progresso de cada marco e avança automaticamente para "done" ao bater 100%. */
  function recomputeMilestones() {
    var cards = state.doc.kanban.cards;
    cards.forEach(function (m) {
      if (!m.isMilestone) return;
      var linked = cards.filter(function (c) { return !c.isMilestone && c.milestoneId === m.id; });
      if (linked.length === 0) return;
      var done = linked.filter(function (c) { return c.column === 'done'; }).length;
      if (done === linked.length && m.column !== 'done') {
        m.column = 'done';
      }
    });
  }

  /** Remove vínculos (milestoneId) apontando para um marco definitivamente apagado. */
  function purgeMilestoneReferences(milestoneId) {
    [state.doc.kanban.cards, state.doc.kanban.trash].forEach(function (list) {
      list.forEach(function (c) {
        if (c.milestoneId === milestoneId) c.milestoneId = null;
      });
    });
  }

  /** Remove itens da lixeira com mais de TRASH_RETENTION_DAYS dias (silencioso, chamado no boot). */
  function purgeExpiredTrash() {
    var cutoff = Date.now() - (GDC.TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    var kept = [];
    var changed = false;
    state.doc.kanban.trash.forEach(function (c) {
      if (c.deletedAt && c.deletedAt < cutoff) {
        changed = true;
        if (c.isMilestone) purgeMilestoneReferences(c.id);
      } else {
        kept.push(c);
      }
    });
    if (changed) state.doc.kanban.trash = kept;
    return changed;
  }

  function handleAddCard(card) {
    var newCard = Object.assign({
      description: '', priority: 'media', labels: [], color: null,
      checklist: [], isMilestone: false, milestoneId: null,
      stage: 'idea', categoryId: null, coverImageId: null,
    }, card, { id: makeId(), createdAt: Date.now(), deletedAt: null });
    state.doc.kanban.cards = state.doc.kanban.cards.concat([newCard]);
    GDC.ui.kanban.syncState(state.doc.kanban);
    scheduleAutosave();
  }

  // ---------- Handlers: Kanban — categorias de card ----------

  function handleAddKanbanCategory(catObj) {
    var normalized = GDC.normalizeKanbanCategory(catObj);
    state.doc.kanban.categories = state.doc.kanban.categories.concat([normalized]);
    GDC.ui.kanban.syncState(state.doc.kanban);
    scheduleAutosave();
    return normalized;
  }

  function handleDeleteKanbanCategory(id) {
    state.doc.kanban.categories = state.doc.kanban.categories.filter(function (c) { return c.id !== id; });
    // Cards que usavam essa categoria voltam a ficar "sem categoria" em vez de apontar pro vazio.
    [state.doc.kanban.cards, state.doc.kanban.trash].forEach(function (list) {
      list.forEach(function (c) { if (c.categoryId === id) c.categoryId = null; });
    });
    GDC.ui.kanban.syncState(state.doc.kanban);
    scheduleAutosave();
  }

  function handleUpdateCard(id, patch) {
    state.doc.kanban.cards = state.doc.kanban.cards.map(function (c) { return c.id === id ? Object.assign({}, c, patch) : c; });
    recomputeMilestones();
    GDC.ui.kanban.syncState(state.doc.kanban);
    scheduleAutosave();
  }

  /** Soft-delete: move o card para a lixeira em vez de apagar de vez. */
  function handleDeleteCard(id) {
    var card = state.doc.kanban.cards.filter(function (c) { return c.id === id; })[0];
    if (!card) return;
    state.doc.kanban.cards = state.doc.kanban.cards.filter(function (c) { return c.id !== id; });
    state.doc.kanban.trash = state.doc.kanban.trash.concat([Object.assign({}, card, { deletedAt: Date.now() })]);
    GDC.ui.kanban.syncState(state.doc.kanban);
    scheduleAutosave();
    return card;
  }

  function handleMoveCard(id, column) {
    state.doc.kanban.cards = state.doc.kanban.cards.map(function (c) { return c.id === id ? Object.assign({}, c, { column: column }) : c; });
    recomputeMilestones();
    GDC.ui.kanban.syncState(state.doc.kanban);
    scheduleAutosave();
  }

  /** Restaura um card da lixeira de volta ao board (mantém milestoneId, então vínculos voltam sozinhos). */
  function handleRestoreCard(id) {
    var card = state.doc.kanban.trash.filter(function (c) { return c.id === id; })[0];
    if (!card) return;
    state.doc.kanban.trash = state.doc.kanban.trash.filter(function (c) { return c.id !== id; });
    state.doc.kanban.cards = state.doc.kanban.cards.concat([Object.assign({}, card, { deletedAt: null })]);
    recomputeMilestones();
    GDC.ui.kanban.syncState(state.doc.kanban);
    scheduleAutosave();
  }

  /** Exclusão definitiva de um único item da lixeira. */
  function handleDeleteForever(id) {
    var card = state.doc.kanban.trash.filter(function (c) { return c.id === id; })[0];
    if (!card) return;
    state.doc.kanban.trash = state.doc.kanban.trash.filter(function (c) { return c.id !== id; });
    if (card.isMilestone) purgeMilestoneReferences(card.id);
    GDC.ui.kanban.syncState(state.doc.kanban);
    scheduleAutosave();
  }

  function handleEmptyTrash() {
    if (!global.confirm('Isso apaga definitivamente todos os itens da lixeira. Deseja continuar?')) return;
    state.doc.kanban.trash.forEach(function (c) {
      if (c.isMilestone) purgeMilestoneReferences(c.id);
    });
    state.doc.kanban.trash = [];
    GDC.ui.kanban.syncState(state.doc.kanban);
    scheduleAutosave();
  }

  /** Semeia os marcos clássicos sugeridos (pula títulos que já existem no board). */
  function handleSuggestMilestones() {
    var existingTitles = state.doc.kanban.cards.filter(function (c) { return c.isMilestone; })
      .map(function (c) { return c.title; });
    var suggested = GDC.suggestedMilestonesFor(state.doc.projectType);
    var toAdd = suggested.filter(function (m) { return existingTitles.indexOf(m.title) === -1; });
    if (toAdd.length === 0) return;
    var newCards = toAdd.map(function (m) {
      return {
        id: makeId(), title: m.title, description: m.description, priority: 'media', labels: [],
        column: 'backlog', createdAt: Date.now(), color: null, checklist: [],
        isMilestone: true, milestoneId: null, deletedAt: null,
        stage: 'idea', categoryId: null, coverImageId: null,
      };
    });
    state.doc.kanban.cards = state.doc.kanban.cards.concat(newCards);
    GDC.ui.kanban.syncState(state.doc.kanban);
    scheduleAutosave();
  }

  // ---------- Handlers: Ferramentas ----------

  function handleToolChange(key, value) {
    state.doc.tools[key] = value;
    scheduleAutosave();
  }

  // ---------- Handlers: Codex ----------
  // Observação: os handlers de entrada (add/update/delete) NÃO re-renderizam a UI do Codex — o
  // módulo js/ui/codex.js já reflete a mudança no próprio DOM (evita perder foco durante a digitação).
  // Só operações estruturais de tipo (que o módulo já re-renderiza sozinho) passam por aqui direto.

  function handleAddCodexType(typeObj) {
    var normalized = GDC.normalizeCodexType(typeObj);
    state.doc.codex.types = state.doc.codex.types.concat([normalized]);
    scheduleAutosave();
  }

  function handleUpdateCodexType(id, patch) {
    state.doc.codex.types = state.doc.codex.types.map(function (t) {
      return t.id === id ? GDC.normalizeCodexType(Object.assign({}, t, patch, { id: id })) : t;
    });
    scheduleAutosave();
  }

  function handleDeleteCodexType(id) {
    state.doc.codex.types = state.doc.codex.types.filter(function (t) { return t.id !== id; });
    state.doc.codex.entries = state.doc.codex.entries.filter(function (e) { return e.typeId !== id; });
    scheduleAutosave();
  }

  function handleAddCodexEntry(typeId) {
    var type = state.doc.codex.types.filter(function (t) { return t.id === typeId; })[0];
    if (!type) return null;
    var fields = {};
    type.fields.forEach(function (f) { fields[f.id] = GDC.defaultCodexFieldValue(f.kind); });
    var entry = { id: GDC.makeId('entry'), typeId: typeId, name: '', summary: '', fields: fields, createdAt: Date.now(), updatedAt: Date.now() };
    state.doc.codex.entries = state.doc.codex.entries.concat([entry]);
    scheduleAutosave();
    return entry;
  }

  function handleUpdateCodexEntry(entryId, patch) {
    state.doc.codex.entries = state.doc.codex.entries.map(function (e) {
      if (e.id !== entryId) return e;
      var next = Object.assign({}, e, patch);
      if (patch.fields) next.fields = Object.assign({}, e.fields, patch.fields);
      next.updatedAt = Date.now();
      return next;
    });
    scheduleAutosave();
  }

  function handleDeleteCodexEntry(entryId) {
    state.doc.codex.entries = state.doc.codex.entries.filter(function (e) { return e.id !== entryId; });
    scheduleAutosave();
  }

  // ---------- Handlers: Notas ----------

  function handleAddNote() {
    var note = GDC.normalizeNote({ id: GDC.makeId('note'), title: '', body: '', createdAt: Date.now(), updatedAt: Date.now() });
    state.doc.notes = state.doc.notes.concat([note]);
    GDC.ui.notes.syncState(state.doc.notes);
    scheduleAutosave();
    return note;
  }

  function handleUpdateNote(id, patch) {
    state.doc.notes = state.doc.notes.map(function (n) {
      return n.id === id ? Object.assign({}, n, patch, { updatedAt: Date.now() }) : n;
    });
    GDC.ui.notes.syncState(state.doc.notes);
    scheduleAutosave();
  }

  function handleDeleteNote(id) {
    state.doc.notes = state.doc.notes.filter(function (n) { return n.id !== id; });
    GDC.ui.notes.syncState(state.doc.notes);
    scheduleAutosave();
  }

  // ---------- Handlers: Mural ----------

  function handleAddMuralItem(itemPatch) {
    var item = GDC.normalizeMuralItem(Object.assign({ id: GDC.makeId('mural'), createdAt: Date.now(), updatedAt: Date.now() }, itemPatch));
    state.doc.mural.items = state.doc.mural.items.concat([item]);
    scheduleAutosave();
    return item;
  }

  function handleUpdateMuralItem(id, patch) {
    state.doc.mural.items = state.doc.mural.items.map(function (it) {
      return it.id === id ? Object.assign({}, it, patch, { updatedAt: Date.now() }) : it;
    });
    scheduleAutosave();
  }

  function handleDeleteMuralItem(id) {
    // Ao excluir um item, remove também qualquer seta conectada a ele — sem isso, apagar vários
    // itens de uma vez (seleção múltipla) deixava a seta "pendurada" no quadro, ainda visível como se
    // nada tivesse sido excluído (feedback do Renato: "selecionar todos não está apagando todos" — na
    // prática os itens somem, mas a seta que os ligava fica órfã, flutuando no lugar onde eles estavam).
    state.doc.mural.items = state.doc.mural.items.filter(function (it) {
      if (it.id === id) return false;
      if (it.kind === 'arrow' && (it.fromItemId === id || it.toItemId === id)) return false;
      return true;
    });
    scheduleAutosave();
  }

  // Restaura a lista inteira de itens do mural de uma vez — usado pelo botão de desfazer (o mural
  // guarda seus próprios snapshots e só pede pra trocar tudo por um deles), e reaproveita
  // normalizeMuralItem em cada item pra nunca deixar passar algo fora do formato esperado.
  function handleReplaceMuralItems(items) {
    state.doc.mural.items = (Array.isArray(items) ? items : []).map(GDC.normalizeMuralItem);
    scheduleAutosave();
  }

  // ---------- Árvore de Habilidades ----------

  function handleAddSkillNode(patch) {
    var node = GDC.normalizeSkillNode(Object.assign({ id: GDC.makeId('skill'), createdAt: Date.now(), updatedAt: Date.now() }, patch));
    state.doc.skillTree.nodes = state.doc.skillTree.nodes.concat([node]);
    GDC.ui.skillTree.syncState(state.doc.skillTree);
    scheduleAutosave();
    return node;
  }

  function handleUpdateSkillNode(id, patch) {
    state.doc.skillTree.nodes = state.doc.skillTree.nodes.map(function (n) {
      return n.id === id ? GDC.normalizeSkillNode(Object.assign({}, n, patch, { id: n.id, createdAt: n.createdAt, updatedAt: Date.now() })) : n;
    });
    GDC.ui.skillTree.syncState(state.doc.skillTree);
    scheduleAutosave();
  }

  function handleDeleteSkillNode(id) {
    // Ao excluir um nó, remove também esse id de qualquer outro nó que o listava como pré-requisito —
    // sem isso, um pré-requisito apagado ficaria "pendurado" (mesmo bug de referência órfã já
    // corrigido no Mural pra setas ligadas a um item excluído).
    state.doc.skillTree.nodes = state.doc.skillTree.nodes
      .filter(function (n) { return n.id !== id; })
      .map(function (n) {
        var idx = n.prereqIds.indexOf(id);
        if (idx === -1) return n;
        var copy = Object.assign({}, n, { prereqIds: n.prereqIds.filter(function (p) { return p !== id; }) });
        return copy;
      });
    GDC.ui.skillTree.syncState(state.doc.skillTree);
    scheduleAutosave();
  }

  function handleAddSkillBranch(branchPatch) {
    var branch = GDC.normalizeSkillBranch(Object.assign({ id: GDC.makeId('branch') }, branchPatch));
    state.doc.skillTree.branches = state.doc.skillTree.branches.concat([branch]);
    GDC.ui.skillTree.syncState(state.doc.skillTree);
    scheduleAutosave();
    return branch;
  }

  function handleUpdateSkillBranch(id, patch) {
    state.doc.skillTree.branches = state.doc.skillTree.branches.map(function (b) {
      return b.id === id ? GDC.normalizeSkillBranch(Object.assign({}, b, patch, { id: b.id })) : b;
    });
    GDC.ui.skillTree.syncState(state.doc.skillTree);
    scheduleAutosave();
  }

  function handleDeleteSkillBranch(id) {
    state.doc.skillTree.branches = state.doc.skillTree.branches.filter(function (b) { return b.id !== id; });
    // Nós que usavam esse ramo voltam a ficar "sem ramo" em vez de apontar pro vazio — mesmo
    // tratamento do Kanban ao excluir uma categoria em uso.
    state.doc.skillTree.nodes = state.doc.skillTree.nodes.map(function (n) {
      return n.branchId === id ? Object.assign({}, n, { branchId: null }) : n;
    });
    GDC.ui.skillTree.syncState(state.doc.skillTree);
    scheduleAutosave();
  }

  // ---------- Navegação cruzada (Notas/Mural -> Codex) ----------

  // ---------- Aba Mapas: duas visões ----------
  // "Plantas de fase" (levelPlanner.js, grade com 4 etapas) e "Mundo e radial" (atlas.js, mapa livre e
  // planta radial). Cada visão tem seu próprio container — os dois módulos usam offsetParent do
  // próprio root pra saber se estão visíveis (atalhos de teclado não disparam no oculto).
  var MAPS_VIEW_KEY = 'gdc:mapsView';
  function mountMapsTab(projectType) {
    var host = document.getElementById('gdc-maps');
    var viewName = 'plan';
    try { var sv = localStorage.getItem(MAPS_VIEW_KEY); viewName = sv === 'atlas' || sv === 'hex' ? sv : 'plan'; } catch (e) { /* padrão */ }
    host.innerHTML =
      '<section class="builder-section lp-section">' +
      '  <div class="mb-8 text-center">' +
      '    <div class="hero-badge">' + GDC.icon('map', { size: 14, className: 'text-blue-400' }) + 'Level design e mundo</div>' +
      '    <h2 class="font-display text-3xl font-bold text-primary">Mapas</h2>' +
      '    <p class="mt-2 text-secondary">Plantas de fase em grade, mapas de mundo com terreno e quadrantes, plantas radiais (cidades circulares, bases, estações) e tilesets hexagonais.</p>' +
      '  </div>' +
      '  <div class="maps-switch" role="tablist">' +
      '    <button type="button" class="tools-tab" data-maps-view="plan" role="tab">' + GDC.icon('layout-grid', { size: 15 }) + 'Plantas de fase</button>' +
      '    <button type="button" class="tools-tab" data-maps-view="atlas" role="tab">' + GDC.icon('map', { size: 15 }) + 'Mundo e radial</button>' +
      '    <button type="button" class="tools-tab" data-maps-view="hex" role="tab">' + GDC.icon('hexagon', { size: 15 }) + 'Tileset hexagonal</button>' +
      '  </div>' +
      '  <div id="gdc-maps-plan"></div>' +
      '  <div id="gdc-maps-atlas"></div>' +
      '</section>';
    GDC.ui.levelPlanner.mount(document.getElementById('gdc-maps-plan'), {
      levels: state.doc.levels, projectType: projectType, onChange: scheduleAutosave,
    });
    GDC.ui.atlas.mount(document.getElementById('gdc-maps-atlas'), {
      atlas: state.doc.atlas, projectType: projectType, onChange: scheduleAutosave,
    });
    var apply = function (v) {
      viewName = v;
      try { localStorage.setItem(MAPS_VIEW_KEY, v); } catch (e) { /* sem storage */ }
      document.getElementById('gdc-maps-plan').style.display = v === 'plan' ? '' : 'none';
      document.getElementById('gdc-maps-atlas').style.display = v !== 'plan' ? '' : 'none';
      host.querySelectorAll('[data-maps-view]').forEach(function (b) {
        var on = b.getAttribute('data-maps-view') === v;
        b.classList.toggle('tools-tab-active', on); b.setAttribute('aria-selected', String(on));
      });
      if (v !== 'plan') { GDC.ui.atlas.setMode(v === 'hex' ? 'hex' : 'free'); GDC.ui.atlas.shown(); }
    };
    host.querySelector('.maps-switch').addEventListener('click', function (e) {
      var b = e.target.closest('[data-maps-view]'); if (b) apply(b.getAttribute('data-maps-view'));
    });
    apply(viewName);
  }

  function handleGotoArt(itemId) {
    switchMainTab('arte');
    if (GDC.ui.artDirection) GDC.ui.artDirection.gotoItem(itemId);
  }

  function handleGotoCodexEntry(entryId) {
    switchMainTab('codex');
    if (GDC.ui.codex) GDC.ui.codex.gotoEntry(entryId);
  }

  // ---------- Import / Export JSON ----------

  function blockedByOldCopy() {
    if (!state.readOnly) return false;
    showImportError('Esta cópia do Waypoint está desatualizada para este projeto — exporte pela versão atual do app.');
    return true;
  }

  function handleExportJson() {
    if (blockedByOldCopy()) return;
    GDC.exportDocumentAsJson(state.doc);
    GDC.recordExportTimestamp(state.projectId);
    if (activeMainTab === 'saude' && GDC.ui.health) GDC.ui.health.update(state.doc);
    else if (GDC.ui.health) GDC.ui.health.refreshNotifyDot(state.doc);
  }

  function handleExportBackup() {
    if (blockedByOldCopy()) return;
    GDC.exportFullBackup(state.doc);
    GDC.recordExportTimestamp(state.projectId);
    if (GDC.ui.health) GDC.ui.health.refreshNotifyDot(state.doc);
  }

  function handleImportClick() {
    fileInput.click();
  }

  function showImportError(message) {
    var toastTextEl = document.getElementById('gdc-import-toast-text');
    if (toastTextEl) toastTextEl.textContent = message;
    importToastEl.style.display = 'flex';
    if (importErrorTimer) clearTimeout(importErrorTimer);
    importErrorTimer = setTimeout(function () { importToastEl.style.display = 'none'; }, 6000);
  }

  /** Importação de .md (js/ui/mdImport.js): prévia → plano → aplica no doc atual. Guarda um
   *  instantâneo do documento antes, pra oferecer "Desfazer" (a importação mexe em GDD, Codex e Notas
   *  de uma vez, e conferir tudo à mão seria trabalhoso). */
  function handleMdFileChange(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (event) {
      var text = String(event.target.result || '');
      var opened = GDC.ui.mdImport.open({
        doc: state.doc,
        fileName: file.name,
        text: text,
        onApply: function (plan) {
          var snapshot = JSON.stringify(state.doc);
          var result = GDC.mdImport.applyPlan(state.doc, plan);
          resyncAllUi();
          scheduleAutosave();
          GDC.ui.mdImport.showDone(result, function () {
            state.doc = GDC.normalizeDocument(JSON.parse(snapshot));
            resyncAllUi();
            scheduleAutosave();
          });
        },
      });
      if (!opened) showImportError('O arquivo está vazio.');
    };
    reader.onerror = function () { showImportError('Não foi possível ler o arquivo.'); };
    reader.readAsText(file);
  }

  /** O projeto tem algo que valha proteger? (projeto recém-criado e vazio não precisa de alerta) */
  function docHasContent(doc) {
    var sec = doc.sections || {};
    if (Object.keys(sec).some(function (k) { return String(sec[k] || '').trim(); })) return true;
    var nonEmpty = function (a) { return Array.isArray(a) && a.length > 0; };
    if (nonEmpty(doc.notes) || nonEmpty(doc.codex && doc.codex.entries) || nonEmpty(doc.kanban && doc.kanban.cards)) return true;
    if (nonEmpty(doc.mural && doc.mural.items) || nonEmpty(doc.atlas && doc.atlas.maps)) return true;
    if (doc.levels && (doc.levels.maps || []).some(function (m) { return Object.keys(m.cells || {}).length || (m.markers || []).length; })) return true;
    if (doc.artDirection && (nonEmpty(doc.artDirection.palettes) || nonEmpty(doc.artDirection.styles))) return true;
    if (doc.skillTree && nonEmpty(doc.skillTree.nodes)) return true;
    var tools = doc.tools || {};
    return Object.keys(tools).some(function (k) { return typeof tools[k] === 'string' && tools[k].length > 2; });
  }

  /** Importar JSON/backup: confere versão, mostra de quando é o arquivo x o projeto local e deixa
   *  escolher entre substituir o projeto aberto ou importar como um projeto novo. */
  function handleFileChange(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (event) {
      var text = String(event.target.result || '');
      var raw = null;
      try { raw = JSON.parse(text); } catch (err) { showImportError('Arquivo inválido: não é um JSON válido.'); return; }
      var check = GDC.parseImportedJson(text);
      if (!check.ok) { showImportError(check.error || 'Não foi possível importar o arquivo.'); return; }
      var meta = GDC.findProjectMeta(state.projectId);
      var fileDoc = check.document;
      var info = {
        fileTitle: fileDoc.title, exportedAt: Number(raw.exportedAt) || 0, fileType: fileDoc.projectType,
        mediaCount: raw.media && typeof raw.media === 'object' ? Object.keys(raw.media).length : 0,
        referencedImages: Object.keys(GDC.collectUsedImageIds(fileDoc)).length,
        localTitle: (meta && meta.name) || state.doc.title, localUpdatedAt: meta ? meta.updatedAt : 0,
        localType: state.doc.projectType, localHasContent: docHasContent(state.doc),
      };
      GDC.ui.backupImport.open({
        info: info,
        onReplace: function () {
          // Se o arquivo for um backup completo (tem `media`/`fonts`), regrava imagens e fontes no
          // IndexedDB local ANTES de aplicar o documento — nenhuma referência aparece como "perdida".
          GDC.hydrateImportedMedia(raw).then(function () {
            // Força o tipo do projeto aberto: as abas/ferramentas já montadas foram decididas pelo tipo
            // no carregamento da página (pra trocar de tipo, use "Importar como novo projeto").
            var forced = Object.assign({}, raw, { projectType: state.doc.projectType });
            var result = GDC.parseImportedJson(JSON.stringify(forced));
            if (result.ok && result.document) {
              state.doc = result.document;
              resyncAllUi();
              scheduleAutosave();
            } else {
              showImportError(result.error || 'Não foi possível importar o arquivo.');
            }
          });
        },
        onNew: function () {
          GDC.hydrateImportedMedia(raw).then(function () {
            var id = GDC.createProject(fileDoc.title || 'Projeto importado', fileDoc.projectType);
            GDC.saveDocumentToStorage(id, fileDoc);
            if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
            GDC.saveDocumentToStorage(state.projectId, state.doc); // garante o atual salvo antes de trocar
            GDC.setActiveProjectId(id);
            global.location.reload();
          });
        },
      });
    };
    reader.onerror = function () { showImportError('Não foi possível ler o arquivo.'); };
    reader.readAsText(file);
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme(state.theme);
    if (GDC.ui.header && GDC.ui.header.setTheme) GDC.ui.header.setTheme(state.theme);
    if (GDC.ui.projects && GDC.ui.projects.setTheme) GDC.ui.projects.setTheme(state.theme);
  }

  // ---------- Sincronização geral (reset / import / template) ----------

  function resyncAllUi() {
    GDC.ui.builder.reset(state.doc);
    GDC.ui.preview.update(state.doc);
    GDC.ui.templates.setActive(state.doc.template);
    GDC.ui.kanban.reset(state.doc.kanban);
    GDC.ui.tools.reset(state.doc.tools, state.doc.skillTree, state.doc.projectType, state.doc.codex);
    GDC.ui.codex.reset(state.doc.codex, state.doc.sections, state.doc.projectType, state.doc);
    GDC.ui.notes.reset(state.doc.notes, state.doc.codex);
    if (GDC.ui.artDirection) GDC.ui.artDirection.reset(state.doc.artDirection, state.doc.codex);
    GDC.ui.mural.reset(state.doc.mural, state.doc.codex);
    if (state.doc.projectType !== 'boardgame' && GDC.ui.skillTree) {
      GDC.ui.skillTree.reset(state.doc.skillTree, state.doc.codex, state.doc.tools);
    }
    if (state.doc.projectType === 'jogo-digital' && GDC.ui.levelPlanner) GDC.ui.levelPlanner.reset(state.doc.levels);
    if (state.doc.projectType === 'jogo-digital' && GDC.ui.atlas) GDC.ui.atlas.reset(state.doc.atlas);
    GDC.ui.health.update(state.doc);
  }

  // ---------- Bootstrap ----------

  // A Árvore de Habilidades é uma ferramenta de progressão de jogo digital (nível, XP, desbloqueios)
  // sem equivalente natural num boardgame — some da navegação pra esses projetos em vez de ficar
  // como uma aba vazia sem sentido.
  function tabsMarkup(projectType) {
    var skilltreeTab = projectType === 'boardgame' ? '' :
      '  <button type="button" class="main-tab-btn" data-tab="skilltree">' + GDC.icon('workflow', { size: 15 }) + 'Habilidades</button>' +
      '';
    // Mapas (planta de fase top-down) é level design de jogo digital — fica de fora em boardgame.
    var mapsTab = projectType !== 'jogo-digital' ? '' :
      '  <button type="button" class="main-tab-btn" data-tab="maps">' + GDC.icon('map', { size: 15 }) + 'Mapas</button>';
    return (
      '<nav class="main-tabs" id="gdc-main-tabs">' +
      '  <button type="button" class="main-tab-btn" data-tab="gdc">' + GDC.icon('file-text', { size: 15 }) + 'GDC</button>' +
      '  <button type="button" class="main-tab-btn" data-tab="kanban">' + GDC.icon('trello', { size: 15 }) + 'Kanban</button>' +
      '  <button type="button" class="main-tab-btn" data-tab="codex">' + GDC.icon('book-open', { size: 15 }) + 'Codex</button>' +
      '  <button type="button" class="main-tab-btn" data-tab="arte">' + GDC.icon('palette', { size: 15 }) + 'Arte</button>' +
      '  <button type="button" class="main-tab-btn" data-tab="notes">' + GDC.icon('sticky-note', { size: 15 }) + 'Notas</button>' +
      '  <button type="button" class="main-tab-btn" data-tab="mural">' + GDC.icon('layout-dashboard', { size: 15 }) + 'Mural</button>' +
      skilltreeTab +
      mapsTab +
      '  <button type="button" class="main-tab-btn" data-tab="ferramentas">' + GDC.icon('wrench', { size: 15 }) + 'Ferramentas</button>' +
      '  <button type="button" class="main-tab-btn" data-tab="saude">' + GDC.icon('activity', { size: 15 }) + 'Saúde<span class="tab-notify-dot" data-tab-notify="saude" title="Há avisos importantes na aba Saúde" hidden></span></button>' +
      '</nav>'
    );
  }

  function buildShell(projectType) {
    var root = document.getElementById('root');
    root.innerHTML =
      '<div class="min-h-screen bg-app">' +
      '  <div id="gdc-header"></div>' +
      '  <div id="gdc-import-toast" class="import-toast" style="display:none">' +
      GDC.icon('alert-circle', { size: 16, className: 'flex-shrink-0' }) +
      '    <span id="gdc-import-toast-text"></span>' +
      '  </div>' +
      '  <div class="tab-panel" data-tab-panel="gdc">' +
      '    <section id="builder" class="builder-section">' +
      '      <div class="mb-8 text-center">' +
      '        <div class="hero-badge">' + GDC.icon('file-text', { size: 14, className: 'text-amber-400' }) + 'Documento de design</div>' +
      '        <h2 class="font-display text-3xl font-bold text-primary">GDC &amp; GDD</h2>' +
      '        <p class="mt-2 text-secondary">Preencha as fichas do projeto — o documento de design é gerado ao lado, em tempo real.</p>' +
      '      </div>' +
      '      <div class="builder-toolbar">' +
      '        <button type="button" id="gdc-toggle-templates" class="btn-ghost py-2 text-xs">' + GDC.icon('sparkles', { size: 14, className: 'text-amber-400' }) + 'Usar um template</button>' +
      '        <div class="builder-toolbar-spacer"></div>' +
      '        <button type="button" id="gdc-export-json" class="btn-ghost py-2 text-xs">' + GDC.icon('download', { size: 14 }) + 'Salvar como JSON</button>' +
      '        <button type="button" id="gdc-export-backup" class="btn-ghost py-2 text-xs" title="Inclui imagens (Codex/Notas/Mural/capas do Kanban/Designer de Cartas) e fontes customizadas — arquivo maior">' + GDC.icon('file-down', { size: 14 }) + 'Backup completo</button>' +
      '        <button type="button" id="gdc-import-btn" class="btn-ghost py-2 text-xs">' + GDC.icon('upload', { size: 14 }) + 'Importar JSON</button>' +
      '        <input type="file" id="gdc-file-input" accept="application/json" class="hidden" />' +
      '        <button type="button" id="gdc-import-md-btn" class="btn-ghost py-2 text-xs" title="Distribui um documento .md entre GDD, Codex e Notas, com prévia antes de aplicar">' + GDC.icon('file-text', { size: 14 }) + 'Importar .md</button>' +
      '        <input type="file" id="gdc-md-file-input" accept=".md,.markdown,.txt,text/markdown,text/plain" class="hidden" />' +
      '        <button type="button" id="gdc-reset" class="btn-ghost py-2 text-xs">' + GDC.icon('rotate-ccw', { size: 14 }) + 'Reiniciar</button>' +
      '      </div>' +
      '      <div id="gdc-templates-wrap" class="templates-wrap" style="display:none"><div id="gdc-templates"></div></div>' +
      '      <div class="builder-grid">' +
      '        <div><div id="gdc-builder"></div></div>' +
      '        <div class="preview-sticky-wrap">' +
      '          <div class="preview-sticky-inner">' +
      '            <div id="gdc-preview" class="preview-mount"></div>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +
      '      <div class="tab-help-note">' + GDC.icon('info', { size: 16 }) +
      '        <p><strong>Como funciona:</strong> o GDC (fichas ao lado) e o GDD (documento gerado) ficam sempre sincronizados — qualquer alteração nas fichas atualiza o documento em tempo real, sem precisar salvar nada. Use "Usar um template" para começar com uma estrutura pronta, e "Salvar como JSON" para guardar ou transferir o projeto.</p>' +
      '      </div>' +
      '    </section>' +
      '  </div>' +
      '  <div class="tab-panel" data-tab-panel="kanban"><div id="gdc-kanban"></div></div>' +
      '  <div class="tab-panel" data-tab-panel="codex"><div id="gdc-codex"></div></div>' +
      '  <div class="tab-panel" data-tab-panel="arte"><div id="gdc-art"></div></div>' +
      '  <div class="tab-panel" data-tab-panel="notes"><div id="gdc-notes"></div></div>' +
      '  <div class="tab-panel" data-tab-panel="mural"><div id="gdc-mural"></div></div>' +
      (projectType === 'boardgame' ? '' : '  <div class="tab-panel" data-tab-panel="skilltree"><div id="gdc-skilltree"></div></div>') +
      (projectType === 'jogo-digital' ? '  <div class="tab-panel" data-tab-panel="maps"><div id="gdc-maps"></div></div>' : '') +
      '  <div class="tab-panel" data-tab-panel="ferramentas"><div id="gdc-tools"></div></div>' +
      '  <div class="tab-panel" data-tab-panel="saude"><div id="gdc-health"></div></div>' +
      '  <div id="gdc-footer"></div>' +
      '</div>';
  }

  var activeMainTab = 'gdc';
  var templatesExpanded = false;

  function switchMainTab(tab) {
    activeMainTab = tab;
    document.querySelectorAll('[data-tab-panel]').forEach(function (el) {
      el.style.display = el.getAttribute('data-tab-panel') === tab ? '' : 'none';
    });
    document.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.classList.toggle('main-tab-btn-active', btn.getAttribute('data-tab') === tab);
    });
    if (tab === 'saude' && GDC.ui.health) GDC.ui.health.update(state.doc);
    // Entradas do Codex podem ter mudado desde o último render (opções de "ligar ao Codex").
    if (tab === 'arte' && GDC.ui.artDirection) GDC.ui.artDirection.render();
    if (tab === 'maps' && GDC.ui.atlas) GDC.ui.atlas.shown();
    // O Economy Simulator (dentro de Ferramentas) mostra o custo total da Árvore de Habilidades — como
    // as duas ficam em abas diferentes, editar um nó lá não re-renderiza o card daqui sozinho, então
    // atualiza aqui sempre que a pessoa troca pra essa aba (mesmo raciocínio do health.update acima).
    if (tab === 'ferramentas' && GDC.ui.economySimulator) GDC.ui.economySimulator.refreshSkillTree(state.doc.skillTree);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function setTemplatesExpanded(expanded) {
    templatesExpanded = expanded;
    var wrap = document.getElementById('gdc-templates-wrap');
    var btn = document.getElementById('gdc-toggle-templates');
    if (wrap) wrap.style.display = expanded ? '' : 'none';
    if (btn) btn.classList.toggle('btn-ghost-active', expanded);
  }

  function bindTabEvents() {
    document.querySelectorAll('[data-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () { switchMainTab(btn.getAttribute('data-tab')); });
    });
    document.querySelectorAll('[data-tab-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () { switchMainTab(btn.getAttribute('data-tab-goto')); });
    });
    var templatesToggle = document.getElementById('gdc-toggle-templates');
    if (templatesToggle) templatesToggle.addEventListener('click', function () { setTemplatesExpanded(!templatesExpanded); });
    switchMainTab(activeMainTab);
  }

  // ---------- Tela de projetos (multi-projeto) ----------
  // Trocar de projeto (ou voltar pra lista) recarrega a página inteira em vez de só trocar o `doc`
  // em memória — módulos com estado próprio fora do doc (contador de request-id do Health, cache de
  // URLs de imagem, layout calculado do Mural/Árvore de Habilidades) não têm um "reset total"
  // confiável um por um; um reload garante que nenhum resquício do projeto anterior sobrevive à
  // troca, ao custo de perder a transição instantânea entre projetos.

  function mountProjectSwitcher() {
    document.getElementById('root').innerHTML = '<div id="gdc-projects"></div>';
    GDC.ui.projects.mount(document.getElementById('gdc-projects'), {
      theme: state.theme,
      onToggleTheme: toggleTheme,
      onOpenProject: function (id) {
        GDC.setActiveProjectId(id);
        global.location.reload();
      },
      onCreateProject: function (name, type) {
        var id = GDC.createProject(name, type);
        GDC.setActiveProjectId(id);
        global.location.reload();
      },
      onRenameProject: function (id, name) {
        GDC.renameProject(id, name);
        GDC.ui.projects.render();
      },
      onDeleteProject: function (id) {
        GDC.deleteProject(id);
        GDC.ui.projects.render();
      },
    });
  }

  function gotoProjectSwitcher() {
    GDC.clearActiveProjectId();
    global.location.reload();
  }

  function initProjectShell(projectId) {
    state.projectId = projectId;
    state.doc = GDC.loadDocumentFromStorage(projectId) || GDC.createEmptyDocument();
    // Projeto salvo por uma versão MAIS NOVA do app (outra cópia, ex.: a do Google Drive): esta cópia
    // não conhece todos os campos e, se salvasse, apagaria o que não conhece. Abre só pra leitura.
    state.readOnly = GDC.storedDocRevision(projectId) > (GDC.DATA_REVISION || 0);
    applyTheme(state.theme);

    var projectType = state.doc.projectType;
    buildShell(projectType);

    fileInput = document.getElementById('gdc-file-input');
    importToastEl = document.getElementById('gdc-import-toast');
    if (state.readOnly) {
      document.body.insertAdjacentHTML('beforeend',
        '<div class="readonly-banner" role="alert">' + GDC.icon('alert-triangle', { size: 16 }) +
        '<span><strong>Esta cópia do Waypoint está desatualizada.</strong> O projeto foi salvo por uma versão mais nova do app — abra a cópia atualizada (ex.: a do Google Drive). Por segurança, nada que você mudar aqui será salvo.</span></div>');
    }

    var meta = GDC.findProjectMeta(projectId);

    GDC.ui.header.mount(document.getElementById('gdc-header'), {
      theme: state.theme,
      onToggleTheme: toggleTheme,
      tabsHtml: tabsMarkup(projectType),
      projectName: meta ? meta.name : state.doc.title,
      onGotoProjects: gotoProjectSwitcher,
    });

    bindTabEvents();

    document.getElementById('gdc-import-btn').addEventListener('click', handleImportClick);
    var mdInput = document.getElementById('gdc-md-file-input');
    document.getElementById('gdc-import-md-btn').addEventListener('click', function () { mdInput.click(); });
    mdInput.addEventListener('change', handleMdFileChange);
    fileInput.addEventListener('change', handleFileChange);
    document.getElementById('gdc-export-json').addEventListener('click', handleExportJson);
    document.getElementById('gdc-export-backup').addEventListener('click', handleExportBackup);
    document.getElementById('gdc-reset').addEventListener('click', handleReset);

    GDC.ui.builder.mount(document.getElementById('gdc-builder'), {
      doc: state.doc,
      onTitleChange: handleTitleChange,
      onSectionChange: handleSectionChange,
      onLayoutChange: handleLayoutChange,
    });

    GDC.ui.preview.mount(document.getElementById('gdc-preview'));
    GDC.ui.preview.update(state.doc);

    GDC.ui.templates.mount(document.getElementById('gdc-templates'), {
      activeTemplate: state.doc.template,
      onSelect: handleTemplateSelect,
      projectType: projectType,
    });

    GDC.ui.kanban.mount(document.getElementById('gdc-kanban'), {
      kanban: state.doc.kanban,
      colorPalette: GDC.MILESTONE_COLOR_PALETTE,
      onAddCard: handleAddCard,
      onUpdateCard: handleUpdateCard,
      onDeleteCard: handleDeleteCard,
      onMoveCard: handleMoveCard,
      onRestoreCard: handleRestoreCard,
      onDeleteForever: handleDeleteForever,
      onEmptyTrash: handleEmptyTrash,
      onSuggestMilestones: handleSuggestMilestones,
      onAddCategory: handleAddKanbanCategory,
      onDeleteCategory: handleDeleteKanbanCategory,
    });

    GDC.ui.tools.mount(document.getElementById('gdc-tools'), {
      tools: state.doc.tools,
      skillTree: state.doc.skillTree,
      codex: state.doc.codex,
      onGotoCodexEntry: handleGotoCodexEntry,
      onToolChange: handleToolChange,
      projectType: projectType,
    });

    GDC.ui.codex.mount(document.getElementById('gdc-codex'), {
      codex: state.doc.codex,
      gddSections: state.doc.sections,
      projectType: projectType,
      doc: state.doc,
      onGotoArt: handleGotoArt,
      onAddType: handleAddCodexType,
      onUpdateType: handleUpdateCodexType,
      onDeleteType: handleDeleteCodexType,
      onAddEntry: handleAddCodexEntry,
      onUpdateEntry: handleUpdateCodexEntry,
      onDeleteEntry: handleDeleteCodexEntry,
    });

    GDC.ui.artDirection.mount(document.getElementById('gdc-art'), {
      art: state.doc.artDirection,
      codex: state.doc.codex,
      onChange: scheduleAutosave,
      onGotoCodexEntry: handleGotoCodexEntry,
    });

    GDC.ui.notes.mount(document.getElementById('gdc-notes'), {
      notes: state.doc.notes,
      codex: state.doc.codex,
      onAddNote: handleAddNote,
      onUpdateNote: handleUpdateNote,
      onDeleteNote: handleDeleteNote,
      onGotoCodexEntry: handleGotoCodexEntry,
    });

    GDC.ui.mural.mount(document.getElementById('gdc-mural'), {
      mural: state.doc.mural,
      codex: state.doc.codex,
      onAddItem: handleAddMuralItem,
      onUpdateItem: handleUpdateMuralItem,
      onDeleteItem: handleDeleteMuralItem,
      onReplaceItems: handleReplaceMuralItems,
      onGotoCodexEntry: handleGotoCodexEntry,
    });

    // Árvore de Habilidades não faz sentido pra um boardgame (ver comentário em tabsMarkup) — nem o
    // painel dela existe no DOM nesse caso (buildShell já não o criou), então nem monta o módulo.
    if (projectType !== 'boardgame') {
      GDC.ui.skillTree.mount(document.getElementById('gdc-skilltree'), {
        skillTree: state.doc.skillTree,
        codex: state.doc.codex,
        tools: state.doc.tools,
        onAddNode: handleAddSkillNode,
        onUpdateNode: handleUpdateSkillNode,
        onDeleteNode: handleDeleteSkillNode,
        onAddBranch: handleAddSkillBranch,
        onUpdateBranch: handleUpdateSkillBranch,
        onDeleteBranch: handleDeleteSkillBranch,
        onGotoCodexEntry: handleGotoCodexEntry,
      });
    }

    if (projectType === 'jogo-digital') {
      mountMapsTab(projectType);
    }

    GDC.ui.health.mount(document.getElementById('gdc-health'), {
      doc: state.doc,
      onExportJson: handleExportJson,
      onGotoCodexEntry: handleGotoCodexEntry,
      projectId: state.projectId,
    });

    GDC.ui.footer.mount(document.getElementById('gdc-footer'));

    state.loaded = true;
    if (purgeExpiredTrash()) {
      GDC.ui.kanban.syncState(state.doc.kanban);
      GDC.ui.kanban.reset(state.doc.kanban);
      scheduleAutosave();
    }
  }

  function init() {
    GDC.runMigrationIfNeeded();
    state.theme = readInitialTheme();
    var activeId = GDC.getActiveProjectId();
    var meta = activeId ? GDC.findProjectMeta(activeId) : null;
    if (activeId && meta) {
      initProjectShell(activeId);
    } else {
      if (activeId && !meta) GDC.clearActiveProjectId(); // projeto ativo apontava pra algo já excluído
      applyTheme(state.theme);
      mountProjectSwitcher();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
}(window));
