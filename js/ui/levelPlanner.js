/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // ---------------------------------------------------------------------------------------------
  // Mapas — planta de fase top-down (level design). O fluxo segue as 4 etapas da técnica top-down:
  //   1. Layout       — salas, corredores, limites e conexões (piso, paredes, portas, nomes)
  //   2. Fluxo        — entradas, objetivos, rotas e pontos de decisão
  //   3. Gameplay     — inimigos, obstáculos, recursos e encontros
  //   4. Refinamento  — notas de revisão + checagem automática (objetivo alcançável, áreas isoladas...)
  // Cada etapa é também uma CAMADA (mostrar/ocultar/travar). Do Dungeon Scrawl vem a ideia central do
  // desenho: você pinta o PISO e as paredes externas saem sozinhas do contorno, com hachura do lado de
  // fora (estilo planta desenhada a lápis). Paredes internas e portas ficam nas arestas da grade.
  // Estado: state.doc.levels (data.js — normalizeLevels), mutado in-place; onChange agenda o autosave.
  // ---------------------------------------------------------------------------------------------

  var STAGES = [
    { id: 'layout', n: 1, label: 'Layout', hint: 'Defina salas, corredores, limites e conexões.', icon: 'map' },
    { id: 'flow', n: 2, label: 'Fluxo do jogador', hint: 'Marque entradas, objetivos, rotas e pontos de decisão.', icon: 'route' },
    { id: 'gameplay', n: 3, label: 'Gameplay', hint: 'Adicione inimigos, obstáculos, recursos e encontros.', icon: 'gamepad-2' },
    { id: 'review', n: 4, label: 'Refinamento', hint: 'Revise o mapa conforme os testes e necessidades.', icon: 'pencil' },
  ];
  var STAGE_BY_ID = {};
  STAGES.forEach(function (s) { STAGE_BY_ID[s.id] = s; });

  var TOOLS = {
    select: { label: 'Selecionar / mover', icon: 'mouse-pointer', key: 'v', stages: null, hint: 'Clique num marcador, rota, texto ou nota pra selecionar · arraste pra mover · Delete apaga · duplo clique edita texto' },
    pan: { label: 'Mover a vista', icon: 'hand', key: 'h', stages: null, hint: 'Arraste pra mover a vista · roda do mouse dá zoom · segurar Espaço faz isso com qualquer ferramenta' },
    room: { label: 'Sala (retângulo)', icon: 'square', key: 'r', stages: ['layout'], hint: 'Arraste pra desenhar piso retangular · botão direito apaga um retângulo' },
    brush: { label: 'Pincel de piso', icon: 'brush', key: 'b', stages: ['layout'], hint: 'Pinte piso célula a célula (bom pra corredores) · botão direito apaga' },
    erase: { label: 'Borracha de piso', icon: 'eraser', key: 'e', stages: ['layout'], hint: 'Apaga piso (e portas/paredes que sobrarem soltas)' },
    wall: { label: 'Parede interna', icon: 'brick-wall', key: 'w', stages: ['layout'], hint: 'Arraste ao longo da grade pra dividir salas · botão direito apaga · as paredes externas saem sozinhas do contorno do piso' },
    door: { label: 'Porta / passagem', icon: 'door', key: 'd', stages: ['layout'], hint: 'Clique numa aresta da grade pra pôr a porta escolhida · clicar de novo (ou botão direito) remove' },
    prop: { label: 'Carimbo de cenário', icon: 'stamp', key: 's', stages: ['layout'], hint: 'Clique pra carimbar mobília/props (encaixa em meia célula) · botão direito remove · só visual: não bloqueia a checagem de alcance' },
    text: { label: 'Texto / nome de sala', icon: 'type', key: 't', stages: ['layout', 'review'], hint: 'Clique pra escrever (ex.: "A", "B", "CT") · Enter confirma · duplo clique com Selecionar edita' },
    marker: { label: 'Marcador', icon: 'map-pin', key: 'm', stages: ['flow', 'gameplay'], hint: 'Clique numa célula pra pôr o marcador escolhido · botão direito remove' },
    path: { label: 'Rota', icon: 'route', key: 'p', stages: ['flow'], hint: 'Clique ponto a ponto · duplo clique, Enter ou botão direito termina · Esc cancela' },
    pin: { label: 'Nota de revisão', icon: 'message-square', key: 'n', stages: ['review'], hint: 'Clique pra fixar uma nota (o que mudar depois do teste) · escreva no painel ao lado' },
  };
  var TOOL_ORDER = ['select', 'pan', 'room', 'brush', 'erase', 'wall', 'door', 'prop', 'marker', 'path', 'text', 'pin'];
  var STAGE_DEFAULT_TOOL = { layout: 'room', flow: 'marker', gameplay: 'marker', review: 'pin' };

  var FLOOR_TYPES = [
    { id: 'room', label: 'Sala' }, { id: 'corridor', label: 'Corredor' },
    { id: 'water', label: 'Água' }, { id: 'danger', label: 'Perigo' }, { id: 'secret', label: 'Secreto' },
  ];
  var DOOR_TYPES = [
    { id: 'door', label: 'Porta' }, { id: 'locked', label: 'Trancada' },
    { id: 'secret', label: 'Secreta' }, { id: 'gate', label: 'Grade / bloqueio' },
  ];
  var PATH_KINDS = [
    { id: 'main', label: 'Rota principal' }, { id: 'alt', label: 'Rota alternativa' }, { id: 'secret', label: 'Rota secreta / opcional' },
  ];
  var MARKERS = {
    start: { label: 'Entrada', glyph: 'E', color: '#16a34a', shape: 'circle', layer: 'flow' },
    goal: { label: 'Objetivo / saída', glyph: '★', color: '#d97706', shape: 'circle', layer: 'flow' },
    checkpoint: { label: 'Checkpoint', glyph: 'CP', color: '#0284c7', shape: 'circle', layer: 'flow' },
    decision: { label: 'Ponto de decisão', glyph: '?', color: '#7c3aed', shape: 'circle', layer: 'flow' },
    enemy: { label: 'Inimigo', glyph: '!', color: '#dc2626', shape: 'diamond', layer: 'gameplay' },
    boss: { label: 'Chefe', glyph: '!!', color: '#7f1d1d', shape: 'diamond', layer: 'gameplay' },
    encounter: { label: 'Encontro / evento', glyph: '!?', color: '#db2777', shape: 'diamond', layer: 'gameplay' },
    obstacle: { label: 'Obstáculo / armadilha', glyph: '×', color: '#ea580c', shape: 'triangle', layer: 'gameplay' },
    item: { label: 'Item / recurso', glyph: '+', color: '#0d9488', shape: 'square', layer: 'gameplay' },
    key: { label: 'Chave', glyph: 'K', color: '#ca8a04', shape: 'square', layer: 'gameplay' },
    npc: { label: 'NPC', glyph: 'N', color: '#475569', shape: 'circle', layer: 'gameplay' },
    secret: { label: 'Segredo', glyph: 'S', color: '#4b5563', shape: 'circle', layer: 'gameplay' },
  };
  // Carimbos de cenário vistos de cima, desenhados em [-0.5, 0.5] (1 célula na escala 1).
  // f = preenchimento do estilo, k = traço do estilo, a = cor de destaque do próprio carimbo.
  var rr = function (c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); };
  var ln = function (c, pts) { c.beginPath(); for (var i = 0; i < pts.length; i += 2) { if (i) c.lineTo(pts[i], pts[i + 1]); else c.moveTo(pts[i], pts[i + 1]); } c.stroke(); };
  var circ = function (c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); };
  var PROPS = {
    crate: { label: 'Caixa', draw: function (c, f, k) { rr(c, -.4, -.4, .8, .8, .04); c.fillStyle = f; c.fill(); c.stroke(); ln(c, [-.4, -.4, .4, .4]); ln(c, [.4, -.4, -.4, .4]); } },
    barrel: { label: 'Barril', draw: function (c, f) { circ(c, 0, 0, .38); c.fillStyle = f; c.fill(); c.stroke(); circ(c, 0, 0, .24); c.stroke(); } },
    table: { label: 'Mesa', draw: function (c, f) { rr(c, -.45, -.3, .9, .6, .06); c.fillStyle = f; c.fill(); c.stroke(); } },
    chair: { label: 'Cadeira', draw: function (c, f, k) { rr(c, -.2, -.15, .4, .38, .05); c.fillStyle = f; c.fill(); c.stroke(); rr(c, -.22, -.28, .44, .1, .03); c.fillStyle = k; c.fill(); } },
    bed: { label: 'Cama', draw: function (c, f, k, a) { rr(c, -.32, -.46, .64, .92, .05); c.fillStyle = f; c.fill(); c.stroke(); rr(c, -.25, -.4, .5, .18, .05); c.fillStyle = '#ffffff'; c.fill(); c.stroke(); c.fillStyle = a; rr(c, -.32, -.05, .64, .51, .04); c.globalAlpha *= .45; c.fill(); c.globalAlpha /= .45; } , a: '#3b82f6' },
    chest: { label: 'Baú', draw: function (c, f, k, a) { rr(c, -.36, -.24, .72, .48, .05); c.fillStyle = a; c.fill(); c.stroke(); ln(c, [-.36, -.06, .36, -.06]); circ(c, 0, -.06, .06); c.fillStyle = '#fde047'; c.fill(); c.stroke(); }, a: '#a16207' },
    shelf: { label: 'Estante', draw: function (c, f) { rr(c, -.46, -.16, .92, .32, .03); c.fillStyle = f; c.fill(); c.stroke(); ln(c, [-.15, -.16, -.15, .16]); ln(c, [.15, -.16, .15, .16]); } },
    pillar: { label: 'Pilar', draw: function (c, f, k) { circ(c, 0, 0, .4); c.fillStyle = k; c.fill(); circ(c, 0, 0, .28); c.fillStyle = f; c.fill(); } },
    stairs: { label: 'Escada', draw: function (c, f) { rr(c, -.45, -.45, .9, .9, .02); c.fillStyle = f; c.fill(); c.stroke(); for (var i = 1; i < 6; i++) ln(c, [-.45, -.45 + i * .15, .45, -.45 + i * .15]); ln(c, [0, .3, 0, -.3]); ln(c, [-.12, -.18, 0, -.32, .12, -.18]); } },
    plant: { label: 'Planta / vaso', draw: function (c, f, k, a) { c.fillStyle = a; for (var i = 0; i < 6; i++) { c.save(); c.rotate(i * Math.PI / 3); c.beginPath(); c.ellipse(0, -.22, .1, .2, 0, 0, Math.PI * 2); c.fill(); c.stroke(); c.restore(); } circ(c, 0, 0, .12); c.fillStyle = f; c.fill(); c.stroke(); }, a: '#16a34a' },
    tree: { label: 'Árvore', draw: function (c, f, k, a) { c.beginPath(); for (var i = 0; i <= 10; i++) { var ang = i / 10 * Math.PI * 2, rad = i % 2 ? .36 : .46; c.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad); } c.closePath(); c.fillStyle = a; c.fill(); c.stroke(); circ(c, 0, 0, .07); c.fillStyle = k; c.fill(); }, a: '#4d7c0f' },
    rock: { label: 'Pedra', draw: function (c, f) { c.beginPath(); [[-.38, -.1], [-.2, -.36], [.18, -.38], [.4, -.08], [.3, .3], [-.1, .38], [-.36, .2]].forEach(function (q, i) { if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); }); c.closePath(); c.fillStyle = f; c.fill(); c.stroke(); ln(c, [-.1, -.15, .1, .05]); } },
    rubble: { label: 'Escombros', draw: function (c, f) { [[-.22, -.18, .16], [.16, -.12, .12], [-.05, .18, .14], [.24, .2, .09], [-.3, .16, .07]].forEach(function (b) { c.beginPath(); for (var i = 0; i < 5; i++) { var an = i / 5 * Math.PI * 2 + b[0] * 7; c.lineTo(b[0] + Math.cos(an) * b[2], b[1] + Math.sin(an) * b[2]); } c.closePath(); c.fillStyle = f; c.fill(); c.stroke(); }); } },
    sandbags: { label: 'Cobertura', draw: function (c, f) { [-.3, 0, .3].forEach(function (x) { rr(c, x - .15, -.14, .3, .28, .12); c.fillStyle = f; c.fill(); c.stroke(); }); } },
    torch: { label: 'Tocha / luz', draw: function (c, f, k, a) { circ(c, 0, 0, .3); c.fillStyle = a; c.globalAlpha *= .3; c.fill(); c.globalAlpha /= .3; circ(c, 0, 0, .12); c.fillStyle = a; c.fill(); c.stroke(); }, a: '#f59e0b' },
    terminal: { label: 'Terminal', draw: function (c, f, k, a) { rr(c, -.34, -.24, .68, .48, .05); c.fillStyle = f; c.fill(); c.stroke(); rr(c, -.24, -.16, .48, .22, .03); c.fillStyle = a; c.fill(); }, a: '#0ea5e9' },
    vent: { label: 'Grade / duto', draw: function (c, f) { rr(c, -.36, -.36, .72, .72, .04); c.fillStyle = f; c.fill(); c.stroke(); for (var i = -2; i <= 2; i++) ln(c, [-.26, i * .12, .26, i * .12]); } },
    statue: { label: 'Estátua', draw: function (c, f, k) { rr(c, -.38, -.38, .76, .76, .04); c.fillStyle = f; c.fill(); c.stroke(); c.beginPath(); for (var i = 0; i < 10; i++) { var an = i / 10 * Math.PI * 2 - Math.PI / 2, rad = i % 2 ? .12 : .28; c.lineTo(Math.cos(an) * rad, Math.sin(an) * rad); } c.closePath(); c.fillStyle = k; c.fill(); } },
  };
  var PROP_ORDER = Object.keys(PROPS);
  var PROP_SIZES = [[0.5, '½'], [1, '1'], [2, '2'], [3, '3']];
  var imgCache = {};
  function propImage(id) {
    if (!id || !GDC.imageStore) return null;
    if (imgCache[id]) return imgCache[id].img || null;
    imgCache[id] = {};
    GDC.imageStore.getURL(id).then(function (url) { if (!url) return; var im = new Image(); im.onload = function () { imgCache[id].img = im; requestDraw(); }; im.src = url; });
    return null;
  }
  function drawProp(ctx, S, pr, sx, sy, z, selected) {
    var px = sx(pr.x), py = sy(pr.y), sc = z * pr.s;
    ctx.save();
    ctx.translate(px, py); ctx.rotate(pr.r * Math.PI / 180);
    if (pr.k === 'image') {
      var im = propImage(pr.imageId);
      if (im) { var ar = im.width / im.height, w = ar >= 1 ? sc : sc * ar, h = ar >= 1 ? sc / ar : sc; ctx.drawImage(im, -w / 2, -h / 2, w, h); }
      else { ctx.strokeStyle = S.wall; ctx.setLineDash([4, 3]); ctx.strokeRect(-sc / 2, -sc / 2, sc, sc); }
    } else {
      var d = PROPS[pr.k] || PROPS.crate;
      ctx.scale(sc, sc);
      ctx.lineWidth = Math.max(1, Math.min(2.2, z * 0.05)) / sc;
      ctx.strokeStyle = S.wall; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      d.draw(ctx, S.prop || '#e7dcc6', S.wall, d.a || S.wall);
    }
    ctx.restore();
    if (pr.label && z * pr.s >= 14) {
      ctx.save(); ctx.font = 'bold ' + Math.max(9, z * 0.32) + 'px ' + LABEL_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.lineWidth = 3; ctx.strokeStyle = S.halo; ctx.strokeText(pr.label, px, py + z * pr.s * 0.5 + 2); ctx.fillStyle = S.text; ctx.fillText(pr.label, px, py + z * pr.s * 0.5 + 2); ctx.restore();
    }
    if (selected) selRect(ctx, px - sc / 2 - 3, py - sc / 2 - 3, sc + 6, sc + 6);
  }
  var propIconCache = {};
  function propIcon(k, S) {
    var key = k + '|' + (S.prop || '');
    if (propIconCache[key]) return propIconCache[key];
    var cv = document.createElement('canvas'), n = 44; cv.width = cv.height = n;
    var c = cv.getContext('2d'); c.fillStyle = S.bg; c.fillRect(0, 0, n, n);
    c.translate(n / 2, n / 2); c.scale(n * 0.9, n * 0.9); c.lineWidth = 1.6 / (n * 0.9); c.strokeStyle = S.wall; c.lineJoin = 'round'; c.lineCap = 'round';
    PROPS[k].draw(c, S.prop || '#e7dcc6', S.wall, PROPS[k].a || S.wall);
    return (propIconCache[key] = cv.toDataURL());
  }

  var MARKER_ORDER = ['start', 'goal', 'checkpoint', 'decision', 'enemy', 'boss', 'encounter', 'obstacle', 'item', 'key', 'npc', 'secret'];

  var STYLES = {
    sketch: {
      label: 'Rascunho', bg: '#f6f2e8', grid: 'rgba(60,50,40,0.07)', floorGrid: 'rgba(60,50,40,0.16)', wall: '#2b2620',
      hatch: 'rgba(43,38,32,0.5)', text: '#2b2620', halo: 'rgba(255,255,255,0.85)',
      prop: '#e9dfc9', floor: { room: '#ffffff', corridor: '#f1ece2', water: '#d4e8f4', danger: '#f6d3c6', secret: '#e9e3f2' },
      path: { main: '#c2410c', alt: '#2563eb', secret: '#6b7280' },
    },
    // Mesmo traço do Rascunho, em papel escuro — padrão dos mapas novos quando o app está no tema
    // escuro (um retângulo bege claro no meio da tela escura destoava do resto do app).
    'sketch-dark': {
      label: 'Rascunho escuro', bg: '#1f1d1a', grid: 'rgba(255,245,230,0.05)', floorGrid: 'rgba(255,245,230,0.11)', wall: '#ece5d8',
      hatch: 'rgba(236,229,216,0.3)', text: '#ece5d8', halo: 'rgba(31,29,26,0.85)',
      prop: '#4a443b', floor: { room: '#2d2a26', corridor: '#272420', water: '#1f3a4a', danger: '#4a2a24', secret: '#352f42' },
      path: { main: '#fb923c', alt: '#60a5fa', secret: '#a8a29e' },
    },
    blueprint: {
      label: 'Blueprint', bg: '#16324f', grid: 'rgba(255,255,255,0.05)', floorGrid: 'rgba(255,255,255,0.13)', wall: '#eaf2ff',
      hatch: 'rgba(234,242,255,0.3)', text: '#eaf2ff', halo: 'rgba(22,50,79,0.85)',
      prop: '#2c5c8f', floor: { room: '#1f4570', corridor: '#1b3d63', water: '#1d5a85', danger: '#6b2d3f', secret: '#3b3570' },
      path: { main: '#fbbf24', alt: '#7dd3fc', secret: '#cbd5e1' },
    },
  };
  var LABEL_FONT = "'Segoe Print','Bradley Hand','Comic Sans MS','Chalkboard SE',cursive";
  var SEL_COLOR = '#3b82f6';
  var Z_MIN = 6, Z_MAX = 120;

  // ---------- utilidades de grade ----------
  function ck(x, y) { return x + ',' + y; }
  function ek(x, y, d) { return x + ',' + y + ',' + d; }
  function parseCk(k) { var p = k.split(','); return [Number(p[0]), Number(p[1])]; }
  function parseEk(k) { var p = k.split(','); return [Number(p[0]), Number(p[1]), p[2]]; }
  /** As duas células separadas por uma aresta. */
  function edgeCells(x, y, d) { return d === 'h' ? [[x, y - 1], [x, y]] : [[x - 1, y], [x, y]]; }
  function edgeBetween(ax, ay, bx, by) {
    if (ax === bx) return ek(ax, Math.max(ay, by), 'h');
    return ek(Math.max(ax, bx), ay, 'v');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function distToSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    var qx = ax + t * dx - px, qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }

  // ---------- análise (checagem do refinamento) ----------
  /** Duas células vizinhas são atravessáveis se ambas têm piso e a aresta entre elas não tem parede
   *  interna (ou tem uma porta, que conta como passagem — inclusive trancada/secreta). */
  function passable(map, ax, ay, bx, by) {
    if (!map.cells[ck(ax, ay)] || !map.cells[ck(bx, by)]) return false;
    var e = edgeBetween(ax, ay, bx, by);
    return !map.walls[e] || !!map.doors[e];
  }
  function flood(map, sx, sy) {
    var seen = {}, queue = [[sx, sy]];
    if (!map.cells[ck(sx, sy)]) return seen;
    seen[ck(sx, sy)] = 0;
    for (var i = 0; i < queue.length; i++) {
      var c = queue[i], d = seen[ck(c[0], c[1])];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
        var nx = c[0] + o[0], ny = c[1] + o[1], k = ck(nx, ny);
        if (seen[k] === undefined && passable(map, c[0], c[1], nx, ny)) { seen[k] = d + 1; queue.push([nx, ny]); }
      });
    }
    return seen;
  }
  function analyze(map) {
    var cellKeys = Object.keys(map.cells);
    var res = { issues: [], stats: [] };
    var count = function (kind) { return map.markers.filter(function (m) { return m.kind === kind; }).length; };
    if (!cellKeys.length) {
      res.issues.push({ level: 'info', text: 'Mapa vazio — comece pela etapa 1 (Layout): desenhe salas e corredores.' });
      return res;
    }
    // componentes de piso conectados
    var comp = {}, nComp = 0;
    cellKeys.forEach(function (k) {
      if (comp[k] !== undefined) return;
      var c = parseCk(k), f = flood(map, c[0], c[1]);
      Object.keys(f).forEach(function (kk) { comp[kk] = nComp; });
      nComp++;
    });
    var rooms = 0, roomSeen = {};
    cellKeys.forEach(function (k) {
      if (map.cells[k] !== 'room' || roomSeen[k]) return;
      rooms++;
      var stack = [k];
      roomSeen[k] = true;
      while (stack.length) {
        var c = parseCk(stack.pop());
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
          var nk = ck(c[0] + o[0], c[1] + o[1]);
          if (!roomSeen[nk] && map.cells[nk] === 'room' && passable(map, c[0], c[1], c[0] + o[0], c[1] + o[1])) { roomSeen[nk] = true; stack.push(nk); }
        });
      }
    });
    var starts = map.markers.filter(function (m) { return m.kind === 'start'; });
    var goals = map.markers.filter(function (m) { return m.kind === 'goal'; });
    var reach = null;
    if (!starts.length) res.issues.push({ level: 'warn', text: 'Falta marcar a entrada do jogador (etapa 2 · Fluxo).', stage: 'flow' });
    if (!goals.length) res.issues.push({ level: 'warn', text: 'Falta marcar o objetivo / saída (etapa 2 · Fluxo).', stage: 'flow' });
    if (starts.length) {
      var s = starts[0];
      if (!map.cells[ck(s.x, s.y)]) res.issues.push({ level: 'error', text: 'A entrada está fora do piso.', focus: s.id });
      else reach = flood(map, s.x, s.y);
    }
    if (reach) {
      goals.forEach(function (g) {
        if (reach[ck(g.x, g.y)] === undefined) res.issues.push({ level: 'error', text: 'Objetivo inalcançável a partir da entrada — confira paredes e portas no caminho.', focus: g.id });
      });
      var unreach = map.markers.filter(function (m) { return m.kind !== 'start' && m.kind !== 'goal' && map.cells[ck(m.x, m.y)] && reach[ck(m.x, m.y)] === undefined; });
      if (unreach.length) res.issues.push({ level: 'warn', text: unreach.length + ' marcador(es) em área que o jogador não alcança a partir da entrada.', focus: unreach[0].id });
    }
    // (a entrada fora do piso já tem aviso próprio acima)
    var off = map.markers.filter(function (m) { return m.kind !== 'start' && !map.cells[ck(m.x, m.y)]; });
    if (off.length) res.issues.push({ level: 'warn', text: off.length + ' marcador(es) fora do piso.', focus: off[0].id });
    if (nComp > 1) res.issues.push({ level: 'warn', text: nComp + ' áreas de piso isoladas entre si (sem passagem ligando) — pode ser intencional (outro andar, área secreta).' });
    var lockedDoors = Object.keys(map.doors).filter(function (k) { return map.doors[k] === 'locked'; }).length;
    if (lockedDoors && !count('key')) res.issues.push({ level: 'warn', text: 'Há porta trancada mas nenhuma chave no mapa (etapa 3 · Gameplay).', stage: 'gameplay' });
    if (starts.length && goals.length && !map.paths.some(function (p) { return p.kind === 'main'; })) {
      res.issues.push({ level: 'info', text: 'Dica: desenhe a rota principal (etapa 2) pra visualizar o caminho pretendido.', stage: 'flow' });
    }
    var openPins = map.pins.filter(function (p) { return !p.done; }).length;
    if (openPins) res.issues.push({ level: 'info', text: openPins + ' nota(s) de revisão em aberto.', stage: 'review' });
    if (!res.issues.length) res.issues.push({ level: 'ok', text: 'Nenhum problema encontrado.' });

    var shortest = '—';
    if (reach && goals.length) {
      var best = null;
      goals.forEach(function (g) { var d = reach[ck(g.x, g.y)]; if (d !== undefined && (best === null || d < best)) best = d; });
      if (best !== null) shortest = best + ' células';
    }
    var mainLen = 0;
    map.paths.filter(function (p) { return p.kind === 'main'; }).forEach(function (p) {
      for (var i = 1; i < p.points.length; i++) mainLen += Math.abs(p.points[i][0] - p.points[i - 1][0]) + Math.abs(p.points[i][1] - p.points[i - 1][1]);
    });
    res.stats = [
      ['Área de piso', cellKeys.length + ' células'],
      ['Salas', String(rooms)],
      ['Áreas conectadas', String(nComp)],
      ['Caminho mais curto até o objetivo', shortest],
      ['Rota principal desenhada', mainLen ? Math.round(mainLen) + ' células' : '—'],
      ['Inimigos / chefes', count('enemy') + ' / ' + count('boss')],
      ['Itens / chaves', count('item') + ' / ' + count('key')],
      ['Obstáculos', String(count('obstacle'))],
      ['Carimbos de cenário', String((map.props || []).length)],
    ];
    return res;
  }

  // ---------- renderização (usada pela tela e pelo export PNG) ----------
  /** v = { ox, oy, z, W, H }: (ox,oy) = coordenada de mundo no canto superior esquerdo; z = px por
   *  célula. o = { style, showGrid, focusLayer (camada em destaque — as outras ficam esmaecidas),
   *  selectedId, overlay(ctx) }. */
  function drawMap(ctx, map, v, o) {
    var S = STYLES[map.style] || STYLES.sketch;
    var z = v.z;
    var sx = function (wx) { return (wx - v.ox) * z; };
    var sy = function (wy) { return (wy - v.oy) * z; };
    var x0 = Math.floor(v.ox) - 1, y0 = Math.floor(v.oy) - 1;
    var x1 = Math.ceil(v.ox + v.W / z) + 1, y1 = Math.ceil(v.oy + v.H / z) + 1;
    var inView = function (x, y) { return x >= x0 && x <= x1 && y >= y0 && y <= y1; };
    var layerAlpha = function (id) {
      if (!map.layers[id].visible) return 0;
      return (o.focusLayer && o.focusLayer !== id) ? 0.4 : 1;
    };

    ctx.save();
    // papel com grão (js/paperTexture.js), preso à grade: 1 ladrilho de 512 px = 16 células
    var paper = GDC.paperTexture ? GDC.paperTexture.pattern(ctx, S.bg, map.style === 'blueprint' ? 0.5 : 0.8, v.z / 32, -v.ox * v.z, -v.oy * v.z, function () { requestDraw(); }) : null;
    ctx.fillStyle = paper || S.bg;
    ctx.fillRect(0, 0, v.W, v.H);

    if (o.showGrid && z >= 8) {
      ctx.strokeStyle = S.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var gx = x0; gx <= x1; gx++) { var px = Math.round(sx(gx)) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, v.H); }
      for (var gy = y0; gy <= y1; gy++) { var py = Math.round(sy(gy)) + 0.5; ctx.moveTo(0, py); ctx.lineTo(v.W, py); }
      ctx.stroke();
    }

    var cells = map.cells;
    var cellKeys = Object.keys(cells);

    // ---- camada 1: layout ----
    var aL = layerAlpha('layout');
    if (aL > 0) {
      ctx.globalAlpha = aL;
      // hachura do lado de fora do piso (1 célula de profundidade, incluindo diagonais)
      var hatch = {}, hatchList = [];
      cellKeys.forEach(function (k) {
        var c = parseCk(k);
        if (!inView(c[0], c[1])) return;
        for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
          var hk = ck(c[0] + dx, c[1] + dy);
          if (!cells[hk] && !hatch[hk]) { hatch[hk] = 1; hatchList.push([c[0] + dx, c[1] + dy]); }
        }
      });
      if (hatchList.length && z >= 5) {
        var hx0 = Infinity, hy0 = Infinity, hx1 = -Infinity, hy1 = -Infinity;
        ctx.save();
        ctx.beginPath();
        hatchList.forEach(function (c) {
          var px0 = sx(c[0]), py0 = sy(c[1]);
          ctx.rect(px0, py0, z, z);
          hx0 = Math.min(hx0, px0); hy0 = Math.min(hy0, py0); hx1 = Math.max(hx1, px0 + z); hy1 = Math.max(hy1, py0 + z);
        });
        ctx.clip();
        ctx.strokeStyle = S.hatch;
        // Diagonais "/" = retas x + y = k (em px de tela). k é alinhado a partir de um ponto fixo do
        // MUNDO (a origem), senão a hachura "escorrega" ao mover a vista.
        var sp = Math.max(4, z * 0.2);
        var anchor = sx(0) + sy(0);
        var kStart = anchor + Math.ceil((hx0 + hy0 - anchor) / sp) * sp;
        for (var kk = kStart; kk <= hx1 + hy1; kk += sp) {
          var idx = Math.round((kk - anchor) / sp);
          ctx.lineWidth = (((idx % 3) + 3) % 3 === 0) ? Math.max(1, z * 0.04) : Math.max(0.7, z * 0.025);
          ctx.beginPath();
          ctx.moveTo(kk - hy1, hy1);
          ctx.lineTo(kk - hy0, hy0);
          ctx.stroke();
        }
        ctx.restore();
      }
      // piso
      cellKeys.forEach(function (k) {
        var c = parseCk(k);
        if (!inView(c[0], c[1])) return;
        ctx.fillStyle = S.floor[cells[k]] || S.floor.room;
        ctx.fillRect(Math.floor(sx(c[0])), Math.floor(sy(c[1])), Math.ceil(z) + 1, Math.ceil(z) + 1);
      });
      // grade dentro do piso
      if (z >= 10) {
        ctx.strokeStyle = S.floorGrid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        cellKeys.forEach(function (k) {
          var c = parseCk(k);
          if (!inView(c[0], c[1])) return;
          if (cells[ck(c[0], c[1] - 1)]) { ctx.moveTo(sx(c[0]), Math.round(sy(c[1])) + 0.5); ctx.lineTo(sx(c[0] + 1), Math.round(sy(c[1])) + 0.5); }
          if (cells[ck(c[0] - 1, c[1])]) { ctx.moveTo(Math.round(sx(c[0])) + 0.5, sy(c[1])); ctx.lineTo(Math.round(sx(c[0])) + 0.5, sy(c[1] + 1)); }
        });
        ctx.stroke();
      }
      // paredes: contorno do piso + paredes internas + arestas com porta (porta sempre tem parede em volta)
      var wallEdges = {};
      cellKeys.forEach(function (k) {
        var c = parseCk(k), x = c[0], y = c[1];
        if (!inView(x, y)) return;
        if (!cells[ck(x, y - 1)]) wallEdges[ek(x, y, 'h')] = 1;
        if (!cells[ck(x, y + 1)]) wallEdges[ek(x, y + 1, 'h')] = 1;
        if (!cells[ck(x - 1, y)]) wallEdges[ek(x, y, 'v')] = 1;
        if (!cells[ck(x + 1, y)]) wallEdges[ek(x + 1, y, 'v')] = 1;
      });
      Object.keys(map.walls).forEach(function (k) { wallEdges[k] = 1; });
      Object.keys(map.doors).forEach(function (k) { wallEdges[k] = 1; });
      ctx.strokeStyle = S.wall;
      ctx.lineCap = 'square';
      ctx.lineWidth = Math.max(2, z * 0.12);
      ctx.beginPath();
      Object.keys(wallEdges).forEach(function (k) {
        var e = parseEk(k);
        if (!inView(e[0], e[1])) return;
        ctx.moveTo(sx(e[0]), sy(e[1]));
        if (e[2] === 'h') ctx.lineTo(sx(e[0] + 1), sy(e[1])); else ctx.lineTo(sx(e[0]), sy(e[1] + 1));
      });
      ctx.stroke();
      ctx.lineCap = 'butt';
      // portas
      Object.keys(map.doors).forEach(function (k) {
        var e = parseEk(k);
        if (!inView(e[0], e[1])) return;
        drawDoor(ctx, S, map, e, map.doors[k], sx, sy, z);
      });
      // carimbos de cenário (mobília/props)
      (map.props || []).forEach(function (pr) { if (inView(pr.x, pr.y) || pr.s > 2) drawProp(ctx, S, pr, sx, sy, z, o.selectedId === pr.id); });
      // textos da camada de layout
      drawLabels(ctx, S, map, 'layout', sx, sy, z, o.selectedId);
      ctx.globalAlpha = 1;
    }

    // ---- camada 2: fluxo ----
    var aF = layerAlpha('flow');
    if (aF > 0) {
      ctx.globalAlpha = aF;
      map.paths.forEach(function (p) { drawPath(ctx, S, p, sx, sy, z, o.selectedId === p.id); });
      map.markers.forEach(function (m) { if (MARKERS[m.kind].layer === 'flow') drawMarker(ctx, S, m, sx, sy, z, o.selectedId === m.id); });
      ctx.globalAlpha = 1;
    }
    // ---- camada 3: gameplay ----
    var aG = layerAlpha('gameplay');
    if (aG > 0) {
      ctx.globalAlpha = aG;
      map.markers.forEach(function (m) { if (MARKERS[m.kind].layer === 'gameplay') drawMarker(ctx, S, m, sx, sy, z, o.selectedId === m.id); });
      ctx.globalAlpha = 1;
    }
    // ---- camada 4: refinamento ----
    var aR = layerAlpha('review');
    if (aR > 0) {
      ctx.globalAlpha = aR;
      drawLabels(ctx, S, map, 'review', sx, sy, z, o.selectedId);
      map.pins.forEach(function (p, idx) { drawPin(ctx, p, idx + 1, sx, sy, z, o.selectedId === p.id); });
      ctx.globalAlpha = 1;
    }
    if (o.overlay) o.overlay(ctx, sx, sy, z, S);
    ctx.restore();
  }

  function drawDoor(ctx, S, map, e, type, sx, sy, z) {
    var x = e[0], y = e[1], horiz = e[2] === 'h';
    var cx = horiz ? sx(x + 0.5) : sx(x), cy = horiz ? sy(y) : sy(y + 0.5);
    var cells = edgeCells(x, y, e[2]);
    var t0 = map.cells[ck(cells[0][0], cells[0][1])], t1 = map.cells[ck(cells[1][0], cells[1][1])];
    var floorCol = S.floor[t1 || t0 || 'room'];
    var len = z * 0.62, th = Math.max(4, z * 0.24);
    var w = horiz ? len : th, h = horiz ? th : len;
    ctx.save();
    ctx.lineWidth = Math.max(1.2, z * 0.05);
    ctx.strokeStyle = S.wall;
    if (type === 'secret') {
      ctx.fillStyle = S.wall;
      ctx.font = 'bold ' + Math.max(8, z * 0.42) + 'px ' + LABEL_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = S.halo;
      ctx.beginPath(); ctx.arc(cx, cy, z * 0.24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = S.wall;
      ctx.fillText('S', cx, cy + 1);
    } else if (type === 'gate') {
      ctx.fillStyle = floorCol;
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      var n = 4;
      ctx.lineWidth = Math.max(1, z * 0.04);
      ctx.beginPath();
      for (var i = 0; i < n; i++) {
        var t = (i + 0.5) / n - 0.5;
        if (horiz) { ctx.moveTo(cx + t * len, cy - th * 0.7); ctx.lineTo(cx + t * len, cy + th * 0.7); }
        else { ctx.moveTo(cx - th * 0.7, cy + t * len); ctx.lineTo(cx + th * 0.7, cy + t * len); }
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = floorCol;
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      if (type === 'locked') {
        ctx.fillStyle = S.wall;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.8, z * 0.07), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function labelFont(l, z) { return 'bold ' + Math.max(7, z * 0.55 * l.size) + 'px ' + LABEL_FONT; }
  function drawLabels(ctx, S, map, layer, sx, sy, z, selectedId) {
    map.labels.forEach(function (l) {
      if (l.layer !== layer) return;
      ctx.font = labelFont(l, z);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, z * 0.12);
      ctx.strokeStyle = S.halo;
      ctx.strokeText(l.text, sx(l.x), sy(l.y));
      ctx.fillStyle = layer === 'review' ? '#dc2626' : S.text;
      ctx.fillText(l.text, sx(l.x), sy(l.y));
      if (selectedId === l.id) {
        var w = ctx.measureText(l.text).width, h = z * 0.6 * l.size;
        selRect(ctx, sx(l.x) - w / 2 - 4, sy(l.y) - h / 2 - 2, w + 8, h + 4);
      }
    });
  }

  function selRect(ctx, x, y, w, h) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = SEL_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function drawMarker(ctx, S, m, sx, sy, z, selected) {
    var def = MARKERS[m.kind];
    var cx = sx(m.x + 0.5), cy = sy(m.y + 0.5), r = z * 0.36;
    ctx.save();
    ctx.fillStyle = def.color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, z * 0.05);
    ctx.beginPath();
    if (def.shape === 'circle') ctx.arc(cx, cy, r, 0, Math.PI * 2);
    else if (def.shape === 'diamond') { ctx.moveTo(cx, cy - r * 1.12); ctx.lineTo(cx + r * 1.12, cy); ctx.lineTo(cx, cy + r * 1.12); ctx.lineTo(cx - r * 1.12, cy); ctx.closePath(); }
    else if (def.shape === 'triangle') { ctx.moveTo(cx, cy - r * 1.1); ctx.lineTo(cx + r * 1.1, cy + r * 0.85); ctx.lineTo(cx - r * 1.1, cy + r * 0.85); ctx.closePath(); }
    else { ctx.rect(cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8); }
    ctx.fill();
    ctx.stroke();
    if (z >= 12) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + Math.max(7, z * (def.glyph.length > 1 ? 0.3 : 0.4)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.glyph, cx, cy + (def.shape === 'triangle' ? r * 0.18 : 1));
    }
    if (m.label && z >= 14) {
      ctx.font = 'bold ' + Math.max(8, z * 0.3) + 'px ' + LABEL_FONT;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, z * 0.1);
      ctx.strokeStyle = S.halo;
      ctx.strokeText(m.label, cx, cy + r + z * 0.22);
      ctx.fillStyle = S.text;
      ctx.fillText(m.label, cx, cy + r + z * 0.22);
    }
    ctx.restore();
    if (selected) selRect(ctx, cx - r * 1.35, cy - r * 1.35, r * 2.7, r * 2.7);
  }

  function arrowHead(ctx, x, y, ang, size) {
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(ang) * size * 0.6, y + Math.sin(ang) * size * 0.6);
    ctx.lineTo(x + Math.cos(ang + 2.5) * size, y + Math.sin(ang + 2.5) * size);
    ctx.lineTo(x + Math.cos(ang - 2.5) * size, y + Math.sin(ang - 2.5) * size);
    ctx.closePath();
    ctx.fill();
  }
  function drawPath(ctx, S, p, sx, sy, z, selected) {
    var col = S.path[p.kind] || S.path.main;
    var pts = p.points.map(function (pt) { return [sx(pt[0]), sy(pt[1])]; });
    ctx.save();
    if (selected) {
      ctx.strokeStyle = 'rgba(59,130,246,0.35)';
      ctx.lineWidth = Math.max(8, z * 0.3);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.stroke();
    }
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = Math.max(2, z * 0.08);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (p.kind === 'alt') ctx.setLineDash([z * 0.3, z * 0.2]);
    else if (p.kind === 'secret') ctx.setLineDash([1, z * 0.18]);
    ctx.beginPath();
    pts.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
    ctx.stroke();
    ctx.setLineDash([]);
    var size = Math.max(6, z * 0.28);
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      var segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (i === pts.length - 1) arrowHead(ctx, b[0], b[1], ang, size * 1.15);
      else if (segLen > size * 3) arrowHead(ctx, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ang, size * 0.85);
      if (i === pts.length - 1 && segLen > size * 5) arrowHead(ctx, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ang, size * 0.85);
    }
    ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], Math.max(2.5, z * 0.1), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawPin(ctx, p, num, sx, sy, z, selected) {
    var x = sx(p.x), y = sy(p.y), r = Math.max(7, z * 0.3);
    ctx.save();
    ctx.globalAlpha *= p.done ? 0.55 : 1;
    ctx.fillStyle = p.done ? '#16a34a' : '#dc2626';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - r * 0.6, y - r * 1.2);
    ctx.lineTo(x + r * 0.6, y - r * 1.2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath(); ctx.arc(x, y - r * 1.55, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.max(8, r * 1.05) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(p.done ? '✓' : String(num), x, y - r * 1.55 + 1);
    ctx.restore();
    if (selected) selRect(ctx, x - r - 4, y - r * 2.55 - 4, r * 2 + 8, r * 2.55 + 8);
  }

  /** Extensão do conteúdo do mapa em coordenadas de mundo (pra "ajustar à tela" e export). */
  function contentBounds(map) {
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    var add = function (x, y) { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); };
    Object.keys(map.cells).forEach(function (k) { var c = parseCk(k); add(c[0], c[1]); add(c[0] + 1, c[1] + 1); });
    map.markers.forEach(function (m) { add(m.x, m.y); add(m.x + 1, m.y + 1); });
    map.labels.forEach(function (l) { add(l.x - 1, l.y - 0.5); add(l.x + 1, l.y + 0.5); });
    map.pins.forEach(function (p) { add(p.x, p.y - 1); add(p.x, p.y); });
    (map.props || []).forEach(function (p) { add(p.x - p.s / 2, p.y - p.s / 2); add(p.x + p.s / 2, p.y + p.s / 2); });
    map.paths.forEach(function (p) { p.points.forEach(function (pt) { add(pt[0], pt[1]); }); });
    if (b.x0 === Infinity) return null;
    return b;
  }

  // ---------- mapa de exemplo (espelha o croqui do carrossel: entrada → bifurcação → A/B → chefe) ----------
  function buildExampleMap(name) {
    var m = GDC.createEmptyLevelMap(name || 'Exemplo — masmorra');
    var rect = function (x0, y0, x1, y1, t) { for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) m.cells[ck(x, y)] = t || 'room'; };
    rect(10, 16, 14, 19);            // entrada
    rect(12, 13, 12, 15, 'corridor');
    rect(9, 11, 15, 12);             // salão da bifurcação
    rect(2, 7, 7, 12);               // sala A
    rect(8, 11, 8, 11, 'corridor');
    rect(17, 8, 22, 13);             // sala B
    rect(16, 11, 16, 11, 'corridor');
    rect(4, 3, 4, 6, 'corridor');
    rect(5, 3, 9, 3, 'corridor');
    rect(10, 1, 14, 5);              // sala do chefe
    rect(20, 3, 20, 7, 'corridor');
    rect(15, 3, 19, 3, 'corridor');
    rect(19, 14, 21, 15, 'water');
    m.doors[ek(8, 11, 'v')] = 'door';
    m.doors[ek(17, 11, 'v')] = 'door';
    m.doors[ek(10, 3, 'v')] = 'door';
    m.doors[ek(15, 3, 'v')] = 'locked';
    m.doors[ek(12, 16, 'h')] = 'gate';
    // nicho secreto no canto inferior esquerdo da sala A (fora da rota principal)
    m.walls[ek(2, 11, 'h')] = 1; m.walls[ek(3, 11, 'h')] = 1;
    m.walls[ek(4, 11, 'v')] = 1; m.walls[ek(4, 12, 'v')] = 1; m.doors[ek(4, 12, 'v')] = 'secret';
    var mk = function (kind, x, y, label) { m.markers.push({ id: GDC.makeId('mk'), kind: kind, x: x, y: y, label: label || '', note: '' }); };
    mk('start', 12, 18); mk('decision', 12, 11); mk('checkpoint', 7, 3); mk('goal', 12, 2, 'Saída');
    mk('enemy', 3, 8); mk('enemy', 6, 9); mk('item', 3, 12); mk('enemy', 19, 9); mk('enemy', 21, 12);
    mk('key', 22, 8); mk('obstacle', 20, 5); mk('boss', 12, 4); mk('secret', 2, 12);
    m.paths.push({ id: GDC.makeId('pt'), kind: 'main', label: '', points: [[12.5, 17.5], [12.5, 11.5], [4.5, 11.5], [4.5, 3.5], [11.5, 3.5]] });
    m.paths.push({ id: GDC.makeId('pt'), kind: 'alt', label: '', points: [[13.5, 12.5], [20.5, 12.5], [20.5, 3.5], [13.5, 3.5]] });
    var lb = function (t, x, y, size, layer) { m.labels.push({ id: GDC.makeId('lb'), text: t, x: x, y: y, size: size || 1, layer: layer || 'layout' }); };
    lb('Entrada', 12.5, 19.5, 0.7); lb('A', 6.5, 7.6, 1.5); lb('B', 18, 13.5, 1.5); lb('Chefe', 12.5, 1.5, 0.7);
    var pr = function (k, x, y, sc, r) { m.props.push({ id: GDC.makeId('pr'), k: k, x: x, y: y, s: sc || 1, r: r || 0, label: '', imageId: null }); };
    pr('crate', 2.5, 7.5); pr('crate', 3.5, 7.5); pr('barrel', 7.5, 12.5); pr('shelf', 5.5, 7.5);
    pr('table', 19.5, 10.5); pr('chair', 18.5, 10.5, 1, 270); pr('chair', 20.5, 10.5, 1, 90); pr('rubble', 22.5, 13.5);
    pr('pillar', 10.5, 4.5); pr('pillar', 14.5, 4.5); pr('torch', 10.5, 1.5); pr('torch', 14.5, 1.5);
    pr('sandbags', 10.5, 17.5, 1, 90); pr('stairs', 14.5, 19.5);
    m.pins.push({ id: GDC.makeId('pn'), x: 20.5, y: 7, note: 'A rota alternativa por B está longa demais? Medir o tempo de travessia no protótipo.', done: false });
    return m;
  }

  // =============================================================================================
  // Módulo de UI
  // =============================================================================================
  var root, levels, onChange, projectType;
  var canvas, ctx, wrapEl, textInput, hintEl, emptyEl, optbarEl, stageEl;
  var view = { ox: -2, oy: -2, z: 32 };
  var ui = {
    stage: 'layout', tool: 'room', floorType: 'room', brushSize: 1, doorType: 'door', pathKind: 'main',
    markerKind: { flow: 'start', gameplay: 'enemy' }, prop: 'crate', propImage: null, propSize: 1, propRot: 0, labelSize: 1, showGrid: true, focus: true, panelOpen: true,
  };
  var selectedId = null;
  var drag = null;       // ação em andamento (pointerdown → pointerup)
  var pathDraft = null;  // rota sendo desenhada: { points: [[x,y]...] }
  var hover = null;      // posição do mouse em mundo { x, y }
  var spaceDown = false;
  var history = {};      // mapId -> { u: [json...], r: [json...] }
  var drawQueued = false;
  var dpr = 1;
  var textEdit = null;   // { id | null, x, y, layer }
  var lastClick = { t: 0, x: 0, y: 0 };
  var needsFit = true;

  function activeMap() {
    if (!levels.maps.length) return null;
    var m = levels.maps.filter(function (mm) { return mm.id === levels.activeId; })[0];
    if (!m) { m = levels.maps[0]; levels.activeId = m.id; }
    return m;
  }
  function newMap(name) {
    var m = GDC.createEmptyLevelMap(name);
    if (document.documentElement.classList.contains('dark')) m.style = 'sketch-dark';
    return m;
  }
  function ensureMap() {
    if (!levels.maps.length) {
      var m = newMap('Fase 1');
      levels.maps.push(m);
      levels.activeId = m.id;
    }
    return activeMap();
  }
  function hist(map) { return history[map.id] || (history[map.id] = { u: [], r: [] }); }
  function snapshot(map) { return JSON.stringify(map); }
  function restoreInto(map, json) {
    var src = GDC.normalizeLevelMap(JSON.parse(json));
    Object.keys(src).forEach(function (k) { map[k] = src[k]; });
    map.id = src.id;
  }
  function pushUndo(map, before) {
    var h = hist(map);
    h.u.push(before);
    if (h.u.length > 120) h.u.shift();
    h.r = [];
  }
  /** Envolve uma mutação: tira o snapshot antes, aplica, e só empilha no desfazer se mudou algo. */
  function mutate(fn) {
    var map = activeMap();
    if (!map) return;
    var before = snapshot(map);
    fn(map);
    if (snapshot(map) !== before) { pushUndo(map, before); changed(); }
  }
  function changed() {
    if (onChange) onChange();
    refreshPanels();
    requestDraw();
  }
  function undo() {
    var map = activeMap(); if (!map) return;
    var h = hist(map); if (!h.u.length) return;
    h.r.push(snapshot(map));
    restoreInto(map, h.u.pop());
    selectedId = null;
    changed();
  }
  function redo() {
    var map = activeMap(); if (!map) return;
    var h = hist(map); if (!h.r.length) return;
    h.u.push(snapshot(map));
    restoreInto(map, h.r.pop());
    selectedId = null;
    changed();
  }

  function toolLayer(tool) {
    if (tool === 'marker') return MARKERS[ui.markerKind[ui.stage] || 'start'].layer;
    if (tool === 'path') return 'flow';
    if (tool === 'pin') return 'review';
    if (tool === 'text') return ui.stage === 'review' ? 'review' : 'layout';
    if (tool === 'select' || tool === 'pan') return null;
    return 'layout';
  }
  function layerBlocked(map, layer) {
    if (!layer) return null;
    var l = map.layers[layer];
    if (!l.visible) return 'A camada "' + STAGE_BY_ID[layer].label + '" está oculta — mostre-a no painel Camadas pra editar.';
    if (l.locked) return 'A camada "' + STAGE_BY_ID[layer].label + '" está travada — destrave no painel Camadas pra editar.';
    return null;
  }

  // ---------- coordenadas ----------
  function toWorld(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / view.z + view.ox, y: (e.clientY - r.top) / view.z + view.oy, sx: e.clientX - r.left, sy: e.clientY - r.top };
  }
  function nearestEdge(p) {
    var cx = Math.floor(p.x), cy = Math.floor(p.y), fx = p.x - cx, fy = p.y - cy;
    var opts = [[fx, ek(cx, cy, 'v')], [1 - fx, ek(cx + 1, cy, 'v')], [fy, ek(cx, cy, 'h')], [1 - fy, ek(cx, cy + 1, 'h')]];
    opts.sort(function (a, b) { return a[0] - b[0]; });
    return opts[0][0] <= 0.35 ? opts[0][1] : null;
  }

  // ---------- hit test (ferramenta Selecionar) ----------
  function hitTest(map, p) {
    var tol = Math.max(0.25, 8 / view.z);
    var can = function (layer) { return map.layers[layer].visible && !map.layers[layer].locked; };
    if (can('review')) {
      for (var i = map.pins.length - 1; i >= 0; i--) {
        var pn = map.pins[i], r = Math.max(7, view.z * 0.3) / view.z;
        if (Math.hypot(p.x - pn.x, p.y - (pn.y - r * 1.55)) < r * 1.2 || Math.hypot(p.x - pn.x, p.y - pn.y + r * 0.5) < r * 0.7) return { type: 'pin', obj: pn };
      }
    }
    for (var j = map.markers.length - 1; j >= 0; j--) {
      var m = map.markers[j];
      if (!can(MARKERS[m.kind].layer)) continue;
      if (Math.abs(p.x - (m.x + 0.5)) < 0.48 && Math.abs(p.y - (m.y + 0.5)) < 0.48) return { type: 'marker', obj: m };
    }
    var lbl = hitLabel(map, p);
    if (lbl) return { type: 'label', obj: lbl };
    var pr = hitProp(map, p);
    if (pr) return { type: 'prop', obj: pr };
    if (can('flow')) {
      for (var k = map.paths.length - 1; k >= 0; k--) {
        var pa = map.paths[k];
        for (var s = 1; s < pa.points.length; s++) {
          if (distToSeg(p.x, p.y, pa.points[s - 1][0], pa.points[s - 1][1], pa.points[s][0], pa.points[s][1]) < tol) return { type: 'path', obj: pa };
        }
      }
    }
    return null;
  }
  function hitProp(map, p) {
    if (!map.layers.layout.visible || map.layers.layout.locked) return null;
    for (var i = (map.props || []).length - 1; i >= 0; i--) {
      var pr = map.props[i];
      if (Math.abs(p.x - pr.x) < pr.s / 2 + 0.05 && Math.abs(p.y - pr.y) < pr.s / 2 + 0.05) return pr;
    }
    return null;
  }
  function hitLabel(map, p) {
    for (var i = map.labels.length - 1; i >= 0; i--) {
      var l = map.labels[i];
      var layer = map.layers[l.layer];
      if (!layer.visible || layer.locked) continue;
      ctx.font = labelFont(l, view.z);
      var w = ctx.measureText(l.text).width / view.z, h = 0.6 * l.size;
      if (Math.abs(p.x - l.x) < w / 2 + 0.15 && Math.abs(p.y - l.y) < h / 2 + 0.1) return l;
    }
    return null;
  }
  function findById(map, id) {
    var lists = [['marker', map.markers], ['path', map.paths], ['label', map.labels], ['pin', map.pins], ['prop', map.props || []]];
    for (var i = 0; i < lists.length; i++) {
      var o = lists[i][1].filter(function (x) { return x.id === id; })[0];
      if (o) return { type: lists[i][0], obj: o };
    }
    return null;
  }
  function deleteById(map, id) {
    map.markers = map.markers.filter(function (x) { return x.id !== id; });
    map.paths = map.paths.filter(function (x) { return x.id !== id; });
    map.labels = map.labels.filter(function (x) { return x.id !== id; });
    map.pins = map.pins.filter(function (x) { return x.id !== id; });
    map.props = (map.props || []).filter(function (x) { return x.id !== id; });
  }

  // ---------- edição de piso ----------
  function paintCells(map, x0, y0, x1, y1, type) {
    var ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    if ((bx - ax + 1) * (by - ay + 1) > 20000) return;
    for (var x = ax; x <= bx; x++) for (var y = ay; y <= by; y++) {
      if (type) map.cells[ck(x, y)] = type; else delete map.cells[ck(x, y)];
    }
    if (!type) pruneEdges(map);
  }
  function brushAt(map, p, erase) {
    var n = ui.brushSize, cx = Math.floor(p.x), cy = Math.floor(p.y), off = Math.floor((n - 1) / 2);
    paintCells(map, cx - off, cy - off, cx - off + n - 1, cy - off + n - 1, erase ? null : ui.floorType);
  }
  /** Remove paredes internas/portas que ficaram sem piso dos dois lados (sobra de borracha). */
  function pruneEdges(map) {
    [map.walls, map.doors].forEach(function (dict) {
      Object.keys(dict).forEach(function (k) {
        var e = parseEk(k), cs = edgeCells(e[0], e[1], e[2]);
        if (!map.cells[ck(cs[0][0], cs[0][1])] && !map.cells[ck(cs[1][0], cs[1][1])]) delete dict[k];
      });
    });
  }
  function wallEdgesBetween(a, b) {
    var out = [];
    if (Math.abs(b.vx - a.vx) >= Math.abs(b.vy - a.vy)) {
      for (var x = Math.min(a.vx, b.vx); x < Math.max(a.vx, b.vx); x++) out.push(ek(x, a.vy, 'h'));
    } else {
      for (var y = Math.min(a.vy, b.vy); y < Math.max(a.vy, b.vy); y++) out.push(ek(a.vx, y, 'v'));
    }
    return out;
  }

  // ---------- desenho na tela ----------
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    global.requestAnimationFrame(function () { drawQueued = false; render(); });
  }
  function resizeCanvas() {
    if (!canvas || !wrapEl) return;
    var r = wrapEl.getBoundingClientRect();
    dpr = global.devicePixelRatio || 1;
    var w = Math.max(50, Math.floor(r.width)), h = Math.max(50, Math.floor(r.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (needsFit && r.width >= 60) fitView();
    requestDraw();
  }
  function render() {
    if (!canvas || !ctx) return;
    var map = activeMap();
    var W = canvas.width / dpr, H = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!map) { ctx.clearRect(0, 0, W, H); return; }
    drawMap(ctx, map, { ox: view.ox, oy: view.oy, z: view.z, W: W, H: H }, {
      showGrid: ui.showGrid,
      focusLayer: ui.focus ? ui.stage : null,
      selectedId: selectedId,
      overlay: drawOverlay,
    });
    var hasContent = !!contentBounds(map);
    if (emptyEl) emptyEl.style.display = hasContent ? 'none' : '';
  }
  function drawOverlay(c, sx, sy, z, S) {
    var map = activeMap();
    c.save();
    if (drag && (drag.kind === 'rect')) {
      var ax = Math.min(drag.c0[0], drag.c1[0]), ay = Math.min(drag.c0[1], drag.c1[1]);
      var bx = Math.max(drag.c0[0], drag.c1[0]) + 1, by = Math.max(drag.c0[1], drag.c1[1]) + 1;
      c.fillStyle = drag.erase ? 'rgba(220,38,38,0.18)' : 'rgba(59,130,246,0.18)';
      c.strokeStyle = drag.erase ? '#dc2626' : SEL_COLOR;
      c.lineWidth = 2;
      c.fillRect(sx(ax), sy(ay), (bx - ax) * z, (by - ay) * z);
      c.strokeRect(sx(ax), sy(ay), (bx - ax) * z, (by - ay) * z);
      c.font = 'bold 12px system-ui, sans-serif';
      c.fillStyle = drag.erase ? '#dc2626' : SEL_COLOR;
      c.fillText((bx - ax) + '×' + (by - ay), sx(bx) + 6, sy(by) + 14);
    }
    if (drag && drag.kind === 'wall' && drag.b) {
      c.strokeStyle = drag.erase ? '#dc2626' : SEL_COLOR;
      c.lineWidth = Math.max(3, z * 0.14);
      c.lineCap = 'round';
      c.beginPath();
      wallEdgesBetween(drag.a, drag.b).forEach(function (k) {
        var e = parseEk(k);
        c.moveTo(sx(e[0]), sy(e[1]));
        if (e[2] === 'h') c.lineTo(sx(e[0] + 1), sy(e[1])); else c.lineTo(sx(e[0]), sy(e[1] + 1));
      });
      c.stroke();
    }
    if (pathDraft) {
      c.strokeStyle = S.path[ui.pathKind];
      c.lineWidth = Math.max(2, z * 0.08);
      c.setLineDash([6, 4]);
      c.beginPath();
      pathDraft.points.forEach(function (pt, i) { if (i) c.lineTo(sx(pt[0]), sy(pt[1])); else c.moveTo(sx(pt[0]), sy(pt[1])); });
      if (hover) { var hp = snapPath(hover); c.lineTo(sx(hp[0]), sy(hp[1])); }
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = S.path[ui.pathKind];
      pathDraft.points.forEach(function (pt) { c.beginPath(); c.arc(sx(pt[0]), sy(pt[1]), 3.5, 0, Math.PI * 2); c.fill(); });
    }
    if (hover && !drag && map) {
      var tool = currentTool();
      if (tool === 'room' || tool === 'brush' || tool === 'erase' || tool === 'marker') {
        var n = (tool === 'brush' || tool === 'erase') ? ui.brushSize : 1, off = Math.floor((n - 1) / 2);
        var hx = Math.floor(hover.x) - off, hy = Math.floor(hover.y) - off;
        c.strokeStyle = tool === 'erase' ? '#dc2626' : SEL_COLOR;
        c.lineWidth = 1.5;
        c.strokeRect(sx(hx), sy(hy), n * z, n * z);
      } else if (tool === 'door') {
        var e = nearestEdge(hover);
        if (e) {
          var pe = parseEk(e);
          c.strokeStyle = SEL_COLOR;
          c.lineWidth = Math.max(4, z * 0.2);
          c.globalAlpha = 0.6;
          c.beginPath();
          c.moveTo(sx(pe[0]), sy(pe[1]));
          if (pe[2] === 'h') c.lineTo(sx(pe[0] + 1), sy(pe[1])); else c.lineTo(sx(pe[0]), sy(pe[1] + 1));
          c.stroke();
        }
      } else if (tool === 'wall') {
        c.fillStyle = SEL_COLOR;
        c.beginPath(); c.arc(sx(Math.round(hover.x)), sy(Math.round(hover.y)), 4, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
  }

  function currentTool() { return spaceDown ? 'pan' : ui.tool; }
  function snapPath(p) { return [Math.floor(p.x) + 0.5, Math.floor(p.y) + 0.5]; }

  // ---------- eventos do canvas ----------
  function onPointerDown(e) {
    var map = ensureMap();
    if (textEdit) commitTextEdit();
    var p = toWorld(e);
    var tool = currentTool();
    var right = e.button === 2;
    if (e.button === 1 || tool === 'pan') {
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
      canvas.setPointerCapture(e.pointerId);
      setCursor();
      return;
    }
    var now = Date.now();
    var isDbl = now - lastClick.t < 350 && Math.abs(e.clientX - lastClick.x) < 6 && Math.abs(e.clientY - lastClick.y) < 6;
    lastClick = { t: now, x: e.clientX, y: e.clientY };

    if (tool === 'select') {
      var hit = hitTest(map, p);
      if (hit && isDbl && hit.type === 'label') { startTextEdit(hit.obj); return; }
      selectedId = hit ? hit.obj.id : null;
      refreshPanels();
      if (hit) {
        drag = { kind: 'move', hit: hit, start: p, before: snapshot(map), orig: JSON.parse(JSON.stringify(hit.obj)), moved: false };
        canvas.setPointerCapture(e.pointerId);
      }
      requestDraw();
      return;
    }
    var blocked = layerBlocked(map, toolLayer(tool));
    if (blocked) { flashHint(blocked); return; }

    if (tool === 'room') {
      drag = { kind: 'rect', c0: [Math.floor(p.x), Math.floor(p.y)], c1: [Math.floor(p.x), Math.floor(p.y)], erase: right };
    } else if (tool === 'brush' || tool === 'erase') {
      drag = { kind: 'brush', erase: right || tool === 'erase', before: snapshot(map) };
      brushAt(map, p, drag.erase);
      if (onChange) onChange();
    } else if (tool === 'wall') {
      drag = { kind: 'wall', a: { vx: Math.round(p.x), vy: Math.round(p.y) }, b: null, erase: right };
    } else if (tool === 'door') {
      var edge = nearestEdge(p);
      if (edge) {
        mutate(function (m) {
          if (right || m.doors[edge] === ui.doorType) delete m.doors[edge];
          else m.doors[edge] = ui.doorType;
        });
      }
      return;
    } else if (tool === 'prop') {
      if (right) { var hp = hitProp(map, p); if (hp) mutate(function (m) { deleteById(m, hp.id); }); return; }
      if (ui.prop === 'image' && !ui.propImage) { flashHint('Envie uma imagem PNG primeiro (botão de imagem nas opções do carimbo).'); return; }
      // escala ímpar encaixa no centro da célula; par, na linha da grade — assim 1×1 e 2×2 alinham à grade
      var odd = Math.round(ui.propSize) % 2 === 1 || ui.propSize < 1;
      var snap = function (v) { return ui.propSize < 1 ? Math.round(v * 2) / 2 : (odd ? Math.floor(v) + 0.5 : Math.round(v)); };
      var np2 = { id: GDC.makeId('pr'), k: ui.prop, x: snap(p.x), y: snap(p.y), s: ui.propSize, r: ui.propRot, label: '', imageId: ui.prop === 'image' ? ui.propImage : null };
      mutate(function (m) { if (!m.props) m.props = []; m.props.push(np2); selectedId = np2.id; });
      return;
    } else if (tool === 'marker') {
      var cx = Math.floor(p.x), cy = Math.floor(p.y);
      var kind = ui.markerKind[ui.stage] || 'start';
      var layer = MARKERS[kind].layer;
      mutate(function (m) {
        var existing = m.markers.filter(function (mk) { return mk.x === cx && mk.y === cy && MARKERS[mk.kind].layer === layer; })[0];
        if (right) { if (existing) m.markers = m.markers.filter(function (mk) { return mk !== existing; }); return; }
        if (existing) { existing.kind = kind; selectedId = existing.id; return; }
        // entrada única: mover a existente em vez de criar outra
        if (kind === 'start') {
          var st = m.markers.filter(function (mk) { return mk.kind === 'start'; })[0];
          if (st) { st.x = cx; st.y = cy; selectedId = st.id; return; }
        }
        var nm = { id: GDC.makeId('mk'), kind: kind, x: cx, y: cy, label: '', note: '' };
        m.markers.push(nm);
        selectedId = nm.id;
      });
      return;
    } else if (tool === 'path') {
      if (right) {
        if (pathDraft) finishPath();
        else {
          var ph = hitTest(map, p);
          if (ph && ph.type === 'path') mutate(function (m) { deleteById(m, ph.obj.id); });
        }
        return;
      }
      var sp = snapPath(p);
      if (!pathDraft) pathDraft = { points: [sp] };
      else {
        var last = pathDraft.points[pathDraft.points.length - 1];
        if (isDbl || (last[0] === sp[0] && last[1] === sp[1])) { finishPath(); return; }
        pathDraft.points.push(sp);
      }
      requestDraw();
      return;
    } else if (tool === 'text') {
      if (right) {
        var lh = hitLabel(map, p);
        if (lh) mutate(function (m) { deleteById(m, lh.id); });
        return;
      }
      var existingLabel = hitLabel(map, p);
      if (existingLabel) startTextEdit(existingLabel);
      else startTextEdit(null, Math.round(p.x * 2) / 2, Math.round(p.y * 2) / 2);
      return;
    } else if (tool === 'pin') {
      if (right) {
        var pnh = hitTest(map, p);
        if (pnh && pnh.type === 'pin') mutate(function (m) { deleteById(m, pnh.obj.id); });
        return;
      }
      mutate(function (m) {
        var np = { id: GDC.makeId('pn'), x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2, note: '', done: false };
        m.pins.push(np);
        selectedId = np.id;
      });
      ensurePanelOpen();
      var ta = root.querySelector('[data-lp-prop="note"]');
      if (ta) ta.focus();
      return;
    }
    if (drag) canvas.setPointerCapture(e.pointerId);
    requestDraw();
  }

  function onPointerMove(e) {
    var p = toWorld(e);
    hover = p;
    var map = activeMap();
    if (!drag) { requestDraw(); return; }
    if (drag.kind === 'pan') {
      view.ox = drag.ox - (e.clientX - drag.sx) / view.z;
      view.oy = drag.oy - (e.clientY - drag.sy) / view.z;
    } else if (drag.kind === 'rect') {
      drag.c1 = [Math.floor(p.x), Math.floor(p.y)];
    } else if (drag.kind === 'brush') {
      brushAt(map, p, drag.erase);
    } else if (drag.kind === 'wall') {
      drag.b = { vx: Math.round(p.x), vy: Math.round(p.y) };
    } else if (drag.kind === 'move') {
      var dx = p.x - drag.start.x, dy = p.y - drag.start.y, o = drag.hit.obj, orig = drag.orig;
      if (drag.hit.type === 'marker') { o.x = orig.x + Math.round(dx); o.y = orig.y + Math.round(dy); }
      else if (drag.hit.type === 'path') {
        var rdx = Math.round(dx), rdy = Math.round(dy);
        o.points = orig.points.map(function (pt) { return [pt[0] + rdx, pt[1] + rdy]; });
      } else { o.x = Math.round((orig.x + dx) * 2) / 2; o.y = Math.round((orig.y + dy) * 2) / 2; }
      drag.moved = true;
    }
    requestDraw();
  }

  function onPointerUp(e) {
    if (!drag) return;
    var map = activeMap();
    var d = drag;
    drag = null;
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* já liberado */ }
    if (d.kind === 'rect') {
      mutate(function (m) { paintCells(m, d.c0[0], d.c0[1], d.c1[0], d.c1[1], d.erase ? null : ui.floorType); });
    } else if (d.kind === 'brush') {
      if (snapshot(map) !== d.before) { pushUndo(map, d.before); changed(); }
    } else if (d.kind === 'wall') {
      if (d.b) {
        mutate(function (m) {
          wallEdgesBetween(d.a, d.b).forEach(function (k) {
            if (d.erase) { delete m.walls[k]; delete m.doors[k]; } else m.walls[k] = 1;
          });
        });
      }
    } else if (d.kind === 'move') {
      if (d.moved && snapshot(map) !== d.before) { pushUndo(map, d.before); changed(); }
    }
    setCursor();
    requestDraw();
  }

  function finishPath() {
    if (!pathDraft) return;
    var pts = pathDraft.points;
    pathDraft = null;
    if (pts.length >= 2) {
      mutate(function (m) {
        var np = { id: GDC.makeId('pt'), kind: ui.pathKind, label: '', points: pts };
        m.paths.push(np);
        selectedId = np.id;
      });
    }
    requestDraw();
  }

  function onWheel(e) {
    e.preventDefault();
    var r = canvas.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    var factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    zoomAt(mx, my, view.z * factor);
  }
  function zoomAt(mx, my, nz) {
    nz = clamp(nz, Z_MIN, Z_MAX);
    var wx = mx / view.z + view.ox, wy = my / view.z + view.oy;
    view.z = nz;
    view.ox = wx - mx / nz;
    view.oy = wy - my / nz;
    updateZoomLabel();
    requestDraw();
  }
  function zoomBy(f) { zoomAt(canvas.width / dpr / 2, canvas.height / dpr / 2, view.z * f); }
  function fitView() {
    var map = activeMap();
    var b = map && contentBounds(map);
    var W = canvas.width / dpr, H = canvas.height / dpr;
    // Aba ainda oculta (display:none → canvas sem tamanho real): adia o ajuste pro primeiro
    // redimensionamento de verdade, senão o zoom seria calculado pra uma tela de ~50px.
    if (!wrapEl || wrapEl.getBoundingClientRect().width < 60) { needsFit = true; return; }
    needsFit = false;
    if (!b) { view.z = 32; view.ox = -2; view.oy = -2; updateZoomLabel(); requestDraw(); return; }
    var pad = 2;
    var z = Math.min(W / (b.x1 - b.x0 + pad * 2), H / (b.y1 - b.y0 + pad * 2));
    view.z = clamp(z, Z_MIN, 64);
    view.ox = (b.x0 + b.x1) / 2 - W / view.z / 2;
    view.oy = (b.y0 + b.y1) / 2 - H / view.z / 2;
    updateZoomLabel();
    requestDraw();
  }
  function updateZoomLabel() {
    var el = root.querySelector('#lp-zoom-label');
    if (el) el.textContent = Math.round(view.z / 32 * 100) + '%';
  }
  function setCursor() {
    if (!canvas) return;
    var t = currentTool();
    canvas.style.cursor = (drag && drag.kind === 'pan') ? 'grabbing' : t === 'pan' ? 'grab' : t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
  }

  // ---------- texto inline ----------
  function startTextEdit(label, x, y) {
    var map = activeMap();
    textEdit = label ? { id: label.id, x: label.x, y: label.y, layer: label.layer } : { id: null, x: x, y: y, layer: ui.stage === 'review' ? 'review' : 'layout' };
    textInput.value = label ? label.text : '';
    textInput.style.display = '';
    textInput.style.left = ((textEdit.x - view.ox) * view.z) + 'px';
    textInput.style.top = ((textEdit.y - view.oy) * view.z) + 'px';
    textInput.style.fontSize = Math.max(12, Math.min(28, view.z * 0.55 * (label ? label.size : ui.labelSize))) + 'px';
    selectedId = label ? label.id : null;
    setTimeout(function () { textInput.focus(); textInput.select(); }, 0);
    if (map) requestDraw();
  }
  function commitTextEdit() {
    if (!textEdit) return;
    var te = textEdit;
    textEdit = null;
    var txt = textInput.value.trim().slice(0, 80);
    textInput.style.display = 'none';
    mutate(function (m) {
      if (te.id) {
        var l = m.labels.filter(function (x) { return x.id === te.id; })[0];
        if (!l) return;
        if (!txt) deleteById(m, te.id); else l.text = txt;
      } else if (txt) {
        var nl = { id: GDC.makeId('lb'), text: txt, x: te.x, y: te.y, size: ui.labelSize, layer: te.layer };
        m.labels.push(nl);
        selectedId = nl.id;
      }
    });
    requestDraw();
  }
  function cancelTextEdit() { textEdit = null; textInput.style.display = 'none'; requestDraw(); }

  // ---------- teclado ----------
  function isTypingTarget(t) { return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); }
  function isActiveTab() { return root && root.offsetParent !== null; }
  function onKeyDown(e) {
    if (!isActiveTab() || isTypingTarget(e.target)) return;
    var k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') { if (!spaceDown) { spaceDown = true; setCursor(); } e.preventDefault(); return; }
    if (e.key === 'Escape') {
      // consome o Esc só quando havia algo a cancelar — senão ele chega na tela cheia e sai dela
      if (pathDraft) { e.preventDefault(); pathDraft = null; requestDraw(); return; }
      if (selectedId) { e.preventDefault(); selectedId = null; refreshPanels(); requestDraw(); return; }
      return;
    }
    if (e.key === 'Enter' && pathDraft) { finishPath(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault();
      var id = selectedId;
      selectedId = null;
      mutate(function (m) { deleteById(m, id); });
      return;
    }
    if (k === '+' || k === '=') { zoomBy(1.2); return; }
    if (k === '-') { zoomBy(1 / 1.2); return; }
    if (k === 'f') { fitView(); return; }
    if (k === 'g') { ui.showGrid = !ui.showGrid; renderTopbar(); requestDraw(); return; }
    if (/^[1-4]$/.test(k)) { setStage(STAGES[Number(k) - 1].id); return; }
    for (var name in TOOLS) {
      if (TOOLS[name].key === k && toolAvailable(name)) { setTool(name); return; }
    }
  }
  function onKeyUp(e) {
    if (e.key !== ' ') return;
    spaceDown = false;
    setCursor();
    // Espaço com um botão da barra em foco também "clicaria" nele ao soltar — aqui é só o pan.
    if (isActiveTab() && !isTypingTarget(e.target)) e.preventDefault();
  }

  // ---------- etapas / ferramentas ----------
  function toolAvailable(name) { var s = TOOLS[name].stages; return !s || s.indexOf(ui.stage) !== -1; }
  function setStage(id) {
    ui.stage = id;
    if (!toolAvailable(ui.tool) || ui.tool === 'select' || ui.tool === 'pan') ui.tool = STAGE_DEFAULT_TOOL[id];
    pathDraft = null;
    renderTopbar();
    renderRail();
    renderOptbar();
    requestDraw();
  }
  function setTool(name) {
    if (pathDraft && name !== 'path') pathDraft = null;
    ui.tool = name;
    renderRail();
    renderOptbar();
    setCursor();
    requestDraw();
  }
  var hintTimer = null;
  function flashHint(msg) {
    if (!hintEl) return;
    hintEl.textContent = msg;
    hintEl.classList.add('lp-hint-warn');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hintEl.classList.remove('lp-hint-warn'); renderHint(); }, 3200);
  }
  function renderHint() { if (hintEl && !hintEl.classList.contains('lp-hint-warn')) hintEl.textContent = TOOLS[ui.tool].hint; }

  // ---------- markup ----------
  function shellMarkup() {
    return (
      '<div class="lp-plan">' +
      '  <div class="lp-stage wp-stage" id="lp-stage">' +
      '    <div class="lp-topbar wp-stage-bar" id="lp-topbar"></div>' +
      '    <div class="lp-body">' +
      '      <div class="lp-rail" id="lp-rail"></div>' +
      '      <div class="lp-canvas-col">' +
      '        <div class="lp-optbar" id="lp-optbar"></div>' +
      '        <div class="lp-canvas-wrap" id="lp-canvas-wrap">' +
      '          <canvas id="lp-canvas"></canvas>' +
      '          <input type="text" class="lp-text-input" id="lp-text-input" maxlength="80" style="display:none" />' +
      '          <div class="lp-empty" id="lp-empty" style="display:none">' +
      '            <div class="lp-empty-card">' +
      '              <p class="font-semibold text-primary text-sm">Comece pelo layout</p>' +
      '              <p class="text-xs text-secondary mt-1">Desenhe salas com <kbd>R</kbd> e corredores com o pincel <kbd>B</kbd> — as paredes aparecem sozinhas no contorno do piso.</p>' +
      '              <button type="button" class="btn-ghost py-1.5 text-xs mt-3" data-lp-action="example">' + GDC.icon('sparkles', { size: 13, className: 'text-amber-400' }) + 'Carregar um mapa de exemplo</button>' +
      '            </div>' +
      '          </div>' +
      '          <div class="lp-hint" id="lp-hint"></div>' +
      '        </div>' +
      '      </div>' +
      '      <aside class="lp-panel" id="lp-panel">' +
      '        <div class="lp-sec" id="lp-sec-maps"></div>' +
      '        <div class="lp-sec" id="lp-sec-layers"></div>' +
      '        <div class="lp-sec" id="lp-sec-sel"></div>' +
      '        <div class="lp-sec" id="lp-sec-check"></div>' +
      '        <div class="lp-sec" id="lp-sec-notes"></div>' +
      '      </aside>' +
      '    </div>' +
      '  </div>' +
      '  <div class="tab-help-note">' + GDC.icon('info', { size: 16 }) +
      '    <p><strong>Como funciona:</strong> siga as 4 etapas no topo — cada uma mostra só as ferramentas daquela fase e é também uma camada que dá pra ocultar ou travar. Pinte o piso (salas e corredores) e as paredes externas saem sozinhas; paredes internas e portas ficam nas linhas da grade. A checagem no painel avisa se o objetivo é alcançável a partir da entrada, se há áreas isoladas, porta trancada sem chave etc. Atalhos: <kbd>1</kbd>–<kbd>4</kbd> etapas, letras das ferramentas (passe o mouse nos botões), <kbd>Espaço</kbd>+arrastar move a vista, <kbd>F</kbd> ajusta à tela, <kbd>G</kbd> grade, <kbd>Ctrl+Z</kbd>/<kbd>Ctrl+Y</kbd>.</p>' +
      '  </div>' +
      '</div>'
    );
  }

  function renderTopbar() {
    var el = root.querySelector('#lp-topbar');
    var map = activeMap();
    var style = map ? map.style : 'sketch';
    el.innerHTML =
      '<div class="lp-stages">' +
      STAGES.map(function (s) {
        return '<button type="button" class="lp-stage-btn' + (ui.stage === s.id ? ' lp-stage-btn-active' : '') + '" data-lp-stage="' + s.id + '" title="' + escapeHtml(s.hint) + ' (' + s.n + ')">' +
          '<span class="lp-stage-num">' + s.n + '</span>' + escapeHtml(s.label) + '</button>';
      }).join('') +
      '</div>' +
      '<p class="lp-stage-hint">' + escapeHtml(STAGE_BY_ID[ui.stage].hint) + '</p>' +
      '<div class="lp-topbar-actions">' +
      '  <button type="button" class="wp-icon-btn" data-lp-action="undo" title="Desfazer (Ctrl+Z)">' + GDC.icon('undo-2', { size: 15 }) + '</button>' +
      '  <button type="button" class="wp-icon-btn" data-lp-action="redo" title="Refazer (Ctrl+Y)">' + GDC.icon('redo-2', { size: 15 }) + '</button>' +
      '  <span class="wp-bar-sep"></span>' +
      '  <button type="button" class="wp-icon-btn" data-lp-action="zoom-out" title="Diminuir zoom (-)">' + GDC.icon('zoom-out', { size: 15 }) + '</button>' +
      '  <span class="lp-zoom-label" id="lp-zoom-label">' + Math.round(view.z / 32 * 100) + '%</span>' +
      '  <button type="button" class="wp-icon-btn" data-lp-action="zoom-in" title="Aumentar zoom (+)">' + GDC.icon('zoom-in', { size: 15 }) + '</button>' +
      '  <button type="button" class="wp-icon-btn" data-lp-action="fit" title="Ajustar à tela (F)">' + GDC.icon('scan', { size: 15 }) + '</button>' +
      '  <span class="wp-bar-sep"></span>' +
      '  <button type="button" class="wp-icon-btn' + (ui.showGrid ? ' wp-btn-on' : '') + '" data-lp-action="grid" title="Grade de fundo (G)">' + GDC.icon('layout-grid', { size: 15 }) + '</button>' +
      '  <button type="button" class="wp-icon-btn' + (ui.focus ? ' wp-btn-on' : '') + '" data-lp-action="focus" title="Destacar a etapa atual (esmaece as outras camadas)">' + GDC.icon('target', { size: 15 }) + '</button>' +
      '  <select class="input-field lp-style-select" data-lp-action="style" title="Estilo visual do mapa">' +
      Object.keys(STYLES).map(function (k) { return '<option value="' + k + '"' + (k === style ? ' selected' : '') + '>' + STYLES[k].label + '</option>'; }).join('') +
      '  </select>' +
      '  <span class="wp-bar-sep"></span>' +
      '  <button type="button" class="wp-icon-btn" data-lp-action="export" title="Exportar PNG">' + GDC.icon('download', { size: 15 }) + '</button>' +
      '  ' + GDC.fullscreen.buttonMarkup('wp-icon-btn', !!(stageEl && GDC.fullscreen.isActive(stageEl)), 'data-lp-action="fullscreen"') +
      '  <button type="button" class="wp-icon-btn' + (ui.panelOpen ? ' wp-btn-on' : '') + '" data-lp-action="panel" title="Painel lateral">' + GDC.icon('panel-right', { size: 15 }) + '</button>' +
      '</div>';
  }

  function renderRail() {
    var el = root.querySelector('#lp-rail');
    var stageTools = TOOL_ORDER.filter(function (t) { return TOOLS[t].stages && TOOLS[t].stages.indexOf(ui.stage) !== -1; });
    var btn = function (t) {
      return '<button type="button" class="lp-tool' + (ui.tool === t ? ' lp-tool-active' : '') + '" data-lp-tool="' + t + '" title="' + escapeHtml(TOOLS[t].label) + ' (' + TOOLS[t].key.toUpperCase() + ')">' + GDC.icon(TOOLS[t].icon, { size: 18 }) + '</button>';
    };
    el.innerHTML = btn('select') + btn('pan') + '<span class="lp-rail-sep"></span>' + stageTools.map(btn).join('');
    renderHint();
  }

  function chip(attr, val, active, inner, title) {
    return '<button type="button" class="lp-chip' + (active ? ' lp-chip-active' : '') + '" ' + attr + '="' + val + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + inner + '</button>';
  }
  function swatch(color, shape) {
    return '<span class="lp-swatch lp-swatch-' + (shape || 'square') + '" style="background:' + color + '"></span>';
  }
  function renderOptbar() {
    var map = activeMap();
    var S = STYLES[map ? map.style : 'sketch'];
    var t = ui.tool, h = '';
    if (t === 'room' || t === 'brush') {
      h += '<span class="lp-opt-label">Piso</span>' + FLOOR_TYPES.map(function (f) {
        return chip('data-lp-floor', f.id, ui.floorType === f.id, swatch(S.floor[f.id]) + escapeHtml(f.label));
      }).join('');
    }
    if (t === 'brush' || t === 'erase') {
      h += '<span class="lp-opt-label">Tamanho</span>' + [1, 2, 3, 5].map(function (n) { return chip('data-lp-brush', n, ui.brushSize === n, n + '×' + n); }).join('');
    }
    if (t === 'door') {
      h += '<span class="lp-opt-label">Tipo</span>' + DOOR_TYPES.map(function (d) { return chip('data-lp-door', d.id, ui.doorType === d.id, escapeHtml(d.label)); }).join('');
    }
    if (t === 'prop') {
      h += '<div class="lp-props">' + PROP_ORDER.map(function (k) {
        return '<button type="button" class="lp-prop-btn' + (ui.prop === k ? ' lp-prop-btn-on' : '') + '" data-lp-propk="' + k + '" title="' + escapeHtml(PROPS[k].label) + '"><img src="' + propIcon(k, S) + '" alt="" /></button>';
      }).join('') +
        '<label class="lp-prop-btn lp-prop-upload' + (ui.prop === 'image' ? ' lp-prop-btn-on' : '') + '" title="Usar uma imagem sua (PNG com fundo transparente, vista de cima)">' + GDC.icon('image', { size: 15 }) + '<input type="file" accept="image/*" class="hidden" data-lp-prop-upload /></label></div>';
      h += '<span class="lp-opt-label">Tamanho</span>' + PROP_SIZES.map(function (z) { return chip('data-lp-propsize', z[0], ui.propSize === z[0], z[1]); }).join('');
      h += '<span class="lp-opt-label">Giro</span>' + [0, 90, 180, 270].map(function (r) { return chip('data-lp-proprot', r, ui.propRot === r, r + '°'); }).join('');
    }
    if (t === 'marker') {
      var kinds = MARKER_ORDER.filter(function (k) { return MARKERS[k].layer === ui.stage; });
      var cur = ui.markerKind[ui.stage];
      h += kinds.map(function (k) {
        var d = MARKERS[k];
        return chip('data-lp-marker', k, cur === k, '<span class="lp-mk lp-mk-' + d.shape + '" style="background:' + d.color + '">' + escapeHtml(d.glyph) + '</span>' + escapeHtml(d.label));
      }).join('');
    }
    if (t === 'path') {
      h += PATH_KINDS.map(function (pk) {
        return chip('data-lp-pathkind', pk.id, ui.pathKind === pk.id, '<span class="lp-line lp-line-' + pk.id + '" style="color:' + S.path[pk.id] + '"></span>' + escapeHtml(pk.label));
      }).join('');
    }
    if (t === 'text') {
      h += '<span class="lp-opt-label">Tamanho</span>' + [[0.7, 'P'], [1, 'M'], [1.5, 'G'], [2, 'GG']].map(function (s) { return chip('data-lp-labelsize', s[0], ui.labelSize === s[0], s[1]); }).join('');
      h += '<span class="lp-opt-note">Na etapa 4 os textos saem em vermelho (anotação de revisão)</span>';
    }
    if (!h) h = '<span class="lp-opt-note">' + escapeHtml(TOOLS[t].label) + '</span>';
    optbarEl.innerHTML = h;
  }

  // ---------- painel lateral ----------
  function refreshPanels() {
    renderMapsSection();
    renderLayersSection();
    renderSelSection();
    renderCheckSection();
    renderNotesSection();
  }
  function secHead(title, icon, extra) {
    return '<div class="lp-sec-head">' + GDC.icon(icon, { size: 13 }) + '<span>' + title + '</span>' + (extra || '') + '</div>';
  }
  function renderMapsSection() {
    var el = root.querySelector('#lp-sec-maps');
    var map = activeMap();
    el.innerHTML = secHead('Mapas do projeto', 'map',
      '<button type="button" class="lp-mini-btn" data-lp-action="new-map" title="Novo mapa">' + GDC.icon('plus', { size: 13 }) + '</button>') +
      (map ? '<input type="text" class="input-field lp-name-input" data-lp-action="rename" maxlength="60" value="' + escapeHtml(map.name) + '" />' : '') +
      '<ul class="lp-map-list">' + levels.maps.map(function (m) {
        return '<li class="lp-map-item' + (map && m.id === map.id ? ' lp-map-item-active' : '') + '">' +
          '<button type="button" class="lp-map-open" data-lp-open-map="' + m.id + '"><span data-lp-map-name="' + m.id + '">' + escapeHtml(m.name) + '</span></button>' +
          '<button type="button" class="lp-mini-btn" data-lp-dup-map="' + m.id + '" title="Duplicar">' + GDC.icon('copy', { size: 12 }) + '</button>' +
          '<button type="button" class="lp-mini-btn" data-lp-del-map="' + m.id + '" title="Excluir">' + GDC.icon('trash-2', { size: 12 }) + '</button>' +
          '</li>';
      }).join('') + '</ul>';
  }
  function renderLayersSection() {
    var el = root.querySelector('#lp-sec-layers');
    var map = activeMap();
    if (!map) { el.innerHTML = ''; return; }
    var counts = {
      layout: Object.keys(map.cells).length + ' células',
      flow: (map.markers.filter(function (m) { return MARKERS[m.kind].layer === 'flow'; }).length + map.paths.length) + ' itens',
      gameplay: map.markers.filter(function (m) { return MARKERS[m.kind].layer === 'gameplay'; }).length + ' itens',
      review: (map.pins.length + map.labels.filter(function (l) { return l.layer === 'review'; }).length) + ' notas',
    };
    el.innerHTML = secHead('Camadas', 'layers') + STAGES.map(function (s) {
      var l = map.layers[s.id];
      return '<div class="lp-layer' + (ui.stage === s.id ? ' lp-layer-active' : '') + '">' +
        '<button type="button" class="lp-mini-btn" data-lp-layer-vis="' + s.id + '" title="' + (l.visible ? 'Ocultar' : 'Mostrar') + '">' + GDC.icon(l.visible ? 'eye' : 'eye-off', { size: 13 }) + '</button>' +
        '<button type="button" class="lp-mini-btn" data-lp-layer-lock="' + s.id + '" title="' + (l.locked ? 'Destravar' : 'Travar') + '">' + GDC.icon(l.locked ? 'lock' : 'unlock', { size: 13 }) + '</button>' +
        '<button type="button" class="lp-layer-name" data-lp-stage="' + s.id + '"><span class="lp-stage-num">' + s.n + '</span>' + escapeHtml(s.label) + '</button>' +
        '<span class="lp-layer-count">' + counts[s.id] + '</span>' +
        '</div>';
    }).join('');
  }
  function renderSelSection() {
    var el = root.querySelector('#lp-sec-sel');
    var map = activeMap();
    var found = map && selectedId ? findById(map, selectedId) : null;
    if (!found) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    var o = found.obj, h = '';
    if (found.type === 'marker') {
      var layer = MARKERS[o.kind].layer;
      h += secHead('Marcador selecionado', 'map-pin') +
        '<label class="lp-field">Tipo<select class="input-field" data-lp-prop="kind">' +
        MARKER_ORDER.filter(function (k) { return MARKERS[k].layer === layer; }).map(function (k) { return '<option value="' + k + '"' + (k === o.kind ? ' selected' : '') + '>' + escapeHtml(MARKERS[k].label) + '</option>'; }).join('') +
        '</select></label>' +
        '<label class="lp-field">Rótulo (aparece no mapa)<input type="text" class="input-field" maxlength="60" data-lp-prop="label" value="' + escapeHtml(o.label) + '" placeholder="ex.: Goblin arqueiro" /></label>' +
        '<label class="lp-field">Anotação<textarea class="input-field" rows="3" maxlength="1000" data-lp-prop="note" placeholder="Comportamento, intenção de design...">' + escapeHtml(o.note) + '</textarea></label>';
    } else if (found.type === 'path') {
      h += secHead('Rota selecionada', 'route') +
        '<label class="lp-field">Tipo<select class="input-field" data-lp-prop="kind">' +
        PATH_KINDS.map(function (pk) { return '<option value="' + pk.id + '"' + (pk.id === o.kind ? ' selected' : '') + '>' + escapeHtml(pk.label) + '</option>'; }).join('') +
        '</select></label>' +
        '<p class="text-xs text-muted">' + o.points.length + ' pontos · arraste pra mover a rota inteira</p>';
    } else if (found.type === 'label') {
      h += secHead('Texto selecionado', 'type') +
        '<label class="lp-field">Texto<input type="text" class="input-field" maxlength="80" data-lp-prop="text" value="' + escapeHtml(o.text) + '" /></label>' +
        '<label class="lp-field">Tamanho<select class="input-field" data-lp-prop="size">' +
        [[0.7, 'Pequeno'], [1, 'Médio'], [1.5, 'Grande'], [2, 'Muito grande']].map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === o.size ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') +
        '</select></label>';
    } else if (found.type === 'prop') {
      var opt = function (list, cur) { return list.map(function (x) { return '<option value="' + x[0] + '"' + (String(x[0]) === String(cur) ? ' selected' : '') + '>' + escapeHtml(x[1]) + '</option>'; }).join(''); };
      h += secHead('Carimbo selecionado', 'stamp') +
        (o.k !== 'image' ? '<label class="lp-field">Tipo<select class="input-field" data-lp-prop="k">' + opt(PROP_ORDER.map(function (k) { return [k, PROPS[k].label]; }), o.k) + '</select></label>' : '<p class="text-xs text-muted">Imagem própria</p>') +
        '<label class="lp-field">Tamanho (células)<select class="input-field" data-lp-prop="s">' + opt(PROP_SIZES.concat([[4, '4'], [6, '6']]).concat(PROP_SIZES.concat([[4], [6]]).some(function (z) { return z[0] === o.s; }) ? [] : [[o.s, String(o.s)]]), o.s) + '</select></label>' +
        '<label class="lp-field">Giro<select class="input-field" data-lp-prop="r">' + opt([0, 45, 90, 135, 180, 225, 270, 315].map(function (r) { return [r, r + '°']; }).concat([0, 45, 90, 135, 180, 225, 270, 315].indexOf(o.r) === -1 ? [[o.r, o.r + '°']] : []), o.r) + '</select></label>' +
        '<label class="lp-field">Rótulo (opcional)<input type="text" class="input-field" maxlength="60" data-lp-prop="label" value="' + escapeHtml(o.label || '') + '" placeholder="ex.: Gerador" /></label>' +
        '<p class="text-xs text-muted">Arraste pra mover · só visual (não entra na checagem de alcance — use um marcador de obstáculo se bloquear o caminho).</p>';
    } else if (found.type === 'pin') {
      var idx = map.pins.indexOf(o) + 1;
      h += secHead('Nota de revisão #' + idx, 'message-square') +
        '<label class="lp-field">O que revisar<textarea class="input-field" rows="4" maxlength="2000" data-lp-prop="note" placeholder="ex.: jogadores se perderam aqui no teste — adicionar ponto de referência">' + escapeHtml(o.note) + '</textarea></label>' +
        '<label class="lp-check"><input type="checkbox" data-lp-prop="done"' + (o.done ? ' checked' : '') + ' /> Resolvida</label>';
    }
    h += '<button type="button" class="btn-ghost py-1 text-xs mt-2" data-lp-action="delete-sel">' + GDC.icon('trash-2', { size: 12 }) + 'Excluir</button>';
    el.innerHTML = h;
  }
  function renderCheckSection() {
    var el = root.querySelector('#lp-sec-check');
    var map = activeMap();
    if (!map) { el.innerHTML = ''; return; }
    var a = analyze(map);
    var icons = { error: 'alert-circle', warn: 'alert-triangle', info: 'info', ok: 'check-circle' };
    el.innerHTML = secHead('Checagem do mapa', 'activity') +
      '<ul class="lp-issues">' + a.issues.map(function (it) {
        var attrs = it.focus ? ' data-lp-focus="' + it.focus + '"' : it.stage ? ' data-lp-stage="' + it.stage + '"' : '';
        return '<li class="lp-issue lp-issue-' + it.level + '"' + attrs + '>' + GDC.icon(icons[it.level], { size: 13 }) + '<span>' + escapeHtml(it.text) + '</span></li>';
      }).join('') + '</ul>' +
      (a.stats.length ? '<dl class="lp-stats">' + a.stats.map(function (s) { return '<dt>' + escapeHtml(s[0]) + '</dt><dd>' + escapeHtml(s[1]) + '</dd>'; }).join('') + '</dl>' : '');
  }
  function renderNotesSection() {
    var el = root.querySelector('#lp-sec-notes');
    var map = activeMap();
    if (!map) { el.innerHTML = ''; return; }
    if (el.querySelector('textarea') && document.activeElement === el.querySelector('textarea')) return;
    el.innerHTML = secHead('Notas do mapa', 'file-text') +
      '<textarea class="input-field" rows="4" maxlength="5000" data-lp-action="map-notes" placeholder="Intenção da fase, ritmo, o que o teste mostrou...">' + escapeHtml(map.notes) + '</textarea>';
  }
  function ensurePanelOpen() {
    if (ui.panelOpen) return;
    ui.panelOpen = true;
    stageEl.classList.remove('lp-panel-closed');
    renderTopbar();
    setTimeout(resizeCanvas, 0);
  }

  // ---------- ações ----------
  function switchMap(id) {
    levels.activeId = id;
    selectedId = null;
    pathDraft = null;
    if (onChange) onChange();
    renderTopbar();
    renderOptbar();
    refreshPanels();
    fitView();
  }
  function toggleFullscreen() { GDC.fullscreen.toggle(stageEl); }
  function exportPng() {
    var map = activeMap();
    var b = map && contentBounds(map);
    if (!b) { flashHint('O mapa está vazio — nada pra exportar ainda.'); return; }
    var pad = 1.5, z = 48;
    var cellsW = b.x1 - b.x0 + pad * 2, cellsH = b.y1 - b.y0 + pad * 2;
    var maxPx = 8000;
    z = Math.min(z, maxPx / cellsW, maxPx / cellsH);
    var W = Math.ceil(cellsW * z), H = Math.ceil(cellsH * z);
    var legendItems = legendFor(map);
    var legendH = legendItems.length ? Math.ceil(legendItems.length / 4) * 26 + 46 : 0;
    var c = document.createElement('canvas');
    c.width = W; c.height = H + legendH;
    var cx = c.getContext('2d');
    drawMap(cx, map, { ox: b.x0 - pad, oy: b.y0 - pad, z: z, W: W, H: H }, { showGrid: false, focusLayer: null, selectedId: null });
    if (legendH) drawLegend(cx, map, legendItems, 0, H, W, legendH);
    c.toBlob(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (map.name.trim() || 'mapa').replace(/[\\/:*?"<>|]+/g, '-') + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }, 'image/png');
  }
  function legendFor(map) {
    var items = [];
    MARKER_ORDER.forEach(function (k) {
      if (!map.layers[MARKERS[k].layer].visible) return;
      var n = map.markers.filter(function (m) { return m.kind === k; }).length;
      if (n) items.push({ type: 'marker', kind: k, label: MARKERS[k].label + (n > 1 ? ' ×' + n : '') });
    });
    if (map.layers.flow.visible) PATH_KINDS.forEach(function (pk) { if (map.paths.some(function (p) { return p.kind === pk.id; })) items.push({ type: 'path', kind: pk.id, label: pk.label }); });
    if (map.layers.layout.visible) DOOR_TYPES.forEach(function (d) {
      if (Object.keys(map.doors).some(function (k) { return map.doors[k] === d.id; })) items.push({ type: 'door', kind: d.id, label: d.label });
    });
    return items;
  }
  function drawLegend(c, map, items, x, y, W, H) {
    var S = STYLES[map.style] || STYLES.sketch;
    c.fillStyle = S.bg;
    c.fillRect(x, y, W, H);
    c.strokeStyle = S.floorGrid;
    c.beginPath(); c.moveTo(x + 16, y + 0.5); c.lineTo(x + W - 16, y + 0.5); c.stroke();
    c.fillStyle = S.text;
    c.font = 'bold 15px ' + LABEL_FONT;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    c.fillText(map.name, x + 16, y + 20);
    var colW = (W - 32) / 4;
    items.forEach(function (it, i) {
      var ix = x + 16 + (i % 4) * colW, iy = y + 46 + Math.floor(i / 4) * 26;
      var sxf = function (wx) { return ix + 10 + (wx - 0.5) * 20; }, syf = function (wy) { return iy + (wy - 0.5) * 20; };
      if (it.type === 'marker') drawMarker(c, S, { kind: it.kind, x: 0, y: 0, label: '' }, sxf, syf, 20, false);
      else if (it.type === 'path') drawPath(c, S, { kind: it.kind, points: [[0, 0.5], [1, 0.5]] }, sxf, syf, 20, false);
      else {
        c.fillStyle = S.floor.room; c.fillRect(ix, iy - 10, 20, 20);
        c.strokeStyle = S.wall; c.lineWidth = 2.5; c.beginPath(); c.moveTo(ix + 10, iy - 10); c.lineTo(ix + 10, iy + 10); c.stroke();
        drawDoor(c, S, { cells: {} }, [0.5, 0, 'v'], it.kind, sxf, syf, 20);
      }
      c.fillStyle = S.text;
      c.font = '13px system-ui, sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(it.label, ix + 30, iy);
    });
  }

  // ---------- delegação de eventos (ligados UMA vez no mount — o conteúdo dos painéis é recriado
  // a cada atualização, mas os listeners ficam no container, que nunca é recriado) ----------
  function bindStatic() {
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-lp-stage],[data-lp-tool],[data-lp-action],[data-lp-floor],[data-lp-brush],[data-lp-door],[data-lp-marker],[data-lp-pathkind],[data-lp-labelsize],[data-lp-propk],[data-lp-propsize],[data-lp-proprot],[data-lp-open-map],[data-lp-dup-map],[data-lp-del-map],[data-lp-layer-vis],[data-lp-layer-lock],[data-lp-focus]');
      if (!t || !root.contains(t)) return;
      if (t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return;
      var map = activeMap();
      if (t.hasAttribute('data-lp-focus')) {
        var f = map && findById(map, t.getAttribute('data-lp-focus'));
        if (f) {
          selectedId = f.obj.id;
          var fx = f.obj.x !== undefined ? f.obj.x + 0.5 : f.obj.points[0][0], fy = f.obj.y !== undefined ? f.obj.y + 0.5 : f.obj.points[0][1];
          view.ox = fx - canvas.width / dpr / view.z / 2;
          view.oy = fy - canvas.height / dpr / view.z / 2;
          refreshPanels();
          requestDraw();
        }
        return;
      }
      if (t.hasAttribute('data-lp-stage')) { setStage(t.getAttribute('data-lp-stage')); refreshPanels(); return; }
      if (t.hasAttribute('data-lp-tool')) { setTool(t.getAttribute('data-lp-tool')); return; }
      if (t.hasAttribute('data-lp-floor')) { ui.floorType = t.getAttribute('data-lp-floor'); renderOptbar(); return; }
      if (t.hasAttribute('data-lp-brush')) { ui.brushSize = Number(t.getAttribute('data-lp-brush')); renderOptbar(); return; }
      if (t.hasAttribute('data-lp-door')) { ui.doorType = t.getAttribute('data-lp-door'); renderOptbar(); return; }
      if (t.hasAttribute('data-lp-marker')) { ui.markerKind[ui.stage] = t.getAttribute('data-lp-marker'); renderOptbar(); return; }
      if (t.hasAttribute('data-lp-pathkind')) { ui.pathKind = t.getAttribute('data-lp-pathkind'); renderOptbar(); requestDraw(); return; }
      if (t.hasAttribute('data-lp-propk')) { ui.prop = t.getAttribute('data-lp-propk'); renderOptbar(); return; }
      if (t.hasAttribute('data-lp-propsize')) { ui.propSize = Number(t.getAttribute('data-lp-propsize')); renderOptbar(); return; }
      if (t.hasAttribute('data-lp-proprot')) { ui.propRot = Number(t.getAttribute('data-lp-proprot')); renderOptbar(); return; }
      if (t.hasAttribute('data-lp-labelsize')) { ui.labelSize = Number(t.getAttribute('data-lp-labelsize')); renderOptbar(); return; }
      if (t.hasAttribute('data-lp-open-map')) { switchMap(t.getAttribute('data-lp-open-map')); return; }
      if (t.hasAttribute('data-lp-dup-map')) {
        var src = levels.maps.filter(function (m) { return m.id === t.getAttribute('data-lp-dup-map'); })[0];
        if (!src) return;
        var copy = GDC.normalizeLevelMap(JSON.parse(JSON.stringify(src)));
        copy.id = GDC.makeId('map');
        copy.name = (src.name + ' (cópia)').slice(0, 60);
        levels.maps.push(copy);
        switchMap(copy.id);
        return;
      }
      if (t.hasAttribute('data-lp-del-map')) {
        var del = levels.maps.filter(function (m) { return m.id === t.getAttribute('data-lp-del-map'); })[0];
        if (!del || !global.confirm('Excluir o mapa "' + del.name + '"? Essa ação não pode ser desfeita.')) return;
        levels.maps = levels.maps.filter(function (m) { return m !== del; });
        delete history[del.id];
        ensureMap();
        switchMap(activeMap().id);
        return;
      }
      if (t.hasAttribute('data-lp-layer-vis') || t.hasAttribute('data-lp-layer-lock')) {
        if (!map) return;
        var lid = t.getAttribute('data-lp-layer-vis') || t.getAttribute('data-lp-layer-lock');
        if (t.hasAttribute('data-lp-layer-vis')) map.layers[lid].visible = !map.layers[lid].visible;
        else map.layers[lid].locked = !map.layers[lid].locked;
        var sel = selectedId && findById(map, selectedId);
        if (sel) selectedId = null;
        if (onChange) onChange();
        refreshPanels();
        requestDraw();
        return;
      }
      var action = t.getAttribute('data-lp-action');
      if (action === 'undo') undo();
      else if (action === 'redo') redo();
      else if (action === 'zoom-in') zoomBy(1.2);
      else if (action === 'zoom-out') zoomBy(1 / 1.2);
      else if (action === 'fit') fitView();
      else if (action === 'grid') { ui.showGrid = !ui.showGrid; renderTopbar(); requestDraw(); }
      else if (action === 'focus') { ui.focus = !ui.focus; renderTopbar(); requestDraw(); }
      else if (action === 'export') exportPng();
      else if (action === 'fullscreen') toggleFullscreen();
      else if (action === 'panel') {
        ui.panelOpen = !ui.panelOpen;
        stageEl.classList.toggle('lp-panel-closed', !ui.panelOpen);
        renderTopbar();
        setTimeout(resizeCanvas, 0);
      } else if (action === 'new-map') {
        var nm = newMap('Fase ' + (levels.maps.length + 1));
        levels.maps.push(nm);
        switchMap(nm.id);
        setStage('layout');
      } else if (action === 'example') {
        var cur = ensureMap();
        var ex = buildExampleMap(cur.name);
        mutate(function (m) {
          ['cells', 'walls', 'doors', 'markers', 'paths', 'labels', 'pins', 'props'].forEach(function (k) { m[k] = ex[k] || []; });
        });
        fitView();
      } else if (action === 'delete-sel' && selectedId) {
        var id = selectedId;
        selectedId = null;
        mutate(function (m) { deleteById(m, id); });
      }
    });

    root.addEventListener('input', function (e) {
      var t = e.target, map = activeMap();
      if (!map) return;
      if (t.getAttribute('data-lp-action') === 'rename') {
        map.name = t.value.slice(0, 60) || 'Fase';
        var span = root.querySelector('[data-lp-map-name="' + map.id + '"]');
        if (span) span.textContent = map.name;
        if (onChange) onChange();
        return;
      }
      if (t.getAttribute('data-lp-action') === 'map-notes') { map.notes = t.value.slice(0, 5000); if (onChange) onChange(); return; }
      var prop = t.getAttribute('data-lp-prop');
      if (!prop || !selectedId) return;
      var f = findById(map, selectedId);
      if (!f) return;
      // texto livre: edição ao vivo sem passar pelo desfazer (senão cada tecla vira um passo)
      if (prop === 'label' || prop === 'note' || prop === 'text') {
        var v = t.value;
        if (prop === 'text') { if (!v.trim()) return; f.obj.text = v.slice(0, 80); }
        else f.obj[prop] = v.slice(0, prop === 'label' ? 60 : 2000);
        if (onChange) onChange();
        requestDraw();
        if (prop === 'note' && f.type === 'pin') renderCheckSection();
      }
    });

    root.addEventListener('change', function (e) {
      var t = e.target, map = activeMap();
      if (t.getAttribute('data-lp-action') === 'style') {
        if (!map) return;
        mutate(function (m) { m.style = STYLES[t.value] ? t.value : 'sketch'; });
        renderOptbar();
        return;
      }
      if (t.hasAttribute('data-lp-prop-upload')) {
        var file = t.files && t.files[0]; t.value = '';
        if (!file || !GDC.imageStore) return;
        GDC.imageStore.put(file).then(function (meta) { ui.prop = 'image'; ui.propImage = meta.id; renderOptbar(); flashHint('Imagem pronta — clique no mapa pra carimbar.'); });
        return;
      }
      var prop = t.getAttribute('data-lp-prop');
      if (!prop || !selectedId || !map) return;
      var id = selectedId;
      if (prop === 'k' || prop === 's' || prop === 'r') {
        mutate(function (m) { var f = findById(m, id); if (!f || f.type !== 'prop') return; f.obj[prop] = prop === 'k' ? t.value : Number(t.value); });
        return;
      }
      if (prop === 'kind' || prop === 'size' || prop === 'done') {
        mutate(function (m) {
          var f = findById(m, id);
          if (!f) return;
          if (prop === 'done') f.obj.done = t.checked;
          else if (prop === 'size') f.obj.size = Number(t.value);
          else f.obj.kind = t.value;
        });
      }
    });

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', function () { hover = null; requestDraw(); });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('dblclick', function (e) {
      if (currentTool() === 'path' && pathDraft) { e.preventDefault(); finishPath(); }
    });
    textInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitTextEdit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelTextEdit(); }
      e.stopPropagation();
    });
    textInput.addEventListener('blur', function () { if (textEdit) commitTextEdit(); });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    global.addEventListener('blur', function () { spaceDown = false; });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resizeCanvas).observe(wrapEl);
    else global.addEventListener('resize', resizeCanvas);
  }

  function renderAll() {
    renderTopbar();
    renderRail();
    renderOptbar();
    refreshPanels();
    resizeCanvas();
    setCursor();
  }

  function mount(container, opts) {
    root = container;
    levels = opts.levels;
    onChange = opts.onChange;
    projectType = opts.projectType;
    root.innerHTML = shellMarkup();
    stageEl = root.querySelector('#lp-stage');
    canvas = root.querySelector('#lp-canvas');
    ctx = canvas.getContext('2d');
    wrapEl = root.querySelector('#lp-canvas-wrap');
    textInput = root.querySelector('#lp-text-input');
    hintEl = root.querySelector('#lp-hint');
    emptyEl = root.querySelector('#lp-empty');
    optbarEl = root.querySelector('#lp-optbar');
    ensureMap();
    bindStatic();
    stageEl.addEventListener('wpfullscreenchange', function () { renderTopbar(); setTimeout(resizeCanvas, 0); });
    renderAll();
    needsFit = true; // a aba começa oculta — o ResizeObserver ajusta a vista quando ela aparecer
    fitView();
  }

  function reset(newLevels) {
    levels = newLevels;
    history = {};
    selectedId = null;
    pathDraft = null;
    drag = null;
    ensureMap();
    renderAll();
    fitView();
  }

  GDC.ui.levelPlanner = { mount: mount, reset: reset };
  // Exposto pra testes / reuso (ex.: export a partir de outro lugar).
  GDC.levelPlanner = { analyze: analyze, buildExampleMap: buildExampleMap, contentBounds: contentBounds };
}(window));
