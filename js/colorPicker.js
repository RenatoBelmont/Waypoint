/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};

  // ---------------------------------------------------------------------------------------------
  // Seletor de cor PADRÃO do app (nasceu no Designer de Cartas, que tinha o mais completo):
  // quadrado de saturação/brilho + matiz + HEX + conta-gotas + Recentes + Favoritas e, só onde faz
  // sentido montar combinações (Designer de Cartas e paletas da Direção de arte), Harmonia.
  //
  // Todo <input type="color"> do app passa a abrir ESTE seletor no lugar do nativo (cada navegador
  // tem o seu, e cada ferramenta acabava com uma cara diferente). O input continua sendo a fonte do
  // valor: a cada mudança recebe o hex e dispara 'input'; ao fechar, dispara 'change' — exatamente
  // os eventos do nativo, então nenhum módulo precisou mudar sua lógica. Exceções:
  //   - input com [data-native-color] ou dentro de [data-native-color] → mantém o nativo;
  //   - Harmonia: input com [data-color-harmony] (ou dentro de um container com esse atributo).
  // ---------------------------------------------------------------------------------------------

  var FAVORITES = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#06b6d4',
    '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#78716c', '#a8a29e', '#3f3f46', '#f5f5f4',
  ];
  var RECENT_KEY = 'gdc:recentColors';

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

  function hexToRgb(hex) {
    var h = String(hex || '#000000').replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var num = parseInt(h, 16) || 0;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      var s = clamp(Math.round(v), 0, 255).toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('');
  }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }
  function hsvToRgb(h, s, v) {
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; } else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }
  function hueToHex(h, s, v) { var r = hsvToRgb(((h % 360) + 360) % 360, s, v); return rgbToHex(r.r, r.g, r.b); }

  var HARMONY_SCHEMES = [
    { id: 'comp', label: 'Complementar', angles: [0, 180] },
    { id: 'analog', label: 'Análogos', angles: [-30, 0, 30] },
    { id: 'triad', label: 'Tríade', angles: [0, 120, 240] },
    { id: 'splitcomp', label: 'Compl. dividido', angles: [0, 150, 210] },
    { id: 'square', label: 'Quadrado', angles: [0, 90, 180, 270] },
    { id: 'mono', label: 'Monocromático', angles: null },
  ];
  /** Ícone (roda com pontinhos nas posições do esquema) pra reconhecer cada harmonia sem ler. */
  function harmonySchemeIconSvg(scheme) {
    if (!scheme.angles) {
      return '<svg viewBox="0 0 20 20" width="14" height="14"><defs><linearGradient id="wp-cp-mono-grad" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="currentColor" stop-opacity=".15"/><stop offset="100%" stop-color="currentColor" stop-opacity="1"/></linearGradient></defs>' +
        '<rect x="6" y="2" width="8" height="16" rx="2" fill="url(#wp-cp-mono-grad)"/></svg>';
    }
    var dots = scheme.angles.map(function (deg) {
      var rad = deg * Math.PI / 180;
      return '<circle cx="' + (10 + 7 * Math.sin(rad)).toFixed(1) + '" cy="' + (10 - 7 * Math.cos(rad)).toFixed(1) + '" r="2.4" fill="currentColor"/>';
    }).join('');
    return '<svg viewBox="0 0 20 20" width="14" height="14"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>' + dots + '</svg>';
  }
  /** Cores de uma harmonia clássica a partir do HSV atual (a cor atual vem sempre primeiro). */
  function harmonyColors(schemeId, hsv) {
    var h = hsv.h, s = hsv.s || 0.65, v = hsv.v || 0.9;
    if (schemeId === 'comp') return [hueToHex(h, s, v), hueToHex(h + 180, s, v)];
    if (schemeId === 'analog') return [hueToHex(h - 30, s, v), hueToHex(h, s, v), hueToHex(h + 30, s, v)];
    if (schemeId === 'triad') return [hueToHex(h, s, v), hueToHex(h + 120, s, v), hueToHex(h + 240, s, v)];
    if (schemeId === 'splitcomp') return [hueToHex(h, s, v), hueToHex(h + 150, s, v), hueToHex(h + 210, s, v)];
    if (schemeId === 'square') return [hueToHex(h, s, v), hueToHex(h + 90, s, v), hueToHex(h + 180, s, v), hueToHex(h + 270, s, v)];
    if (schemeId === 'mono') return [0.3, 0.5, 0.7, 0.85, 1].map(function (vv) { return hueToHex(h, s, vv); });
    return [hueToHex(h, s, v)];
  }

  function swatch(c, active) {
    return '<button type="button" class="card-designer-swatch' + (active ? ' card-designer-swatch-active' : '') + '" style="background-color:' + c + '" data-swatch-color="' + c + '" title="' + c + '"></button>';
  }

  // ---------- Recentes (globais; o Designer de Cartas passa as do baralho) ----------
  function globalRecent() {
    try { var a = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(a) ? a.filter(function (c) { return /^#[0-9a-f]{6}$/i.test(c); }).slice(0, 10) : []; } catch (e) { return []; }
  }
  function recordGlobalRecent(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
    var h = hex.toLowerCase();
    try { localStorage.setItem(RECENT_KEY, JSON.stringify([h].concat(globalRecent().filter(function (c) { return c.toLowerCase() !== h; })).slice(0, 10))); } catch (e) { /* sem storage */ }
  }

  // ---------- Popover ----------
  var activePop = null, activeOnClose = null;
  function close() {
    if (!activePop) return;
    var fn = activeOnClose, pop = activePop;
    activePop = null; activeOnClose = null;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    if (pop.parentNode) pop.parentNode.removeChild(pop);
    if (fn) { try { fn(); } catch (e) { /* nunca trava o fechamento */ } }
  }
  function onOutside(e) { if (activePop && !activePop.contains(e.target) && e.target !== activePop.__anchor) close(); }
  function onKey(e) { if (e.key === 'Escape' && activePop) { e.preventDefault(); e.stopPropagation(); close(); } }

  /** Abre o seletor ancorado em `anchorEl`. opts: { onPick(hex) (ao vivo, no máx. 1×/frame),
   *  onClose(finalHex), recent: [hex] (padrão: recentes globais), harmony: bool } */
  function open(anchorEl, currentColor, opts) {
    opts = opts || {};
    close();
    if (!/^#[0-9a-f]{6}$/i.test(currentColor || '')) currentColor = '#000000';
    var rgb = hexToRgb(currentColor), hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    var activeScheme = 'comp';
    var recent = opts.recent || globalRecent();
    var eyedropper = typeof global.EyeDropper === 'function';
    var pop = document.createElement('div');
    pop.className = 'card-designer-color-popover wp-color-popover';
    pop.__anchor = anchorEl;
    pop.innerHTML =
      '<div class="card-designer-color-square" data-cp-square><div class="card-designer-color-square-sat"></div><div class="card-designer-color-square-val"></div><div class="card-designer-color-cursor" data-cp-cursor></div></div>' +
      '<div class="card-designer-color-hue" data-cp-hue><div class="card-designer-color-hue-thumb" data-cp-hue-thumb></div></div>' +
      '<div class="card-designer-color-hex-row"><span class="card-designer-color-hex-label">HEX</span>' +
      '<input type="text" class="input-field py-1 text-xs" data-cp-hex value="' + escapeAttr(currentColor) + '" maxlength="7" />' +
      (eyedropper ? '<button type="button" class="btn-ghost h-7 w-7 p-0" data-cp-eyedropper title="Conta-gotas — escolher uma cor de qualquer lugar da tela">' + GDC.icon('crosshair', { size: 14 }) + '</button>' : '') +
      '</div>' +
      (recent.length ? '<p class="card-designer-color-section-label">Recentes</p><div class="card-designer-palette" data-cp-recent>' + recent.map(function (c) { return swatch(c); }).join('') + '</div>' : '') +
      '<p class="card-designer-color-section-label">Favoritas</p><div class="card-designer-palette" data-cp-favorites>' + FAVORITES.map(function (c) { return swatch(c); }).join('') + '</div>' +
      (opts.harmony ? '<p class="card-designer-color-section-label">Harmonia</p><div class="card-designer-color-harmony-tabs">' +
        HARMONY_SCHEMES.map(function (s) { return '<button type="button" class="card-designer-color-harmony-tab' + (s.id === activeScheme ? ' card-designer-color-harmony-tab-active' : '') + '" data-cp-scheme="' + s.id + '">' + harmonySchemeIconSvg(s) + s.label + '</button>'; }).join('') +
        '</div><div class="card-designer-palette" data-cp-harmony-row></div>' : '');
    // filho direto do body: fica acima de modais e da tela cheia (que é CSS, js/telaCheia.js)
    document.body.appendChild(pop);
    activePop = pop;
    activeOnClose = function () { var hx = currentHex(); if (opts.onClose) opts.onClose(hx); };

    var rect = anchorEl.getBoundingClientRect(), popW = 272, popH = Math.min(opts.harmony ? 470 : 380, window.innerHeight - 16);
    var left = Math.min(rect.left, window.innerWidth - popW - 12), top = rect.bottom + 6;
    if (top + popH > window.innerHeight) top = Math.max(8, rect.top - popH - 6);
    pop.style.left = Math.max(8, left) + 'px'; pop.style.top = top + 'px';

    var squareEl = pop.querySelector('[data-cp-square]'), cursorEl = pop.querySelector('[data-cp-cursor]');
    var hueEl = pop.querySelector('[data-cp-hue]'), hueThumbEl = pop.querySelector('[data-cp-hue-thumb]');
    var hexInput = pop.querySelector('[data-cp-hex]'), harmonyRowEl = pop.querySelector('[data-cp-harmony-row]');

    function currentHex() { var r = hsvToRgb(hsv.h, hsv.s, hsv.v); return rgbToHex(r.r, r.g, r.b); }
    function setHex(hex) { var r = hexToRgb(hex); hsv = rgbToHsv(r.r, r.g, r.b); paint(); commit(); }
    function paint(skipHex) {
      var pure = hsvToRgb(hsv.h, 1, 1);
      squareEl.style.backgroundColor = rgbToHex(pure.r, pure.g, pure.b);
      cursorEl.style.left = (hsv.s * 100) + '%'; cursorEl.style.top = ((1 - hsv.v) * 100) + '%';
      hueThumbEl.style.left = (hsv.h / 360 * 100) + '%';
      var hex = currentHex();
      if (!skipHex) hexInput.value = hex;
      if (harmonyRowEl) harmonyRowEl.innerHTML = harmonyColors(activeScheme, hsv).map(function (c) { return swatch(c); }).join('');
      pop.querySelectorAll('.card-designer-swatch').forEach(function (sw) { sw.classList.toggle('card-designer-swatch-active', sw.getAttribute('data-swatch-color').toLowerCase() === hex.toLowerCase()); });
    }
    // arrastar dispara dezenas de eventos por segundo; quem recebe (re-render, persistência) é caro —
    // o feedback interno é imediato, a propagação pra fora é no máximo 1×/frame
    var scheduled = false;
    function commit() {
      if (scheduled) return; scheduled = true;
      (global.requestAnimationFrame || setTimeout)(function () { scheduled = false; if (activePop === pop && opts.onPick) opts.onPick(currentHex()); });
    }
    pop.addEventListener('click', function (e) {
      var sw = e.target.closest('[data-swatch-color]'); if (sw) { setHex(sw.getAttribute('data-swatch-color')); return; }
      var tab = e.target.closest('[data-cp-scheme]');
      if (tab) { activeScheme = tab.getAttribute('data-cp-scheme'); pop.querySelectorAll('[data-cp-scheme]').forEach(function (t) { t.classList.toggle('card-designer-color-harmony-tab-active', t === tab); }); paint(); return; }
      if (e.target.closest('[data-cp-eyedropper]')) {
        var ed; try { ed = new global.EyeDropper(); } catch (err) { return; }
        ed.open().then(function (res) { setHex(res.sRGBHex); }).catch(function () { /* cancelado */ });
      }
    });
    function bindDrag(el, fn) {
      el.addEventListener('mousedown', function (e) {
        e.preventDefault(); fn(e);
        var move = function (ev) { fn(ev); };
        var up = function () { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      });
    }
    bindDrag(squareEl, function (e) { var r = squareEl.getBoundingClientRect(); hsv.s = clamp((e.clientX - r.left) / r.width, 0, 1); hsv.v = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); paint(); commit(); });
    bindDrag(hueEl, function (e) { var r = hueEl.getBoundingClientRect(); hsv.h = clamp((e.clientX - r.left) / r.width, 0, 1) * 359.9; paint(); commit(); });
    hexInput.addEventListener('input', function () {
      var v = hexInput.value.trim(); if (v[0] !== '#') v = '#' + v;
      if (!/^#[0-9a-f]{6}$/i.test(v)) return;
      var r = hexToRgb(v); hsv = rgbToHsv(r.r, r.g, r.b); paint(true); commit();
    });
    hexInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); close(); } });

    paint();
    setTimeout(function () {
      if (activePop !== pop) return;
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }, 0);
    return pop;
  }

  // ---------- Todo <input type="color"> do app abre o seletor padrão ----------
  /** Seletor estável pra reencontrar o input se o módulo re-renderizar no meio da edição. */
  function selectorFor(input) {
    var parts = ['input[type="color"]'];
    Array.prototype.forEach.call(input.attributes, function (a) {
      if (a.name.indexOf('data-') === 0) parts.push('[' + a.name + '="' + String(a.value).replace(/"/g, '\\"') + '"]');
    });
    if (input.id) parts.push('#' + (global.CSS && CSS.escape ? CSS.escape(input.id) : input.id));
    return parts.length > 1 ? parts.join('') : null;
  }
  function openForInput(input) {
    var sel = selectorFor(input), initial = input.value;
    var current = function () { if (input.isConnected || !sel) return input; return document.querySelector(sel) || input; };
    var anchor = input.getBoundingClientRect().width ? input : (input.closest('label') || input.parentElement || input);
    var harmony = !!input.closest('[data-color-harmony]');
    open(anchor, input.value, {
      harmony: harmony,
      onPick: function (hex) {
        var el = current(); el.value = hex;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      onClose: function (hex) {
        var el = current();
        if (hex.toLowerCase() !== String(initial).toLowerCase()) { recordGlobalRecent(hex); el.dispatchEvent(new Event('change', { bubbles: true })); }
      },
    });
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'color' || t.disabled) return;
    if (t.closest('[data-native-color]') || t.classList.contains('card-designer-color-input-hidden')) return;
    e.preventDefault(); // não abre o seletor nativo
    if (activePop && activePop.__anchor && (activePop.__anchor === t || activePop.__anchor.contains(t))) { close(); return; }
    openForInput(t);
  }, true);

  GDC.colorPicker = {
    open: open, close: close, openForInput: openForInput, FAVORITES: FAVORITES,
    harmonyColors: harmonyColors, hexToRgb: hexToRgb, rgbToHex: rgbToHex, rgbToHsv: rgbToHsv, hsvToRgb: hsvToRgb,
    isOpen: function () { return !!activePop; },
  };
}(window));
