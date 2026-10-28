/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // Ferramenta de design que conecta o que já existe em vez de duplicar dados: as fontes de moeda
  // puxam ao vivo os itens/taxas configurados no Loot Simulator (você só atribui um valor em moeda pra
  // cada item), o eixo de nível vem do XP Balancer, e o custo a cobrir vem direto do total já calculado
  // pela Árvore de Habilidades — pedido do Renato (respostas ao escopo: "Loot Simulator + entrada
  // manual" pras fontes, "Sim, automático" pro custo da árvore, "Saldo por nível" como resultado, "Uma
  // moeda só"). Cada ferramenta continua sendo a fonte da verdade dos seus próprios dados (o Economy
  // Simulator não grava nada nelas, só lê).

  var LIMITS = {
    rollsPerLevel: { min: 0, max: 500 },
    itemValue: { min: 0, max: 100000 },
    amountPerLevel: { min: -100000, max: 100000 },
  };

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clamp(n, min, max) {
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function makeRowId() {
    return 'row-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function fmt(n) { return Math.round(n).toLocaleString('pt-BR'); }

  function validRow(r) { return !!r && typeof r.id === 'string' && typeof r.name === 'string' && isFinite(r.amountPerLevel); }

  function parseStored(value) {
    var defaults = { currencyName: 'Ouro', rollsPerLevel: 5, lootItemValues: {}, manualFaucets: [], manualSinks: [] };
    if (!value) return defaults;
    try {
      var parsed = JSON.parse(value);
      return {
        currencyName: typeof parsed.currencyName === 'string' && parsed.currencyName.trim() ? parsed.currencyName.trim() : 'Ouro',
        rollsPerLevel: clamp(Number(parsed.rollsPerLevel), LIMITS.rollsPerLevel.min, LIMITS.rollsPerLevel.max),
        lootItemValues: parsed.lootItemValues && typeof parsed.lootItemValues === 'object' ? parsed.lootItemValues : {},
        manualFaucets: Array.isArray(parsed.manualFaucets) ? parsed.manualFaucets.filter(validRow) : [],
        manualSinks: Array.isArray(parsed.manualSinks) ? parsed.manualSinks.filter(validRow) : [],
      };
    } catch (e) { return defaults; }
  }

  // ---------- Leituras ao vivo de outras ferramentas (só leitura, nunca grava) ----------

  /** Mesmo blob solto que o próprio lootSimulator.js grava em doc.tools.lootSimulator — como nada é
   *  gravado lá até o primeiro "input" do usuário (ver comentário em lootSimulator.js), cai pros
   *  mesmos itens padrão que a aba já mostra visualmente antes de qualquer edição, em vez de aparecer
   *  vazio aqui num projeto novo. */
  function readLootItems(toolsState) {
    if (!toolsState || !toolsState.lootSimulator) {
      return (GDC.LOOT_SIMULATOR_DEFAULT_ITEMS || []).map(function (i) { return Object.assign({}, i); });
    }
    try {
      var parsed = JSON.parse(toolsState.lootSimulator);
      return Array.isArray(parsed.items) ? parsed.items.filter(function (i) { return i && typeof i.name === 'string'; }) : [];
    } catch (e) { return []; }
  }

  /** Mesmo blob solto que o xpBalancer.js grava em doc.tools.xpBalancer — só o nível máximo interessa
   *  aqui, como eixo X do gráfico de saldo. */
  function readMaxLevel(toolsState) {
    if (!toolsState || !toolsState.xpBalancer) return 20;
    try {
      var parsed = JSON.parse(toolsState.xpBalancer);
      var lvl = Math.round(Number(parsed.maxLevel));
      return isFinite(lvl) && lvl >= 2 ? clamp(lvl, 2, 200) : 20;
    } catch (e) { return 20; }
  }

  /** Custo total da árvore (soma de todos os nós) — mesmo cálculo do resumo da própria Árvore de
   *  Habilidades (skillTree.js/renderSummary), lido aqui como referência, não recalculado por ramo. */
  function skillTreeCost(skillTree) {
    var nodes = (skillTree && skillTree.nodes) || [];
    return nodes.reduce(function (sum, n) { return sum + (n.cost || 0); }, 0);
  }

  // A referência da árvore e a função de repintar ficam em variáveis de módulo (não só dentro do
  // closure de render()) pra permitir refreshSkillTree(): a Árvore de Habilidades e o Economy Simulator
  // são módulos/abas diferentes — editar um nó na aba Habilidades não re-renderiza a aba Ferramentas
  // sozinho, então app.js chama refreshSkillTree() ao trocar pra aba Ferramentas, garantindo que o
  // custo total mostrado aqui nunca fique desatualizado.
  var currentSkillTree = { nodes: [], branches: [] };
  var currentRepaint = null;

  function refreshSkillTree(skillTreeVal) {
    if (skillTreeVal) currentSkillTree = skillTreeVal;
    if (currentRepaint) currentRepaint();
  }

  function render(container, onChange, ctx) {
    ctx = ctx || {};
    var toolsState = ctx.toolsState || {};
    currentSkillTree = ctx.skillTree || currentSkillTree;
    var state = parseStored(container.getAttribute('data-value'));

    function persist() { onChange(JSON.stringify(state)); }

    // Refs preenchidas por build(); reconstruído inteiro quando o nome da moeda muda (vários rótulos
    // de texto dependem dele) — mais simples e seguro que tentar atualizar cada rótulo espalhado.
    var lootItemsEl, faucetsEl, sinksEl, chartEl, statsEl, unlockMsgEl, treeCostEl;

    function expectedValuePerRoll(lootItems) {
      return lootItems.reduce(function (sum, it) {
        var v = Number(state.lootItemValues[it.name]);
        if (!isFinite(v)) v = 0;
        return sum + ((Number(it.rate) || 0) / 100) * v;
      }, 0);
    }

    function manualSum(list) {
      return list.reduce(function (s, r) { return s + (isFinite(r.amountPerLevel) ? r.amountPerLevel : 0); }, 0);
    }

    function recompute(lootItems, maxLevel, treeCost) {
      var perRollValue = expectedValuePerRoll(lootItems);
      var faucetPerLevel = perRollValue * state.rollsPerLevel + manualSum(state.manualFaucets);
      var sinkPerLevel = manualSum(state.manualSinks);
      var netPerLevel = faucetPerLevel - sinkPerLevel;
      var cumulative = [];
      var running = 0;
      for (var lvl = 1; lvl <= maxLevel; lvl++) {
        running += netPerLevel;
        cumulative.push(running);
      }
      var unlockLevel = null;
      if (treeCost > 0) {
        for (var i = 0; i < cumulative.length; i++) {
          if (cumulative[i] >= treeCost) { unlockLevel = i + 1; break; }
        }
      }
      return { faucetPerLevel: faucetPerLevel, sinkPerLevel: sinkPerLevel, netPerLevel: netPerLevel, cumulative: cumulative, unlockLevel: unlockLevel };
    }

    function repaint() {
      var lootItems = readLootItems(toolsState);
      var maxLevel = readMaxLevel(toolsState);
      var treeCost = skillTreeCost(currentSkillTree);
      // O card de custo total é escrito uma vez em build(), mas o custo pode mudar sem um rebuild (ex.:
      // refreshSkillTree() ao trocar de aba) — mantém esse número em dia sem precisar reconstruir tudo.
      if (treeCostEl) treeCostEl.textContent = fmt(treeCost) + ' ' + state.currencyName;
      var r = recompute(lootItems, maxLevel, treeCost);
      var maxVal = Math.max.apply(null, r.cumulative.concat([treeCost, 1]));

      chartEl.innerHTML = r.cumulative.map(function (v) {
        var pct = Math.max(0, v) / maxVal * 100;
        return '<div class="xp-bar-wrap"><div class="econ-bar" style="height:' + pct + '%"></div><span class="xp-bar-label">' + fmt(v) + '</span></div>';
      }).join('');
      if (treeCost > 0) {
        var linePct = Math.min(100, (treeCost / maxVal) * 100);
        chartEl.innerHTML += '<div class="econ-ref-line" style="bottom:' + linePct + '%" title="Custo total da Árvore de Habilidades: ' + fmt(treeCost) + '"></div>';
      }

      statsEl.innerHTML =
        '<div class="xp-stat"><p class="font-display text-lg font-bold text-primary">' + fmt(r.faucetPerLevel) + '</p><p class="text-xs text-muted">Fontes / nível</p></div>' +
        '<div class="xp-stat"><p class="font-display text-lg font-bold text-primary">' + fmt(r.sinkPerLevel) + '</p><p class="text-xs text-muted">Custos / nível</p></div>' +
        '<div class="xp-stat"><p class="font-display text-lg font-bold ' + (r.netPerLevel >= 0 ? 'text-primary' : 'text-rose-500') + '">' + (r.netPerLevel >= 0 ? '+' : '') + fmt(r.netPerLevel) + '</p><p class="text-xs text-muted">Saldo / nível</p></div>';

      if (treeCost <= 0) {
        unlockMsgEl.innerHTML = '<span class="inline-flex items-center gap-1.5 text-muted">' + GDC.icon('info', { size: 14 }) + 'Crie habilidades com custo na Árvore de Habilidades pra ver aqui em que nível dá pra desbloquear tudo.</span>';
      } else if (r.unlockLevel) {
        unlockMsgEl.innerHTML = '<span class="inline-flex items-center gap-1.5 text-emerald-500">' + GDC.icon('check', { size: 14 }) + 'No nível ' + r.unlockLevel + ' o jogador já teria ' + escapeHtml(state.currencyName) + ' suficiente pra desbloquear a árvore de habilidades inteira (' + fmt(treeCost) + ').</span>';
      } else {
        var deficit = Math.max(0, treeCost - (r.cumulative[r.cumulative.length - 1] || 0));
        unlockMsgEl.innerHTML = '<span class="inline-flex items-center gap-1.5 text-amber-500">' + GDC.icon('alert-triangle', { size: 14 }) + 'Mesmo no nível máximo (' + maxLevel + '), ainda faltariam ' + fmt(deficit) + ' ' + escapeHtml(state.currencyName) + ' pra desbloquear a árvore inteira.</span>';
      }
    }

    function renderLootItemRows() {
      if (!lootItemsEl) return;
      var lootItems = readLootItems(toolsState);
      if (!lootItems.length) {
        lootItemsEl.innerHTML = '<p class="text-xs text-muted">Nenhum item configurado no Loot Simulator ainda.</p>';
        return;
      }
      lootItemsEl.innerHTML = lootItems.map(function (it) {
        var v = state.lootItemValues[it.name];
        v = isFinite(v) ? v : 0;
        return (
          '<div class="flex items-center gap-3" data-loot-item="' + escapeHtml(it.name) + '">' +
          '  <span class="h-3 w-3 flex-shrink-0 rounded-full" style="background-color:' + (it.color || '#94a3b8') + '"></span>' +
          '  <span class="w-28 truncate text-xs text-secondary">' + escapeHtml(it.name) + '</span>' +
          '  <span class="w-10 text-xs text-muted">' + (it.rate || 0) + '%</span>' +
          '  <input type="number" min="0" data-f="loot-value" value="' + v + '" class="input-field ml-auto w-24 py-1 text-xs" />' +
          '</div>'
        );
      }).join('');
      lootItemsEl.querySelectorAll('[data-loot-item]').forEach(function (row) {
        var name = row.getAttribute('data-loot-item');
        var input = row.querySelector('[data-f="loot-value"]');
        input.addEventListener('input', function () {
          state.lootItemValues[name] = clamp(Number(input.value), LIMITS.itemValue.min, LIMITS.itemValue.max);
          persist();
          repaint();
        });
      });
    }

    function manualRowsMarkup(list) {
      return list.map(function (r) {
        return (
          '<div class="flex items-center gap-3" data-row="' + r.id + '">' +
          '  <input type="text" data-f="name" value="' + escapeHtml(r.name) + '" class="input-field flex-1 py-1 text-xs" placeholder="Nome" />' +
          '  <input type="number" data-f="amount" value="' + r.amountPerLevel + '" class="input-field w-24 py-1 text-xs" />' +
          '  <button type="button" class="flex-shrink-0 text-muted hover:text-rose-500" data-remove title="Remover">' + GDC.icon('trash-2', { size: 14 }) + '</button>' +
          '</div>'
        );
      }).join('');
    }

    function bindManualRows(el, list, rerender) {
      el.querySelectorAll('[data-row]').forEach(function (rowEl) {
        var id = rowEl.getAttribute('data-row');
        var item = list.filter(function (r) { return r.id === id; })[0];
        if (!item) return;
        var nameInput = rowEl.querySelector('[data-f="name"]');
        var amountInput = rowEl.querySelector('[data-f="amount"]');
        nameInput.addEventListener('input', function () { item.name = nameInput.value; persist(); });
        amountInput.addEventListener('input', function () {
          item.amountPerLevel = clamp(Number(amountInput.value), LIMITS.amountPerLevel.min, LIMITS.amountPerLevel.max);
          persist();
          repaint();
        });
        var removeBtn = rowEl.querySelector('[data-remove]');
        removeBtn.addEventListener('click', function () {
          var idx = list.indexOf(item);
          if (idx !== -1) list.splice(idx, 1);
          persist();
          rerender();
          repaint();
        });
      });
    }

    function renderFaucetRows() {
      faucetsEl.innerHTML = state.manualFaucets.length
        ? '<div class="space-y-1.5">' + manualRowsMarkup(state.manualFaucets) + '</div>'
        : '<p class="text-xs text-muted">Nenhuma fonte manual ainda.</p>';
      bindManualRows(faucetsEl, state.manualFaucets, renderFaucetRows);
    }

    function renderSinkRows() {
      sinksEl.innerHTML = state.manualSinks.length
        ? '<div class="space-y-1.5">' + manualRowsMarkup(state.manualSinks) + '</div>'
        : '<p class="text-xs text-muted">Nenhum custo manual ainda.</p>';
      bindManualRows(sinksEl, state.manualSinks, renderSinkRows);
    }

    /** Reconstrói a árvore inteira — usada na primeira montagem e sempre que o nome da moeda muda
     *  (vários rótulos de texto abaixo citam ele; mais simples reconstruir tudo do que ficar caçando
     *  cada rótulo espalhado pra atualizar em texto puro). */
    function build() {
      container.innerHTML =
        '<div class="space-y-4">' +
        '  <div class="flex flex-wrap items-end gap-3">' +
        '    <label class="text-xs text-secondary">Nome da moeda<input type="text" id="econ-currency" value="' + escapeHtml(state.currencyName) + '" class="input-field mt-1 w-28 py-1.5 text-xs" /></label>' +
        '    <label class="text-xs text-secondary">Rolagens de loot por nível<input type="number" min="0" max="500" id="econ-rolls" value="' + state.rollsPerLevel + '" class="input-field mt-1 w-24 py-1.5 text-xs" /></label>' +
        '  </div>' +
        '  <p class="text-muted" style="font-size:11px">"Rolagens por nível" estima quantos drops (baús, inimigos) o jogador encontra a cada nível — junto com o valor abaixo, converte a chance de drop do Loot Simulator em ' + escapeHtml(state.currencyName) + ' esperado.</p>' +

        '  <div class="rounded-xl border border-default p-4 space-y-2">' +
        '    <h4 class="text-xs font-bold text-secondary">Fontes automáticas — valor de cada item do Loot Simulator (em ' + escapeHtml(state.currencyName) + ')</h4>' +
        '    <div id="econ-loot-items" class="space-y-1.5"></div>' +
        '  </div>' +

        '  <div class="rounded-xl border border-default p-4 space-y-2">' +
        '    <h4 class="text-xs font-bold text-secondary">Outras fontes de ' + escapeHtml(state.currencyName) + ' por nível</h4>' +
        '    <div id="econ-faucets"></div>' +
        '    <button type="button" id="econ-add-faucet" class="btn-ghost py-1.5 text-xs">' + GDC.icon('plus', { size: 14 }) + 'Adicionar fonte</button>' +
        '  </div>' +

        '  <div class="rounded-xl border border-default p-4 space-y-2">' +
        '    <h4 class="text-xs font-bold text-secondary">Custos recorrentes de ' + escapeHtml(state.currencyName) + ' por nível</h4>' +
        '    <div id="econ-sinks"></div>' +
        '    <button type="button" id="econ-add-sink" class="btn-ghost py-1.5 text-xs">' + GDC.icon('plus', { size: 14 }) + 'Adicionar custo</button>' +
        '  </div>' +

        '  <div class="econ-tree-cost-card">' + GDC.icon('workflow', { size: 14 }) +
        '    <span>Custo total da Árvore de Habilidades: <strong id="econ-tree-cost-value">' + fmt(skillTreeCost(currentSkillTree)) + ' ' + escapeHtml(state.currencyName) + '</strong></span>' +
        '  </div>' +

        '  <div class="rounded-xl border border-default p-4">' +
        '    <div class="econ-chart-track" id="econ-chart"></div>' +
        '    <div class="mt-2 flex justify-between text-muted" style="font-size:10px"><span>Nv 1</span><span>Nv ' + readMaxLevel(toolsState) + '</span></div>' +
        '  </div>' +
        '  <div class="grid grid-cols-3 gap-3 text-center" id="econ-stats"></div>' +
        '  <p id="econ-unlock-msg" class="text-xs"></p>' +
        '</div>';

      lootItemsEl = container.querySelector('#econ-loot-items');
      faucetsEl = container.querySelector('#econ-faucets');
      sinksEl = container.querySelector('#econ-sinks');
      chartEl = container.querySelector('#econ-chart');
      statsEl = container.querySelector('#econ-stats');
      unlockMsgEl = container.querySelector('#econ-unlock-msg');
      treeCostEl = container.querySelector('#econ-tree-cost-value');

      var currencyEl = container.querySelector('#econ-currency');
      var rollsEl = container.querySelector('#econ-rolls');
      // "change" (não "input"): renomear a moeda reconstrói vários rótulos de texto — só faz sentido
      // depois que o usuário termina de digitar, não a cada tecla.
      currencyEl.addEventListener('change', function () {
        state.currencyName = currencyEl.value.trim() || 'Ouro';
        persist();
        // setTimeout: build() substitui o innerHTML do container, removendo o próprio <input> que
        // disparou esse "change" — fazer isso de forma síncrona, ainda dentro do próprio evento (que o
        // navegador pode estar processando junto com um "blur" implícito), pode lançar "the node to be
        // removed is no longer a child of this node" em alguns navegadores. Adiar pro próximo tick deixa
        // o navegador terminar de despachar o evento atual antes da troca de DOM.
        setTimeout(build, 0);
      });
      rollsEl.addEventListener('input', function () {
        state.rollsPerLevel = clamp(Number(rollsEl.value), LIMITS.rollsPerLevel.min, LIMITS.rollsPerLevel.max);
        persist();
        repaint();
      });
      container.querySelector('#econ-add-faucet').addEventListener('click', function () {
        state.manualFaucets.push({ id: makeRowId(), name: 'Fonte ' + (state.manualFaucets.length + 1), amountPerLevel: 0 });
        persist();
        renderFaucetRows();
        repaint();
      });
      container.querySelector('#econ-add-sink').addEventListener('click', function () {
        state.manualSinks.push({ id: makeRowId(), name: 'Custo ' + (state.manualSinks.length + 1), amountPerLevel: 0 });
        persist();
        renderSinkRows();
        repaint();
      });

      renderLootItemRows();
      renderFaucetRows();
      renderSinkRows();
      repaint();
    }

    currentRepaint = repaint;
    build();
  }

  GDC.ui.economySimulator = { render: render, refreshSkillTree: refreshSkillTree };
}(window));
