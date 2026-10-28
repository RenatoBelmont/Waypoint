/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // ---------------------------------------------------------------------------------------------
  // Atlas — mapas de MUNDO (terreno pintado, carimbos, rótulos, regiões, caminhos, rosa dos ventos,
  // grade com coordenadas) e plantas RADIAIS (anéis divididos em setores + ramais radiais, ex.: o
  // cidade circular, base, estação), com as mesmas camadas por cima. Inspirado no fluxo do Inkarnate: pinta o terreno com
  // pincel texturizado, espalha carimbos, nomeia regiões. Tudo vetorial (traços, pontos) — o
  // documento continua JSON leve e o export redesenha em qualquer resolução.
  //
  // Dados: doc.atlas (normalizeAtlas em data.js). Mutação sempre via mutate() (desfazer por mapa).
  // Desempenho: o terreno é desenhado num canvas de cache do tamanho da tela e só refeito quando a
  // vista ou os traços mudam; durante a pintura, o segmento novo é desenhado direto no cache.
  // ---------------------------------------------------------------------------------------------

  var TERRAINS = [
    { id: 'sand', label: 'Areia', base: '#d8bf8a', fleck: '#b89a62', kind: 'dots' },
    { id: 'rock', label: 'Rocha', base: '#8c8479', fleck: '#5f574d', kind: 'cracks' },
    { id: 'scorched', label: 'Terra queimada', base: '#5e4838', fleck: '#2f241b', kind: 'specks' },
    { id: 'grass', label: 'Vegetação', base: '#6b8f4e', fleck: '#4c6b36', kind: 'tufts' },
    { id: 'mutant', label: 'Vegetação mutante', base: '#6d7b3a', fleck: '#8b4fa8', kind: 'blobs' },
    { id: 'water', label: 'Água', base: '#4b86ad', fleck: '#8fc0de', kind: 'waves' },
    { id: 'acid', label: 'Ácido / radiação', base: '#79c443', fleck: '#d4ff7a', kind: 'bubbles' },
    { id: 'ruins', label: 'Ruínas / asfalto', base: '#8e8a84', fleck: '#5c5955', kind: 'bricks' },
    { id: 'metal', label: 'Piso metálico', base: '#8f9aa5', fleck: '#6b7682', kind: 'plates' },
    { id: 'void', label: 'Espaço / vazio', base: '#121729', fleck: '#e2e8f0', kind: 'stars' },
  ];
  var TERRAIN_BY_ID = {};
  TERRAINS.forEach(function (t) { TERRAIN_BY_ID[t.id] = t; });

  // ---------- Pacote de terreno (js/terrainPack.js): texturas de imagem + pincéis de carimbo ----------
  // Texturas "px-*" pintam como as procedurais (padrão preso ao mundo); pincéis "bk-*" carimbam a
  // imagem ao longo do traço. Tudo em data: URI — imagem de arquivo local (file://) "suja" o canvas e
  // impediria o export em PNG.
  var PACK = GDC.TERRAIN_PACK || { textureCats: [], textures: [], brushes: [] };
  var PACK_TEX = {}, PACK_BR = {};
  PACK.textures.forEach(function (t) { PACK_TEX[t.id] = t; });
  PACK.brushes.forEach(function (b) { PACK_BR[b.id] = b; });
  // Carimbos de objetos em categorias próprias (js/stampPack.js) — mesmo motor dos carimbos do
  // pacote (giro, escala, opacidade), mas só aparecem na biblioteca do Carimbo, não no pincel.
  var OBJ = (GDC.STAMP_PACK && GDC.STAMP_PACK.items) || [];
  OBJ.forEach(function (o) { PACK_BR[o.id] = o; });
  var packImgs = {};
  function packImage(id) {
    var def = PACK_TEX[id] || PACK_BR[id];
    if (!def) return null;
    var e = packImgs[id];
    if (!e) {
      e = packImgs[id] = { img: new Image(), ok: false };
      e.img.onload = function () { e.ok = true; terrainKey = ''; if (typeof requestDraw === 'function') requestDraw(); };
      e.img.src = def.src;
    }
    return e.ok ? e.img : null;
  }
  /** Carrega (e decodifica) a imagem assim que ela é escolhida, pra primeira pincelada não engasgar. */
  function preloadPack(id) {
    if (!id || !(PACK_TEX[id] || PACK_BR[id])) return;
    packImage(id);
    var e = packImgs[id];
    if (e && !e.ok && e.img.decode) e.img.decode().then(function () { if (!e.ok) { e.ok = true; terrainKey = ''; requestDraw(); } }).catch(function () { /* onload cuida */ });
  }
  /** Terreno procedural ou textura do pacote → { id, label, base } (base = cor média, usada na borda macia). */
  function terrainInfo(tid) {
    if (TERRAIN_BY_ID[tid]) return TERRAIN_BY_ID[tid];
    var p = PACK_TEX[tid];
    if (p) return { id: p.id, label: p.name, base: p.avg || '#888888', pack: true };
    return TERRAINS[0];
  }
  function isTerrainId(tid) { return !!(TERRAIN_BY_ID[tid] || PACK_TEX[tid]); }
  function terrainThumb(tid) {
    if (PACK_TEX[tid]) return PACK_TEX[tid].src;
    var t = TERRAIN_BY_ID[tid] || TERRAINS[0];
    if (thumbCache[t.id]) return thumbCache[t.id];
    if (!tiles[t.id]) tiles[t.id] = makeTile(t);
    return (thumbCache[t.id] = tiles[t.id].toDataURL()); // toDataURL é caro — a barra se redesenha a cada troca
  }
  var thumbCache = {};

  var STYLES = {
    wasteland: { label: 'Árido', paper: '#cdb98f', paper2: '#a8926a', ink: '#3a2c1f', fill: '#efe2c2', grid: 'rgba(58,44,31,.22)' },
    parchment: { label: 'Pergaminho', paper: '#efe3c4', paper2: '#d9c79c', ink: '#4a3a26', fill: '#fbf5e4', grid: 'rgba(74,58,38,.2)' },
    blueprint: { label: 'Blueprint', grain: 0.6, paper: '#1d3b5c', paper2: '#16304c', ink: '#dbeafe', fill: '#2a5079', grid: 'rgba(219,234,254,.18)' },
    dark: { label: 'Escuro', paper: '#1b1d23', paper2: '#121418', ink: '#e5e7eb', fill: '#2a2d35', grid: 'rgba(229,231,235,.14)' },
  };

  var LABEL_STYLES = {
    region: { label: 'Região', font: "Georgia,'Times New Roman',serif", px: 64, weight: '700', upper: true, spacing: 0.35 },
    place: { label: 'Local', font: "Georgia,'Times New Roman',serif", px: 32, weight: '700', upper: false, spacing: 0.04 },
    small: { label: 'Detalhe', font: "system-ui,'Segoe UI',sans-serif", px: 20, weight: '500', upper: false, spacing: 0 },
  };
  var PATH_KINDS = { road: 'Estrada', trail: 'Trilha', river: 'Rio / canal', border: 'Fronteira' };

  var TOOLS = {
    select: { label: 'Selecionar e mover', icon: 'mouse-pointer-2', key: 'v', hint: 'Clique pra selecionar (carimbo, rótulo, região, caminho, rosa, setor) · arraste pra mover · Delete remove' },
    pan: { label: 'Mover a vista', icon: 'hand', key: 'h', hint: 'Arraste pra mover · roda do mouse aproxima · Espaço+arrastar funciona em qualquer ferramenta' },
    brush: { label: 'Pincel de terreno', icon: 'brush', key: 'b', hint: 'Pinte o terreno escolhido · traços novos cobrem os antigos' },
    eraser: { label: 'Borracha de terreno', icon: 'eraser', key: 'e', hint: 'Apaga só o terreno pintado (carimbos e textos ficam)' },
    stamp: { label: 'Carimbo', icon: 'stamp', key: 's', hint: 'Clique pra carimbar · com "Espalhar", arraste pra semear vários' },
    text: { label: 'Rótulo', icon: 'type', key: 't', hint: 'Clique e digite · Enter confirma · ajuste estilo e curva no painel' },
    region: { label: 'Região', icon: 'pentagon', key: 'r', hint: 'Clique ponto a ponto · duplo clique ou Enter fecha · Esc cancela' },
    path: { label: 'Caminho', icon: 'route', key: 'p', hint: 'Clique ponto a ponto · duplo clique ou Enter termina · Esc cancela' },
  };
  TOOLS.decal = { label: 'Pincel de carimbo', icon: 'spray-can', key: 'd', hint: 'Arraste pra carimbar a imagem ao longo do traço · cristas e margens seguem a direção em que você desenha' };
  TOOLS.tile = { label: 'Pintar peça', icon: 'paintbrush', key: 'b', hint: 'Clique ou arraste pra pintar hexágonos com a peça escolhida · ajuste o raio na barra' };
  TOOLS.fill = { label: 'Balde', icon: 'paint-bucket', key: 'g', hint: 'Preenche a área contígua de hexágonos iguais com a peça escolhida' };
  var TOOL_ORDER = ['select', 'pan', 'brush', 'decal', 'fill', 'eraser', 'stamp', 'text', 'region', 'path'];
  var HEX_TOOL_ORDER = ['select', 'pan', 'tile', 'fill', 'eraser', 'stamp', 'text', 'region', 'path'];
  function toolOrder() { var m = activeMap(); return m && m.kind === 'hex' ? HEX_TOOL_ORDER : TOOL_ORDER; }
  function toolHint(t) {
    var m = activeMap(), hex = m && m.kind === 'hex';
    if (t === 'eraser' && hex) return 'Apaga a peça dos hexágonos (carimbos e textos ficam)';
    if (t === 'fill' && !hex) return 'Preenche a área fechada com o terreno escolhido — vai até a borda de outro terreno ou do mapa';
    return TOOLS[t].hint;
  }
  // No mapa livre o G continua sendo "grade"; o balde fica no K.
  function keyOf(t) { var m = activeMap(); return (t === 'fill' && !(m && m.kind === 'hex')) ? 'k' : TOOLS[t].key; }
  var TOOL_LAYER = { brush: 'terrain', decal: 'terrain', eraser: 'terrain', tile: 'terrain', fill: 'terrain', stamp: 'stamps', text: 'labels', region: 'regions', path: 'paths' };
  var LAYER_LABELS = { terrain: 'Terreno', structure: 'Estrutura radial', regions: 'Regiões', paths: 'Caminhos', stamps: 'Carimbos', labels: 'Rótulos', decor: 'Grade e rosa dos ventos' };
  var SECTOR_COLORS = ['#f59e0b', '#10b981', '#8b5cf6', '#3b82f6', '#ec4899', '#14b8a6', '#f43f5e', '#84cc16', '#06b6d4', '#a855f7'];
  var STAMP_UNIT = 24; // unidades de mundo por "1" do desenho do carimbo (escala 1)
  var Z_MIN = 0.02, Z_MAX = 8;

  // ---------- Carimbos (desenhos vetoriais em [-1,1]) ----------
  // Cada função desenha com ctx já transladado/escalado; `ink` = traço, `fill` = preenchimento.
  function P(c, pts) { c.beginPath(); c.moveTo(pts[0], pts[1]); for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); }
  var STAMPS = {
    mountain: { label: 'Montanha', draw: function (c, ink, fill) {
      P(c, [-1, .8, -.25, -.85, .15, -.2, .4, -.55, 1, .8]); c.closePath(); c.fillStyle = fill; c.fill(); c.stroke();
      P(c, [-.25, -.85, -.1, -.3, -.35, .1, -.15, .5]); c.stroke(); } },
    hill: { label: 'Colina', draw: function (c, ink, fill) {
      c.beginPath(); c.moveTo(-1, .5); c.quadraticCurveTo(0, -.9, 1, .5); c.fillStyle = fill; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(.1, -.15); c.quadraticCurveTo(.45, .05, .55, .35); c.stroke(); } },
    crater: { label: 'Cratera', draw: function (c, ink, fill) {
      c.beginPath(); c.ellipse(0, 0, 1, .62, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); c.stroke();
      c.beginPath(); c.ellipse(0, .08, .55, .32, 0, 0, Math.PI * 2); c.stroke();
      for (var a = 0; a < 12; a++) { var t = a / 12 * Math.PI * 2; c.beginPath(); c.moveTo(Math.cos(t) * 1.02, Math.sin(t) * .64); c.lineTo(Math.cos(t) * 1.22, Math.sin(t) * .8); c.stroke(); } } },
    rock: { label: 'Rocha', draw: function (c, ink, fill) {
      P(c, [-.9, .6, -.7, -.1, -.2, -.6, .5, -.45, .9, .2, .7, .65]); c.closePath(); c.fillStyle = fill; c.fill(); c.stroke();
      P(c, [-.2, -.6, -.05, .1, .7, .65]); c.stroke(); } },
    tree: { label: 'Árvore', draw: function (c, ink, fill) {
      P(c, [0, .95, 0, .2]); c.stroke(); c.beginPath(); c.arc(0, -.25, .62, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); c.stroke(); } },
    pine: { label: 'Pinheiro', draw: function (c, ink, fill) {
      P(c, [0, -1, .6, .1, .3, .1, .75, .75, -.75, .75, -.3, .1, -.6, .1]); c.closePath(); c.fillStyle = fill; c.fill(); c.stroke(); P(c, [0, .75, 0, 1]); c.stroke(); } },
    deadtree: { label: 'Árvore morta', draw: function (c) {
      P(c, [0, 1, 0, -.4]); c.stroke(); P(c, [0, .2, -.55, -.35, -.75, -.3]); c.stroke(); P(c, [0, -.1, .5, -.7]); c.stroke(); P(c, [0, -.4, -.2, -.9]); c.stroke(); P(c, [.28, -.38, .55, -.32]); c.stroke(); } },
    ruin: { label: 'Ruína', draw: function (c, ink, fill) {
      P(c, [-.95, .8, -.95, -.4, -.6, -.6, -.55, -.1, -.2, -.2, -.15, .8]); c.closePath(); c.fillStyle = fill; c.fill(); c.stroke();
      P(c, [.15, .8, .15, -.75, .45, -.95, .5, -.3, .9, -.1, .9, .8]); c.closePath(); c.fill(); c.stroke();
      c.strokeRect(-.75, .1, .3, .3); c.strokeRect(.35, -.35, .3, .3); } },
    tower: { label: 'Torre', draw: function (c, ink, fill) {
      P(c, [-.35, .95, -.25, -.55, .25, -.55, .35, .95]); c.closePath(); c.fillStyle = fill; c.fill(); c.stroke();
      P(c, [-.5, -.55, 0, -1, .5, -.55]); c.closePath(); c.fill(); c.stroke(); c.strokeRect(-.1, -.25, .2, .3); } },
    building: { label: 'Prédio', draw: function (c, ink, fill) {
      c.fillStyle = fill; c.fillRect(-.7, -.7, 1.4, 1.6); c.strokeRect(-.7, -.7, 1.4, 1.6);
      for (var r = 0; r < 3; r++) for (var k = 0; k < 3; k++) c.strokeRect(-.5 + k * .38, -.5 + r * .42, .2, .22); } },
    city: { label: 'Cidade / vila', draw: function (c, ink, fill) {
      c.fillStyle = fill;
      [[-.95, -.1, .55, .9], [-.35, -.6, .5, 1.4], [.2, -.25, .7, 1.05], [-.6, .35, .5, .45]].forEach(function (b) { c.fillRect(b[0], b[1], b[2], b[3]); c.strokeRect(b[0], b[1], b[2], b[3]); }); } },
    dome: { label: 'Cúpula', draw: function (c, ink, fill) {
      c.beginPath(); c.arc(0, .55, .95, Math.PI, 0); c.closePath(); c.fillStyle = fill; c.fill(); c.stroke();
      c.beginPath(); c.arc(0, .55, .6, Math.PI, 0); c.stroke(); P(c, [0, -.4, 0, .55]); c.stroke(); P(c, [-.67, -.12, .67, -.12]); c.stroke(); } },
    bunker: { label: 'Bunker / porta', draw: function (c, ink, fill) {
      P(c, [-1, .7, -.8, -.2, .8, -.2, 1, .7]); c.closePath(); c.fillStyle = fill; c.fill(); c.stroke();
      c.beginPath(); c.arc(0, .7, .38, Math.PI, 0); c.stroke(); P(c, [-.38, .7, .38, .7]); c.stroke(); } },
    cave: { label: 'Caverna', draw: function (c, ink, fill) {
      P(c, [-1, .7, -.6, -.5, .1, -.8, .8, -.3, 1, .7]); c.closePath(); c.fillStyle = fill; c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-.4, .7); c.quadraticCurveTo(0, -.3, .4, .7); c.closePath(); c.fillStyle = ink; c.fill(); } },
    camp: { label: 'Acampamento', draw: function (c, ink, fill) {
      P(c, [-.9, .8, 0, -.7, .9, .8]); c.closePath(); c.fillStyle = fill; c.fill(); c.stroke(); P(c, [0, -.7, -.15, .8]); c.stroke(); P(c, [0, -.7, .2, -1]); c.stroke(); } },
    antenna: { label: 'Antena', draw: function (c) {
      P(c, [-.4, 1, 0, -.6, .4, 1]); c.stroke(); P(c, [-.25, .4, .25, .4]); c.stroke(); P(c, [-.15, 0, .15, 0]); c.stroke();
      [.35, .6].forEach(function (r) { c.beginPath(); c.arc(0, -.6, r, -2.4, -.75); c.stroke(); }); } },
    ship: { label: 'Nave', draw: function (c, ink, fill) {
      c.beginPath(); c.moveTo(0, -1); c.quadraticCurveTo(.45, -.4, .35, .55); c.lineTo(-.35, .55); c.quadraticCurveTo(-.45, -.4, 0, -1); c.fillStyle = fill; c.fill(); c.stroke();
      P(c, [-.35, .2, -.7, .8, -.3, .6]); c.stroke(); P(c, [.35, .2, .7, .8, .3, .6]); c.stroke(); c.beginPath(); c.arc(0, -.25, .15, 0, Math.PI * 2); c.stroke(); } },
    fungus: { label: 'Fungos', draw: function (c, ink, fill) {
      [[-.45, .2, .45], [.35, -.1, .55], [0, .55, .32]].forEach(function (m) {
        P(c, [m[0], m[1], m[0], m[1] + m[2]]); c.stroke();
        c.beginPath(); c.arc(m[0], m[1], m[2] * .75, Math.PI, 0); c.closePath(); c.fillStyle = fill; c.fill(); c.stroke(); }); } },
    danger: { label: 'Radiação / perigo', draw: function (c, ink, fill) {
      c.beginPath(); c.arc(0, 0, .95, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); c.stroke();
      c.fillStyle = ink;
      for (var k = 0; k < 3; k++) { var a0 = -Math.PI / 2 + k * Math.PI * 2 / 3 - .5; c.beginPath(); c.arc(0, 0, .78, a0, a0 + 1); c.arc(0, 0, .25, a0 + 1, a0, true); c.closePath(); c.fill(); }
      c.beginPath(); c.arc(0, 0, .14, 0, Math.PI * 2); c.fill(); } },
    poi: { label: 'Ponto de interesse', draw: function (c, ink, fill) {
      c.beginPath();
      for (var k = 0; k < 10; k++) { var r = k % 2 ? .42 : 1, a = -Math.PI / 2 + k * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.closePath(); c.fillStyle = fill; c.fill(); c.stroke(); } },
  };
  var STAMP_ORDER = Object.keys(STAMPS);

  // ---------- Estado ----------
  var root, atlas, onChange, projectType;
  var stageEl, canvas, ctx, wrapEl, textInput, statusEl, optbarEl;
  var dpr = 1, view = { x: 0, y: 0, z: 0.3 };
  var ui = { tool: 'brush', terrain: 'sand', brush: 120, stamp: 'mountain', stampScale: 2, scatter: false, labelStyle: 'place', pathKind: 'road', regionColor: '#dc2626', panelOpen: true, exportW: 4096, tileId: null, tileRadius: 1, decal: (PACK.brushes[0] || {}).id || null, opacity: 1, stampOpacity: 1, stampRot: 0, stampRandRot: false, recentTex: [], recentDecal: [] };
  var selected = null; // { type: 'stamp'|'label'|'region'|'path'|'compass'|'sector', id, ring, sector }
  var draft = null; // { type: 'stroke'|'region'|'path', pts: [] , item }
  var drag = null, spaceDown = false, history = {}, textEdit = null;
  var terrainCache = null, terrainKey = '', drawQueued = false, needsFit = false;
  var imgCache = {};
  var patternCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function mid(p) { return GDC.makeId(p); }

  // Visão: 'free' = mapas de mundo e plantas radiais; 'hex' = tilesets hexagonais. Os dois vivem no
  // mesmo doc.atlas; a visão só filtra a lista (e o mapa ativo cai pro 1º da visão).
  var mode = 'free';
  function inMode(m) { return mode === 'hex' ? m.kind === 'hex' : m.kind !== 'hex'; }
  function modeMaps() { return atlas ? atlas.maps.filter(inMode) : []; }
  function activeMap() {
    if (!atlas) return null;
    var a = atlas.maps.filter(function (m) { return m.id === atlas.activeId; })[0];
    return (a && inMode(a)) ? a : (modeMaps()[0] || null);
  }

  // ---------- Texturas procedurais ----------
  function rng(seed) { var s = seed % 2147483647; if (s <= 0) s += 2147483646; return function () { s = s * 16807 % 2147483647; return (s - 1) / 2147483646; }; }
  function hashStr(t) { var h = 7; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 1000003; return h + 1; }

  function lum(hex) { var n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; }
  function makeTile(t, variant) {
    var N = 256, cv = document.createElement('canvas'); cv.width = N; cv.height = N;
    var c = cv.getContext('2d'), r = rng(hashStr(t.id + (variant || '')));
    // Tudo é desenhado "dando a volta" nas bordas (9 deslocamentos), senão o que cruza a borda é
    // cortado e o ladrilho mostra emendas retas ao repetir.
    var wrap = function (x, y, rad, fn) {
      for (var ox = -N; ox <= N; ox += N) for (var oy = -N; oy <= N; oy += N) {
        if (x + ox + rad < 0 || x + ox - rad > N || y + oy + rad < 0 || y + oy - rad > N) continue;
        fn(x + ox, y + oy);
      }
    };
    c.fillStyle = t.base; c.fillRect(0, 0, N, N);
    // ruído de base: manchas MACIAS (gradiente radial). Em base escura o claro pesa muito mais
    // (contraste relativo), então a intensidade escala com a luminância — senão vira "bolhas".
    var L = lum(t.base), lightA = 0.25 + 0.75 * L, darkA = 0.5 + 0.5 * L;
    for (var i = 0; i < 70; i++) {
      var bx = r() * N, by = r() * N, br = 10 + r() * 34, light = r() > 0.5, a = (0.03 + r() * 0.045) * (light ? lightA : darkA);
      wrap(bx, by, br, function (x, y) {
        var g = c.createRadialGradient(x, y, 0, x, y, br);
        g.addColorStop(0, light ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')');
        g.addColorStop(1, light ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0)');
        c.fillStyle = g; c.fillRect(x - br, y - br, br * 2, br * 2);
      });
    }
    c.globalAlpha = 1; c.fillStyle = t.fleck; c.strokeStyle = t.fleck; c.lineWidth = 1.2;
    var k, x, y, s, w;
    var dot = function (px, py, sz, al) { c.globalAlpha = al; wrap(px, py, sz, function (X, Y) { c.fillRect(X, Y, sz, sz); }); };
    var disc = function (px, py, rad, al, stroke) { c.globalAlpha = al; wrap(px, py, rad + 1, function (X, Y) { c.beginPath(); c.arc(X, Y, rad, 0, 7); if (stroke) c.stroke(); else c.fill(); }); };
    var poly = function (pts, al) { var mx = pts[0], my = pts[1], ext = 0; for (var q = 2; q < pts.length; q += 2) ext = Math.max(ext, Math.abs(pts[q] - mx), Math.abs(pts[q + 1] - my)); c.globalAlpha = al; wrap(mx, my, ext + 2, function (X, Y) { c.beginPath(); c.moveTo(X, Y); for (var q = 2; q < pts.length; q += 2) c.lineTo(pts[q] - mx + X, pts[q + 1] - my + Y); c.stroke(); }); };
    switch (t.kind) {
      case 'dots': for (k = 0; k < 560; k++) dot(r() * N, r() * N, 1.4, .5 + r() * .5); break;
      case 'specks': for (k = 0; k < 360; k++) { x = r() * N; y = r() * N; disc(x, y, .6 + r() * 1.8, .4 + r() * .5); } break;
      case 'cracks': for (k = 0; k < 30; k++) { x = r() * N; y = r() * N; var pc = [x, y]; for (s = 0; s < 4; s++) { x += (r() - .5) * 26; y += (r() - .5) * 26; pc.push(x, y); } poly(pc, .75); } break;
      case 'tufts': for (k = 0; k < 160; k++) { x = r() * N; y = r() * N; poly([x - 2, y + 2, x, y - 3, x + 2, y + 2], .8); } break;
      case 'blobs': for (k = 0; k < 88; k++) { x = r() * N; y = r() * N; disc(x, y, 1.5 + r() * 3.5, .55); } break;
      case 'waves': c.globalAlpha = .7; for (k = 0; k < 56; k++) {
        x = r() * N; y = r() * N;
        (function (x0, y0) { wrap(x0 + 10, y0, 12, function (X, Y) { var sx = X - 10; c.beginPath(); c.moveTo(sx, Y); c.quadraticCurveTo(sx + 5, Y - 4, sx + 10, Y); c.quadraticCurveTo(sx + 15, Y + 4, sx + 20, Y); c.stroke(); }); })(x, y);
      } break;
      case 'bubbles': for (k = 0; k < 120; k++) { x = r() * N; y = r() * N; disc(x, y, 1 + r() * 3, .5 + r() * .5, true); } break;
      case 'bricks': c.globalAlpha = .55; for (y = 0; y < N; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(N, y); c.stroke(); for (x = (y / 16) % 2 ? 0 : 16; x < N; x += 32) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 16); c.stroke(); } } break;
      case 'plates': c.globalAlpha = .6; for (y = 0; y <= N; y += 32) { c.beginPath(); c.moveTo(0, y); c.lineTo(N, y); c.stroke(); c.beginPath(); c.moveTo(y, 0); c.lineTo(y, N); c.stroke(); } for (k = 0; k < 64; k++) { c.fillRect((k % 8) * 32 + 4, Math.floor(k / 8) * 32 + 4, 1.5, 1.5); } break;
      case 'stars': for (k = 0; k < 240; k++) { w = r() > .9 ? 2 : 1; dot(r() * N, r() * N, w, .3 + r() * .7); } break;
    }
    c.globalAlpha = 1;
    return cv;
  }
  var tiles = {};
  /** `variant` 'b' = um segundo ladrilho (outra semente) usado na 2ª passada anti-repetição. */
  function patternFor(c, tid, variant) {
    var per = patternCache ? patternCache.get(c) : null;
    if (!per) { per = {}; if (patternCache) patternCache.set(c, per); }
    var key = tid + (variant || '');
    if (!per[key]) {
      if (PACK_TEX[tid]) {
        var img = packImage(tid);
        if (!img) return null; // ainda carregando: quem chama usa a cor média; o onload redesenha
        per[key] = c.createPattern(img, 'repeat');
        return per[key];
      }
      var t = TERRAIN_BY_ID[tid] || TERRAINS[0];
      if (!tiles[key]) tiles[key] = makeTile(t, variant);
      per[key] = c.createPattern(tiles[key], 'repeat');
    }
    return per[key];
  }

  // ---------- Geometria ----------
  function toScreen(x, y, v) { return [(x - v.x) * v.z, (y - v.y) * v.z]; }
  function distToSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    var t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function pointInPoly(x, y, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
      var xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function centroid(pts) {
    var x = 0, y = 0, n = pts.length / 2;
    for (var i = 0; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1]; }
    return [x / n, y / n];
  }
  // ---------- Tileset hexagonal (kind 'hex') ----------
  // pointy = vértice pra cima, linhas ímpares deslocadas meia largura ("odd-r");
  // flat = lado pra cima, colunas ímpares deslocadas meia altura ("odd-q"). size = lado a lado.
  function hg(hx) {
    var s = hx.size, k = 2 / Math.sqrt(3);
    return hx.orient === 'flat' ? { w: s * k, h: s, flat: true } : { w: s, h: s * k, flat: false };
  }
  function hc(hx, c, r) {
    var g = hg(hx);
    return g.flat ? [c * g.w * 0.75 + g.w / 2, r * g.h + (c % 2 ? g.h : g.h / 2)]
      : [c * g.w + (r % 2 ? g.w : g.w / 2), r * g.h * 0.75 + g.h / 2];
  }
  function hCorners(hx, c, r) {
    var g = hg(hx), ce = hc(hx, c, r), out = [], rad = (g.flat ? g.w : g.h) / 2;
    for (var k = 0; k < 6; k++) { var a = Math.PI / 180 * (g.flat ? 60 * k : 60 * k - 30); out.push(ce[0] + rad * Math.cos(a), ce[1] + rad * Math.sin(a)); }
    return out;
  }
  function hBounds(hx) {
    var g = hg(hx);
    return g.flat ? { w: (hx.cols - 1) * g.w * 0.75 + g.w, h: hx.rows * g.h + (hx.cols > 1 ? g.h / 2 : 0) }
      : { w: hx.cols * g.w + (hx.rows > 1 ? g.w / 2 : 0), h: (hx.rows - 1) * g.h * 0.75 + g.h };
  }
  /** Hexágono do mapa sob (x,y) — centro mais próximo entre os vizinhos da estimativa; null fora da malha. */
  function hAt(hx, x, y) {
    var g = hg(hx), best = null, i, c, r, ce, d;
    if (g.flat) {
      var c0 = Math.round((x - g.w / 2) / (g.w * 0.75));
      for (c = c0 - 1; c <= c0 + 1; c++) { if (c < 0 || c >= hx.cols) continue; r = Math.round((y - (c % 2 ? g.h : g.h / 2)) / g.h); for (i = r - 1; i <= r + 1; i++) { if (i < 0 || i >= hx.rows) continue; ce = hc(hx, c, i); d = Math.hypot(x - ce[0], y - ce[1]); if (!best || d < best.d) best = { c: c, r: i, d: d }; } }
    } else {
      var r0 = Math.round((y - g.h / 2) / (g.h * 0.75));
      for (r = r0 - 1; r <= r0 + 1; r++) { if (r < 0 || r >= hx.rows) continue; c = Math.round((x - (r % 2 ? g.w : g.w / 2)) / g.w); for (i = c - 1; i <= c + 1; i++) { if (i < 0 || i >= hx.cols) continue; ce = hc(hx, i, r); d = Math.hypot(x - ce[0], y - ce[1]); if (!best || d < best.d) best = { c: i, r: r, d: d }; } }
    }
    // fora da malha: mais longe do centro que o "raio" do hexágono
    if (!best || best.d > Math.max(g.w, g.h) / 2) return null;
    return { c: best.c, r: best.r, key: best.c + ',' + best.r };
  }
  function cube(hx, c, r) {
    if (hx.orient === 'flat') { var z = r - (c - (c & 1)) / 2; return [c, -c - z, z]; }
    var x = c - (r - (r & 1)) / 2; return [x, -x - r, r];
  }
  function hDist(hx, a, b) { var A = cube(hx, a[0], a[1]), B = cube(hx, b[0], b[1]); return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2])); }
  /** Hexágonos da malha a até `rad` passos de (c,r). */
  function hArea(hx, c, r, rad) {
    var out = [];
    for (var j = r - rad - 1; j <= r + rad + 1; j++) for (var i = c - rad - 1; i <= c + rad + 1; i++) {
      if (i < 0 || j < 0 || i >= hx.cols || j >= hx.rows) continue;
      if (hDist(hx, [c, r], [i, j]) <= rad) out.push(i + ',' + j);
    }
    return out;
  }
  function hFlood(hx, c, r, limit) {
    var key0 = c + ',' + r, target = hx.tiles[key0] || null, seen = {}, q = [[c, r]], out = [];
    seen[key0] = true;
    while (q.length && out.length < (limit || 40000)) {
      var cur = q.shift(); out.push(cur[0] + ',' + cur[1]);
      hArea(hx, cur[0], cur[1], 1).forEach(function (k) {
        if (seen[k]) return; seen[k] = true;
        if ((hx.tiles[k] || null) === target) { var p = k.split(','); q.push([Number(p[0]), Number(p[1])]); }
      });
    }
    return out;
  }
  function tileById(map, id) { return (map.tileset || []).filter(function (t) { return t.id === id; })[0] || null; }

  /** Bounds do conteúdo "papel" do mapa (o que o export cobre). */
  function mapBounds(map) {
    if (map.kind === 'hex') { var hb = hBounds(map.hex); return { x: 0, y: 0, w: hb.w, h: hb.h }; }
    if (map.kind === 'radial') { var R = map.radial.R * 1.12; return { x: -R, y: -R, w: R * 2, h: R * 2 }; }
    return { x: 0, y: 0, w: map.width, h: map.height };
  }
  /** Coluna em letras (A..Z, AA..) e linha em números. */
  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  // Grade hexagonal "pointy-top" com linhas ímpares deslocadas meia célula (offset "odd-r"):
  // `cell` = largura do hexágono (de lado a lado); altura = cell·2/√3; linhas a cada 3/4 da altura.
  function hexDims(cell) { var h = cell * 2 / Math.sqrt(3); return { w: cell, h: h, dy: h * 0.75 }; }
  function hexCenter(cell, col, row) { var d = hexDims(cell); return [col * d.w + (row % 2 ? d.w : d.w / 2), row * d.dy + d.h / 2]; }
  /** Hexágono cujo centro é o mais próximo de (x,y) — testa as linhas vizinhas da estimativa. */
  function hexAt(cell, x, y) {
    var d = hexDims(cell), r0 = Math.round((y - d.h / 2) / d.dy), best = null;
    for (var r = r0 - 1; r <= r0 + 1; r++) {
      if (r < 0) continue;
      var c = Math.round((x - (r % 2 ? d.w : d.w / 2)) / d.w);
      if (c < 0) continue;
      var ce = hexCenter(cell, c, r), dist = Math.hypot(x - ce[0], y - ce[1]);
      if (!best || dist < best.d) best = { col: c, row: r, d: dist };
    }
    return best;
  }
  function cellName(map, x, y) {
    if (!map || map.kind !== 'world' || x < 0 || y < 0 || x >= map.width || y >= map.height) return '';
    if (map.grid.shape === 'hex') { var hx = hexAt(map.grid.cell, x, y); return hx ? colName(hx.col) + (hx.row + 1) : ''; }
    return colName(Math.floor(x / map.grid.cell)) + (Math.floor(y / map.grid.cell) + 1);
  }
  /** Ângulo em graus a partir do norte, sentido horário. */
  function polarOf(x, y) { return { r: Math.hypot(x, y), a: (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360 }; }
  function sectorAt(map, x, y) {
    if (map.kind !== 'radial') return null;
    var pol = polarOf(x, y), rr = pol.r / map.radial.R, hit = null;
    map.radial.rings.forEach(function (ring, ri) {
      if (rr >= ring.r0 && rr < ring.r1) {
        var span = 360 / ring.sectors;
        var k = Math.floor((((pol.a - ring.offset) % 360) + 360) % 360 / span);
        hit = { ring: ri, sector: Math.min(ring.sectors - 1, k) };
      }
    });
    return hit;
  }

  // ---------- Desenho ----------
  function drawPathPts(c, pts, smooth) {
    c.beginPath(); c.moveTo(pts[0], pts[1]);
    if (!smooth || pts.length < 6) { for (var i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); return; }
    for (var j = 2; j < pts.length - 2; j += 2) {
      var mx = (pts[j] + pts[j + 2]) / 2, my = (pts[j + 1] + pts[j + 3]) / 2;
      c.quadraticCurveTo(pts[j], pts[j + 1], mx, my);
    }
    c.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
  }

  /** Desenha um traço de terreno em coordenadas de MUNDO (ctx já com a transformação da vista). */
  function paintStroke(c, st, z) {
    var erase = st.t === 'erase';
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = st.s;
    if (erase) {
      c.globalCompositeOperation = 'destination-out'; c.strokeStyle = '#000';
    } else {
      var t = terrainInfo(st.t);
      var pat = patternFor(c, t.id);
      // textura presa ao mundo: 1 ladrilho (256px) = 320 unidades
      if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix([320 / 256, 0, 0, 320 / 256, 0, 0]));
      c.strokeStyle = pat || t.base;
    }
    drawPathPts(c, st.p, true);
    if (st.p.length === 2) { c.lineTo(st.p[0] + 0.01, st.p[1]); }
    if (erase) c.stroke();
    else {
      // Borda macia: 3 passadas concêntricas (larga e fraca → estreita e cheia). Antes era shadowBlur,
      // um desfoque gaussiano recalculado a cada movimento do mouse — o maior custo do pincel em
      // máquina modesta. O resultado visual é parecido (alfa ~.35 → .74 → 1 da borda pro miolo).
      c.globalAlpha = 0.35; c.lineWidth = st.s * 1.18; c.stroke();
      c.globalAlpha = 0.6; c.lineWidth = st.s * 1.04; c.stroke();
      c.globalAlpha = 1; c.lineWidth = st.s * 0.88; c.stroke();
    }
    // 2ª passada anti-repetição: o mesmo traço com OUTRO ladrilho, girado 37° e em escala
    // não-múltipla (0,77×). Os dois períodos não se alinham, então o padrão deixa de "quadricular".
    if (!erase && typeof DOMMatrix !== 'undefined') {
      var patB = patternFor(c, st.t, 'b');
      if (patB && patB.setTransform) {
        var k2 = 320 / 256 * 0.77, ca = Math.cos(0.6458), sa = Math.sin(0.6458);
        patB.setTransform(new DOMMatrix([k2 * ca, k2 * sa, -k2 * sa, k2 * ca, 97, 53]));
        c.globalAlpha = 0.5; c.strokeStyle = patB;
        c.lineWidth = st.s * 0.8; c.stroke();
      }
    }
    c.restore();
  }

  /** Recorta a pintura de terreno à área do mapa (retângulo do mundo / disco da planta radial). */
  function clipPaper(c, map) {
    c.beginPath();
    if (map.kind === 'radial') c.arc(0, 0, map.radial.R * 1.12, 0, Math.PI * 2);
    else { var b = mapBounds(map); c.rect(b.x, b.y, b.w, b.h); }
    c.clip();
  }

  // ---------- Balde (mapa livre) ----------
  // Preenchimento = traço especial { t, fill: { x, y, w, h, r, d } }: máscara de w×h células de r unidades,
  // em RLE (corridas alternadas vazio/cheio, base 36). Desenhada como textura recortada pela máscara
  // ampliada com suavização (borda macia, igual à do pincel).
  var maskCache = {};
  function decodeMask(f) {
    var key = f.w + 'x' + f.h + ':' + f.d;
    if (maskCache[key]) return maskCache[key];
    var cv = document.createElement('canvas'); cv.width = f.w; cv.height = f.h;
    var c = cv.getContext('2d'), img = c.createImageData(f.w, f.h), runs = f.d.split(','), pos = 0, on = false;
    for (var i = 0; i < runs.length; i++) {
      var n = parseInt(runs[i], 36) || 0;
      if (on) for (var j = pos; j < pos + n; j++) { img.data[j * 4] = img.data[j * 4 + 1] = img.data[j * 4 + 2] = 255; img.data[j * 4 + 3] = 255; }
      pos += n; on = !on;
    }
    c.putImageData(img, 0, 0);
    var keys = Object.keys(maskCache); if (keys.length > 80) delete maskCache[keys[0]];
    return (maskCache[key] = cv);
  }
  var fillTmp = null;
  function paintFill(c, st, z) {
    var f = st.fill, t = terrainInfo(st.t), m = c.getTransform();
    if (!fillTmp) fillTmp = document.createElement('canvas');
    if (fillTmp.width !== c.canvas.width || fillTmp.height !== c.canvas.height) { fillTmp.width = c.canvas.width; fillTmp.height = c.canvas.height; }
    var tc = fillTmp.getContext('2d');
    tc.setTransform(1, 0, 0, 1, 0, 0); tc.globalCompositeOperation = 'source-over'; tc.globalAlpha = 1; tc.filter = 'none';
    tc.clearRect(0, 0, fillTmp.width, fillTmp.height);
    tc.setTransform(m);
    var bw = f.w * f.r, bh = f.h * f.r;
    var pat = patternFor(tc, t.id);
    if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix([320 / 256, 0, 0, 320 / 256, 0, 0]));
    tc.fillStyle = pat || t.base; tc.fillRect(f.x - f.r, f.y - f.r, bw + f.r * 2, bh + f.r * 2);
    var patB = patternFor(tc, st.t, 'b');
    if (patB && patB.setTransform && typeof DOMMatrix !== 'undefined') {
      var k2 = 320 / 256 * 0.77, ca = Math.cos(0.6458), sa = Math.sin(0.6458);
      patB.setTransform(new DOMMatrix([k2 * ca, k2 * sa, -k2 * sa, k2 * ca, 97, 53]));
      tc.globalAlpha = 0.5; tc.fillStyle = patB; tc.fillRect(f.x - f.r, f.y - f.r, bw + f.r * 2, bh + f.r * 2); tc.globalAlpha = 1;
    }
    tc.globalCompositeOperation = 'destination-in';
    tc.imageSmoothingEnabled = true;
    try { tc.filter = 'blur(' + Math.max(0.5, f.r * z * 0.45).toFixed(1) + 'px)'; } catch (e) { /* sem filter */ }
    tc.drawImage(decodeMask(f), f.x, f.y, bw, bh);
    tc.filter = 'none'; tc.globalCompositeOperation = 'source-over';
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(fillTmp, 0, 0); c.restore();
  }
  // ---------- Pincel de carimbo (pincéis do pacote) ----------
  /** Posições dos carimbos ao longo do traço — determinísticas (semente = id do traço), então o
   *  desenho ao vivo, o redesenho e o export dão exatamente o mesmo resultado. */
  function decalPlacements(st) {
    var def = PACK_BR[st.t]; if (!def) return [];
    var directional = def.kind === 'line' || def.kind === 'edge';
    var spacing = Math.max(2, st.s * (directional ? 0.6 : 0.33));
    var r = rng(hashStr(st.id || 'x')), out = [], pts = st.p, carry = 0, base = (def.angle || 0) * Math.PI / 180;
    var push = function (x, y, dir) {
      var jitter = directional ? (r() - 0.5) * 0.25 : 0;
      out.push({ x: x, y: y, a: directional ? dir - base + jitter : r() * Math.PI * 2, k: directional ? 0.95 + r() * 0.1 : 0.82 + r() * 0.36 });
    };
    if (pts.length < 4) { push(pts[0], pts[1], 0); return out; }
    push(pts[0], pts[1], Math.atan2(pts[3] - pts[1], pts[2] - pts[0]));
    for (var i = 2; i < pts.length; i += 2) {
      var x0 = pts[i - 2], y0 = pts[i - 1], dx = pts[i] - x0, dy = pts[i + 1] - y0, len = Math.hypot(dx, dy);
      if (!len) continue;
      var d = spacing - carry, dir = Math.atan2(dy, dx);
      while (d <= len) { push(x0 + dx * d / len, y0 + dy * d / len, dir); d += spacing; }
      carry = len - (d - spacing);
    }
    return out;
  }
  function drawDecals(c, st, from) {
    var def = PACK_BR[st.t], img = def && packImage(st.t);
    if (!img) return 0;
    var list = decalPlacements(st), ar = img.width / img.height;
    for (var i = from || 0; i < list.length; i++) {
      var q = list[i], L = st.s * q.k, w = ar >= 1 ? L : L * ar, h = ar >= 1 ? L / ar : L;
      c.save(); c.translate(q.x, q.y); c.rotate(q.a); c.drawImage(img, -w / 2, -h / 2, w, h); c.restore();
    }
    return list.length;
  }
  function isDecal(st) { return !!PACK_BR[st.t]; }

  /** Desenha um traço/preenchimento/carimbo-de-pincel com opacidade 1 (a opacidade é aplicada por
   *  paintAny, compondo a camada inteira de uma vez — senão as sobreposições do próprio traço
   *  escureceriam). `asMask`: borracha desenhada como tinta (pra depois virar destination-out). */
  function paintRaw(c, st, z, asMask) {
    if (st.fill) { paintFill(c, st, z); return; }
    if (isDecal(st)) { drawDecals(c, st, 0); return; }
    if (asMask && st.t === 'erase') {
      c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = st.s; c.strokeStyle = '#000';
      drawPathPts(c, st.p, true); if (st.p.length === 2) c.lineTo(st.p[0] + 0.01, st.p[1]); c.stroke(); c.restore();
      return;
    }
    paintStroke(c, st, z);
  }
  var opTmp = null;
  function paintAny(c, st, z) {
    var o = st.o;
    if (!(o > 0 && o < 1)) { paintRaw(c, st, z); return; }
    if (!opTmp) opTmp = document.createElement('canvas');
    if (opTmp.width !== c.canvas.width || opTmp.height !== c.canvas.height) { opTmp.width = c.canvas.width; opTmp.height = c.canvas.height; }
    var tc = opTmp.getContext('2d');
    tc.setTransform(1, 0, 0, 1, 0, 0); tc.clearRect(0, 0, opTmp.width, opTmp.height);
    tc.setTransform(c.getTransform());
    paintRaw(tc, st, z, true);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = o;
    if (st.t === 'erase') c.globalCompositeOperation = 'destination-out';
    c.drawImage(opTmp, 0, 0); c.restore();
  }

  /** Calcula a área do balde a partir de (x,y): raster de "qual terreno" por célula, flood 4-vizinhos. */
  function computeFill(map, x, y, terrain) {
    var b = mapBounds(map), r = Math.max(4, Math.ceil(Math.sqrt(b.w * b.h / 160000)));
    var gw = Math.ceil(b.w / r), gh = Math.ceil(b.h / r);
    var cv = document.createElement('canvas'); cv.width = gw; cv.height = gh;
    var c = cv.getContext('2d');
    c.fillStyle = '#000'; c.fillRect(0, 0, gw, gh);
    c.setTransform(1 / r, 0, 0, 1 / r, -b.x / r, -b.y / r);
    // Classe por terreno codificada em R e G (passo 20 → 12×12 classes; 0,0 = vazio). Bordas
    // anti-serrilhadas caem entre os passos e viram "borda" (-1).
    var classes = { erase: 0 }, nextClass = 1;
    var idOf = function (tid) { if (classes[tid] === undefined) classes[tid] = nextClass++; return classes[tid]; };
    var colOf = function (k) { return k === 0 ? 'rgb(0,0,0)' : 'rgb(' + ((k - 1) % 12 + 1) * 20 + ',' + (Math.floor((k - 1) / 12) + 1) * 20 + ',0)'; };
    map.strokes.forEach(function (st) {
      var col = colOf(st.t === 'erase' ? 0 : idOf(st.t));
      if (isDecal(st)) {
        // carimbos de pincel também são limite: silhueta (alfa) pintada com a cor da classe
        var dc = document.createElement('canvas'); dc.width = gw; dc.height = gh;
        var dx = dc.getContext('2d'); dx.setTransform(c.getTransform()); drawDecals(dx, st, 0);
        dx.setTransform(1, 0, 0, 1, 0, 0); dx.globalCompositeOperation = 'source-in'; dx.fillStyle = col; dx.fillRect(0, 0, gw, gh);
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(dc, 0, 0); c.restore();
      } else if (st.fill) {
        var mk = decodeMask(st.fill), tint = document.createElement('canvas'); tint.width = mk.width; tint.height = mk.height;
        var tcx = tint.getContext('2d'); tcx.drawImage(mk, 0, 0); tcx.globalCompositeOperation = 'source-in'; tcx.fillStyle = col; tcx.fillRect(0, 0, mk.width, mk.height);
        c.imageSmoothingEnabled = false; c.drawImage(tint, st.fill.x, st.fill.y, st.fill.w * st.fill.r, st.fill.h * st.fill.r);
      } else {
        c.strokeStyle = col; c.lineWidth = st.s; c.lineCap = 'round'; c.lineJoin = 'round';
        drawPathPts(c, st.p, true); if (st.p.length === 2) c.lineTo(st.p[0] + 0.01, st.p[1]); c.stroke();
      }
    });
    var data = c.getImageData(0, 0, gw, gh).data, cls = new Int16Array(gw * gh);
    var R2 = map.kind === 'radial' ? Math.pow(map.radial.R * 1.12, 2) : 0;
    for (var i = 0; i < gw * gh; i++) {
      var v = data[i * 4], g = data[i * 4 + 1], kq = Math.round(v / 20), kg = Math.round(g / 20);
      if (Math.abs(v - kq * 20) > 5 || Math.abs(g - kg * 20) > 5 || data[i * 4 + 3] < 250) cls[i] = -1;
      else cls[i] = kq === 0 && kg === 0 ? 0 : (kg - 1) * 12 + kq;
      if (R2) { var wx = b.x + (i % gw + 0.5) * r, wy = b.y + (Math.floor(i / gw) + 0.5) * r; if (wx * wx + wy * wy > R2) cls[i] = -2; }
    }
    var cx = Math.floor((x - b.x) / r), cy = Math.floor((y - b.y) / r);
    if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) return { error: 'Clique dentro da área do mapa.' };
    var start = cy * gw + cx, target = cls[start];
    if (target < 0) {
      // borda entre terrenos: usa o vizinho mais comum
      var cnt = {}; [-1, 1, -gw, gw].forEach(function (d) { var q = cls[start + d]; if (q >= 0) cnt[q] = (cnt[q] || 0) + 1; });
      var best = Object.keys(cnt).sort(function (a2, b2) { return cnt[b2] - cnt[a2]; })[0];
      if (best === undefined) return { error: 'Clique um pouco mais pra dentro da área.' };
      target = Number(best);
    }
    if (classes[terrain] !== undefined && target === classes[terrain]) return { error: 'Essa área já é desse terreno.' };
    var mask = new Uint8Array(gw * gh), q = [start], n = 0, x0 = gw, y0 = gh, x1 = -1, y1 = -1;
    mask[start] = 1;
    while (q.length) {
      var p = q.pop(), px = p % gw, py = (p - px) / gw; n++;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      if (px > 0 && !mask[p - 1] && (cls[p - 1] === target || (cls[p - 1] === -1 && cls[p] === target))) { mask[p - 1] = 1; q.push(p - 1); }
      if (px < gw - 1 && !mask[p + 1] && (cls[p + 1] === target || (cls[p + 1] === -1 && cls[p] === target))) { mask[p + 1] = 1; q.push(p + 1); }
      if (py > 0 && !mask[p - gw] && (cls[p - gw] === target || (cls[p - gw] === -1 && cls[p] === target))) { mask[p - gw] = 1; q.push(p - gw); }
      if (py < gh - 1 && !mask[p + gw] && (cls[p + gw] === target || (cls[p + gw] === -1 && cls[p] === target))) { mask[p + gw] = 1; q.push(p + gw); }
    }
    // 1 célula a mais por cima da borda anti-serrilhada, pra não sobrar fresta entre os terrenos
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(gw - 1, x1 + 1); y1 = Math.min(gh - 1, y1 + 1);
    var w = x1 - x0 + 1, h = y1 - y0 + 1, runs = [], on = false, run = 0;
    for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) {
      var idx = yy * gw + xx, val = !!mask[idx];
      if (!val && cls[idx] !== -2) { if ((xx > 0 && mask[idx - 1]) || (xx < gw - 1 && mask[idx + 1]) || (yy > 0 && mask[idx - gw]) || (yy < gh - 1 && mask[idx + gw])) val = true; }
      if (val !== on) { runs.push(run.toString(36)); run = 0; on = val; }
      run++;
    }
    runs.push(run.toString(36));
    return { fill: { x: b.x + x0 * r, y: b.y + y0 * r, w: w, h: h, r: r, d: runs.join(',') }, cells: n };
  }

  function renderTerrainLayer(target, map, v, W, H) {
    var c = target.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, target.width, target.height);
    var k = target.width / W;
    c.setTransform(v.z * k, 0, 0, v.z * k, -v.x * v.z * k, -v.y * v.z * k);
    if (map.kind === 'hex') renderHexTiles(c, map, v, W, H, v.z * k);
    else { c.save(); clipPaper(c, map); map.strokes.forEach(function (st) { paintAny(c, st, v.z * k); }); c.restore(); }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Pinta as peças dos hexágonos VISÍVEIS (ctx já em coordenadas de mundo). `zz` = px por unidade. */
  function renderHexTiles(c, map, v, W, H, zz) {
    var hx = map.hex, g = hg(hx), S = STYLES[map.style] || STYLES.wasteland;
    var x0 = v.x, y0 = v.y, x1 = v.x + W / v.z, y1 = v.y + H / v.z;
    var cA, cB, rA, rB;
    if (g.flat) { cA = Math.floor((x0 - g.w) / (g.w * 0.75)); cB = Math.ceil(x1 / (g.w * 0.75)); rA = Math.floor((y0 - g.h) / g.h); rB = Math.ceil(y1 / g.h); }
    else { cA = Math.floor((x0 - g.w) / g.w); cB = Math.ceil(x1 / g.w); rA = Math.floor((y0 - g.h) / (g.h * 0.75)); rB = Math.ceil(y1 / (g.h * 0.75)); }
    cA = Math.max(0, cA); rA = Math.max(0, rA); cB = Math.min(hx.cols - 1, cB); rB = Math.min(hx.rows - 1, rB);
    var path = function (col, row) { var pts = hCorners(hx, col, row); c.beginPath(); c.moveTo(pts[0], pts[1]); for (var i = 2; i < 12; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); };
    var k2 = 320 / 256 * 0.77, ca = Math.cos(0.6458), sa = Math.sin(0.6458);
    for (var r = rA; r <= rB; r++) for (var col = cA; col <= cB; col++) {
      var t = tileById(map, hx.tiles[col + ',' + r]);
      if (!t) continue;
      path(col, r);
      if (t.imageId) {
        var e = loadImage(t.imageId);
        if (e && e.img) {
          var ce = hc(hx, col, r), iw = e.img.width, ih = e.img.height, sc = Math.max(g.w / iw, g.h / ih);
          c.save(); c.clip(); c.drawImage(e.img, ce[0] - iw * sc / 2, ce[1] - ih * sc / 2, iw * sc, ih * sc); c.restore();
        } else { c.fillStyle = S.paper2; c.fill(); }
      } else if (t.terrain && isTerrainId(t.terrain)) {
        var pat = patternFor(c, t.terrain);
        if (pat && pat.setTransform && typeof DOMMatrix !== 'undefined') pat.setTransform(new DOMMatrix([320 / 256, 0, 0, 320 / 256, 0, 0]));
        c.fillStyle = pat || terrainInfo(t.terrain).base; c.fill();
        var pb = patternFor(c, t.terrain, 'b');
        if (pb && pb.setTransform && typeof DOMMatrix !== 'undefined') { pb.setTransform(new DOMMatrix([k2 * ca, k2 * sa, -k2 * sa, k2 * ca, 97, 53])); c.save(); c.globalAlpha = 0.5; c.fillStyle = pb; c.fill(); c.restore(); }
      } else {
        c.fillStyle = t.color || '#9ca3af'; c.fill();
      }
    }
    // malha + marcadores de nota + coordenadas internas
    c.save();
    c.lineWidth = 1.2 / zz; c.strokeStyle = S.grid;
    if (hx.lines) { for (var r2 = rA; r2 <= rB; r2++) for (var c2 = cA; c2 <= cB; c2++) { path(c2, r2); c.stroke(); } }
    var fs = Math.min(g.w, g.h) * 0.16;
    if (hx.coordsIn && fs * zz >= 6) {
      c.font = '600 ' + fs + 'px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = S.ink; c.globalAlpha = 0.55;
      for (var r3 = rA; r3 <= rB; r3++) for (var c3 = cA; c3 <= cB; c3++) { var ce3 = hc(hx, c3, r3); c.fillText(colName(c3) + (r3 + 1), ce3[0], ce3[1] - Math.min(g.w, g.h) * 0.4); }
      c.globalAlpha = 1;
    }
    Object.keys(hx.notes).forEach(function (key) {
      var p = key.split(','), ce4 = hc(hx, Number(p[0]), Number(p[1]));
      c.beginPath(); c.arc(ce4[0], ce4[1] + Math.min(g.w, g.h) * 0.3, Math.max(2.5 / zz, Math.min(g.w, g.h) * 0.06), 0, Math.PI * 2);
      c.fillStyle = '#f59e0b'; c.fill(); c.strokeStyle = S.ink; c.lineWidth = 1 / zz; c.stroke();
    });
    c.restore();
  }

  /** Coordenadas nas bordas do mapa hexagonal (A, B... em cima/embaixo; 1, 2... nas laterais). */
  function drawHexEdgeLabels(c, map, S, v) {
    var hx = map.hex, b = mapBounds(map), step = Math.min(hg(hx).w, hg(hx).h) * v.z;
    if (!map.grid.labels || step < 14) return;
    var fs = clamp(step * 0.28, 9, 22), p0 = toScreen(0, 0, v), p1 = toScreen(b.w, b.h, v);
    c.save(); c.font = '600 ' + fs + 'px system-ui,sans-serif'; c.fillStyle = S.ink; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (var i = 0; i < hx.cols; i++) { var x = toScreen(hc(hx, i, 0)[0], 0, v)[0]; c.fillText(colName(i), x, p0[1] - fs * .9); c.fillText(colName(i), x, p1[1] + fs * .9); }
    for (var j = 0; j < hx.rows; j++) { var y = toScreen(0, hc(hx, 0, j)[1], v)[1]; c.fillText(String(j + 1), p0[0] - fs * 1.1, y); c.fillText(String(j + 1), p1[0] + fs * 1.1, y); }
    c.restore();
  }

  function rgba(hex, a) { var n = parseInt(String(hex).replace('#', ''), 16) || 0; return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  function drawBackground(c, map, S, v, W, H) {
    var b = mapBounds(map);
    c.fillStyle = S.paper2; c.fillRect(0, 0, W, H);
    var p = toScreen(b.x, b.y, v);
    // papel: grão (js/paperTexture.js) preso ao mapa — 1 px do ladrilho = 1 unidade — + vinheta
    var paper = GDC.paperTexture ? GDC.paperTexture.pattern(c, S.paper, S.grain == null ? 1 : S.grain, v.z, -v.x * v.z, -v.y * v.z, function () { terrainKey = ''; requestDraw(); }) : null;
    var vignette = function (g) { g.addColorStop(0, rgba(S.paper2, 0)); g.addColorStop(0.55, rgba(S.paper2, 0.15)); g.addColorStop(1, rgba(S.paper2, 0.9)); return g; };
    if (map.kind !== 'radial') {
      var cxm = p[0] + b.w * v.z / 2, cym = p[1] + b.h * v.z / 2;
      c.fillStyle = paper || S.paper; c.fillRect(p[0], p[1], b.w * v.z, b.h * v.z);
      c.fillStyle = vignette(c.createRadialGradient(cxm, cym, Math.min(b.w, b.h) * v.z * 0.2, cxm, cym, Math.max(b.w, b.h) * v.z * 0.75));
      c.fillRect(p[0], p[1], b.w * v.z, b.h * v.z);
      c.strokeStyle = S.ink; c.lineWidth = Math.max(1, 3 * v.z); c.strokeRect(p[0], p[1], b.w * v.z, b.h * v.z);
    } else {
      var o = toScreen(0, 0, v);
      var R = map.radial.R * 1.12 * v.z;
      c.beginPath(); c.arc(o[0], o[1], R, 0, Math.PI * 2);
      c.fillStyle = paper || S.paper; c.fill();
      c.fillStyle = vignette(c.createRadialGradient(o[0], o[1], R * 0.1, o[0], o[1], R)); c.fill();
    }
  }

  function drawRadial(c, map, S, v, selSector) {
    var rd = map.radial, R = rd.R, o = toScreen(0, 0, v), z = v.z;
    var rad = function (deg) { return (deg - 90) * Math.PI / 180; };
    rd.rings.forEach(function (ring, ri) {
      var span = 360 / ring.sectors;
      for (var k = 0; k < ring.sectors; k++) {
        var a0 = ring.offset + k * span, a1 = a0 + span;
        var cell = ring.cells[k] || { name: '', c: null };
        var col = cell.c || ring.c || SECTOR_COLORS[(ri * 3 + k) % SECTOR_COLORS.length];
        c.beginPath();
        if (ring.sectors === 1) {
          c.arc(o[0], o[1], ring.r1 * R * z, 0, Math.PI * 2);
          if (ring.r0 > 0) c.arc(o[0], o[1], ring.r0 * R * z, Math.PI * 2, 0, true);
        } else {
          c.arc(o[0], o[1], ring.r1 * R * z, rad(a0), rad(a1));
          c.arc(o[0], o[1], ring.r0 * R * z, rad(a1), rad(a0), true);
        }
        c.closePath();
        c.globalAlpha = 0.28; c.fillStyle = col; c.fill('evenodd');
        c.globalAlpha = 1; c.strokeStyle = S.ink; c.lineWidth = Math.max(1, 2 * z); c.stroke();
        if (selSector && selSector.ring === ri && selSector.sector === k) {
          c.save(); c.strokeStyle = '#f59e0b'; c.lineWidth = Math.max(2, 6 * z); c.stroke(); c.restore();
        }
        if (cell.name) {
          var am = rad(a0 + span / 2), rm = (ring.sectors === 1 && ring.r0 === 0) ? 0 : (ring.r0 + ring.r1) / 2 * R;
          var thick = (ring.r1 - ring.r0) * R, arcLen = ring.sectors === 1 ? Math.PI * 2 * rm : span * Math.PI / 180 * rm;
          var disc = ring.sectors === 1 && ring.r0 === 0;
          var fs = (disc ? Math.min(thick * 0.3, thick * 2 * 1.5 / Math.max(4, cell.name.length), 60) : Math.min(thick * 0.22, arcLen / Math.max(4, cell.name.length) * 1.5, 46)) * z;
          if (fs >= 5) {
            c.save(); c.translate(o[0] + Math.cos(am) * rm * z, o[1] + Math.sin(am) * rm * z);
            var rot = am + Math.PI / 2; if (Math.sin(am) > 0.2) rot += Math.PI; // texto nunca de cabeça pra baixo
            if (ring.sectors > 1) c.rotate(rot);
            c.font = '700 ' + fs + "px Georgia,'Times New Roman',serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.lineWidth = fs * 0.22; c.strokeStyle = S.fill; c.strokeText(cell.name, 0, 0); c.fillStyle = S.ink; c.fillText(cell.name, 0, 0);
            c.restore();
          }
        }
      }
    });
    // ramais radiais (corredores) por cima dos anéis
    var sp = rd.spokes;
    if (sp.count > 0) {
      for (var i = 0; i < sp.count; i++) {
        var a = rad(sp.offset + i * 360 / sp.count);
        var x0 = o[0] + Math.cos(a) * sp.r0 * R * z, y0 = o[1] + Math.sin(a) * sp.r0 * R * z;
        var x1 = o[0] + Math.cos(a) * sp.r1 * R * z, y1 = o[1] + Math.sin(a) * sp.r1 * R * z;
        c.save(); c.lineCap = 'butt';
        c.strokeStyle = S.ink; c.lineWidth = sp.width * z + 2; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
        c.strokeStyle = S.fill; c.lineWidth = Math.max(1, sp.width * z - 2); c.stroke();
        c.setLineDash([6 * Math.max(.4, z), 6 * Math.max(.4, z)]); c.strokeStyle = S.ink; c.globalAlpha = .45; c.lineWidth = 1; c.stroke();
        c.restore();
        if (sp.name && sp.width * z > 9) {
          c.save(); c.translate((x0 + x1) / 2, (y0 + y1) / 2); var rr = a; if (Math.cos(a) < 0) rr += Math.PI; c.rotate(rr);
          var f = Math.min(sp.width * z * 0.6, 22); c.font = '600 ' + f + 'px system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = S.ink;
          c.fillText(sp.name + ' ' + (i + 1), 0, 0); c.restore();
        }
      }
    }
    // contorno externo decorado (anel de hexágonos — muralha, campo de força...)
    if (rd.dome) {
      var Rz = R * z;
      c.save(); c.strokeStyle = S.ink; c.lineWidth = Math.max(1.5, 5 * z); c.beginPath(); c.arc(o[0], o[1], Rz, 0, Math.PI * 2); c.stroke();
      var n = Math.max(24, Math.round(R / 40));
      c.lineWidth = Math.max(1, 1.5 * z); c.globalAlpha = .55;
      for (var h = 0; h < n; h++) {
        var t = h / n * Math.PI * 2, hx = o[0] + Math.cos(t) * (Rz + 14 * z), hy = o[1] + Math.sin(t) * (Rz + 14 * z), hr = 10 * z;
        if (hr < 1.5) break;
        c.beginPath(); for (var q = 0; q < 6; q++) { var qa = q / 6 * Math.PI * 2 + t; c.lineTo(hx + Math.cos(qa) * hr, hy + Math.sin(qa) * hr); } c.closePath(); c.stroke();
      }
      c.restore();
    }
  }

  function drawRegions(c, map, S, v, selId) {
    map.regions.forEach(function (rg) {
      c.save();
      c.beginPath();
      for (var i = 0; i < rg.pts.length; i += 2) { var p = toScreen(rg.pts[i], rg.pts[i + 1], v); if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }
      c.closePath();
      c.globalAlpha = 0.16; c.fillStyle = rg.c; c.fill();
      c.globalAlpha = 0.9; c.strokeStyle = rg.c; c.lineWidth = Math.max(1.5, 4 * v.z);
      if (rg.dash) c.setLineDash([14 * Math.max(.5, v.z), 8 * Math.max(.5, v.z)]);
      c.stroke();
      if (selId === rg.id) { c.setLineDash([]); c.globalAlpha = 1; c.strokeStyle = '#3b82f6'; c.lineWidth = 2; c.stroke(); }
      c.restore();
    });
  }
  /** Nomes das regiões num passo separado, depois dos carimbos — senão um carimbo no meio da
   *  região (ex.: a cratera da Zona Vermelha) esconde o nome. */
  function drawRegionNames(c, map, S, v) {
    map.regions.forEach(function (rg) {
      if (rg.name) {
        var ce = centroid(rg.pts), p2 = toScreen(ce[0], ce[1], v), fs = 34 * v.z;
        if (fs >= 5) {
          c.save(); c.font = '700 ' + fs + "px Georgia,'Times New Roman',serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.lineWidth = fs * .2; c.strokeStyle = S.fill; var txt = rg.name.toUpperCase();
          c.strokeText(txt, p2[0], p2[1]); c.fillStyle = rg.c; c.fillText(txt, p2[0], p2[1]); c.restore();
        }
      }
    });
  }

  function drawPaths(c, map, S, v, selId) {
    map.paths.forEach(function (pa) {
      var pts = [];
      for (var i = 0; i < pa.pts.length; i += 2) { var p = toScreen(pa.pts[i], pa.pts[i + 1], v); pts.push(p[0], p[1]); }
      c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
      var z = v.z;
      if (pa.kind === 'river') {
        c.strokeStyle = '#2f6f99'; c.lineWidth = Math.max(2, 26 * z); drawPathPts(c, pts, true); c.stroke();
        c.strokeStyle = '#7fb7d8'; c.lineWidth = Math.max(1, 14 * z); c.stroke();
      } else if (pa.kind === 'trail') {
        c.strokeStyle = S.ink; c.lineWidth = Math.max(1, 5 * z); c.setLineDash([18 * Math.max(.4, z), 12 * Math.max(.4, z)]); drawPathPts(c, pts, true); c.stroke();
      } else if (pa.kind === 'border') {
        c.strokeStyle = '#b91c1c'; c.lineWidth = Math.max(1.5, 6 * z); c.setLineDash([26 * Math.max(.4, z), 10 * Math.max(.4, z), 4 * Math.max(.4, z), 10 * Math.max(.4, z)]); drawPathPts(c, pts, false); c.stroke();
      } else {
        c.strokeStyle = S.ink; c.lineWidth = Math.max(2, 14 * z); drawPathPts(c, pts, true); c.stroke();
        c.strokeStyle = S.fill; c.lineWidth = Math.max(1, 8 * z); c.stroke();
      }
      if (selId === pa.id) { c.setLineDash([]); c.strokeStyle = '#3b82f6'; c.lineWidth = 2; drawPathPts(c, pts, pa.kind !== 'border'); c.stroke(); }
      c.restore();
      if (pa.name && pts.length >= 4) {
        var m = Math.floor(pts.length / 4) * 2, fs = 22 * z;
        if (fs >= 5) {
          var ang = Math.atan2(pts[m + 1] - pts[m - 1 < 0 ? 1 : m - 1], pts[m] - pts[m - 2 < 0 ? 0 : m - 2]);
          if (Math.cos(ang) < 0) ang += Math.PI;
          c.save(); c.translate(pts[m], pts[m + 1]); c.rotate(ang); c.font = 'italic 600 ' + fs + "px Georgia,serif"; c.textAlign = 'center'; c.textBaseline = 'bottom';
          c.lineWidth = fs * .2; c.strokeStyle = S.fill; c.strokeText(pa.name, 0, -6 * z); c.fillStyle = pa.kind === 'river' ? '#1e4f73' : S.ink; c.fillText(pa.name, 0, -6 * z); c.restore();
        }
      }
    });
  }

  function loadImage(id) {
    if (imgCache[id] || !GDC.imageStore) return imgCache[id] || null;
    imgCache[id] = { img: null, loading: true };
    GDC.imageStore.getURL(id).then(function (url) {
      if (!url) { imgCache[id] = { img: null, missing: true }; return; }
      var im = new Image(); im.onload = function () { imgCache[id] = { img: im }; terrainKey = ''; requestDraw(); }; im.src = url;
    });
    return imgCache[id];
  }

  function drawStamp(c, st, S, v, selected) {
    var p = toScreen(st.x, st.y, v), unit = STAMP_UNIT * st.s * v.z;
    if (unit < 0.8) return;
    c.save(); c.translate(p[0], p[1]); c.rotate(st.r * Math.PI / 180);
    if (st.o > 0 && st.o < 1) c.globalAlpha *= st.o;
    if (PACK_BR[st.k]) {
      var pimg = packImage(st.k);
      if (pimg) { var pw = pimg.width, ph = pimg.height, psc = unit * 2 / Math.max(pw, ph); c.drawImage(pimg, -pw * psc / 2, -ph * psc / 2, pw * psc, ph * psc); }
    } else if (st.k === 'image' && st.imageId) {
      var e = loadImage(st.imageId);
      if (e && e.img) { var w = e.img.width, h = e.img.height, sc = unit * 2 / Math.max(w, h); c.drawImage(e.img, -w * sc / 2, -h * sc / 2, w * sc, h * sc); }
      else { c.strokeStyle = S.ink; c.setLineDash([3, 3]); c.strokeRect(-unit, -unit, unit * 2, unit * 2); }
    } else {
      var def = STAMPS[st.k] || STAMPS.poi;
      c.scale(unit, unit);
      c.lineWidth = Math.min(0.12, 1.6 / unit); c.lineJoin = 'round'; c.lineCap = 'round'; c.strokeStyle = S.ink;
      def.draw(c, S.ink, st.c || S.fill);
    }
    c.restore();
    if (selected) {
      // moldura gira junto + alças (mesmo padrão do Designer de Cartas): ● em cima gira (Shift = 15°),
      // ■ no canto escala
      var hd = stampHandles(st, v);
      c.save(); c.translate(p[0], p[1]); c.rotate(st.r * Math.PI / 180);
      c.strokeStyle = '#3b82f6'; c.lineWidth = 1.5; c.setLineDash([4, 3]); c.strokeRect(-hd.box, -hd.box, hd.box * 2, hd.box * 2);
      c.setLineDash([]); c.beginPath(); c.moveTo(0, -hd.box); c.lineTo(0, -hd.box - 18); c.stroke();
      c.restore();
      c.save(); c.fillStyle = '#fff'; c.strokeStyle = '#3b82f6'; c.lineWidth = 2;
      c.beginPath(); c.arc(hd.rot[0], hd.rot[1], 6, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillRect(hd.scl[0] - 5, hd.scl[1] - 5, 10, 10); c.strokeRect(hd.scl[0] - 5, hd.scl[1] - 5, 10, 10);
      c.restore();
    }
  }
  /** Posições (em px de tela) das alças do carimbo selecionado. */
  function stampHandles(st, v) {
    var p = toScreen(st.x, st.y, v), box = Math.max(10, STAMP_UNIT * st.s * v.z * 1.15), a = st.r * Math.PI / 180;
    var rot = function (x, y) { return [p[0] + x * Math.cos(a) - y * Math.sin(a), p[1] + x * Math.sin(a) + y * Math.cos(a)]; };
    return { box: box, c: p, rot: rot(0, -box - 18), scl: rot(box, box) };
  }

  function labelMetrics(l) {
    var st = LABEL_STYLES[l.style] || LABEL_STYLES.place;
    var text = st.upper ? l.text.toUpperCase() : l.text;
    return { st: st, text: text, px: st.px * l.size };
  }
  function drawLabel(c, l, S, v, selected) {
    var m = labelMetrics(l), fs = m.px * v.z;
    if (fs < 3) return;
    var p = toScreen(l.x, l.y, v);
    c.save(); c.translate(p[0], p[1]); c.rotate(l.r * Math.PI / 180);
    c.font = m.st.weight + ' ' + fs + 'px ' + m.st.font; c.textBaseline = 'middle';
    var spacing = m.st.spacing * fs;
    var widths = m.text.split('').map(function (ch) { return c.measureText(ch).width + spacing; });
    var total = widths.reduce(function (a, b) { return a + b; }, 0) - spacing;
    c.lineJoin = 'round'; c.lineWidth = Math.max(2, fs * 0.22); c.strokeStyle = S.fill; c.fillStyle = l.c || S.ink;
    var drawChars = function (place) {
      var acc = -total / 2;
      m.text.split('').forEach(function (ch, i) {
        var w = widths[i]; var center = acc + (w - spacing) / 2; place(ch, center); acc += w;
      });
    };
    if (Math.abs(l.curve) < 0.02) {
      c.textAlign = 'center';
      drawChars(function (ch, x) { c.strokeText(ch, x, 0); }); drawChars(function (ch, x) { c.fillText(ch, x, 0); });
    } else {
      // texto ao longo de um arco: curve 1 = meia volta; positivo curva pra cima
      var R = total / (Math.abs(l.curve) * Math.PI), dir = l.curve > 0 ? 1 : -1;
      c.textAlign = 'center';
      var place = function (fn) {
        drawChars(function (ch, x) {
          var a = x / R;
          c.save(); c.translate(Math.sin(a) * R, dir * (R - Math.cos(a) * R)); c.rotate(dir * a); fn(ch); c.restore();
        });
      };
      place(function (ch) { c.strokeText(ch, 0, 0); }); place(function (ch) { c.fillText(ch, 0, 0); });
    }
    if (selected) { c.strokeStyle = '#3b82f6'; c.lineWidth = 1.5; c.setLineDash([4, 3]); c.strokeRect(-total / 2 - 6, -fs * .7, total + 12, fs * 1.4); }
    c.restore();
  }

  function drawCompass(c, map, S, v, selected) {
    var cp = map.compass; if (!cp.on) return;
    var p = toScreen(cp.x, cp.y, v), R = cp.size * v.z;
    if (R < 6) return;
    c.save(); c.translate(p[0], p[1]);
    c.strokeStyle = S.ink; c.lineWidth = Math.max(1, R * 0.02);
    c.beginPath(); c.arc(0, 0, R * 0.78, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(0, 0, R * 0.7, 0, Math.PI * 2); c.stroke();
    for (var t = 0; t < 32; t++) { var a = t / 32 * Math.PI * 2, r0 = t % 4 ? .72 : .66; c.beginPath(); c.moveTo(Math.cos(a) * R * r0, Math.sin(a) * R * r0); c.lineTo(Math.cos(a) * R * .78, Math.sin(a) * R * .78); c.stroke(); }
    var star = function (n, outer, inner, rot, fillA, fillB) {
      for (var k = 0; k < n; k++) {
        var a = rot + k * Math.PI * 2 / n, aL = a - Math.PI / n, aR = a + Math.PI / n;
        c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * outer, Math.sin(a) * outer); c.lineTo(Math.cos(aL) * inner, Math.sin(aL) * inner); c.closePath(); c.fillStyle = fillA; c.fill(); c.stroke();
        c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * outer, Math.sin(a) * outer); c.lineTo(Math.cos(aR) * inner, Math.sin(aR) * inner); c.closePath(); c.fillStyle = fillB; c.fill(); c.stroke();
      }
    };
    star(4, R * 0.62, R * 0.12, -Math.PI / 4, S.fill, S.ink);
    star(4, R * 0.95, R * 0.15, -Math.PI / 2, S.ink, S.fill);
    var fs = R * 0.22; c.font = '700 ' + fs + "px Georgia,serif"; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = fs * .2; c.strokeStyle = S.fill;
    [['N', 0, -1.12], ['S', 0, 1.12], ['L', 1.12, 0], ['O', -1.12, 0]].forEach(function (d) { c.strokeText(d[0], d[1] * R, d[2] * R); c.fillStyle = S.ink; c.fillText(d[0], d[1] * R, d[2] * R); });
    c.restore();
    if (selected) { c.save(); c.strokeStyle = '#3b82f6'; c.lineWidth = 1.5; c.setLineDash([4, 3]); c.strokeRect(p[0] - R * 1.3, p[1] - R * 1.3, R * 2.6, R * 2.6); c.restore(); }
  }

  function drawGrid(c, map, S, v, W, H) {
    if (map.kind !== 'world' || !map.grid.on) return;
    var cell = map.grid.cell, b = mapBounds(map);
    var step = cell * v.z;
    if (step < 4) return;
    c.save(); c.strokeStyle = S.grid; c.lineWidth = 1;
    var p0 = toScreen(0, 0, v), p1 = toScreen(b.w, b.h, v);
    if (map.grid.shape === 'hex') { drawHexGrid(c, map, S, v, W, H, p0, p1); c.restore(); return; }
    c.beginPath();
    for (var x = 0; x <= b.w + 0.01; x += cell) { var sx = Math.round(p0[0] + x * v.z) + .5; c.moveTo(sx, p0[1]); c.lineTo(sx, p1[1]); }
    for (var y = 0; y <= b.h + 0.01; y += cell) { var sy = Math.round(p0[1] + y * v.z) + .5; c.moveTo(p0[0], sy); c.lineTo(p1[0], sy); }
    c.stroke();
    if (map.grid.labels && step >= 16) {
      var fs = clamp(step * 0.3, 9, 22);
      c.font = '600 ' + fs + 'px system-ui,sans-serif'; c.fillStyle = S.ink; c.textAlign = 'center'; c.textBaseline = 'middle';
      var cols = Math.ceil(b.w / cell), rows = Math.ceil(b.h / cell);
      for (var i = 0; i < cols; i++) { var cx = p0[0] + (i + .5) * step; c.fillText(colName(i), cx, p0[1] - fs * .9); c.fillText(colName(i), cx, p1[1] + fs * .9); }
      for (var j = 0; j < rows; j++) { var cy = p0[1] + (j + .5) * step; c.fillText(String(j + 1), p0[0] - fs * 1.1, cy); c.fillText(String(j + 1), p1[0] + fs * 1.1, cy); }
    }
    c.restore();
  }

  function drawHexGrid(c, map, S, v, W, H, p0, p1) {
    var cell = map.grid.cell, d = hexDims(cell), b = mapBounds(map);
    var cols = Math.ceil(b.w / d.w), rows = Math.ceil((b.h - d.h / 4) / d.dy);
    // só os hexágonos visíveis (mapa grande com célula pequena teria dezenas de milhares)
    var vx0 = v.x, vy0 = v.y, vx1 = v.x + W / v.z, vy1 = v.y + H / v.z;
    var rA = Math.max(0, Math.floor((vy0 - d.h) / d.dy)), rB = Math.min(rows - 1, Math.ceil(vy1 / d.dy));
    var cA = Math.max(0, Math.floor(vx0 / d.w) - 1), cB = Math.min(cols - 1, Math.ceil(vx1 / d.w));
    c.save();
    c.beginPath(); c.rect(p0[0], p0[1], p1[0] - p0[0], p1[1] - p0[1]); c.clip(); // hexágonos cortados na borda do mapa
    c.beginPath();
    for (var r = rA; r <= rB; r++) for (var col = cA; col <= cB; col++) {
      var ce = hexCenter(cell, col, r);
      for (var k = 0; k < 6; k++) {
        var a = Math.PI / 180 * (60 * k - 30), x = ce[0] + d.h / 2 * Math.cos(a), y = ce[1] + d.h / 2 * Math.sin(a);
        var sp = toScreen(x, y, v);
        if (k) c.lineTo(sp[0], sp[1]); else c.moveTo(sp[0], sp[1]);
      }
      c.closePath();
    }
    c.stroke();
    c.restore();
    var step = cell * v.z;
    if (map.grid.labels && step >= 16) {
      var fs = clamp(step * 0.3, 9, 22);
      c.font = '600 ' + fs + 'px system-ui,sans-serif'; c.fillStyle = S.ink; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (var i = 0; i < cols; i++) { var cx = toScreen(hexCenter(cell, i, 0)[0], 0, v)[0]; c.fillText(colName(i), cx, p0[1] - fs * .9); c.fillText(colName(i), cx, p1[1] + fs * .9); }
      for (var j = 0; j < rows; j++) { var cy = toScreen(0, hexCenter(cell, 0, j)[1], v)[1]; c.fillText(String(j + 1), p0[0] - fs * 1.1, cy); c.fillText(String(j + 1), p1[0] + fs * 1.1, cy); }
    }
  }

  /** Desenha o mapa inteiro (tela ou export). `opts.terrain` = canvas de cache já pronto (tela). */
  function drawScene(c, map, v, W, H, opts) {
    opts = opts || {};
    var S = STYLES[map.style] || STYLES.wasteland;
    var L = map.layers;
    var vis = function (id) { return !L[id] || L[id].visible; };
    drawBackground(c, map, S, v, W, H);
    if (map.kind === 'radial' && vis('structure')) drawRadial(c, map, S, v, opts.selSector);
    if (vis('terrain')) {
      if (opts.terrain && opts.terrainXform) { var tx = opts.terrainXform; c.drawImage(opts.terrain, tx.dx, tx.dy, W * tx.s, H * tx.s); }
      else if (opts.terrain) c.drawImage(opts.terrain, 0, 0, W, H);
      else { var off = document.createElement('canvas'); off.width = c.canvas.width; off.height = c.canvas.height; renderTerrainLayer(off, map, v, W, H); c.drawImage(off, 0, 0, W, H); }
    }
    var sel = opts.selected || {};
    if (vis('regions')) drawRegions(c, map, S, v, sel.type === 'region' ? sel.id : null);
    if (vis('paths')) drawPaths(c, map, S, v, sel.type === 'path' ? sel.id : null);
    if (vis('stamps')) map.stamps.forEach(function (st) { drawStamp(c, st, S, v, sel.type === 'stamp' && sel.id === st.id); });
    if (vis('regions')) drawRegionNames(c, map, S, v);
    if (vis('decor')) { if (map.kind === 'hex') drawHexEdgeLabels(c, map, S, v); else drawGrid(c, map, S, v, W, H); }
    if (map.kind === 'hex' && sel.type === 'hex') {
      var hp = sel.key.split(','), pts = hCorners(map.hex, Number(hp[0]), Number(hp[1]));
      c.save(); c.beginPath();
      for (var q = 0; q < 12; q += 2) { var sp = toScreen(pts[q], pts[q + 1], v); if (q) c.lineTo(sp[0], sp[1]); else c.moveTo(sp[0], sp[1]); }
      c.closePath(); c.strokeStyle = '#f59e0b'; c.lineWidth = 3; c.stroke(); c.restore();
    }
    if (vis('labels')) map.labels.forEach(function (l) { drawLabel(c, l, S, v, sel.type === 'label' && sel.id === l.id); });
    if (vis('decor')) drawCompass(c, map, S, v, sel.type === 'compass');
  }

  // ---------- Tela ----------
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    (global.requestAnimationFrame || setTimeout)(function () { drawQueued = false; draw(); });
  }
  var cacheView = null, cacheContent = '', settleTimer = null;
  /** O que o terreno desenhado depende, fora a vista. */
  function contentKey(map) { return [map.id, canvas.width, canvas.height, map.strokes.length, map._sv || 0, map.kind === 'hex' ? JSON.stringify(map.hex.tiles).length : 0].join('|'); }
  function syncTerrainCache(map) {
    if (!terrainCache || !canvas) return;
    var key = viewKey(map);
    if (key === terrainKey) return;
    clearTimeout(settleTimer);
    var W = canvas.width / dpr, H = canvas.height / dpr;
    renderTerrainLayer(terrainCache, map, view, W, H); terrainKey = key;
    cacheView = { x: view.x, y: view.y, z: view.z }; cacheContent = contentKey(map);
  }
  function viewKey(map) { return [map.id, view.x.toFixed(2), view.y.toFixed(2), view.z.toFixed(5), canvas.width, canvas.height, map.strokes.length, map._sv || 0].join('|'); }

  function draw() {
    if (!canvas || !root) return;
    var map = activeMap();
    var W = canvas.width / dpr, H = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!map) { ctx.clearRect(0, 0, W, H); return; }
    if (!terrainCache) terrainCache = document.createElement('canvas');
    if (terrainCache.width !== canvas.width || terrainCache.height !== canvas.height) { terrainCache.width = canvas.width; terrainCache.height = canvas.height; terrainKey = ''; }
    var key = viewKey(map), xform = null;
    if (key !== terrainKey && !(draft && draft.type === 'stroke')) {
      // Só a vista mudou (arrastar / zoom)? Reaproveita o terreno já pintado, deslocado/escalado, e
      // repinta de verdade quando a vista para — repintar todos os traços a cada quadro travava.
      var content = contentKey(map);
      if (cacheView && cacheContent === content && terrainKey) {
        var k = view.z / cacheView.z;
        xform = { dx: (cacheView.x - view.x) * view.z, dy: (cacheView.y - view.y) * view.z, s: k };
        clearTimeout(settleTimer);
        settleTimer = setTimeout(function () { terrainKey = ''; requestDraw(); }, 140);
      } else {
        renderTerrainLayer(terrainCache, map, view, W, H); terrainKey = key;
        cacheView = { x: view.x, y: view.y, z: view.z }; cacheContent = content;
      }
    }
    var terrainImg = terrainCache;
    if (draft && draft.type === 'stroke' && draft.live && liveLayer) {
      // compõe cache + traço ao vivo numa cópia (o cache continua limpo pro redesenho final)
      if (!liveComp) liveComp = document.createElement('canvas');
      if (liveComp.width !== terrainCache.width || liveComp.height !== terrainCache.height) { liveComp.width = terrainCache.width; liveComp.height = terrainCache.height; }
      var lc = liveComp.getContext('2d');
      lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalAlpha = 1; lc.globalCompositeOperation = 'source-over';
      lc.clearRect(0, 0, liveComp.width, liveComp.height); lc.drawImage(terrainCache, 0, 0);
      lc.globalAlpha = draft.st.o || 1; if (draft.st.t === 'erase') lc.globalCompositeOperation = 'destination-out';
      lc.drawImage(liveLayer, 0, 0);
      lc.globalAlpha = 1; lc.globalCompositeOperation = 'source-over';
      terrainImg = liveComp;
    }
    drawScene(ctx, map, view, W, H, { terrain: terrainImg, terrainXform: xform, selected: selected, selSector: selected && selected.type === 'sector' ? selected : null });
    drawDraft(map);
  }

  function drawDraft(map) {
    if (!draft) return;
    var S = STYLES[map.style] || STYLES.wasteland;
    if (draft.type === 'region' || draft.type === 'path') {
      var pts = draft.pts.concat(draft.hover ? [draft.hover.x, draft.hover.y] : []);
      ctx.save(); ctx.strokeStyle = draft.type === 'region' ? ui.regionColor : S.ink; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (var i = 0; i < pts.length; i += 2) { var p = toScreen(pts[i], pts[i + 1], view); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
      if (draft.type === 'region' && pts.length >= 6) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#3b82f6';
      for (var j = 0; j < draft.pts.length; j += 2) { var q = toScreen(draft.pts[j], draft.pts[j + 1], view); ctx.beginPath(); ctx.arc(q[0], q[1], 3.5, 0, 7); ctx.fill(); }
      ctx.restore();
    }
    if (draft.type === 'cursor') {
      var c = toScreen(draft.x, draft.y, view);
      ctx.save(); ctx.strokeStyle = 'rgba(59,130,246,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(c[0], c[1], draft.r * view.z / 2, 0, 7); ctx.stroke(); ctx.restore();
    }
  }

  function resizeCanvas() {
    if (!canvas || !wrapEl) return;
    var r = wrapEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = global.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
    if (needsFit) { needsFit = false; fitView(); }
    requestDraw();
  }

  function fitView() {
    var map = activeMap();
    if (!map || !canvas || !canvas.width) { needsFit = true; return; }
    var W = canvas.width / dpr, H = canvas.height / dpr, b = mapBounds(map), pad = map.kind !== 'radial' ? 60 : 24;
    view.z = clamp(Math.min((W - pad * 2) / b.w, (H - pad * 2) / b.h), Z_MIN, Z_MAX);
    view.x = b.x + b.w / 2 - W / 2 / view.z; view.y = b.y + b.h / 2 - H / 2 / view.z;
    updateZoomLabel(); requestDraw();
  }
  function zoomAt(mx, my, nz) {
    nz = clamp(nz, Z_MIN, Z_MAX);
    var wx = view.x + mx / view.z, wy = view.y + my / view.z;
    view.z = nz; view.x = wx - mx / nz; view.y = wy - my / nz;
    updateZoomLabel(); requestDraw();
  }
  function updateZoomLabel() { var el = root && root.querySelector('#at-zoom'); if (el) el.textContent = Math.round(view.z * 100) + '%'; }

  // ---------- Mutação / desfazer ----------
  function hist(map) { return history[map.id] || (history[map.id] = { u: [], r: [] }); }
  function mutate(fn, opts) {
    var map = activeMap(); if (!map) return;
    var before = JSON.stringify(map);
    fn(map);
    var h = hist(map); h.u.push(before); if (h.u.length > 60) h.u.shift(); h.r = [];
    map._sv = (map._sv || 0) + 1;
    changed(opts);
  }
  function changed(opts) {
    if (onChange) onChange();
    if (!(opts && opts.noPanel)) refreshPanel();
    requestDraw();
  }
  function restore(map, json) {
    var data = JSON.parse(json);
    Object.keys(map).forEach(function (k) { delete map[k]; });
    Object.assign(map, data); map._sv = (map._sv || 0) + 1;
  }
  function undo() { var map = activeMap(); if (!map) return; var h = hist(map); if (!h.u.length) return; h.r.push(JSON.stringify(map)); restore(map, h.u.pop()); selected = null; changed(); }
  function redo() { var map = activeMap(); if (!map) return; var h = hist(map); if (!h.r.length) return; h.u.push(JSON.stringify(map)); restore(map, h.r.pop()); selected = null; changed(); }

  function layerOk(map, layer) { var l = map.layers[layer]; return !l || (l.visible && !l.locked); }

  // ---------- Hit test ----------
  function hitTest(map, x, y) {
    var z = view.z, tol = 8 / z;
    var L = function (id) { return layerOk(map, id); };
    if (L('decor') && map.compass.on && Math.hypot(x - map.compass.x, y - map.compass.y) < map.compass.size) return { type: 'compass' };
    var i;
    if (L('labels')) for (i = map.labels.length - 1; i >= 0; i--) {
      var l = map.labels[i], m = labelMetrics(l), w = m.text.length * m.px * 0.6;
      if (Math.abs(x - l.x) < w / 2 + tol && Math.abs(y - l.y) < m.px * 0.7 + tol) return { type: 'label', id: l.id };
    }
    if (L('stamps')) for (i = map.stamps.length - 1; i >= 0; i--) {
      var st = map.stamps[i];
      if (Math.hypot(x - st.x, y - st.y) < STAMP_UNIT * st.s * 1.05 + tol) return { type: 'stamp', id: st.id };
    }
    if (L('paths')) for (i = map.paths.length - 1; i >= 0; i--) {
      var pa = map.paths[i];
      for (var k = 0; k + 3 < pa.pts.length; k += 2) if (distToSeg(x, y, pa.pts[k], pa.pts[k + 1], pa.pts[k + 2], pa.pts[k + 3]) < tol + 10) return { type: 'path', id: pa.id };
    }
    if (L('regions')) for (i = map.regions.length - 1; i >= 0; i--) {
      if (pointInPoly(x, y, map.regions[i].pts)) return { type: 'region', id: map.regions[i].id };
    }
    if (map.kind === 'radial' && L('structure')) { var sec = sectorAt(map, x, y); if (sec) return { type: 'sector', ring: sec.ring, sector: sec.sector }; }
    if (map.kind === 'hex') { var hh = hAt(map.hex, x, y); if (hh) return { type: 'hex', key: hh.key }; }
    return null;
  }
  function findItem(map, sel) {
    if (!sel) return null;
    var list = { stamp: map.stamps, label: map.labels, region: map.regions, path: map.paths }[sel.type];
    return list ? list.filter(function (it) { return it.id === sel.id; })[0] || null : null;
  }
  function deleteSelected() {
    var map = activeMap(); if (!map || !selected) return;
    if (selected.type === 'compass') { mutate(function (m) { m.compass.on = false; }); selected = null; return; }
    if (selected.type === 'sector') return;
    if (selected.type === 'hex') { var hk = selected.key; mutate(function (m) { delete m.hex.tiles[hk]; delete m.hex.notes[hk]; }); refreshPanel(); return; }
    var key = { stamp: 'stamps', label: 'labels', region: 'regions', path: 'paths' }[selected.type];
    var id = selected.id;
    mutate(function (m) { m[key] = m[key].filter(function (it) { return it.id !== id; }); });
    selected = null; refreshPanel();
  }

  // ---------- Entrada ----------
  function worldOf(e) { var r = canvas.getBoundingClientRect(); var mx = e.clientX - r.left, my = e.clientY - r.top; return { x: view.x + mx / view.z, y: view.y + my / view.z, mx: mx, my: my }; }
  function currentTool() { return spaceDown ? 'pan' : ui.tool; }

  function onPointerDown(e) {
    if (e.button === 1 || (e.button === 0 && currentTool() === 'pan')) { drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; canvas.setPointerCapture(e.pointerId); return; }
    if (e.button !== 0) return;
    var map = activeMap(); if (!map) return;
    if (textEdit) commitText();
    var p = worldOf(e), tool = currentTool();
    if (TOOL_LAYER[tool] && !layerOk(map, TOOL_LAYER[tool])) { flash('A camada "' + LAYER_LABELS[TOOL_LAYER[tool]] + '" está oculta ou travada.'); return; }
    canvas.setPointerCapture(e.pointerId);
    if (map.kind === 'hex' && (tool === 'tile' || tool === 'eraser' || tool === 'fill')) {
      var h0 = hAt(map.hex, p.x, p.y); if (!h0) return;
      var tid = tool === 'eraser' ? null : ui.tileId;
      if (tid && !tileById(map, tid)) { tid = (map.tileset[0] || {}).id || null; ui.tileId = tid; }
      if (tool !== 'eraser' && !tid) { flash('Crie uma peça no painel "Tileset" primeiro.'); return; }
      if (tool === 'fill') {
        var keys = hFlood(map.hex, h0.c, h0.r);
        if ((map.hex.tiles[h0.key] || null) === tid) return;
        mutate(function (m) { keys.forEach(function (k) { if (tid) m.hex.tiles[k] = tid; else delete m.hex.tiles[k]; }); });
        return;
      }
      draft = { type: 'tiles', before: JSON.stringify(map), tid: tid, last: null };
      paintHex(map, h0); return;
    }
    if (tool === 'fill' && map.kind !== 'hex') {
      var res = computeFill(map, p.x, p.y, ui.terrain);
      if (res.error) { flash(res.error); return; }
      var fst = { id: mid('st'), t: ui.terrain, s: res.fill.r, p: [Math.round(p.x), Math.round(p.y), Math.round(p.x), Math.round(p.y)], fill: res.fill };
      if (ui.opacity < 1) fst.o = ui.opacity;
      mutate(function (m) { m.strokes.push(fst); }, { noPanel: true });
      terrainKey = ''; return;
    }
    if (tool === 'brush' || tool === 'eraser' || tool === 'decal') {
      if (tool === 'decal' && !PACK_BR[ui.decal]) { flash('Escolha um pincel na barra de opções.'); return; }
      syncTerrainCache(map); // o traço é desenhado direto no cache: ele precisa estar na vista atual
      var before = JSON.stringify(map);
      var st = { id: mid('st'), t: tool === 'eraser' ? 'erase' : (tool === 'decal' ? ui.decal : ui.terrain), s: ui.brush, p: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10] };
      if (ui.opacity < 1) st.o = ui.opacity;
      map.strokes.push(st);
      draft = { type: 'stroke', st: st, before: before, decalDrawn: 0, live: st.o < 1 };
      if (draft.live) startLiveLayer();
      paintIncremental(map, st, st.p.length - 2);
      return;
    }
    if (tool === 'stamp') {
      var add = function (x, y) {
        var jitter = ui.scatter ? (0.75 + Math.random() * 0.5) : 1;
        var sp = { id: mid('sp'), k: ui.stamp, x: Math.round(x), y: Math.round(y), s: Math.round(ui.stampScale * jitter * 100) / 100, r: ui.stampRandRot ? Math.round(Math.random() * 360 - 180) : (ui.scatter ? ui.stampRot + Math.round((Math.random() - .5) * 16) : ui.stampRot), c: null, imageId: ui.stamp === 'image' ? ui.stampImage : null };
        if (ui.stampOpacity < 1) sp.o = ui.stampOpacity;
        return sp;
      };
      if (ui.stamp === 'image' && !ui.stampImage) { flash('Envie uma imagem PNG primeiro (botão "Imagem" nas opções do carimbo).'); return; }
      var first = add(p.x, p.y);
      if (ui.scatter) {
        var b2 = JSON.stringify(map);
        map.stamps.push(first);
        draft = { type: 'scatter', before: b2, lx: p.x, ly: p.y, add: add };
        requestDraw();
      } else {
        mutate(function (m) { m.stamps.push(first); });
        selected = { type: 'stamp', id: first.id }; refreshPanel();
      }
      return;
    }
    if (tool === 'text') { startText(p.x, p.y, null); return; }
    if (tool === 'region' || tool === 'path') {
      if (!draft || draft.type !== tool) draft = { type: tool, pts: [] };
      var last = draft.pts.length ? [draft.pts[draft.pts.length - 2], draft.pts[draft.pts.length - 1]] : null;
      if (!last || Math.hypot(last[0] - p.x, last[1] - p.y) > 4 / view.z) draft.pts.push(Math.round(p.x), Math.round(p.y));
      requestDraw(); return;
    }
    // select — alças do carimbo selecionado têm prioridade
    if (selected && selected.type === 'stamp' && layerOk(map, 'stamps')) {
      var sit = findItem(map, selected);
      if (sit) {
        var hd = stampHandles(sit, view);
        if (Math.hypot(p.mx - hd.rot[0], p.my - hd.rot[1]) < 10) { drag = { type: 'rotate', sel: selected, c: hd.c, before: JSON.stringify(map), moved: false }; return; }
        if (Math.hypot(p.mx - hd.scl[0], p.my - hd.scl[1]) < 10) { drag = { type: 'scale', sel: selected, c: hd.c, d0: Math.max(4, Math.hypot(p.mx - hd.c[0], p.my - hd.c[1])), s0: sit.s, before: JSON.stringify(map), moved: false }; return; }
      }
    }
    var hit = hitTest(map, p.x, p.y);
    selected = hit;
    if (hit && hit.type !== 'sector' && hit.type !== 'hex') drag = { type: 'move', sel: hit, sx: p.x, sy: p.y, before: JSON.stringify(map), moved: false };
    refreshPanel(); requestDraw();
  }

  function paintHex(map, h) {
    if (!draft || draft.type !== 'tiles' || draft.last === h.key) return;
    draft.last = h.key;
    var any = false;
    hArea(map.hex, h.c, h.r, ui.tileRadius - 1).forEach(function (k) {
      if ((map.hex.tiles[k] || null) === draft.tid) return; any = true;
      if (draft.tid) map.hex.tiles[k] = draft.tid; else delete map.hex.tiles[k];
    });
    if (any) { map._sv = (map._sv || 0) + 1; draft.dirty = true; requestDraw(); }
  }

  function paintIncremental(map, st, from) {
    // desenha só o trecho novo direto no cache de terreno (sem refazer todos os traços)
    if (!terrainCache) return;
    var W = canvas.width / dpr, H = canvas.height / dpr;
    var c = terrainCache.getContext('2d'), k = terrainCache.width / W;
    c.setTransform(view.z * k, 0, 0, view.z * k, -view.x * view.z * k, -view.y * view.z * k);
    var live = draft && draft.st === st && draft.live;
    if (live) { c = liveLayer.getContext('2d'); c.setTransform(view.z * k, 0, 0, view.z * k, -view.x * view.z * k, -view.y * view.z * k); }
    c.save(); clipPaper(c, map);
    if (isDecal(st)) {
      // carimbos: desenha só os que ainda não foram desenhados (a lista é determinística)
      if (draft && draft.st === st) draft.decalDrawn = drawDecals(c, st, draft.decalDrawn);
    } else {
      var seg = { t: st.t, s: st.s, p: st.p.slice(Math.max(0, from - 2)) };
      if (live && st.t === 'erase') paintRaw(c, seg, view.z * k, true); else paintStroke(c, seg, view.z * k);
    }
    c.restore();
    c.setTransform(1, 0, 0, 1, 0, 0);
    requestDraw();
  }
  // Traço translúcido em andamento: vai pra uma camada própria, com opacidade cheia, que o draw()
  // compõe com a opacidade do traço — assim o traço não escurece onde passa por cima de si mesmo.
  var liveLayer = null, liveComp = null;
  function startLiveLayer() {
    if (!liveLayer) liveLayer = document.createElement('canvas');
    liveLayer.width = canvas.width; liveLayer.height = canvas.height;
  }

  function onPointerMove(e) {
    var map = activeMap();
    var p = worldOf(e);
    if (statusEl && map) {
      var cell = map.kind === 'hex' ? null : cellName(map, p.x, p.y), sec = map.kind === 'radial' ? sectorAt(map, p.x, p.y) : null, txt = '';
      if (cell) txt = (map.grid.shape === 'hex' ? 'Hexágono ' : 'Quadrante ') + cell;
      if (map.kind === 'hex') { var hs = hAt(map.hex, p.x, p.y); if (hs) { var tl = tileById(map, map.hex.tiles[hs.key]); txt = 'Hexágono ' + colName(hs.c) + (hs.r + 1) + (tl ? ' · ' + tl.name : ' · vazio') + (map.hex.notes[hs.key] ? ' · tem nota' : ''); } }
      if (sec) { var ring = map.radial.rings[sec.ring], nm = (ring.cells[sec.sector] || {}).name; txt = (ring.name || 'Anel ' + (sec.ring + 1)) + (nm ? ' · ' + nm : ' · setor ' + (sec.sector + 1)); }
      statusEl.textContent = txt + (txt ? ' · ' : '') + 'x ' + Math.round(p.x) + ', y ' + Math.round(p.y);
    }
    if (drag && drag.type === 'pan') { view.x = drag.vx - (e.clientX - drag.sx) / view.z; view.y = drag.vy - (e.clientY - drag.sy) / view.z; requestDraw(); return; }
    if (!map) return;
    if (draft && draft.type === 'tiles') { var hm = hAt(map.hex, p.x, p.y); if (hm) paintHex(map, hm); return; }
    if (draft && draft.type === 'stroke') {
      var st = draft.st, lx = st.p[st.p.length - 2], ly = st.p[st.p.length - 1];
      if (Math.hypot(p.x - lx, p.y - ly) >= Math.max(2 / view.z, st.s * 0.12)) { st.p.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10); paintIncremental(map, st, st.p.length - 2); }
      return;
    }
    if (draft && draft.type === 'scatter') {
      var spacing = STAMP_UNIT * ui.stampScale * 1.6;
      if (Math.hypot(p.x - draft.lx, p.y - draft.ly) >= spacing) {
        var jx = (Math.random() - .5) * spacing * .6, jy = (Math.random() - .5) * spacing * .6;
        map.stamps.push(draft.add(p.x + jx, p.y + jy)); draft.lx = p.x; draft.ly = p.y; requestDraw();
      }
      return;
    }
    if ((ui.tool === 'brush' || ui.tool === 'eraser' || ui.tool === 'decal') && !spaceDown && map.kind !== 'hex') { draft = draft && draft.type !== 'cursor' ? draft : { type: 'cursor', x: p.x, y: p.y, r: ui.brush }; if (draft.type === 'cursor') { draft.x = p.x; draft.y = p.y; draft.r = ui.brush; } requestDraw(); }
    if (draft && (draft.type === 'region' || draft.type === 'path')) { draft.hover = p; requestDraw(); }
    if (drag && (drag.type === 'rotate' || drag.type === 'scale')) {
      var ri = findItem(map, drag.sel); if (!ri) return;
      drag.moved = true;
      if (drag.type === 'rotate') {
        // ângulo medido a partir do NORTE, sentido horário (a alça nasce em cima, giro 0°)
        var ang = Math.atan2(p.mx - drag.c[0], -(p.my - drag.c[1])) * 180 / Math.PI;
        if (e.shiftKey) ang = Math.round(ang / 15) * 15;
        ri.r = Math.round(((ang + 540) % 360) - 180);
      } else {
        ri.s = clamp(Math.round(drag.s0 * Math.hypot(p.mx - drag.c[0], p.my - drag.c[1]) / drag.d0 * 100) / 100, 0.1, 50);
      }
      requestDraw(); return;
    }
    if (drag && drag.type === 'move') {
      var dx = p.x - drag.sx, dy = p.y - drag.sy; if (!dx && !dy) return;
      drag.sx = p.x; drag.sy = p.y; drag.moved = true;
      var sel = drag.sel;
      if (sel.type === 'compass') { map.compass.x += dx; map.compass.y += dy; }
      else {
        var it = findItem(map, sel); if (!it) return;
        if (it.pts) for (var i = 0; i < it.pts.length; i += 2) { it.pts[i] += dx; it.pts[i + 1] += dy; }
        else { it.x += dx; it.y += dy; }
      }
      requestDraw();
    }
  }

  function onPointerUp() {
    var map = activeMap();
    if (drag && (drag.type === 'rotate' || drag.type === 'scale') && drag.moved && map) {
      var hr = hist(map); hr.u.push(drag.before); hr.r = []; changed();
    }
    if (drag && drag.type === 'move' && drag.moved && map) {
      var it = findItem(map, drag.sel);
      if (it) { if (it.pts) it.pts = it.pts.map(function (v) { return Math.round(v); }); else { it.x = Math.round(it.x); it.y = Math.round(it.y); } }
      if (drag.sel.type === 'compass') { map.compass.x = Math.round(map.compass.x); map.compass.y = Math.round(map.compass.y); }
      var h = hist(map); h.u.push(drag.before); h.r = []; map._sv = (map._sv || 0) + 1; changed();
    }
    if (draft && draft.type === 'tiles') {
      if (draft.dirty && map) { var ht = hist(map); ht.u.push(draft.before); if (ht.u.length > 60) ht.u.shift(); ht.r = []; terrainKey = ''; draft = null; changed(); }
      else draft = null;
    }
    if (draft && (draft.type === 'stroke' || draft.type === 'scatter') && map) {
      var hh = hist(map); hh.u.push(draft.before); if (hh.u.length > 60) hh.u.shift(); hh.r = [];
      map._sv = (map._sv || 0) + 1; draft = null; terrainKey = ''; changed({ noPanel: true });
    }
    drag = null;
  }

  function finishDraft() {
    if (!draft) return;
    var d = draft; draft = null;
    if (d.type === 'region' && d.pts.length >= 6) {
      var rg = { id: mid('rg'), name: '', pts: d.pts.slice(), c: ui.regionColor, dash: true };
      mutate(function (m) { m.regions.push(rg); }); selected = { type: 'region', id: rg.id }; refreshPanel();
      var ni = root.querySelector('[data-asel="name"]'); if (ni) ni.focus();
    } else if (d.type === 'path' && d.pts.length >= 4) {
      var pa = { id: mid('pa'), name: '', pts: d.pts.slice(), kind: ui.pathKind };
      mutate(function (m) { m.paths.push(pa); }); selected = { type: 'path', id: pa.id }; refreshPanel();
    }
    requestDraw();
  }

  function startText(x, y, label) {
    textEdit = { x: x, y: y, label: label };
    var p = toScreen(x, y, view);
    textInput.style.display = 'block'; textInput.style.left = p[0] + 'px'; textInput.style.top = p[1] + 'px';
    textInput.value = label ? label.text : '';
    setTimeout(function () { textInput.focus(); textInput.select(); }, 0);
  }
  function commitText() {
    if (!textEdit) return;
    var t = textInput.value.trim(), te = textEdit; textEdit = null; textInput.style.display = 'none';
    if (!t) return;
    if (te.label) { var id = te.label.id; mutate(function (m) { var l = m.labels.filter(function (x) { return x.id === id; })[0]; if (l) l.text = t; }); return; }
    var lb = { id: mid('lb'), text: t, x: Math.round(te.x), y: Math.round(te.y), style: ui.labelStyle, size: 1, curve: 0, r: 0, c: null };
    mutate(function (m) { m.labels.push(lb); }); selected = { type: 'label', id: lb.id }; refreshPanel();
  }

  function isTyping(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function isVisible() { return root && root.offsetParent !== null; }
  function onKeyDown(e) {
    if (!isVisible()) return;
    if (e.target === textInput) {
      if (e.key === 'Enter') { e.preventDefault(); commitText(); } else if (e.key === 'Escape') { e.preventDefault(); textEdit = null; textInput.style.display = 'none'; }
      return;
    }
    if (isTyping(e.target)) return;
    var k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'd' && selected && selected.type === 'stamp') { e.preventDefault(); var db = root.querySelector('[data-at="dup-sel"]'); if (db) db.click(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') { if (!spaceDown) { spaceDown = true; setCursor(); } e.preventDefault(); return; }
    if (e.key === 'Escape') { if (draft && (draft.type === 'region' || draft.type === 'path')) { draft = null; requestDraw(); e.preventDefault(); return; } if (selected) { selected = null; refreshPanel(); requestDraw(); e.preventDefault(); } return; }
    if (e.key === 'Enter') { finishDraft(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (selected) { e.preventDefault(); deleteSelected(); } return; }
    if (selected && selected.type === 'stamp' && (e.key === '[' || e.key === ']')) {
      var stepR = (e.key === '[' ? -1 : 1) * 15, sid0 = selected.id;
      mutate(function (m) { var x = findItem(m, { type: 'stamp', id: sid0 }); if (x) x.r = Math.round((((x.r || 0) + stepR + 540) % 360) - 180); });
      e.preventDefault(); return;
    }
    var nud = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (nud && selected && (selected.type === 'stamp' || selected.type === 'label')) {
      var stepN = (e.shiftKey ? 10 : 1) / view.z, sel0 = selected;
      mutate(function (m) { var x = findItem(m, sel0); if (x) { x.x = Math.round((x.x + nud[0] * stepN) * 10) / 10; x.y = Math.round((x.y + nud[1] * stepN) * 10) / 10; } }, { noPanel: true });
      e.preventDefault(); return;
    }
    if (k === 'f') { fitView(); return; }
    var km = activeMap();
    if (k === 'g' && !(km && km.kind === 'hex')) { if (km && km.kind === 'world') mutate(function (m) { m.grid.on = !m.grid.on; }); return; }
    if (k === '+' || k === '=') { zoomAt(canvas.width / dpr / 2, canvas.height / dpr / 2, view.z * 1.25); return; }
    if (k === '-') { zoomAt(canvas.width / dpr / 2, canvas.height / dpr / 2, view.z / 1.25); return; }
    var order = toolOrder(); for (var ti = 0; ti < order.length; ti++) if (keyOf(order[ti]) === k) { setTool(order[ti]); return; }
  }
  function onKeyUp(e) { if (e.key === ' ' && spaceDown) { spaceDown = false; setCursor(); } }

  function setCursor() {
    if (!canvas) return;
    var t = currentTool();
    canvas.style.cursor = t === 'pan' ? (drag ? 'grabbing' : 'grab') : (t === 'select' ? 'default' : (t === 'text' ? 'text' : 'crosshair'));
  }
  function setTool(name) {
    if (draft && (draft.type === 'region' || draft.type === 'path')) finishDraft();
    ui.tool = name; draft = null; renderRail(); renderOptbar(); setCursor(); requestDraw();
  }
  var flashTimer = null;
  function flash(msg) {
    var h = root.querySelector('#at-hint'); if (!h) return;
    h.textContent = msg; h.classList.add('lp-hint-warn');
    clearTimeout(flashTimer); flashTimer = setTimeout(function () { h.classList.remove('lp-hint-warn'); h.textContent = toolHint(ui.tool); }, 2600);
  }

  // ---------- Biblioteca do pacote (popover em grade, por categoria) ----------
  var pickerEl = null;
  function closePicker() {
    if (!pickerEl) return;
    pickerEl.remove(); pickerEl = null;
    document.removeEventListener('mousedown', pickerOutside, true); document.removeEventListener('keydown', pickerKey, true);
  }
  function pickerOutside(e) { if (pickerEl && !pickerEl.contains(e.target)) closePicker(); }
  function pickerKey(e) { if (e.key === 'Escape' && pickerEl) { e.preventDefault(); e.stopPropagation(); closePicker(); } }
  function remember(list, id) { var i = list.indexOf(id); if (i !== -1) list.splice(i, 1); list.unshift(id); if (list.length > 8) list.length = 8; }
  function openPackPicker(anchor, mode) {
    closePicker();
    var tex = mode === 'pick-tex', items = tex ? PACK.textures : mode === 'pick-stamp' ? OBJ.concat(PACK.brushes) : PACK.brushes;
    var cats = []; items.forEach(function (x) { if (cats.indexOf(x.cat) === -1) cats.push(x.cat); });
    var cur = tex ? ui.terrain : (mode === 'pick-decal' ? ui.decal : ui.stamp);
    pickerEl = document.createElement('div');
    pickerEl.className = 'at-picker';
    pickerEl.innerHTML = '<div class="at-picker-head"><strong>' + (tex ? 'Texturas de terreno' : mode === 'pick-decal' ? 'Pincéis de carimbo' : 'Carimbos do pacote') + '</strong>' +
      '<input type="search" class="input-field py-1 text-xs" placeholder="Filtrar…" data-pk-filter /></div><div class="at-picker-body">' +
      cats.map(function (cat) {
        return '<p class="at-picker-cat">' + escapeHtml(cat) + '</p><div class="at-picker-grid">' + items.filter(function (x) { return x.cat === cat; }).map(function (x) {
          return '<button type="button" class="at-picker-item' + (x.id === cur ? ' at-picker-on' : '') + (tex ? '' : ' at-picker-alpha') + '" data-pk="' + x.id + '" title="' + escapeHtml(x.name) + '" data-name="' + escapeHtml(x.name.toLowerCase()) + '"><img src="' + x.src + '" alt="" loading="lazy" /></button>';
        }).join('') + '</div>';
      }).join('') + '</div>';
    document.body.appendChild(pickerEl);
    var r = anchor.getBoundingClientRect(), W = Math.min(440, window.innerWidth - 16);
    pickerEl.style.width = W + 'px';
    pickerEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8)) + 'px';
    pickerEl.style.top = Math.min(r.bottom + 6, window.innerHeight - 220) + 'px';
    pickerEl.style.maxHeight = Math.max(220, window.innerHeight - r.bottom - 20) + 'px';
    pickerEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pk]'); if (!b) return;
      var id = b.getAttribute('data-pk');
      preloadPack(id);
      if (tex) { ui.terrain = id; remember(ui.recentTex, id); if (ui.tool !== 'brush' && ui.tool !== 'fill') setTool('brush'); }
      else if (mode === 'pick-decal') { ui.decal = id; remember(ui.recentDecal, id); if (ui.tool !== 'decal') setTool('decal'); }
      else {
        ui.stamp = id;
        // objetos são desenhos detalhados: começam num tamanho em que dá pra ver alguma coisa
        if (PACK_BR[id].kind === 'object' && ui.stampScale < 5) ui.stampScale = 5;
        if (ui.tool !== 'stamp') setTool('stamp');
      }
      closePicker(); renderOptbar();
    });
    pickerEl.querySelector('[data-pk-filter]').addEventListener('input', function (e) {
      var q = e.target.value.trim().toLowerCase();
      pickerEl.querySelectorAll('[data-pk]').forEach(function (b) { b.style.display = !q || b.getAttribute('data-name').indexOf(q) !== -1 ? '' : 'none'; });
    });
    setTimeout(function () { document.addEventListener('mousedown', pickerOutside, true); document.addEventListener('keydown', pickerKey, true); }, 0);
  }

  // ---------- Painéis ----------
  function shellMarkup() {
    return (
      '<div class="lp-stage wp-stage at-stage" id="at-stage">' +
      '  <div class="wp-stage-bar" id="at-topbar"></div>' +
      '  <div class="lp-body">' +
      '    <div class="lp-rail" id="at-rail"></div>' +
      '    <div class="lp-canvas-col">' +
      '      <div class="lp-optbar" id="at-optbar"></div>' +
      '      <div class="lp-canvas-wrap" id="at-canvas-wrap">' +
      '        <canvas id="at-canvas"></canvas>' +
      '        <input type="text" class="lp-text-input" id="at-text-input" maxlength="120" style="display:none" />' +
      '        <div class="lp-empty" id="at-empty" style="display:none"><div class="lp-empty-card">' +
      '          <p class="font-semibold text-primary text-sm">Nenhum mapa de mundo ainda</p>' +
      '          <p class="text-xs text-secondary mt-1">Crie um mapa livre (terreno, carimbos, rosa dos ventos e quadrantes) ou uma planta radial (anéis, setores e ramais — cidade circular, base, estação).</p>' +
      '          <div class="flex flex-wrap justify-center gap-2 mt-3">' +
      '            <button type="button" class="btn-ghost py-1.5 text-xs" data-at="new-world">' + GDC.icon('map', { size: 13 }) + 'Mapa de mundo</button>' +
      '            <button type="button" class="btn-ghost py-1.5 text-xs" data-at="new-radial">' + GDC.icon('circle-dot', { size: 13 }) + 'Planta radial</button>' +
      '            <button type="button" class="btn-ghost py-1.5 text-xs" data-at="example-radial">' + GDC.icon('sparkles', { size: 13, className: 'text-amber-400' }) + 'Exemplo: planta radial</button>' +
      '            <button type="button" class="btn-ghost py-1.5 text-xs" data-at="example-world">' + GDC.icon('sparkles', { size: 13, className: 'text-amber-400' }) + 'Exemplo: mapa de mundo</button>' +
      '          </div></div></div>' +
      '        <div class="lp-hint" id="at-hint"></div>' +
      '        <div class="at-status" id="at-status"></div>' +
      '      </div>' +
      '    </div>' +
      '    <aside class="lp-panel at-panel" id="at-panel"></aside>' +
      '  </div>' +
      '</div>'
    );
  }

  function renderTopbar() {
    var el = root.querySelector('#at-topbar'), map = activeMap();
    el.innerHTML =
      '<span class="at-title">' + (map ? GDC.icon(map.kind === 'radial' ? 'circle-dot' : (map.kind === 'hex' ? 'hexagon' : 'map'), { size: 14 }) + escapeHtml(map.name) : 'Mundo e radial') + '</span>' +
      '<span class="wp-stage-spacer"></span>' +
      '<button type="button" class="wp-icon-btn" data-at="undo" title="Desfazer (Ctrl+Z)">' + GDC.icon('undo-2', { size: 15 }) + '</button>' +
      '<button type="button" class="wp-icon-btn" data-at="redo" title="Refazer (Ctrl+Y)">' + GDC.icon('redo-2', { size: 15 }) + '</button>' +
      '<span class="wp-bar-sep"></span>' +
      '<button type="button" class="wp-icon-btn" data-at="zoom-out" title="Diminuir zoom (-)">' + GDC.icon('zoom-out', { size: 15 }) + '</button>' +
      '<span class="lp-zoom-label" id="at-zoom">' + Math.round(view.z * 100) + '%</span>' +
      '<button type="button" class="wp-icon-btn" data-at="zoom-in" title="Aumentar zoom (+)">' + GDC.icon('zoom-in', { size: 15 }) + '</button>' +
      '<button type="button" class="wp-icon-btn" data-at="fit" title="Ajustar à tela (F)">' + GDC.icon('scan', { size: 15 }) + '</button>' +
      (map ? '<span class="wp-bar-sep"></span><select class="input-field lp-style-select" data-at-style title="Estilo do mapa">' + Object.keys(STYLES).map(function (k) { return '<option value="' + k + '"' + (k === map.style ? ' selected' : '') + '>' + STYLES[k].label + '</option>'; }).join('') + '</select>' : '') +
      '<span class="wp-bar-sep"></span>' +
      '<select class="input-field lp-style-select" data-at-exportw title="Largura do PNG exportado">' + [2048, 4096, 8192].map(function (w) { return '<option value="' + w + '"' + (w === ui.exportW ? ' selected' : '') + '>' + (w / 1024) + 'K</option>'; }).join('') + '</select>' +
      '<button type="button" class="wp-icon-btn" data-at="export" title="Exportar PNG">' + GDC.icon('download', { size: 15 }) + '</button>' +
      GDC.fullscreen.buttonMarkup('wp-icon-btn', !!(stageEl && GDC.fullscreen.isActive(stageEl)), 'data-at="fullscreen"') +
      '<button type="button" class="wp-icon-btn' + (ui.panelOpen ? ' wp-btn-on' : '') + '" data-at="panel" title="Painel lateral">' + GDC.icon('panel-right', { size: 15 }) + '</button>';
  }

  function renderRail() {
    var el = root.querySelector('#at-rail');
    if (toolOrder().indexOf(ui.tool) === -1) ui.tool = (activeMap() || {}).kind === 'hex' ? 'tile' : (ui.tool === 'tile' || ui.tool === 'fill' ? 'brush' : 'select');
    el.innerHTML = toolOrder().map(function (t, i) {
      return (i === 2 ? '<span class="lp-rail-sep"></span>' : '') +
        '<button type="button" class="lp-tool' + (ui.tool === t ? ' lp-tool-active' : '') + '" data-at-tool="' + t + '" title="' + escapeHtml(TOOLS[t].label) + ' (' + keyOf(t).toUpperCase() + ')">' + GDC.icon(TOOLS[t].icon, { size: 18 }) + '</button>';
    }).join('');
    var h = root.querySelector('#at-hint'); if (h && !h.classList.contains('lp-hint-warn')) h.textContent = toolHint(ui.tool);
  }

  function stampIcon(k, size) {
    var cv = document.createElement('canvas'), n = size || 30; cv.width = n * 2; cv.height = n * 2;
    var c = cv.getContext('2d'); c.scale(2, 2); c.translate(n / 2, n / 2); c.scale(n * 0.38, n * 0.38);
    c.lineWidth = 0.1; c.strokeStyle = '#3a2c1f'; c.lineJoin = 'round'; c.lineCap = 'round';
    (STAMPS[k] || STAMPS.poi).draw(c, '#3a2c1f', '#efe2c2');
    return cv.toDataURL();
  }
  var stampIconCache = {};

  function renderOptbar() {
    var t = ui.tool, html = '';
    var pct = function (v) { return Math.round(Number(v) * 100) + '%'; };
    var range = function (attr, min, max, step, val, label, fmt) {
      return '<label class="at-opt">' + label + '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" data-at-opt="' + attr + '" /><span data-at-optval="' + attr + '">' + (fmt ? fmt(val) : val) + '</span></label>';
    };
    var om = activeMap();
    if (om && om.kind === 'hex' && (t === 'tile' || t === 'fill' || t === 'eraser')) {
      if (t !== 'eraser') {
        if (!tileById(om, ui.tileId)) ui.tileId = (om.tileset[0] || {}).id || null;
        html += '<div class="at-terrains">' + om.tileset.map(function (tl) {
          return '<button type="button" class="at-terrain at-tile' + (ui.tileId === tl.id ? ' at-terrain-on' : '') + '" data-at-tile="' + tl.id + '" title="' + escapeHtml(tl.name) + '" style="' + tileSwatchStyle(tl) + '"></button>';
        }).join('') + '<span class="at-opt-label">' + escapeHtml((tileById(om, ui.tileId) || { name: 'Sem peças — crie no painel' }).name) + '</span></div>';
      }
      if (t !== 'fill') html += '<label class="at-opt">Raio<input type="range" min="1" max="6" step="1" value="' + ui.tileRadius + '" data-at-opt="tileRadius" /><span data-at-optval="tileRadius">' + ui.tileRadius + '</span></label>';
      else html += '<span class="text-xs text-muted">' + escapeHtml(TOOLS.fill.hint) + '</span>';
    } else if (t === 'brush' || t === 'eraser' || t === 'fill') {
      if (t !== 'eraser') {
        // procedurais + texturas do pacote usadas por último; a biblioteca completa abre no botão
        var texIds = TERRAINS.map(function (tr) { return tr.id; }).concat(ui.recentTex.filter(function (id) { return PACK_TEX[id]; }));
        if (PACK_TEX[ui.terrain] && texIds.indexOf(ui.terrain) === -1) texIds.push(ui.terrain);
        html += '<div class="at-terrains">' + texIds.map(function (id) {
          return '<button type="button" class="at-terrain' + (ui.terrain === id ? ' at-terrain-on' : '') + '" data-at-terrain="' + id + '" title="' + escapeHtml(terrainInfo(id).label) + '" style="background-image:url(' + terrainThumb(id) + ')"></button>';
        }).join('') +
          (PACK.textures.length ? '<button type="button" class="btn-ghost py-1 text-xs at-lib-btn" data-at="pick-tex" title="Todas as texturas do pacote">' + GDC.icon('layout-grid', { size: 12 }) + 'Texturas (' + PACK.textures.length + ')</button>' : '') +
          '<span class="at-opt-label">' + escapeHtml(terrainInfo(ui.terrain).label) + '</span></div>';
      }
      if (t !== 'fill') html += range('brush', 10, 800, 5, ui.brush, 'Tamanho');
      html += range('opacity', 0.05, 1, 0.05, ui.opacity, 'Opacidade', pct);
      if (t === 'fill') html += '<span class="text-xs text-muted">Preenche até a borda de outro terreno ou do mapa</span>';
    } else if (t === 'decal') {
      var decIds = ui.recentDecal.filter(function (id) { return PACK_BR[id]; });
      if (!decIds.length) decIds = PACK.brushes.slice(0, 8).map(function (b) { return b.id; });
      if (PACK_BR[ui.decal] && decIds.indexOf(ui.decal) === -1) decIds.unshift(ui.decal);
      html += '<div class="at-terrains">' + decIds.slice(0, 10).map(function (id) {
        return '<button type="button" class="at-terrain at-decal' + (ui.decal === id ? ' at-terrain-on' : '') + '" data-at-decal="' + id + '" title="' + escapeHtml(PACK_BR[id].name) + '" style="background-image:url(' + PACK_BR[id].src + ')"></button>';
      }).join('') +
        '<button type="button" class="btn-ghost py-1 text-xs at-lib-btn" data-at="pick-decal" title="Todos os pincéis">' + GDC.icon('layout-grid', { size: 12 }) + 'Pincéis (' + PACK.brushes.length + ')</button>' +
        '<span class="at-opt-label">' + escapeHtml((PACK_BR[ui.decal] || { name: '' }).name) + '</span></div>';
      html += range('brush', 10, 800, 5, ui.brush, 'Tamanho');
      html += range('opacity', 0.05, 1, 0.05, ui.opacity, 'Opacidade', pct);
    } else if (t === 'stamp') {
      html += '<div class="at-stamps">' + STAMP_ORDER.map(function (k) {
        if (!stampIconCache[k]) stampIconCache[k] = stampIcon(k);
        return '<button type="button" class="at-stamp' + (ui.stamp === k ? ' at-stamp-on' : '') + '" data-at-stamp="' + k + '" title="' + escapeHtml(STAMPS[k].label) + '"><img src="' + stampIconCache[k] + '" alt="" /></button>';
      }).join('') +
        '<label class="at-stamp at-stamp-upload' + (ui.stamp === 'image' ? ' at-stamp-on' : '') + '" title="Usar uma imagem sua (PNG com fundo transparente)">' + GDC.icon('image', { size: 14 }) + '<input type="file" accept="image/*" class="hidden" data-at-stamp-upload /></label>' +
        (PACK_BR[ui.stamp] ? '<button type="button" class="at-stamp at-stamp-on" data-at="pick-stamp" title="' + escapeHtml(PACK_BR[ui.stamp].name) + '"><img src="' + PACK_BR[ui.stamp].src + '" alt="" /></button>' : '') +
        (PACK.brushes.length ? '<button type="button" class="btn-ghost py-1 text-xs at-lib-btn" data-at="pick-stamp" title="Biblioteca de carimbos: objetos (sci-fi e ruínas), árvores, rochas, cristais...">' + GDC.icon('layout-grid', { size: 12 }) + 'Pacote</button>' : '') + '</div>';
      html += range('stampScale', 0.3, 12, 0.1, ui.stampScale, 'Escala', function (v) { return Number(v).toFixed(1) + '×'; });
      html += range('stampRot', -180, 180, 15, ui.stampRot, 'Giro', function (v) { return v + '°'; });
      html += '<label class="at-opt" title="Cada carimbo sai com um giro sorteado — bom pra árvores e pedras"><input type="checkbox" data-at-opt="stampRandRot"' + (ui.stampRandRot ? ' checked' : '') + ' /> Giro aleatório</label>';
      html += range('stampOpacity', 0.05, 1, 0.05, ui.stampOpacity, 'Opacidade', pct);
      html += '<label class="at-opt"><input type="checkbox" data-at-opt="scatter"' + (ui.scatter ? ' checked' : '') + ' /> Espalhar (arrastar)</label>';
    } else if (t === 'text') {
      html += '<label class="at-opt">Estilo <select class="input-field py-1 text-xs" data-at-opt="labelStyle">' + Object.keys(LABEL_STYLES).map(function (k) { return '<option value="' + k + '"' + (k === ui.labelStyle ? ' selected' : '') + '>' + LABEL_STYLES[k].label + '</option>'; }).join('') + '</select></label>';
    } else if (t === 'region') {
      html += '<label class="at-opt">Cor <input type="color" class="gdd-layout-color" data-at-opt="regionColor" value="' + ui.regionColor + '" /></label>' +
        (draft && draft.type === 'region' ? '<button type="button" class="btn-ghost py-1 text-xs" data-at="finish">Fechar região</button>' : '');
    } else if (t === 'path') {
      html += '<label class="at-opt">Tipo <select class="input-field py-1 text-xs" data-at-opt="pathKind">' + Object.keys(PATH_KINDS).map(function (k) { return '<option value="' + k + '"' + (k === ui.pathKind ? ' selected' : '') + '>' + PATH_KINDS[k] + '</option>'; }).join('') + '</select></label>';
    } else {
      html += '<span class="text-xs text-muted">' + escapeHtml(toolHint(t)) + '</span>';
    }
    optbarEl.innerHTML = html;
  }
  var tileSwatchCache = {};
  function tileSwatchStyle(tl) {
    if (tl.imageId) { var e = loadImage(tl.imageId); if (e && e.img) { try { if (!tileSwatchCache[tl.imageId]) { var cv = document.createElement('canvas'); cv.width = cv.height = 64; var c = cv.getContext('2d'), sc = Math.max(64 / e.img.width, 64 / e.img.height); c.drawImage(e.img, 32 - e.img.width * sc / 2, 32 - e.img.height * sc / 2, e.img.width * sc, e.img.height * sc); tileSwatchCache[tl.imageId] = cv.toDataURL(); } return 'background-image:url(' + tileSwatchCache[tl.imageId] + ')'; } catch (er) { /* canvas sujo */ } } return 'background:#64748b'; }
    if (tl.terrain && isTerrainId(tl.terrain)) return 'background-image:url(' + terrainThumb(tl.terrain) + ');background-size:cover';
    return 'background:' + (tl.color || '#9ca3af');
  }

  function tilesetMarkup(map) {
    var counts = {};
    Object.keys(map.hex.tiles).forEach(function (k) { var id = map.hex.tiles[k]; counts[id] = (counts[id] || 0) + 1; });
    var list = map.tileset.map(function (tl) {
      var kindSel = tl.imageId ? '<span class="text-xs text-muted">imagem</span>' :
        '<select class="input-field py-1 text-xs" data-atile="terrain" data-tile-id="' + tl.id + '" title="Textura"><option value="">Cor sólida</option><optgroup label="Procedurais">' + TERRAINS.map(function (tr) { return '<option value="' + tr.id + '"' + (tl.terrain === tr.id ? ' selected' : '') + '>' + escapeHtml(tr.label) + '</option>'; }).join('') + '</optgroup>' +
        PACK.textureCats.map(function (cat) { return '<optgroup label="' + escapeHtml(cat) + '">' + PACK.textures.filter(function (x) { return x.cat === cat; }).map(function (x) { return '<option value="' + x.id + '"' + (tl.terrain === x.id ? ' selected' : '') + '>' + escapeHtml(x.name) + '</option>'; }).join('') + '</optgroup>'; }).join('') + '</select>' +
        (tl.terrain ? '' : '<input type="color" class="gdd-layout-color" data-atile="color" data-tile-id="' + tl.id + '" value="' + (tl.color || '#9ca3af') + '" />');
      return '<li class="at-tile-row' + (ui.tileId === tl.id ? ' at-tile-row-on' : '') + '">' +
        '<button type="button" class="at-terrain at-tile" data-at-tile="' + tl.id + '" title="Usar esta peça" style="' + tileSwatchStyle(tl) + '"></button>' +
        '<input type="text" class="input-field py-1 text-xs flex-1" data-atile="name" data-tile-id="' + tl.id + '" maxlength="60" value="' + escapeHtml(tl.name) + '" />' +
        '<span class="text-xs text-muted" title="Hexágonos com esta peça">' + (counts[tl.id] || 0) + '</span>' +
        '<button type="button" class="lp-mini-btn" data-at-tile-del="' + tl.id + '" title="Excluir peça (limpa os hexágonos dela)">' + GDC.icon('trash-2', { size: 12 }) + '</button>' +
        '<div class="at-tile-kind">' + kindSel + '</div></li>';
    }).join('');
    return '<ul class="at-tileset">' + (list || '<li class="text-xs text-muted">Nenhuma peça. Adicione uma textura, cor ou imagem sua.</li>') + '</ul>' +
      '<div class="flex flex-wrap gap-1 mt-2">' +
      '<button type="button" class="btn-ghost py-1 text-xs" data-at="tile-add">' + GDC.icon('plus', { size: 12 }) + 'Peça</button>' +
      '<label class="btn-ghost py-1 text-xs cursor-pointer" title="Imagem sua (PNG/JPG). Ela é recortada no formato do hexágono.">' + GDC.icon('image', { size: 12 }) + 'Peça de imagem<input type="file" accept="image/*" class="hidden" data-at-tile-upload /></label></div>';
  }

  function secHead(title, icon, extra) { return '<div class="lp-sec-head">' + GDC.icon(icon, { size: 13 }) + '<span class="flex-1">' + escapeHtml(title) + '</span>' + (extra || '') + '</div>'; }

  function selectionMarkup(map) {
    if (!selected) return '<p class="text-xs text-muted">Nada selecionado. Use a seta (V) e clique em algo no mapa.</p>';
    var it = findItem(map, selected), rows = '';
    var row = function (label, input) { return '<label class="at-prop"><span>' + label + '</span>' + input + '</label>'; };
    var num = function (f, val, min, max, step) { return '<input type="range" data-asel="' + f + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" />'; };
    var del = '<button type="button" class="btn-ghost py-1 text-xs text-rose-500" data-at="delete-sel">' + GDC.icon('trash-2', { size: 12 }) + 'Remover</button>';
    if (selected.type === 'stamp' && it) {
      var isPack = !!PACK_BR[it.k], plain = it.k !== 'image' && !isPack;
      rows = (isPack ? '<p class="text-xs text-muted">' + escapeHtml(PACK_BR[it.k].name) + ' · ' + escapeHtml(PACK_BR[it.k].cat) + '</p>' : '') + (plain ? row('Tipo', '<select class="input-field py-1 text-xs" data-asel="k">' + STAMP_ORDER.map(function (k) { return '<option value="' + k + '"' + (k === it.k ? ' selected' : '') + '>' + STAMPS[k].label + '</option>'; }).join('') + '</select>') : '') +
        row('Escala', num('s', it.s, 0.3, 12, 0.1)) + row('Rotação', num('r', it.r, -180, 180, 1)) +
        row('Opacidade', num('o', it.o > 0 ? it.o : 1, 0.05, 1, 0.05)) +
        (plain ? row('Cor', '<input type="color" class="gdd-layout-color" data-asel="c" value="' + (it.c || (STYLES[map.style] || STYLES.wasteland).fill) + '" /><button type="button" class="lp-mini-btn" data-at="color-reset" title="Cor padrão do estilo">' + GDC.icon('rotate-ccw', { size: 12 }) + '</button>') : '') +
        '<div class="flex gap-2"><button type="button" class="btn-ghost py-1 text-xs" data-at="dup-sel">' + GDC.icon('copy', { size: 12 }) + 'Duplicar</button>' + del + '</div>';
      return '<p class="at-sel-title">Carimbo</p>' + rows;
    }
    if (selected.type === 'label' && it) {
      rows = row('Texto', '<input type="text" class="input-field py-1 text-xs" data-asel="text" value="' + escapeHtml(it.text) + '" />') +
        row('Estilo', '<select class="input-field py-1 text-xs" data-asel="style">' + Object.keys(LABEL_STYLES).map(function (k) { return '<option value="' + k + '"' + (k === it.style ? ' selected' : '') + '>' + LABEL_STYLES[k].label + '</option>'; }).join('') + '</select>') +
        row('Tamanho', num('size', it.size, 0.2, 6, 0.05)) + row('Curva', num('curve', it.curve, -1, 1, 0.05)) + row('Rotação', num('r', it.r, -180, 180, 1)) +
        row('Cor', '<input type="color" class="gdd-layout-color" data-asel="c" value="' + (it.c || (STYLES[map.style] || STYLES.wasteland).ink) + '" /><button type="button" class="lp-mini-btn" data-at="color-reset" title="Cor padrão do estilo">' + GDC.icon('rotate-ccw', { size: 12 }) + '</button>') + del;
      return '<p class="at-sel-title">Rótulo</p>' + rows;
    }
    if (selected.type === 'region' && it) {
      rows = row('Nome', '<input type="text" class="input-field py-1 text-xs" data-asel="name" value="' + escapeHtml(it.name) + '" placeholder="Ex.: Zona Vermelha" />') +
        row('Cor', '<input type="color" class="gdd-layout-color" data-asel="c" value="' + it.c + '" />') +
        row('Borda tracejada', '<input type="checkbox" data-asel="dash"' + (it.dash ? ' checked' : '') + ' />') + del;
      return '<p class="at-sel-title">Região</p>' + rows;
    }
    if (selected.type === 'path' && it) {
      rows = row('Nome', '<input type="text" class="input-field py-1 text-xs" data-asel="name" value="' + escapeHtml(it.name) + '" />') +
        row('Tipo', '<select class="input-field py-1 text-xs" data-asel="kind">' + Object.keys(PATH_KINDS).map(function (k) { return '<option value="' + k + '"' + (k === it.kind ? ' selected' : '') + '>' + PATH_KINDS[k] + '</option>'; }).join('') + '</select>') + del;
      return '<p class="at-sel-title">Caminho</p>' + rows;
    }
    if (selected.type === 'compass') {
      return '<p class="at-sel-title">Rosa dos ventos</p>' + row('Tamanho', '<input type="range" data-acomp="size" min="30" max="1500" step="5" value="' + map.compass.size + '" />') +
        '<button type="button" class="btn-ghost py-1 text-xs" data-at="delete-sel">' + GDC.icon('eye-off', { size: 12 }) + 'Ocultar</button>';
    }
    if (selected.type === 'hex' && map.kind === 'hex') {
      var hp = selected.key.split(','), hk = selected.key;
      return '<p class="at-sel-title">Hexágono ' + colName(Number(hp[0])) + (Number(hp[1]) + 1) + '</p>' +
        row('Peça', '<select class="input-field py-1 text-xs" data-ahex="tile"><option value="">— vazio —</option>' + map.tileset.map(function (tl) { return '<option value="' + tl.id + '"' + (map.hex.tiles[hk] === tl.id ? ' selected' : '') + '>' + escapeHtml(tl.name) + '</option>'; }).join('') + '</select>') +
        '<label class="at-prop at-prop-col"><span>Nota</span><textarea class="input-field py-1 text-xs" rows="4" data-ahex="note" maxlength="2000" placeholder="Encontro, recurso, segredo, gancho de quest…">' + escapeHtml(map.hex.notes[hk] || '') + '</textarea></label>' +
        '<button type="button" class="btn-ghost py-1 text-xs text-rose-500" data-at="delete-sel">' + GDC.icon('eraser', { size: 12 }) + 'Limpar hexágono</button>';
    }
    if (selected.type === 'sector' && map.kind === 'radial') {
      var ring = map.radial.rings[selected.ring]; if (!ring) return '';
      var cell = ring.cells[selected.sector] || { name: '', c: null };
      var autoCol = ring.c || SECTOR_COLORS[(selected.ring * 3 + selected.sector) % SECTOR_COLORS.length];
      return '<p class="at-sel-title">Setor ' + (selected.sector + 1) + ' · ' + escapeHtml(ring.name || 'Anel ' + (selected.ring + 1)) + '</p>' +
        row('Nome', '<input type="text" class="input-field py-1 text-xs" data-asec="name" value="' + escapeHtml(cell.name) + '" placeholder="Ex.: Mercado" />') +
        row('Cor', '<input type="color" class="gdd-layout-color" data-asec="c" value="' + (cell.c || autoCol) + '" /><button type="button" class="lp-mini-btn" data-at="sector-color-reset" title="Cor do anel">' + GDC.icon('rotate-ccw', { size: 12 }) + '</button>');
    }
    return '';
  }

  function radialMarkup(map) {
    var rd = map.radial;
    var rings = rd.rings.map(function (ring, i) {
      return (
        '<div class="at-ring" data-ring="' + i + '">' +
        '  <div class="at-ring-head"><input type="color" class="gdd-layout-color" data-aring="c" value="' + (ring.c || SECTOR_COLORS[(i * 3) % SECTOR_COLORS.length]) + '" title="Cor do anel" />' +
        '    <input type="text" class="input-field py-1 text-xs" data-aring="name" value="' + escapeHtml(ring.name) + '" placeholder="Nome do anel" />' +
        '    <button type="button" class="lp-mini-btn" data-at="ring-remove" title="Remover anel">' + GDC.icon('trash-2', { size: 12 }) + '</button></div>' +
        '  <div class="at-ring-grid">' +
        '    <label>Interno %<input type="number" min="0" max="100" step="1" class="input-field py-1 text-xs" data-aring="r0" value="' + Math.round(ring.r0 * 100) + '" /></label>' +
        '    <label>Externo %<input type="number" min="0" max="100" step="1" class="input-field py-1 text-xs" data-aring="r1" value="' + Math.round(ring.r1 * 100) + '" /></label>' +
        '    <label>Setores<input type="number" min="1" max="48" step="1" class="input-field py-1 text-xs" data-aring="sectors" value="' + ring.sectors + '" /></label>' +
        '    <label>Giro °<input type="number" min="-360" max="360" step="5" class="input-field py-1 text-xs" data-aring="offset" value="' + ring.offset + '" /></label>' +
        '  </div>' +
        '</div>'
      );
    }).join('');
    var sp = rd.spokes;
    return (
      '<p class="text-xs text-muted">Clique num setor (ferramenta seta) pra dar nome e cor. Percentuais são do raio total.</p>' +
      rings +
      '<button type="button" class="btn-ghost py-1 text-xs" data-at="ring-add">' + GDC.icon('plus', { size: 12 }) + 'Anel</button>' +
      '<p class="at-sel-title mt-2">Ramais radiais</p>' +
      '<div class="at-ring-grid">' +
      '  <label>Quantidade<input type="number" min="0" max="48" step="1" class="input-field py-1 text-xs" data-aspoke="count" value="' + sp.count + '" /></label>' +
      '  <label>Giro °<input type="number" min="-360" max="360" step="5" class="input-field py-1 text-xs" data-aspoke="offset" value="' + sp.offset + '" /></label>' +
      '  <label>De %<input type="number" min="0" max="120" step="1" class="input-field py-1 text-xs" data-aspoke="r0" value="' + Math.round(sp.r0 * 100) + '" /></label>' +
      '  <label>Até %<input type="number" min="0" max="120" step="1" class="input-field py-1 text-xs" data-aspoke="r1" value="' + Math.round(sp.r1 * 100) + '" /></label>' +
      '  <label>Largura<input type="number" min="1" max="2000" step="1" class="input-field py-1 text-xs" data-aspoke="width" value="' + sp.width + '" /></label>' +
      '  <label>Nome<input type="text" class="input-field py-1 text-xs" data-aspoke="name" value="' + escapeHtml(sp.name) + '" placeholder="Ramal" /></label>' +
      '</div>' +
      '<label class="at-prop"><span>Contorno externo (anel de hexágonos)</span><input type="checkbox" data-amap="dome"' + (rd.dome ? ' checked' : '') + ' /></label>' +
      '<label class="at-prop"><span>Raio (unidades)</span><input type="number" min="50" max="20000" step="10" class="input-field py-1 text-xs" data-amap="R" value="' + rd.R + '" /></label>'
    );
  }

  function settingsMarkup(map) {
    if (map.kind === 'radial') return '';
    if (map.kind === 'hex') {
      var hx = map.hex;
      return (
        '<div class="at-ring-grid">' +
        '  <label>Colunas<input type="number" min="1" max="200" step="1" class="input-field py-1 text-xs" data-ahexmap="cols" value="' + hx.cols + '" /></label>' +
        '  <label>Linhas<input type="number" min="1" max="200" step="1" class="input-field py-1 text-xs" data-ahexmap="rows" value="' + hx.rows + '" /></label>' +
        '  <label>Tamanho<input type="number" min="10" max="2000" step="5" class="input-field py-1 text-xs" data-ahexmap="size" value="' + hx.size + '" /></label>' +
        '</div>' +
        '<label class="at-prop"><span>Orientação</span><select class="input-field py-1 text-xs" data-ahexmap="orient"><option value="pointy"' + (hx.orient !== 'flat' ? ' selected' : '') + '>Vértice pra cima</option><option value="flat"' + (hx.orient === 'flat' ? ' selected' : '') + '>Lado pra cima</option></select></label>' +
        '<label class="at-prop"><span>Linhas da malha</span><input type="checkbox" data-ahexmap="lines"' + (hx.lines ? ' checked' : '') + ' /></label>' +
        '<label class="at-prop"><span>Coordenadas nas bordas</span><input type="checkbox" data-amap="gridLabels"' + (map.grid.labels ? ' checked' : '') + ' /></label>' +
        '<label class="at-prop"><span>Coordenada em cada hexágono</span><input type="checkbox" data-ahexmap="coordsIn"' + (hx.coordsIn ? ' checked' : '') + ' /></label>' +
        '<label class="at-prop"><span>Rosa dos ventos</span><input type="checkbox" data-amap="compassOn"' + (map.compass.on ? ' checked' : '') + ' /></label>' +
        '<p class="text-xs text-muted mt-1">Reduzir colunas/linhas descarta as peças e notas que ficarem fora.</p>'
      );
    }
    return (
      '<div class="at-ring-grid">' +
      '  <label>Largura<input type="number" min="200" max="40000" step="50" class="input-field py-1 text-xs" data-amap="width" value="' + map.width + '" /></label>' +
      '  <label>Altura<input type="number" min="200" max="40000" step="50" class="input-field py-1 text-xs" data-amap="height" value="' + map.height + '" /></label>' +
      '  <label>' + (map.grid.shape === 'hex' ? 'Hexágono' : 'Quadrante') + '<input type="number" min="10" max="5000" step="10" class="input-field py-1 text-xs" data-amap="cell" value="' + map.grid.cell + '" /></label>' +
      '</div>' +
      '<label class="at-prop"><span>Grade (G)</span><input type="checkbox" data-amap="gridOn"' + (map.grid.on ? ' checked' : '') + ' /></label>' +
      '<label class="at-prop"><span>Formato da grade</span><select class="input-field py-1 text-xs" data-amap="gridShape"><option value="square"' + (map.grid.shape !== 'hex' ? ' selected' : '') + '>Quadrada</option><option value="hex"' + (map.grid.shape === 'hex' ? ' selected' : '') + '>Hexagonal</option></select></label>' +
      '<label class="at-prop"><span>Coordenadas nas bordas</span><input type="checkbox" data-amap="gridLabels"' + (map.grid.labels ? ' checked' : '') + ' /></label>' +
      '<label class="at-prop"><span>Rosa dos ventos</span><input type="checkbox" data-amap="compassOn"' + (map.compass.on ? ' checked' : '') + ' /></label>'
    );
  }

  function refreshPanel() {
    var el = root && root.querySelector('#at-panel'); if (!el) return;
    el.style.display = ui.panelOpen ? '' : 'none';
    var map = activeMap();
    var mapsHtml = '<ul class="lp-map-list">' + modeMaps().map(function (m) {
      return '<li class="lp-map-item' + (map && m.id === map.id ? ' lp-map-item-active' : '') + '">' +
        '<button type="button" class="lp-map-open" data-at-open="' + m.id + '">' + GDC.icon(m.kind === 'radial' ? 'circle-dot' : (m.kind === 'hex' ? 'hexagon' : 'map'), { size: 12 }) + '<span>' + escapeHtml(m.name) + '</span></button>' +
        '<button type="button" class="lp-mini-btn" data-at-dup="' + m.id + '" title="Duplicar">' + GDC.icon('copy', { size: 12 }) + '</button>' +
        '<button type="button" class="lp-mini-btn" data-at-del="' + m.id + '" title="Excluir">' + GDC.icon('trash-2', { size: 12 }) + '</button></li>';
    }).join('') + '</ul>';
    var html =
      '<div class="lp-sec">' + secHead(mode === 'hex' ? 'Tilesets' : 'Mapas', mode === 'hex' ? 'hexagon' : 'map', mode === 'hex' ?
        '<button type="button" class="lp-mini-btn" data-at="new-hex" title="Novo tileset hexagonal">' + GDC.icon('plus', { size: 12 }) + '</button>' :
        '<button type="button" class="lp-mini-btn" data-at="new-world" title="Novo mapa de mundo">' + GDC.icon('map', { size: 12 }) + '</button>' +
        '<button type="button" class="lp-mini-btn" data-at="new-radial" title="Nova planta radial">' + GDC.icon('circle-dot', { size: 12 }) + '</button>') +
      (map ? '<input type="text" class="input-field lp-name-input" data-amap="name" maxlength="80" value="' + escapeHtml(map.name) + '" />' : '') + mapsHtml + '</div>';
    if (map) {
      html += '<div class="lp-sec">' + secHead('Camadas', 'layers') + '<ul class="at-layers">' +
        GDC.ATLAS_LAYER_IDS.filter(function (id) { return id !== 'structure' || map.kind === 'radial'; }).map(function (id) {
          var l = map.layers[id];
          return '<li><span class="flex-1">' + (id === 'terrain' && map.kind === 'hex' ? 'Peças' : LAYER_LABELS[id]) + '</span>' +
            '<button type="button" class="lp-mini-btn' + (l.visible ? '' : ' at-off') + '" data-at-layer-vis="' + id + '" title="' + (l.visible ? 'Ocultar' : 'Mostrar') + '">' + GDC.icon(l.visible ? 'eye' : 'eye-off', { size: 12 }) + '</button>' +
            '<button type="button" class="lp-mini-btn' + (l.locked ? ' wp-btn-on' : '') + '" data-at-layer-lock="' + id + '" title="' + (l.locked ? 'Destravar' : 'Travar') + '">' + GDC.icon(l.locked ? 'lock' : 'lock-open', { size: 12 }) + '</button></li>';
        }).join('') + '</ul></div>';
      if (map.kind === 'hex') html += '<div class="lp-sec">' + secHead('Tileset', 'hexagon') + tilesetMarkup(map) + '</div>';
      html += '<div class="lp-sec">' + secHead('Seleção', 'mouse-pointer-2') + selectionMarkup(map) + '</div>';
      if (map.kind === 'radial') html += '<div class="lp-sec">' + secHead('Estrutura radial', 'circle-dot') + radialMarkup(map) + '</div>';
      else html += '<div class="lp-sec">' + secHead('Mapa', 'settings-2') + settingsMarkup(map) + '</div>';
      html += '<div class="lp-sec">' + secHead('Resumo', 'list') + '<p class="text-xs text-muted">' + (map.kind === 'hex' ? Object.keys(map.hex.tiles).length + ' de ' + (map.hex.cols * map.hex.rows) + ' hexágonos pintados · ' + Object.keys(map.hex.notes).length + ' notas · ' : map.strokes.length + ' traços de terreno · ') + '' + map.stamps.length + ' carimbos · ' + map.labels.length + ' rótulos · ' + map.regions.length + ' regiões · ' + map.paths.length + ' caminhos</p></div>';
    }
    el.innerHTML = html;
    var empty = root.querySelector('#at-empty'); if (empty) { empty.style.display = map ? 'none' : ''; empty.innerHTML = emptyMarkup(); }
    renderTopbar();
  }

  function emptyMarkup() {
    var b = function (a, icon, label, amber) { return '<button type="button" class="btn-ghost py-1.5 text-xs" data-at="' + a + '">' + GDC.icon(icon, { size: 13, className: amber ? 'text-amber-400' : '' }) + label + '</button>'; };
    if (mode === 'hex') return '<div class="lp-empty-card"><p class="font-semibold text-primary text-sm">Nenhum tileset hexagonal ainda</p>' +
      '<p class="text-xs text-secondary mt-1">Uma malha de hexágonos que você pinta peça a peça (texturas, cores ou imagens suas), com nota por hexágono — hexcrawl, mapa de campanha, tabuleiro estratégico.</p>' +
      '<div class="flex flex-wrap justify-center gap-2 mt-3">' + b('new-hex', 'hexagon', 'Novo tileset hexagonal') + b('example-hex', 'sparkles', 'Exemplo: hexcrawl', true) + '</div></div>';
    return '<div class="lp-empty-card"><p class="font-semibold text-primary text-sm">Nenhum mapa de mundo ainda</p>' +
      '<p class="text-xs text-secondary mt-1">Crie um mapa livre (terreno, carimbos, rosa dos ventos e quadrantes) ou uma planta radial (anéis, setores e ramais — cidade circular, base, estação).</p>' +
      '<div class="flex flex-wrap justify-center gap-2 mt-3">' + b('new-world', 'map', 'Mapa de mundo') + b('new-radial', 'circle-dot', 'Planta radial') + b('example-radial', 'sparkles', 'Exemplo: planta radial', true) + b('example-world', 'sparkles', 'Exemplo: mapa de mundo', true) + '</div></div>';
  }

  // ---------- Mapas novos / exemplos ----------
  var DEFAULT_TILES = ['sand', 'rock', 'scorched', 'grass', 'water', 'ruins'];
  function newHex(name) {
    var ts = TERRAINS.filter(function (t) { return DEFAULT_TILES.indexOf(t.id) !== -1; });
    if (ts.length < 3) ts = TERRAINS.slice(0, 6);
    return GDC.normalizeAtlasMap({ id: mid('atlas'), kind: 'hex', name: name || 'Tileset hexagonal', style: 'parchment',
      hex: { cols: 20, rows: 14, size: 120 }, compass: { on: false },
      tileset: ts.map(function (t) { return { id: mid('tile'), name: t.label, terrain: t.id }; }) });
  }
  /** Hexcrawl genérico: terreno por ruído simples + algumas notas. */
  function buildHexExample() {
    var m = newHex('Hexcrawl (exemplo)'), hx = m.hex, r = rng(7), ids = {};
    m.tileset.forEach(function (t) { ids[t.terrain] = t.id; });
    var pick = function (a) { for (var i = 0; i < a.length; i++) if (ids[a[i]]) return ids[a[i]]; return m.tileset[0].id; };
    var seeds = []; for (var i = 0; i < 9; i++) seeds.push([r() * hx.cols, r() * hx.rows, ['rock', 'grass', 'water', 'ruins', 'sand', 'grass', 'rock', 'scorched', 'water'][i]]);
    for (var y = 0; y < hx.rows; y++) for (var x = 0; x < hx.cols; x++) {
      var best = null, bd = 1e9;
      seeds.forEach(function (s) { var d = Math.hypot(s[0] - x, (s[1] - y) * 1.15) + r() * 1.6; if (d < bd) { bd = d; best = s; } });
      m.hex.tiles[x + ',' + y] = pick([best[2], 'sand']);
    }
    m.hex.notes['3,4'] = 'Vilarejo inicial — mercador, rumores sobre as ruínas.';
    m.hex.notes['12,7'] = 'Ruína guardada. Encontro: 3 sentinelas. Recompensa: mapa do subsolo.';
    m.hex.notes['16,2'] = 'Passagem na montanha, só abre depois da quest "A chave".';
    m.compass = { on: true, x: hBounds(hx).w - 160, y: 160, size: 120 };
    m.labels = [{ id: mid('lb'), text: 'Vale Esquecido', x: Math.round(hBounds(hx).w / 2), y: 120, style: 'region', size: 1.2, curve: 0.15, r: 0, c: null }];
    return GDC.normalizeAtlasMap(m);
  }
  function newWorld(name) {
    return GDC.normalizeAtlasMap({ id: mid('atlas'), kind: 'world', name: name || 'Mapa de mundo', width: 3000, height: 2000, style: 'wasteland' });
  }
  function newRadial(name) {
    return GDC.normalizeAtlasMap({ id: mid('atlas'), kind: 'radial', name: name || 'Planta radial', style: 'parchment',
      radial: { R: 1000, rings: [{ name: 'Centro', r0: 0, r1: 0.25, sectors: 1, cells: [{ name: 'Centro' }] }, { name: 'Anel', r0: 0.25, r1: 1, sectors: 6 }], spokes: { count: 0 }, dome: true } });
  }
  /** Exemplo genérico (cidade/base circular) — nada específico de um projeto. */
  function buildRadialExample() {
    return GDC.normalizeAtlasMap({
      id: mid('atlas'), kind: 'radial', name: 'Planta radial (exemplo)', style: 'parchment',
      compass: { on: true, x: 1000, y: -1000, size: 130 }, grid: { on: false },
      radial: {
        R: 1000, dome: true,
        rings: [
          { name: 'Núcleo', r0: 0, r1: 0.2, sectors: 1, cells: [{ name: 'Centro de comando' }], c: '#f59e0b' },
          { name: 'Anel interno', r0: 0.2, r1: 0.62, sectors: 6, offset: 0, cells: [
            { name: 'Laboratório' }, { name: 'Oficina' }, { name: 'Armazém' },
            { name: 'Mercado' }, { name: 'Residencial' }, { name: 'Enfermaria' }] },
          { name: 'Anel externo', r0: 0.62, r1: 1, sectors: 6, offset: 0, cells: [
            { name: 'Plantações', c: '#16a34a' }, { name: 'Criação de animais', c: '#84cc16' }, { name: 'Hangar', c: '#3b82f6' },
            { name: 'Energia', c: '#f43f5e' }, { name: 'Reciclagem', c: '#a8a29e' }, { name: 'Portões e defesa', c: '#14b8a6' }] },
        ],
        spokes: { count: 6, offset: 0, r0: 0.2, r1: 1, width: 28, name: '' },
      },
      labels: [{ text: 'Portão Sul', x: 0, y: 1080, style: 'small', size: 1.4 }, { text: 'Cidadela', x: 0, y: -1180, style: 'region', size: 1.1, curve: 0.25 }],
    });
  }
  function buildWorldExample() {
    var W = 3000, H = 2000, strokes = [], r = rng(42);
    var blob = function (t, cx, cy, rad, size, n) {
      var pts = [];
      for (var k = 0; k <= n; k++) { var a = k / n * Math.PI * 2 * 1.5; var rr = rad * (0.4 + r() * 0.6); pts.push(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr * 0.7)); }
      strokes.push({ id: mid('st'), t: t, s: size, p: pts });
    };
    blob('sand', 900, 700, 700, 520, 16); blob('sand', 2100, 1300, 750, 520, 16); blob('rock', 2300, 500, 420, 300, 12);
    blob('scorched', 1500, 1000, 300, 260, 10); blob('acid', 1500, 1000, 120, 160, 8); blob('ruins', 700, 1400, 260, 220, 10); blob('mutant', 2550, 1600, 220, 200, 10);
    var stamps = [
      { k: 'dome', x: 600, y: 600, s: 3.2 }, { k: 'crater', x: 1500, y: 1000, s: 5 }, { k: 'danger', x: 1500, y: 1000, s: 1.4 },
      { k: 'mountain', x: 2250, y: 420, s: 3 }, { k: 'mountain', x: 2400, y: 520, s: 2.4 }, { k: 'mountain', x: 2120, y: 560, s: 2 },
      { k: 'ruin', x: 650, y: 1380, s: 2 }, { k: 'building', x: 780, y: 1450, s: 1.6 }, { k: 'ruin', x: 820, y: 1330, s: 1.4 },
      { k: 'fungus', x: 2550, y: 1580, s: 1.8 }, { k: 'deadtree', x: 2480, y: 1660, s: 1.6 }, { k: 'deadtree', x: 2640, y: 1650, s: 1.4 },
      { k: 'antenna', x: 1150, y: 450, s: 1.8 }, { k: 'bunker', x: 1900, y: 1550, s: 2 },
    ].map(function (s) { s.id = mid('sp'); return s; });
    return GDC.normalizeAtlasMap({
      id: mid('atlas'), kind: 'world', name: 'Mapa de mundo (exemplo)', width: W, height: H, style: 'wasteland',
      grid: { on: true, cell: 250, labels: true }, compass: { on: true, x: 2800, y: 200, size: 150 },
      strokes: strokes, stamps: stamps,
      regions: [{ id: mid('rg'), name: 'Zona Proibida', pts: [1250, 820, 1760, 790, 1830, 1180, 1500, 1290, 1190, 1150], c: '#dc2626', dash: true }],
      paths: [{ id: mid('pa'), name: 'Trilha antiga', kind: 'trail', pts: [600, 700, 700, 900, 650, 1150, 700, 1350] },
        { id: mid('pa'), name: 'Rio', kind: 'river', pts: [1500, 1100, 1650, 1300, 1600, 1550, 1750, 1900] }],
      labels: [{ text: 'Cidadela', x: 600, y: 820, style: 'place', size: 1.2 }, { text: 'Terras Áridas', x: 1500, y: 300, style: 'region', size: 1.2, curve: 0.18 },
        { text: 'Ruínas Antigas', x: 720, y: 1560, style: 'place', size: 0.9 }, { text: 'Cratera', x: 1500, y: 1230, style: 'small', size: 1.3 },
        { text: 'Bosque Retorcido', x: 2560, y: 1760, style: 'place', size: 0.9 }, { text: 'Desfiladeiro', x: 2260, y: 760, style: 'place', size: 0.9 }],
    });
  }
  function addMap(m) { atlas.maps.push(m); atlas.activeId = m.id; selected = null; draft = null; terrainKey = ''; if (onChange) onChange(); renderRail(); refreshPanel(); renderOptbar(); fitView(); }

  // ---------- Export ----------
  function exportPng() {
    var map = activeMap(); if (!map) return;
    var b = mapBounds(map), margin = map.kind === 'hex' && map.grid.labels ? Math.max(60, map.hex.size * 0.6) : map.kind === 'world' && map.grid.on && map.grid.labels ? Math.max(40, map.grid.cell * 0.5) : 40;
    var bw = b.w + margin * 2, bh = b.h + margin * 2;
    var W = ui.exportW, scale = W / bw, H = Math.round(bh * scale);
    if (W * H > 120e6) { W = Math.floor(Math.sqrt(120e6 * bw / bh)); scale = W / bw; H = Math.round(bh * scale); }
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    var v = { x: b.x - margin, y: b.y - margin, z: scale };
    var S = STYLES[map.style] || STYLES.wasteland;
    c.fillStyle = S.paper2; c.fillRect(0, 0, W, H);
    drawScene(c, map, v, W, H, {});
    cv.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (map.name || 'mapa').replace(/[\\/:*?"<>|]+/g, '-') + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    }, 'image/png');
  }

  // ---------- Eventos de UI ----------
  function bind() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', function () { if (draft && draft.type === 'cursor') { draft = null; requestDraw(); } });
    canvas.addEventListener('dblclick', function (e) {
      if (draft && (draft.type === 'region' || draft.type === 'path')) { e.preventDefault(); finishDraft(); return; }
      if (ui.tool === 'select') { var map = activeMap(); var p = worldOf(e); var h = map && hitTest(map, p.x, p.y); if (h && h.type === 'label') startText(findItem(map, h).x, findItem(map, h).y, findItem(map, h)); }
    });
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); var p = worldOf(e); zoomAt(p.mx, p.my, view.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); }, { passive: false });
    textInput.addEventListener('blur', function () { if (textEdit) commitText(); });
    global.addEventListener('keydown', onKeyDown);
    global.addEventListener('keyup', onKeyUp);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resizeCanvas).observe(wrapEl);
    stageEl.addEventListener('wpfullscreenchange', function () { renderTopbar(); setTimeout(resizeCanvas, 0); });

    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-at], [data-at-tool], [data-at-terrain], [data-at-decal], [data-at-stamp], [data-at-open], [data-at-dup], [data-at-del], [data-at-layer-vis], [data-at-layer-lock], [data-at-tile], [data-at-tile-del]');
      if (!t || !root.contains(t)) return;
      var map = activeMap();
      if (t.hasAttribute('data-at-tool')) { setTool(t.getAttribute('data-at-tool')); return; }
      if (t.hasAttribute('data-at-terrain')) { ui.terrain = t.getAttribute('data-at-terrain'); preloadPack(ui.terrain); renderOptbar(); return; }
      if (t.hasAttribute('data-at-decal')) { ui.decal = t.getAttribute('data-at-decal'); preloadPack(ui.decal); renderOptbar(); return; }
      if (t.hasAttribute('data-at-stamp')) { ui.stamp = t.getAttribute('data-at-stamp'); renderOptbar(); return; }
      if (t.hasAttribute('data-at-open')) { atlas.activeId = t.getAttribute('data-at-open'); selected = null; draft = null; terrainKey = ''; if (onChange) onChange(); renderRail(); renderOptbar(); refreshPanel(); fitView(); return; }
      if (t.hasAttribute('data-at-dup')) {
        var src = atlas.maps.filter(function (m) { return m.id === t.getAttribute('data-at-dup'); })[0]; if (!src) return;
        var copy = GDC.normalizeAtlasMap(Object.assign(JSON.parse(JSON.stringify(src)), { id: mid('atlas'), name: src.name + ' (cópia)' }));
        addMap(copy); return;
      }
      if (t.hasAttribute('data-at-del')) {
        var did = t.getAttribute('data-at-del'), dm = atlas.maps.filter(function (m) { return m.id === did; })[0];
        if (!dm || !global.confirm('Excluir o mapa "' + dm.name + '"? Não dá pra desfazer.')) return;
        atlas.maps = atlas.maps.filter(function (m) { return m.id !== did; });
        if (atlas.activeId === did) atlas.activeId = atlas.maps[0] ? atlas.maps[0].id : null;
        delete history[did]; selected = null; terrainKey = ''; if (onChange) onChange(); renderAll(); fitView(); return;
      }
      if (t.hasAttribute('data-at-layer-vis') && map) { var lv = t.getAttribute('data-at-layer-vis'); mutate(function (m) { m.layers[lv].visible = !m.layers[lv].visible; }); return; }
      if (t.hasAttribute('data-at-layer-lock') && map) { var ll = t.getAttribute('data-at-layer-lock'); mutate(function (m) { m.layers[ll].locked = !m.layers[ll].locked; }); return; }
      var a = t.getAttribute('data-at');
      if (a === 'pick-tex' || a === 'pick-decal' || a === 'pick-stamp') { openPackPicker(t, a); return; }
      if (a === 'new-hex') { addMap(newHex()); setTool('tile'); return; }
      if (a === 'example-hex') { addMap(buildHexExample()); setTool('select'); return; }
      if (t.hasAttribute('data-at-tile') && map && map.kind === 'hex') { ui.tileId = t.getAttribute('data-at-tile'); if (ui.tool !== 'tile' && ui.tool !== 'fill') setTool('tile'); else renderOptbar(); refreshPanel(); return; }
      if (t.hasAttribute('data-at-tile-del') && map) {
        var tdel = t.getAttribute('data-at-tile-del'), used = Object.keys(map.hex.tiles).filter(function (k) { return map.hex.tiles[k] === tdel; }).length;
        if (used && !window.confirm('Excluir esta peça? ' + used + ' hexágono(s) ficam vazios.')) return;
        mutate(function (m) { m.tileset = m.tileset.filter(function (x) { return x.id !== tdel; }); Object.keys(m.hex.tiles).forEach(function (k) { if (m.hex.tiles[k] === tdel) delete m.hex.tiles[k]; }); });
        terrainKey = ''; renderOptbar(); return;
      }
      if (a === 'tile-add' && map && map.kind === 'hex') {
        var used2 = {}; map.tileset.forEach(function (x) { if (x.terrain) used2[x.terrain] = true; });
        var tr = TERRAINS.filter(function (x) { return !used2[x.id]; })[0];
        var nt = tr ? { id: mid('tile'), name: tr.label, terrain: tr.id, color: null, imageId: null } : { id: mid('tile'), name: 'Peça', terrain: null, color: '#9ca3af', imageId: null };
        mutate(function (m) { m.tileset.push(nt); }); ui.tileId = nt.id; renderOptbar(); return;
      }
      if (a === 'new-world') { addMap(newWorld()); setTool('brush'); return; }
      if (a === 'new-radial') { addMap(newRadial()); setTool('select'); return; }
      if (a === 'example-radial') { addMap(buildRadialExample()); setTool('select'); return; }
      if (a === 'example-world') { addMap(buildWorldExample()); setTool('brush'); return; }
      if (a === 'undo') { undo(); return; }
      if (a === 'redo') { redo(); return; }
      if (a === 'zoom-in') { zoomAt(canvas.width / dpr / 2, canvas.height / dpr / 2, view.z * 1.25); return; }
      if (a === 'zoom-out') { zoomAt(canvas.width / dpr / 2, canvas.height / dpr / 2, view.z / 1.25); return; }
      if (a === 'fit') { fitView(); return; }
      if (a === 'export') { exportPng(); return; }
      if (a === 'fullscreen') { GDC.fullscreen.toggle(stageEl); return; }
      if (a === 'panel') { ui.panelOpen = !ui.panelOpen; refreshPanel(); setTimeout(resizeCanvas, 0); return; }
      if (a === 'finish') { finishDraft(); renderOptbar(); return; }
      if (!map) return;
      if (a === 'delete-sel') { deleteSelected(); return; }
      if (a === 'dup-sel' && selected && selected.type === 'stamp') {
        var it = findItem(map, selected); if (!it) return;
        var cp = Object.assign({}, it, { id: mid('sp'), x: it.x + STAMP_UNIT * it.s * 1.5 });
        mutate(function (m) { m.stamps.push(cp); }); selected = { type: 'stamp', id: cp.id }; refreshPanel(); return;
      }
      if (a === 'color-reset' && selected) { var sid = selected.id, st = selected.type; mutate(function (m) { var x = findItem(m, { type: st, id: sid }); if (x) x.c = null; }); return; }
      if (a === 'sector-color-reset' && selected && selected.type === 'sector') { var s1 = selected; mutate(function (m) { m.radial.rings[s1.ring].cells[s1.sector].c = null; }); return; }
      if (a === 'ring-add' && map.kind === 'radial') {
        mutate(function (m) {
          var last = m.radial.rings[m.radial.rings.length - 1];
          var r0 = last ? Math.min(0.95, last.r1) : 0, r1 = Math.min(1.2, r0 + 0.2);
          m.radial.rings.push({ id: mid('ring'), name: 'Anel ' + (m.radial.rings.length + 1), r0: r0, r1: r1, sectors: 4, offset: 0, c: null, cells: [{ name: '', c: null }, { name: '', c: null }, { name: '', c: null }, { name: '', c: null }] });
        });
        return;
      }
      if (a === 'ring-remove' && map.kind === 'radial') {
        var ri = Number(t.closest('[data-ring]').getAttribute('data-ring'));
        mutate(function (m) { m.radial.rings.splice(ri, 1); }); selected = null; refreshPanel(); return;
      }
    });

    root.addEventListener('input', function (e) {
      var t = e.target, map = activeMap();
      if (t.hasAttribute('data-at-opt')) {
        var o = t.getAttribute('data-at-opt');
        if (o === 'brush') ui.brush = Number(t.value);
        else if (o === 'tileRadius') ui.tileRadius = Number(t.value);
        else if (o === 'opacity') ui.opacity = Number(t.value);
        else if (o === 'stampOpacity') ui.stampOpacity = Number(t.value);
        else if (o === 'stampRot') ui.stampRot = Number(t.value);
        else if (o === 'stampScale') ui.stampScale = Number(t.value);
        else if (o === 'regionColor') ui.regionColor = t.value;
        var lab = root.querySelector('[data-at-optval="' + o + '"]'); if (lab) lab.textContent = o === 'stampScale' ? Number(t.value).toFixed(1) + '×' : (o === 'opacity' || o === 'stampOpacity') ? Math.round(Number(t.value) * 100) + '%' : o === 'stampRot' ? t.value + '°' : t.value;
        return;
      }
      if (!map) return;
      // Propriedades: aplicadas ao vivo; o desfazer junta a sequência num passo só (snapshot no 1º evento).
      var live = function (fn) {
        if (!t._atBefore) t._atBefore = JSON.stringify(map);
        fn(map); map._sv = (map._sv || 0) + 1; if (onChange) onChange(); requestDraw();
      };
      if (t.hasAttribute('data-asel') && selected && t.type !== 'checkbox' && t.tagName !== 'SELECT') {
        var f = t.getAttribute('data-asel'), sid = selected.id, sty = selected.type;
        live(function (m) { var it = findItem(m, { type: sty, id: sid }); if (!it) return; it[f] = (t.type === 'range') ? Number(t.value) : t.value; });
        return;
      }
      if (t.getAttribute('data-ahex') === 'note' && selected && selected.type === 'hex') { var nk = selected.key; live(function (m) { if (t.value.trim()) m.hex.notes[nk] = t.value; else delete m.hex.notes[nk]; }); terrainKey = ''; return; }
      if (t.getAttribute('data-atile') === 'name') { var tn = t.getAttribute('data-tile-id'); live(function (m) { var x = tileById(m, tn); if (x) x.name = t.value; }); return; }
      if (t.hasAttribute('data-acomp')) { live(function (m) { m.compass.size = Number(t.value); }); return; }
      if (t.hasAttribute('data-asec') && selected && selected.type === 'sector' && t.type === 'text') {
        var s2 = selected; live(function (m) { m.radial.rings[s2.ring].cells[s2.sector].name = t.value; }); return;
      }
      if (t.hasAttribute('data-aring') && t.type === 'text') { var ri = Number(t.closest('[data-ring]').getAttribute('data-ring')); live(function (m) { m.radial.rings[ri].name = t.value; }); return; }
      if (t.hasAttribute('data-aspoke') && t.type === 'text') { live(function (m) { m.radial.spokes.name = t.value; }); return; }
      if (t.getAttribute('data-amap') === 'name') { live(function (m) { m.name = t.value; }); var tt = root.querySelector('.at-title'); if (tt) tt.lastChild.textContent = t.value; return; }
    });

    root.addEventListener('change', function (e) {
      var t = e.target, map = activeMap();
      if (t.hasAttribute('data-at-exportw')) { ui.exportW = Number(t.value); return; }
      if (t.hasAttribute('data-at-opt')) {
        var o = t.getAttribute('data-at-opt');
        if (o === 'scatter') ui.scatter = t.checked; else if (o === 'stampRandRot') ui.stampRandRot = t.checked; else if (o === 'labelStyle') ui.labelStyle = t.value; else if (o === 'pathKind') ui.pathKind = t.value;
        return;
      }
      if (t.hasAttribute('data-at-stamp-upload')) {
        var file = t.files && t.files[0]; t.value = '';
        if (!file || !GDC.imageStore) return;
        GDC.imageStore.put(file).then(function (meta) { ui.stamp = 'image'; ui.stampImage = meta.id; renderOptbar(); flash('Imagem pronta — clique no mapa pra carimbar.'); });
        return;
      }
      if (t.hasAttribute('data-at-tile-upload')) {
        var tf = t.files && t.files[0]; t.value = '';
        if (!tf || !GDC.imageStore || !map || map.kind !== 'hex') return;
        GDC.imageStore.put(tf).then(function (meta) {
          var it = { id: mid('tile'), name: (tf.name || 'Imagem').replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'Imagem', terrain: null, color: null, imageId: meta.id };
          mutate(function (m) { m.tileset.push(it); }); ui.tileId = it.id; renderOptbar();
        });
        return;
      }
      if (!map) return;
      if (t.getAttribute('data-ahex') === 'tile' && selected && selected.type === 'hex') { var tk = selected.key; mutate(function (m) { if (t.value) m.hex.tiles[tk] = t.value; else delete m.hex.tiles[tk]; }); terrainKey = ''; return; }
      if (t.getAttribute('data-atile') === 'terrain' || t.getAttribute('data-atile') === 'color') {
        var tid2 = t.getAttribute('data-tile-id'), fld = t.getAttribute('data-atile');
        mutate(function (m) {
          var x = tileById(m, tid2); if (!x) return;
          if (fld === 'terrain') {
            // nome ainda era o da textura anterior? acompanha a nova (nome personalizado fica)
            var oldLabel = x.terrain ? terrainInfo(x.terrain).label : 'Peça';
            x.terrain = t.value || null; if (!x.terrain && !x.color) x.color = '#9ca3af';
            if (!x.name || x.name === oldLabel) x.name = x.terrain ? terrainInfo(x.terrain).label : 'Peça';
          } else x.color = t.value;
        });
        terrainKey = ''; renderOptbar(); return;
      }
      if (t.hasAttribute('data-ahexmap')) {
        var hf = t.getAttribute('data-ahexmap');
        mutate(function (m) {
          var hx = m.hex;
          if (hf === 'cols' || hf === 'rows') {
            hx[hf] = clamp(Math.round(Number(t.value)) || 1, 1, 200);
            [hx.tiles, hx.notes].forEach(function (o) { Object.keys(o).forEach(function (k) { var q = k.split(','); if (Number(q[0]) >= hx.cols || Number(q[1]) >= hx.rows) delete o[k]; }); });
          } else if (hf === 'size') hx.size = clamp(Number(t.value) || 120, 10, 2000);
          else if (hf === 'orient') hx.orient = t.value === 'flat' ? 'flat' : 'pointy';
          else hx[hf] = t.checked;
        });
        if (selected && selected.type === 'hex') { var sq = selected.key.split(','); if (Number(sq[0]) >= map.hex.cols || Number(sq[1]) >= map.hex.rows) { selected = null; refreshPanel(); } }
        terrainKey = ''; if (hf !== 'lines' && hf !== 'coordsIn') fitView(); return;
      }
      if (t.hasAttribute('data-at-style')) { mutate(function (m) { m.style = t.value; }); terrainKey = ''; return; }
      // Fecha o passo de desfazer de uma sequência de "input" ao vivo.
      if (t._atBefore) { var h = hist(map); h.u.push(t._atBefore); if (h.u.length > 60) h.u.shift(); h.r = []; t._atBefore = null; refreshPanelSoon(); return; }
      if (t.hasAttribute('data-asel') && selected) {
        var f = t.getAttribute('data-asel'), sid = selected.id, sty = selected.type;
        mutate(function (m) { var it = findItem(m, { type: sty, id: sid }); if (!it) return; it[f] = t.type === 'checkbox' ? t.checked : t.value; });
        return;
      }
      if (t.hasAttribute('data-asec') && selected && selected.type === 'sector') { var s3 = selected; mutate(function (m) { m.radial.rings[s3.ring].cells[s3.sector].c = t.value; }); return; }
      if (t.hasAttribute('data-aring')) {
        var ri = Number(t.closest('[data-ring]').getAttribute('data-ring')), f2 = t.getAttribute('data-aring');
        mutate(function (m) {
          var ring = m.radial.rings[ri]; if (!ring) return;
          if (f2 === 'c') ring.c = t.value;
          else if (f2 === 'r0' || f2 === 'r1') { ring[f2] = clamp(Number(t.value) / 100, 0, 1.2); if (ring.r1 < ring.r0) { var x = ring.r0; ring.r0 = ring.r1; ring.r1 = x; } }
          else if (f2 === 'sectors') { ring.sectors = clamp(Math.round(Number(t.value)) || 1, 1, 48); while (ring.cells.length < ring.sectors) ring.cells.push({ name: '', c: null }); ring.cells = ring.cells.slice(0, ring.sectors); }
          else if (f2 === 'offset') ring.offset = clamp(Number(t.value) || 0, -360, 360);
        });
        selected = selected && selected.type === 'sector' && (!map.radial.rings[selected.ring] || selected.sector >= map.radial.rings[selected.ring].sectors) ? null : selected;
        return;
      }
      if (t.hasAttribute('data-aspoke')) {
        var f3 = t.getAttribute('data-aspoke');
        mutate(function (m) { var sp = m.radial.spokes; var n = Number(t.value); if (f3 === 'r0' || f3 === 'r1') sp[f3] = clamp(n / 100, 0, 1.2); else if (f3 === 'count') sp.count = clamp(Math.round(n) || 0, 0, 48); else if (f3 === 'offset') sp.offset = clamp(n || 0, -360, 360); else if (f3 === 'width') sp.width = clamp(n || 1, 1, 2000); });
        return;
      }
      if (t.hasAttribute('data-amap')) {
        var f4 = t.getAttribute('data-amap');
        mutate(function (m) {
          if (f4 === 'width' || f4 === 'height') m[f4] = clamp(Number(t.value) || 200, 200, 40000);
          else if (f4 === 'cell') m.grid.cell = clamp(Number(t.value) || 10, 10, 5000);
          else if (f4 === 'gridShape') m.grid.shape = t.value === 'hex' ? 'hex' : 'square';
          else if (f4 === 'gridOn') m.grid.on = t.checked; else if (f4 === 'gridLabels') m.grid.labels = t.checked; else if (f4 === 'compassOn') m.compass.on = t.checked;
          else if (f4 === 'dome') m.radial.dome = t.checked; else if (f4 === 'R') m.radial.R = clamp(Number(t.value) || 1000, 50, 20000);
        });
        if (f4 === 'width' || f4 === 'height' || f4 === 'R') fitView();
      }
    });
  }
  var panelSoon = null;
  function refreshPanelSoon() { clearTimeout(panelSoon); panelSoon = setTimeout(refreshPanel, 0); }

  function renderAll() { renderTopbar(); renderRail(); renderOptbar(); refreshPanel(); setCursor(); }

  function mount(container, opts) {
    root = container;
    atlas = opts.atlas;
    onChange = opts.onChange;
    projectType = opts.projectType;
    root.innerHTML = shellMarkup();
    stageEl = root.querySelector('#at-stage');
    canvas = root.querySelector('#at-canvas');
    ctx = canvas.getContext('2d');
    wrapEl = root.querySelector('#at-canvas-wrap');
    textInput = root.querySelector('#at-text-input');
    statusEl = root.querySelector('#at-status');
    optbarEl = root.querySelector('#at-optbar');
    bind();
    renderAll();
    needsFit = true;
    resizeCanvas();
  }
  function reset(newAtlas) {
    atlas = newAtlas; history = {}; selected = null; draft = null; drag = null; terrainKey = '';
    renderAll(); needsFit = true; resizeCanvas(); fitView();
  }
  /** Chamado quando a sub-visão fica visível (o canvas tinha tamanho zero enquanto oculto). */
  function shown() { needsFit = needsFit || !terrainKey; resizeCanvas(); }

  /** Troca a visão ('free' = mundo e radial, 'hex' = tilesets hexagonais); lembra o último mapa de cada uma. */
  var lastByMode = {};
  function setMode(m) {
    m = m === 'hex' ? 'hex' : 'free';
    if (m === mode) return;
    var cur = activeMap(); if (cur) lastByMode[mode] = cur.id;
    mode = m;
    if (atlas) { var back = atlas.maps.filter(function (x) { return x.id === lastByMode[m] && inMode(x); })[0] || modeMaps()[0]; if (back) atlas.activeId = back.id; }
    selected = null; draft = null; drag = null; terrainKey = ''; needsFit = true;
    if (root) { renderAll(); requestDraw(); }
  }

  GDC.ui.atlas = { mount: mount, reset: reset, shown: shown, setMode: setMode, mode: function () { return mode; } };
  GDC.atlas = { sectorAt: sectorAt, cellName: cellName, hexAt: hexAt, hexCenter: hexCenter, colName: colName, buildRadialExample: buildRadialExample, buildWorldExample: buildWorldExample, TERRAINS: TERRAINS, STAMPS: STAMP_ORDER, buildHexExample: buildHexExample, hexGrid: { center: hc, at: hAt, bounds: hBounds, dist: hDist, area: hArea, flood: hFlood } };
}(window));
