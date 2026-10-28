/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // ---------------------------------------------------------------------------------------------
  // Direção de arte: aba própria com visão geral (Markdown), PALETAS (cores com nome, hex e papel) e
  // ESTILOS (conceito, elementos, materiais, interfaces, faça/evite, paleta, imagens de referência).
  // Paletas e estilos se ligam a entradas do Codex (o Codex mostra essas ligações no modo leitura).
  // O cartão "Consistência" aponta cores quase iguais entre paletas, contraste fraco entre Interface
  // e Base, e estilos sem paleta — o objetivo é dado estruturado e coerente, não um moodboard solto
  // (moodboard livre continua sendo o Mural).
  //
  // Estado em doc.artDirection (normalizeArtDirection em data.js); mutado in-place e salvo via
  // onChange. Eventos por delegação no root, ligados uma vez no mount.
  // ---------------------------------------------------------------------------------------------

  var root, art, codexRef, onChange, onGotoCodexEntry;
  var expandedStyle = null, editingColor = null, overviewEditing = false;
  var highlightId = null;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function save() { if (onChange) onChange(); }

  // ---------- Cor ----------

  function hexToRgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function luminance(h) {
    return hexToRgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce(function (acc, v, i) { return acc + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function contrast(a, b) { var la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  /** Distância perceptual aproximada (CIE76 em Lab). < ~8 = difícil de distinguir lado a lado. */
  function toLab(h) {
    var c = hexToRgb(h).map(function (v) { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; });
    var x = (c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805) / 0.95047;
    var y = (c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722);
    var z = (c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505) / 1.08883;
    var f = function (t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; };
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }
  function deltaE(a, b) { var A = toLab(a), B = toLab(b); return Math.sqrt(Math.pow(A[0] - B[0], 2) + Math.pow(A[1] - B[1], 2) + Math.pow(A[2] - B[2], 2)); }
  function textOn(h) { return luminance(h) > 0.4 ? '#111827' : '#ffffff'; }

  // ---------- Consultas ----------

  function paletteById(id) { return art.palettes.filter(function (p) { return p.id === id; })[0] || null; }
  function styleById(id) { return art.styles.filter(function (s) { return s.id === id; })[0] || null; }
  function entryById(id) { return codexRef.entries.filter(function (e) { return e.id === id; })[0] || null; }
  function typeById(id) { return codexRef.types.filter(function (t) { return t.id === id; })[0] || null; }

  /** Problemas de consistência do conjunto inteiro. */
  function analyze(a) {
    var issues = [];
    var all = [];
    a.palettes.forEach(function (p) { p.colors.forEach(function (c) { all.push({ p: p, c: c }); }); });
    for (var i = 0; i < all.length; i++) {
      for (var j = i + 1; j < all.length; j++) {
        if (all[i].p === all[j].p) continue;
        var d = deltaE(all[i].c.hex, all[j].c.hex);
        if (d < 6 && all[i].c.hex !== all[j].c.hex) {
          issues.push({ kind: 'near', text: '"' + (all[i].c.name || all[i].c.hex) + '" (' + (all[i].p.name || 'paleta') + ') e "' + (all[j].c.name || all[j].c.hex) + '" (' + (all[j].p.name || 'paleta') + ') são quase iguais — unificar ou diferenciar?', ids: [all[i].p.id, all[j].p.id] });
        }
      }
    }
    a.palettes.forEach(function (p) {
      var bases = p.colors.filter(function (c) { return c.role === 'Base'; });
      var uis = p.colors.filter(function (c) { return c.role === 'Interface'; });
      bases.forEach(function (b) {
        uis.forEach(function (u) {
          var r = contrast(b.hex, u.hex);
          if (r < 3) issues.push({ kind: 'contrast', text: 'Em "' + (p.name || 'paleta') + '", Interface sobre Base tem contraste ' + r.toFixed(1) + ':1 (mínimo recomendado 3:1 pra elementos de interface)', ids: [p.id] });
        });
      });
      if (p.colors.length && !p.colors.some(function (c) { return c.role; })) issues.push({ kind: 'roles', text: '"' + (p.name || 'paleta') + '" não tem nenhuma cor com papel (Base, Destaque...) — fica difícil aplicar com consistência', ids: [p.id] });
    });
    a.styles.forEach(function (s) {
      if (!s.paletteId) issues.push({ kind: 'nopal', text: 'O estilo "' + (s.name || 'sem nome') + '" não tem paleta ligada', ids: [s.id] });
    });
    return issues;
  }

  /** Paletas e estilos ligados a uma entrada do Codex (usado pelo modo leitura do Codex). */
  function linksFor(a, entryId) {
    if (!a) return { palettes: [], styles: [] };
    return {
      palettes: a.palettes.filter(function (p) { return p.codexIds.indexOf(entryId) !== -1; }),
      styles: a.styles.filter(function (s) { return s.codexIds.indexOf(entryId) !== -1; }),
    };
  }

  // ---------- Markup ----------

  function codexOptions(exclude) {
    return codexRef.types.map(function (t) {
      var list = codexRef.entries.filter(function (e) { return e.typeId === t.id && exclude.indexOf(e.id) === -1; })
        .sort(function (x, y) { return (x.name || '').localeCompare(y.name || '', 'pt-BR'); });
      if (!list.length) return '';
      return '<optgroup label="' + escapeHtml(t.name) + '">' + list.map(function (e) { return '<option value="' + escapeHtml(e.id) + '">' + escapeHtml(e.name || '(sem nome)') + '</option>'; }).join('') + '</optgroup>';
    }).join('');
  }

  function codexLinksMarkup(ids) {
    if (!codexRef.types.length) return '<p class="text-xs text-muted">Crie entradas no Codex pra ligar (ambientes, personagens, naves...).</p>';
    var chips = ids.map(function (id) {
      var e = entryById(id); if (!e) return '';
      var t = typeById(e.typeId);
      return '<span class="quest-chip"><button type="button" class="quest-chip-link" data-aa="goto-codex" data-id="' + escapeHtml(e.id) + '">' + (t ? GDC.icon(t.icon, { size: 10 }) : '') + escapeHtml(e.name || '(sem nome)') + '</button>' +
        '<button type="button" class="quest-chip-x" data-aa="codex-remove" data-id="' + escapeHtml(e.id) + '" title="Remover ligação">' + GDC.icon('x', { size: 10 }) + '</button></span>';
    }).join('');
    var opts = codexOptions(ids);
    return '<div class="quest-chips">' + (chips || '<span class="text-xs text-muted">Nada ligado.</span>') + '</div>' +
      (opts ? '<select class="input-field py-1 text-xs quest-add-select" data-aa-add="codex"><option value="">+ Ligar a uma entrada do Codex...</option>' + opts + '</select>' : '');
  }

  function swatchStrip(p, small) {
    if (!p || !p.colors.length) return '<span class="text-xs text-muted">sem cores</span>';
    return '<span class="art-strip' + (small ? ' art-strip-sm' : '') + '">' + p.colors.map(function (c) {
      return '<span style="background-color:' + c.hex + '" title="' + escapeHtml((c.name ? c.name + ' · ' : '') + c.hex + (c.role ? ' · ' + c.role : '')) + '"></span>';
    }).join('') + '</span>';
  }

  function paletteMarkup(p) {
    var colors = p.colors.map(function (c) {
      var open = editingColor === c.id;
      return (
        '<div class="art-swatch' + (open ? ' art-swatch-open' : '') + '" data-color="' + escapeHtml(c.id) + '">' +
        '  <button type="button" class="art-swatch-chip" data-aa="color-edit" style="background-color:' + c.hex + ';color:' + textOn(c.hex) + '" title="Editar cor">' +
        '    <span class="art-swatch-role">' + escapeHtml(c.role || '') + '</span><span class="art-swatch-hex">' + c.hex.toUpperCase() + '</span></button>' +
        '  <span class="art-swatch-name">' + escapeHtml(c.name || '—') + '</span>' +
        (open
          ? '<div class="art-swatch-editor">' +
            '<input type="color" class="gdd-layout-color" data-acf="hex" data-color-harmony value="' + c.hex + '" />' +
            '<input type="text" class="input-field py-1 text-xs art-hex-input" data-acf="hexText" value="' + c.hex.toUpperCase() + '" maxlength="7" title="Hex" />' +
            '<input type="text" class="input-field py-1 text-xs" data-acf="name" value="' + escapeHtml(c.name) + '" placeholder="Nome (ex.: Bege areia)" />' +
            '<select class="input-field py-1 text-xs" data-acf="role"><option value="">Sem papel</option>' + GDC.ART_COLOR_ROLES.map(function (r) { return '<option' + (r === c.role ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select>' +
            '<div class="art-swatch-editor-actions">' +
            '<button type="button" class="wp-icon-btn" data-aa="color-left" title="Mover pra esquerda">' + GDC.icon('chevron-left', { size: 13 }) + '</button>' +
            '<button type="button" class="wp-icon-btn" data-aa="color-right" title="Mover pra direita">' + GDC.icon('chevron-right', { size: 13 }) + '</button>' +
            '<button type="button" class="wp-icon-btn" data-aa="color-remove" title="Remover cor">' + GDC.icon('trash-2', { size: 13 }) + '</button>' +
            '</div></div>'
          : '') +
        '</div>'
      );
    }).join('');
    return (
      '<div class="card-surface art-palette' + (highlightId === p.id ? ' art-highlight' : '') + '" data-palette="' + escapeHtml(p.id) + '">' +
      '  <div class="art-card-head">' +
      '    <input type="text" class="art-title-input" data-apf="name" value="' + escapeHtml(p.name) + '" placeholder="Nome da paleta (ex.: Domo)" />' +
      '    <button type="button" class="wp-icon-btn" data-aa="palette-copy" title="Copiar cores (hex)">' + GDC.icon('copy', { size: 13 }) + '</button>' +
      '    <button type="button" class="wp-icon-btn" data-aa="palette-dup" title="Duplicar paleta">' + GDC.icon('layers', { size: 13 }) + '</button>' +
      '    <button type="button" class="wp-icon-btn" data-aa="palette-remove" title="Excluir paleta">' + GDC.icon('trash-2', { size: 13 }) + '</button>' +
      '  </div>' +
      '  <div class="art-swatches">' + colors +
      '    <button type="button" class="art-swatch-add" data-aa="color-add" title="Adicionar cor">' + GDC.icon('plus', { size: 16 }) + '</button>' +
      '  </div>' +
      '  <textarea class="input-field resize-y py-1.5 text-xs" rows="2" data-apf="notes" placeholder="Onde e como usar (ex.: interior do Domo — limpo, científico, silencioso)">' + escapeHtml(p.notes) + '</textarea>' +
      '  <div class="quest-field-row"><span class="quest-field-label">Usada em (Codex)</span>' + codexLinksMarkup(p.codexIds) + '</div>' +
      '</div>'
    );
  }

  function tagsValue(list) { return list.join(', '); }
  function linesValue(list) { return list.join('\n'); }

  function styleMarkup(s) {
    var open = expandedStyle === s.id;
    var pal = paletteById(s.paletteId);
    var head =
      '<button type="button" class="quest-card-head" data-aa="style-toggle">' +
      '  <span class="quest-card-icon" style="background-color:#ec489920;color:#ec4899">' + GDC.icon('palette', { size: 14 }) + '</span>' +
      '  <span class="min-w-0 flex-1 text-left"><span class="quest-card-title">' + escapeHtml(s.name || '(sem nome)') + '</span>' +
      (s.concept ? '<span class="quest-card-giver">' + escapeHtml(s.concept.replace(/\s+/g, ' ').slice(0, 110)) + '</span>' : '') + '</span>' +
      (pal ? swatchStrip(pal, true) : '<span class="quest-card-warn" title="Sem paleta">' + GDC.icon('alert-circle', { size: 12 }) + '</span>') +
      (s.imageIds.length ? '<span class="quest-card-obj-count">' + GDC.icon('image', { size: 11 }) + s.imageIds.length + '</span>' : '') +
      '</button>';
    if (!open) return '<div class="card-surface quest-card' + (highlightId === s.id ? ' art-highlight' : '') + '" data-style="' + escapeHtml(s.id) + '">' + head + '</div>';
    var palOpts = '<option value="">Sem paleta</option>' + art.palettes.map(function (p) {
      return '<option value="' + escapeHtml(p.id) + '"' + (p.id === s.paletteId ? ' selected' : '') + '>' + escapeHtml(p.name || 'Paleta sem nome') + '</option>';
    }).join('');
    var imgs = s.imageIds.map(function (id) {
      return '<div class="art-ref" data-image-thumb="' + escapeHtml(id) + '"><button type="button" class="art-ref-x" data-aa="img-remove" data-id="' + escapeHtml(id) + '" title="Remover">' + GDC.icon('x', { size: 11 }) + '</button></div>';
    }).join('');
    return (
      '<div class="card-surface quest-card quest-card-expanded' + (highlightId === s.id ? ' art-highlight' : '') + '" data-style="' + escapeHtml(s.id) + '">' + head +
      '  <div class="quest-card-body">' +
      '    <div class="quest-field-grid quest-field-grid-2">' +
      '      <div class="quest-field-row"><label class="quest-field-label">Nome</label><input type="text" class="input-field py-1.5 text-xs" data-asf="name" value="' + escapeHtml(s.name) + '" placeholder="Ex.: Tecnologia Solaria" /></div>' +
      '      <div class="quest-field-row"><label class="quest-field-label">Paleta</label><select class="input-field py-1.5 text-xs" data-asf="paletteId">' + palOpts + '</select>' + (pal ? swatchStrip(pal) : '') + '</div>' +
      '    </div>' +
      '    <div class="quest-field-row"><label class="quest-field-label">Conceito</label><textarea class="input-field resize-y py-1.5 text-xs" rows="2" data-asf="concept" placeholder="A ideia em uma ou duas frases (ex.: poderosa, porém pesada, industrial e analógica)">' + escapeHtml(s.concept) + '</textarea></div>' +
      '    <div class="quest-field-grid quest-field-grid-2">' +
      '      <div class="quest-field-row"><label class="quest-field-label">Elementos (separados por vírgula)</label><input type="text" class="input-field py-1.5 text-xs" data-asf="elements" value="' + escapeHtml(tagsValue(s.elements)) + '" placeholder="monitores CRT, botões físicos, cabos grossos" /></div>' +
      '      <div class="quest-field-row"><label class="quest-field-label">Materiais (separados por vírgula)</label><input type="text" class="input-field py-1.5 text-xs" data-asf="materials" value="' + escapeHtml(tagsValue(s.materials)) + '" placeholder="plástico ABS, metal pintado, vidro grosso" /></div>' +
      '    </div>' +
      '    <div class="quest-field-row"><label class="quest-field-label">Interfaces / UI</label><input type="text" class="input-field py-1.5 text-xs" data-asf="interfaces" value="' + escapeHtml(s.interfaces) + '" placeholder="verde monocromático, âmbar, azul escuro" /></div>' +
      '    <div class="quest-field-grid quest-field-grid-2">' +
      '      <div class="quest-field-row"><label class="quest-field-label">' + GDC.icon('check', { size: 11, className: 'text-emerald-500' }) + ' Faça (uma regra por linha)</label><textarea class="input-field resize-y py-1.5 text-xs" rows="3" data-asf="dos" placeholder="Parafusos aparentes&#10;Riscos e arranhões">' + escapeHtml(linesValue(s.dos)) + '</textarea></div>' +
      '      <div class="quest-field-row"><label class="quest-field-label">' + GDC.icon('x', { size: 11, className: 'text-rose-500' }) + ' Evite (uma regra por linha)</label><textarea class="input-field resize-y py-1.5 text-xs" rows="3" data-asf="donts" placeholder="Hologramas&#10;Superfícies lisas e limpas">' + escapeHtml(linesValue(s.donts)) + '</textarea></div>' +
      '    </div>' +
      '    <div class="quest-field-row"><label class="quest-field-label">Referências visuais</label>' +
      '      <div class="art-refs">' + imgs +
      '        <label class="art-ref-add" title="Adicionar imagem (ou arraste aqui)">' + GDC.icon('image', { size: 16 }) + '<span>Adicionar</span><input type="file" accept="image/*" multiple class="hidden" data-aa-upload /></label>' +
      '      </div>' +
      '    </div>' +
      '    <div class="quest-field-row"><span class="quest-field-label">Usado em (Codex)</span>' + codexLinksMarkup(s.codexIds) + '</div>' +
      '    <div class="quest-card-actions">' +
      '      <button type="button" class="btn-ghost py-1.5 text-xs" data-aa="style-toggle">' + GDC.icon('chevron-down', { size: 13, className: 'rotate-180' }) + 'Fechar</button>' +
      '      <button type="button" class="btn-ghost py-1.5 text-xs text-rose-500" data-aa="style-remove">' + GDC.icon('trash-2', { size: 13 }) + 'Excluir estilo</button>' +
      '    </div>' +
      '  </div>' +
      '</div>'
    );
  }

  function overviewMarkup() {
    var body = overviewEditing
      ? '<textarea class="input-field resize-y text-sm" rows="6" data-aof="overview" placeholder="Estilo geral (ex.: 3D cartoon), contrastes centrais (Domo limpo × ruínas industriais), referências...">' + escapeHtml(art.overview) + '</textarea>'
      : (art.overview.trim() ? GDC.renderMarkdown(art.overview, 'codex-read-md') : '<p class="text-xs text-muted">Descreva o estilo visual geral do jogo — clique no lápis.</p>');
    return (
      '<div class="card-surface art-overview">' +
      '  <div class="art-card-head"><h3 class="font-display text-sm font-bold text-primary flex-1">Visão geral</h3>' +
      '    <button type="button" class="wp-icon-btn" data-aa="overview-toggle" title="' + (overviewEditing ? 'Ler' : 'Editar') + '">' + GDC.icon(overviewEditing ? 'eye' : 'pencil', { size: 14 }) + '</button></div>' +
      body +
      '</div>'
    );
  }

  function issuesMarkup() {
    var issues = analyze(art);
    if (!art.palettes.length && !art.styles.length) return '';
    return (
      '<div class="card-surface art-issues">' +
      '  <h3 class="font-display text-sm font-bold text-primary">' + GDC.icon(issues.length ? 'alert-circle' : 'check', { size: 14, className: issues.length ? 'text-amber-500' : 'text-emerald-500' }) + ' Consistência</h3>' +
      (issues.length
        ? '<ul>' + issues.map(function (it) { return '<li><button type="button" class="quest-chip-link" data-aa="focus" data-id="' + escapeHtml(it.ids[0]) + '">' + escapeHtml(it.text) + '</button></li>'; }).join('') + '</ul>'
        : '<p class="text-xs text-muted">Nenhum problema encontrado: cores bem distintas entre paletas, contraste de interface ok e todo estilo com paleta.</p>') +
      '</div>'
    );
  }

  function render() {
    var body = root.querySelector('#art-body');
    if (!body) return;
    // Preserva o foco num campo de texto (re-render depois de sair de um campo com Tab).
    var a = document.activeElement, focus = null;
    if (a && body.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) {
      var attr = ['data-apf', 'data-asf', 'data-acf', 'data-aof'].filter(function (x) { return a.hasAttribute(x); })[0];
      var holder = a.closest('[data-color]') || a.closest('[data-palette]') || a.closest('[data-style]');
      var hAttr = holder && ['data-color', 'data-palette', 'data-style'].filter(function (x) { return holder.hasAttribute(x); })[0];
      if (attr) focus = { attr: attr, val: a.getAttribute(attr), hAttr: hAttr, hVal: holder && holder.getAttribute(hAttr) };
    }
    body.innerHTML =
      overviewMarkup() +
      '<div class="art-section-head"><h3 class="font-display text-base font-bold text-primary">Paletas</h3><span class="text-xs text-muted">por ambiente, personagem ou camada tecnológica</span><span class="wp-stage-spacer"></span>' +
      '  <button type="button" class="btn-primary py-1.5 text-xs" data-aa="palette-add">' + GDC.icon('plus', { size: 13 }) + 'Nova paleta</button></div>' +
      (art.palettes.length ? '<div class="art-palettes">' + art.palettes.map(paletteMarkup).join('') + '</div>' : '<p class="quest-empty">Nenhuma paleta ainda.</p>') +
      '<div class="art-section-head"><h3 class="font-display text-base font-bold text-primary">Estilos</h3><span class="text-xs text-muted">camadas tecnológicas, facções, épocas</span><span class="wp-stage-spacer"></span>' +
      '  <button type="button" class="btn-primary py-1.5 text-xs" data-aa="style-add">' + GDC.icon('plus', { size: 13 }) + 'Novo estilo</button></div>' +
      (art.styles.length ? '<div class="quest-list">' + art.styles.map(styleMarkup).join('') + '</div>' : '<p class="quest-empty">Nenhum estilo ainda.</p>') +
      issuesMarkup();
    if (GDC.imageStore) GDC.imageStore.resolveThumbs(body);
    if (focus) {
      var scope = focus.hAttr ? body.querySelector('[' + focus.hAttr + '="' + focus.hVal + '"]') : body;
      var el = scope && scope.querySelector('[' + focus.attr + '="' + focus.val + '"]');
      if (el) el.focus();
    }
  }

  // ---------- Eventos ----------

  function ctx(el) {
    var pe = el.closest('[data-palette]'), se = el.closest('[data-style]'), ce = el.closest('[data-color]');
    var p = pe && paletteById(pe.getAttribute('data-palette'));
    var s = se && styleById(se.getAttribute('data-style'));
    var c = p && ce && p.colors.filter(function (x) { return x.id === ce.getAttribute('data-color'); })[0];
    return { p: p, s: s, c: c };
  }

  function addImages(style, files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return !f.type || f.type.indexOf('image/') === 0; });
    if (!list.length || !GDC.imageStore) return;
    Promise.all(list.map(function (f) { return GDC.imageStore.put(f).catch(function () { return null; }); })).then(function (metas) {
      metas.forEach(function (m) { if (m && m.id) style.imageIds.push(m.id); });
      save(); render();
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* sem cópia */ }
    ta.remove(); return Promise.resolve();
  }

  function onClick(e) {
    var btn = e.target.closest('[data-aa]');
    if (!btn || !root.contains(btn)) return;
    var a = btn.getAttribute('data-aa'), bid = btn.getAttribute('data-id');
    var c = ctx(btn);
    var mid = GDC.makeId;
    if (a === 'overview-toggle') { overviewEditing = !overviewEditing; render(); if (overviewEditing) { var ta = root.querySelector('[data-aof="overview"]'); if (ta) ta.focus(); } return; }
    if (a === 'palette-add') {
      var p = { id: mid('pal'), name: '', notes: '', codexIds: [], colors: [
        { id: mid('col'), name: '', hex: '#d6c7a1', role: 'Base' }, { id: mid('col'), name: '', hex: '#f97316', role: 'Destaque' }, { id: mid('col'), name: '', hex: '#334155', role: 'Sombra' } ] };
      art.palettes.push(p); save(); render();
      var ni = root.querySelector('[data-palette="' + p.id + '"] [data-apf="name"]'); if (ni) ni.focus();
      return;
    }
    if (a === 'style-add') {
      var s = { id: mid('sty'), name: '', concept: '', elements: [], materials: [], interfaces: '', dos: [], donts: [], paletteId: null, imageIds: [], codexIds: [] };
      art.styles.push(s); expandedStyle = s.id; save(); render();
      var si = root.querySelector('[data-style="' + s.id + '"] [data-asf="name"]'); if (si) si.focus();
      return;
    }
    if (a === 'goto-codex') { if (onGotoCodexEntry && bid) onGotoCodexEntry(bid); return; }
    if (a === 'focus') { gotoItem(bid); return; }
    if (c.p && !c.s) {
      if (a === 'palette-remove') {
        var users = art.styles.filter(function (st) { return st.paletteId === c.p.id; }).length;
        if (!global.confirm('Excluir a paleta "' + (c.p.name || 'sem nome') + '"?' + (users ? ' ' + users + ' estilo(s) ficam sem paleta.' : ''))) return;
        art.palettes = art.palettes.filter(function (x) { return x !== c.p; });
        art.styles.forEach(function (st) { if (st.paletteId === c.p.id) st.paletteId = null; });
        save(); render(); return;
      }
      if (a === 'palette-dup') {
        var cp = JSON.parse(JSON.stringify(c.p)); cp.id = mid('pal'); cp.name = (c.p.name || 'Paleta') + ' (cópia)';
        cp.colors.forEach(function (x) { x.id = mid('col'); }); cp.codexIds = [];
        art.palettes.splice(art.palettes.indexOf(c.p) + 1, 0, cp); save(); render(); return;
      }
      if (a === 'palette-copy') {
        var text = c.p.colors.map(function (x) { return x.hex.toUpperCase() + (x.name ? '  ' + x.name : '') + (x.role ? '  (' + x.role + ')' : ''); }).join('\n');
        copyText(text).then(function () { btn.classList.add('wp-btn-on'); setTimeout(function () { btn.classList.remove('wp-btn-on'); }, 900); });
        return;
      }
      if (a === 'color-add') {
        var nc = { id: mid('col'), name: '', hex: c.p.colors.length ? c.p.colors[c.p.colors.length - 1].hex : '#888888', role: '' };
        c.p.colors.push(nc); editingColor = nc.id; save(); render(); return;
      }
      if (a === 'codex-remove') { c.p.codexIds = c.p.codexIds.filter(function (x) { return x !== bid; }); save(); render(); return; }
      if (!c.c) return;
      var i = c.p.colors.indexOf(c.c);
      if (a === 'color-edit') { editingColor = editingColor === c.c.id ? null : c.c.id; render(); return; }
      if (a === 'color-remove') { c.p.colors.splice(i, 1); editingColor = null; save(); render(); return; }
      if (a === 'color-left' || a === 'color-right') {
        var j = i + (a === 'color-left' ? -1 : 1);
        if (j < 0 || j >= c.p.colors.length) return;
        c.p.colors[i] = c.p.colors[j]; c.p.colors[j] = c.c; save(); render(); return;
      }
      return;
    }
    if (c.s) {
      if (a === 'style-toggle') { expandedStyle = expandedStyle === c.s.id ? null : c.s.id; render(); return; }
      if (a === 'style-remove') {
        if (!global.confirm('Excluir o estilo "' + (c.s.name || 'sem nome') + '"?')) return;
        art.styles = art.styles.filter(function (x) { return x !== c.s; }); expandedStyle = null; save(); render(); return;
      }
      if (a === 'img-remove') { c.s.imageIds = c.s.imageIds.filter(function (x) { return x !== bid; }); save(); render(); return; }
      if (a === 'codex-remove') { c.s.codexIds = c.s.codexIds.filter(function (x) { return x !== bid; }); save(); render(); return; }
    }
  }

  function onInput(e) {
    var t = e.target, c = ctx(t);
    if (t.hasAttribute('data-aof')) { art.overview = t.value; save(); return; }
    var pf = t.getAttribute('data-apf'), sf = t.getAttribute('data-asf'), cf = t.getAttribute('data-acf');
    if (pf && c.p) { c.p[pf] = t.value; save(); return; }
    if (sf && c.s && t.tagName !== 'SELECT') {
      if (sf === 'elements' || sf === 'materials') c.s[sf] = t.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      else if (sf === 'dos' || sf === 'donts') c.s[sf] = t.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      else c.s[sf] = t.value;
      save(); return;
    }
    if (cf && c.c) {
      if (cf === 'name') { c.c.name = t.value; save(); return; }
      if (cf === 'hex') {
        c.c.hex = t.value.toLowerCase(); save();
        // atualiza só a amostra (o seletor de cor dispara "input" a cada movimento do mouse)
        var chip = t.closest('[data-color]').querySelector('.art-swatch-chip');
        chip.style.backgroundColor = c.c.hex; chip.style.color = textOn(c.c.hex);
        chip.querySelector('.art-swatch-hex').textContent = c.c.hex.toUpperCase();
        var hx = t.closest('[data-color]').querySelector('[data-acf="hexText"]'); if (hx) hx.value = c.c.hex.toUpperCase();
        return;
      }
      if (cf === 'hexText') {
        var v = t.value.trim(); if (v[0] !== '#') v = '#' + v;
        if (/^#[0-9a-f]{6}$/i.test(v)) { c.c.hex = v.toLowerCase(); save(); }
        return;
      }
    }
  }

  function onChangeEvt(e) {
    var t = e.target, c = ctx(t);
    if (t.hasAttribute('data-aa-upload') && c.s) { addImages(c.s, t.files); t.value = ''; return; }
    if (t.getAttribute('data-aa-add') === 'codex' && t.value) {
      var target = c.s || c.p;
      if (target && target.codexIds.indexOf(t.value) === -1) target.codexIds.push(t.value);
      save(); render(); return;
    }
    if (t.getAttribute('data-asf') === 'paletteId' && c.s) { c.s.paletteId = t.value || null; save(); render(); return; }
    if (t.getAttribute('data-acf') === 'role' && c.c) { c.c.role = t.value; save(); render(); return; }
    // Cor/hex/nomes mudam a faixa de cores, os títulos e a consistência — re-render ao sair do campo,
    // adiado pro foco já estar no próximo campo.
    if (t.hasAttribute('data-acf') || t.hasAttribute('data-apf') || t.hasAttribute('data-asf')) setTimeout(render, 0);
  }

  function gotoItem(id) {
    highlightId = id;
    if (styleById(id)) expandedStyle = id;
    render();
    var el = root.querySelector('[data-palette="' + id + '"], [data-style="' + id + '"]');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(function () { if (highlightId === id) { highlightId = null; var h = root.querySelector('.art-highlight'); if (h) h.classList.remove('art-highlight'); } }, 1800);
  }

  function mount(container, opts) {
    root = container;
    art = opts.art;
    codexRef = opts.codex;
    onChange = opts.onChange;
    onGotoCodexEntry = opts.onGotoCodexEntry;
    root.innerHTML =
      '<section class="builder-section">' +
      '  <div class="mb-8 text-center">' +
      '    <div class="hero-badge">' + GDC.icon('palette', { size: 14, className: 'text-pink-400' }) + 'Consistência visual</div>' +
      '    <h2 class="font-display text-3xl font-bold text-primary">Direção de arte</h2>' +
      '    <p class="mt-2 text-secondary">Paletas e estilos estruturados, ligados ao Codex — pra que cada ambiente, personagem e tecnologia siga as mesmas regras.</p>' +
      '  </div>' +
      '  <div id="art-body" class="art-body"></div>' +
      '  <div class="tab-help-note">' + GDC.icon('info', { size: 16 }) +
      '    <p><strong>Como funciona:</strong> cada paleta tem cores com nome, hex e papel (Base, Destaque, Sombra, Luz, Interface...) — clique numa cor pra editar. Estilos reúnem conceito, elementos, materiais, regras de faça/evite, uma paleta e imagens de referência. Ligue paletas e estilos às entradas do Codex (ex.: paleta "Wastelands" no local Wastelands) e elas aparecem na leitura da entrada. "Consistência" aponta cores quase iguais em paletas diferentes, contraste fraco entre Interface e Base e estilos sem paleta. Pra moodboard livre, use o Mural.</p>' +
      '  </div>' +
      '</section>';
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChangeEvt);
    root.addEventListener('dragover', function (e) { if (e.target.closest('.art-refs')) e.preventDefault(); });
    root.addEventListener('drop', function (e) {
      var zone = e.target.closest('.art-refs');
      if (!zone) return;
      e.preventDefault();
      var s = ctx(zone).s;
      if (s && e.dataTransfer) addImages(s, e.dataTransfer.files);
    });
    render();
  }

  function reset(newArt, newCodex) {
    art = newArt;
    if (newCodex) codexRef = newCodex;
    expandedStyle = null; editingColor = null; overviewEditing = false;
    render();
  }

  GDC.ui.artDirection = { mount: mount, reset: reset, render: render, gotoItem: gotoItem };
  GDC.artDirection = { analyze: analyze, linksFor: linksFor, contrast: contrast, deltaE: deltaE };
}(window));
