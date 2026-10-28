/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var root, titleInput, progressPctEl, progressCountEl, progressBarEl, readingTimeEl, totalCharsEl;
  var onTitleChange, onSectionChange, onLayoutChange;
  var activeSections, activeSectionMap, activeGroups;
  var currentDoc, editMode = false;

  function computeStats(doc) {
    var filledCount = activeSections.filter(function (s) { return (doc.sections[s.id] || '').length >= s.minChars; }).length;
    var totalMinChars = activeSections.reduce(function (sum, s) { return sum + s.minChars; }, 0);
    var totalChars = activeSections.reduce(function (sum, s) { return sum + (doc.sections[s.id] || '').length; }, 0);
    var progress = totalMinChars > 0 ? Math.min(100, Math.round((totalChars / totalMinChars) * 100)) : (activeSections.length ? 100 : 0);
    var readingTime = Math.max(1, Math.ceil(totalChars / 1000));
    return { filledCount: filledCount, totalChars: totalChars, progress: progress, readingTime: readingTime };
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function sectionCardMarkup(meta, value) {
    var charCount = value.length;
    var isFilled = charCount >= meta.minChars;
    return (
      '<div class="section-card-item" data-section="' + meta.id + '" style="border-left-color:' + meta.color + '80">' +
      '  <div class="mb-2.5 flex items-center justify-between">' +
      '    <div class="flex items-center gap-2.5">' +
      '      <span class="h-2.5 w-2.5 rounded-full" style="background-color:' + meta.color + '"></span>' +
      '      <h4 class="font-display text-sm font-semibold text-primary">' + escapeHtml(meta.label) + '</h4>' +
      '    </div>' +
      '  </div>' +
      '  <textarea class="input-field resize-y" rows="3" placeholder="' + escapeHtml(meta.placeholder) + '" data-field="textarea">' + escapeHtml(value) + '</textarea>' +
      '  <div class="mt-2 flex items-center justify-between text-xs">' +
      '    <span data-field="count" class="' + (isFilled ? 'text-emerald-500' : 'text-muted') + '">' + charCount + '/' + meta.minChars + ' caracteres</span>' +
      '    <span data-field="complete" class="text-emerald-500/80" style="' + (isFilled ? '' : 'display:none') + '">Completo</span>' +
      '  </div>' +
      '</div>'
    );
  }

  function groupMarkup(group, doc) {
    var cards = group.sectionIds.map(function (id) {
      return sectionCardMarkup(activeSectionMap[id], doc.sections[id] || '');
    }).join('');
    return (
      '<div class="section-group" data-group="' + group.id + '">' +
      '  <h3 class="section-group-title">' + escapeHtml(group.label) + '</h3>' +
      '  <div class="builder-group-stack">' + cards + '</div>' +
      '</div>'
    );
  }

  function fullMarkup(doc) {
    var stats = computeStats(doc);
    return (
      '<div class="builder-stack">' +
      '  <div class="card-surface p-5">' +
      '    <div class="mb-4 flex items-center justify-between">' +
      '      <div>' +
      '        <h2 class="font-display text-sm font-semibold text-primary">Fichas do GDC</h2>' +
      '        <p class="text-xs text-muted">Preencha cada seção — o GDD é atualizado em tempo real na aba ao lado.</p>' +
      '        <button type="button" class="btn-ghost mt-2 py-1 text-xs" data-gl="toggle-edit">' + GDC.icon('settings-2', { size: 12 }) + 'Personalizar seções</button>' +
      '      </div>' +
      '      <div class="text-right">' +
      '        <p class="font-display text-2xl font-bold text-primary" id="gdc-progress-pct">' + stats.progress + '%</p>' +
      '        <p class="text-xs text-muted" id="gdc-progress-count">' + stats.filledCount + '/' + activeSections.length + ' campos</p>' +
      '      </div>' +
      '    </div>' +
      '    <div class="progress-bar-track mb-3">' +
      '      <div class="progress-bar-fill gradient-full" id="gdc-progress-bar" style="width:' + stats.progress + '%"></div>' +
      '    </div>' +
      '    <div class="flex items-center gap-4 text-xs text-muted">' +
      '      <span id="gdc-reading-time">Leitura ~' + stats.readingTime + ' min</span>' +
      '      <span id="gdc-total-chars">' + stats.totalChars + ' caracteres no total</span>' +
      '    </div>' +
      '  </div>' +
      '  <div class="card-surface p-5">' +
      '    <label class="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">Título do Projeto</label>' +
      '    <input type="text" id="gdc-title-input" class="input-field font-display text-lg" placeholder="Jogo sem título" value="' + escapeHtml(doc.title) + '" />' +
      '  </div>' +
      (activeGroups.length ? activeGroups.map(function (g) { return groupMarkup(g, doc); }).join('')
        : '<p class="text-center text-sm text-muted">Nenhuma seção — clique em "Personalizar seções" para criar.</p>') +
      '</div>'
    );
  }

  // ---------- Modo de edição do layout (grupos/seções) ----------
  // Cada alteração gera um layout NOVO (nunca muta o atual) e sobe via onLayoutChange — o cache de
  // sectionsFor/groupsFor em data.js é indexado pelo objeto de layout.

  function iconBtn(action, icon, title, extra) {
    return '<button type="button" class="wp-icon-btn" data-gl="' + action + '"' + (extra || '') + ' title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(title) + '">' + GDC.icon(icon, { size: 14 }) + '</button>';
  }

  function layoutEditorMarkup(doc) {
    var layout = GDC.cloneGddLayout(doc);
    var hasNarrative = layout.groups.some(function (g) { return g.label.trim().toLowerCase() === GDC.NARRATIVE_GROUP_PRESET.label.toLowerCase(); });
    var groupOpts = function (currentId) {
      return layout.groups.map(function (g) {
        return '<option value="' + escapeHtml(g.id) + '"' + (g.id === currentId ? ' selected' : '') + '>' + escapeHtml(g.label) + '</option>';
      }).join('');
    };
    var groupsHtml = layout.groups.map(function (g, gi) {
      var secs = g.sections.map(function (sec, si) {
        var len = (doc.sections[sec.id] || '').length;
        var at = ' data-group-id="' + escapeHtml(g.id) + '" data-section-id="' + escapeHtml(sec.id) + '"';
        return (
          '<div class="gdd-layout-section"' + at + '>' +
          '  <input type="color" class="gdd-layout-color" data-gl-field="color" value="' + escapeHtml(sec.color) + '" title="Cor da seção" />' +
          '  <div class="gdd-layout-section-main">' +
          '    <input type="text" class="input-field py-1.5 text-sm" data-gl-field="label" value="' + escapeHtml(sec.label) + '" placeholder="Nome da seção" />' +
          '    <input type="text" class="input-field py-1 text-xs" data-gl-field="placeholder" value="' + escapeHtml(sec.placeholder) + '" placeholder="Dica exibida no campo vazio (opcional)" />' +
          '    <div class="gdd-layout-section-meta">' +
          '      <label class="text-xs text-muted">Mínimo de caracteres <input type="number" min="0" max="5000" class="input-field gdd-layout-num py-1 text-xs" data-gl-field="minChars" value="' + sec.minChars + '" /></label>' +
          (layout.groups.length > 1 ? '      <label class="text-xs text-muted">Grupo <select class="input-field py-1 text-xs" data-gl-field="group">' + groupOpts(g.id) + '</select></label>' : '') +
          (len ? '      <span class="text-xs text-muted">' + len + ' caracteres escritos</span>' : '') +
          '    </div>' +
          '  </div>' +
          '  <div class="gdd-layout-actions">' +
          iconBtn('sec-up', 'chevron-up', 'Subir', si === 0 ? ' disabled' : '') +
          iconBtn('sec-down', 'chevron-down', 'Descer', si === g.sections.length - 1 ? ' disabled' : '') +
          iconBtn('sec-remove', 'trash-2', 'Remover seção') +
          '  </div>' +
          '</div>'
        );
      }).join('');
      return (
        '<div class="card-surface gdd-layout-group" data-group-id="' + escapeHtml(g.id) + '">' +
        '  <div class="gdd-layout-group-head">' +
        '    <input type="text" class="input-field font-display py-1.5 text-sm font-semibold" data-gl-field="group-label" value="' + escapeHtml(g.label) + '" placeholder="Nome do grupo" />' +
        '    <div class="gdd-layout-actions">' +
        iconBtn('group-up', 'chevron-up', 'Subir grupo', gi === 0 ? ' disabled' : '') +
        iconBtn('group-down', 'chevron-down', 'Descer grupo', gi === layout.groups.length - 1 ? ' disabled' : '') +
        iconBtn('group-remove', 'trash-2', 'Remover grupo') +
        '    </div>' +
        '  </div>' +
        (secs || '<p class="text-xs text-muted">Grupo vazio.</p>') +
        '  <button type="button" class="btn-ghost mt-2 py-1 text-xs" data-gl="sec-add">' + GDC.icon('plus', { size: 12 }) + 'Nova seção</button>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="builder-stack gdd-layout-editor">' +
      '  <div class="card-surface p-5">' +
      '    <div class="flex items-center justify-between gap-3">' +
      '      <div>' +
      '        <h2 class="font-display text-sm font-semibold text-primary">Personalizar seções do GDC</h2>' +
      '        <p class="text-xs text-muted">Renomeie, reordene, crie ou remova grupos e seções deste projeto. As mudanças são salvas na hora.</p>' +
      '      </div>' +
      '      <button type="button" class="btn-primary py-1.5 text-xs" data-gl="toggle-edit">' + GDC.icon('check', { size: 13 }) + 'Concluir</button>' +
      '    </div>' +
      '    <div class="mt-3 flex flex-wrap items-center gap-2">' +
      '      <button type="button" class="btn-ghost py-1.5 text-xs" data-gl="group-add">' + GDC.icon('plus', { size: 12 }) + 'Novo grupo</button>' +
      (hasNarrative ? '' : '      <button type="button" class="btn-ghost py-1.5 text-xs" data-gl="group-add-narrative" title="Sinopse, História e Lore, Estrutura Narrativa, Temas">' + GDC.icon('book-open', { size: 12 }) + 'Adicionar grupo Narrativa</button>') +
      (doc.gddLayout ? '      <button type="button" class="btn-ghost py-1.5 text-xs" data-gl="restore-default">' + GDC.icon('rotate-ccw', { size: 12 }) + 'Restaurar padrão</button>' : '') +
      '    </div>' +
      '  </div>' +
      groupsHtml +
      '</div>'
    );
  }

  function newSection(idx) {
    return {
      id: GDC.makeId('sec'), label: 'Nova seção', placeholder: '',
      minChars: GDC.GDD_CUSTOM_MIN_CHARS, color: GDC.GDD_SECTION_COLORS[idx % GDC.GDD_SECTION_COLORS.length],
    };
  }

  function findIn(layout, groupId, sectionId) {
    var gi = -1, si = -1;
    layout.groups.forEach(function (g, i) { if (g.id === groupId) gi = i; });
    if (gi !== -1 && sectionId) layout.groups[gi].sections.forEach(function (sec, i) { if (sec.id === sectionId) si = i; });
    return { gi: gi, si: si };
  }

  function swap(arr, i, j) { if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }

  function commitLayout(layout, removedIds, opts) {
    if (onLayoutChange) onLayoutChange(layout, removedIds || [], opts || {});
  }

  function textOf(id) { return (currentDoc.sections[id] || '').trim(); }

  function handleLayoutClick(e) {
    var btn = e.target.closest('[data-gl]');
    if (!btn || !root.contains(btn) || btn.disabled) return;
    var action = btn.getAttribute('data-gl');
    if (action === 'toggle-edit') { editMode = !editMode; render(); return; }
    var doc = currentDoc;
    var layout = GDC.cloneGddLayout(doc);
    var holder = btn.closest('[data-group-id]');
    var groupId = holder ? holder.getAttribute('data-group-id') : null;
    var secEl = btn.closest('[data-section-id]');
    var pos = findIn(layout, groupId, secEl ? secEl.getAttribute('data-section-id') : null);
    var totalSecs = GDC.sectionsFor(doc).length;

    if (action === 'restore-default') {
      var defaults = GDC.sectionMapFor(doc.projectType);
      var lost = GDC.sectionsFor(doc).filter(function (sec) { return !defaults[sec.id] && textOf(sec.id); });
      var msg = 'Voltar para as seções padrão? Nomes, ordem e seções criadas serão desfeitos.';
      if (lost.length) msg += '\n\nO texto destas seções será APAGADO: ' + lost.map(function (sec) { return sec.label; }).join(', ') + '.';
      if (!global.confirm(msg)) return;
      var removedAll = GDC.sectionsFor(doc).filter(function (sec) { return !defaults[sec.id]; }).map(function (sec) { return sec.id; });
      commitLayout(null, removedAll);
      return;
    }
    if (action === 'group-add') {
      layout.groups.push({ id: GDC.makeId('grp'), label: 'Novo grupo', sections: [newSection(totalSecs)] });
    } else if (action === 'group-add-narrative') {
      var p = GDC.NARRATIVE_GROUP_PRESET;
      // Logo depois de "Fundamentos" quando ele existe (é onde a história costuma ser lida); senão no fim.
      var at = layout.groups.length;
      layout.groups.forEach(function (g, i) { if (g.id === 'fundamentos') at = i + 1; });
      layout.groups.splice(at, 0, {
        id: GDC.makeId('grp'), label: p.label,
        sections: p.sections.map(function (sec) { return Object.assign({ id: GDC.makeId('sec') }, sec); }),
      });
    } else if (pos.gi === -1) {
      return;
    } else if (action === 'group-up' || action === 'group-down') {
      swap(layout.groups, pos.gi, pos.gi + (action === 'group-up' ? -1 : 1));
    } else if (action === 'group-remove') {
      var g = layout.groups[pos.gi];
      var withText = g.sections.filter(function (sec) { return textOf(sec.id); });
      var m = 'Remover o grupo "' + g.label + '" e suas ' + g.sections.length + ' seções?';
      if (withText.length) m += '\n\nO texto destas seções será APAGADO: ' + withText.map(function (sec) { return sec.label; }).join(', ') + '.';
      if ((g.sections.length || withText.length) && !global.confirm(m)) return;
      layout.groups.splice(pos.gi, 1);
      commitLayout(layout, g.sections.map(function (sec) { return sec.id; }));
      return;
    } else if (action === 'sec-add') {
      layout.groups[pos.gi].sections.push(newSection(totalSecs));
    } else if (pos.si === -1) {
      return;
    } else if (action === 'sec-up' || action === 'sec-down') {
      swap(layout.groups[pos.gi].sections, pos.si, pos.si + (action === 'sec-up' ? -1 : 1));
    } else if (action === 'sec-remove') {
      var sec = layout.groups[pos.gi].sections[pos.si];
      if (textOf(sec.id) && !global.confirm('Remover a seção "' + sec.label + '"? O texto dela será APAGADO.')) return;
      layout.groups[pos.gi].sections.splice(pos.si, 1);
      commitLayout(layout, [sec.id]);
      return;
    } else {
      return;
    }
    commitLayout(layout, []);
  }

  // Campos de texto: commit no "change" (ao sair do campo), não a cada tecla — re-renderizar o editor
  // a cada tecla tiraria o foco do input. Cor e número também usam "change".
  function handleLayoutChange(e) {
    var el = e.target.closest('[data-gl-field]');
    if (!el || !root.contains(el)) return;
    var field = el.getAttribute('data-gl-field');
    var layout = GDC.cloneGddLayout(currentDoc);
    var holder = el.closest('[data-group-id]');
    var secEl = el.closest('[data-section-id]');
    var pos = findIn(layout, holder && holder.getAttribute('data-group-id'), secEl && secEl.getAttribute('data-section-id'));
    if (pos.gi === -1) return;
    if (field === 'group-label') {
      layout.groups[pos.gi].label = el.value.trim() || 'Grupo';
    } else {
      if (pos.si === -1) return;
      var sec = layout.groups[pos.gi].sections[pos.si];
      if (field === 'label') sec.label = el.value.trim() || 'Seção';
      else if (field === 'placeholder') sec.placeholder = el.value;
      else if (field === 'color') sec.color = el.value;
      else if (field === 'minChars') sec.minChars = Math.max(0, Math.min(5000, Math.round(Number(el.value) || 0)));
      else if (field === 'group') {
        var target = findIn(layout, el.value, null).gi;
        if (target === -1 || target === pos.gi) return;
        layout.groups[pos.gi].sections.splice(pos.si, 1);
        layout.groups[target].sections.push(sec);
      } else return;
    }
    // Adiado: o "change" dispara ANTES do foco ir pro próximo campo (Tab). Re-renderizando depois,
    // render() consegue devolver o foco ao campo pra onde o usuário foi.
    setTimeout(function () { commitLayout(layout, []); }, 0);
  }

  function focusDescriptor() {
    var a = document.activeElement;
    if (!a || !root.contains(a)) return null;
    var f = a.getAttribute('data-gl-field') || a.getAttribute('data-gl');
    if (!f) return null;
    var g = a.closest('[data-group-id]'), sec = a.closest('[data-section-id]');
    return { field: f, attr: a.hasAttribute('data-gl-field') ? 'data-gl-field' : 'data-gl',
      groupId: g && g.getAttribute('data-group-id'), sectionId: sec && sec.getAttribute('data-section-id') };
  }

  function restoreFocus(d) {
    if (!d) return;
    var scope = root;
    if (d.sectionId) scope = root.querySelector('[data-section-id="' + d.sectionId + '"]');
    else if (d.groupId) scope = root.querySelector('.gdd-layout-group[data-group-id="' + d.groupId + '"]');
    var el = scope && scope.querySelector('[' + d.attr + '="' + d.field + '"]');
    if (el && !el.disabled) el.focus();
  }

  function render() {
    if (editMode) {
      var focus = focusDescriptor();
      root.innerHTML = layoutEditorMarkup(currentDoc);
      restoreFocus(focus);
    } else {
      root.innerHTML = fullMarkup(currentDoc);
      bindEvents();
    }
  }

  function bindEvents() {
    titleInput = root.querySelector('#gdc-title-input');
    progressPctEl = root.querySelector('#gdc-progress-pct');
    progressCountEl = root.querySelector('#gdc-progress-count');
    progressBarEl = root.querySelector('#gdc-progress-bar');
    readingTimeEl = root.querySelector('#gdc-reading-time');
    totalCharsEl = root.querySelector('#gdc-total-chars');

    titleInput.addEventListener('input', function (e) {
      if (onTitleChange) onTitleChange(e.target.value);
    });

    root.querySelectorAll('[data-section]').forEach(function (cardEl) {
      var id = cardEl.getAttribute('data-section');
      var textarea = cardEl.querySelector('[data-field="textarea"]');
      var countEl = cardEl.querySelector('[data-field="count"]');
      var completeEl = cardEl.querySelector('[data-field="complete"]');

      textarea.addEventListener('input', function (e) {
        var value = e.target.value;
        var meta = activeSectionMap[id];
        var isFilled = value.length >= meta.minChars;
        countEl.textContent = value.length + '/' + meta.minChars + ' caracteres';
        countEl.className = isFilled ? 'text-emerald-500' : 'text-muted';
        completeEl.style.display = isFilled ? '' : 'none';
        if (onSectionChange) onSectionChange(id, value);
      });
    });
  }

  function setActiveSchema(doc) {
    activeSections = GDC.sectionsFor(doc);
    activeSectionMap = GDC.sectionMapFor(doc);
    activeGroups = GDC.groupsFor(doc);
  }

  function mount(container, opts) {
    root = container;
    onTitleChange = opts.onTitleChange;
    onSectionChange = opts.onSectionChange;
    onLayoutChange = opts.onLayoutChange;
    currentDoc = opts.doc;
    setActiveSchema(opts.doc);
    // Delegação ligada UMA vez: o conteúdo do root é recriado a cada render.
    root.addEventListener('click', handleLayoutClick);
    root.addEventListener('change', handleLayoutChange);
    render();
  }

  /** Re-renderiza tudo (usado em reset / import / seleção de template / mudança de layout).
   *  `keepEditMode` = true só quando a mudança veio do próprio editor de layout. */
  function reset(doc, keepEditMode) {
    currentDoc = doc;
    if (!keepEditMode) editMode = false;
    setActiveSchema(doc);
    render();
  }

  /** Atualiza apenas o painel de progresso agregado (chamado a cada alteração de seção). */
  function updateProgress(doc) {
    if (editMode) return;
    var stats = computeStats(doc);
    if (progressPctEl) progressPctEl.textContent = stats.progress + '%';
    if (progressCountEl) progressCountEl.textContent = stats.filledCount + '/' + activeSections.length + ' campos';
    if (progressBarEl) progressBarEl.style.width = stats.progress + '%';
    if (readingTimeEl) readingTimeEl.textContent = 'Leitura ~' + stats.readingTime + ' min';
    if (totalCharsEl) totalCharsEl.textContent = stats.totalChars + ' caracteres no total';
  }

  GDC.ui.builder = { mount: mount, reset: reset, updateProgress: updateProgress };
}(window));
