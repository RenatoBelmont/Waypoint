/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var W = 320, H = 440;

  var root, svgEl, viewportEl, edgesGroupEl, nodesGroupEl, legendEl, emptyEl;
  var onGotoEntry;
  var lastCodex = null;
  var nodes = [];
  var edges = [];
  var nodeIndex = {};
  var nodeEls = {};
  var edgeEls = [];
  var hiddenTypes = {};
  var visible = false;
  var running = false;
  var rafId = null;
  var draggingNode = null;
  var dragMoved = false;
  var view = { scale: 1, tx: 0, ty: 0 };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function svgNode(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

  function typesInGraph(codex) {
    var list = [];
    codex.types.forEach(function (t) {
      if (codex.entries.some(function (e) { return e.typeId === t.id; })) list.push(t);
    });
    return list;
  }

  // ---------- Simulação (força-dirigida simples: repulsão + molas + centralização) ----------

  function physicsStep() {
    var n = nodes.length;
    if (n === 0) return false;
    var REPULSION = 2600, SPRING_LEN = 90, SPRING_K = 0.02, CENTER_K = 0.006, DAMPING = 0.82, MAX_SPEED = 40;

    for (var i = 0; i < n; i++) {
      var a = nodes[i];
      var fx = 0, fy = 0;
      for (var j = 0; j < n; j++) {
        if (i === j) continue;
        var b = nodes[j];
        var dx = a.x - b.x, dy = a.y - b.y;
        var distSq = dx * dx + dy * dy || 0.01;
        var dist = Math.sqrt(distSq);
        var force = REPULSION / distSq;
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }
      fx += -a.x * CENTER_K;
      fy += -a.y * CENTER_K;
      a._fx = fx; a._fy = fy;
    }

    edges.forEach(function (edge) {
      var a = nodeIndex[edge.source], b = nodeIndex[edge.target];
      if (!a || !b) return;
      var dx = b.x - a.x, dy = b.y - a.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      var diff = (dist - SPRING_LEN) * SPRING_K;
      var fx = (dx / dist) * diff, fy = (dy / dist) * diff;
      a._fx += fx; a._fy += fy;
      b._fx -= fx; b._fy -= fy;
    });

    var totalSpeed = 0;
    nodes.forEach(function (node) {
      if (node === draggingNode) return;
      node.vx = (node.vx + (node._fx || 0)) * DAMPING;
      node.vy = (node.vy + (node._fy || 0)) * DAMPING;
      var speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > MAX_SPEED) { node.vx = (node.vx / speed) * MAX_SPEED; node.vy = (node.vy / speed) * MAX_SPEED; }
      node.x += node.vx * 0.05;
      node.y += node.vy * 0.05;
      totalSpeed += speed;
    });

    return (totalSpeed / n) > 0.6;
  }

  function tickPositions() {
    nodes.forEach(function (n) {
      var els = nodeEls[n.id];
      if (els) els.gEl.setAttribute('transform', 'translate(' + n.x.toFixed(1) + ',' + n.y.toFixed(1) + ')');
    });
    edgeEls.forEach(function (edge) {
      var a = nodeIndex[edge.source], b = nodeIndex[edge.target];
      if (!a || !b) return;
      edge.lineEl.setAttribute('x1', a.x.toFixed(1));
      edge.lineEl.setAttribute('y1', a.y.toFixed(1));
      edge.lineEl.setAttribute('x2', b.x.toFixed(1));
      edge.lineEl.setAttribute('y2', b.y.toFixed(1));
    });
  }

  function loop() {
    var hot = physicsStep();
    tickPositions();
    if (hot && visible) rafId = requestAnimationFrame(loop);
    else { running = false; rafId = null; }
  }

  function ensureRunning() {
    if (!visible || running || nodes.length === 0) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  }

  // ---------- Pan / zoom / drag ----------

  function applyViewTransform() {
    if (viewportEl) viewportEl.setAttribute('transform', 'translate(' + (W / 2 + view.tx) + ',' + (H / 2 + view.ty) + ') scale(' + view.scale + ')');
  }

  function clientToGraphPoint(clientX, clientY) {
    var rect = svgEl.getBoundingClientRect();
    var svgX = ((clientX - rect.left) / rect.width) * W;
    var svgY = ((clientY - rect.top) / rect.height) * H;
    return { x: (svgX - (W / 2 + view.tx)) / view.scale, y: (svgY - (H / 2 + view.ty)) / view.scale };
  }

  function startDragNode(id) {
    var node = nodeIndex[id];
    if (!node) return;
    draggingNode = node;
    dragMoved = false;
    node.vx = 0; node.vy = 0;

    var onMove = function (clientX, clientY) {
      var p = clientToGraphPoint(clientX, clientY);
      node.x = p.x; node.y = p.y;
      dragMoved = true;
      tickPositions();
    };
    var onMouseMove = function (e) { onMove(e.clientX, e.clientY); };
    var onTouchMove = function (e) { if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY); };
    var onUp = function () {
      draggingNode = null;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onUp);
      ensureRunning();
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onUp);
  }

  function bindPanZoom() {
    svgEl.addEventListener('mousedown', function (e) {
      if (e.target.closest('[data-graph-node]')) return;
      var start = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
      var onMove = function (ev) {
        view.tx = start.tx + (ev.clientX - start.x);
        view.ty = start.ty + (ev.clientY - start.y);
        applyViewTransform();
      };
      var onUp = function () {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    svgEl.addEventListener('wheel', function (e) {
      e.preventDefault();
      view.scale = Math.max(0.25, Math.min(3, view.scale * (e.deltaY > 0 ? 0.9 : 1.1)));
      applyViewTransform();
    }, { passive: false });
  }

  // ---------- Legenda / destaque ----------

  function renderLegend() {
    if (!legendEl || !lastCodex) return;
    var typesPresent = typesInGraph(lastCodex);
    legendEl.innerHTML = typesPresent.map(function (t) {
      var off = !!hiddenTypes[t.id];
      return '<button type="button" class="codex-graph-legend-item' + (off ? ' codex-graph-legend-item-off' : '') + '" data-legend-type="' + t.id + '">' +
        '<span class="codex-graph-legend-dot" style="background-color:' + t.color + '"></span>' + escapeHtml(t.name) + '</button>';
    }).join('');
    legendEl.querySelectorAll('[data-legend-type]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-legend-type');
        if (hiddenTypes[id]) delete hiddenTypes[id]; else hiddenTypes[id] = true;
        btn.classList.toggle('codex-graph-legend-item-off', !!hiddenTypes[id]);
        applyVisibilityFilter();
      });
    });
  }

  function applyVisibilityFilter() {
    nodes.forEach(function (n) {
      var hidden = !!hiddenTypes[n.typeId];
      var els = nodeEls[n.id];
      if (els) els.gEl.style.display = hidden ? 'none' : '';
    });
    edgeEls.forEach(function (edge) {
      var sHidden = !!hiddenTypes[(nodeIndex[edge.source] || {}).typeId];
      var tHidden = !!hiddenTypes[(nodeIndex[edge.target] || {}).typeId];
      edge.lineEl.style.display = (sHidden || tHidden) ? 'none' : '';
    });
  }

  function highlightNode(id, on) {
    if (!on) {
      Object.keys(nodeEls).forEach(function (k) { nodeEls[k].gEl.classList.remove('codex-graph-node-dim', 'codex-graph-node-focus'); });
      edgeEls.forEach(function (edge) { edge.lineEl.classList.remove('codex-graph-edge-dim', 'codex-graph-edge-focus'); });
      return;
    }
    var connected = {}; connected[id] = true;
    edgeEls.forEach(function (edge) {
      var isConn = edge.source === id || edge.target === id;
      edge.lineEl.classList.toggle('codex-graph-edge-focus', isConn);
      edge.lineEl.classList.toggle('codex-graph-edge-dim', !isConn);
      if (isConn) { connected[edge.source] = true; connected[edge.target] = true; }
    });
    Object.keys(nodeEls).forEach(function (k) {
      nodeEls[k].gEl.classList.toggle('codex-graph-node-focus', k === id);
      nodeEls[k].gEl.classList.toggle('codex-graph-node-dim', !connected[k]);
    });
  }

  // ---------- Construção do DOM (nós/arestas) ----------

  function buildDom() {
    if (!root) return;
    if (nodes.length === 0) {
      if (svgEl) svgEl.style.display = 'none';
      if (legendEl) legendEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      nodeEls = {}; edgeEls = [];
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (svgEl) svgEl.style.display = '';

    edgesGroupEl.innerHTML = '';
    edgeEls = edges.map(function (edge) {
      var line = svgNode('line');
      line.setAttribute('class', 'codex-graph-edge codex-graph-edge-' + edge.kind);
      edgesGroupEl.appendChild(line);
      return { lineEl: line, source: edge.source, target: edge.target };
    });

    nodesGroupEl.innerHTML = '';
    nodeEls = {};
    nodes.forEach(function (n) {
      var g = svgNode('g');
      g.setAttribute('class', 'codex-graph-node');
      g.setAttribute('data-graph-node', n.id);
      var circle = svgNode('circle');
      circle.setAttribute('r', 7);
      circle.setAttribute('fill', n.color);
      var text = svgNode('text');
      text.setAttribute('class', 'codex-graph-label');
      text.setAttribute('x', 10);
      text.setAttribute('y', 4);
      text.textContent = n.name;
      g.appendChild(circle);
      g.appendChild(text);
      nodesGroupEl.appendChild(g);
      nodeEls[n.id] = { gEl: g, circleEl: circle, textEl: text };

      g.addEventListener('mousedown', function (e) { e.stopPropagation(); startDragNode(n.id); });
      g.addEventListener('touchstart', function (e) { e.stopPropagation(); startDragNode(n.id); }, { passive: true });
      g.addEventListener('click', function () {
        if (dragMoved) { dragMoved = false; return; }
        if (onGotoEntry) onGotoEntry(n.id);
      });
      g.addEventListener('mouseenter', function () { highlightNode(n.id, true); });
      g.addEventListener('mouseleave', function () { highlightNode(n.id, false); });
    });

    renderLegend();
    applyVisibilityFilter();
    tickPositions();
  }

  // ---------- API pública ----------

  function setData(codex) {
    var graph = GDC.buildCodexGraph(codex);
    var nextNodes = graph.nodes.map(function (n, i) {
      var prev = nodeIndex[n.id];
      if (prev) return Object.assign({}, n, { x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy });
      var angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
      var radius = 60 + Math.random() * 40;
      return Object.assign({}, n, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0 });
    });

    nodes = nextNodes;
    edges = graph.edges;
    nodeIndex = {};
    nodes.forEach(function (n) { nodeIndex[n.id] = n; });

    var currentTypeIds = {};
    codex.types.forEach(function (t) { currentTypeIds[t.id] = true; });
    Object.keys(hiddenTypes).forEach(function (id) { if (!currentTypeIds[id]) delete hiddenTypes[id]; });

    lastCodex = codex;
    buildDom();
    if (visible) ensureRunning();
  }

  function show() { visible = true; ensureRunning(); }
  function hide() {
    visible = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    running = false;
  }

  function panelShellMarkup() {
    return (
      '<div class="codex-graph-head">' +
      '  <h3 class="font-display text-sm font-bold text-primary">' + GDC.icon('share-2', { size: 14 }) + 'Grafo de relações</h3>' +
      '  <button type="button" class="kanban-icon-btn" id="codex-graph-close" title="Fechar">' + GDC.icon('x', { size: 14 }) + '</button>' +
      '</div>' +
      '<div class="codex-graph-legend" id="codex-graph-legend"></div>' +
      '<div class="codex-graph-canvas-wrap">' +
      '  <svg id="codex-graph-svg" class="codex-graph-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
      '    <g id="codex-graph-viewport"><g id="codex-graph-edges"></g><g id="codex-graph-nodes"></g></g>' +
      '  </svg>' +
      '  <p class="codex-graph-empty" id="codex-graph-empty">Crie pelo menos duas entradas conectadas — por um campo de Referência ou por <code>[[Nome]]</code> no texto — para ver o grafo aqui.</p>' +
      '  <div class="codex-graph-controls">' +
      '    <button type="button" class="codex-graph-zoom-btn" id="codex-graph-zoom-out" title="Diminuir zoom">−</button>' +
      '    <button type="button" class="codex-graph-zoom-btn" id="codex-graph-zoom-reset" title="Centralizar">' + GDC.icon('refresh-cw', { size: 12 }) + '</button>' +
      '    <button type="button" class="codex-graph-zoom-btn" id="codex-graph-zoom-in" title="Aumentar zoom">+</button>' +
      '  </div>' +
      '</div>'
    );
  }

  function mount(container, opts) {
    root = container;
    onGotoEntry = opts && opts.onGotoEntry;
    root.innerHTML = panelShellMarkup();

    svgEl = root.querySelector('#codex-graph-svg');
    viewportEl = root.querySelector('#codex-graph-viewport');
    edgesGroupEl = root.querySelector('#codex-graph-edges');
    nodesGroupEl = root.querySelector('#codex-graph-nodes');
    legendEl = root.querySelector('#codex-graph-legend');
    emptyEl = root.querySelector('#codex-graph-empty');

    applyViewTransform();
    bindPanZoom();

    var closeBtn = root.querySelector('#codex-graph-close');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      var toggleBtn = document.querySelector('[data-action="toggle-graph"]');
      if (toggleBtn) toggleBtn.click();
    });
    root.querySelector('#codex-graph-zoom-in').addEventListener('click', function () {
      view.scale = Math.min(3, view.scale * 1.2); applyViewTransform();
    });
    root.querySelector('#codex-graph-zoom-out').addEventListener('click', function () {
      view.scale = Math.max(0.25, view.scale / 1.2); applyViewTransform();
    });
    root.querySelector('#codex-graph-zoom-reset').addEventListener('click', function () {
      view.scale = 1; view.tx = 0; view.ty = 0; applyViewTransform();
    });
  }

  GDC.ui.codexGraph = { mount: mount, setData: setData, show: show, hide: hide };
}(window));
