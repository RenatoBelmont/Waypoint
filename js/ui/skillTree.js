/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // ---------- Constantes de layout ----------
  // Ferramenta de DESIGN (planejar a árvore, não simular o jogo rodando) — por isso o layout é
  // determinístico por camadas (tier = 1 + a maior camada entre os pré-requisitos, raízes na camada
  // 0), não um canvas livre feito o Mural nem uma simulação de física feita o grafo do Codex (pedido
  // do Renato: "árvore estruturada por camadas"). Os nós não são arrastáveis — a posição é sempre
  // recalculada a partir dos pré-requisitos, então mover um nó não faria sentido (voltaria pro lugar).
  var W = 900, H = 620, TOP_MARGIN = 70;
  var NODE_W = 168, NODE_H = 70;
  var TIER_GAP = 128, COL_GAP = 196;
  var ZOOM_MIN = 0.35, ZOOM_MAX = 2.5;

  var root, toolbarEl, legendEl, summaryEl, svgEl, viewportEl, edgesGroupEl, nodesGroupEl, emptyEl, modalHostEl, stageEl;
  var skillTreeState, codexRef, toolsRef, callbacks;
  var view = { scale: 1, tx: 0, ty: 0 };
  var hiddenBranches = {};
  var hoverNodeId = null;
  var modalState = null;
  var laidOutNodes = [];
  var isFullscreen = false; // espelha document.fullscreenElement === stageEl, atualizado no evento fullscreenchange

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function truncate(str, n) {
    str = str || '';
    return str.length > n ? str.slice(0, n).trim() + '…' : str;
  }

  function svgNode(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

  // ---------- Layout em camadas (tier = 1 + maior tier entre os pré-requisitos) ----------

  function computeLayout(rawNodes) {
    var nodes = (rawNodes || []).map(function (n) { return Object.assign({}, n); });
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });

    var tierOf = {}, visiting = {};
    function tierFor(id) {
      if (tierOf[id] !== undefined) return tierOf[id];
      // Guarda contra ciclo (não deveria acontecer vindo do editor — o formulário bloqueia
      // pré-requisitos que criariam um — mas uma importação editada à mão pode trazer um): trata o nó
      // que fecha o ciclo como se não tivesse pré-requisito, em vez de recursão infinita.
      if (visiting[id]) return 0;
      visiting[id] = true;
      var n = byId[id];
      var maxPrereqTier = -1;
      (n.prereqIds || []).forEach(function (pid) {
        if (!byId[pid]) return;
        maxPrereqTier = Math.max(maxPrereqTier, tierFor(pid));
      });
      delete visiting[id];
      var t = maxPrereqTier + 1;
      tierOf[id] = t;
      return t;
    }
    nodes.forEach(function (n) { tierFor(n.id); });

    var tiers = {};
    nodes.forEach(function (n) {
      var t = tierOf[n.id];
      (tiers[t] = tiers[t] || []).push(n);
    });
    var tierKeys = Object.keys(tiers).map(Number).sort(function (a, b) { return a - b; });
    tierKeys.forEach(function (t) {
      tiers[t].sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      tiers[t].forEach(function (n, i) { n._col = i; });
    });

    // Passes de "baricentro": cada nó tenta ficar alinhado com a média da coluna dos seus
    // pré-requisitos, reduzindo cruzamento de linhas — heurística simples de layout em camadas
    // (Sugiyama simplificado), não um algoritmo exato de minimização de cruzamentos.
    for (var pass = 0; pass < 3; pass++) {
      for (var ti = 1; ti < tierKeys.length; ti++) {
        var t = tierKeys[ti];
        tiers[t].forEach(function (n) {
          var prereqs = (n.prereqIds || []).map(function (pid) { return byId[pid]; }).filter(Boolean);
          n._bary = prereqs.length
            ? prereqs.reduce(function (sum, p) { return sum + p._col; }, 0) / prereqs.length
            : n._col;
        });
        tiers[t].sort(function (a, b) { return (a._bary - b._bary) || (a._col - b._col); });
        tiers[t].forEach(function (n, i) { n._col = i; });
      }
    }

    var result = [];
    tierKeys.forEach(function (t) {
      var row = tiers[t];
      var rowWidth = (row.length - 1) * COL_GAP;
      row.forEach(function (n, i) {
        result.push(Object.assign({}, n, { tier: t, x: i * COL_GAP - rowWidth / 2, y: t * TIER_GAP }));
      });
    });
    return result;
  }

  // ---------- Leituras auxiliares ----------

  function branchById(id) { return (skillTreeState.branches || []).filter(function (b) { return b.id === id; })[0] || null; }
  function nodeById(id) { return (skillTreeState.nodes || []).filter(function (n) { return n.id === id; })[0] || null; }

  /** Quests do Quest Designer vêm de um blob JSON solto em doc.tools.questDesigner (não é uma coleção
   *  de 1ª classe como o Codex) — lido aqui do mesmo jeito que o próprio questDesigner.js faz. */
  function readQuests() {
    var blob = toolsRef && toolsRef.questDesigner;
    if (!blob) return [];
    try {
      var parsed = JSON.parse(blob);
      return Array.isArray(parsed.quests) ? parsed.quests.filter(function (q) { return q && typeof q.id === 'string' && typeof q.title === 'string'; }) : [];
    } catch (e) { return []; }
  }

  /** Nós que dependem de id, direta ou transitivamente (seus "descendentes" na árvore) — usado pra
   *  excluir opções de pré-requisito que fechariam um ciclo (nunca deixa escolher como pré-requisito
   *  algo que já depende do nó sendo editado). */
  function computeDescendants(id) {
    var result = {};
    var queue = [id];
    while (queue.length) {
      var cur = queue.shift();
      (skillTreeState.nodes || []).forEach(function (n) {
        if (n.prereqIds.indexOf(cur) !== -1 && !result[n.id]) { result[n.id] = true; queue.push(n.id); }
      });
    }
    return result;
  }

  /** Reaproveita o SVG que GDC.icon() já desenha (paths outline 24x24), só troca o <svg> externo por
   *  um <g> pra poder embutir dentro do canvas do quadro sem aninhar <svg> dentro de <svg>. */
  function iconGroupNode(name) {
    var tmp = document.createElement('div');
    tmp.innerHTML = GDC.icon(name, {});
    var src = tmp.firstChild;
    var g = svgNode('g');
    g.setAttribute('fill', 'none');
    g.setAttribute('stroke', 'currentColor');
    g.setAttribute('stroke-width', '2');
    g.setAttribute('stroke-linecap', 'round');
    g.setAttribute('stroke-linejoin', 'round');
    if (src) Array.prototype.forEach.call(src.childNodes, function (child) { g.appendChild(child.cloneNode(true)); });
    return g;
  }

  function nodeFillTint(color) { return color + '26'; /* ~15% alpha — mesmo truque de crachá tingido do Kanban */ }

  // ---------- Pan / zoom ----------

  function applyViewTransform() {
    if (viewportEl) viewportEl.setAttribute('transform', 'translate(' + (W / 2 + view.tx) + ',' + (TOP_MARGIN + view.ty) + ') scale(' + view.scale + ')');
  }

  function bindPanZoom() {
    svgEl.addEventListener('mousedown', function (e) {
      if (e.target.closest('[data-skilltree-node]')) return;
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
      view.scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.scale * (e.deltaY > 0 ? 0.9 : 1.1)));
      applyViewTransform();
    }, { passive: false });
  }

  // ---------- Resumo de custo / legenda de ramos ----------

  function renderSummary() {
    if (!summaryEl) return;
    var nodes = skillTreeState.nodes || [];
    if (!nodes.length) { summaryEl.innerHTML = ''; return; }
    var total = nodes.reduce(function (sum, n) { return sum + (n.cost || 0); }, 0);
    var byBranch = {};
    nodes.forEach(function (n) {
      var key = n.branchId || '__none';
      byBranch[key] = (byBranch[key] || 0) + (n.cost || 0);
    });
    var chips = (skillTreeState.branches || []).map(function (b) {
      var cost = byBranch[b.id] || 0;
      if (!cost) return '';
      return '<span class="skilltree-summary-chip" style="border-color:' + b.color + ';color:' + b.color + '">' +
        GDC.icon(b.icon, { size: 11 }) + escapeHtml(b.name) + ' · ' + cost + '</span>';
    }).join('');
    var noneCost = byBranch.__none || 0;
    var noneChip = noneCost ? '<span class="skilltree-summary-chip">Sem ramo · ' + noneCost + '</span>' : '';
    summaryEl.innerHTML =
      '<span class="skilltree-summary-total">' + GDC.icon('trending-up', { size: 13 }) + 'Custo total: <strong>' + total + '</strong></span>' + chips + noneChip;
  }

  function renderLegend() {
    if (!legendEl) return;
    var branches = skillTreeState.branches || [];
    if (!branches.length) { legendEl.innerHTML = ''; return; }
    legendEl.innerHTML = branches.map(function (b) {
      var off = !!hiddenBranches[b.id];
      return '<button type="button" class="skilltree-legend-item' + (off ? ' skilltree-legend-item-off' : '') + '" data-legend-branch="' + b.id + '">' +
        '<span class="skilltree-legend-dot" style="background-color:' + b.color + '"></span>' + escapeHtml(b.name) + '</button>';
    }).join('');
  }

  // ---------- Canvas (nós + arestas) ----------

  function setHoverNode(id) {
    hoverNodeId = id;
    var connected = {};
    if (id) {
      connected[id] = true;
      laidOutNodes.forEach(function (n) {
        if (n.id === id) (n.prereqIds || []).forEach(function (p) { connected[p] = true; });
        if ((n.prereqIds || []).indexOf(id) !== -1) connected[n.id] = true;
      });
    }
    nodesGroupEl.querySelectorAll('[data-skilltree-node]').forEach(function (el) {
      var nid = el.getAttribute('data-skilltree-node');
      el.classList.toggle('skilltree-node-focus', nid === id);
      el.classList.toggle('skilltree-node-dim', !!id && !connected[nid]);
    });
    edgesGroupEl.querySelectorAll('[data-edge-from]').forEach(function (el) {
      var isConn = !!id && (el.getAttribute('data-edge-from') === id || el.getAttribute('data-edge-to') === id);
      el.classList.toggle('skilltree-edge-focus', isConn);
      el.classList.toggle('skilltree-edge-dim', !!id && !isConn);
    });
  }

  function buildCanvas() {
    var laidOut = computeLayout(skillTreeState.nodes || []);
    laidOutNodes = laidOut;
    var byId = {};
    laidOut.forEach(function (n) { byId[n.id] = n; });

    if (!laidOut.length) {
      svgEl.style.display = 'none';
      emptyEl.style.display = '';
      edgesGroupEl.innerHTML = '';
      nodesGroupEl.innerHTML = '';
      renderSummary();
      renderLegend();
      return;
    }
    emptyEl.style.display = 'none';
    svgEl.style.display = '';

    edgesGroupEl.innerHTML = '';
    laidOut.forEach(function (n) {
      (n.prereqIds || []).forEach(function (pid) {
        var p = byId[pid];
        if (!p) return;
        var y1 = p.y + NODE_H / 2, y2 = n.y - NODE_H / 2, midY = (y1 + y2) / 2;
        var path = svgNode('path');
        path.setAttribute('d', 'M ' + p.x + ' ' + y1 + ' C ' + p.x + ' ' + midY + ' ' + n.x + ' ' + midY + ' ' + n.x + ' ' + y2);
        path.setAttribute('class', 'skilltree-edge');
        path.setAttribute('data-edge-from', pid);
        path.setAttribute('data-edge-to', n.id);
        if (hiddenBranches[n.branchId] || hiddenBranches[p.branchId]) path.style.display = 'none';
        edgesGroupEl.appendChild(path);
      });
    });

    nodesGroupEl.innerHTML = '';
    laidOut.forEach(function (n) {
      var branch = n.branchId ? branchById(n.branchId) : null;
      var color = n.color || (branch ? branch.color : '#94a3b8');

      var g = svgNode('g');
      g.setAttribute('class', 'skilltree-node');
      g.setAttribute('data-skilltree-node', n.id);
      g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
      if (branch && hiddenBranches[branch.id]) g.style.display = 'none';

      var rect = svgNode('rect');
      rect.setAttribute('class', 'skilltree-node-rect');
      rect.setAttribute('x', -NODE_W / 2); rect.setAttribute('y', -NODE_H / 2);
      rect.setAttribute('width', NODE_W); rect.setAttribute('height', NODE_H);
      rect.setAttribute('rx', 10);
      rect.style.fill = nodeFillTint(color);
      rect.style.stroke = color;
      g.appendChild(rect);

      var iconG = iconGroupNode(n.icon);
      iconG.setAttribute('class', 'skilltree-node-icon');
      iconG.setAttribute('transform', 'translate(' + (-NODE_W / 2 + 10) + ',' + (-NODE_H / 2 + 9) + ') scale(0.7)');
      iconG.style.color = color;
      g.appendChild(iconG);

      var nameText = svgNode('text');
      nameText.setAttribute('class', 'skilltree-node-name');
      nameText.setAttribute('x', -NODE_W / 2 + 32);
      nameText.setAttribute('y', -4);
      nameText.textContent = truncate(n.name || '(sem nome)', 18);
      g.appendChild(nameText);

      var costText = svgNode('text');
      costText.setAttribute('class', 'skilltree-node-cost');
      costText.setAttribute('x', -NODE_W / 2 + 32);
      costText.setAttribute('y', 15);
      costText.textContent = (n.cost || 0) + (n.cost === 1 ? ' ponto' : ' pontos');
      g.appendChild(costText);

      if (n.linkedEntryId || n.linkedQuestId) {
        var linkDot = svgNode('circle');
        linkDot.setAttribute('class', 'skilltree-node-link-dot');
        linkDot.setAttribute('cx', NODE_W / 2 - 11);
        linkDot.setAttribute('cy', -NODE_H / 2 + 11);
        linkDot.setAttribute('r', 3.5);
        g.appendChild(linkDot);
      }

      g.addEventListener('click', function () { openNodeModal('edit', n.id); });
      g.addEventListener('mouseenter', function () { setHoverNode(n.id); });
      g.addEventListener('mouseleave', function () { setHoverNode(null); });

      nodesGroupEl.appendChild(g);
    });

    renderSummary();
    renderLegend();
  }

  // ---------- Modal: habilidade (criar/editar) ----------

  function defaultNodeDraft(node) {
    if (!node) return { name: '', description: '', icon: 'star', cost: 1, color: null, branchId: null, prereqIds: [], linkedEntryId: null, linkedQuestId: null };
    return {
      name: node.name, description: node.description, icon: node.icon, cost: node.cost, color: node.color || null,
      branchId: node.branchId, prereqIds: node.prereqIds.slice(),
      linkedEntryId: node.linkedEntryId, linkedQuestId: node.linkedQuestId,
    };
  }

  function openNodeModal(mode, nodeId) {
    var node = nodeId ? nodeById(nodeId) : null;
    modalState = { kind: 'node', mode: mode, nodeId: nodeId || null, draft: defaultNodeDraft(node) };
    renderModal();
  }

  function branchOptionsMarkup(selectedId) {
    var opts = (skillTreeState.branches || []).map(function (b) {
      return '<option value="' + b.id + '"' + (b.id === selectedId ? ' selected' : '') + '>' + escapeHtml(b.name) + '</option>';
    }).join('');
    return '<option value="">Sem ramo</option>' + opts;
  }

  function entryOptionsMarkup(selectedId) {
    var entries = (codexRef && codexRef.entries) || [];
    var opts = entries.map(function (e) {
      return '<option value="' + e.id + '"' + (e.id === selectedId ? ' selected' : '') + '>' + escapeHtml(e.name || '(sem nome)') + '</option>';
    }).join('');
    return '<option value="">Sem vínculo</option>' + opts;
  }

  function questOptionsMarkup(selectedId) {
    var opts = readQuests().map(function (q) {
      return '<option value="' + q.id + '"' + (q.id === selectedId ? ' selected' : '') + '>' + escapeHtml(q.title || '(sem título)') + '</option>';
    }).join('');
    return '<option value="">Sem vínculo</option>' + opts;
  }

  function iconPickerMarkup(selected) {
    return '<div class="skilltree-icon-grid">' + GDC.SKILL_TREE_ICONS.map(function (name) {
      return '<button type="button" class="skilltree-icon-btn' + (name === selected ? ' selected' : '') +
        '" data-icon-pick="' + name + '" title="' + name + '">' + GDC.icon(name, { size: 15 }) + '</button>';
    }).join('') + '</div>';
  }

  /** Cor própria do nó (opcional) — reaproveita literalmente as classes de cor do Kanban
   *  (.kanban-color-swatch(es)/-custom/-clear), inclusive o botão "Remover cor" que o Kanban já usa
   *  pra voltar ao null/herdado — aqui "herdado" quer dizer a cor do ramo (ou cinza padrão sem ramo). */
  function nodeColorPickerMarkup(selected) {
    var dots = GDC.MILESTONE_COLOR_PALETTE.map(function (hex) {
      return '<button type="button" class="kanban-color-swatch' + (selected === hex ? ' selected' : '') +
        '" data-node-color="' + hex + '" style="background-color:' + hex + '" title="' + hex + '"></button>';
    }).join('');
    return (
      '<div class="kanban-color-swatches">' + dots +
      '  <label class="kanban-color-custom" title="Cor personalizada"><input type="color" data-f="node-color-custom" value="' + (selected || '#94a3b8') + '" /></label>' +
      '  <button type="button" class="kanban-color-clear" data-node-color="" title="Usar a cor do ramo">' + GDC.icon('x', { size: 12 }) + '</button>' +
      '</div>'
    );
  }

  function prereqCheckboxesMarkup(draft, editingId) {
    var blocked = editingId ? computeDescendants(editingId) : {};
    var candidates = (skillTreeState.nodes || []).filter(function (n) { return n.id !== editingId && !blocked[n.id]; });
    if (!candidates.length) return '<p class="skilltree-modal-hint">Nenhum outro nó disponível ainda.</p>';
    return '<div class="skilltree-prereq-list">' + candidates.map(function (n) {
      var checked = draft.prereqIds.indexOf(n.id) !== -1;
      return '<label class="skilltree-prereq-row"><input type="checkbox" data-prereq-toggle="' + n.id + '" ' + (checked ? 'checked' : '') + ' />' +
        '<span class="truncate">' + escapeHtml(n.name || '(sem nome)') + '</span></label>';
    }).join('') + '</div>';
  }

  function nodeModalMarkup() {
    var s = modalState, d = s.draft;
    return (
      '<div class="skilltree-modal-overlay" data-modal-overlay>' +
      '  <div class="skilltree-modal-panel card-surface" data-modal-panel>' +
      '    <div class="skilltree-modal-header">' +
      '      <h3 class="font-display text-base font-bold text-primary">' + (s.mode === 'create' ? 'Nova habilidade' : 'Editar habilidade') + '</h3>' +
      '      <button type="button" class="kanban-icon-btn" data-action="close-modal" title="Fechar">' + GDC.icon('x', { size: 16 }) + '</button>' +
      '    </div>' +
      '    <div class="skilltree-modal-body">' +
      '      <div class="skilltree-modal-field"><label class="skilltree-modal-label">Nome</label>' +
      '        <input type="text" class="input-field" data-f="name" placeholder="Ex: Investida" value="' + escapeHtml(d.name) + '" /></div>' +
      '      <div class="skilltree-modal-field"><label class="skilltree-modal-label">Ícone</label>' + iconPickerMarkup(d.icon) + '</div>' +
      '      <div class="skilltree-modal-row">' +
      '        <div class="skilltree-modal-field"><label class="skilltree-modal-label">Ramo</label>' +
      '          <select class="input-field" data-f="branch">' + branchOptionsMarkup(d.branchId) + '</select></div>' +
      '        <div class="skilltree-modal-field"><label class="skilltree-modal-label">Custo (pontos)</label>' +
      '          <input type="number" min="0" step="1" class="input-field" data-f="cost" value="' + d.cost + '" /></div>' +
      '      </div>' +
      '      <div class="skilltree-modal-field"><label class="skilltree-modal-label">Cor (opcional — substitui a cor do ramo)</label>' + nodeColorPickerMarkup(d.color) + '</div>' +
      '      <div class="skilltree-modal-field"><label class="skilltree-modal-label">Descrição / efeito</label>' +
      '        <textarea class="input-field skilltree-modal-textarea" data-f="description" placeholder="O que essa habilidade faz...">' + escapeHtml(d.description) + '</textarea></div>' +
      '      <div class="skilltree-modal-field"><label class="skilltree-modal-label">Pré-requisitos</label>' + prereqCheckboxesMarkup(d, s.nodeId) + '</div>' +
      '      <div class="skilltree-modal-row">' +
      '        <div class="skilltree-modal-field"><label class="skilltree-modal-label">Entrada do Codex</label>' +
      '          <select class="input-field" data-f="entry">' + entryOptionsMarkup(d.linkedEntryId) + '</select></div>' +
      '        <div class="skilltree-modal-field"><label class="skilltree-modal-label">Quest</label>' +
      '          <select class="input-field" data-f="quest">' + questOptionsMarkup(d.linkedQuestId) + '</select></div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="skilltree-modal-footer">' +
      (s.mode === 'edit'
        ? '<button type="button" class="btn-ghost skilltree-danger-btn" data-action="delete-node">' + GDC.icon('trash-2', { size: 13 }) + 'Excluir</button>'
        : '<span></span>') +
      '      <div class="skilltree-modal-footer-right">' +
      '        <button type="button" class="btn-ghost" data-action="cancel-modal">Cancelar</button>' +
      '        <button type="button" class="btn-primary" data-action="save-modal">Salvar</button>' +
      '      </div>' +
      '    </div>' +
      '  </div>' +
      '</div>'
    );
  }

  function bindNodeModalEvents(modalRoot) {
    var d = modalState.draft;

    var overlay = modalRoot.querySelector('[data-modal-overlay]');
    if (overlay) overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeModal(); });
    var closeBtn = modalRoot.querySelector('[data-action="close-modal"]');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    var cancelBtn = modalRoot.querySelector('[data-action="cancel-modal"]');
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    var nameEl = modalRoot.querySelector('[data-f="name"]');
    if (nameEl) nameEl.addEventListener('input', function (e) { d.name = e.target.value; });
    var descEl = modalRoot.querySelector('[data-f="description"]');
    if (descEl) descEl.addEventListener('input', function (e) { d.description = e.target.value; });
    var costEl = modalRoot.querySelector('[data-f="cost"]');
    if (costEl) costEl.addEventListener('input', function (e) { d.cost = Math.max(0, parseFloat(e.target.value) || 0); });
    var branchEl = modalRoot.querySelector('[data-f="branch"]');
    if (branchEl) branchEl.addEventListener('change', function (e) { d.branchId = e.target.value || null; });
    var entryEl = modalRoot.querySelector('[data-f="entry"]');
    if (entryEl) entryEl.addEventListener('change', function (e) { d.linkedEntryId = e.target.value || null; });
    var questEl = modalRoot.querySelector('[data-f="quest"]');
    if (questEl) questEl.addEventListener('change', function (e) { d.linkedQuestId = e.target.value || null; });

    modalRoot.querySelectorAll('[data-icon-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () { d.icon = btn.getAttribute('data-icon-pick'); renderModal(); });
    });
    modalRoot.querySelectorAll('[data-node-color]').forEach(function (btn) {
      btn.addEventListener('click', function () { d.color = btn.getAttribute('data-node-color') || null; renderModal(); });
    });
    var nodeCustomColor = modalRoot.querySelector('[data-f="node-color-custom"]');
    // Sem renderModal() aqui de propósito (mesmo padrão do seletor de cor personalizada do ramo, mais
    // abaixo): re-renderizar a cada evento "input" do <input type="color"> fecharia o seletor nativo
    // do navegador no meio do arraste.
    if (nodeCustomColor) nodeCustomColor.addEventListener('input', function (e) { d.color = e.target.value; });
    modalRoot.querySelectorAll('[data-prereq-toggle]').forEach(function (chk) {
      chk.addEventListener('change', function () {
        var id = chk.getAttribute('data-prereq-toggle');
        var idx = d.prereqIds.indexOf(id);
        if (chk.checked && idx === -1) d.prereqIds.push(id);
        if (!chk.checked && idx !== -1) d.prereqIds.splice(idx, 1);
      });
    });

    var deleteBtn = modalRoot.querySelector('[data-action="delete-node"]');
    if (deleteBtn) deleteBtn.addEventListener('click', function () {
      if (modalState.nodeId && callbacks.onDeleteNode) callbacks.onDeleteNode(modalState.nodeId);
      closeModal();
    });
    var saveBtn = modalRoot.querySelector('[data-action="save-modal"]');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      if (!d.name.trim()) { if (nameEl) nameEl.focus(); return; }
      var patch = {
        name: d.name.trim(), description: d.description, icon: d.icon, cost: d.cost, color: d.color || null,
        branchId: d.branchId || null, prereqIds: d.prereqIds.slice(),
        linkedEntryId: d.linkedEntryId || null, linkedQuestId: d.linkedQuestId || null,
      };
      if (modalState.mode === 'create') { if (callbacks.onAddNode) callbacks.onAddNode(patch); }
      else if (callbacks.onUpdateNode) callbacks.onUpdateNode(modalState.nodeId, patch);
      closeModal();
    });
  }

  // ---------- Modal: gerenciar ramos ----------

  function openBranchModal() {
    modalState = { kind: 'branches', newDraft: { name: '', color: GDC.MILESTONE_COLOR_PALETTE[0], icon: 'star' } };
    renderModal();
  }

  function swatchesMarkup(selected) {
    // Reaproveita as mesmas classes do seletor de cor do Kanban (kanban-color-*) em vez de duplicar o
    // CSS — é um primitivo visual genérico o suficiente (bolinha de cor + swatch personalizado), não
    // algo específico de card do Kanban.
    var dots = GDC.MILESTONE_COLOR_PALETTE.map(function (hex) {
      return '<button type="button" class="kanban-color-swatch' + (selected === hex ? ' selected' : '') +
        '" data-color-pick="' + hex + '" style="background-color:' + hex + ';color:' + hex + '" title="' + hex + '"></button>';
    }).join('');
    return '<div class="kanban-color-swatches">' + dots +
      '<label class="kanban-color-custom" title="Cor personalizada" style="background-color:' + selected + '">' +
      '<input type="color" data-f="new-branch-color" value="' + selected + '" /></label></div>';
  }

  function branchModalMarkup() {
    var branches = skillTreeState.branches || [];
    var nd = modalState.newDraft;
    var rows = branches.map(function (b) {
      return (
        '<div class="skilltree-branch-row" data-branch-row="' + b.id + '">' +
        '  <span class="skilltree-branch-dot" style="background-color:' + b.color + '"></span>' +
        GDC.icon(b.icon, { size: 14 }) +
        '  <input type="text" class="input-field py-1 text-xs" data-branch-name="' + b.id + '" value="' + escapeHtml(b.name) + '" />' +
        '  <button type="button" class="text-muted hover:text-rose-500" data-branch-remove="' + b.id + '" title="Remover ramo">' + GDC.icon('trash-2', { size: 13 }) + '</button>' +
        '</div>'
      );
    }).join('') || '<p class="skilltree-modal-hint">Nenhum ramo ainda — crie um abaixo.</p>';
    return (
      '<div class="skilltree-modal-overlay" data-modal-overlay>' +
      '  <div class="skilltree-modal-panel card-surface" data-modal-panel>' +
      '    <div class="skilltree-modal-header">' +
      '      <h3 class="font-display text-base font-bold text-primary">Ramos da árvore</h3>' +
      '      <button type="button" class="kanban-icon-btn" data-action="close-modal" title="Fechar">' + GDC.icon('x', { size: 16 }) + '</button>' +
      '    </div>' +
      '    <div class="skilltree-modal-body">' +
      '      <div class="skilltree-branch-list">' + rows + '</div>' +
      '      <div class="skilltree-branch-new">' +
      '        <p class="skilltree-modal-label">Novo ramo</p>' +
      swatchesMarkup(nd.color) +
      iconPickerMarkup(nd.icon) +
      '        <div class="skilltree-branch-new-row">' +
      '          <input type="text" class="input-field" data-f="new-branch-name" placeholder="Nome do ramo" value="' + escapeHtml(nd.name) + '" />' +
      '          <button type="button" class="btn-primary py-2 text-xs" data-action="add-branch">' + GDC.icon('plus', { size: 13 }) + '</button>' +
      '        </div>' +
      '      </div>' +
      '    </div>' +
      '    <div class="skilltree-modal-footer"><span></span><button type="button" class="btn-ghost" data-action="close-modal">Fechar</button></div>' +
      '  </div>' +
      '</div>'
    );
  }

  function bindBranchModalEvents(modalRoot) {
    var nd = modalState.newDraft;

    var overlay = modalRoot.querySelector('[data-modal-overlay]');
    if (overlay) overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) closeModal(); });
    modalRoot.querySelectorAll('[data-action="close-modal"]').forEach(function (b) { b.addEventListener('click', closeModal); });

    modalRoot.querySelectorAll('[data-branch-name]').forEach(function (input) {
      input.addEventListener('change', function () {
        var id = input.getAttribute('data-branch-name');
        if (callbacks.onUpdateBranch) callbacks.onUpdateBranch(id, { name: input.value.trim() || 'Ramo' });
      });
    });
    modalRoot.querySelectorAll('[data-branch-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-branch-remove');
        if (callbacks.onDeleteBranch) callbacks.onDeleteBranch(id);
      });
    });

    modalRoot.querySelectorAll('[data-color-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () { nd.color = btn.getAttribute('data-color-pick'); renderModal(); });
    });
    var customColor = modalRoot.querySelector('[data-f="new-branch-color"]');
    if (customColor) customColor.addEventListener('input', function (e) { nd.color = e.target.value; });
    modalRoot.querySelectorAll('[data-icon-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () { nd.icon = btn.getAttribute('data-icon-pick'); renderModal(); });
    });
    var nameEl = modalRoot.querySelector('[data-f="new-branch-name"]');
    if (nameEl) nameEl.addEventListener('input', function (e) { nd.name = e.target.value; });

    var addBtn = modalRoot.querySelector('[data-action="add-branch"]');
    if (addBtn) addBtn.addEventListener('click', function () {
      if (!nd.name.trim()) { if (nameEl) nameEl.focus(); return; }
      if (callbacks.onAddBranch) callbacks.onAddBranch({ name: nd.name.trim(), color: nd.color, icon: nd.icon });
      modalState.newDraft = { name: '', color: GDC.MILESTONE_COLOR_PALETTE[0], icon: 'star' };
      renderModal();
    });
  }

  // ---------- Modal: despacho comum ----------

  function renderModal() {
    var modalRoot = root && root.querySelector('#skilltree-modal-root');
    if (!modalRoot) return;
    if (!modalState) { modalRoot.innerHTML = ''; return; }
    if (modalState.kind === 'branches') {
      modalRoot.innerHTML = branchModalMarkup();
      bindBranchModalEvents(modalRoot);
    } else {
      modalRoot.innerHTML = nodeModalMarkup();
      bindNodeModalEvents(modalRoot);
      var nameInput = modalRoot.querySelector('[data-f="name"]');
      if (nameInput && !nameInput.value) nameInput.focus();
    }
  }

  function closeModal() { modalState = null; renderModal(); }

  // ---------- Delegação de clique da barra de ferramentas / legenda ----------

  function handleRootClick(e) {
    var el;
    if ((el = e.target.closest('[data-action="add-node"]'))) { openNodeModal('create', null); return; }
    if ((el = e.target.closest('[data-action="manage-branches"]'))) { openBranchModal(); return; }
    if ((el = e.target.closest('[data-action="zoom-in"]'))) { view.scale = Math.min(ZOOM_MAX, view.scale * 1.2); applyViewTransform(); return; }
    if ((el = e.target.closest('[data-action="zoom-out"]'))) { view.scale = Math.max(ZOOM_MIN, view.scale / 1.2); applyViewTransform(); return; }
    if ((el = e.target.closest('[data-action="zoom-reset"]'))) { view.scale = 1; view.tx = 0; view.ty = 0; applyViewTransform(); return; }
    if ((el = e.target.closest('[data-action="toggle-fullscreen"]'))) { toggleFullscreen(); return; }
    if ((el = e.target.closest('[data-legend-branch]'))) {
      var id = el.getAttribute('data-legend-branch');
      if (hiddenBranches[id]) delete hiddenBranches[id]; else hiddenBranches[id] = true;
      buildCanvas();
      return;
    }
  }

  // ---------- Tela cheia (padrão do app: js/telaCheia.js) ----------

  function toggleFullscreen() {
    if (stageEl) GDC.fullscreen.toggle(stageEl);
  }

  function updateFullscreenBtn() {
    var btn = root && root.querySelector('[data-action="toggle-fullscreen"]');
    if (btn) btn.outerHTML = GDC.fullscreen.buttonMarkup('mural-tbtn', isFullscreen, 'data-action="toggle-fullscreen"');
  }

  function handleFullscreenChange(e) {
    isFullscreen = !!(e && e.detail && e.detail.active);
    updateFullscreenBtn();
  }

  // ---------- Shell / mount ----------

  function shellMarkup() {
    return (
      '<section id="skilltree" class="builder-section">' +
      '  <div class="mb-8 text-center">' +
      '    <div class="hero-badge">' + GDC.icon('workflow', { size: 14, className: 'text-emerald-400' }) + 'Design de progressão</div>' +
      '    <h2 class="font-display text-3xl font-bold text-primary">Árvore de Habilidades</h2>' +
      '    <p class="mt-2 text-secondary">Planeje habilidades, upgrades e talentos com pré-requisitos — a árvore se organiza sozinha em camadas conforme você conecta os nós.</p>' +
      '  </div>' +
      '  <div class="skilltree-stage wp-stage" id="skilltree-stage">' +
      '    <div class="mural-toolbar-card wp-stage-bar" id="skilltree-toolbar" role="toolbar" aria-label="Ferramentas da árvore de habilidades">' +
      '      <button type="button" class="mural-tbtn mural-tbtn-text" data-action="add-node" title="Nova habilidade">' + GDC.icon('plus', { size: 14 }) + 'Nova habilidade</button>' +
      '      <button type="button" class="mural-tbtn mural-tbtn-text" data-action="manage-branches" title="Gerenciar ramos">' + GDC.icon('tag', { size: 14 }) + 'Ramos</button>' +
      '      <span class="mural-tsep" aria-hidden="true"></span>' +
      '      <div class="skilltree-legend" id="skilltree-legend"></div>' +
      '      <div class="skilltree-tbtn-spacer"></div>' +
      '      <button type="button" class="mural-tbtn" data-action="zoom-out" title="Diminuir zoom">' + GDC.icon('minus', { size: 15 }) + '</button>' +
      '      <button type="button" class="mural-tbtn mural-tbtn-text" data-action="zoom-reset" title="Centralizar">100%</button>' +
      '      <button type="button" class="mural-tbtn" data-action="zoom-in" title="Aumentar zoom">' + GDC.icon('plus', { size: 15 }) + '</button>' +
      '      <span class="mural-tsep" aria-hidden="true"></span>' +
      '      ' + GDC.fullscreen.buttonMarkup('mural-tbtn', false, 'data-action="toggle-fullscreen"') +
      '    </div>' +
      '    <div class="skilltree-summary" id="skilltree-summary"></div>' +
      '    <div class="skilltree-board-wrap">' +
      '      <svg id="skilltree-svg" class="skilltree-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">' +
      '        <g id="skilltree-viewport"><g id="skilltree-edges"></g><g id="skilltree-nodes"></g></g>' +
      '      </svg>' +
      '      <p class="skilltree-empty-hint" id="skilltree-empty-hint">A árvore está vazia — use "Nova habilidade" pra criar o primeiro nó.</p>' +
      '    </div>' +
      '    <div id="skilltree-modal-root"></div>' +
      '  </div>' +
      '  <div class="tab-help-note">' + GDC.icon('info', { size: 16 }) +
      '    <p><strong>Como funciona:</strong> cada habilidade fica na camada logo abaixo do seu pré-requisito mais profundo — raízes (sem pré-requisito) começam no topo, e a posição é sempre recalculada. Arraste o fundo do quadro pra navegar e use a roda do mouse pra dar zoom. Clique num nó pra editar; passe o mouse pra destacar a cadeia de pré-requisitos. O pontinho no canto de um nó indica vínculo com o Codex ou uma Quest.</p>' +
      '  </div>' +
      '</section>'
    );
  }

  function mount(container, opts) {
    root = container;
    skillTreeState = (opts && opts.skillTree) || GDC.createEmptySkillTree();
    codexRef = (opts && opts.codex) || { types: [], entries: [] };
    toolsRef = (opts && opts.tools) || {};
    callbacks = {
      onAddNode: opts && opts.onAddNode, onUpdateNode: opts && opts.onUpdateNode, onDeleteNode: opts && opts.onDeleteNode,
      onAddBranch: opts && opts.onAddBranch, onUpdateBranch: opts && opts.onUpdateBranch, onDeleteBranch: opts && opts.onDeleteBranch,
      onGotoCodexEntry: opts && opts.onGotoCodexEntry,
    };
    view = { scale: 1, tx: 0, ty: 0 };
    hiddenBranches = {};
    hoverNodeId = null;
    modalState = null;
    isFullscreen = false;

    root.innerHTML = shellMarkup();
    toolbarEl = root.querySelector('#skilltree-toolbar');
    legendEl = root.querySelector('#skilltree-legend');
    summaryEl = root.querySelector('#skilltree-summary');
    svgEl = root.querySelector('#skilltree-svg');
    viewportEl = root.querySelector('#skilltree-viewport');
    edgesGroupEl = root.querySelector('#skilltree-edges');
    nodesGroupEl = root.querySelector('#skilltree-nodes');
    emptyEl = root.querySelector('#skilltree-empty-hint');
    modalHostEl = root.querySelector('#skilltree-modal-root');
    stageEl = root.querySelector('#skilltree-stage');

    applyViewTransform();
    bindPanZoom();
    root.addEventListener('click', handleRootClick);
    stageEl.addEventListener('wpfullscreenchange', handleFullscreenChange);

    buildCanvas();
  }

  /** Re-render completo (import/reset) — troca a referência de estado e redesenha tudo do zero. */
  function reset(skillTreeVal, codexVal, toolsVal) {
    skillTreeState = skillTreeVal || GDC.createEmptySkillTree();
    if (codexVal) codexRef = codexVal;
    if (toolsVal) toolsRef = toolsVal;
    hiddenBranches = {};
    modalState = null;
    renderModal();
    buildCanvas();
  }

  /** Re-render após uma mutação local (add/update/delete de nó ou ramo) — mesma referência de doc,
   *  só redesenha o canvas (e o modal, se por acaso ainda estiver aberto, ex.: a lista de "outros
   *  nós" do seletor de pré-requisitos muda depois de criar um novo nó). */
  function syncState(skillTreeVal) {
    if (skillTreeVal) skillTreeState = skillTreeVal;
    buildCanvas();
  }

  GDC.ui.skillTree = { mount: mount, reset: reset, syncState: syncState };
}(window));
