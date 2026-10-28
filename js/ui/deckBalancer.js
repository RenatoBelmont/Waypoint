/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var MAX_DECKS = 12;
  var COUNT_LIMITS = { min: 0, max: 999 };
  var PLAYER_LIMITS = { min: 1, max: 12 };
  var MAX_PLAYER_SPAN = 8; // limita a tabela a no máximo 8 colunas de jogadores por vez

  var DEFAULT_DECKS = [
    { name: 'Baralho A', fixed: 4, perPlayer: 1 },
    { name: 'Baralho B', fixed: 2, perPlayer: 1 },
  ];

  function clamp(n, min, max) {
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function makeDeckId() {
    return 'deck-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function parseStored(value) {
    var fallback = {
      decks: DEFAULT_DECKS.map(function (d) { return Object.assign({ id: makeDeckId() }, d); }),
      minPlayers: 2, maxPlayers: 6,
    };
    if (!value) return fallback;
    try {
      var parsed = JSON.parse(value);
      var decks = Array.isArray(parsed.decks) ? parsed.decks : [];
      decks = decks.slice(0, MAX_DECKS).map(function (d) {
        return {
          id: (d && typeof d.id === 'string') ? d.id : makeDeckId(),
          name: (d && typeof d.name === 'string') ? d.name.slice(0, 40) : 'Baralho',
          fixed: clamp(Number(d && d.fixed), COUNT_LIMITS.min, COUNT_LIMITS.max),
          perPlayer: clamp(Number(d && d.perPlayer), COUNT_LIMITS.min, COUNT_LIMITS.max),
        };
      });
      if (!decks.length) decks = fallback.decks;
      var minPlayers = clamp(Number(parsed.minPlayers), PLAYER_LIMITS.min, PLAYER_LIMITS.max);
      var maxPlayers = clamp(Number(parsed.maxPlayers), minPlayers, PLAYER_LIMITS.max);
      if (maxPlayers - minPlayers > MAX_PLAYER_SPAN) maxPlayers = minPlayers + MAX_PLAYER_SPAN;
      return { decks: decks, minPlayers: minPlayers, maxPlayers: maxPlayers };
    } catch (e) {
      return fallback;
    }
  }

  function render(container, onChange) {
    var state = parseStored(container.getAttribute('data-value'));

    container.innerHTML =
      '<div class="space-y-4">' +
      '  <p class="text-xs text-muted">Cada baralho/conjunto de componentes tem uma cota fixa mais uma cota que escala por jogador — ajuste e veja o total pra cada contagem de jogadores.</p>' +
      '  <div class="flex flex-wrap items-end gap-3">' +
      '    <label class="text-xs text-secondary">Mín. jogadores<input type="number" min="' + PLAYER_LIMITS.min + '" max="' + PLAYER_LIMITS.max + '" id="db-min-players" value="' + state.minPlayers + '" class="input-field mt-1 w-20 py-1.5 text-xs" /></label>' +
      '    <label class="text-xs text-secondary">Máx. jogadores<input type="number" min="' + PLAYER_LIMITS.min + '" max="' + PLAYER_LIMITS.max + '" id="db-max-players" value="' + state.maxPlayers + '" class="input-field mt-1 w-20 py-1.5 text-xs" /></label>' +
      '  </div>' +
      '  <div id="db-rows" class="space-y-2"></div>' +
      '  <button type="button" id="db-add-deck" class="btn-ghost py-1.5 text-xs">' + GDC.icon('plus', { size: 14 }) + 'Adicionar baralho/componente</button>' +
      '  <div class="rounded-xl border border-default overflow-x-auto">' +
      '    <table class="deck-balancer-table" id="db-table"></table>' +
      '  </div>' +
      '</div>';

    var rowsEl = container.querySelector('#db-rows');
    var tableEl = container.querySelector('#db-table');
    var minInput = container.querySelector('#db-min-players');
    var maxInput = container.querySelector('#db-max-players');
    var addBtn = container.querySelector('#db-add-deck');

    function persist() {
      onChange(JSON.stringify({
        decks: state.decks.map(function (d) { return { id: d.id, name: d.name, fixed: d.fixed, perPlayer: d.perPlayer }; }),
        minPlayers: state.minPlayers, maxPlayers: state.maxPlayers,
      }));
    }

    function playerCounts() {
      var counts = [];
      for (var p = state.minPlayers; p <= state.maxPlayers; p++) counts.push(p);
      return counts;
    }

    function repaintTable() {
      var counts = playerCounts();
      var headerCells = counts.map(function (p) { return '<th>' + p + 'j</th>'; }).join('');
      var deckRows = state.decks.map(function (d) {
        var cells = counts.map(function (p) { return '<td>' + (d.fixed + d.perPlayer * p) + '</td>'; }).join('');
        return '<tr><td class="deck-balancer-row-label">' + escapeHtml(d.name || 'Baralho') + '</td>' + cells + '</tr>';
      }).join('');
      var totalCells = counts.map(function (p) {
        var total = state.decks.reduce(function (s, d) { return s + d.fixed + d.perPlayer * p; }, 0);
        return '<td><strong>' + total + '</strong></td>';
      }).join('');

      tableEl.innerHTML =
        '<thead><tr><th></th>' + headerCells + '</tr></thead>' +
        '<tbody>' + deckRows +
        '<tr class="deck-balancer-total-row"><td class="deck-balancer-row-label">Total</td>' + totalCells + '</tr>' +
        '</tbody>';
    }

    function repaintRows() {
      rowsEl.innerHTML = state.decks.map(function (d) {
        return (
          '<div class="flex items-center gap-2" data-deck-row="' + d.id + '">' +
          '  <input type="text" class="input-field py-1.5 text-xs flex-1" data-deck-name="' + d.id + '" value="' + escapeHtml(d.name) + '" placeholder="Nome do baralho/componente" />' +
          '  <label class="text-xs text-secondary flex items-center gap-1">Fixo<input type="number" min="' + COUNT_LIMITS.min + '" max="' + COUNT_LIMITS.max + '" class="input-field py-1.5 text-xs w-16" data-deck-fixed="' + d.id + '" value="' + d.fixed + '" /></label>' +
          '  <label class="text-xs text-secondary flex items-center gap-1">Por jogador<input type="number" min="' + COUNT_LIMITS.min + '" max="' + COUNT_LIMITS.max + '" class="input-field py-1.5 text-xs w-16" data-deck-per="' + d.id + '" value="' + d.perPlayer + '" /></label>' +
          '  <button type="button" class="text-muted hover:text-rose-500" data-remove-deck="' + d.id + '" title="Remover" ' + (state.decks.length <= 1 ? 'disabled' : '') + '>' + GDC.icon('x', { size: 12 }) + '</button>' +
          '</div>'
        );
      }).join('');

      addBtn.disabled = state.decks.length >= MAX_DECKS;

      rowsEl.querySelectorAll('[data-deck-name]').forEach(function (el) {
        el.addEventListener('input', function () {
          var id = el.getAttribute('data-deck-name');
          state.decks = state.decks.map(function (d) { return d.id === id ? Object.assign({}, d, { name: el.value.slice(0, 40) }) : d; });
          persist();
          repaintTable();
        });
      });
      rowsEl.querySelectorAll('[data-deck-fixed]').forEach(function (el) {
        el.addEventListener('input', function () {
          var id = el.getAttribute('data-deck-fixed');
          var v = clamp(Number(el.value), COUNT_LIMITS.min, COUNT_LIMITS.max);
          state.decks = state.decks.map(function (d) { return d.id === id ? Object.assign({}, d, { fixed: v }) : d; });
          persist();
          repaintTable();
        });
      });
      rowsEl.querySelectorAll('[data-deck-per]').forEach(function (el) {
        el.addEventListener('input', function () {
          var id = el.getAttribute('data-deck-per');
          var v = clamp(Number(el.value), COUNT_LIMITS.min, COUNT_LIMITS.max);
          state.decks = state.decks.map(function (d) { return d.id === id ? Object.assign({}, d, { perPlayer: v }) : d; });
          persist();
          repaintTable();
        });
      });
      rowsEl.querySelectorAll('[data-remove-deck]').forEach(function (el) {
        el.addEventListener('click', function () {
          if (state.decks.length <= 1) return;
          var id = el.getAttribute('data-remove-deck');
          state.decks = state.decks.filter(function (d) { return d.id !== id; });
          persist();
          repaintRows();
          repaintTable();
        });
      });
    }

    minInput.addEventListener('input', function () {
      state.minPlayers = clamp(Number(minInput.value), PLAYER_LIMITS.min, PLAYER_LIMITS.max);
      if (state.maxPlayers < state.minPlayers) state.maxPlayers = state.minPlayers;
      if (state.maxPlayers - state.minPlayers > MAX_PLAYER_SPAN) state.maxPlayers = state.minPlayers + MAX_PLAYER_SPAN;
      maxInput.value = state.maxPlayers;
      persist();
      repaintTable();
    });
    maxInput.addEventListener('input', function () {
      var v = clamp(Number(maxInput.value), PLAYER_LIMITS.min, PLAYER_LIMITS.max);
      if (v < state.minPlayers) v = state.minPlayers;
      if (v - state.minPlayers > MAX_PLAYER_SPAN) v = state.minPlayers + MAX_PLAYER_SPAN;
      state.maxPlayers = v;
      maxInput.value = v;
      persist();
      repaintTable();
    });

    addBtn.addEventListener('click', function () {
      if (state.decks.length >= MAX_DECKS) return;
      state.decks = state.decks.concat([{ id: makeDeckId(), name: 'Baralho', fixed: 0, perPlayer: 0 }]);
      persist();
      repaintRows();
      repaintTable();
    });

    repaintRows();
    repaintTable();
  }

  GDC.ui.deckBalancer = { render: render };
}(window));
