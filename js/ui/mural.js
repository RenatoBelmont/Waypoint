/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // ---------------------------------------------------------------------------------------------
  // Mural: um quadro (pinboard) com pan/zoom onde post-its, imagens de referência, formas/fluxogramas
  // e desenho livre são arrastados e conectados livremente. Mesma ideia de mural físico: útil pra
  // moodboards, referências visuais e organização espacial/lógica que uma lista não resolve.
  // ---------------------------------------------------------------------------------------------

  var NOTE_MIN_W = 100, NOTE_MIN_H = 80, IMAGE_MIN_W = 110, IMAGE_MIN_H = 90, SHAPE_MIN_W = 60, SHAPE_MIN_H = 60;
  var FONT_SIZES = [
    { px: 11, label: 'Texto pequeno' },
    { px: 14, label: 'Texto normal' },
    { px: 19, label: 'Texto grande' },
  ];
  var ARROW_MIN_DRAG = 6; // px no espaço do quadro — evita criar seta/traço de clique acidental sem arrastar
  var UNDO_STACK_MAX = 50;

  // Dimensão padrão (LARGURA = ALTURA) de cada forma básica ao ser criada — é isso que "trava o
  // formato por padrão": um círculo nasce círculo, não oval, porque w e h começam iguais (pedido do
  // Renato: "as imagens de fluxograma precisam ter o formato travado por padrão, pro círculo não
  // começar como uma forma oval"). O usuário ainda pode distorcer livremente arrastando a alça sem
  // Shift — só o valor INICIAL é que vem sempre proporcional.
  var BASIC_SHAPE_SIZE = { circle: 120, square: 120, triangle: 130, star: 130, pentagon: 130, hexagon: 130 };
  var FLOWCHART_SHAPE_DIMS = { rect: { w: 160, h: 100 }, diamond: { w: 160, h: 120 }, oval: { w: 150, h: 80 } };

  var SHAPE_LABEL = {
    rect: 'retângulo (processo)', diamond: 'losango (decisão)', oval: 'terminal (início/fim)',
    circle: 'círculo', square: 'quadrado', triangle: 'triângulo', star: 'estrela', pentagon: 'pentágono', hexagon: 'hexágono',
  };
  var FLOWCHART_SHAPES = ['rect', 'diamond', 'oval'];
  var BASIC_SHAPES = ['circle', 'square', 'triangle', 'star', 'pentagon', 'hexagon'];

  // ---------- Templates de fluxograma (simples, coloridos, prontos pra jogos) ----------

  var FLOWCHART_TEMPLATES = {
    'game-loop': {
      label: 'Loop de jogo',
      shapes: [
        { key: 'start', type: 'oval', x: 0, y: 15, w: 140, h: 60, color: '#10b981', text: 'Início' },
        { key: 'input', type: 'rect', x: 210, y: 15, w: 160, h: 70, color: '#3b82f6', text: 'Input do Jogador' },
        { key: 'decision', type: 'diamond', x: 440, y: 0, w: 160, h: 100, color: '#f59e0b', text: 'Ação válida?' },
        { key: 'action', type: 'rect', x: 670, y: 15, w: 160, h: 70, color: '#8b5cf6', text: 'Executar Ação' },
        { key: 'update', type: 'rect', x: 900, y: 15, w: 160, h: 70, color: '#8b5cf6', text: 'Atualizar Estado' },
        { key: 'error', type: 'rect', x: 440, y: 190, w: 160, h: 70, color: '#ec4899', text: 'Feedback de Erro' },
      ],
      arrows: [
        { from: 'start', to: 'input' }, { from: 'input', to: 'decision' },
        { from: 'decision', to: 'action' }, { from: 'decision', to: 'error' },
        { from: 'action', to: 'update' }, { from: 'update', to: 'input' }, { from: 'error', to: 'input' },
      ],
    },
    'decisao-simples': {
      label: 'Fluxo de decisão',
      shapes: [
        { key: 'start', type: 'oval', x: 0, y: 20, w: 140, h: 60, color: '#10b981', text: 'Início' },
        { key: 'cond', type: 'diamond', x: 230, y: 0, w: 170, h: 100, color: '#f59e0b', text: 'Condição atendida?' },
        { key: 'yes', type: 'oval', x: 480, y: 20, w: 140, h: 60, color: '#3b82f6', text: 'Fim' },
        { key: 'alt', type: 'rect', x: 230, y: 190, w: 170, h: 70, color: '#8b5cf6', text: 'Ação alternativa' },
      ],
      arrows: [
        { from: 'start', to: 'cond' }, { from: 'cond', to: 'yes' }, { from: 'cond', to: 'alt' }, { from: 'alt', to: 'cond' },
      ],
    },
  };

  var root, muralState, codexRef, callbacks;
  var viewportEl, surfaceEl, emptyHintEl, toolbarEl, panelHostEl, stageEl;
  var isFullscreen = false; // espelha document.fullscreenElement === stageEl, atualizado no evento fullscreenchange
  var view = { scale: 1, tx: 40, ty: 40 };
  var selectedIds = []; // multi-seleção (marquee) — um único item selecionado é só o caso comum, len 1
  var openPanel = null; // { itemId, type: 'color'|'fmt' } — painel flutuante de cor/formatação aberto no momento
  var openMenu = null; // 'pencil'|'line'|'shapes'|'flowchart'|null — dropdown da toolbar aberto no momento
  // Ferramenta ativa do botão esquerdo: 'select' (clique seleciona, arraste no fundo desenha área de
  // seleção), 'pen' (desenho livre — marca-texto ou caneta) ou 'line' (linha tracejada/pontilhada/seta
  // por clique-e-arraste). O botão direito SEMPRE pana o quadro, independente da ferramenta (pedido do
  // Renato: "pan deve funcionar com o botão direito do mouse e botão esquerdo executa ações dos botões").
  var activeTool = 'select';
  var pendingPen = { tool: 'pen', color: GDC.MURAL_PEN_COLORS ? GDC.MURAL_PEN_COLORS[1] : '#18181b' };
  var pendingLineStyle = 'solid';
  var pendingLineColor = GDC.MURAL_ARROW_DEFAULT_COLOR; // cor usada ao criar uma nova seta/conector
  var drawDraft = null; // { x1, y1, x2, y2 } (linha) ou { points: [...] } (traço livre) — prévia durante o arraste
  var arrowDraft = null; // { fromItemId, x1, y1, x2, y2 } — prévia enquanto arrasta uma linha/seta nova
  var addCascade = 0; // incrementa a cada item novo, pra escalonar em diagonal e nunca empilhar exatamente
  var undoStack = [];
  var editSnapshotEl = null; // elemento de texto que já recebeu um snapshot de undo nesta sessão de edição

  function isSelected(id) { return selectedIds.indexOf(id) !== -1; }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function itemById(id) { return muralState.items.filter(function (it) { return it.id === id; })[0] || null; }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function isMuralVisible() { return !!root && root.offsetParent !== null; }

  // ---------- Desfazer: snapshots simples da lista de itens ----------
  // Em vez de rastrear cada operação (mover, redimensionar, editar texto, apagar...) individualmente,
  // guarda uma cópia da lista de itens ANTES de cada gesto que muda algo. É bem mais simples e cobre
  // tudo de uma vez; o custo (uma cópia JSON da lista por gesto, não por pixel arrastado) é irrelevante
  // pro tamanho típico de um mural.
  function pushUndoSnapshot() {
    try {
      undoStack.push(JSON.parse(JSON.stringify(muralState.items)));
      if (undoStack.length > UNDO_STACK_MAX) undoStack.shift();
    } catch (e) { /* ignora — undo é best-effort, nunca deve travar uma ação real */ }
  }

  function performUndo() {
    if (!undoStack.length) return;
    var snapshot = undoStack.pop();
    muralState.items = snapshot;
    selectedIds = [];
    closeFloatPanel();
    closeMenu();
    if (callbacks.onReplaceItems) callbacks.onReplaceItems(snapshot);
    renderItems();
  }

  // ---------- Coordenadas: tela <-> espaço do quadro (considerando pan/zoom) ----------

  function clientToBoard(clientX, clientY) {
    var rect = viewportEl.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  }

  function applySurfaceTransform() {
    if (surfaceEl) surfaceEl.style.transform = 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.scale + ')';
    // A grade de pontinhos (papel milimetrado) vive no viewport, não na surface — a surface tem
    // tamanho 0x0 (só existe pra hospedar itens posicionados livremente), então um background nela
    // nunca teria área pra aparecer. Sincronizar a posição/tamanho do fundo do viewport com o mesmo
    // pan/zoom dá a impressão de que a grade "pertence" ao quadro (rola e dá zoom junto com o
    // conteúdo) mesmo estando, na prática, num elemento de tamanho fixo por trás de tudo.
    if (viewportEl) {
      viewportEl.style.backgroundPosition = view.tx + 'px ' + view.ty + 'px';
      var tile = 22 * view.scale;
      viewportEl.style.backgroundSize = tile + 'px ' + tile + 'px';
    }
  }

  // ---------- Setas/linhas: âncora automática na borda do item mais próxima do outro ponto ----------

  function anchorPointAuto(target, towardX, towardY) {
    var cx = target.x + target.w / 2, cy = target.y + target.h / 2;
    var dx = towardX - cx, dy = towardY - cy;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return { x: cx, y: cy };
    var halfW = Math.max(target.w / 2, 1), halfH = Math.max(target.h / 2, 1);
    var scale = Math.min(halfW / Math.abs(dx || 1e-6), halfH / Math.abs(dy || 1e-6));
    return { x: cx + dx * scale, y: cy + dy * scale };
  }

  function computeArrowPoints(item) {
    var fromTarget = item.fromItemId ? itemById(item.fromItemId) : null;
    var toTarget = item.toItemId ? itemById(item.toItemId) : null;
    var p1 = fromTarget ? { x: fromTarget.x + fromTarget.w / 2, y: fromTarget.y + fromTarget.h / 2 } : { x: item.x1, y: item.y1 };
    var p2 = toTarget ? { x: toTarget.x + toTarget.w / 2, y: toTarget.y + toTarget.h / 2 } : { x: item.x2, y: item.y2 };
    if (fromTarget) p1 = anchorPointAuto(fromTarget, p2.x, p2.y);
    if (toTarget) p2 = anchorPointAuto(toTarget, p1.x, p1.y);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  }

  // ---------- Markup: toolbars, formas, itens ----------

  function entryLinkOptionsMarkup(selectedId) {
    var entries = codexRef ? codexRef.entries : [];
    var opts = entries.map(function (e) {
      return '<option value="' + e.id + '"' + (e.id === selectedId ? ' selected' : '') + '>' + escapeHtml(e.name || '(sem nome)') + '</option>';
    }).join('');
    return '<option value="">Sem vínculo</option>' + opts;
  }

  function linkedEntryBadgeMarkup(item) {
    if (!item.linkedEntryId || !codexRef) return '';
    var entry = codexRef.entries.filter(function (e) { return e.id === item.linkedEntryId; })[0];
    if (!entry) return '';
    return '<button type="button" class="mural-item-link-badge" data-goto-codex-entry="' + entry.id + '" title="Ir para ' + escapeHtml(entry.name) + ' no Codex">' +
      GDC.icon('link-2', { size: 9 }) + escapeHtml(truncateLabel(entry.name)) + '</button>';
  }

  function truncateLabel(str) { return str && str.length > 16 ? str.slice(0, 16).trim() + '…' : str; }

  // Barrinha de gatilhos compacta (cor + formatação) que fica DENTRO do item — só os ícones, sem o
  // painel em si. O painel de verdade (paleta grande / botões de formatação) abre FORA do item, via
  // floatPanelMarkup(), pra não tomar a área de conteúdo de post-its/formas pequenos.
  // Só os botões (sem wrapper posicionado) — a barra combinada de baixo do item (itemBottomBarMarkup,
  // logo abaixo de itemToolbarMarkup) é quem posiciona e alinha isso junto com o vínculo/excluir.
  function quickBtnsMarkup(item) {
    var showColor = item.kind === 'note' || item.kind === 'shape';
    var showFmt = item.kind === 'note' || item.kind === 'shape';
    if (!showColor && !showFmt) return '';
    var colorOpen = !!(openPanel && openPanel.type === 'color' && openPanel.itemId === item.id);
    var fmtOpen = !!(openPanel && openPanel.type === 'fmt' && openPanel.itemId === item.id);
    return (
      (showColor ? '<button type="button" class="mural-item-quick-btn' + (colorOpen ? ' mural-item-quick-btn-active' : '') +
        '" data-mural-panel="color::' + item.id + '" title="Cor" aria-label="Cor do item" aria-haspopup="true" aria-expanded="' + colorOpen + '">' +
        GDC.icon('palette', { size: 12 }) + '</button>' : '') +
      (showFmt ? '<button type="button" class="mural-item-quick-btn mural-item-quick-btn-text' + (fmtOpen ? ' mural-item-quick-btn-active' : '') +
        '" data-mural-panel="fmt::' + item.id + '" title="Formatar texto" aria-label="Formatar texto" aria-haspopup="true" aria-expanded="' + fmtOpen + '">A</button>' : '')
    );
  }

  function fmtPanelContentMarkup() {
    var sizeButtons = FONT_SIZES.map(function (fs) {
      return '<button type="button" class="mural-fmt-size-btn" data-mural-fmt-size="' + fs.px + '" title="' + fs.label + '" aria-label="' + fs.label + '" style="font-size:' + Math.min(fs.px, 14) + 'px">A</button>';
    }).join('');
    return (
      '<p class="mural-float-panel-title">Formatar texto</p>' +
      '<div class="mural-float-fmt-row" role="group" aria-label="Formatação de texto">' +
      '  <button type="button" data-mural-fmt="bold" title="Negrito" aria-label="Negrito">' + GDC.icon('bold', { size: 13 }) + '</button>' +
      '  <button type="button" data-mural-fmt="italic" title="Itálico" aria-label="Itálico">' + GDC.icon('italic', { size: 13 }) + '</button>' +
      '  <button type="button" data-mural-fmt="underline" title="Sublinhado" aria-label="Sublinhado">' + GDC.icon('underline', { size: 13 }) + '</button>' +
      '  <button type="button" data-mural-fmt="insertUnorderedList" title="Lista com marcadores" aria-label="Lista com marcadores">' + GDC.icon('list', { size: 13 }) + '</button>' +
      '  <span class="mural-fmt-sep" aria-hidden="true"></span>' +
      sizeButtons +
      '</div>' +
      '<p class="mural-float-panel-hint">Selecione o texto no item antes de aplicar.</p>'
    );
  }

  function itemToolbarMarkup(item) {
    return (
      '<div class="mural-item-toolbar">' +
      '  <select class="mural-link-select" data-mural-link="' + item.id + '" title="Vincular a uma entrada do Codex" aria-label="Vincular a uma entrada do Codex">' + entryLinkOptionsMarkup(item.linkedEntryId) + '</select>' +
      '  <button type="button" class="mural-item-delete-btn" data-mural-delete="' + item.id + '" title="Excluir (ou tecla Delete)" aria-label="Excluir item">' + GDC.icon('x', { size: 12 }) + '</button>' +
      '</div>'
    );
  }

  // Uma única barra na base do item, com o grupo de cor/formatação à esquerda e o de vínculo/excluir
  // à direita, alinhados na MESMA linha (feedback do Renato: o card de vínculo ficava desalinhado em
  // relação aos botões de cor/texto — antes cada grupo tinha seu próprio "bottom" diferente). O
  // "right" fica com uma folga maior que o "left" pra nunca disputar clique com a alça de
  // redimensionar, que mora bem no canto inferior direito.
  function itemBottomBarMarkup(item) {
    var left = quickBtnsMarkup(item);
    var right = itemToolbarMarkup(item);
    if (!left && !right) return '';
    return (
      '<div class="mural-item-bottombar">' +
      '<div class="mural-item-bottombar-left">' + left + '</div>' +
      '<div class="mural-item-bottombar-right">' + right + '</div>' +
      '</div>'
    );
  }

  function colorPanelContentMarkup(item) {
    var isCustom = GDC.MILESTONE_COLOR_PALETTE.indexOf(item.color) === -1;
    var dots = GDC.MILESTONE_COLOR_PALETTE.map(function (hex) {
      return '<button type="button" class="mural-float-color-swatch' + (item.color === hex ? ' selected' : '') +
        '" data-mural-color="' + item.id + '::' + hex + '" style="background-color:' + hex + '" title="' + hex + '" aria-label="Cor ' + hex + '" aria-pressed="' + (item.color === hex) + '"></button>';
    }).join('');
    return (
      '<p class="mural-float-panel-title">Cor</p>' +
      '<div class="mural-float-color-grid">' + dots +
      '  <label class="mural-float-color-custom' + (isCustom ? ' selected' : '') + '" title="Cor personalizada" aria-label="Escolher cor personalizada"' + (isCustom ? ' style="background-color:' + item.color + ';"' : '') + '>' +
      GDC.icon('palette', { size: 13 }) +
      '    <input type="color" data-mural-color-custom="' + item.id + '" value="' + item.color + '" aria-label="Cor personalizada" />' +
      '  </label>' +
      '</div>'
    );
  }

  function floatPanelMarkup() {
    if (!openPanel) return '';
    var item = itemById(openPanel.itemId);
    if (!item) return '';
    var inner = openPanel.type === 'color' ? colorPanelContentMarkup(item) : fmtPanelContentMarkup();
    var label = openPanel.type === 'color' ? 'Cor do item' : 'Formatar texto';
    return '<div class="mural-float-panel" data-mural-float-panel role="dialog" aria-label="' + label + '">' + inner + '</div>';
  }

  function positionFloatPanel() {
    var panelEl = panelHostEl && panelHostEl.querySelector('[data-mural-float-panel]');
    if (!panelEl || !openPanel) return;
    var anchorEl = surfaceEl.querySelector('[data-mural-panel="' + openPanel.type + '::' + openPanel.itemId + '"]');
    if (!anchorEl) { closeFloatPanel(); return; }
    var ar = anchorEl.getBoundingClientRect();
    var pr = panelEl.getBoundingClientRect();
    var margin = 8;
    var left = ar.left;
    var top = ar.bottom + 6;
    if (left + pr.width > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - pr.width);
    if (top + pr.height > window.innerHeight - margin) top = Math.max(margin, ar.top - pr.height - 6);
    panelEl.style.left = left + 'px';
    panelEl.style.top = top + 'px';
  }

  function renderFloatPanel() {
    if (!panelHostEl) return;
    if (!openPanel || !itemById(openPanel.itemId)) { openPanel = null; panelHostEl.innerHTML = ''; return; }
    panelHostEl.innerHTML = floatPanelMarkup();
    positionFloatPanel();
  }

  function openFloatPanel(itemId, type) {
    openPanel = { itemId: itemId, type: type };
    closeMenu();
    surfaceEl.querySelectorAll('.mural-item-quick-btn-active').forEach(function (b) {
      b.classList.remove('mural-item-quick-btn-active');
      b.setAttribute('aria-expanded', 'false');
    });
    var btn = surfaceEl.querySelector('[data-mural-panel="' + type + '::' + itemId + '"]');
    if (btn) { btn.classList.add('mural-item-quick-btn-active'); btn.setAttribute('aria-expanded', 'true'); }
    renderFloatPanel();
  }

  function closeFloatPanel() {
    if (!openPanel) return;
    openPanel = null;
    if (panelHostEl) panelHostEl.innerHTML = '';
    var openBtn = surfaceEl && surfaceEl.querySelector('.mural-item-quick-btn-active');
    if (openBtn) openBtn.classList.remove('mural-item-quick-btn-active');
  }

  function richTextMarkup(item, placeholder) {
    return '<div class="mural-item-text" data-mural-text="' + item.id + '" contenteditable="true" data-placeholder="' + escapeHtml(placeholder) + '" aria-label="Texto do item" role="textbox" aria-multiline="true">' + item.text + '</div>';
  }

  // Pontos (em % da caixa w x h) de cada forma poligonal — fonte única usada tanto pelo clip-path CSS
  // (shapeStyle, abaixo) quanto pela exportação vetorial em PDF (que precisa dos mesmos pontos como
  // coordenadas reais, não como string CSS), pra nunca haver divergência entre o que aparece na tela
  // e o que sai no PDF.
  var SHAPE_POLY_PCT = {
    diamond: [[50, 2], [98, 50], [50, 98], [2, 50]],
    triangle: [[50, 2], [98, 98], [2, 98]],
    star: [[50, 0], [63, 35], [100, 38], [72, 61], [82, 97], [50, 76], [18, 97], [28, 61], [0, 38], [37, 35]],
    pentagon: [[50, 2], [98, 39], [80, 98], [20, 98], [2, 39]],
    hexagon: [[25, 3], [75, 3], [100, 50], [75, 97], [25, 97], [0, 50]],
  };

  // Caminho SVG (clip-path) de cada forma. rect/square usam borda arredondada simples (retângulo);
  // as demais são polígonos fechados. O clip-path recorta a própria caixa do item (w x h), então os
  // pontos são percentuais — funciona pra qualquer proporção, inclusive quando o usuário distorce a
  // forma livremente (sem Shift) depois de criada.
  function shapeStyle(shapeType) {
    var poly = SHAPE_POLY_PCT[shapeType];
    if (poly) return 'clip-path:polygon(' + poly.map(function (p) { return p[0] + '% ' + p[1] + '%'; }).join(',') + ');';
    if (shapeType === 'oval' || shapeType === 'circle') return 'border-radius:50%;';
    if (shapeType === 'square') return 'border-radius:.375rem;';
    return 'border-radius:.375rem;'; // rect
  }

  function itemKindLabel(item) {
    if (item.kind === 'image') return 'Imagem de referência';
    if (item.kind === 'shape') return 'Forma (' + (SHAPE_LABEL[item.shapeType] || item.shapeType) + ')';
    if (item.kind === 'stroke') return item.tool === 'highlighter' ? 'Traço de marca-texto' : 'Traço de caneta';
    return 'Post-it';
  }

  function itemMarkup(item) {
    var style = 'left:' + item.x + 'px;top:' + item.y + 'px;width:' + item.w + 'px;height:' + item.h + 'px;';
    var selected = isSelected(item.id) ? ' mural-item-selected' : '';
    var inner;
    if (item.kind === 'image') {
      inner = (
        '<div class="mural-item-image-box" data-image-thumb="' + (item.imageId || '') + '" role="img" aria-label="Imagem de referência">' + (item.imageId ? '' : GDC.icon('image', { size: 20 })) + '</div>' +
        '<input type="text" class="mural-item-caption" data-mural-caption="' + item.id + '" placeholder="Legenda (opcional)" aria-label="Legenda da imagem" value="' + escapeHtml(item.caption) + '" />'
      );
    } else if (item.kind === 'shape') {
      inner = (
        '<div class="mural-shape-bg" style="' + shapeStyle(item.shapeType) + 'background-color:' + item.color + ';" aria-hidden="true"></div>' +
        '<div class="mural-shape-text-wrap">' + richTextMarkup(item, 'Rótulo...') + '</div>'
      );
    } else {
      inner = richTextMarkup(item, 'Escreva aqui...');
    }
    return (
      '<div class="mural-item mural-item-' + item.kind + (item.kind === 'shape' ? ' mural-shape-' + item.shapeType : '') + selected +
      '" data-mural-item="' + item.id + '" tabindex="0" aria-label="' + itemKindLabel(item) + ', arraste pela borda pra mover" style="' + style +
      (item.kind === 'note' ? 'background-color:' + item.color + ';' : '') + '">' +
      itemBottomBarMarkup(item) +
      linkedEntryBadgeMarkup(item) +
      inner +
      '<div class="mural-item-resize-handle" data-mural-resize="' + item.id + '" tabindex="0" role="slider" aria-label="Redimensionar item (segure Shift pra manter a proporção)"></div>' +
      '</div>'
    );
  }

  // ---------- Markup: camada SVG de setas/linhas/traços livres ----------

  function usedArrowColors() {
    var set = {};
    set[GDC.MURAL_ARROW_DEFAULT_COLOR] = 1;
    muralState.items.forEach(function (it) { if (it.kind === 'arrow' && (it.lineStyle || 'solid') === 'solid') set[it.color || GDC.MURAL_ARROW_DEFAULT_COLOR] = 1; });
    if (arrowDraft) set[GDC.MURAL_ARROW_DEFAULT_COLOR] = 1;
    return Object.keys(set);
  }

  function markerId(hex) { return 'mural-arrowhead-' + String(hex).replace('#', ''); }

  function svgDefsMarkup() {
    return '<defs>' + usedArrowColors().map(function (hex) {
      return '<marker id="' + markerId(hex) + '" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
        '<path d="M0,0 L10,5 L0,10 Z" fill="' + hex + '"></path></marker>';
    }).join('') + '</defs>';
  }

  var LINE_DASH = { dashed: '10 7', dotted: '1.5 6' };

  function arrowMarkup(item) {
    var pts = computeArrowPoints(item);
    var selected = isSelected(item.id);
    var color = item.color || GDC.MURAL_ARROW_DEFAULT_COLOR;
    var lineStyle = item.lineStyle || 'solid';
    var dash = LINE_DASH[lineStyle] ? ' stroke-dasharray="' + LINE_DASH[lineStyle] + '"' : '';
    var markerAttr = lineStyle === 'solid' ? ' marker-end="url(#' + markerId(color) + ')"' : '';
    return (
      '<g data-mural-item="' + item.id + '" class="mural-arrow' + (selected ? ' mural-arrow-selected' : '') + '">' +
      '  <line class="mural-arrow-hit" x1="' + pts.x1 + '" y1="' + pts.y1 + '" x2="' + pts.x2 + '" y2="' + pts.y2 + '" tabindex="0" aria-label="Conector, tecla Delete exclui"></line>' +
      '  <line class="mural-arrow-line" x1="' + pts.x1 + '" y1="' + pts.y1 + '" x2="' + pts.x2 + '" y2="' + pts.y2 + '" style="stroke:' + color + ';"' + dash + markerAttr + '></line>' +
      (selected ? (
        '<circle class="mural-arrow-handle" data-mural-arrow-handle="' + item.id + '::from" cx="' + pts.x1 + '" cy="' + pts.y1 + '" r="6" tabindex="0" aria-label="Ponta inicial, arraste pra reconectar"></circle>' +
        '<circle class="mural-arrow-handle" data-mural-arrow-handle="' + item.id + '::to" cx="' + pts.x2 + '" cy="' + pts.y2 + '" r="6" tabindex="0" aria-label="Ponta final, arraste pra reconectar"></circle>'
      ) : '') +
      '</g>'
    );
  }

  // Botões de cor + excluir de um conector selecionado — de propósito FORA do SVG (não um
  // foreignObject dentro de <g>): a camada de setas (.mural-arrows-layer) é um <svg> de 1x1px com
  // overflow:visible (o quadro é infinito, não tem como dar um tamanho "real" a ela), e nesse caso o
  // Chromium não entrega eventos de ponteiro pro conteúdo de um foreignObject que só aparece
  // visualmente fora da caixa do próprio SVG — o clique cai sempre no elemento por trás. Um <div>
  // posicionado normalmente dentro de .mural-board-surface (mesmo espaço de coordenadas dos
  // .mural-item) não tem esse problema — os itens-caixa já provam isso funcionando bem.
  function arrowControlsMarkup(item) {
    if (!isSelected(item.id)) return '';
    var pts = computeArrowPoints(item);
    var midX = (pts.x1 + pts.x2) / 2, midY = (pts.y1 + pts.y2) / 2;
    var colorOpen = !!(openPanel && openPanel.type === 'color' && openPanel.itemId === item.id);
    return (
      '<div class="mural-arrow-controls" data-mural-arrow-controls="' + item.id + '" style="left:' + (midX - 24) + 'px;top:' + (midY - 11) + 'px;">' +
      '  <button type="button" class="mural-arrow-color-btn' + (colorOpen ? ' mural-item-quick-btn-active' : '') + '" data-mural-panel="color::' + item.id + '" title="Cor da linha" aria-label="Cor da linha" aria-haspopup="true" aria-expanded="' + colorOpen + '">' + GDC.icon('palette', { size: 11 }) + '</button>' +
      '  <button type="button" class="mural-arrow-delete-btn" data-mural-delete="' + item.id + '" title="Excluir" aria-label="Excluir conector">' + GDC.icon('x', { size: 11 }) + '</button>' +
      '</div>'
    );
  }

  function draftArrowMarkup() {
    if (!arrowDraft) return '';
    var dash = LINE_DASH[arrowDraft.lineStyle] ? ' stroke-dasharray="' + LINE_DASH[arrowDraft.lineStyle] + '"' : ' stroke-dasharray="5 4"';
    return '<line class="mural-arrow-draft" x1="' + arrowDraft.x1 + '" y1="' + arrowDraft.y1 + '" x2="' + arrowDraft.x2 + '" y2="' + arrowDraft.y2 + '"' + dash + '></line>';
  }

  // Traço de desenho livre — um <path> com todos os pontos capturados durante o arraste. A marca-texto
  // usa opacidade reduzida e traço bem mais grosso (efeito de destacar por cima), a caneta é fina e opaca.
  function strokePointsToPath(points) {
    if (!points || !points.length) return '';
    return points.map(function (p, i) { return (i === 0 ? 'M' : 'L') + p.x + ',' + p.y; }).join(' ');
  }

  function strokeMarkup(item) {
    var selected = isSelected(item.id);
    var d = strokePointsToPath(item.points);
    var isHi = item.tool === 'highlighter';
    return (
      '<g data-mural-item="' + item.id + '" class="mural-stroke' + (selected ? ' mural-stroke-selected' : '') + (isHi ? ' mural-stroke-highlighter' : ' mural-stroke-pen') + '">' +
      '  <path class="mural-stroke-hit" d="' + d + '" tabindex="0" aria-label="' + itemKindLabel(item) + ', tecla Delete exclui"></path>' +
      '  <path class="mural-stroke-line" d="' + d + '" style="stroke:' + item.color + ';stroke-width:' + item.strokeWidth + 'px;"></path>' +
      '</g>'
    );
  }

  function draftStrokeMarkup() {
    if (!drawDraft || !drawDraft.points) return '';
    var isHi = pendingPen.tool === 'highlighter';
    return '<path class="mural-stroke-draft' + (isHi ? ' mural-stroke-highlighter' : ' mural-stroke-pen') + '" d="' + strokePointsToPath(drawDraft.points) +
      '" style="stroke:' + pendingPen.color + ';stroke-width:' + (isHi ? 14 : 3) + 'px;"></path>';
  }

  function svgMarkup() {
    var arrows = muralState.items.filter(function (it) { return it.kind === 'arrow'; });
    var strokes = muralState.items.filter(function (it) { return it.kind === 'stroke'; });
    return '<svg class="mural-arrows-layer" aria-hidden="true">' + svgDefsMarkup() +
      strokes.map(strokeMarkup).join('') + arrows.map(arrowMarkup).join('') +
      draftArrowMarkup() + draftStrokeMarkup() + '</svg>';
  }

  // ---------- Render ----------

  function renderArrowsLayer() {
    var svgEl = surfaceEl && surfaceEl.querySelector('.mural-arrows-layer');
    if (!svgEl) return;
    svgEl.outerHTML = svgMarkup();
    bindArrowInteractions();
    // reposiciona ao vivo os controles (fora do SVG) de qualquer seta selecionada — chamado durante o
    // arraste/redimensionamento de um item conectado, então o botão de cor/excluir acompanha a ponta
    // da linha em vez de ficar pra trás até o próximo renderItems().
    muralState.items.forEach(function (it) {
      if (it.kind !== 'arrow' || !isSelected(it.id)) return;
      var el = surfaceEl.querySelector('[data-mural-arrow-controls="' + it.id + '"]');
      if (!el) return;
      var pts = computeArrowPoints(it);
      var midX = (pts.x1 + pts.x2) / 2, midY = (pts.y1 + pts.y2) / 2;
      el.style.left = (midX - 24) + 'px';
      el.style.top = (midY - 11) + 'px';
    });
  }

  function renderItems() {
    var boxItems = muralState.items.filter(function (it) { return it.kind !== 'arrow' && it.kind !== 'stroke'; });
    var arrowItems = muralState.items.filter(function (it) { return it.kind === 'arrow'; });
    surfaceEl.innerHTML = svgMarkup() + boxItems.map(itemMarkup).join('') + arrowItems.map(arrowControlsMarkup).join('');
    if (emptyHintEl) emptyHintEl.style.display = muralState.items.length ? 'none' : '';
    bindItemDrag();
    bindArrowInteractions();
    if (GDC.imageStore) GDC.imageStore.resolveThumbs(surfaceEl);
    renderFloatPanel();
  }

  function deselectAll() {
    if (!selectedIds.length && !openPanel) return;
    selectedIds = [];
    closeFloatPanel();
    renderItems();
  }

  function deleteSelected() {
    if (!selectedIds.length) return;
    pushUndoSnapshot();
    var ids = selectedIds.slice();
    ids.forEach(function (id) { if (callbacks.onDeleteItem) callbacks.onDeleteItem(id); });
    selectedIds = [];
    if (openPanel && ids.indexOf(openPanel.itemId) !== -1) closeFloatPanel();
    renderItems();
  }

  // ---------- Arrastar / redimensionar itens ----------

  function startItemDrag(itemEl, item, startClientX, startClientY) {
    if (openPanel) closeFloatPanel();
    var groupMode = selectedIds.length > 1 && isSelected(item.id);
    if (!groupMode) {
      selectedIds = [item.id];
      surfaceEl.querySelectorAll('.mural-item-selected').forEach(function (n) { n.classList.remove('mural-item-selected'); });
      itemEl.classList.add('mural-item-selected');
    }
    var group = (groupMode ? selectedIds : [item.id]).map(function (id) {
      var it = itemById(id);
      if (!it) return null;
      return { it: it, el: surfaceEl.querySelector('[data-mural-item="' + id + '"]'), startX: it.x, startY: it.y };
    }).filter(Boolean);
    var moved = false;
    var snapshotted = false;

    function onMove(clientX, clientY) {
      var dx = (clientX - startClientX) / view.scale;
      var dy = (clientY - startClientY) / view.scale;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        if (!moved && !snapshotted) { pushUndoSnapshot(); snapshotted = true; }
        moved = true;
      }
      group.forEach(function (g) {
        g.it.x = g.startX + dx;
        g.it.y = g.startY + dy;
        if (g.el) { g.el.style.left = g.it.x + 'px'; g.el.style.top = g.it.y + 'px'; }
      });
      renderArrowsLayer();
    }
    function onMouseMove(e) { onMove(e.clientX, e.clientY); }
    function onTouchMove(e) { if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY); }
    function onUp(clientX, clientY) {
      if (typeof clientX === 'number') onMove(clientX, clientY);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (moved && callbacks.onUpdateItem) {
        group.forEach(function (g) { callbacks.onUpdateItem(g.it.id, { x: g.it.x, y: g.it.y }); });
      }
    }
    function onMouseUp(e) { onUp(e.clientX, e.clientY); }
    function onTouchEnd(e) {
      var t = (e.changedTouches && e.changedTouches[0]) || null;
      onUp(t ? t.clientX : undefined, t ? t.clientY : undefined);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
  }

  // Redimensiona mantendo a proporção original quando Shift está pressionado ("trava o formato") — sem
  // Shift, w e h mudam livremente e a forma pode virar oval/retângulo distorcido (pedido do Renato:
  // "Redimensionar segurando shift aumenta de modo que não mude a forma, enquanto só clicar e segurar
  // livremente, a forma ganha formato livre").
  function startItemResize(itemEl, item, startClientX, startClientY) {
    pushUndoSnapshot();
    var startW = item.w, startH = item.h;
    var ratio = startW / Math.max(startH, 1);
    var minW = item.kind === 'image' ? IMAGE_MIN_W : item.kind === 'shape' ? SHAPE_MIN_W : NOTE_MIN_W;
    var minH = item.kind === 'image' ? IMAGE_MIN_H : item.kind === 'shape' ? SHAPE_MIN_H : NOTE_MIN_H;

    function onMove(clientX, clientY, lock) {
      var dx = (clientX - startClientX) / view.scale;
      var dy = (clientY - startClientY) / view.scale;
      var newW, newH;
      if (lock) {
        if (Math.abs(dx) >= Math.abs(dy)) { newW = startW + dx; newH = newW / ratio; }
        else { newH = startH + dy; newW = newH * ratio; }
      } else {
        newW = startW + dx;
        newH = startH + dy;
      }
      item.w = clamp(newW, minW, 1400);
      item.h = clamp(newH, minH, 1400);
      itemEl.style.width = item.w + 'px';
      itemEl.style.height = item.h + 'px';
      renderArrowsLayer();
    }
    function onMouseMove(e) { onMove(e.clientX, e.clientY, e.shiftKey); }
    function onTouchMove(e) { if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY, false); }
    function onUp(clientX, clientY, lock) {
      if (typeof clientX === 'number') onMove(clientX, clientY, lock);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (callbacks.onUpdateItem) callbacks.onUpdateItem(item.id, { w: item.w, h: item.h });
    }
    function onMouseUp(e) { onUp(e.clientX, e.clientY, e.shiftKey); }
    function onTouchEnd(e) {
      var t = (e.changedTouches && e.changedTouches[0]) || null;
      onUp(t ? t.clientX : undefined, t ? t.clientY : undefined, false);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
  }

  function bindItemDrag() {
    surfaceEl.querySelectorAll('[data-mural-item]').forEach(function (itemEl) {
      var item = itemById(itemEl.getAttribute('data-mural-item'));
      if (!item) return;

      itemEl.addEventListener('mousedown', function (e) {
        if (activeTool !== 'select' || e.button !== 0) return; // pincel/linha desenham por cima; botão direito pana
        if (e.target.closest('[data-mural-resize]') || e.target.closest('textarea,input,select,button,[contenteditable="true"]')) return;
        e.stopPropagation();
        // preventDefault evita que o navegador jogue o foco/cursor de texto pro contenteditable do
        // item (mesmo clicando fora dele, na borda/padding) só porque está perto — sem isso, um
        // arraste que começa perto da borda de um post-it podia acabar com o foco dentro do texto,
        // fazendo o Delete/Backspace (que não apaga o item durante uma edição de texto) parecer que
        // "não funciona" depois de mover o item.
        e.preventDefault();
        startItemDrag(itemEl, item, e.clientX, e.clientY);
      });
      itemEl.addEventListener('touchstart', function (e) {
        if (activeTool !== 'select') return;
        if (e.target.closest('[data-mural-resize]') || e.target.closest('textarea,input,select,button,[contenteditable="true"]')) return;
        e.stopPropagation();
        if (e.touches[0]) startItemDrag(itemEl, item, e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: true });

      var handle = itemEl.querySelector('[data-mural-resize]');
      if (handle) {
        handle.addEventListener('mousedown', function (e) {
          if (activeTool !== 'select' || e.button !== 0) return;
          e.stopPropagation(); e.preventDefault();
          startItemResize(itemEl, item, e.clientX, e.clientY);
        });
        handle.addEventListener('touchstart', function (e) {
          if (activeTool !== 'select') return;
          e.stopPropagation();
          if (e.touches[0]) startItemResize(itemEl, item, e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
      }
    });
  }

  // ---------- Setas/linhas: interação (selecionar, arrastar pontas) ----------

  function bindArrowInteractions() {
    surfaceEl.querySelectorAll('.mural-arrow .mural-arrow-hit').forEach(function (hit) {
      hit.addEventListener('mousedown', function (e) {
        if (activeTool !== 'select' || e.button !== 0) return;
        e.stopPropagation();
        var id = hit.closest('.mural-arrow').getAttribute('data-mural-item');
        if (!(selectedIds.length === 1 && selectedIds[0] === id)) { selectedIds = [id]; renderItems(); }
      });
    });
    surfaceEl.querySelectorAll('.mural-stroke .mural-stroke-hit').forEach(function (hit) {
      hit.addEventListener('mousedown', function (e) {
        if (activeTool !== 'select' || e.button !== 0) return;
        e.stopPropagation();
        var id = hit.closest('.mural-stroke').getAttribute('data-mural-item');
        if (!(selectedIds.length === 1 && selectedIds[0] === id)) { selectedIds = [id]; renderItems(); }
      });
    });
    surfaceEl.querySelectorAll('[data-mural-arrow-handle]').forEach(function (handle) {
      handle.addEventListener('mousedown', function (e) {
        if (activeTool !== 'select' || e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        startArrowHandleDrag(handle);
      });
    });
  }

  function startArrowHandleDrag(handleEl) {
    var raw = handleEl.getAttribute('data-mural-arrow-handle').split('::');
    var id = raw[0], which = raw[1]; // 'from' ou 'to'
    var item = itemById(id);
    if (!item) return;
    pushUndoSnapshot();

    function applyPoint(clientX, clientY) {
      var overEl = document.elementFromPoint(clientX, clientY);
      var overItemEl = overEl && overEl.closest && overEl.closest('[data-mural-item]');
      var overItem = overItemEl ? itemById(overItemEl.getAttribute('data-mural-item')) : null;
      var p = clientToBoard(clientX, clientY);
      var attach = overItem && overItem.id !== id && overItem.kind !== 'arrow' && overItem.kind !== 'stroke' ? overItem.id : null;
      if (which === 'from') { item.fromItemId = attach; item.x1 = p.x; item.y1 = p.y; }
      else { item.toItemId = attach; item.x2 = p.x; item.y2 = p.y; }
      renderArrowsLayer();
    }
    function onMove(e) { applyPoint(e.clientX, e.clientY); }
    function onUp(e) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      applyPoint(e.clientX, e.clientY);
      if (callbacks.onUpdateItem) {
        var patch = which === 'from'
          ? { fromItemId: item.fromItemId, x1: item.x1, y1: item.y1 }
          : { toItemId: item.toItemId, x2: item.x2, y2: item.y2 };
        callbacks.onUpdateItem(id, patch);
      }
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ---------- Ferramenta de linha: criar uma nova conexão (sólida/tracejada/pontilhada) por clique-e-arraste ----------

  function startArrowDraw(startClientX, startClientY, startItem) {
    var p = clientToBoard(startClientX, startClientY);
    var startPoint = startItem ? { x: startItem.x + startItem.w / 2, y: startItem.y + startItem.h / 2 } : p;
    arrowDraft = { fromItemId: startItem ? startItem.id : null, x1: startPoint.x, y1: startPoint.y, x2: p.x, y2: p.y, lineStyle: pendingLineStyle };
    renderArrowsLayer();

    function onMove(clientX, clientY) {
      var q = clientToBoard(clientX, clientY);
      arrowDraft.x2 = q.x; arrowDraft.y2 = q.y;
      renderArrowsLayer();
    }
    function onMouseMove(e) { onMove(e.clientX, e.clientY); }
    function onTouchMove(e) { if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY); }
    function finish(clientX, clientY) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      var overEl = document.elementFromPoint(clientX, clientY);
      var overItemEl = overEl && overEl.closest && overEl.closest('[data-mural-item]');
      var overItem = overItemEl ? itemById(overItemEl.getAttribute('data-mural-item')) : null;
      if (overItem && (overItem.kind === 'arrow' || overItem.kind === 'stroke')) overItem = null;
      var q = clientToBoard(clientX, clientY);
      var draft = arrowDraft;
      arrowDraft = null;
      if (!draft) { renderItems(); return; }
      var x2 = overItem ? overItem.x + overItem.w / 2 : q.x;
      var y2 = overItem ? overItem.y + overItem.h / 2 : q.y;
      var dx = x2 - draft.x1, dy = y2 - draft.y1;
      if (Math.abs(dx) > ARROW_MIN_DRAG || Math.abs(dy) > ARROW_MIN_DRAG) {
        pushUndoSnapshot();
        var created = callbacks.onAddItem({
          kind: 'arrow', color: pendingLineColor, lineStyle: draft.lineStyle,
          fromItemId: draft.fromItemId, fromAnchor: 'auto',
          toItemId: overItem ? overItem.id : null, toAnchor: 'auto',
          x1: draft.x1, y1: draft.y1, x2: x2, y2: y2,
        });
        if (created) selectedIds = [created.id];
      }
      renderItems();
    }
    function onMouseUp(e) { finish(e.clientX, e.clientY); }
    function onTouchEnd(e) {
      var t = (e.changedTouches && e.changedTouches[0]) || null;
      if (t) finish(t.clientX, t.clientY); else finish(startClientX, startClientY);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
  }

  // ---------- Ferramenta de pincel: desenho livre (marca-texto ou caneta) ----------

  function startFreehandDraw(startClientX, startClientY) {
    var p = clientToBoard(startClientX, startClientY);
    drawDraft = { points: [p] };
    renderArrowsLayer();

    function addPoint(clientX, clientY) {
      var q = clientToBoard(clientX, clientY);
      var last = drawDraft.points[drawDraft.points.length - 1];
      if (last && Math.abs(q.x - last.x) < 0.6 && Math.abs(q.y - last.y) < 0.6) return;
      drawDraft.points.push(q);
      renderArrowsLayer();
    }
    function onMouseMove(e) { addPoint(e.clientX, e.clientY); }
    function onTouchMove(e) { if (e.touches[0]) addPoint(e.touches[0].clientX, e.touches[0].clientY); }
    function finish() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      var pts = drawDraft ? drawDraft.points : [];
      drawDraft = null;
      if (pts.length < 2) { renderItems(); return; }
      var xs = pts.map(function (pt) { return pt.x; }), ys = pts.map(function (pt) { return pt.y; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
      var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
      if (maxX - minX < ARROW_MIN_DRAG && maxY - minY < ARROW_MIN_DRAG) { renderItems(); return; }
      pushUndoSnapshot();
      var created = callbacks.onAddItem({
        kind: 'stroke', tool: pendingPen.tool, color: pendingPen.color,
        strokeWidth: pendingPen.tool === 'highlighter' ? 14 : 3,
        points: pts, x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1),
      });
      if (created) selectedIds = [created.id];
      renderItems();
    }
    function onMouseUp() { finish(); }
    function onTouchEnd() { finish(); }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
  }

  // ---------- Pan (botão direito) / seleção por área (botão esquerdo, ferramenta "Selecionar") ----------

  function bindPanZoom() {
    // Fase de captura: desvia o gesto do botão esquerdo pra ferramenta ativa (pincel ou linha) antes
    // de qualquer handler de item/seleção assumir — funciona tanto começando em cima de um item quanto
    // no fundo vazio do quadro.
    viewportEl.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || activeTool === 'select') return;
      // Um controle de verdade (botão de cor/excluir de uma seta selecionada, painel flutuante...)
      // sempre ganha do desvio pra pincel/linha, mesmo com uma dessas ferramentas ainda ativa (elas
      // ficam "sticky" de propósito) — sem essa exceção, clicar num desses botões iniciava um gesto de
      // desenho fantasma aqui, que ao terminar (mesmo sem mover o mouse) re-renderizava o quadro e
      // destruía o próprio botão no meio do clique, comendo o clique (bug real, não só de teste:
      // reproduzível clicando o botão de excluir/cor de uma seta logo depois de desenhá-la). Não inclui
      // contenteditable/input/textarea aqui: começar a desenhar uma linha clicando em cima do texto de
      // um post-it (pra conectar dois itens) é o uso normal da ferramenta "linha" e precisa continuar
      // funcionando.
      if (e.target.closest('button,[data-mural-panel],[data-mural-float-panel]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (activeTool === 'pen') { startFreehandDraw(e.clientX, e.clientY); return; }
      if (activeTool === 'line') {
        var itemEl = e.target.closest('[data-mural-item]');
        var startItem = itemEl ? itemById(itemEl.getAttribute('data-mural-item')) : null;
        if (startItem && (startItem.kind === 'arrow' || startItem.kind === 'stroke')) startItem = null;
        startArrowDraw(e.clientX, e.clientY, startItem);
      }
    }, true);
    viewportEl.addEventListener('touchstart', function (e) {
      if (activeTool === 'select' || !e.touches[0]) return;
      e.preventDefault();
      e.stopPropagation();
      if (activeTool === 'pen') { startFreehandDraw(e.touches[0].clientX, e.touches[0].clientY); return; }
      var itemEl = e.target.closest('[data-mural-item]');
      var startItem = itemEl ? itemById(itemEl.getAttribute('data-mural-item')) : null;
      if (startItem && (startItem.kind === 'arrow' || startItem.kind === 'stroke')) startItem = null;
      startArrowDraw(e.touches[0].clientX, e.touches[0].clientY, startItem);
    }, { capture: true, passive: false });

    // Botão direito em qualquer lugar do quadro pana, sempre — não depende da ferramenta ativa nem de
    // teclas modificadoras (pedido do Renato: pan pelo botão direito, esquerdo livre pras ferramentas).
    viewportEl.addEventListener('mousedown', function (e) {
      if (e.button === 2) { e.preventDefault(); startPan(e); return; }
      if (e.button !== 0 || activeTool !== 'select' || e.target.closest('[data-mural-item]')) return;
      startMarqueeSelect(e);
    });

    function startPan(e) {
      var start = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
      var onMove = function (ev) {
        view.tx = start.tx + (ev.clientX - start.x);
        view.ty = start.ty + (ev.clientY - start.y);
        applySurfaceTransform();
      };
      var onUp = function () {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function startMarqueeSelect(e) {
      deselectAll();
      var startClient = { x: e.clientX, y: e.clientY };
      var startBoard = clientToBoard(e.clientX, e.clientY);
      var vpRect = viewportEl.getBoundingClientRect();
      var boxEl = document.createElement('div');
      boxEl.className = 'mural-marquee-box';
      viewportEl.appendChild(boxEl);

      function updateBox(clientX, clientY) {
        var left = Math.min(startClient.x, clientX) - vpRect.left;
        var top = Math.min(startClient.y, clientY) - vpRect.top;
        boxEl.style.left = left + 'px';
        boxEl.style.top = top + 'px';
        boxEl.style.width = Math.abs(clientX - startClient.x) + 'px';
        boxEl.style.height = Math.abs(clientY - startClient.y) + 'px';
      }
      function applySelection(clientX, clientY) {
        var curBoard = clientToBoard(clientX, clientY);
        var rx1 = Math.min(startBoard.x, curBoard.x), rx2 = Math.max(startBoard.x, curBoard.x);
        var ry1 = Math.min(startBoard.y, curBoard.y), ry2 = Math.max(startBoard.y, curBoard.y);
        var hit = {};
        muralState.items.forEach(function (it) {
          if (it.kind === 'arrow') return; // setas/linhas não entram no marquee — seguem os itens que conectam
          if (it.x < rx2 && it.x + it.w > rx1 && it.y < ry2 && it.y + it.h > ry1) hit[it.id] = true;
        });
        selectedIds = Object.keys(hit);
        surfaceEl.querySelectorAll('.mural-item[data-mural-item]').forEach(function (el) {
          el.classList.toggle('mural-item-selected', !!hit[el.getAttribute('data-mural-item')]);
        });
        surfaceEl.querySelectorAll('.mural-stroke').forEach(function (el) {
          el.classList.toggle('mural-stroke-selected', !!hit[el.getAttribute('data-mural-item')]);
        });
      }
      updateBox(e.clientX, e.clientY);
      applySelection(e.clientX, e.clientY);

      var onMove = function (ev) { updateBox(ev.clientX, ev.clientY); applySelection(ev.clientX, ev.clientY); };
      var onUp = function (ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (boxEl.parentNode) boxEl.parentNode.removeChild(boxEl);
        applySelection(ev.clientX, ev.clientY);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    // Duplo clique sempre cria um post-it ali, em qualquer ferramenta (pedido do Renato) — só não faz
    // nada em cima de um item já existente (não faria sentido empilhar um post-it exatamente ali).
    viewportEl.addEventListener('dblclick', function (e) {
      if (e.target.closest('[data-mural-item]')) return;
      var p = clientToBoard(e.clientX, e.clientY);
      addNoteAt(p.x - 95, p.y - 75);
    });

    viewportEl.addEventListener('wheel', function (e) {
      e.preventDefault();
      view.scale = clamp(view.scale * (e.deltaY > 0 ? 0.9 : 1.1), 0.3, 2.5);
      applySurfaceTransform();
    }, { passive: false });

    // Clique direito não abre o menu nativo do navegador — ele pana o quadro (ver mousedown acima).
    viewportEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  // ---------- Ações: criar itens ----------

  function addNoteAt(x, y) {
    if (!callbacks.onAddItem) return;
    pushUndoSnapshot();
    var created = callbacks.onAddItem({ kind: 'note', x: x, y: y, w: 190, h: 150, color: GDC.MURAL_NOTE_DEFAULT_COLOR, text: '' });
    if (created) { selectedIds = [created.id]; renderItems(); }
  }

  function viewportCenterBoard(jitter) {
    var rect = viewportEl.getBoundingClientRect();
    var jx = 0, jy = 0;
    if (jitter) {
      addCascade = (addCascade + 1) % 9;
      jx = (Math.random() * 16 - 8) + (addCascade - 4) * 110;
      jy = (Math.random() * 16 - 8) + (addCascade - 4) * 18;
    }
    return clientToBoard(rect.left + rect.width / 2 + jx, rect.top + rect.height / 2 + jy);
  }

  function addShape(shapeType) {
    if (!callbacks.onAddItem) return;
    var dims = FLOWCHART_SHAPE_DIMS[shapeType] || { w: BASIC_SHAPE_SIZE[shapeType] || 120, h: BASIC_SHAPE_SIZE[shapeType] || 120 };
    var w = dims.w, h = dims.h;
    var p = viewportCenterBoard(true);
    pushUndoSnapshot();
    var created = callbacks.onAddItem({ kind: 'shape', shapeType: shapeType, x: p.x - w / 2, y: p.y - h / 2, w: w, h: h, color: GDC.MURAL_SHAPE_DEFAULT_COLOR, text: '' });
    if (created) { selectedIds = [created.id]; renderItems(); }
  }

  function addImageFile(file) {
    if (!file || !GDC.imageStore || !callbacks.onAddItem) return;
    GDC.imageStore.put(file).then(function (meta) {
      var w = 220, h = 160;
      if (meta.width && meta.height) {
        w = Math.min(260, Math.max(IMAGE_MIN_W, meta.width));
        h = clamp(w * (meta.height / meta.width), IMAGE_MIN_H, 340);
      }
      var center = viewportCenterBoard(true);
      pushUndoSnapshot();
      var created = callbacks.onAddItem({ kind: 'image', imageId: meta.id, x: center.x - w / 2, y: center.y - h / 2, w: w, h: h, caption: '' });
      if (created) { selectedIds = [created.id]; renderItems(); }
    });
  }

  // Insere um template de fluxograma inteiro (formas + setas já conectadas) de uma vez, centralizado
  // no quadro, e ajusta o zoom pra ele caber inteiro na tela — templates são bem mais largos que a
  // viewport em escala 1.
  function insertTemplate(key) {
    var tpl = FLOWCHART_TEMPLATES[key];
    if (!tpl || !callbacks.onAddItem) return;
    pushUndoSnapshot();
    var maxX = 0, maxY = 0;
    tpl.shapes.forEach(function (s) { maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h); });
    var origin = { x: -maxX / 2, y: -maxY / 2 };
    var idMap = {};
    tpl.shapes.forEach(function (s) {
      var created = callbacks.onAddItem({
        kind: 'shape', shapeType: s.type, x: origin.x + s.x, y: origin.y + s.y, w: s.w, h: s.h, color: s.color, text: s.text,
      });
      if (created) idMap[s.key] = created.id;
    });
    tpl.arrows.forEach(function (a) {
      if (!idMap[a.from] || !idMap[a.to]) return;
      callbacks.onAddItem({
        kind: 'arrow', color: GDC.MURAL_ARROW_DEFAULT_COLOR, lineStyle: 'solid',
        fromItemId: idMap[a.from], fromAnchor: 'auto', toItemId: idMap[a.to], toAnchor: 'auto',
        x1: 0, y1: 0, x2: 0, y2: 0,
      });
    });
    selectedIds = [];
    renderItems();
    fitViewToBounds(origin.x - 30, origin.y - 30, origin.x + maxX + 30, origin.y + maxY + 30);
  }

  function fitViewToBounds(x1, y1, x2, y2) {
    if (!viewportEl) return;
    var vpRect = viewportEl.getBoundingClientRect();
    var w = Math.max(x2 - x1, 1), h = Math.max(y2 - y1, 1);
    var scale = clamp(Math.min(vpRect.width / w, vpRect.height / h, 1.1), 0.3, 2.5);
    view.scale = scale;
    view.tx = vpRect.width / 2 - ((x1 + x2) / 2) * scale;
    view.ty = vpRect.height / 2 - ((y1 + y2) / 2) * scale;
    applySurfaceTransform();
  }

  // ---------- Ferramenta ativa / menus da toolbar ----------

  function setActiveTool(tool) {
    activeTool = tool;
    if (tool !== 'select') deselectAll();
    viewportEl.classList.toggle('mural-draw-mode', tool === 'pen');
    viewportEl.classList.toggle('mural-line-mode', tool === 'line');
    renderToolbar();
  }

  function closeMenu() {
    if (!openMenu) return;
    openMenu = null;
    renderToolbar();
  }

  function toggleMenu(name) {
    openMenu = openMenu === name ? null : name;
    if (openPanel) closeFloatPanel();
    renderToolbar();
  }

  // ---------- Formatação de texto (negrito/itálico/sublinhado/lista/tamanho) ----------

  function currentTextTarget() {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    var node = sel.getRangeAt(0).commonAncestorContainer;
    var el = node.nodeType === 1 ? node : node.parentElement;
    return el ? el.closest('[data-mural-text]') : null;
  }

  function syncTextFromEl(el) {
    var id = el.getAttribute('data-mural-text');
    var item = itemById(id);
    if (!item) return;
    item.text = el.innerHTML;
    if (callbacks.onUpdateItem) callbacks.onUpdateItem(id, { text: item.text });
  }

  function applyFontSize(px) {
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    var range = sel.getRangeAt(0);
    var span = document.createElement('span');
    span.style.fontSize = px + 'px';
    try {
      range.surroundContents(span);
    } catch (e) {
      var frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    sel.removeAllRanges();
    var after = document.createRange();
    after.selectNodeContents(span);
    sel.addRange(after);
  }

  // ---------- Markup: toolbar (card com ícones, dropdowns de pincel/linha/formas/fluxograma) ----------

  function tmenuSwatchesMarkup(prefix, colors, current) {
    return '<div class="mural-tmenu-swatches">' + colors.map(function (hex) {
      return '<button type="button" class="mural-tmenu-swatch' + (current === hex ? ' selected' : '') + '" data-mural-pick="' + prefix + '::' + hex + '" style="background-color:' + hex + '" title="' + hex + '" aria-label="Cor ' + hex + '"></button>';
    }).join('') + '</div>';
  }

  function pencilMenuMarkup() {
    return (
      '<div class="mural-tmenu" role="menu" aria-label="Desenho livre">' +
      '  <p class="mural-tmenu-label">' + GDC.icon('highlighter', { size: 12 }) + 'Marca-texto</p>' +
      tmenuSwatchesMarkup('highlighter', GDC.MURAL_HIGHLIGHTER_COLORS, activeTool === 'pen' && pendingPen.tool === 'highlighter' ? pendingPen.color : null) +
      '  <p class="mural-tmenu-label">' + GDC.icon('pencil', { size: 12 }) + 'Caneta</p>' +
      tmenuSwatchesMarkup('pen', GDC.MURAL_PEN_COLORS, activeTool === 'pen' && pendingPen.tool === 'pen' ? pendingPen.color : null) +
      '</div>'
    );
  }

  function lineMenuMarkup() {
    var opts = [
      { key: 'dashed', label: 'Tracejado', icon: 'dashed-line' },
      { key: 'dotted', label: 'Pontilhado', icon: 'minus' },
      { key: 'solid', label: 'Seta', icon: 'arrow-up-right' },
    ];
    return (
      '<div class="mural-tmenu" role="menu" aria-label="Estilo de linha">' +
      opts.map(function (o) {
        var active = activeTool === 'line' && pendingLineStyle === o.key;
        return '<button type="button" class="mural-tmenu-item' + (active ? ' mural-tmenu-item-active' : '') + '" data-action="mural-pick-line" data-line-style="' + o.key + '">' + GDC.icon(o.icon, { size: 14 }) + o.label + '</button>';
      }).join('') +
      '  <p class="mural-tmenu-label">' + GDC.icon('palette', { size: 12 }) + 'Cor</p>' +
      tmenuSwatchesMarkup('line-color', GDC.MURAL_LINE_COLORS, pendingLineColor) +
      '</div>'
    );
  }

  function shapesMenuMarkup() {
    return (
      '<div class="mural-tmenu mural-tmenu-grid" role="menu" aria-label="Formas básicas">' +
      BASIC_SHAPES.map(function (s) {
        return '<button type="button" class="mural-tmenu-item" data-action="mural-add-shape" data-shape="' + s + '" title="' + SHAPE_LABEL[s] + '">' + GDC.icon(s, { size: 16 }) + '</button>';
      }).join('') +
      '</div>'
    );
  }

  function flowchartMenuMarkup() {
    var shapeBtns = FLOWCHART_SHAPES.map(function (s) {
      var iconName = s === 'rect' ? 'square' : s === 'diamond' ? 'diamond' : 'circle';
      return '<button type="button" class="mural-tmenu-item" data-action="mural-add-shape" data-shape="' + s + '">' + GDC.icon(iconName, { size: 14 }) + SHAPE_LABEL[s] + '</button>';
    }).join('');
    var templateBtns = Object.keys(FLOWCHART_TEMPLATES).map(function (key) {
      return '<button type="button" class="mural-tmenu-item" data-action="mural-insert-template" data-template="' + key + '">' + GDC.icon('workflow', { size: 14 }) + FLOWCHART_TEMPLATES[key].label + '</button>';
    }).join('');
    return (
      '<div class="mural-tmenu" role="menu" aria-label="Fluxograma">' +
      '  <p class="mural-tmenu-label">Elementos</p>' + shapeBtns +
      '  <p class="mural-tmenu-label">Templates prontos</p>' + templateBtns +
      '</div>'
    );
  }

  function toolbarBtn(opts) {
    // opts: { action, title, icon, active, danger, hasMenu }
    return '<button type="button" class="mural-tbtn' + (opts.active ? ' mural-tbtn-active' : '') + (opts.danger ? ' mural-tbtn-danger' : '') +
      '" data-action="' + opts.action + '" title="' + opts.title + '" aria-label="' + opts.title + '"' +
      (opts.hasMenu ? ' aria-haspopup="true" aria-expanded="' + (openMenu === opts.menuName) + '"' : '') + '>' +
      GDC.icon(opts.icon, { size: 16 }) + '</button>';
  }

  function toolbarInnerMarkup() {
    return (
      toolbarBtn({ action: 'mural-undo', title: 'Desfazer', icon: 'undo-2' }) +
      '<span class="mural-tsep" aria-hidden="true"></span>' +
      toolbarBtn({ action: 'mural-tool-select', title: 'Selecionar (clique)', icon: 'mouse-pointer', active: activeTool === 'select' }) +
      toolbarBtn({ action: 'mural-tool-select', title: 'Selecionar área (arraste)', icon: 'select-area', active: activeTool === 'select' }) +
      toolbarBtn({ action: 'mural-add-note', title: 'Post-it (ou duplo clique no quadro)', icon: 'sticky-note' }) +
      '<span class="mural-tsep" aria-hidden="true"></span>' +
      '<span class="mural-tmenu-wrap">' + toolbarBtn({ action: 'mural-menu-pencil', title: 'Desenho livre: marca-texto ou caneta', icon: 'pencil', active: activeTool === 'pen', hasMenu: true, menuName: 'pencil' }) + (openMenu === 'pencil' ? pencilMenuMarkup() : '') + '</span>' +
      '<span class="mural-tmenu-wrap">' + toolbarBtn({ action: 'mural-menu-line', title: 'Linha: tracejada, pontilhada ou seta', icon: 'dashed-line', active: activeTool === 'line', hasMenu: true, menuName: 'line' }) + (openMenu === 'line' ? lineMenuMarkup() : '') + '</span>' +
      '<span class="mural-tmenu-wrap">' + toolbarBtn({ action: 'mural-menu-shapes', title: 'Formas básicas', icon: 'shapes', hasMenu: true, menuName: 'shapes' }) + (openMenu === 'shapes' ? shapesMenuMarkup() : '') + '</span>' +
      '<span class="mural-tmenu-wrap">' + toolbarBtn({ action: 'mural-menu-flowchart', title: 'Fluxograma: elementos e templates prontos', icon: 'workflow', hasMenu: true, menuName: 'flowchart' }) + (openMenu === 'flowchart' ? flowchartMenuMarkup() : '') + '</span>' +
      '<label class="mural-tbtn" title="Adicionar imagem de referência" aria-label="Adicionar imagem de referência">' + GDC.icon('image', { size: 16 }) +
      '  <input type="file" accept="image/*" class="hidden" data-mural-add-image aria-label="Adicionar imagem de referência" />' +
      '</label>' +
      '<span class="mural-tsep" aria-hidden="true"></span>' +
      toolbarBtn({ action: 'mural-zoom-out', title: 'Diminuir zoom', icon: 'minus' }) +
      '<button type="button" class="mural-tbtn mural-tbtn-text" data-action="mural-zoom-100" title="Zoom 100%" aria-label="Zoom 100%">100%</button>' +
      toolbarBtn({ action: 'mural-zoom-in', title: 'Aumentar zoom', icon: 'plus' }) +
      toolbarBtn({ action: 'mural-recenter', title: 'Voltar pro centro do quadro', icon: 'crosshair' }) +
      '<span class="mural-tsep" aria-hidden="true"></span>' +
      toolbarBtn({ action: 'mural-delete-selected', title: 'Apagar selecionado(s) (ou tecla Delete)', icon: 'trash-2', danger: true }) +
      // Padrão de todas as ferramentas de quadro: exportar + tela cheia no canto direito da barra.
      '<span class="wp-stage-spacer"></span>' +
      toolbarBtn({ action: 'mural-export-pdf', title: 'Exportar o quadro como PDF', icon: 'download' }) +
      GDC.fullscreen.buttonMarkup('mural-tbtn', isFullscreen, 'data-action="mural-toggle-fullscreen"')
    );
  }

  function renderToolbar() {
    if (toolbarEl) toolbarEl.innerHTML = toolbarInnerMarkup();
  }

  // ---------- Tela cheia (padrão do app: js/fullscreen.js) ----------

  function toggleFullscreen() {
    if (stageEl) GDC.fullscreen.toggle(stageEl);
  }

  function handleFullscreenChange(e) {
    isFullscreen = !!(e && e.detail && e.detail.active);
    renderToolbar();
    if (openPanel) renderFloatPanel(); // reposiciona o painel flutuante (fixed) pro novo tamanho do palco
  }

  // ---------- Exportar como PDF ----------
  // Gera um PDF vetorial de verdade (GDC.pdfWriter — sem bibliotecas externas, o app é 100%
  // local/offline) e dispara o download direto de um arquivo .pdf, sem passar pelo diálogo de
  // impressão do navegador (pedido do Renato: "só baixar diretamente, sem abrir janela de
  // impressão" — a primeira versão usava window.print(), que além de abrir a janela também
  // rasterizava tudo pro papel em vez de manter formas/texto como vetor de verdade).
  var MURAL_PDF_MAX_PAGE_W = 2200; // pt — teto de tamanho de página; acima disso, escala tudo pra baixo

  function computeItemsBounds() {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    var touched = false;
    muralState.items.forEach(function (it) {
      if (it.kind === 'arrow') {
        var pts = computeArrowPoints(it);
        [[pts.x1, pts.y1], [pts.x2, pts.y2]].forEach(function (p) {
          minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
          maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
          touched = true;
        });
        return;
      }
      if (it.kind === 'stroke') {
        (it.points || []).forEach(function (p) {
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
          touched = true;
        });
        return;
      }
      minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + it.w); maxY = Math.max(maxY, it.y + it.h);
      touched = true;
    });
    if (!touched) return { x: 0, y: 0, w: 800, h: 600 };
    var pad = 40;
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
  }

  // Converte o HTML rico do item (contenteditable — pode ter negrito/itálico/listas) num texto puro
  // com quebras de linha, já que o PDF vetorial não tenta reproduzir a formatação rica, só o
  // conteúdo — <div>/<p>/<li>/<br> viram '\n'.
  function htmlToPlainText(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    tmp.querySelectorAll('br').forEach(function (br) { br.replaceWith(document.createTextNode('\n')); });
    tmp.querySelectorAll('div,p,li').forEach(function (el) { el.insertAdjacentText('afterend', '\n'); });
    return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  }

  // Clareia uma cor misturando com branco — aproxima visualmente a opacidade reduzida do marca-texto
  // sem precisar de transparência real no PDF (que exigiria um ExtGState à parte).
  function lightenHex(hex, amount) {
    var c = String(hex || '#000000').replace('#', '');
    if (c.length === 3) c = c.split('').map(function (ch) { return ch + ch; }).join('');
    var n = parseInt(c, 16) || 0;
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * amount); g = Math.round(g + (255 - g) * amount); b = Math.round(b + (255 - b) * amount);
    return '#' + [r, g, b].map(function (v) { var s = v.toString(16); return s.length < 2 ? '0' + s : s; }).join('');
  }

  // Triângulo de ponta de seta, orientado na direção do traço (mesmo efeito visual do marcador SVG
  // usado na tela, só que como um polígono preenchido de verdade — PDF não tem marker-end).
  function arrowHeadTriangle(x1, y1, x2, y2, size) {
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len, px = -uy, py = ux;
    var backX = x2 - ux * size, backY = y2 - uy * size;
    return [
      { x: x2, y: y2 },
      { x: backX + px * size * 0.5, y: backY + py * size * 0.5 },
      { x: backX - px * size * 0.5, y: backY - py * size * 0.5 },
    ];
  }

  function loadImageElement(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }

  // Recorte "cover" (preenche a caixa sem distorcer, cortando o excesso) — reproduz o
  // object-fit:cover usado na tela, pra imagem no PDF ficar igual à que aparece no quadro.
  function coverCropRect(srcW, srcH, boxW, boxH) {
    var srcRatio = srcW / srcH, boxRatio = boxW / boxH;
    var cropW, cropH, cropX, cropY;
    if (srcRatio > boxRatio) { cropH = srcH; cropW = srcH * boxRatio; cropX = (srcW - cropW) / 2; cropY = 0; }
    else { cropW = srcW; cropH = srcW / boxRatio; cropX = 0; cropY = (srcH - cropH) / 2; }
    return { x: cropX, y: cropY, w: cropW, h: cropH };
  }

  // Reaproveita o encoder JPEG do próprio navegador (canvas.toDataURL) — não precisamos implementar
  // compressão de imagem nós mesmos; o PDF só embute os bytes JPEG resultantes direto (/DCTDecode).
  function imageToJpegBytes(img, boxW, boxH) {
    var srcW = img.naturalWidth || img.width, srcH = img.naturalHeight || img.height;
    var crop = coverCropRect(srcW, srcH, boxW, boxH);
    var maxDim = 900;
    var outW = boxW >= boxH ? maxDim : Math.max(1, Math.round(maxDim * (boxW / boxH)));
    var outH = boxW >= boxH ? Math.max(1, Math.round(maxDim * (boxH / boxW))) : maxDim;
    var canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, outW, outH);
    var base64 = canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
    return { data: atob(base64), width: outW, height: outH };
  }

  function downloadBytes(bytes, filename, mime) {
    var blob = new Blob([bytes], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function exportMuralPdf() {
    if (!muralState.items.length) return;
    var bounds = computeItemsBounds();
    var scale = bounds.w > MURAL_PDF_MAX_PAGE_W ? MURAL_PDF_MAX_PAGE_W / bounds.w : 1;
    var pageW = bounds.w * scale, pageH = bounds.h * scale;
    function ox(x) { return (x - bounds.x) * scale; }
    function oy(y) { return (y - bounds.y) * scale; }

    var boxItems = muralState.items.filter(function (it) { return it.kind !== 'arrow' && it.kind !== 'stroke'; });
    var arrowItems = muralState.items.filter(function (it) { return it.kind === 'arrow'; });
    var strokeItems = muralState.items.filter(function (it) { return it.kind === 'stroke'; });
    var imageItems = boxItems.filter(function (it) { return it.kind === 'image' && it.imageId; });

    var imgPromises = (GDC.imageStore ? imageItems.map(function (it) {
      return GDC.imageStore.getURL(it.imageId)
        .then(function (url) { return loadImageElement(url); })
        .then(function (img) { return imageToJpegBytes(img, Math.max(it.w * scale, 1), Math.max(it.h * scale, 1)); })
        .then(function (jpeg) { return { item: it, jpeg: jpeg }; })
        .catch(function () { return { item: it, jpeg: null }; });
    }) : []);

    Promise.all(imgPromises).then(function (resolvedImages) {
      var jpegByItemId = {};
      resolvedImages.forEach(function (r) { if (r.jpeg) jpegByItemId[r.item.id] = r.jpeg; });

      var doc = GDC.pdfWriter.create(pageW, pageH);
      doc.fillRect(0, 0, pageW, pageH, '#fafafa'); // fundo "papel"

      // traços livres primeiro, igual à ordem na tela (ficam atrás dos post-its/formas)
      strokeItems.forEach(function (it) {
        var pts = (it.points || []).map(function (p) { return { x: ox(p.x), y: oy(p.y) }; });
        var color = it.tool === 'highlighter' ? lightenHex(it.color, 0.55) : it.color;
        doc.strokePolyline(pts, color, Math.max((it.strokeWidth || 3) * scale, 0.5));
      });

      // setas/conectores
      arrowItems.forEach(function (it) {
        var pts = computeArrowPoints(it);
        var p1 = { x: ox(pts.x1), y: oy(pts.y1) }, p2 = { x: ox(pts.x2), y: oy(pts.y2) };
        var color = it.color || GDC.MURAL_ARROW_DEFAULT_COLOR;
        var lineStyle = it.lineStyle || 'solid';
        var dashSrc = LINE_DASH[lineStyle];
        var dash = dashSrc ? dashSrc.split(' ').map(function (n) { return Number(n) * scale; }) : null;
        doc.strokePolyline([p1, p2], color, Math.max(2 * scale, 0.5), dash);
        if (lineStyle === 'solid') doc.fillPolygon(arrowHeadTriangle(p1.x, p1.y, p2.x, p2.y, Math.max(9 * scale, 3)), color);
      });

      // post-its, formas e imagens — os raios abaixo espelham os border-radius reais da tela (.mural-item
      // é 12px pra post-it/imagem; shapeStyle() usa 6px pra retângulo/quadrado), pra não sair com
      // cantos retos onde na tela eles são arredondados (feedback do Renato).
      var RADIUS_BOX = 12 * scale, RADIUS_SHAPE_RECT = 6 * scale;
      boxItems.forEach(function (it) {
        var x = ox(it.x), y = oy(it.y), w = it.w * scale, h = it.h * scale;
        if (it.kind === 'image') {
          var jpeg = jpegByItemId[it.id];
          if (jpeg) doc.image(x, y, w, h, jpeg.data, jpeg.width, jpeg.height, RADIUS_BOX);
          else doc.fillRoundedRect(x, y, w, h, RADIUS_BOX, '#e4e4e7');
          if (it.caption) doc.text(x, y + h + 2 * scale, w, 14 * scale, it.caption, { size: Math.max(9 * scale, 6), color: '#3f3f46', align: 'center' });
          return;
        }
        var plain = htmlToPlainText(it.text);
        if (it.kind === 'shape') {
          var poly = SHAPE_POLY_PCT[it.shapeType];
          if (poly) doc.fillPolygon(poly.map(function (p) { return { x: x + (p[0] / 100) * w, y: y + (p[1] / 100) * h }; }), it.color);
          else if (it.shapeType === 'circle' || it.shapeType === 'oval') doc.fillEllipse(x + w / 2, y + h / 2, w / 2, h / 2, it.color);
          else doc.fillRoundedRect(x, y, w, h, RADIUS_SHAPE_RECT, it.color);
          var padS = Math.max(8 * scale, 3);
          doc.text(x + padS, y + padS, Math.max(w - padS * 2, 4), Math.max(h - padS * 2, 4), plain, { size: Math.max(11 * scale, 6), align: 'center', valign: 'middle' });
          return;
        }
        // note
        doc.fillRoundedRect(x, y, w, h, RADIUS_BOX, it.color);
        var padN = Math.max(10 * scale, 4);
        doc.text(x + padN, y + padN, Math.max(w - padN * 2, 4), Math.max(h - padN * 2, 4), plain, { size: Math.max(11 * scale, 6) });
      });

      downloadBytes(doc.build(), 'mural.pdf', 'application/pdf');
    });
  }

  // ---------- Eventos delegados (toolbar + itens) ----------

  function handleRootClick(e) {
    var el;

    if ((el = e.target.closest('[data-goto-codex-entry]'))) {
      if (callbacks.onGotoCodexEntry) callbacks.onGotoCodexEntry(el.getAttribute('data-goto-codex-entry'));
      return;
    }

    if ((el = e.target.closest('[data-action="mural-undo"]'))) { performUndo(); return; }
    if ((el = e.target.closest('[data-action="mural-delete-selected"]'))) { deleteSelected(); return; }
    if ((el = e.target.closest('[data-action="mural-tool-select"]'))) { closeMenu(); setActiveTool('select'); return; }

    if ((el = e.target.closest('[data-action="mural-menu-pencil"]'))) { toggleMenu('pencil'); return; }
    if ((el = e.target.closest('[data-action="mural-menu-line"]'))) { toggleMenu('line'); return; }
    if ((el = e.target.closest('[data-action="mural-menu-shapes"]'))) { toggleMenu('shapes'); return; }
    if ((el = e.target.closest('[data-action="mural-menu-flowchart"]'))) { toggleMenu('flowchart'); return; }

    if ((el = e.target.closest('[data-mural-pick]'))) {
      var parts0 = el.getAttribute('data-mural-pick').split('::');
      // "line-color" é a paleta do menu de linha (seta/tracejado/pontilhado) — só troca a cor usada
      // pra próximas linhas, sem mexer na ferramenta ativa nem no pincel (pedido do Renato: "as
      // setas, tracejados e pontilhados precisam de uma opção de alterar cor").
      if (parts0[0] === 'line-color') { pendingLineColor = parts0[1]; renderToolbar(); return; }
      pendingPen = { tool: parts0[0], color: parts0[1] };
      openMenu = null;
      setActiveTool('pen');
      return;
    }

    if ((el = e.target.closest('[data-action="mural-pick-line"]'))) {
      pendingLineStyle = el.getAttribute('data-line-style');
      openMenu = null;
      setActiveTool('line');
      return;
    }

    if ((el = e.target.closest('[data-action="mural-add-note"]'))) {
      var p = viewportCenterBoard(true);
      addNoteAt(p.x - 95, p.y - 75);
      return;
    }

    if ((el = e.target.closest('[data-action="mural-add-shape"]'))) {
      closeMenu();
      addShape(el.getAttribute('data-shape'));
      return;
    }

    if ((el = e.target.closest('[data-action="mural-insert-template"]'))) {
      closeMenu();
      insertTemplate(el.getAttribute('data-template'));
      return;
    }

    if ((el = e.target.closest('[data-mural-panel]'))) {
      var raw2 = el.getAttribute('data-mural-panel').split('::');
      var panelType = raw2[0], panelItemId = raw2[1];
      if (openPanel && openPanel.itemId === panelItemId && openPanel.type === panelType) closeFloatPanel();
      else openFloatPanel(panelItemId, panelType);
      return;
    }

    if ((el = e.target.closest('[data-mural-delete]'))) {
      var id = el.getAttribute('data-mural-delete');
      pushUndoSnapshot();
      if (callbacks.onDeleteItem) callbacks.onDeleteItem(id);
      selectedIds = selectedIds.filter(function (x) { return x !== id; });
      if (openPanel && openPanel.itemId === id) closeFloatPanel();
      renderItems();
      return;
    }

    if ((el = e.target.closest('[data-mural-color]'))) {
      var parts = el.getAttribute('data-mural-color').split('::');
      var item = itemById(parts[0]);
      if (!item) return;
      pushUndoSnapshot();
      item.color = parts[1];
      if (callbacks.onUpdateItem) callbacks.onUpdateItem(item.id, { color: parts[1] });
      renderItems();
      return;
    }

    if ((el = e.target.closest('[data-action="mural-zoom-in"]'))) { view.scale = clamp(view.scale * 1.2, 0.3, 2.5); applySurfaceTransform(); return; }
    if ((el = e.target.closest('[data-action="mural-zoom-out"]'))) { view.scale = clamp(view.scale / 1.2, 0.3, 2.5); applySurfaceTransform(); return; }
    if ((el = e.target.closest('[data-action="mural-zoom-100"]'))) { view.scale = 1; applySurfaceTransform(); return; }
    if ((el = e.target.closest('[data-action="mural-recenter"]'))) { view.tx = 40; view.ty = 40; applySurfaceTransform(); return; }
    if ((el = e.target.closest('[data-action="mural-toggle-fullscreen"]'))) { toggleFullscreen(); return; }
    if ((el = e.target.closest('[data-action="mural-export-pdf"]'))) { exportMuralPdf(); return; }
  }

  function handleRootMouseDown(e) {
    if (e.target.closest('[data-mural-panel]')) { e.preventDefault(); return; }
    // Clicar num botão/gatilho da própria toolbar não deve ser tratado como "clique fora" que fecha
    // o menu — o clique em si (handleRootClick) já decide se alterna/fecha o menu certo.
    if (e.target.closest('.mural-toolbar-card')) return;

    var fmtEl = e.target.closest('[data-mural-fmt]');
    var sizeEl = e.target.closest('[data-mural-fmt-size]');
    if (!fmtEl && !sizeEl) return;
    e.preventDefault();
    var targetEl = currentTextTarget();
    if (!targetEl) return;
    if (fmtEl) document.execCommand(fmtEl.getAttribute('data-mural-fmt'), false, null);
    else applyFontSize(Number(sizeEl.getAttribute('data-mural-fmt-size')));
    syncTextFromEl(targetEl);
  }

  function handleRootInput(e) {
    var t = e.target;

    if (t.matches('[data-mural-add-image]')) {
      var file = t.files && t.files[0];
      if (file) addImageFile(file);
      t.value = '';
      return;
    }

    if (t.matches('[data-mural-text]')) {
      syncTextFromEl(t);
      return;
    }

    if (t.matches('[data-mural-caption]')) {
      var item2 = itemById(t.getAttribute('data-mural-caption'));
      if (!item2) return;
      item2.caption = t.value;
      if (callbacks.onUpdateItem) callbacks.onUpdateItem(item2.id, { caption: t.value });
      return;
    }

    if (t.matches('[data-mural-link]')) {
      var item3 = itemById(t.getAttribute('data-mural-link'));
      if (!item3) return;
      pushUndoSnapshot();
      item3.linkedEntryId = t.value || null;
      if (callbacks.onUpdateItem) callbacks.onUpdateItem(item3.id, { linkedEntryId: item3.linkedEntryId });
      renderItems();
      return;
    }

    if (t.matches('[data-mural-color-custom]')) {
      var item4 = itemById(t.getAttribute('data-mural-color-custom'));
      if (!item4) return;
      pushUndoSnapshot();
      item4.color = t.value;
      if (callbacks.onUpdateItem) callbacks.onUpdateItem(item4.id, { color: t.value });
      renderItems();
      return;
    }
  }

  function handleRootPaste(e) {
    var t = e.target;
    if (!t.matches || !t.matches('[data-mural-text]')) return;
    e.preventDefault();
    var text = ((e.clipboardData || global.clipboardData || {}).getData) ? (e.clipboardData || global.clipboardData).getData('text/plain') : '';
    document.execCommand('insertText', false, text);
  }

  function handleRootFocusIn(e) {
    var textEl = e.target.closest && e.target.closest('[data-mural-text],[data-mural-caption]');
    if (textEl && editSnapshotEl !== textEl) {
      pushUndoSnapshot();
      editSnapshotEl = textEl;
    }
    var itemEl = e.target.closest && e.target.closest('[data-mural-item]');
    if (!itemEl) return;
    var id = itemEl.getAttribute('data-mural-item');
    if (isSelected(id)) return;
    surfaceEl.querySelectorAll('.mural-item-selected').forEach(function (n) { if (n !== itemEl) n.classList.remove('mural-item-selected'); });
    selectedIds = [id];
    itemEl.classList.add('mural-item-selected');
  }

  function handleRootFocusOut(e) {
    var textEl = e.target.closest && e.target.closest('[data-mural-text],[data-mural-caption]');
    if (textEl && textEl === editSnapshotEl) editSnapshotEl = null;
  }

  function handleGlobalKeydown(e) {
    if (!isMuralVisible()) return;
    var ae = document.activeElement;
    var editing = !!ae && (typeof ae.matches === 'function' && ae.matches('input,textarea,select') || ae.isContentEditable);
    if (e.key === 'Escape') {
      // Só "consome" o Esc (preventDefault) se havia algo pra fechar/desfazer — senão o Esc chega na
      // tela cheia (js/fullscreen.js) e sai dela.
      var consumed = !!(openMenu || activeTool !== 'select' || openPanel || selectedIds.length || editing);
      if (openMenu) closeMenu();
      if (activeTool !== 'select') setActiveTool('select');
      if (openPanel) closeFloatPanel();
      if (selectedIds.length) deselectAll();
      if (editing && ae.blur) ae.blur();
      if (consumed) e.preventDefault();
      return;
    }
    if (editing) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length) {
      e.preventDefault();
      deleteSelected();
    }
  }

  function handleGlobalPanelOutsideClick(e) {
    if (e.target.closest && e.target.closest('.wp-color-popover')) return; // seletor de cor aberto a partir do painel
    if (openPanel && !(e.target.closest && (e.target.closest('[data-mural-float-panel]') || e.target.closest('[data-mural-panel]')))) closeFloatPanel();
    if (openMenu && !(e.target.closest && e.target.closest('.mural-tmenu-wrap'))) closeMenu();
  }

  function handleViewportChangeClosePanel() {
    if (openPanel) closeFloatPanel();
  }

  // ---------- Shell / mount ----------

  function shellMarkup() {
    return (
      '<section id="mural" class="builder-section">' +
      '  <div class="mb-8 text-center">' +
      '    <div class="hero-badge">' + GDC.icon('layout-dashboard', { size: 14, className: 'text-fuchsia-400' }) + 'Quadro de referências</div>' +
      '    <h2 class="font-display text-3xl font-bold text-primary">Mural</h2>' +
      '    <p class="mt-2 text-secondary">Post-its, imagens, fluxogramas com templates prontos e desenho livre à mão — um quadro completo pra organizar ideias e a lógica do jogo visualmente.</p>' +
      '  </div>' +
      // Tudo que precisa continuar visível/funcional em tela cheia mora dentro de #mural-stage — o
      // navegador só renderiza descendentes do elemento em fullscreen (pedido do Renato: "que o card
      // de botões também fique disponível no modo de tela cheia"), então o painel flutuante de
      // cor/formatação (posicionado fixed, normalmente fora do quadro) precisa estar aqui dentro
      // também, senão sumiria enquanto o mural estivesse em tela cheia.
      '  <div class="mural-stage wp-stage" id="mural-stage">' +
      '    <div class="mural-toolbar-card wp-stage-bar" id="mural-toolbar" role="toolbar" aria-label="Ferramentas do mural"></div>' +
      '    <div class="mural-board-wrap">' +
      '      <div class="mural-board-viewport" id="mural-viewport">' +
      '        <div class="mural-board-surface" id="mural-surface"></div>' +
      '      </div>' +
      '      <p class="mural-empty-hint" id="mural-empty-hint">O quadro está vazio — use os botões acima ou dê duplo clique aqui pra criar o primeiro post-it.</p>' +
      '    </div>' +
      '    <div class="mural-float-panel-host" id="mural-panel-host"></div>' +
      '  </div>' +
      '  <div class="tab-help-note">' + GDC.icon('info', { size: 16 }) +
      '    <p><strong>Como funciona:</strong> botão direito do mouse (ou arrastar com dois dedos) pana o quadro; o botão esquerdo executa a ferramenta ativa. Com "Selecionar" ativo, clique escolhe um item e arrastar no fundo desenha uma área de seleção (vários itens de uma vez). Pincel e linha ficam ativos até você trocar de ferramenta ou apertar Esc. Redimensione pela alça no canto — segure Shift pra manter a proporção. Duplo clique no quadro cria um post-it ali. Delete/Backspace ou o ícone de lixeira apagam o(s) item(ns) selecionado(s); a lixeira de "Desfazer" volta a última alteração.</p>' +
      '  </div>' +
      '</section>'
    );
  }

  function mount(container, opts) {
    root = container;
    muralState = opts.mural;
    codexRef = opts.codex || { types: [], entries: [] };
    callbacks = { onAddItem: opts.onAddItem, onUpdateItem: opts.onUpdateItem, onDeleteItem: opts.onDeleteItem, onReplaceItems: opts.onReplaceItems, onGotoCodexEntry: opts.onGotoCodexEntry };
    selectedIds = [];
    openPanel = null;
    openMenu = null;
    activeTool = 'select';
    pendingLineStyle = 'solid';
    pendingLineColor = GDC.MURAL_ARROW_DEFAULT_COLOR;
    drawDraft = null;
    arrowDraft = null;
    addCascade = 0;
    undoStack = [];
    editSnapshotEl = null;
    view = { scale: 1, tx: 40, ty: 40 };

    root.innerHTML = shellMarkup();
    viewportEl = root.querySelector('#mural-viewport');
    surfaceEl = root.querySelector('#mural-surface');
    emptyHintEl = root.querySelector('#mural-empty-hint');
    toolbarEl = root.querySelector('#mural-toolbar');
    panelHostEl = root.querySelector('#mural-panel-host');
    stageEl = root.querySelector('#mural-stage');
    stageEl.addEventListener('wpfullscreenchange', handleFullscreenChange);
    isFullscreen = false;

    root.addEventListener('click', handleRootClick);
    root.addEventListener('mousedown', handleRootMouseDown);
    root.addEventListener('input', handleRootInput);
    root.addEventListener('change', handleRootInput);
    root.addEventListener('paste', handleRootPaste, true);
    root.addEventListener('focusin', handleRootFocusIn);
    root.addEventListener('focusout', handleRootFocusOut);
    document.addEventListener('keydown', handleGlobalKeydown);
    document.addEventListener('mousedown', handleGlobalPanelOutsideClick, true);
    global.addEventListener('resize', handleViewportChangeClosePanel);
    global.addEventListener('scroll', handleViewportChangeClosePanel, true);

    bindPanZoom();
    applySurfaceTransform();
    renderToolbar();
    renderItems();
  }

  function reset(mural, codex) {
    muralState = mural;
    codexRef = codex || { types: [], entries: [] };
    selectedIds = [];
    openPanel = null;
    openMenu = null;
    activeTool = 'select';
    drawDraft = null;
    arrowDraft = null;
    undoStack = [];
    if (viewportEl) { viewportEl.classList.remove('mural-draw-mode'); viewportEl.classList.remove('mural-line-mode'); }
    if (panelHostEl) panelHostEl.innerHTML = '';
    if (surfaceEl) { renderToolbar(); renderItems(); }
  }

  GDC.ui.mural = { mount: mount, reset: reset };
}(window));
