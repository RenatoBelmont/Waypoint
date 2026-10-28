/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var root, kanbanState, callbacks, colorPalette;
  var editingId = null;
  var editDraft = null;
  var linkingId = null;
  var dragOverColumn = null;
  var draggingCardId = null; // card em arrasto (o quadro NÃO é re-renderizado enquanto isso)
  var trashPanelOpen = false;
  var toastTimer = null;
  // Modal "Nova Task"/"Editar Task" — cria E edita cards normais (marcos continuam usando o form
  // inline antigo, editFormMarkup/bindEditFormEvents, mais abaixo — ver o botão "editar" em
  // bindColumnEvents pra saber por que a bifurcação existe).
  var modalState = null;
  var filterPriority = null;
  var filterStage = null;

  var COLUMNS = [
    { id: 'backlog', label: 'Backlog' },
    { id: 'todo', label: 'A Fazer' },
    { id: 'doing', label: 'Em Desenvolvimento' },
    { id: 'review', label: 'Teste / Revisão' },
    { id: 'done', label: 'Concluído' },
  ];

  var PRIORITY_META = {
    baixa: { label: 'Baixa', color: '#10b981' },
    media: { label: 'Média', color: '#f59e0b' },
    alta: { label: 'Alta', color: '#f43f5e' },
  };

  // Tags permitidas na descrição rica de um card (toolbar: negrito/itálico/lista/lista numerada/
  // divisor) — tudo fora dessa lista é removido (mantendo o texto de dentro) ao salvar e ao
  // renderizar, tanto pro que vem do editor quanto pro que vier de um backup importado à mão.
  var RICH_TEXT_ALLOWED_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, UL: 1, OL: 1, LI: 1, HR: 1, BR: 1, DIV: 1, P: 1 };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'ck-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  function sanitizeRichText(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = String(html || '');
    (function clean(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 1) {
          if (!RICH_TEXT_ALLOWED_TAGS[child.tagName]) {
            while (child.firstChild) node.insertBefore(child.firstChild, child);
            node.removeChild(child);
            return;
          }
          Array.prototype.slice.call(child.attributes).forEach(function (a) { child.removeAttribute(a.name); });
          clean(child);
        } else if (child.nodeType !== 3) {
          node.removeChild(child);
        }
      });
    }(tmp));
    return tmp.innerHTML.trim();
  }

  /** Cor da borda esquerda do card: marcos continuam usando a cor manual (color swatches, antigo);
   *  cards normais agora seguem sempre a cor da etapa do projeto em que estão — automático, não é
   *  mais uma escolha manual (ver STAGE em data.js / modal "Etapa"). */
  function cardBorderColor(card) {
    if (card.isMilestone) return card.color || null;
    var stage = GDC.KANBAN_STAGE_MAP[card.stage];
    return stage ? stage.color : null;
  }

  function relativeDate(ts) {
    var diff = Date.now() - ts;
    var min = Math.floor(diff / 60000);
    if (min < 1) return 'agora mesmo';
    if (min < 60) return 'há ' + min + ' min';
    var hrs = Math.floor(min / 60);
    if (hrs < 24) return 'há ' + hrs + 'h';
    var days = Math.floor(hrs / 24);
    return 'há ' + days + ' dia' + (days > 1 ? 's' : '');
  }

  function cardsByColumn(col) {
    return kanbanState.cards.filter(function (c) {
      if (c.column !== col) return false;
      // Marcos ficam de fora dos filtros de prioridade/etapa — esses dois conceitos são de tarefa,
      // não fazem sentido pra um marco (objetivo do projeto).
      if (c.isMilestone) return true;
      if (filterPriority && c.priority !== filterPriority) return false;
      if (filterStage && c.stage !== filterStage) return false;
      return true;
    });
  }

  function priorityOptions(selected) {
    return ['baixa', 'media', 'alta'].map(function (p) {
      return '<option value="' + p + '" ' + (p === selected ? 'selected' : '') + '>' + PRIORITY_META[p].label + '</option>';
    }).join('');
  }

  function findMilestoneById(id) {
    if (!id) return null;
    var found = kanbanState.cards.filter(function (c) { return c.id === id && c.isMilestone; })[0];
    if (found) return { card: found, trashed: false };
    var trashedFound = kanbanState.trash.filter(function (c) { return c.id === id && c.isMilestone; })[0];
    if (trashedFound) return { card: trashedFound, trashed: true };
    return null;
  }

  function milestoneProgress(m) {
    var linked = kanbanState.cards.filter(function (c) { return !c.isMilestone && c.milestoneId === m.id; });
    if (linked.length === 0) return null;
    var done = linked.filter(function (c) { return c.column === 'done'; }).length;
    return { done: done, total: linked.length, pct: Math.round((done / linked.length) * 100) };
  }

  function ringMarkup(progress) {
    var size = 30, stroke = 3, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    if (!progress) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" class="milestone-ring milestone-ring-empty">' +
        '<circle cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r + '" fill="none" stroke="currentColor" stroke-width="' + stroke + '" stroke-dasharray="2 4" /></svg>';
    }
    var offset = c * (1 - progress.pct / 100);
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" class="milestone-ring">' +
      '<circle cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r + '" fill="none" class="milestone-ring-track" stroke-width="' + stroke + '" />' +
      '<circle cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r + '" fill="none" class="milestone-ring-fill" stroke-width="' + stroke +
      '" stroke-dasharray="' + c + '" stroke-dashoffset="' + offset + '" transform="rotate(-90 ' + (size / 2) + ' ' + (size / 2) + ')" stroke-linecap="round" /></svg>';
  }

  function linkedMilestoneBadge(card) {
    if (!card.milestoneId) return '';
    var info = findMilestoneById(card.milestoneId);
    if (!info) return '';
    var suffix = info.trashed ? ' (na lixeira)' : '';
    return '<span class="kanban-linked-badge">' + GDC.icon('link-2', { size: 11 }) + escapeHtml(info.card.title) + suffix + '</span>';
  }

  function colorSwatchesMarkup(selected) {
    var dots = colorPalette.map(function (hex) {
      return '<button type="button" class="kanban-color-swatch' + (selected === hex ? ' selected' : '') +
        '" data-color-swatch="' + hex + '" style="background-color:' + hex + '" title="' + hex + '"></button>';
    }).join('');
    return (
      '<div class="kanban-color-swatches">' + dots +
      '  <label class="kanban-color-custom" title="Cor personalizada"><input type="color" data-f="color-custom" value="' + (selected || '#94a3b8') + '" /></label>' +
      '  <button type="button" class="kanban-color-clear" data-color-swatch="" title="Remover cor">' + GDC.icon('x', { size: 12 }) + '</button>' +
      '</div>'
    );
  }

  var CHECKLIST_MAX_ITEMS = 10;
  var CHECKLIST_MAX_CHARS = 200;

  function checklistEditorMarkup(checklist) {
    var rows = checklist.map(function (t, i) {
      return (
        '<div class="kanban-checklist-row" data-checklist-row="' + i + '">' +
        '  <input type="checkbox" data-checklist-toggle="' + i + '" ' + (t.done ? 'checked' : '') + ' />' +
        '  <input type="text" class="input-field py-1 text-xs" maxlength="' + CHECKLIST_MAX_CHARS + '" data-checklist-text="' + i + '" value="' + escapeHtml(t.text) + '" placeholder="Subtarefa" />' +
        '  <button type="button" class="text-muted hover:text-rose-500" data-checklist-remove="' + i + '">' + GDC.icon('x', { size: 12 }) + '</button>' +
        '</div>'
      );
    }).join('');
    var addRowHtml = checklist.length >= CHECKLIST_MAX_ITEMS
      ? '<p class="kanban-checklist-limit">Limite de ' + CHECKLIST_MAX_ITEMS + ' itens atingido.</p>'
      : (
        '<div class="kanban-checklist-add">' +
        '    <input type="text" class="input-field py-1 text-xs" maxlength="' + CHECKLIST_MAX_CHARS + '" data-f="checklist-new" placeholder="Novo item (max ' + CHECKLIST_MAX_CHARS + ' chars)" />' +
        '    <button type="button" class="btn-ghost py-1 text-xs" data-action="add-checklist-item">' + GDC.icon('plus', { size: 12 }) + '</button>' +
        '  </div>'
      );
    return '<div class="kanban-checklist-editor">' + rows + addRowHtml + '</div>';
  }

  // ---------- Modal "Nova Task" / "Editar Task" ----------

  function stagePillsMarkup(selected) {
    var pills = GDC.KANBAN_STAGES.map(function (s) {
      var active = s.id === selected;
      var style = active
        ? 'background-color:' + s.color + ';border-color:' + s.color + ';color:#fff'
        : 'border-color:' + s.color + ';color:' + s.color;
      return '<button type="button" class="kanban-pill' + (active ? ' kanban-pill-active' : '') +
        '" data-stage-value="' + s.id + '" style="' + style + '">' + escapeHtml(s.label) + '</button>';
    }).join('');
    return '<div class="kanban-pill-row">' + pills + '</div>';
  }

  function priorityPillsMarkup(selected) {
    var pills = ['baixa', 'media', 'alta'].map(function (p) {
      var meta = PRIORITY_META[p];
      var active = p === selected;
      var style = active
        ? 'background-color:' + meta.color + ';border-color:' + meta.color + ';color:#fff'
        : 'border-color:' + meta.color + ';color:' + meta.color;
      return '<button type="button" class="kanban-pill' + (active ? ' kanban-pill-active' : '') +
        '" data-priority-value="' + p + '" style="' + style + '">' + escapeHtml(meta.label) + '</button>';
    }).join('');
    return '<div class="kanban-pill-row">' + pills + '</div>';
  }

  function categoryDropdownMarkup(draft) {
    var categories = kanbanState.categories || [];
    var selected = categories.filter(function (c) { return c.id === draft.categoryId; })[0];
    var open = modalState.categoryDropdownOpen;
    var optionsHtml = categories.map(function (c) {
      var isSelected = c.id === draft.categoryId;
      return (
        '<div class="kanban-category-option' + (isSelected ? ' selected' : '') + '" data-category-option="' + c.id + '">' +
        GDC.icon(c.icon, { size: 14 }) +
        '  <span class="flex-1 truncate">' + escapeHtml(c.name) + '</span>' +
        (isSelected ? GDC.icon('check', { size: 13 }) : '') +
        '  <button type="button" class="kanban-category-remove" data-category-remove="' + c.id + '" title="Remover categoria">' + GDC.icon('x', { size: 11 }) + '</button>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="kanban-category-dropdown' + (open ? ' open' : '') + '">' +
      '  <button type="button" class="input-field kanban-category-trigger" data-action="toggle-category-dropdown">' +
      (selected
        ? (GDC.icon(selected.icon, { size: 14 }) + '<span class="flex-1 truncate text-left">' + escapeHtml(selected.name) + '</span>')
        : '<span class="flex-1 truncate text-left text-muted">Selecione...</span>') +
      GDC.icon('chevron-down', { size: 13, className: open ? 'rotate-180' : '' }) +
      '  </button>' +
      (open ? (
        '<div class="kanban-category-menu">' +
        '  <div class="kanban-category-option' + (!draft.categoryId ? ' selected' : '') + '" data-category-option="">' +
        '    <span class="flex-1 truncate text-muted">Sem categoria</span>' +
        (!draft.categoryId ? GDC.icon('check', { size: 13 }) : '') +
        '  </div>' +
        optionsHtml +
        '  <div class="kanban-category-new">' +
        '    <input type="text" class="input-field py-1 text-xs" maxlength="40" data-f="new-category-name" placeholder="Nova categoria..." />' +
        '    <button type="button" class="btn-ghost py-1 text-xs" data-action="add-category">' + GDC.icon('plus', { size: 12 }) + '</button>' +
        '  </div>' +
        '</div>'
      ) : '') +
      '</div>'
    );
  }

  function coverImageMarkup(coverImageId) {
    return (
      '<div class="codex-image-field" data-cover-image-field>' +
      (coverImageId
        ? (
          '<div class="codex-image-thumb" data-image-thumb="' + coverImageId + '">' + GDC.icon('image', { size: 16 }) + '</div>' +
          '<div class="codex-image-actions">' +
          '  <label class="btn-ghost py-1 text-xs" title="Trocar imagem">' + GDC.icon('upload', { size: 12 }) + 'Trocar' +
          '    <input type="file" accept="image/*" class="hidden" data-cover-image-upload />' +
          '  </label>' +
          '  <button type="button" class="btn-ghost py-1 text-xs" data-action="remove-cover-image">' + GDC.icon('trash-2', { size: 12 }) + 'Remover</button>' +
          '</div>'
        )
        : (
          '<label class="codex-image-dropzone" data-cover-image-dropzone>' +
          GDC.icon('image', { size: 18 }) + '<span>Imagem de capa — clique ou arraste</span>' +
          '  <input type="file" accept="image/*" class="hidden" data-cover-image-upload />' +
          '</label>'
        )
      ) +
      '</div>'
    );
  }

  function richTextFieldMarkup(html) {
    return (
      '<div class="kanban-rte">' +
      '  <div class="kanban-rte-toolbar">' +
      '    <button type="button" class="kanban-rte-btn" data-rte-cmd="bold" title="Negrito">' + GDC.icon('bold', { size: 13 }) + '</button>' +
      '    <button type="button" class="kanban-rte-btn" data-rte-cmd="italic" title="Itálico">' + GDC.icon('italic', { size: 13 }) + '</button>' +
      '    <span class="kanban-rte-sep"></span>' +
      '    <button type="button" class="kanban-rte-btn" data-rte-cmd="insertUnorderedList" title="Lista">' + GDC.icon('list', { size: 13 }) + '</button>' +
      '    <button type="button" class="kanban-rte-btn" data-rte-cmd="insertOrderedList" title="Lista numerada">' + GDC.icon('list-ordered', { size: 13 }) + '</button>' +
      '    <button type="button" class="kanban-rte-btn" data-rte-cmd="insertHorizontalRule" title="Divisor">' + GDC.icon('minus', { size: 13 }) + '</button>' +
      '  </div>' +
      '  <div class="kanban-rte-editor input-field" contenteditable="true" data-rte="description" data-placeholder="Descrição curta e funcional...">' + html + '</div>' +
      '</div>'
    );
  }

  function defaultDraftFor(card, column) {
    if (!card) {
      return {
        title: '', descriptionHtml: '', priority: 'media', labels: [], color: null,
        checklist: [], isMilestone: false, stage: 'idea', categoryId: null, coverImageId: null,
        column: column,
      };
    }
    return {
      title: card.title, descriptionHtml: sanitizeRichText(card.description || ''),
      priority: card.priority, labels: card.labels.slice(), color: card.color,
      checklist: card.checklist.map(function (t) { return Object.assign({}, t); }),
      isMilestone: card.isMilestone, stage: card.stage || 'idea', categoryId: card.categoryId,
      coverImageId: card.coverImageId, column: card.column,
    };
  }

  function modalMarkup() {
    var s = modalState;
    var d = s.draft;
    var isMilestone = d.isMilestone;
    return (
      '<div class="kanban-modal-overlay" data-modal-overlay>' +
      '  <div class="kanban-modal-panel card-surface" data-modal-panel>' +
      '    <div class="kanban-modal-header">' +
      '      <h3 class="font-display text-base font-bold text-primary">' + (s.mode === 'create' ? 'Nova Task' : 'Editar Task') + '</h3>' +
      '      <button type="button" class="kanban-icon-btn" data-action="close-modal" title="Fechar">' + GDC.icon('x', { size: 16 }) + '</button>' +
      '    </div>' +
      '    <div class="kanban-modal-body">' +
      '      <div class="kanban-modal-field">' +
      '        <label class="kanban-modal-label">Título</label>' +
      '        <input type="text" class="input-field" data-f="title" placeholder="Ex: Criar sistema de inventário" value="' + escapeHtml(d.title) + '" />' +
      '      </div>' +
      (s.mode === 'create' ? (
        '      <label class="kanban-compose-milestone">' +
        '        <input type="checkbox" data-f="is-milestone" ' + (isMilestone ? 'checked' : '') + ' />' +
        GDC.icon('flag', { size: 12 }) + 'Marcar como marco' +
        '      </label>'
      ) : '') +
      '      <div class="kanban-modal-field">' +
      '        <label class="kanban-modal-label">Descrição</label>' +
      richTextFieldMarkup(d.descriptionHtml) +
      '      </div>' +
      (isMilestone ? (
        '      <div class="kanban-modal-field">' +
        '        <label class="kanban-modal-label">Cor</label>' +
        colorSwatchesMarkup(d.color) +
        '      </div>'
      ) : (
        '      <div class="kanban-modal-field">' +
        '        <label class="kanban-modal-label">Checklist (' + d.checklist.length + '/' + CHECKLIST_MAX_ITEMS + ')</label>' +
        checklistEditorMarkup(d.checklist) +
        '      </div>' +
        '      <div class="kanban-modal-field">' +
        '        <label class="kanban-modal-label">Categoria</label>' +
        categoryDropdownMarkup(d) +
        '      </div>' +
        '      <div class="kanban-modal-field">' +
        '        <label class="kanban-modal-label">Etapa</label>' +
        stagePillsMarkup(d.stage) +
        '      </div>' +
        '      <div class="kanban-modal-field">' +
        '        <label class="kanban-modal-label">Prioridade</label>' +
        priorityPillsMarkup(d.priority) +
        '      </div>' +
        '      <div class="kanban-modal-field">' +
        '        <label class="kanban-modal-label">Etiquetas</label>' +
        '        <input type="text" class="input-field py-1.5 text-xs" data-f="labels" placeholder="Separadas por vírgula" value="' + escapeHtml(d.labels.join(', ')) + '" />' +
        '      </div>' +
        '      <div class="kanban-modal-field">' +
        '        <label class="kanban-modal-label">Imagem de capa</label>' +
        coverImageMarkup(d.coverImageId) +
        '      </div>'
      )) +
      '    </div>' +
      '    <div class="kanban-modal-footer">' +
      '      <button type="button" class="btn-ghost" data-action="cancel-modal">Cancelar</button>' +
      '      <button type="button" class="btn-primary" data-action="save-modal">Salvar</button>' +
      '    </div>' +
      '  </div>' +
      '</div>'
    );
  }

  function openModal(mode, card, column) {
    modalState = { mode: mode, cardId: card ? card.id : null, draft: defaultDraftFor(card, column), categoryDropdownOpen: false };
    renderModal();
  }

  function closeModal() {
    modalState = null;
    renderModal();
  }

  function renderModal() {
    var modalRoot = root.querySelector('#kanban-modal-root');
    if (!modalRoot) return;
    if (!modalState) { modalRoot.innerHTML = ''; return; }
    modalRoot.innerHTML = modalMarkup();
    if (GDC.imageStore) GDC.imageStore.resolveThumbs(modalRoot);
    bindModalEvents(modalRoot);
    var titleInput = modalRoot.querySelector('[data-f="title"]');
    if (titleInput && !titleInput.value) titleInput.focus();
  }

  function bindModalEvents(modalRoot) {
    var d = modalState.draft;

    var overlay = modalRoot.querySelector('[data-modal-overlay]');
    if (overlay) overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeModal(); });

    var closeBtn = modalRoot.querySelector('[data-action="close-modal"]');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    var cancelBtn = modalRoot.querySelector('[data-action="cancel-modal"]');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    var titleEl = modalRoot.querySelector('[data-f="title"]');
    if (titleEl) titleEl.addEventListener('input', function (e) { d.title = e.target.value; });

    var milestoneEl = modalRoot.querySelector('[data-f="is-milestone"]');
    if (milestoneEl) milestoneEl.addEventListener('change', function (e) { d.isMilestone = e.target.checked; renderModal(); });

    var rteEl = modalRoot.querySelector('[data-rte="description"]');
    if (rteEl) {
      rteEl.addEventListener('input', function () { d.descriptionHtml = rteEl.innerHTML; });
      modalRoot.querySelectorAll('[data-rte-cmd]').forEach(function (btn) {
        btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
        btn.addEventListener('click', function () {
          document.execCommand(btn.getAttribute('data-rte-cmd'), false, null);
          rteEl.focus();
          d.descriptionHtml = rteEl.innerHTML;
        });
      });
    }

    modalRoot.querySelectorAll('[data-checklist-toggle]').forEach(function (chk) {
      chk.addEventListener('change', function (e) {
        d.checklist[Number(chk.getAttribute('data-checklist-toggle'))].done = e.target.checked;
      });
    });
    modalRoot.querySelectorAll('[data-checklist-text]').forEach(function (txt) {
      txt.addEventListener('input', function (e) {
        d.checklist[Number(txt.getAttribute('data-checklist-text'))].text = e.target.value.slice(0, CHECKLIST_MAX_CHARS);
      });
    });
    modalRoot.querySelectorAll('[data-checklist-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        d.checklist.splice(Number(btn.getAttribute('data-checklist-remove')), 1);
        renderModal();
      });
    });
    var addChecklistBtn = modalRoot.querySelector('[data-action="add-checklist-item"]');
    if (addChecklistBtn) addChecklistBtn.addEventListener('click', function () {
      var input = modalRoot.querySelector('[data-f="checklist-new"]');
      var text = input ? input.value.trim().slice(0, CHECKLIST_MAX_CHARS) : '';
      if (!text || d.checklist.length >= CHECKLIST_MAX_ITEMS) return;
      d.checklist.push({ id: uid(), text: text, done: false });
      renderModal();
    });

    var catToggle = modalRoot.querySelector('[data-action="toggle-category-dropdown"]');
    if (catToggle) catToggle.addEventListener('click', function () {
      modalState.categoryDropdownOpen = !modalState.categoryDropdownOpen;
      renderModal();
    });
    modalRoot.querySelectorAll('[data-category-option]').forEach(function (opt) {
      opt.addEventListener('click', function () {
        d.categoryId = opt.getAttribute('data-category-option') || null;
        modalState.categoryDropdownOpen = false;
        renderModal();
      });
    });
    modalRoot.querySelectorAll('[data-category-remove]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-category-remove');
        if (!global.confirm('Remover esta categoria? Cards que a usam ficam sem categoria.')) return;
        if (d.categoryId === id) d.categoryId = null;
        if (callbacks.onDeleteCategory) callbacks.onDeleteCategory(id);
        renderModal();
      });
    });
    var addCatBtn = modalRoot.querySelector('[data-action="add-category"]');
    if (addCatBtn) addCatBtn.addEventListener('click', function () {
      var input = modalRoot.querySelector('[data-f="new-category-name"]');
      var name = input ? input.value.trim() : '';
      if (!name) return;
      var created = callbacks.onAddCategory ? callbacks.onAddCategory({ id: uid(), name: name, icon: 'tag' }) : null;
      if (created) d.categoryId = created.id;
      modalState.categoryDropdownOpen = false;
      renderModal();
    });

    modalRoot.querySelectorAll('[data-stage-value]').forEach(function (btn) {
      btn.addEventListener('click', function () { d.stage = btn.getAttribute('data-stage-value'); renderModal(); });
    });
    modalRoot.querySelectorAll('[data-priority-value]').forEach(function (btn) {
      btn.addEventListener('click', function () { d.priority = btn.getAttribute('data-priority-value'); renderModal(); });
    });

    var labelsEl = modalRoot.querySelector('[data-f="labels"]');
    if (labelsEl) labelsEl.addEventListener('input', function (e) {
      d.labels = e.target.value.split(',').map(function (l) { return l.trim(); }).filter(Boolean);
    });

    modalRoot.querySelectorAll('[data-color-swatch]').forEach(function (btn) {
      btn.addEventListener('click', function () { d.color = btn.getAttribute('data-color-swatch') || null; renderModal(); });
    });
    var colorCustomEl = modalRoot.querySelector('[data-f="color-custom"]');
    if (colorCustomEl) colorCustomEl.addEventListener('input', function (e) { d.color = e.target.value; });

    var coverUpload = modalRoot.querySelector('[data-cover-image-upload]');
    if (coverUpload) coverUpload.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file || !GDC.imageStore) return;
      GDC.imageStore.put(file).then(function (meta) { d.coverImageId = meta.id; renderModal(); });
    });
    var removeCoverBtn = modalRoot.querySelector('[data-action="remove-cover-image"]');
    if (removeCoverBtn) removeCoverBtn.addEventListener('click', function () { d.coverImageId = null; renderModal(); });

    var saveBtn = modalRoot.querySelector('[data-action="save-modal"]');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      if (!d.title.trim()) return;
      var description = sanitizeRichText(rteEl ? rteEl.innerHTML : d.descriptionHtml);
      if (d.isMilestone) {
        if (modalState.mode === 'create') {
          if (callbacks.onAddCard) callbacks.onAddCard({ column: d.column, title: d.title.trim(), description: description, isMilestone: true, color: d.color || null });
        } else if (callbacks.onUpdateCard) {
          callbacks.onUpdateCard(modalState.cardId, { title: d.title.trim(), description: description, color: d.color || null });
        }
      } else {
        var payload = {
          title: d.title.trim(), description: description, priority: d.priority,
          labels: d.labels, checklist: d.checklist.filter(function (t) { return t.text.trim(); }),
          stage: d.stage, categoryId: d.categoryId, coverImageId: d.coverImageId,
        };
        if (modalState.mode === 'create') {
          payload.column = d.column;
          payload.isMilestone = false;
          if (callbacks.onAddCard) callbacks.onAddCard(payload);
        } else if (callbacks.onUpdateCard) {
          callbacks.onUpdateCard(modalState.cardId, payload);
        }
      }
      closeModal();
      render();
    });
  }

  function milestoneOptionsMarkup(selectedId, ownCardId) {
    var active = kanbanState.cards.filter(function (c) { return c.isMilestone && c.id !== ownCardId; });
    var html = '<option value="">Nenhum</option>';
    html += active.map(function (m) {
      return '<option value="' + m.id + '" ' + (m.id === selectedId ? 'selected' : '') + '>' + escapeHtml(m.title) + '</option>';
    }).join('');
    if (selectedId && !active.some(function (m) { return m.id === selectedId; })) {
      var info = findMilestoneById(selectedId);
      var label = info ? escapeHtml(info.card.title) + ' (na lixeira)' : 'Marco removido';
      html += '<option value="' + selectedId + '" selected disabled>' + label + '</option>';
    }
    return html;
  }

  function editFormMarkup(card) {
    var d = editDraft;
    var extraFieldsHtml = '';
    if (!card.isMilestone) {
      extraFieldsHtml =
        '<div class="flex items-center gap-2">' +
        '  <select class="input-field py-1.5 text-xs" data-f="priority">' + priorityOptions(d.priority) + '</select>' +
        '</div>' +
        '<input class="input-field py-1.5 text-xs" data-f="labels" placeholder="Etiquetas separadas por vírgula" value="' + escapeHtml(d.labels.join(', ')) + '" />';
    }
    var checklistFieldHtml = card.isMilestone ? '' : (
      '<div>' +
      '  <label class="mb-1 block text-xs text-muted">Subtarefas</label>' +
      checklistEditorMarkup(d.checklist) +
      '</div>'
    );
    return (
      '<div class="space-y-2" data-edit-form="' + card.id + '">' +
      (card.isMilestone ? '<div class="kanban-milestone-edit-tag">' + GDC.icon('flag', { size: 12 }) + 'Marco</div>' : '') +
      '  <input class="input-field py-1.5 text-xs" data-f="title" placeholder="Título" value="' + escapeHtml(d.title) + '" />' +
      '  <textarea class="input-field py-1.5 text-xs" rows="2" data-f="description" placeholder="' +
      (card.isMilestone ? 'Por que esse marco importa (opcional)' : 'Descrição (opcional)') + '">' + escapeHtml(d.description) + '</textarea>' +
      extraFieldsHtml +
      '  <div>' +
      '    <label class="mb-1 block text-xs text-muted">Cor</label>' +
      colorSwatchesMarkup(d.color) +
      '  </div>' +
      checklistFieldHtml +
      (card.isMilestone ? '' : '<p class="kanban-edit-hint">Use o ' + GDC.icon('link-2', { size: 11 }) + ' no card para vincular a um marco.</p>') +
      '  <div class="flex items-center gap-2">' +
      '    <button type="button" class="btn-primary flex-1 py-1.5 text-xs" data-action="save-edit">Salvar</button>' +
      '    <button type="button" class="btn-ghost py-1.5 text-xs" data-action="cancel-edit">Cancelar</button>' +
      '  </div>' +
      '</div>'
    );
  }

  function quickLinkPanelMarkup(card) {
    return (
      '<div class="kanban-quicklink-panel" data-quicklink-panel="' + card.id + '">' +
      '  <label class="kanban-quicklink-label">' + GDC.icon('link-2', { size: 12 }) + 'Vincular a um marco</label>' +
      '  <div class="flex items-center gap-2">' +
      '    <select class="input-field py-1.5 text-xs" data-quicklink-select>' + milestoneOptionsMarkup(card.milestoneId, card.id) + '</select>' +
      '    <button type="button" class="kanban-icon-btn" data-action="close-quicklink" title="Fechar">' + GDC.icon('x', { size: 13 }) + '</button>' +
      '  </div>' +
      '</div>'
    );
  }

  function milestoneLinkPanelMarkup(milestone) {
    var candidates = kanbanState.cards.filter(function (c) { return !c.isMilestone; });
    var rows = candidates.length === 0
      ? '<p class="kanban-quicklink-empty">Nenhuma tarefa no board ainda. Crie um card em alguma coluna primeiro.</p>'
      : candidates.map(function (c) {
        var checked = c.milestoneId === milestone.id;
        var otherInfo = (!checked && c.milestoneId) ? findMilestoneById(c.milestoneId) : null;
        var otherNote = otherInfo ? ' <span class="kanban-quicklink-other">(em "' + escapeHtml(otherInfo.card.title) + '")</span>' : '';
        return (
          '<label class="kanban-quicklink-row">' +
          '  <input type="checkbox" data-quicklink-card="' + c.id + '" ' + (checked ? 'checked' : '') + ' />' +
          '  <span class="truncate">' + escapeHtml(c.title) + '</span>' + otherNote +
          '</label>'
        );
      }).join('');
    return (
      '<div class="kanban-quicklink-panel" data-quicklink-panel="' + milestone.id + '">' +
      '  <label class="kanban-quicklink-label">' + GDC.icon('link-2', { size: 12 }) + 'Vincular tarefas a este marco</label>' +
      '  <div class="kanban-quicklink-list">' + rows + '</div>' +
      '  <button type="button" class="btn-ghost py-1 text-xs" data-action="close-quicklink">Fechar</button>' +
      '</div>'
    );
  }

  function linkPanelMarkup(card) {
    return card.isMilestone ? milestoneLinkPanelMarkup(card) : quickLinkPanelMarkup(card);
  }

  function milestoneCardViewMarkup(card) {
    var progress = milestoneProgress(card);
    var ring = ringMarkup(progress);
    var progressLabel = progress ? (progress.done + ' de ' + progress.total + ' tarefas concluídas') : 'Sem tarefas vinculadas ainda';
    return (
      '<div class="kanban-card-top">' +
      '  <div class="flex flex-1 items-center gap-1.5 min-w-0">' +
      GDC.icon('flag', { size: 13, className: 'text-amber-400 flex-shrink-0' }) +
      '    <span class="flex-1 truncate text-sm font-semibold text-primary">' + escapeHtml(card.title) + '</span>' +
      '  </div>' +
      '  <div class="flex flex-shrink-0 items-center gap-1">' +
      '    <button type="button" class="kanban-icon-btn" data-action="edit" title="Editar">' + GDC.icon('pencil', { size: 13 }) + '</button>' +
      '    <button type="button" class="kanban-icon-btn' + (progress ? ' kanban-icon-btn-active' : '') + '" data-action="toggle-link" title="Vincular tarefas">' + GDC.icon('link-2', { size: 13 }) + '</button>' +
      GDC.icon('grip-vertical', { size: 14, className: 'text-muted' }) +
      '    <button type="button" class="kanban-icon-btn kanban-icon-btn-danger" data-action="delete" title="Excluir">' + GDC.icon('trash-2', { size: 14 }) + '</button>' +
      '  </div>' +
      '</div>' +
      (card.description ? '<p class="text-xs leading-relaxed text-muted">' + escapeHtml(card.description) + '</p>' : '') +
      '<div class="mt-1 flex items-center gap-2.5">' + ring + '<span class="text-xs text-muted">' + progressLabel + '</span></div>'
    );
  }

  function cardViewMarkup(card) {
    if (card.isMilestone) return milestoneCardViewMarkup(card);
    var labelsHtml = card.labels.map(function (l) {
      return '<span class="kanban-label-badge">' + escapeHtml(l) + '</span>';
    }).join('');
    var meta = PRIORITY_META[card.priority] || PRIORITY_META.media;
    var stageMeta = GDC.KANBAN_STAGE_MAP[card.stage] || GDC.KANBAN_STAGE_MAP.idea;
    var category = (kanbanState.categories || []).filter(function (c) { return c.id === card.categoryId; })[0];
    var checklistDone = card.checklist.filter(function (t) { return t.done; }).length;
    var checklistHtml = card.checklist.length
      ? '<span class="kanban-checklist-badge">' + GDC.icon('check', { size: 11 }) + checklistDone + '/' + card.checklist.length + '</span>'
      : '';
    var linkedHtml = linkedMilestoneBadge(card);
    var coverHtml = card.coverImageId ? '<div class="kanban-card-cover" data-image-thumb="' + card.coverImageId + '"></div>' : '';
    var descHtml = card.description ? '<div class="kanban-card-desc">' + sanitizeRichText(card.description) + '</div>' : '';
    return (
      coverHtml +
      '<div class="kanban-card-top">' +
      '  <span class="flex-1 truncate text-sm font-medium text-primary">' + escapeHtml(card.title) + '</span>' +
      '  <div class="flex flex-shrink-0 items-center gap-1">' +
      '    <button type="button" class="kanban-icon-btn" data-action="edit" title="Editar">' + GDC.icon('pencil', { size: 13 }) + '</button>' +
      '    <button type="button" class="kanban-icon-btn' + (card.milestoneId ? ' kanban-icon-btn-active' : '') + '" data-action="toggle-link" title="Vincular a marco">' + GDC.icon('link-2', { size: 13 }) + '</button>' +
      GDC.icon('grip-vertical', { size: 14, className: 'text-muted' }) +
      '    <button type="button" class="kanban-icon-btn kanban-icon-btn-danger" data-action="delete" title="Excluir">' + GDC.icon('trash-2', { size: 14 }) + '</button>' +
      '  </div>' +
      '</div>' +
      descHtml +
      '<div class="flex flex-wrap items-center gap-1.5">' +
      '  <span class="kanban-priority-badge" style="background-color:' + meta.color + '20;color:' + meta.color + '">' + meta.label + '</span>' +
      '  <span class="kanban-stage-badge" style="background-color:' + stageMeta.color + '20;color:' + stageMeta.color + '">' + escapeHtml(stageMeta.label) + '</span>' +
      (category ? '<span class="kanban-category-badge">' + GDC.icon(category.icon, { size: 10 }) + escapeHtml(category.name) + '</span>' : '') +
      checklistHtml +
      labelsHtml +
      '</div>' +
      (linkedHtml ? '<div>' + linkedHtml + '</div>' : '')
    );
  }

  function columnMarkup(col) {
    var cards = cardsByColumn(col.id);
    var cardsHtml = cards.map(function (card) {
      var isEditing = editingId === card.id;
      var isLinking = linkingId === card.id;
      var borderColor = cardBorderColor(card);
      var classes = 'kanban-card' + (card.isMilestone ? ' kanban-card-milestone' : '') + (borderColor ? ' kanban-card-colored' : '');
      var style = borderColor ? ' style="border-left-color:' + borderColor + '"' : '';
      return (
        '<div class="' + classes + '" draggable="' + (isEditing || isLinking ? 'false' : 'true') + '" data-card="' + card.id + '"' + style + '>' +
        (isEditing ? editFormMarkup(card) : cardViewMarkup(card)) +
        (isLinking && !isEditing ? linkPanelMarkup(card) : '') +
        '</div>'
      );
    }).join('');

    return (
      '<div class="kanban-column' + (dragOverColumn === col.id ? ' drag-over' : '') + '" data-column="' + col.id + '">' +
      '  <div class="kanban-column-header">' +
      '    <h3 class="font-display text-xs font-semibold uppercase tracking-wide text-secondary">' + escapeHtml(col.label) + '</h3>' +
      '    <span class="text-xs text-muted">' + cards.length + '</span>' +
      '  </div>' +
      '  <div class="kanban-cards">' + cardsHtml + '</div>' +
      '  <button type="button" class="kanban-add-btn" data-action="start-compose">' + GDC.icon('plus', { size: 14 }) + 'Novo card</button>' +
      '</div>'
    );
  }

  function render() {
    var boardEl = root.querySelector('#gdc-kanban-board');
    boardEl.innerHTML = COLUMNS.map(columnMarkup).join('');
    if (GDC.imageStore) GDC.imageStore.resolveThumbs(boardEl);
    bindColumnEvents();
  }

  function renderTrashPanel() {
    var countEl = root.querySelector('#kanban-trash-count');
    var trash = kanbanState.trash;
    if (countEl) countEl.textContent = trash.length ? ' (' + trash.length + ')' : '';

    var panelEl = root.querySelector('#kanban-trash-panel');
    if (!panelEl) return;
    if (!trashPanelOpen) { panelEl.style.display = 'none'; return; }
    panelEl.style.display = 'block';

    if (trash.length === 0) {
      panelEl.innerHTML = '<p class="kanban-trash-empty">A lixeira está vazia.</p>';
      return;
    }

    var sorted = trash.slice().sort(function (a, b) { return b.deletedAt - a.deletedAt; });
    var itemsHtml = sorted.map(function (c) {
      return (
        '<div class="kanban-trash-item">' +
        '  <div class="flex min-w-0 flex-1 items-center gap-1.5">' +
        (c.isMilestone ? GDC.icon('flag', { size: 12, className: 'text-amber-400 flex-shrink-0' }) : '') +
        '    <span class="kanban-trash-item-title">' + escapeHtml(c.title) + '</span>' +
        '    <span class="kanban-trash-item-date">' + relativeDate(c.deletedAt) + '</span>' +
        '  </div>' +
        '  <div class="flex flex-shrink-0 items-center gap-2">' +
        '    <button type="button" class="btn-ghost py-1 text-xs" data-trash-restore="' + c.id + '">' + GDC.icon('undo-2', { size: 12 }) + 'Restaurar</button>' +
        '    <button type="button" class="text-muted hover:text-rose-500" data-trash-delete="' + c.id + '" title="Excluir definitivamente">' + GDC.icon('trash-2', { size: 14 }) + '</button>' +
        '  </div>' +
        '</div>'
      );
    }).join('');

    panelEl.innerHTML =
      '<div class="kanban-trash-header">' +
      '  <span class="text-xs text-muted">' + trash.length + ' item(ns) na lixeira — removidos automaticamente após ' + GDC.TRASH_RETENTION_DAYS + ' dias</span>' +
      '  <button type="button" class="btn-ghost py-1 text-xs" data-trash-empty>' + GDC.icon('trash-2', { size: 12 }) + 'Esvaziar lixeira</button>' +
      '</div>' +
      '<div class="kanban-trash-list">' + itemsHtml + '</div>';

    panelEl.querySelectorAll('[data-trash-restore]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-trash-restore');
        if (callbacks.onRestoreCard) callbacks.onRestoreCard(id);
        renderTrashPanel();
        render();
      });
    });
    panelEl.querySelectorAll('[data-trash-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-trash-delete');
        if (!global.confirm('Excluir definitivamente este item? Essa ação não pode ser desfeita.')) return;
        if (callbacks.onDeleteForever) callbacks.onDeleteForever(id);
        renderTrashPanel();
        render();
      });
    });
    var emptyBtn = panelEl.querySelector('[data-trash-empty]');
    if (emptyBtn) emptyBtn.addEventListener('click', function () {
      if (callbacks.onEmptyTrash) callbacks.onEmptyTrash();
      renderTrashPanel();
      render();
    });
  }

  function showUndoToast(card) {
    var toastEl = root.querySelector('#kanban-toast');
    if (!toastEl) return;
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.querySelector('#kanban-toast-text').textContent = 'Card removido — "' + card.title + '"';
    toastEl.setAttribute('data-trash-id', card.id);
    toastEl.style.display = 'flex';
    toastTimer = setTimeout(function () { toastEl.style.display = 'none'; }, 6000);
  }

  function bindColumnEvents() {
    var boardEl = root.querySelector('#gdc-kanban-board');

    boardEl.querySelectorAll('[data-column]').forEach(function (colEl) {
      var colId = colEl.getAttribute('data-column');

      // Destaque da coluna SEM re-render: reconstruir o quadro no meio do arrasto destrói o card que
      // está sendo arrastado — o navegador cancela o drag e o cursor fica piscando no "proibido".
      var setOver = function (id) {
        dragOverColumn = id;
        boardEl.querySelectorAll('[data-column]').forEach(function (c) { c.classList.toggle('drag-over', c.getAttribute('data-column') === id); });
      };
      colEl.addEventListener('dragover', function (e) {
        if (!draggingCardId) return; // arquivo arrastado de fora etc.
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        if (dragOverColumn !== colId) setOver(colId);
      });
      colEl.addEventListener('dragleave', function (e) {
        if (e.relatedTarget && colEl.contains(e.relatedTarget)) return;
        if (dragOverColumn === colId) setOver(null);
      });
      colEl.addEventListener('drop', function (e) {
        if (!draggingCardId) return;
        e.preventDefault();
        var id = draggingCardId || e.dataTransfer.getData('text/plain');
        draggingCardId = null;
        dragOverColumn = null;
        if (id && callbacks.onMoveCard) callbacks.onMoveCard(id, colId);
        render();
      });

      var addBtn = colEl.querySelector('[data-action="start-compose"]');
      if (addBtn) addBtn.addEventListener('click', function () {
        openModal('create', null, colId);
      });

      colEl.querySelectorAll('[data-card]').forEach(function (cardEl) {
        var cardId = cardEl.getAttribute('data-card');
        var card = kanbanState.cards.filter(function (c) { return c.id === cardId; })[0];
        if (!card) return;

        if (editingId === cardId) {
          bindEditFormEvents(cardEl, card);
        } else {
          cardEl.addEventListener('dragstart', function (e) {
            draggingCardId = cardId;
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', cardId); } catch (err) { /* alguns navegadores restringem */ }
            setTimeout(function () { cardEl.classList.add('kanban-card-dragging'); }, 0);
          });
          cardEl.addEventListener('dragend', function () {
            cardEl.classList.remove('kanban-card-dragging');
            if (draggingCardId === cardId) draggingCardId = null;
            if (dragOverColumn) { dragOverColumn = null; boardEl.querySelectorAll('.drag-over').forEach(function (c) { c.classList.remove('drag-over'); }); }
          });
          var editBtn = cardEl.querySelector('[data-action="edit"]');
          if (editBtn) editBtn.addEventListener('click', function () {
            // Marcos continuam com o form de edição inline (mais simples: só título/descrição/cor);
            // cards normais agora abrem o modal completo, com etapa/categoria/checklist/imagem.
            if (card.isMilestone) {
              editingId = cardId;
              editDraft = {
                title: card.title,
                description: card.description,
                priority: card.priority,
                labels: card.labels.slice(),
                color: card.color,
                checklist: card.checklist.map(function (t) { return Object.assign({}, t); }),
                milestoneId: card.milestoneId,
              };
              render();
            } else {
              openModal('edit', card, card.column);
            }
          });
          var delBtn = cardEl.querySelector('[data-action="delete"]');
          if (delBtn) delBtn.addEventListener('click', function () {
            if (callbacks.onDeleteCard) {
              var deletedCard = callbacks.onDeleteCard(cardId);
              if (deletedCard) showUndoToast(deletedCard);
            }
            renderTrashPanel();
            render();
          });
          var linkBtn = cardEl.querySelector('[data-action="toggle-link"]');
          if (linkBtn) linkBtn.addEventListener('click', function () {
            linkingId = linkingId === cardId ? null : cardId;
            render();
          });
        }

        if (linkingId === cardId) {
          var panelEl = cardEl.querySelector('[data-quicklink-panel]');
          if (panelEl) {
            var quickSelect = panelEl.querySelector('[data-quicklink-select]');
            if (quickSelect) {
              quickSelect.addEventListener('change', function (e) {
                if (callbacks.onUpdateCard) callbacks.onUpdateCard(cardId, { milestoneId: e.target.value || null });
                linkingId = null;
                render();
              });
            }
            panelEl.querySelectorAll('[data-quicklink-card]').forEach(function (chk) {
              chk.addEventListener('change', function (e) {
                var linkedCardId = chk.getAttribute('data-quicklink-card');
                if (callbacks.onUpdateCard) callbacks.onUpdateCard(linkedCardId, { milestoneId: e.target.checked ? cardId : null });
                render();
              });
            });
            var closeBtn = panelEl.querySelector('[data-action="close-quicklink"]');
            if (closeBtn) closeBtn.addEventListener('click', function () {
              linkingId = null;
              render();
            });
          }
        }
      });
    });
  }

  function bindEditFormEvents(cardEl, card) {
    var titleEl = cardEl.querySelector('[data-f="title"]');
    var descEl = cardEl.querySelector('[data-f="description"]');
    var prioEl = cardEl.querySelector('[data-f="priority"]');
    var labelsEl = cardEl.querySelector('[data-f="labels"]');
    var milestoneSelectEl = cardEl.querySelector('[data-f="milestoneId"]');
    var colorCustomEl = cardEl.querySelector('[data-f="color-custom"]');

    if (titleEl) titleEl.addEventListener('input', function (e) { editDraft.title = e.target.value; });
    if (descEl) descEl.addEventListener('input', function (e) { editDraft.description = e.target.value; });
    if (prioEl) prioEl.addEventListener('change', function (e) { editDraft.priority = e.target.value; });
    if (labelsEl) labelsEl.addEventListener('input', function (e) {
      editDraft.labels = e.target.value.split(',').map(function (l) { return l.trim(); }).filter(Boolean);
    });
    if (milestoneSelectEl) milestoneSelectEl.addEventListener('change', function (e) { editDraft.milestoneId = e.target.value || null; });
    if (colorCustomEl) colorCustomEl.addEventListener('input', function (e) { editDraft.color = e.target.value; });

    cardEl.querySelectorAll('[data-color-swatch]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var hex = btn.getAttribute('data-color-swatch');
        editDraft.color = hex || null;
        render();
      });
    });

    cardEl.querySelectorAll('[data-checklist-toggle]').forEach(function (chk) {
      chk.addEventListener('change', function (e) {
        var i = Number(chk.getAttribute('data-checklist-toggle'));
        editDraft.checklist[i].done = e.target.checked;
      });
    });
    cardEl.querySelectorAll('[data-checklist-text]').forEach(function (txt) {
      txt.addEventListener('input', function (e) {
        var i = Number(txt.getAttribute('data-checklist-text'));
        editDraft.checklist[i].text = e.target.value;
      });
    });
    cardEl.querySelectorAll('[data-checklist-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = Number(btn.getAttribute('data-checklist-remove'));
        editDraft.checklist.splice(i, 1);
        render();
      });
    });
    var addChecklistBtn = cardEl.querySelector('[data-action="add-checklist-item"]');
    if (addChecklistBtn) addChecklistBtn.addEventListener('click', function () {
      var input = cardEl.querySelector('[data-f="checklist-new"]');
      var text = input ? input.value.trim() : '';
      if (!text) return;
      editDraft.checklist.push({ id: uid(), text: text, done: false });
      render();
    });

    var saveBtn = cardEl.querySelector('[data-action="save-edit"]');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      if (!editDraft.title.trim()) return;
      var patch = {
        title: editDraft.title.trim(),
        description: editDraft.description.trim(),
        color: editDraft.color || null,
      };
      if (!card.isMilestone) {
        patch.priority = editDraft.priority;
        patch.labels = editDraft.labels;
        patch.checklist = editDraft.checklist
          .filter(function (t) { return t.text.trim(); })
          .map(function (t) { return { id: t.id, text: t.text.trim(), done: t.done }; });
        patch.milestoneId = editDraft.milestoneId || null;
      }
      if (callbacks.onUpdateCard) callbacks.onUpdateCard(card.id, patch);
      editingId = null;
      editDraft = null;
      render();
    });
    var cancelBtn = cardEl.querySelector('[data-action="cancel-edit"]');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      editingId = null;
      editDraft = null;
      render();
    });
  }

  function filtersBarMarkup() {
    var stageOptions = '<option value="">Todas as etapas</option>' + GDC.KANBAN_STAGES.map(function (s) {
      return '<option value="' + s.id + '"' + (filterStage === s.id ? ' selected' : '') + '>' + escapeHtml(s.label) + '</option>';
    }).join('');
    var priorityOptionsHtml = '<option value="">Todas as prioridades</option>' + ['baixa', 'media', 'alta'].map(function (p) {
      return '<option value="' + p + '"' + (filterPriority === p ? ' selected' : '') + '>' + PRIORITY_META[p].label + '</option>';
    }).join('');
    var active = filterPriority || filterStage;
    return (
      '<div class="kanban-filters-bar" id="kanban-filters-bar">' +
      GDC.icon('filter', { size: 13, className: 'text-muted' }) +
      '  <select class="input-field py-1.5 text-xs kanban-filter-select" id="kanban-filter-priority">' + priorityOptionsHtml + '</select>' +
      '  <select class="input-field py-1.5 text-xs kanban-filter-select" id="kanban-filter-stage">' + stageOptions + '</select>' +
      (active ? '<button type="button" class="btn-ghost py-1 text-xs" id="kanban-filter-clear">' + GDC.icon('x', { size: 11 }) + 'Limpar filtros</button>' : '') +
      '</div>'
    );
  }

  function bindFiltersBar() {
    var wrap = root.querySelector('#kanban-filters-bar');
    if (!wrap) return;
    var prioritySel = wrap.querySelector('#kanban-filter-priority');
    if (prioritySel) prioritySel.addEventListener('change', function (e) { filterPriority = e.target.value || null; refreshFiltersBar(); render(); });
    var stageSel = wrap.querySelector('#kanban-filter-stage');
    if (stageSel) stageSel.addEventListener('change', function (e) { filterStage = e.target.value || null; refreshFiltersBar(); render(); });
    var clearBtn = wrap.querySelector('#kanban-filter-clear');
    if (clearBtn) clearBtn.addEventListener('click', function () { filterPriority = null; filterStage = null; refreshFiltersBar(); render(); });
  }

  function refreshFiltersBar() {
    var wrap = root.querySelector('#kanban-filters-bar');
    if (!wrap) return;
    wrap.outerHTML = filtersBarMarkup();
    bindFiltersBar();
  }

  function shellMarkup() {
    return (
      '<section id="kanban" class="builder-section">' +
      '  <div class="mb-8 text-center">' +
      '    <div class="hero-badge">' + GDC.icon('trello', { size: 14, className: 'text-emerald-400' }) + 'Kanban</div>' +
      '    <h2 class="font-display text-3xl font-bold text-primary">Organize as tarefas do projeto</h2>' +
      '    <p class="mt-2 text-secondary">Categorias, etapas do projeto, prioridades, capa de imagem e filtros — um quadro completo, sem perder a simplicidade de times pequenos e devs indie.</p>' +
      '  </div>' +
      // Barra única no padrão das outras abas (Codex, GDC): filtros à esquerda, ações à direita.
      '  <div class="kanban-toolbar">' +
      filtersBarMarkup() +
      '    <div class="kanban-header-actions">' +
      '      <button type="button" id="kanban-suggest-milestones" class="btn-ghost py-1.5 text-xs">' + GDC.icon('flag', { size: 14 }) + 'Sugerir marcos</button>' +
      '      <button type="button" id="kanban-trash-toggle" class="btn-ghost py-1.5 text-xs">' + GDC.icon('inbox', { size: 14 }) + 'Lixeira<span id="kanban-trash-count" class="kanban-trash-count"></span></button>' +
      '    </div>' +
      '  </div>' +
      '  <div id="kanban-trash-panel" class="kanban-trash-panel" style="display:none"></div>' +
      '  <div class="kanban-board" id="gdc-kanban-board"></div>' +
      '  <div class="tab-help-note">' + GDC.icon('info', { size: 16 }) +
      '    <p><strong>Como funciona:</strong> arraste cards entre as colunas para acompanhar o progresso. A borda colorida de um card mostra a etapa do projeto (Ideia/Protótipo/Alfa/Beta/Acesso Antecipado/Lançamento), independente da coluna. Marcos (' + GDC.icon('flag', { size: 12, className: 'text-amber-400' }) + ') representam objetivos do projeto — clique no ícone de elo de um marco para vincular tarefas a ele; o anel de progresso e o avanço para "Concluído" acontecem sozinhos conforme as tarefas vinculadas terminam. Cards excluídos vão para a lixeira por 30 dias antes de serem apagados de vez.</p>' +
      '  </div>' +
      '</section>' +
      '<div id="kanban-modal-root"></div>' +
      '<div id="kanban-toast" class="kanban-toast" style="display:none">' +
      GDC.icon('check', { size: 16, className: 'flex-shrink-0 text-emerald-500' }) +
      '  <span id="kanban-toast-text"></span>' +
      '  <button type="button" id="kanban-toast-undo" class="kanban-toast-undo">' + GDC.icon('undo-2', { size: 12 }) + 'Desfazer</button>' +
      '</div>'
    );
  }

  function bindStaticEvents() {
    var suggestBtn = root.querySelector('#kanban-suggest-milestones');
    if (suggestBtn) suggestBtn.addEventListener('click', function () {
      if (callbacks.onSuggestMilestones) callbacks.onSuggestMilestones();
      render();
      renderTrashPanel();
    });

    var trashToggle = root.querySelector('#kanban-trash-toggle');
    if (trashToggle) trashToggle.addEventListener('click', function () {
      trashPanelOpen = !trashPanelOpen;
      renderTrashPanel();
    });

    var toastUndoBtn = root.querySelector('#kanban-toast-undo');
    if (toastUndoBtn) toastUndoBtn.addEventListener('click', function () {
      var toastEl = root.querySelector('#kanban-toast');
      var id = toastEl.getAttribute('data-trash-id');
      if (toastTimer) clearTimeout(toastTimer);
      if (id && callbacks.onRestoreCard) callbacks.onRestoreCard(id);
      toastEl.style.display = 'none';
      renderTrashPanel();
      render();
    });

    bindFiltersBar();
  }

  function mount(container, opts) {
    root = container;
    kanbanState = opts.kanban;
    colorPalette = opts.colorPalette || [];
    callbacks = {
      onAddCard: opts.onAddCard,
      onUpdateCard: opts.onUpdateCard,
      onDeleteCard: opts.onDeleteCard,
      onMoveCard: opts.onMoveCard,
      onRestoreCard: opts.onRestoreCard,
      onDeleteForever: opts.onDeleteForever,
      onEmptyTrash: opts.onEmptyTrash,
      onSuggestMilestones: opts.onSuggestMilestones,
      onAddCategory: opts.onAddCategory,
      onDeleteCategory: opts.onDeleteCategory,
    };
    trashPanelOpen = false;
    modalState = null;
    filterPriority = null;
    filterStage = null;

    root.innerHTML = shellMarkup();
    bindStaticEvents();
    render();
    renderTrashPanel();

    // Ligados uma única vez em `root` (sobrevivem a reset(), que só troca o innerHTML): tecla Esc
    // fecha o modal, e drag-and-drop de imagem sobre o campo de capa (além de poder clicar pra
    // escolher o arquivo) — mesmo padrão usado pelos campos de imagem do Codex.
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalState) closeModal();
    });
    root.addEventListener('dragover', function (e) {
      if (!e.target.closest('[data-cover-image-field]')) return;
      e.preventDefault();
      var zone = e.target.closest('[data-cover-image-dropzone]');
      if (zone) zone.classList.add('codex-image-dropzone-hover');
    });
    root.addEventListener('dragleave', function (e) {
      var zone = e.target.closest('[data-cover-image-dropzone]');
      if (zone) zone.classList.remove('codex-image-dropzone-hover');
    });
    root.addEventListener('drop', function (e) {
      var wrap = e.target.closest('[data-cover-image-field]');
      if (!wrap || !modalState) return;
      e.preventDefault();
      var zone = e.target.closest('[data-cover-image-dropzone]');
      if (zone) zone.classList.remove('codex-image-dropzone-hover');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file && GDC.imageStore) {
        GDC.imageStore.put(file).then(function (meta) {
          modalState.draft.coverImageId = meta.id;
          renderModal();
        });
      }
    });
  }

  function reset(kanbanVal) {
    kanbanState = kanbanVal;
    editingId = null;
    editDraft = null;
    dragOverColumn = null;
    trashPanelOpen = false;
    modalState = null;
    filterPriority = null;
    filterStage = null;
    root.innerHTML = shellMarkup();
    bindStaticEvents();
    render();
    renderTrashPanel();
  }

  /** Chamado depois de qualquer callback (add/update/delete/move/restore) para manter kanbanState sincronizado. */
  function syncState(kanbanVal) {
    kanbanState = kanbanVal;
  }

  GDC.ui.kanban = { mount: mount, reset: reset, syncState: syncState };
}(window));
