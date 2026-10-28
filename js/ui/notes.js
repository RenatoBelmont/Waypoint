/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // ---------------------------------------------------------------------------------------------
  // Notas: anotações livres em Markdown, sem a estrutura fixa do Codex — o rascunho rápido que não
  // merece virar uma ficha estruturada. Usa a mesma sintaxe [[Nome]] do Codex pra linkar uma entrada
  // quando fizer sentido, e pode levar uma única imagem de referência (guardada via imageStore).
  // ---------------------------------------------------------------------------------------------

  var root, notesState, codexRef, callbacks;
  // Modo leitura (Markdown renderizado) x edição. Lembra a última escolha durante a sessão — notas são
  // rascunho, então o padrão é edição; quem prefere ler troca uma vez e segue lendo.
  var noteReading = false;
  var activeNoteId = null;
  var searchQuery = '';
  // Visualização: 'list' (lista + editor ao lado) ou 'grid' (cartões estilo Google Keep; a nota abre
  // num modal por cima). Preferência do navegador, não do projeto.
  var VIEW_KEY = 'gdc:notesView';
  var viewMode = 'list';
  try { viewMode = localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch (e) { /* sem storage */ }
  var modalOpen = false;
  var gridCols = 0, gridObserver = null;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max).trim() + '…' : str;
  }

  function relativeTime(ts) {
    var diff = Date.now() - (ts || 0);
    var min = Math.floor(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return min + 'min atrás';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h atrás';
    var day = Math.floor(hr / 24);
    if (day < 30) return day + 'd atrás';
    return new Date(ts).toLocaleDateString('pt-BR');
  }

  function noteById(id) { return notesState.filter(function (n) { return n.id === id; })[0] || null; }

  function findEntryByName(name) {
    var key = (name || '').trim().toLowerCase();
    if (!key || !codexRef) return null;
    return codexRef.entries.filter(function (e) { return (e.name || '').trim().toLowerCase() === key; })[0] || null;
  }

  function typeById(id) {
    return codexRef ? (codexRef.types.filter(function (t) { return t.id === id; })[0] || null) : null;
  }

  function linkChipsMarkup(text) {
    var names = GDC.parseWikiLinkNames(text);
    if (!names.length) return '';
    return names.map(function (name) {
      var target = findEntryByName(name);
      if (target) {
        return '<button type="button" class="codex-link-chip" data-goto-codex-entry="' + target.id + '">' +
          GDC.icon('link-2', { size: 10 }) + escapeHtml(target.name || '(sem nome)') + '</button>';
      }
      return '<span class="codex-link-chip codex-link-chip-missing" title="Nenhuma entrada com esse nome ainda no Codex">' + escapeHtml(name) + '</span>';
    }).join('');
  }

  function imageFieldMarkup(note) {
    var value = note.imageId;
    return (
      '<div class="notes-image-field" data-notes-image>' +
      (value
        ? (
          '<div class="notes-image-thumb img-full" title="Clique pra ampliar" data-image-thumb="' + value + '">' + GDC.icon('image', { size: 16 }) + '</div>' +
          '<div class="codex-image-actions">' +
          '  <label class="btn-ghost py-1 text-xs" title="Trocar imagem">' + GDC.icon('upload', { size: 12 }) + 'Trocar' +
          '    <input type="file" accept="image/*" class="hidden" data-note-image-upload />' +
          '  </label>' +
          '  <button type="button" class="btn-ghost py-1 text-xs" data-note-image-remove>' + GDC.icon('trash-2', { size: 12 }) + 'Remover</button>' +
          '</div>'
        )
        : (
          '<label class="codex-image-dropzone" data-note-image-dropzone>' +
          GDC.icon('image', { size: 18 }) + '<span>Adicionar imagem de referência — clique ou arraste</span>' +
          '  <input type="file" accept="image/*" class="hidden" data-note-image-upload />' +
          '</label>'
        )
      ) +
      '</div>'
    );
  }

  function noteHeadMarkup(note, reading, titleHtml) {
    return (
      '  <div class="notes-editor-head">' +
      titleHtml +
      '    <div class="flex items-center gap-1 flex-shrink-0">' +
      '      <span class="notes-editor-time">' + GDC.icon('activity', { size: 11 }) + 'Atualizada ' + relativeTime(note.updatedAt) + '</span>' +
      '      <button type="button" class="kanban-icon-btn" data-action="toggle-note-read" title="' + (reading ? 'Editar' : 'Ler') + '" aria-label="' + (reading ? 'Editar' : 'Ler') + '">' + GDC.icon(reading ? 'pencil' : 'eye', { size: 14 }) + '</button>' +
      '      <button type="button" class="kanban-icon-btn kanban-icon-btn-danger" data-action="delete-note" title="Excluir">' + GDC.icon('trash-2', { size: 14 }) + '</button>' +
      '    </div>' +
      '  </div>'
    );
  }

  function noteReadMarkup(note) {
    var body = (note.body || '').trim();
    return (
      '<div class="notes-editor notes-read" data-note-form="' + note.id + '">' +
      noteHeadMarkup(note, true, '<h3 class="codex-read-title">' + escapeHtml(note.title || '(sem título)') + '</h3>') +
      (note.imageId ? '<div class="notes-image-thumb img-full" title="Clique pra ampliar" data-image-thumb="' + note.imageId + '">' + GDC.icon('image', { size: 16 }) + '</div>' : '') +
      (body
        ? GDC.renderMarkdown(body, 'codex-read-md', { resolveLink: function (name) {
          var hit = findEntryByName(name);
          return hit ? { id: hit.id, label: hit.name || name } : null;
        } })
        : '<p class="text-xs text-muted">Nota vazia — clique no lápis para escrever.</p>') +
      '</div>'
    );
  }

  function noteEditorMarkup(note) {
    if (noteReading) return noteReadMarkup(note);
    return (
      '<div class="notes-editor" data-note-form="' + note.id + '">' +
      noteHeadMarkup(note, false, '    <input type="text" class="input-field font-display text-sm font-semibold" data-note-field="title" placeholder="Título da nota" value="' + escapeHtml(note.title) + '" />') +
      imageFieldMarkup(note) +
      '  <div class="codex-field-row">' +
      '    <textarea class="input-field resize-y notes-body-input" rows="12" data-note-field="body" placeholder="Escreva livremente em Markdown. Use [[Nome]] para linkar uma entrada do Codex.">' + escapeHtml(note.body) + '</textarea>' +
      '    <div class="codex-link-chips" data-note-link-chips>' + linkChipsMarkup(note.body) + '</div>' +
      '  </div>' +
      '</div>'
    );
  }

  function noteListItemMarkup(note) {
    var active = note.id === activeNoteId;
    return (
      '<button type="button" class="notes-list-item' + (active ? ' notes-list-item-active' : '') + '" data-select-note="' + note.id + '">' +
      '  <span class="notes-list-item-title">' + escapeHtml(note.title || '(sem título)') + '</span>' +
      (note.body ? '<span class="notes-list-item-excerpt">' + escapeHtml(truncate(note.body.replace(/\s+/g, ' ').trim(), 70)) + '</span>' : '') +
      '  <span class="notes-list-item-time">' + relativeTime(note.updatedAt) + '</span>' +
      '</button>'
    );
  }

  function filteredNotes() {
    var list = notesState.slice();
    var q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(function (n) {
        return (n.title || '').toLowerCase().indexOf(q) !== -1 || (n.body || '').toLowerCase().indexOf(q) !== -1;
      });
    }
    list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return list;
  }

  function notesListMarkup() {
    var list = filteredNotes();
    return list.length
      ? list.map(noteListItemMarkup).join('')
      : '<p class="codex-empty">' + (searchQuery ? 'Nenhuma nota encontrada.' : 'Nenhuma nota ainda.') + '</p>';
  }

  // Nota: a caixa de busca (#notes-search) NÃO pode viver dentro do elemento que renderSidebar()
  // substitui — trocar o innerHTML de um ancestral do próprio campo que disparou o evento 'input'
  // remove o nó focado no meio do próprio despacho do evento, o que dispara um 'blur'/'change'
  // síncrono e reentrante (o navegador tenta remover um nó que "já não é filho" — erro real visto
  // em teste). Por isso o shell da sidebar (busca + botão) é fixo, e só a lista (#notes-list) é
  // re-renderizada a cada busca.
  function viewToggleMarkup() {
    var b = function (v, icon, label) { return '<button type="button" class="kanban-icon-btn' + (viewMode === v ? ' notes-view-on' : '') + '" data-notes-view="' + v + '" title="' + label + '" aria-label="' + label + '" aria-pressed="' + (viewMode === v) + '">' + GDC.icon(icon, { size: 14 }) + '</button>'; };
    return '<div class="notes-view-toggle">' + b('list', 'list', 'Lista') + b('grid', 'layout-grid', 'Grade') + '</div>';
  }
  function sidebarMarkup() {
    var grid = viewMode === 'grid';
    return (
      '<div class="notes-sidebar' + (grid ? ' notes-toolbar' : '') + '">' +
      '  <div class="codex-search-wrap">' + GDC.icon('search', { size: 14 }) +
      '    <input type="text" class="codex-search-input" id="notes-search" placeholder="Buscar notas..." value="' + escapeHtml(searchQuery) + '" />' +
      '  </div>' +
      '  <div class="notes-sidebar-actions">' +
      '    <button type="button" class="btn-primary py-1.5 text-xs justify-center flex-1" data-action="new-note">' + GDC.icon('plus', { size: 13 }) + 'Nova nota</button>' +
      viewToggleMarkup() +
      '  </div>' +
      (grid ? '' : '  <div class="notes-list" id="notes-list">' + notesListMarkup() + '</div>') +
      '</div>'
    );
  }

  // ---------- Grade (estilo Keep) ----------
  function noteCardMarkup(note, idx) {
    var body = (note.body || '').trim();
    var preview = truncate(body.replace(/\n{3,}/g, '\n\n'), 420);
    return (
      '<button type="button" class="notes-card" data-open-note="' + note.id + '" data-order="' + idx + '">' +
      (note.imageId ? '<span class="notes-card-img img-ar" data-image-thumb="' + note.imageId + '"></span>' : '') +
      '<span class="notes-card-body">' +
      (note.title ? '<span class="notes-card-title">' + escapeHtml(note.title) + '</span>' : '') +
      (preview ? '<span class="notes-card-text">' + escapeHtml(preview) + '</span>' : (note.title ? '' : '<span class="notes-card-text text-muted">Nota vazia</span>')) +
      '<span class="notes-list-item-time">' + relativeTime(note.updatedAt) + '</span>' +
      '</span></button>'
    );
  }
  /** Distribui as notas em N colunas, da esquerda pra direita (a mais recente no topo à esquerda, como no Keep). */
  function notesGridMarkup() {
    var list = filteredNotes();
    if (!list.length) return '<p class="codex-empty">' + (searchQuery ? 'Nenhuma nota encontrada.' : 'Nenhuma nota ainda.') + '</p>';
    var n = Math.max(1, gridCols || 3), cols = [];
    for (var i = 0; i < n; i++) cols.push([]);
    list.forEach(function (note, idx) { cols[idx % n].push(noteCardMarkup(note, idx)); });
    return cols.map(function (c) { return '<div class="notes-grid-col">' + c.join('') + '</div>'; }).join('');
  }
  function computeGridCols() {
    var el = root && root.querySelector('#notes-main');
    var w = el ? el.clientWidth : 0;
    return w ? Math.max(1, Math.floor((w + 14) / (240 + 14))) : 3;
  }
  function renderGrid() {
    var g = root.querySelector('#notes-grid');
    if (!g) return;
    g.innerHTML = notesGridMarkup();
    if (GDC.imageStore) GDC.imageStore.resolveThumbs(g);
    packGrid();
  }
  /** Encaixe estilo Keep: cada cartão (na ordem, do mais recente) vai pra coluna MAIS BAIXA no momento,
   *  medindo a altura real. Refeito quando uma imagem termina de carregar e muda a altura do cartão. */
  function packGrid() {
    var g = root && root.querySelector('#notes-grid');
    if (!g) return;
    var cols = Array.prototype.slice.call(g.querySelectorAll('.notes-grid-col'));
    if (cols.length < 2) return;
    var cards = Array.prototype.slice.call(g.querySelectorAll('.notes-card'))
      .sort(function (a, b) { return Number(a.getAttribute('data-order')) - Number(b.getAttribute('data-order')); });
    var gap = 14, hs = cols.map(function () { return 0; });
    cards.forEach(function (card) {
      var i = hs.indexOf(Math.min.apply(null, hs));
      cols[i].appendChild(card);
      hs[i] += card.offsetHeight + gap;
    });
  }
  var packTimer = null;
  function packSoon() { clearTimeout(packTimer); packTimer = setTimeout(packGrid, 30); }
  function noteModalMarkup(note) {
    return '<div class="notes-modal" data-notes-modal><div class="notes-modal-card" role="dialog" aria-modal="true">' +
      '<button type="button" class="kanban-icon-btn notes-modal-close" data-action="close-note-modal" title="Fechar (Esc)" aria-label="Fechar">' + GDC.icon('x', { size: 16 }) + '</button>' +
      noteEditorMarkup(note) + '</div></div>';
  }
  function closeModal() { modalOpen = false; render(); }

  function mainAreaMarkup() {
    var note = activeNoteId && noteById(activeNoteId);
    if (viewMode === 'grid') {
      if (!notesState.length) {
        return '<div class="codex-empty-state"><p class="codex-empty-state-title">Nenhuma nota ainda</p>' +
          '<p class="codex-empty-state-sub">Um espaço livre pra rascunhos, ideias soltas e lembretes que não precisam da estrutura de uma ficha do Codex.</p></div>';
      }
      return '<div class="notes-grid" id="notes-grid">' + notesGridMarkup() + '</div>' + (modalOpen && note ? noteModalMarkup(note) : '');
    }
    if (!note) {
      return (
        '<div class="codex-empty-state">' +
        '  <p class="codex-empty-state-title">' + (notesState.length ? 'Selecione uma nota' : 'Nenhuma nota ainda') + '</p>' +
        '  <p class="codex-empty-state-sub">Um espaço livre pra rascunhos, ideias soltas e lembretes que não precisam da estrutura de uma ficha do Codex.</p>' +
        '  <div class="flex items-center justify-center gap-2 mt-3">' +
        '    <button type="button" class="btn-primary py-1.5 text-xs" data-action="new-note">' + GDC.icon('plus', { size: 13 }) + 'Nova nota</button>' +
        '  </div>' +
        '</div>'
      );
    }
    return noteEditorMarkup(note);
  }

  function shellMarkup() {
    return (
      '<section id="notes" class="builder-section">' +
      '  <div class="mb-8 text-center">' +
      '    <div class="hero-badge">' + GDC.icon('sticky-note', { size: 14, className: 'text-fuchsia-400' }) + 'Rascunhos e ideias soltas</div>' +
      '    <h2 class="font-display text-3xl font-bold text-primary">Notas</h2>' +
      '    <p class="mt-2 text-secondary">Anotações livres em Markdown — sem estrutura fixa, sem compromisso.</p>' +
      '  </div>' +
      '  <div class="notes-layout">' +
      '    <div id="notes-sidebar"></div>' +
      '    <div id="notes-main"></div>' +
      '  </div>' +
      '  <div class="tab-help-note">' + GDC.icon('info', { size: 16 }) +
      '    <p><strong>Como funciona:</strong> cada nota é um rascunho livre em Markdown — sem campos fixos. Use <code>[[Nome]]</code> no texto pra linkar uma entrada do Codex (o link aparece como um chip clicável abaixo do texto). Dá pra anexar uma imagem de referência por nota.</p>' +
      '  </div>' +
      '</section>'
    );
  }

  // ---------- Eventos ----------

  // Só troca o innerHTML se o conteúdo realmente mudou. Sem isso, um "change" redundante (disparado
  // no blur do textarea — por exemplo, ao clicar num chip logo abaixo dele) recriaria os elementos
  // do zero no meio do próprio clique, e o botão sob o cursor deixaria de existir antes do clique
  // terminar. O "input" a cada tecla já mantém os chips atualizados; isso só evita o retrabalho.
  // Importante: comparamos com o que NÓS mesmos atribuímos da última vez (guardado numa propriedade
  // no próprio elemento), não com `el.innerHTML` — o navegador normaliza a marcação ao serializá-la
  // de volta (aspas, ordem de atributos...), então comparar com a leitura quase nunca bate.
  function refreshLinkChips(formEl, value) {
    var el = formEl.querySelector('[data-note-link-chips]');
    if (!el) return;
    var next = linkChipsMarkup(value);
    if (el.__lastMarkup === next) return;
    el.innerHTML = next;
    el.__lastMarkup = next;
  }

  function refreshImageField(formEl, note) {
    var wrap = formEl.querySelector('[data-notes-image]');
    if (wrap) wrap.outerHTML = imageFieldMarkup(note);
    GDC.imageStore && GDC.imageStore.resolveThumbs(formEl);
  }

  function handleImageUpload(formEl, note, file) {
    if (!file || !GDC.imageStore) return;
    if (file.type && file.type.indexOf('image/') !== 0) return;
    GDC.imageStore.put(file).then(function (meta) {
      note.imageId = meta.id;
      if (callbacks.onUpdateNote) callbacks.onUpdateNote(note.id, { imageId: meta.id });
      refreshImageField(formEl, note);
    }).catch(function () { /* falha ao guardar a imagem — mantém como estava */ });
  }

  function handleRootClick(e) {
    var el;

    if ((el = e.target.closest('[data-goto-codex-entry], [data-goto-entry]'))) {
      var gotoId = el.getAttribute('data-goto-codex-entry') || el.getAttribute('data-goto-entry');
      if (callbacks.onGotoCodexEntry) callbacks.onGotoCodexEntry(gotoId);
      return;
    }

    if ((el = e.target.closest('[data-action="toggle-note-read"]'))) { noteReading = !noteReading; render(); return; }

    if ((el = e.target.closest('[data-notes-view]'))) {
      viewMode = el.getAttribute('data-notes-view') === 'grid' ? 'grid' : 'list';
      try { localStorage.setItem(VIEW_KEY, viewMode); } catch (err) { /* sem storage */ }
      modalOpen = false; render(); return;
    }
    if ((el = e.target.closest('[data-open-note]'))) { activeNoteId = el.getAttribute('data-open-note'); modalOpen = true; render(); focusModal(); return; }
    if ((el = e.target.closest('[data-action="close-note-modal"]'))) { closeModal(); return; }
    if (e.target.matches && e.target.matches('[data-notes-modal]')) { closeModal(); return; }

    if ((el = e.target.closest('[data-select-note]'))) { activeNoteId = el.getAttribute('data-select-note'); render(); return; }

    if ((el = e.target.closest('[data-action="new-note"]'))) {
      if (!callbacks.onAddNote) return;
      var created = callbacks.onAddNote();
      if (created) { activeNoteId = created.id; noteReading = false; if (viewMode === 'grid') modalOpen = true; render(); var titleEl = root.querySelector('[data-note-field="title"]'); if (titleEl) titleEl.focus(); }
      return;
    }

    if ((el = e.target.closest('[data-action="delete-note"]'))) {
      var form = el.closest('[data-note-form]');
      var id = form.getAttribute('data-note-form');
      var note = noteById(id);
      if (!global.confirm('Excluir "' + (note ? (note.title || '(sem título)') : '') + '"? Essa ação não pode ser desfeita.')) return;
      if (callbacks.onDeleteNote) callbacks.onDeleteNote(id);
      if (activeNoteId === id) activeNoteId = null;
      modalOpen = false;
      render(); return;
    }

    if ((el = e.target.closest('[data-note-image-remove]'))) {
      var irForm = el.closest('[data-note-form]');
      var irNote = noteById(irForm.getAttribute('data-note-form'));
      irNote.imageId = null;
      if (callbacks.onUpdateNote) callbacks.onUpdateNote(irNote.id, { imageId: null });
      refreshImageField(irForm, irNote);
      return;
    }
  }

  function handleRootInput(e) {
    var t = e.target;

    if (t.id === 'notes-search') { searchQuery = t.value; if (viewMode === 'grid') renderGrid(); else renderSidebar(); return; }

    if (t.matches('[data-note-image-upload]')) {
      var iuForm = t.closest('[data-note-form]');
      var iuNote = noteById(iuForm.getAttribute('data-note-form'));
      var iuFile = t.files && t.files[0];
      if (iuFile && iuNote) handleImageUpload(iuForm, iuNote, iuFile);
      t.value = '';
      return;
    }

    if (t.matches('[data-note-field]')) {
      var form = t.closest('[data-note-form]');
      if (!form) return;
      var noteId = form.getAttribute('data-note-form');
      var key = t.getAttribute('data-note-field');
      var patch = {};
      patch[key] = t.value;
      if (callbacks.onUpdateNote) callbacks.onUpdateNote(noteId, patch);
      if (key === 'title') { var itemTitle = root.querySelector('[data-select-note="' + noteId + '"] .notes-list-item-title'); if (itemTitle) itemTitle.textContent = t.value || '(sem título)'; }
      if (key === 'body') refreshLinkChips(form, t.value);
      return;
    }
  }

  // ---------- Drag-and-drop de imagem ----------

  function bindImageDrop(rootEl) {
    rootEl.addEventListener('dragover', function (e) {
      if (!e.target.closest('[data-notes-image]')) return;
      e.preventDefault();
      var zone = e.target.closest('[data-note-image-dropzone]');
      if (zone) zone.classList.add('codex-image-dropzone-hover');
    });
    rootEl.addEventListener('dragleave', function (e) {
      var zone = e.target.closest('[data-note-image-dropzone]');
      if (zone) zone.classList.remove('codex-image-dropzone-hover');
    });
    rootEl.addEventListener('drop', function (e) {
      var wrap = e.target.closest('[data-notes-image]');
      if (!wrap) return;
      e.preventDefault();
      var zone = e.target.closest('[data-note-image-dropzone]');
      if (zone) zone.classList.remove('codex-image-dropzone-hover');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      var form = wrap.closest('[data-note-form]');
      var note = form && noteById(form.getAttribute('data-note-form'));
      if (file && note) handleImageUpload(form, note, file);
    });
  }

  // ---------- Render / mount ----------

  function render() {
    var layout = root.querySelector('.notes-layout');
    if (layout) layout.classList.toggle('notes-layout-grid', viewMode === 'grid');
    if (viewMode === 'grid') gridCols = computeGridCols();
    // Re-render enquanto se digita na busca trocaria o campo focado — preserva foco e cursor.
    var searchFocused = document.activeElement && document.activeElement.id === 'notes-search';
    var caret = searchFocused ? document.activeElement.selectionStart : null;
    root.querySelector('#notes-sidebar').innerHTML = sidebarMarkup();
    root.querySelector('#notes-main').innerHTML = mainAreaMarkup();
    if (viewMode === 'grid') { var gc = computeGridCols(); if (gc !== gridCols) { gridCols = gc; renderGrid(); } }
    if (viewMode === 'grid') packGrid();
    if (searchFocused) { var si = root.querySelector('#notes-search'); if (si) { si.focus(); try { si.setSelectionRange(caret, caret); } catch (e) { /* ok */ } } }
    if (GDC.imageStore) GDC.imageStore.resolveThumbs(root);
  }
  function focusModal() {
    var t = root.querySelector('.notes-modal [data-note-field="title"]');
    if (t && !t.value) t.focus();
  }
  function onKeyDown(e) {
    if (e.key !== 'Escape' || !modalOpen || !root || root.offsetParent === null) return;
    if (document.querySelector('.img-viewer')) return; // o visualizador de imagem fecha primeiro
    e.preventDefault(); closeModal();
  }
  function watchGridWidth() {
    if (gridObserver || typeof ResizeObserver === 'undefined') return;
    var main = root.querySelector('#notes-main'); if (!main) return;
    gridObserver = new ResizeObserver(function () {
      if (viewMode !== 'grid') return;
      var gc = computeGridCols();
      if (gc !== gridCols) { gridCols = gc; renderGrid(); }
    });
    gridObserver.observe(main);
  }

  function renderSidebar() {
    var listEl = root.querySelector('#notes-list');
    if (listEl) listEl.innerHTML = notesListMarkup();
  }

  function mount(container, opts) {
    root = container;
    notesState = opts.notes;
    codexRef = opts.codex || { types: [], entries: [] };
    callbacks = { onAddNote: opts.onAddNote, onUpdateNote: opts.onUpdateNote, onDeleteNote: opts.onDeleteNote, onGotoCodexEntry: opts.onGotoCodexEntry };
    activeNoteId = notesState.length ? notesState.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })[0].id : null;
    searchQuery = '';

    root.innerHTML = shellMarkup();
    root.addEventListener('click', handleRootClick);
    root.addEventListener('input', handleRootInput);
    root.addEventListener('change', handleRootInput);
    bindImageDrop(root);
    document.addEventListener('keydown', onKeyDown);
    root.addEventListener('wp-image-sized', function (e) { if (viewMode === 'grid' && e.target.closest && e.target.closest('#notes-grid')) packSoon(); });

    render();
    watchGridWidth();
  }

  function reset(notes, codex) {
    notesState = notes;
    codexRef = codex || { types: [], entries: [] };
    activeNoteId = notesState.length ? notesState.slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })[0].id : null;
    searchQuery = '';
    modalOpen = false;
    render();
  }

  /** Chamado depois de qualquer callback (add/update/delete) — doc.notes é reatribuído a um novo
   *  array a cada mutação (mesma convenção do Kanban/Codex), então mantém notesState apontando pro
   *  array atual antes do próximo render local. */
  function syncState(notes) {
    notesState = notes;
  }

  GDC.ui.notes = { mount: mount, reset: reset, syncState: syncState };
}(window));
