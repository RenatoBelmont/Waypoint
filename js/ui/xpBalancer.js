/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var DEFAULTS = { base: 100, exponent: 1.5, maxLevel: 20 };
  var LIMITS = {
    base: { min: 10, max: 5000 },
    exponent: { min: 1, max: 4 },
    maxLevel: { min: 2, max: 200 },
  };

  function clamp(n, min, max) {
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function parseStored(value) {
    if (!value) return Object.assign({}, DEFAULTS);
    try {
      var parsed = JSON.parse(value);
      return {
        base: clamp(Number(parsed.base), LIMITS.base.min, LIMITS.base.max),
        exponent: clamp(Number(parsed.exponent), LIMITS.exponent.min, LIMITS.exponent.max),
        maxLevel: clamp(Math.round(Number(parsed.maxLevel)), LIMITS.maxLevel.min, LIMITS.maxLevel.max),
      };
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }

  function xpForLevel(level, base, exponent) {
    return Math.max(0, Math.floor(base * Math.pow(level, exponent)));
  }

  function fmt(n) {
    return n.toLocaleString('pt-BR');
  }

  function render(container, onChange) {
    var state = parseStored(container.getAttribute('data-value'));

    container.innerHTML =
      '<div class="space-y-4">' +
      '  <div class="flex flex-wrap items-end gap-3">' +
      '    <label class="text-xs text-secondary">XP base<input type="number" min="' + LIMITS.base.min + '" max="' + LIMITS.base.max + '" id="xp-base" value="' + state.base + '" class="input-field mt-1 w-24 py-1.5 text-xs" /></label>' +
      '    <label class="text-xs text-secondary">Expoente<input type="number" min="' + LIMITS.exponent.min + '" max="' + LIMITS.exponent.max + '" step="0.1" id="xp-exp" value="' + state.exponent + '" class="input-field mt-1 w-20 py-1.5 text-xs" /></label>' +
      '    <label class="text-xs text-secondary">Nível máximo<input type="number" min="' + LIMITS.maxLevel.min + '" max="' + LIMITS.maxLevel.max + '" id="xp-max" value="' + state.maxLevel + '" class="input-field mt-1 w-20 py-1.5 text-xs" /></label>' +
      '  </div>' +
      '  <p class="flex items-center gap-1.5 text-muted" style="font-size:11px">' + GDC.icon('alert-triangle', { size: 12 }) +
      '    Valores fora da faixa são ajustados automaticamente (base ' + LIMITS.base.min + '–' + LIMITS.base.max + ', expoente ' + LIMITS.exponent.min + '–' + LIMITS.exponent.max + ', nível ' + LIMITS.maxLevel.min + '–' + LIMITS.maxLevel.max + ').</p>' +
      '  <div class="rounded-xl border border-default p-4">' +
      '    <div class="xp-chart-track" id="xp-chart"></div>' +
      '    <div class="mt-2 flex justify-between text-muted" style="font-size:10px"><span>Nv 1</span><span id="xp-max-label">Nv ' + state.maxLevel + '</span></div>' +
      '  </div>' +
      '  <div class="grid grid-cols-3 gap-3 text-center" id="xp-stats"></div>' +
      '  <p class="inline-flex items-center gap-1.5 text-xs text-muted" id="xp-formula">' + GDC.icon('trending-up', { size: 14 }) + '</p>' +
      '</div>';

    var baseInput = container.querySelector('#xp-base');
    var expInput = container.querySelector('#xp-exp');
    var maxInput = container.querySelector('#xp-max');
    var chartEl = container.querySelector('#xp-chart');
    var statsEl = container.querySelector('#xp-stats');
    var formulaEl = container.querySelector('#xp-formula');
    var maxLabelEl = container.querySelector('#xp-max-label');

    function repaint() {
      var levels = [];
      for (var i = 1; i <= state.maxLevel; i++) levels.push(i);
      var xpValues = levels.map(function (lvl) { return xpForLevel(lvl, state.base, state.exponent); });
      var totalXp = xpValues.reduce(function (s, v) { return s + v; }, 0);
      var maxXp = Math.max.apply(null, xpValues.concat([1]));

      chartEl.innerHTML = xpValues.map(function (xp) {
        var pct = (xp / maxXp) * 100;
        return (
          '<div class="xp-bar-wrap">' +
          '  <div class="xp-bar" style="height:' + pct + '%"></div>' +
          '  <span class="xp-bar-label">' + xp + '</span>' +
          '</div>'
        );
      }).join('');

      maxLabelEl.textContent = 'Nv ' + state.maxLevel;

      statsEl.innerHTML =
        '<div class="xp-stat"><p class="font-display text-lg font-bold text-primary">' + fmt(totalXp) + '</p><p class="text-xs text-muted">XP total</p></div>' +
        '<div class="xp-stat"><p class="font-display text-lg font-bold text-primary">' + fmt(xpValues[state.maxLevel - 1] || 0) + '</p><p class="text-xs text-muted">Nível final</p></div>' +
        '<div class="xp-stat"><p class="font-display text-lg font-bold text-primary">' + fmt(Math.round(totalXp / state.maxLevel)) + '</p><p class="text-xs text-muted">Média por nível</p></div>';

      formulaEl.innerHTML = GDC.icon('trending-up', { size: 14 }) + 'Curva de XP: ' + state.base + ' × nível^' + state.exponent;
    }

    function update(rawBase, rawExp, rawMax) {
      state.base = clamp(rawBase, LIMITS.base.min, LIMITS.base.max);
      state.exponent = clamp(rawExp, LIMITS.exponent.min, LIMITS.exponent.max);
      state.maxLevel = clamp(Math.round(rawMax), LIMITS.maxLevel.min, LIMITS.maxLevel.max);
      repaint();
      onChange(JSON.stringify({ base: state.base, exponent: state.exponent, maxLevel: state.maxLevel }));
    }

    baseInput.addEventListener('input', function () { update(Number(baseInput.value), state.exponent, state.maxLevel); });
    expInput.addEventListener('input', function () { update(state.base, Number(expInput.value), state.maxLevel); });
    maxInput.addEventListener('input', function () { update(state.base, state.exponent, Number(maxInput.value)); });

    repaint();
  }

  GDC.ui.xpBalancer = { render: render };
}(window));
