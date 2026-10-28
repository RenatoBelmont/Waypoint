/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // ---------------------------------------------------------------------------------------------
  // Quest Designer: uma ferramenta da aba Ferramentas (mesmo padrão do XP Balancer/Loot Simulator —
  // estado próprio guardado como JSON em doc.tools.questDesigner).
  //
  // O "status" de cada quest é sobre o ANDAMENTO DE PRODUÇÃO dela (rascunho → pronta pra implementar
  // no jogo) — não é um rastreador do progresso de um jogador dentro da quest. Os "objetivos" são os
  // passos que o jogador vai cumprir, em ordem (conteúdo de design, não uma lista de tarefas a
  // marcar) — por isso não têm checkbox, só texto + ordem.
  //
  // Formato salvo: { arcs: [{ id, name, summary }], quests: [...] }. Arcos (atos da história) são
  // ordenados pela posição na lista; cada quest tem `arcId` (null = sem arco), `prereqIds` (outras
  // quests que precisam vir antes), `codexIds` (entradas do Codex envolvidas) e `prerequisites`, o
  // texto livre antigo — mantido como "Outros requisitos" (nível mínimo, item etc.). Tudo aditivo:
  // um blob antigo ({ quests }) abre igual, só sem arcos. O Codex é só LIDO (opts.codex), nunca escrito.
  //
  // Eventos: delegação no container, ligada uma vez por render() — tools.js recria o container a
  // cada render, então não há acúmulo de listeners.
  // ---------------------------------------------------------------------------------------------

  var TYPE_META = {
    'Principal': { color: '#f59e0b' },
    'Secundária': { color: '#3b82f6' },
    'Repetível': { color: '#10b981' },
  };
  var TYPE_OPTIONS = Object.keys(TYPE_META);

  var STATUS_META = {
    'Rascunho': { color: '#94a3b8' },
    'Disponível': { color: '#3b82f6' },
    'Em teste': { color: '#f59e0b' },
    'Pronta': { color: '#10b981' },
  };
  var STATUS_OPTIONS = Object.keys(STATUS_META);

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function strList(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x; }) : []; }

  function makeQuest(arcId) {
    return {
      id: GDC.makeId('quest'), title: '', type: 'Principal', status: 'Rascunho',
      giver: '', summary: '', objectives: [], rewards: '', prerequisites: '',
      arcId: arcId || null, prereqIds: [], codexIds: [],
    };
  }

  function makeArc(n) {
    return { id: GDC.makeId('arc'), name: 'Arco ' + n, summary: '' };
  }

  function normalizeQuest(raw) {
    var d = makeQuest();
    if (!raw || typeof raw !== 'object') return d;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : d.id,
      title: typeof raw.title === 'string' ? raw.title : '',
      type: TYPE_OPTIONS.indexOf(raw.type) !== -1 ? raw.type : 'Principal',
      status: STATUS_OPTIONS.indexOf(raw.status) !== -1 ? raw.status : 'Rascunho',
      giver: typeof raw.giver === 'string' ? raw.giver : '',
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      objectives: Array.isArray(raw.objectives) ? raw.objectives.filter(function (o) { return typeof o === 'string'; }) : [],
      rewards: typeof raw.rewards === 'string' ? raw.rewards : '',
      prerequisites: typeof raw.prerequisites === 'string' ? raw.prerequisites : '',
      arcId: typeof raw.arcId === 'string' && raw.arcId ? raw.arcId : null,
      prereqIds: strList(raw.prereqIds),
      codexIds: strList(raw.codexIds),
    };
  }

  function normalizeArc(raw) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
    return {
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : '',
      summary: typeof raw.summary === 'string' ? raw.summary : '',
    };
  }

  /** Também limpa referências penduradas: arco apagado, quest de pré-requisito apagada, a própria
   *  quest como pré-requisito e duplicatas. (Ids do Codex apagados são ignorados na exibição, não
   *  aqui — o Codex não é conhecido no parse.) */
  function parseStored(value) {
    var empty = { arcs: [], quests: [] };
    if (!value) return empty;
    var parsed;
    try { parsed = JSON.parse(value); } catch (e) { return empty; }
    if (!parsed || typeof parsed !== 'object') return empty;
    var arcs = (Array.isArray(parsed.arcs) ? parsed.arcs : []).map(normalizeArc).filter(Boolean);
    var arcIds = {};
    arcs.forEach(function (a) { arcIds[a.id] = true; });
    var quests = Array.isArray(parsed.quests) ? parsed.quests.map(normalizeQuest) : [];
    var questIds = {};
    quests.forEach(function (q) { questIds[q.id] = true; });
    quests.forEach(function (q) {
      if (q.arcId && !arcIds[q.arcId]) q.arcId = null;
      var seen = {};
      q.prereqIds = q.prereqIds.filter(function (id) {
        if (id === q.id || !questIds[id] || seen[id]) return false;
        seen[id] = true; return true;
      });
    });
    return { arcs: arcs, quests: quests };
  }

  function render(container, onChange, opts) {
    opts = opts || {};
    var codex = opts.codex || { types: [], entries: [] };
    var onGotoCodexEntry = opts.onGotoCodexEntry;
    var stored = parseStored(container.getAttribute('data-value'));
    var arcs = stored.arcs;
    var quests = stored.quests;
    var expandedId = null;
    var collapsedArcs = {};

    container.innerHTML =
      '<div class="space-y-3">' +
      '  <div class="quest-toolbar">' +
      '    <span class="quest-progress-badge" id="qd-progress"></span>' +
      '    <div class="flex items-center gap-2">' +
      '      <button type="button" class="btn-ghost py-1.5 text-xs" data-qa="add-arc">' + GDC.icon('book-open', { size: 13 }) + 'Novo arco</button>' +
      '      <button type="button" class="btn-primary py-1.5 text-xs" data-qa="add-quest">' + GDC.icon('plus', { size: 13 }) + 'Nova quest</button>' +
      '    </div>' +
      '  </div>' +
      '  <div id="qd-list" class="quest-list"></div>' +
      '</div>';

    var progressEl = container.querySelector('#qd-progress');
    var listEl = container.querySelector('#qd-list');

    function persist() {
      onChange(JSON.stringify({ arcs: arcs, quests: quests }));
    }

    // ---------- Consultas ----------

    function questById(id) {
      for (var i = 0; i < quests.length; i++) if (quests[i].id === id) return quests[i];
      return null;
    }
    function arcById(id) {
      for (var i = 0; i < arcs.length; i++) if (arcs[i].id === id) return arcs[i];
      return null;
    }
    function arcIndex(id) {
      for (var i = 0; i < arcs.length; i++) if (arcs[i].id === id) return i;
      return -1;
    }
    function codexEntry(id) {
      return codex.entries.filter(function (e) { return e.id === id; })[0] || null;
    }
    function codexType(id) {
      return codex.types.filter(function (t) { return t.id === id; })[0] || null;
    }
    /** Quests que dependem (direta ou indiretamente) de `id` — não podem virar pré-requisito dela. */
    function dependentsOf(id) {
      var result = {}, queue = [id];
      while (queue.length) {
        var cur = queue.shift();
        quests.forEach(function (q) {
          if (q.prereqIds.indexOf(cur) !== -1 && !result[q.id]) { result[q.id] = true; queue.push(q.id); }
        });
      }
      return result;
    }
    function questLabel(q) { return q.title || '(sem título)'; }
    /** Pré-requisitos que ficam num arco POSTERIOR ao da quest — sinal de ordem narrativa quebrada.
     *  Quest sem arco não é comparada (não há ordem a quebrar). */
    function lateprereqs(q) {
      var mine = arcIndex(q.arcId);
      if (mine === -1) return [];
      return q.prereqIds.map(questById).filter(function (p) { return p && arcIndex(p.arcId) > mine; });
    }

    // ---------- Markup ----------

    function renderProgress() {
      if (!quests.length) { progressEl.textContent = ''; return; }
      var done = quests.filter(function (q) { return q.status === 'Pronta'; }).length;
      // "pronta(s)" concorda com "quest(s)" (o total), não com o número de prontas.
      var plural = quests.length === 1 ? '' : 's';
      progressEl.innerHTML = GDC.icon('flag', { size: 12 }) + ' ' + done + ' de ' + quests.length + ' quest' + plural + ' pronta' + plural +
        (arcs.length ? ' · ' + arcs.length + ' arco' + (arcs.length === 1 ? '' : 's') : '');
    }

    function questHeadMarkup(q) {
      var typeColor = (TYPE_META[q.type] || TYPE_META['Principal']).color;
      var statusColor = (STATUS_META[q.status] || STATUS_META['Rascunho']).color;
      var late = lateprereqs(q);
      return (
        '<button type="button" class="quest-card-head" data-qa="toggle-quest">' +
        '  <span class="quest-card-icon" style="background-color:' + typeColor + '20;color:' + typeColor + '">' + GDC.icon('flag', { size: 14 }) + '</span>' +
        '  <span class="min-w-0 flex-1 text-left">' +
        '    <span class="quest-card-title">' + escapeHtml(questLabel(q)) + '</span>' +
        (q.giver ? '<span class="quest-card-giver">Dada por ' + escapeHtml(q.giver) + '</span>' : '') +
        '  </span>' +
        (late.length ? '<span class="quest-card-warn" title="Depende de quest em arco posterior: ' + escapeHtml(late.map(questLabel).join(', ')) + '">' + GDC.icon('alert-circle', { size: 12 }) + '</span>' : '') +
        (q.prereqIds.length ? '<span class="quest-card-obj-count" title="Pré-requisitos">' + GDC.icon('lock', { size: 11 }) + q.prereqIds.length + '</span>' : '') +
        (q.objectives.length ? '<span class="quest-card-obj-count" title="Objetivos">' + GDC.icon('list', { size: 11 }) + q.objectives.length + '</span>' : '') +
        '  <span class="quest-card-status" style="background-color:' + statusColor + '20;color:' + statusColor + '">' + escapeHtml(q.status) + '</span>' +
        '</button>'
      );
    }

    function objectivesEditorMarkup(objectives) {
      var rows = objectives.map(function (text, i) {
        return (
          '<div class="quest-objective-row">' +
          '  <span class="quest-objective-index">' + (i + 1) + '</span>' +
          '  <input type="text" class="input-field py-1 text-xs" data-objective-text="' + i + '" placeholder="O que o jogador precisa fazer..." value="' + escapeHtml(text) + '" />' +
          '  <button type="button" class="text-muted hover:text-primary" data-qa="obj-up" data-i="' + i + '" title="Mover pra cima"' + (i === 0 ? ' disabled' : '') + '>' + GDC.icon('chevron-down', { size: 12, className: 'rotate-180' }) + '</button>' +
          '  <button type="button" class="text-muted hover:text-primary" data-qa="obj-down" data-i="' + i + '" title="Mover pra baixo"' + (i === objectives.length - 1 ? ' disabled' : '') + '>' + GDC.icon('chevron-down', { size: 12 }) + '</button>' +
          '  <button type="button" class="text-muted hover:text-rose-500" data-qa="obj-remove" data-i="' + i + '" title="Remover objetivo">' + GDC.icon('x', { size: 12 }) + '</button>' +
          '</div>'
        );
      }).join('');
      return (
        '<div class="quest-objectives-editor">' + rows +
        '  <button type="button" class="btn-ghost py-1 text-xs" data-qa="obj-add">' + GDC.icon('plus', { size: 12 }) + 'Adicionar objetivo</button>' +
        '</div>'
      );
    }

    function chipX(action, id, title) {
      return '<button type="button" class="quest-chip-x" data-qa="' + action + '" data-id="' + escapeHtml(id) + '" title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(title) + '">' + GDC.icon('x', { size: 10 }) + '</button>';
    }

    function prereqEditorMarkup(q) {
      var blocked = dependentsOf(q.id);
      var mine = arcIndex(q.arcId);
      var chips = q.prereqIds.map(function (id) {
        var p = questById(id);
        if (!p) return '';
        var late = mine !== -1 && arcIndex(p.arcId) > mine;
        return '<span class="quest-chip' + (late ? ' quest-chip-warn' : '') + '"' + (late ? ' title="Está num arco posterior a esta quest"' : '') + '>' +
          '<button type="button" class="quest-chip-link" data-qa="open-quest" data-id="' + escapeHtml(p.id) + '">' + GDC.icon('flag', { size: 10 }) + escapeHtml(questLabel(p)) + '</button>' +
          chipX('prereq-remove', p.id, 'Remover pré-requisito') + '</span>';
      }).join('');
      var candidates = quests.filter(function (o) { return o.id !== q.id && q.prereqIds.indexOf(o.id) === -1 && !blocked[o.id]; });
      var groups = [{ arc: null, list: [] }].concat(arcs.map(function (a) { return { arc: a, list: [] }; }));
      candidates.forEach(function (o) {
        var gi = o.arcId ? arcIndex(o.arcId) + 1 : 0;
        groups[gi].list.push(o);
      });
      var optsHtml = groups.filter(function (g) { return g.list.length; }).map(function (g) {
        var inner = g.list.map(function (o) { return '<option value="' + escapeHtml(o.id) + '">' + escapeHtml(questLabel(o)) + '</option>'; }).join('');
        return arcs.length ? '<optgroup label="' + escapeHtml(g.arc ? (g.arc.name || 'Arco sem nome') : 'Sem arco') + '">' + inner + '</optgroup>' : inner;
      }).join('');
      var dependents = quests.filter(function (o) { return o.prereqIds.indexOf(q.id) !== -1; });
      return (
        '<div class="quest-chips">' + (chips || '<span class="text-xs text-muted">Nenhuma.</span>') + '</div>' +
        (optsHtml ? '<select class="input-field py-1 text-xs quest-add-select" data-q-add="prereq"><option value="">+ Adicionar quest que precisa vir antes...</option>' + optsHtml + '</select>' : '') +
        (dependents.length ? '<p class="quest-dependents">Libera: ' + dependents.map(function (d) {
          return '<button type="button" class="quest-chip-link" data-qa="open-quest" data-id="' + escapeHtml(d.id) + '">' + escapeHtml(questLabel(d)) + '</button>';
        }).join(', ') + '</p>' : '')
      );
    }

    function codexEditorMarkup(q) {
      if (!codex.types.length) {
        return '<p class="text-xs text-muted">Crie tipos e entradas no Codex para vinculá-los aqui (personagens, locais, itens...).</p>';
      }
      var chips = q.codexIds.map(function (id) {
        var e = codexEntry(id);
        if (!e) return '';
        var t = codexType(e.typeId);
        return '<span class="quest-chip">' +
          '<button type="button" class="quest-chip-link" data-qa="goto-codex" data-id="' + escapeHtml(e.id) + '" title="Abrir no Codex">' + (t ? GDC.icon(t.icon, { size: 10 }) : '') + escapeHtml(e.name || '(sem nome)') + '</button>' +
          chipX('codex-remove', e.id, 'Remover vínculo') + '</span>';
      }).join('');
      var optsHtml = codex.types.map(function (t) {
        var list = codex.entries.filter(function (e) { return e.typeId === t.id && q.codexIds.indexOf(e.id) === -1; })
          .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'pt-BR'); });
        if (!list.length) return '';
        return '<optgroup label="' + escapeHtml(t.name) + '">' + list.map(function (e) {
          return '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(e.name || '(sem nome)') + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
      return (
        '<div class="quest-chips">' + (chips || '<span class="text-xs text-muted">Nenhuma.</span>') + '</div>' +
        (optsHtml ? '<select class="input-field py-1 text-xs quest-add-select" data-q-add="codex"><option value="">+ Vincular entrada do Codex...</option>' + optsHtml + '</select>' : '')
      );
    }

    function questBodyMarkup(q) {
      var typeOptionsHtml = TYPE_OPTIONS.map(function (t) { return '<option value="' + t + '"' + (t === q.type ? ' selected' : '') + '>' + t + '</option>'; }).join('');
      var statusOptionsHtml = STATUS_OPTIONS.map(function (s) { return '<option value="' + s + '"' + (s === q.status ? ' selected' : '') + '>' + s + '</option>'; }).join('');
      var arcOptionsHtml = '<option value="">Sem arco</option>' + arcs.map(function (a) {
        return '<option value="' + escapeHtml(a.id) + '"' + (a.id === q.arcId ? ' selected' : '') + '>' + escapeHtml(a.name || 'Arco sem nome') + '</option>';
      }).join('');
      return (
        '<div class="quest-card-body">' +
        '  <div class="quest-field-row">' +
        '    <label class="quest-field-label">Título</label>' +
        '    <input type="text" class="input-field py-1.5 text-xs" data-q-field="title" placeholder="Nome da quest" value="' + escapeHtml(q.title) + '" />' +
        '  </div>' +
        '  <div class="quest-field-grid quest-field-grid-4">' +
        '    <div class="quest-field-row">' +
        '      <label class="quest-field-label">Arco</label>' +
        '      <select class="input-field py-1.5 text-xs" data-q-field="arcId">' + arcOptionsHtml + '</select>' +
        '    </div>' +
        '    <div class="quest-field-row">' +
        '      <label class="quest-field-label">Tipo</label>' +
        '      <select class="input-field py-1.5 text-xs" data-q-field="type">' + typeOptionsHtml + '</select>' +
        '    </div>' +
        '    <div class="quest-field-row">' +
        '      <label class="quest-field-label">Status de produção</label>' +
        '      <select class="input-field py-1.5 text-xs" data-q-field="status">' + statusOptionsHtml + '</select>' +
        '    </div>' +
        '    <div class="quest-field-row">' +
        '      <label class="quest-field-label">Dada por</label>' +
        '      <input type="text" class="input-field py-1.5 text-xs" data-q-field="giver" placeholder="NPC, terminal, evento..." value="' + escapeHtml(q.giver) + '" />' +
        '    </div>' +
        '  </div>' +
        '  <div class="quest-field-row">' +
        '    <label class="quest-field-label">Resumo</label>' +
        '    <textarea class="input-field resize-y py-1.5 text-xs" rows="2" data-q-field="summary" placeholder="Do que se trata a quest">' + escapeHtml(q.summary) + '</textarea>' +
        '  </div>' +
        '  <div class="quest-field-row">' +
        '    <label class="quest-field-label">Objetivos (na ordem que o jogador cumpre)</label>' +
        objectivesEditorMarkup(q.objectives) +
        '  </div>' +
        '  <div class="quest-field-grid quest-field-grid-2">' +
        '    <div class="quest-field-row">' +
        '      <label class="quest-field-label">Pré-requisitos (quests)</label>' +
        prereqEditorMarkup(q) +
        '    </div>' +
        '    <div class="quest-field-row">' +
        '      <label class="quest-field-label">Envolvidos (Codex)</label>' +
        codexEditorMarkup(q) +
        '    </div>' +
        '  </div>' +
        '  <div class="quest-field-grid quest-field-grid-2">' +
        '    <div class="quest-field-row">' +
        '      <label class="quest-field-label">Recompensas</label>' +
        '      <textarea class="input-field resize-y py-1.5 text-xs" rows="2" data-q-field="rewards" placeholder="XP, itens, moeda...">' + escapeHtml(q.rewards) + '</textarea>' +
        '    </div>' +
        '    <div class="quest-field-row">' +
        '      <label class="quest-field-label">Outros requisitos</label>' +
        '      <textarea class="input-field resize-y py-1.5 text-xs" rows="2" data-q-field="prerequisites" placeholder="Nível mínimo, item, upgrade do traje...">' + escapeHtml(q.prerequisites) + '</textarea>' +
        '    </div>' +
        '  </div>' +
        '  <div class="quest-card-actions">' +
        '    <button type="button" class="btn-ghost py-1.5 text-xs" data-qa="toggle-quest">' + GDC.icon('chevron-down', { size: 13, className: 'rotate-180' }) + 'Fechar</button>' +
        '    <button type="button" class="btn-ghost py-1.5 text-xs text-rose-500" data-qa="delete-quest">' + GDC.icon('trash-2', { size: 13 }) + 'Excluir quest</button>' +
        '  </div>' +
        '</div>'
      );
    }

    function questCardMarkup(q, posInGroup, groupSize) {
      var expanded = q.id === expandedId;
      return (
        '<div class="card-surface quest-card' + (expanded ? ' quest-card-expanded' : '') + '" data-quest-card="' + escapeHtml(q.id) + '">' +
        '  <div class="quest-card-row">' +
        questHeadMarkup(q) +
        (groupSize > 1
          ? '<div class="quest-card-move">' +
            '<button type="button" class="wp-icon-btn" data-qa="quest-up" title="Subir"' + (posInGroup === 0 ? ' disabled' : '') + '>' + GDC.icon('chevron-up', { size: 13 }) + '</button>' +
            '<button type="button" class="wp-icon-btn" data-qa="quest-down" title="Descer"' + (posInGroup === groupSize - 1 ? ' disabled' : '') + '>' + GDC.icon('chevron-down', { size: 13 }) + '</button>' +
            '</div>'
          : '') +
        '  </div>' +
        (expanded ? questBodyMarkup(q) : '') +
        '</div>'
      );
    }

    function questsIn(arcId) { return quests.filter(function (q) { return (q.arcId || null) === arcId; }); }

    function questListMarkup(list) {
      return list.map(function (q, i) { return questCardMarkup(q, i, list.length); }).join('');
    }

    function arcMarkup(a, i) {
      var list = questsIn(a.id);
      var done = list.filter(function (q) { return q.status === 'Pronta'; }).length;
      var collapsed = !!collapsedArcs[a.id];
      return (
        '<div class="quest-arc" data-arc="' + escapeHtml(a.id) + '">' +
        '  <div class="quest-arc-head">' +
        '    <button type="button" class="wp-icon-btn" data-qa="arc-toggle" title="' + (collapsed ? 'Expandir' : 'Recolher') + '">' + GDC.icon(collapsed ? 'chevron-right' : 'chevron-down', { size: 14 }) + '</button>' +
        '    <span class="quest-arc-num">' + (i + 1) + '</span>' +
        '    <div class="quest-arc-text">' +
        '      <input type="text" class="quest-arc-name" data-arc-field="name" value="' + escapeHtml(a.name) + '" placeholder="Nome do arco" aria-label="Nome do arco" />' +
        '      <input type="text" class="quest-arc-summary" data-arc-field="summary" value="' + escapeHtml(a.summary) + '" placeholder="Resumo do arco (opcional)" aria-label="Resumo do arco" />' +
        '    </div>' +
        '    <span class="quest-arc-count">' + done + '/' + list.length + '</span>' +
        '    <div class="quest-card-move">' +
        '      <button type="button" class="wp-icon-btn" data-qa="arc-up" title="Subir arco"' + (i === 0 ? ' disabled' : '') + '>' + GDC.icon('chevron-up', { size: 13 }) + '</button>' +
        '      <button type="button" class="wp-icon-btn" data-qa="arc-down" title="Descer arco"' + (i === arcs.length - 1 ? ' disabled' : '') + '>' + GDC.icon('chevron-down', { size: 13 }) + '</button>' +
        '      <button type="button" class="wp-icon-btn" data-qa="arc-delete" title="Excluir arco">' + GDC.icon('trash-2', { size: 13 }) + '</button>' +
        '    </div>' +
        '  </div>' +
        (collapsed ? '' :
          '  <div class="quest-arc-body">' +
          (list.length ? questListMarkup(list) : '<p class="quest-empty quest-empty-sm">Nenhuma quest neste arco.</p>') +
          '    <button type="button" class="btn-ghost py-1 text-xs" data-qa="add-quest">' + GDC.icon('plus', { size: 12 }) + 'Quest neste arco</button>' +
          '  </div>') +
        '</div>'
      );
    }

    function renderList() {
      // Guarda o foco (campo de texto do arco/quest) pra devolvê-lo depois do re-render.
      var a = document.activeElement, focus = null;
      if (a && listEl.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) {
        var holder = a.closest('[data-quest-card], [data-arc]');
        focus = {
          sel: a.hasAttribute('data-arc-field') ? '[data-arc-field="' + a.getAttribute('data-arc-field') + '"]'
            : a.hasAttribute('data-q-field') ? '[data-q-field="' + a.getAttribute('data-q-field') + '"]'
              : a.hasAttribute('data-objective-text') ? '[data-objective-text="' + a.getAttribute('data-objective-text') + '"]' : null,
          holder: holder ? (holder.hasAttribute('data-quest-card') ? '[data-quest-card="' + holder.getAttribute('data-quest-card') + '"]' : '[data-arc="' + holder.getAttribute('data-arc') + '"]') : null,
        };
      }
      var html;
      if (!quests.length && !arcs.length) {
        html = '<p class="quest-empty">Nenhuma quest ainda — clique em "Nova quest" para criar a primeira, ou em "Novo arco" para organizar a história em atos.</p>';
      } else if (!arcs.length) {
        html = questListMarkup(quests);
      } else {
        var loose = questsIn(null);
        html = arcs.map(arcMarkup).join('') +
          (loose.length
            ? '<div class="quest-arc quest-arc-loose"><div class="quest-arc-head"><span class="quest-arc-loose-title">Sem arco</span><span class="quest-arc-count">' + loose.length + '</span></div>' +
              '<div class="quest-arc-body">' + questListMarkup(loose) + '</div></div>'
            : '');
      }
      listEl.innerHTML = html;
      renderProgress();
      if (focus && focus.sel) {
        var scope = focus.holder ? listEl.querySelector(focus.holder) : listEl;
        var el = scope && scope.querySelector(focus.sel);
        if (el) el.focus();
      }
    }

    // ---------- Ações ----------

    function moveInGroup(q, dir) {
      var group = questsIn(q.arcId || null);
      var pos = group.indexOf(q), target = group[pos + dir];
      if (!target) return;
      var i = quests.indexOf(q), j = quests.indexOf(target);
      quests[i] = target; quests[j] = q;
    }

    function addQuest(arcId) {
      var q = makeQuest(arcId);
      quests.push(q);
      expandedId = q.id;
      if (arcId) delete collapsedArcs[arcId];
      persist();
      renderList();
      var card = listEl.querySelector('[data-quest-card="' + q.id + '"]');
      var titleInput = card && card.querySelector('[data-q-field="title"]');
      if (titleInput) { titleInput.focus(); card.scrollIntoView({ block: 'nearest' }); }
    }

    function refreshHead(cardEl, q) {
      var row = cardEl.querySelector('.quest-card-row');
      var head = row && row.querySelector('.quest-card-head');
      if (head) head.outerHTML = questHeadMarkup(q);
    }

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-qa]');
      if (!btn || !container.contains(btn) || btn.disabled) return;
      var action = btn.getAttribute('data-qa');
      var cardEl = btn.closest('[data-quest-card]');
      var q = cardEl ? questById(cardEl.getAttribute('data-quest-card')) : null;
      var arcEl = btn.closest('[data-arc]');
      var arc = arcEl ? arcById(arcEl.getAttribute('data-arc')) : null;
      var id = btn.getAttribute('data-id');

      if (action === 'add-quest') { addQuest(arc ? arc.id : null); return; }
      if (action === 'add-arc') {
        var na = makeArc(arcs.length + 1);
        arcs.push(na);
        // O primeiro arco "adota" as quests soltas: sem isso elas iriam todas pra "Sem arco",
        // e o usuário teria de mover uma por uma.
        if (arcs.length === 1) quests.forEach(function (it) { if (!it.arcId) it.arcId = na.id; });
        persist(); renderList();
        var nameInput = listEl.querySelector('[data-arc="' + na.id + '"] [data-arc-field="name"]');
        if (nameInput) { nameInput.focus(); nameInput.select(); }
        return;
      }
      if (arc && !q) {
        var ai = arcs.indexOf(arc);
        if (action === 'arc-toggle') { collapsedArcs[arc.id] = !collapsedArcs[arc.id]; renderList(); return; }
        if (action === 'arc-up' || action === 'arc-down') {
          var aj = ai + (action === 'arc-up' ? -1 : 1);
          if (aj < 0 || aj >= arcs.length) return;
          arcs[ai] = arcs[aj]; arcs[aj] = arc;
          persist(); renderList(); return;
        }
        if (action === 'arc-delete') {
          var inArc = questsIn(arc.id).length;
          if (!global.confirm('Excluir o arco "' + (arc.name || 'sem nome') + '"?' + (inArc ? ' As ' + inArc + ' quests dele vão para "Sem arco" (não são apagadas).' : ''))) return;
          arcs.splice(ai, 1);
          quests.forEach(function (it) { if (it.arcId === arc.id) it.arcId = null; });
          persist(); renderList(); return;
        }
      }
      if (action === 'open-quest') {
        var target = questById(id);
        if (!target) return;
        expandedId = target.id;
        if (target.arcId) delete collapsedArcs[target.arcId];
        renderList();
        var tc = listEl.querySelector('[data-quest-card="' + target.id + '"]');
        if (tc) tc.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      if (action === 'goto-codex') { if (onGotoCodexEntry && id) onGotoCodexEntry(id); return; }
      if (!q) return;
      if (action === 'toggle-quest') { expandedId = expandedId === q.id ? null : q.id; renderList(); return; }
      if (action === 'quest-up' || action === 'quest-down') { moveInGroup(q, action === 'quest-up' ? -1 : 1); persist(); renderList(); return; }
      if (action === 'delete-quest') {
        if (!global.confirm('Excluir "' + questLabel(q) + '"? Essa ação não pode ser desfeita.')) return;
        quests = quests.filter(function (it) { return it.id !== q.id; });
        quests.forEach(function (it) { it.prereqIds = it.prereqIds.filter(function (pid) { return pid !== q.id; }); });
        expandedId = null;
        persist(); renderList(); return;
      }
      if (action === 'prereq-remove') { q.prereqIds = q.prereqIds.filter(function (x) { return x !== id; }); persist(); renderList(); return; }
      if (action === 'codex-remove') { q.codexIds = q.codexIds.filter(function (x) { return x !== id; }); persist(); renderList(); return; }
      var i = Number(btn.getAttribute('data-i'));
      if (action === 'obj-add') {
        q.objectives.push(''); persist(); renderList();
        var inputs = listEl.querySelectorAll('[data-quest-card="' + q.id + '"] [data-objective-text]');
        if (inputs.length) inputs[inputs.length - 1].focus();
        return;
      }
      if (action === 'obj-remove') { q.objectives.splice(i, 1); persist(); renderList(); return; }
      if (action === 'obj-up' && i > 0) {
        var t1 = q.objectives[i - 1]; q.objectives[i - 1] = q.objectives[i]; q.objectives[i] = t1;
        persist(); renderList(); return;
      }
      if (action === 'obj-down' && i < q.objectives.length - 1) {
        var t2 = q.objectives[i + 1]; q.objectives[i + 1] = q.objectives[i]; q.objectives[i] = t2;
        persist(); renderList(); return;
      }
    });

    // Texto: salva a cada tecla sem re-render (manteria o foco de qualquer jeito, mas é desnecessário);
    // só o cabeçalho da quest é atualizado pra refletir título/"dada por".
    container.addEventListener('input', function (e) {
      var t = e.target;
      if (t.tagName === 'SELECT') return;
      var arcEl = t.closest('[data-arc]');
      if (t.hasAttribute('data-arc-field') && arcEl) {
        var arc = arcById(arcEl.getAttribute('data-arc'));
        if (!arc) return;
        arc[t.getAttribute('data-arc-field')] = t.value;
        persist(); return;
      }
      var cardEl = t.closest('[data-quest-card]');
      var q = cardEl && questById(cardEl.getAttribute('data-quest-card'));
      if (!q) return;
      if (t.hasAttribute('data-objective-text')) {
        q.objectives[Number(t.getAttribute('data-objective-text'))] = t.value;
        persist(); return;
      }
      var field = t.getAttribute('data-q-field');
      if (!field) return;
      q[field] = t.value;
      persist();
      if (field === 'title' || field === 'giver') refreshHead(cardEl, q);
    });

    container.addEventListener('change', function (e) {
      var t = e.target;
      if (t.tagName !== 'SELECT') {
        // Ao sair do nome de um arco, os rótulos de arco nos seletores das quests ficam desatualizados.
        // Adiado: o "change" dispara antes do foco ir pro próximo campo (Tab); assim renderList()
        // devolve o foco pra onde o usuário foi, não pro campo que ele acabou de deixar.
        if (t.getAttribute('data-arc-field') === 'name') setTimeout(renderList, 0);
        return;
      }
      var cardEl = t.closest('[data-quest-card]');
      var q = cardEl && questById(cardEl.getAttribute('data-quest-card'));
      if (!q) return;
      var add = t.getAttribute('data-q-add');
      if (add === 'prereq' && t.value) { if (q.prereqIds.indexOf(t.value) === -1) q.prereqIds.push(t.value); persist(); renderList(); return; }
      if (add === 'codex' && t.value) { if (q.codexIds.indexOf(t.value) === -1) q.codexIds.push(t.value); persist(); renderList(); return; }
      var field = t.getAttribute('data-q-field');
      if (!field) return;
      q[field] = field === 'arcId' ? (t.value || null) : t.value;
      if (field === 'arcId' && q.arcId) delete collapsedArcs[q.arcId];
      persist(); renderList();
    });

    renderList();
  }

  GDC.ui.questDesigner = { render: render, parseStored: parseStored };
}(window));
