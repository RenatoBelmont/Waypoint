/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var root, toolsState, skillTreeRef, codexRef, onGotoCodexEntry, onToolChange, openTool, activeProjectType;

  // `types: null` (ausente) = disponível pra qualquer tipo de projeto. Uma lista restringe a
  // ferramenta àqueles tipos — assim XP Balancer/Loot Simulator/etc. (pensadas pra progressão e
  // economia de jogo digital) não aparecem num projeto de boardgame, e vice-versa.
  var TOOL_DEFS = [
    { key: 'cardDesigner', label: 'Designer de Cartas', types: null, description: 'Desenhe o layout de uma carta e gere uma folha pronta pra imprimir com todas as cartas do baralho.', icon: 'square', color: '#ec4899',
      note: 'Inspirado em ferramentas como o NanDeck, Tabletop Creator e Shuffle: defina o tamanho da carta e os campos (texto, imagem, ícones) uma vez, preencha uma linha de dados por carta na tabela, e "Gerar folha para impressão" tila todas as cartas em páginas prontas pra imprimir ou salvar como PDF pelo diálogo de impressão do navegador.' },
    { key: 'xpBalancer', label: 'XP Balancer', types: ['jogo-digital'], description: 'Modele curvas de nível e visualize a progressão de experiência.', icon: 'trending-up', color: '#3b82f6',
      note: 'Calcula a curva de experiência por nível a partir de uma fórmula exponencial (XP base × nível ^ expoente) — ajuste os valores para ver o total de XP e a progressão em tempo real.' },
    { key: 'lootSimulator', label: 'Loot Simulator', types: ['jogo-digital'], description: 'Valide taxas de drop com simulação de Monte Carlo antes de lançar.', icon: 'dices', color: '#84cc16',
      note: 'Roda uma simulação de Monte Carlo com as taxas de drop informadas, repetindo pelo número de simulações definido, para validar se as probabilidades fazem sentido antes de implementar no jogo.' },
    { key: 'economySimulator', label: 'Economy Simulator', types: ['jogo-digital'], description: 'Projete o saldo de moeda do jogador por nível — fontes contra custos.', icon: 'sliders', color: '#f59e0b',
      note: 'Puxa ao vivo as taxas do Loot Simulator (você só atribui um valor em moeda pra cada item) e o nível máximo do XP Balancer, soma fontes/custos manuais, e mostra o saldo acumulado nível a nível contra o custo total já calculado pela Árvore de Habilidades — pra ver em que nível o jogo já deu moeda suficiente pra desbloquear tudo.' },
    { key: 'combatBalance', label: 'Combat Balance', types: ['jogo-digital'], description: 'Confira o ritmo de combate — golpes pra matar e pra morrer, por nível.', icon: 'crosshair', color: '#f43f5e',
      note: 'Você define uma curva de poder do jogador (ataque e HP por nível, mesmo formato base × nível ^ expoente do XP Balancer) e uma lista de inimigos de referência, cada um numa camada de nível. Pra cada um, calcula quantos golpes o jogador leva pra matar (TTK) e quantos golpes aguenta levar antes de morrer, sinalizando combates triviais, arrastados ou arriscados demais.' },
    { key: 'questDesigner', label: 'Quest Designer', types: ['jogo-digital'], description: 'Monte e acompanhe as quests do jogo — objetivos, recompensas e status de produção.', icon: 'flag', color: '#8b5cf6',
      note: 'Cada quest tem tipo, quem a entrega, objetivos (passos que o jogador cumpre, em ordem), recompensas e um status de PRODUÇÃO (Rascunho/Disponível/Em teste/Pronta — o andamento de design, não o progresso de um jogador). Clique numa quest da lista para expandir e editar.' },
    { key: 'dialogues', label: 'Diálogos', types: ['jogo-digital'], description: 'Roteiro com falas, expressões, escolhas e condições — e uma simulação pra percorrer cada conversa.', icon: 'message-square', color: '#06b6d4',
      note: 'Cadastre quem fala (com cor e expressões próprias, opcionalmente ligado a uma entrada do Codex) e monte conversas: cada fala pode ter uma condição ("Só se", flags separadas por vírgula; !flag = desligada) e um efeito ("Define", flags que liga ou desliga). Escolhas do jogador têm opções que definem flags e saltam pra outra fala ou encerram. A tabela de flags mostra onde cada uma é definida e exigida e avisa quando uma condição depende de algo que nenhum diálogo define. "Simular" percorre a conversa com as flags iniciais que você marcar.' },
    { key: 'probabilityCalc', label: 'Calculadora de Probabilidade', types: ['boardgame'], description: 'Distribua o peso de cada resultado de um dado, spinner ou sorteio e veja a probabilidade de cada um.', icon: 'dices', color: '#3b82f6',
      note: 'Liste os resultados possíveis de um mecanismo de sorteio (dado, spinner, baralho misturado) e o peso de cada um (quantos "lados"/segmentos ele ocupa) — a probabilidade de cada resultado é recalculada automaticamente, útil pra validar se a distribuição faz o sentido pretendido antes de produzir o componente físico.' },
    { key: 'deckBalancer', label: 'Balanceador de Baralho/Componentes', types: ['boardgame'], description: 'Projete quantas cópias de cada carta/componente por contagem de jogadores.', icon: 'layers', color: '#8b5cf6',
      note: 'Cada baralho ou conjunto de componentes tem uma cota fixa (sempre presente) mais uma cota que escala por jogador — defina os dois valores pra cada um e veja o total resultante pra cada contagem de jogadores na faixa escolhida.' },
  ];

  function toolDefsForType(type) {
    var list = TOOL_DEFS.filter(function (t) { return !t.types || t.types.indexOf(type) !== -1; });
    // Ferramentas de conteúdo (cartas, diálogos, quests) primeiro — são as de uso diário; as
    // calculadoras de balanceamento vêm depois, na ordem de TOOL_DEFS (pedido do Renato).
    var FIRST = ['cardDesigner', 'dialogues', 'questDesigner'];
    list.sort(function (a, b) {
      var ia = FIRST.indexOf(a.key), ib = FIRST.indexOf(b.key);
      if (ia === -1) ia = FIRST.length + TOOL_DEFS.indexOf(a);
      if (ib === -1) ib = FIRST.length + TOOL_DEFS.indexOf(b);
      return ia - ib;
    });
    return list;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Sub-abas: uma ferramenta por vez, com o espaço todo — antes era uma grade com todas empilhadas,
  // e usar a última exigia rolar por todas as outras. A ferramenta aberta é lembrada por tipo de
  // projeto (preferência de interface, fica no localStorage, não no documento).
  var ACTIVE_TOOL_KEY = 'gdc:activeTool:';

  function readActiveTool(defs) {
    var key = openTool;
    if (!key) { try { key = localStorage.getItem(ACTIVE_TOOL_KEY + activeProjectType); } catch (e) { key = null; } }
    return defs.some(function (d) { return d.key === key; }) ? key : (defs[0] && defs[0].key);
  }

  function renderTabs(defs, activeKey) {
    var tabsEl = root.querySelector('#gdc-tools-tabs');
    tabsEl.innerHTML = defs.map(function (tool) {
      var on = tool.key === activeKey;
      return '<button type="button" class="tools-tab' + (on ? ' tools-tab-active' : '') + '" data-tool-tab="' + tool.key + '" role="tab" aria-selected="' + on + '" title="' + escapeHtml(tool.description) + '">' +
        '<span class="tools-tab-icon" style="color:' + tool.color + '">' + GDC.icon(tool.icon, { size: 15 }) + '</span>' + escapeHtml(tool.label) + '</button>';
    }).join('');
  }

  function render() {
    var wrap = root.querySelector('#gdc-tools-list');
    var defs = toolDefsForType(activeProjectType);
    var activeKey = readActiveTool(defs);
    openTool = activeKey;
    renderTabs(defs, activeKey);
    var tool = defs.filter(function (d) { return d.key === activeKey; })[0];
    if (!tool) { wrap.innerHTML = ''; return; }
    wrap.innerHTML =
      '<div class="tool-column tool-column-wide">' +
      '  <div class="card-surface tool-panel">' +
      '    <div class="tool-panel-header">' +
      '      <span class="tool-icon-wrap" style="background-color:' + tool.color + '20;color:' + tool.color + '">' + GDC.icon(tool.icon, { size: 16, className: 'tool-icon' }) + '</span>' +
      '      <div class="min-w-0 flex-1">' +
      '        <h3 class="font-display text-sm font-bold text-primary">' + escapeHtml(tool.label) + '</h3>' +
      '        <p class="mt-0.5 text-xs text-muted">' + escapeHtml(tool.description) + '</p>' +
      '      </div>' +
      '    </div>' +
      '    <div class="tool-panel-body" data-tool-body="' + tool.key + '"></div>' +
      '  </div>' +
      '  <div class="tab-help-note">' + GDC.icon('info', { size: 16 }) +
      '    <p><strong>Como funciona:</strong> ' + escapeHtml(tool.note) + '</p>' +
      '  </div>' +
      '</div>';
    var svgEl = wrap.querySelector('.tool-icon-wrap svg');
    if (svgEl) svgEl.style.color = tool.color;

    var bodyEl = wrap.querySelector('[data-tool-body="' + tool.key + '"]');
    bodyEl.setAttribute('data-value', toolsState[tool.key] || '');
    var handler = function (value) {
      toolsState[tool.key] = value;
      if (onToolChange) onToolChange(tool.key, value);
    };
    if (tool.key === 'xpBalancer') GDC.ui.xpBalancer.render(bodyEl, handler);
    else if (tool.key === 'lootSimulator') GDC.ui.lootSimulator.render(bodyEl, handler);
    else if (tool.key === 'economySimulator') GDC.ui.economySimulator.render(bodyEl, handler, { toolsState: toolsState, skillTree: skillTreeRef });
    else if (tool.key === 'combatBalance') GDC.ui.combatBalance.render(bodyEl, handler);
    else if (tool.key === 'questDesigner') GDC.ui.questDesigner.render(bodyEl, handler, { codex: codexRef, onGotoCodexEntry: onGotoCodexEntry });
    else if (tool.key === 'dialogues') GDC.ui.dialogues.render(bodyEl, handler, { codex: codexRef, onGotoCodexEntry: onGotoCodexEntry });
    else if (tool.key === 'probabilityCalc') GDC.ui.probabilityCalc.render(bodyEl, handler);
    else if (tool.key === 'deckBalancer') GDC.ui.deckBalancer.render(bodyEl, handler);
    else if (tool.key === 'cardDesigner') GDC.ui.cardDesigner.render(bodyEl, handler);
  }

  function open(key) {
    openTool = key;
    try { localStorage.setItem(ACTIVE_TOOL_KEY + activeProjectType, key); } catch (e) { /* sem storage: só não lembra */ }
    render();
  }

  function mount(container, opts) {
    root = container;
    toolsState = opts.tools;
    skillTreeRef = opts.skillTree || { nodes: [], branches: [] };
    codexRef = opts.codex || { types: [], entries: [] };
    onGotoCodexEntry = opts.onGotoCodexEntry;
    onToolChange = opts.onToolChange;
    activeProjectType = opts.projectType;

    root.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-tool-tab]');
      if (tab && root.contains(tab)) open(tab.getAttribute('data-tool-tab'));
    });
    root.innerHTML =
      '<section id="ferramentas" class="builder-section">' +
      '  <div class="mb-8 text-center">' +
      '    <div class="hero-badge">' + GDC.icon('wrench', { size: 14, className: 'text-blue-400' }) + 'Design &amp; Balanceamento</div>' +
      '    <h2 class="font-display text-3xl font-bold text-primary">Ferramentas</h2>' +
      '    <p class="mt-2 text-secondary">Utilitários rápidos para apoiar decisões de design — de calculadoras de balanceamento ao Quest Designer, pra montar as quests do jogo.</p>' +
      '  </div>' +
      '  <div class="tools-tabs" id="gdc-tools-tabs" role="tablist" aria-label="Ferramentas"></div>' +
      '  <div class="tools-grid" id="gdc-tools-list"></div>' +
      '</section>';

    render();
  }

  function reset(toolsVal, skillTreeVal, projectTypeVal, codexVal) {
    toolsState = toolsVal;
    if (codexVal) codexRef = codexVal;
    if (skillTreeVal) skillTreeRef = skillTreeVal;
    if (projectTypeVal) activeProjectType = projectTypeVal;
    render();
  }

  GDC.ui.tools = { mount: mount, reset: reset, open: open };
}(window));
