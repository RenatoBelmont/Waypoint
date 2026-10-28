/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var DEFAULT_ITEMS = [
    { name: 'Comum', rate: 60, color: '#94a3b8' },
    { name: 'Incomum', rate: 25, color: '#10b981' },
    { name: 'Raro', rate: 10, color: '#3b82f6' },
    { name: 'Épico', rate: 4, color: '#8b5cf6' },
    { name: 'Lendário', rate: 1, color: '#f59e0b' },
  ];
  var PALETTE = ['#94a3b8', '#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#f43f5e', '#06b6d4', '#84cc16'];

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clampRolls(rolls) {
    if (!isFinite(rolls)) return 1000;
    return Math.round(Math.min(100000, Math.max(100, rolls)));
  }

  function parseStored(value) {
    if (!value) return { items: DEFAULT_ITEMS.map(function (i) { return Object.assign({}, i); }), rolls: 1000 };
    try {
      var parsed = JSON.parse(value);
      var items = Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : DEFAULT_ITEMS;
      var rolls = isFinite(parsed.rolls) ? parsed.rolls : 1000;
      return { items: items, rolls: rolls };
    } catch (e) {
      return { items: DEFAULT_ITEMS.map(function (i) { return Object.assign({}, i); }), rolls: 1000 };
    }
  }

  function render(container, onChange) {
    var initial = parseStored(container.getAttribute('data-value'));
    var items = initial.items;
    var rolls = initial.rolls;
    var results = null;

    container.innerHTML =
      '<div class="space-y-4">' +
      '  <div class="space-y-2" id="loot-items"></div>' +
      '  <div class="flex flex-wrap items-end gap-3">' +
      '    <label class="text-xs text-secondary">Simulações<input type="number" min="100" max="100000" step="100" id="loot-rolls" value="' + clampRolls(rolls) + '" class="input-field mt-1 w-28 py-1.5 text-xs" /></label>' +
      '    <button type="button" id="loot-run" class="btn-primary py-1.5 text-xs">' + GDC.icon('dices', { size: 14 }) + 'Rodar simulação</button>' +
      '    <button type="button" id="loot-clear" class="btn-ghost py-1.5 text-xs" style="display:none">' + GDC.icon('refresh-cw', { size: 14 }) + 'Limpar</button>' +
      '    <button type="button" id="loot-reset" class="btn-ghost py-1.5 text-xs" title="Restaurar itens e simulações para os valores padrão">' + GDC.icon('rotate-ccw', { size: 14 }) + 'Restaurar padrão</button>' +
      '  </div>' +
      '  <div class="rounded-xl border border-default p-4 space-y-2" id="loot-results" style="display:none"></div>' +
      '  <div class="flex items-center justify-between text-xs" id="loot-status"></div>' +
      '</div>';

    var itemsEl = container.querySelector('#loot-items');
    var rollsInput = container.querySelector('#loot-rolls');
    var runBtn = container.querySelector('#loot-run');
    var clearBtn = container.querySelector('#loot-clear');
    var resetBtn = container.querySelector('#loot-reset');
    var resultsEl = container.querySelector('#loot-results');
    var statusEl = container.querySelector('#loot-status');

    function persist() {
      onChange(JSON.stringify({ items: items, rolls: clampRolls(rolls) }));
    }

    function validity() {
      var totalRate = items.reduce(function (sum, item) { return sum + (isFinite(item.rate) ? item.rate : 0); }, 0);
      var hasNegative = items.some(function (item) { return item.rate < 0; });
      var hasEmptyName = items.some(function (item) { return !item.name.trim(); });
      var isValid = !hasNegative && !hasEmptyName && items.length > 0 && Math.abs(totalRate - 100) < 0.001;
      var message = null;
      if (items.length === 0) message = 'Adicione ao menos um item.';
      else if (hasEmptyName) message = 'Todos os itens precisam de um nome.';
      else if (hasNegative) message = 'Nenhuma probabilidade pode ser negativa.';
      else if (Math.abs(totalRate - 100) >= 0.001) message = 'A soma das probabilidades é ' + totalRate.toFixed(1) + '% — precisa ser exatamente 100%.';
      return { isValid: isValid, message: message };
    }

    function renderStatus() {
      var v = validity();
      runBtn.disabled = !v.isValid;
      runBtn.classList.toggle('disabled:cursor-not-allowed', !v.isValid);
      if (v.isValid) {
        statusEl.innerHTML = '<span class="inline-flex items-center gap-1.5 text-emerald-500">' + GDC.icon('dices', { size: 14 }) + 'Soma das probabilidades: 100% (válido)</span>';
      } else {
        statusEl.innerHTML = '<span class="inline-flex items-center gap-1.5 text-amber-500">' + GDC.icon('alert-triangle', { size: 14 }) + escapeHtml(v.message) + '</span>';
      }
      return v.isValid;
    }

    function renderItems() {
      itemsEl.innerHTML = items.map(function (item, i) {
        var resultLabel = '';
        if (results) {
          var count = results[item.name] || 0;
          var safeRolls = clampRolls(rolls);
          var obsPct = ((count / safeRolls) * 100).toFixed(1);
          resultLabel = '<span class="loot-item-result">' + count + ' drops<br><span class="text-muted">' + obsPct + '% obs · ' + item.rate.toFixed(1) + '% config</span></span>';
        }
        return (
          '<div class="flex items-center gap-3" data-item="' + i + '">' +
          '  <span class="h-3 w-3 flex-shrink-0 rounded-full" style="background-color:' + item.color + '"></span>' +
          '  <input data-f="name" value="' + escapeHtml(item.name) + '" class="input-field w-28 py-1 text-xs" />' +
          '  <input data-f="rate" type="number" min="0" max="100" step="0.1" value="' + item.rate + '" class="input-field w-20 py-1 text-xs' + (item.rate < 0 ? ' border-rose-500' : '') + '" />' +
          '  <span class="text-xs text-muted">%</span>' +
          (resultLabel || '<button type="button" class="ml-auto flex-shrink-0 text-muted hover:text-rose-500" data-action="remove" title="Remover item">' + GDC.icon('trash-2', { size: 14 }) + '</button>') +
          (resultLabel ? '<button type="button" class="flex-shrink-0 text-muted hover:text-rose-500" data-action="remove" title="Remover item">' + GDC.icon('trash-2', { size: 14 }) + '</button>' : '') +
          '</div>'
        );
      }).join('') +
      '<button type="button" class="btn-ghost py-1.5 text-xs" id="loot-add">' + GDC.icon('plus', { size: 14 }) + 'Adicionar item</button>';

      itemsEl.querySelectorAll('[data-item]').forEach(function (row) {
        var idx = Number(row.getAttribute('data-item'));
        var nameInput = row.querySelector('[data-f="name"]');
        var rateInput = row.querySelector('[data-f="rate"]');
        nameInput.addEventListener('input', function () {
          items[idx].name = nameInput.value;
          results = null;
          resultsEl.style.display = 'none';
          clearBtn.style.display = 'none';
          renderStatus();
          persist();
        });
        rateInput.addEventListener('input', function () {
          var v = Number(rateInput.value);
          items[idx].rate = isFinite(v) ? v : 0;
          results = null;
          resultsEl.style.display = 'none';
          clearBtn.style.display = 'none';
          renderStatus();
          persist();
        });
        var removeBtn = row.querySelector('[data-action="remove"]');
        if (removeBtn) removeBtn.addEventListener('click', function () {
          items.splice(idx, 1);
          results = null;
          renderItems();
          renderStatus();
          resultsEl.style.display = 'none';
          clearBtn.style.display = 'none';
          persist();
        });
      });

      itemsEl.querySelector('#loot-add').addEventListener('click', function () {
        var color = PALETTE[items.length % PALETTE.length];
        items.push({ name: 'Item ' + (items.length + 1), rate: 0, color: color });
        results = null;
        renderItems();
        renderStatus();
        persist();
      });
    }

    function renderResults() {
      if (!results) { resultsEl.style.display = 'none'; return; }
      var safeRolls = clampRolls(rolls);
      resultsEl.style.display = '';
      resultsEl.innerHTML = items.map(function (item) {
        var count = results[item.name] || 0;
        var pct = (count / safeRolls) * 100;
        return (
          '<div class="loot-row">' +
          '  <span class="w-20 truncate text-xs text-secondary">' + escapeHtml(item.name) + '</span>' +
          '  <div class="loot-result-track"><div class="loot-result-fill" style="width:' + pct + '%;background-color:' + item.color + '"></div></div>' +
          '  <span class="w-12 text-right font-mono text-xs text-secondary">' + pct.toFixed(1) + '%</span>' +
          '</div>'
        );
      }).join('');
    }

    rollsInput.addEventListener('input', function () {
      rolls = Number(rollsInput.value);
    });

    runBtn.addEventListener('click', function () {
      if (!renderStatus()) return;
      var counts = {};
      items.forEach(function (item) { counts[item.name] = 0; });
      var safeRolls = clampRolls(rolls);
      for (var i = 0; i < safeRolls; i++) {
        var roll = Math.random() * 100;
        var cumulative = 0;
        for (var j = 0; j < items.length; j++) {
          cumulative += items[j].rate;
          if (roll < cumulative) { counts[items[j].name]++; break; }
        }
      }
      results = counts;
      renderItems();
      renderResults();
      clearBtn.style.display = '';
      persist();
    });

    clearBtn.addEventListener('click', function () {
      results = null;
      renderItems();
      renderResults();
      clearBtn.style.display = 'none';
    });

    resetBtn.addEventListener('click', function () {
      if (!global.confirm('Isso restaura os itens e o número de simulações para os valores padrão. Deseja continuar?')) return;
      items = DEFAULT_ITEMS.map(function (i) { return Object.assign({}, i); });
      rolls = 1000;
      rollsInput.value = rolls;
      results = null;
      renderItems();
      renderStatus();
      renderResults();
      clearBtn.style.display = 'none';
      persist();
    });

    renderItems();
    renderStatus();
    renderResults();
  }

  // Exposto pra outras ferramentas lerem a mesma lista padrão sem duplicar valores (ver
  // economySimulator.js: precisa saber os itens configurados no Loot Simulator mesmo antes do usuário
  // mexer nele — nada é gravado em doc.tools.lootSimulator até o primeiro "input", então sem isso a
  // conexão automática ficaria vazia num projeto novo, mesmo com a aba mostrando os itens padrão).
  GDC.LOOT_SIMULATOR_DEFAULT_ITEMS = DEFAULT_ITEMS;

  GDC.ui.lootSimulator = { render: render };
}(window));
