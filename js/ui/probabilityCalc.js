/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var MAX_FACES = 20;
  var WEIGHT_LIMITS = { min: 0, max: 99 };
  var DEFAULT_FACES = [
    { label: 'Resultado A', weight: 1 },
    { label: 'Resultado B', weight: 1 },
    { label: 'Resultado C', weight: 1 },
  ];
  var FACE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#f43f5e', '#06b6d4', '#84cc16'];

  function clamp(n, min, max) {
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function makeFaceId() {
    return 'face-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function parseStored(value) {
    if (!value) return { faces: DEFAULT_FACES.map(function (f) { return Object.assign({ id: makeFaceId() }, f); }) };
    try {
      var parsed = JSON.parse(value);
      var faces = Array.isArray(parsed.faces) ? parsed.faces : [];
      faces = faces.slice(0, MAX_FACES).map(function (f) {
        return {
          id: (f && typeof f.id === 'string') ? f.id : makeFaceId(),
          label: (f && typeof f.label === 'string') ? f.label.slice(0, 40) : 'Resultado',
          weight: clamp(Number(f && f.weight), WEIGHT_LIMITS.min, WEIGHT_LIMITS.max),
        };
      });
      if (!faces.length) faces = DEFAULT_FACES.map(function (f) { return Object.assign({ id: makeFaceId() }, f); });
      return { faces: faces };
    } catch (e) {
      return { faces: DEFAULT_FACES.map(function (f) { return Object.assign({ id: makeFaceId() }, f); }) };
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtPct(n) {
    return (Math.round(n * 10) / 10).toString().replace('.', ',') + '%';
  }

  function render(container, onChange) {
    var state = parseStored(container.getAttribute('data-value'));

    container.innerHTML =
      '<div class="space-y-4">' +
      '  <p class="text-xs text-muted">Descreva os resultados possíveis de um dado, spinner ou sorteio e o peso de cada um (quantos "lados"/segmentos ele ocupa) — a probabilidade de cada resultado é calculada automaticamente.</p>' +
      '  <div id="pc-rows" class="space-y-2"></div>' +
      '  <button type="button" id="pc-add-face" class="btn-ghost py-1.5 text-xs">' + GDC.icon('plus', { size: 14 }) + 'Adicionar resultado</button>' +
      '  <div class="rounded-xl border border-default p-4">' +
      '    <div id="pc-bars" class="space-y-2"></div>' +
      '  </div>' +
      '  <p id="pc-total" class="text-xs text-muted"></p>' +
      '</div>';

    var rowsEl = container.querySelector('#pc-rows');
    var barsEl = container.querySelector('#pc-bars');
    var totalEl = container.querySelector('#pc-total');
    var addBtn = container.querySelector('#pc-add-face');

    function persist() {
      onChange(JSON.stringify({ faces: state.faces.map(function (f) { return { id: f.id, label: f.label, weight: f.weight }; }) }));
    }

    function repaint() {
      var totalWeight = state.faces.reduce(function (s, f) { return s + f.weight; }, 0);

      rowsEl.innerHTML = state.faces.map(function (f, i) {
        return (
          '<div class="flex items-center gap-2" data-face-row="' + f.id + '">' +
          '  <span class="h-2.5 w-2.5 flex-shrink-0 rounded-full" style="background-color:' + FACE_COLORS[i % FACE_COLORS.length] + '"></span>' +
          '  <input type="text" class="input-field py-1.5 text-xs flex-1" data-face-label="' + f.id + '" value="' + escapeHtml(f.label) + '" placeholder="Nome do resultado" />' +
          '  <input type="number" min="' + WEIGHT_LIMITS.min + '" max="' + WEIGHT_LIMITS.max + '" class="input-field py-1.5 text-xs w-16" data-face-weight="' + f.id + '" value="' + f.weight + '" title="Peso (nº de segmentos)" />' +
          '  <span class="text-xs text-muted w-14 text-right">' + (totalWeight > 0 ? fmtPct((f.weight / totalWeight) * 100) : '—') + '</span>' +
          '  <button type="button" class="text-muted hover:text-rose-500" data-remove-face="' + f.id + '" title="Remover" ' + (state.faces.length <= 1 ? 'disabled' : '') + '>' + GDC.icon('x', { size: 12 }) + '</button>' +
          '</div>'
        );
      }).join('');

      barsEl.innerHTML = state.faces.map(function (f, i) {
        var pct = totalWeight > 0 ? (f.weight / totalWeight) * 100 : 0;
        return (
          '<div class="flex items-center gap-2">' +
          '  <span class="text-xs text-secondary w-24 truncate" title="' + escapeHtml(f.label) + '">' + escapeHtml(f.label || 'Resultado') + '</span>' +
          '  <div class="flex-1 h-3 rounded-full bg-black/10 overflow-hidden">' +
          '    <div style="width:' + pct + '%;height:100%;background-color:' + FACE_COLORS[i % FACE_COLORS.length] + '"></div>' +
          '  </div>' +
          '  <span class="text-xs text-muted w-14 text-right">' + fmtPct(pct) + '</span>' +
          '</div>'
        );
      }).join('');

      totalEl.textContent = totalWeight + ' segmento' + (totalWeight === 1 ? '' : 's') + ' no total (peso somado de todos os resultados)' +
        (totalWeight === 0 ? ' — defina pelo menos um peso maior que zero.' : '.');

      addBtn.disabled = state.faces.length >= MAX_FACES;

      rowsEl.querySelectorAll('[data-face-label]').forEach(function (el) {
        el.addEventListener('input', function () {
          var id = el.getAttribute('data-face-label');
          state.faces = state.faces.map(function (f) { return f.id === id ? Object.assign({}, f, { label: el.value.slice(0, 40) }) : f; });
          persist();
          // Só reescreve as barras/percentuais (não os inputs, pra não perder o foco durante a digitação).
          repaintBarsOnly();
        });
      });
      rowsEl.querySelectorAll('[data-face-weight]').forEach(function (el) {
        el.addEventListener('input', function () {
          var id = el.getAttribute('data-face-weight');
          var w = clamp(Number(el.value), WEIGHT_LIMITS.min, WEIGHT_LIMITS.max);
          state.faces = state.faces.map(function (f) { return f.id === id ? Object.assign({}, f, { weight: w }) : f; });
          persist();
          repaint();
        });
      });
      rowsEl.querySelectorAll('[data-remove-face]').forEach(function (el) {
        el.addEventListener('click', function () {
          if (state.faces.length <= 1) return;
          var id = el.getAttribute('data-remove-face');
          state.faces = state.faces.filter(function (f) { return f.id !== id; });
          persist();
          repaint();
        });
      });
    }

    function repaintBarsOnly() {
      var totalWeight = state.faces.reduce(function (s, f) { return s + f.weight; }, 0);
      barsEl.innerHTML = state.faces.map(function (f, i) {
        var pct = totalWeight > 0 ? (f.weight / totalWeight) * 100 : 0;
        return (
          '<div class="flex items-center gap-2">' +
          '  <span class="text-xs text-secondary w-24 truncate" title="' + escapeHtml(f.label) + '">' + escapeHtml(f.label || 'Resultado') + '</span>' +
          '  <div class="flex-1 h-3 rounded-full bg-black/10 overflow-hidden">' +
          '    <div style="width:' + pct + '%;height:100%;background-color:' + FACE_COLORS[i % FACE_COLORS.length] + '"></div>' +
          '  </div>' +
          '  <span class="text-xs text-muted w-14 text-right">' + fmtPct(pct) + '</span>' +
          '</div>'
        );
      }).join('');
    }

    addBtn.addEventListener('click', function () {
      if (state.faces.length >= MAX_FACES) return;
      state.faces = state.faces.concat([{ id: makeFaceId(), label: 'Resultado', weight: 1 }]);
      persist();
      repaint();
    });

    repaint();
  }

  GDC.ui.probabilityCalc = { render: render };
}(window));
