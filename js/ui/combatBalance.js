/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // Ferramenta de design pra checar ritmo de combate: uma curva de poder do jogador (ataque/HP por
  // nível, mesma forma "base × nível ^ expoente" do XP Balancer, pro Renato reconhecer o padrão) contra
  // uma lista de inimigos de referência, cada um numa "camada" de nível. Pra cada inimigo, calcula
  // quantos golpes o jogador leva pra matar (TTK) e quantos golpes o jogador aguenta levar antes de
  // morrer — e sinaliza quando um combate ficaria trivial demais ou arrastado demais, ou quando o
  // jogador correria risco de morrer rápido.
  //
  // Diferente do Economy Simulator, esta ferramenta fica AUTOCONTIDA (não lê XP Balancer/Loot
  // Simulator/Árvore de Habilidades) — a Árvore de Habilidades ainda não tem campos de dano/status por
  // nó, então uma ligação de verdade com ela exigiria estender aquele schema primeiro; puxar só o nível
  // máximo do XP Balancer não valia a complexidade extra de manter isso sincronizado entre abas. Se
  // fizer sentido depois, dá pra conectar como uma v2.

  var LIMITS = {
    curveBase: { min: 0, max: 100000 },
    curveExp: { min: 0.1, max: 5 },
    levelTier: { min: 1, max: 200 },
    stat: { min: 0, max: 1000000 },
  };

  var TTK_TRIVIAL_MAX = 1;   // 1 golpe só pra matar = combate sem tensão nenhuma
  var TTK_GRINDY_MIN = 12;   // 12+ golpes = combate arrastado
  var SURVIVAL_RISKY_MAX = 2; // jogador morre em até 2 golpes = risco de morte rápida

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
    return 'enemy-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function fmt(n) { return Math.round(n).toLocaleString('pt-BR'); }

  var DEFAULT_ENEMIES = [
    { id: 'enemy-default-1', name: 'Goblin', levelTier: 1, hp: 30, attack: 4 },
    { id: 'enemy-default-2', name: 'Orc', levelTier: 5, hp: 140, attack: 14 },
    { id: 'enemy-default-3', name: 'Chefe da Masmorra', levelTier: 10, hp: 420, attack: 30 },
  ];

  // ---------- Armas (modos de disparo com carga/cadência/cooldown) ----------
  // contínuo = dispara `rate` tiros/s até gastar `capacity` tiros e recarrega por `cooldown` s (laser
  // do MTE); carregado = segura `chargeTime` s e solta um disparo de `damage`, depois `cooldown` s
  // (plasma); único = um uso a cada `cooldown` s (granada). Independe da curva de ataque do jogador.
  var WEAPON_MODES = {
    continuous: 'Contínuo (carga + recarga)',
    charged: 'Carregado (segurar e soltar)',
    single: 'Uso único (cooldown)',
  };
  var WEAPON_LIMITS = { damage: 1000000, rate: 100, capacity: 10000, time: 3600 };

  var DEFAULT_WEAPONS = [
    { id: 'weapon-default-1', name: 'Laser', mode: 'continuous', damage: 8, rate: 6, capacity: 30, cooldown: 3, chargeTime: 0 },
    { id: 'weapon-default-2', name: 'Canhão de plasma', mode: 'charged', damage: 120, rate: 1, capacity: 1, cooldown: 6, chargeTime: 1.5 },
    { id: 'weapon-default-3', name: 'Granada', mode: 'single', damage: 80, rate: 1, capacity: 1, cooldown: 10, chargeTime: 0 },
  ];

  function normalizeWeapon(w) {
    if (!w || typeof w !== 'object' || typeof w.id !== 'string') return null;
    var num = function (v, max, def) { var n = Number(v); return isFinite(n) ? clamp(n, 0, max) : def; };
    return {
      id: w.id,
      name: typeof w.name === 'string' ? w.name : 'Arma',
      mode: WEAPON_MODES[w.mode] ? w.mode : 'continuous',
      damage: num(w.damage, WEAPON_LIMITS.damage, 10),
      rate: Math.max(0.01, num(w.rate, WEAPON_LIMITS.rate, 1)),
      capacity: Math.max(1, Math.round(num(w.capacity, WEAPON_LIMITS.capacity, 1))),
      cooldown: num(w.cooldown, WEAPON_LIMITS.time, 0),
      chargeTime: num(w.chargeTime, WEAPON_LIMITS.time, 0),
    };
  }

  /** Números de um ciclo completo da arma. */
  function weaponStats(w) {
    if (w.mode === 'continuous') {
      var fireTime = w.capacity / w.rate;
      var cycle = fireTime + w.cooldown;
      var dmg = w.capacity * w.damage;
      return { cycle: cycle, dmgPerCycle: dmg, burstDps: w.damage * w.rate, sustainedDps: cycle > 0 ? dmg / cycle : w.damage * w.rate, uptime: cycle > 0 ? fireTime / cycle : 1 };
    }
    if (w.mode === 'charged') {
      var c2 = w.chargeTime + w.cooldown;
      return { cycle: c2, dmgPerCycle: w.damage, burstDps: w.chargeTime > 0 ? w.damage / w.chargeTime : Infinity, sustainedDps: c2 > 0 ? w.damage / c2 : Infinity, uptime: c2 > 0 ? w.chargeTime / c2 : 1 };
    }
    return { cycle: w.cooldown, dmgPerCycle: w.damage, burstDps: Infinity, sustainedDps: w.cooldown > 0 ? w.damage / w.cooldown : Infinity, uptime: 0 };
  }

  /** Segundos até derrubar `hp`, contando do primeiro disparo (o 1º tiro sai em t=0; no carregado, a
   *  1ª carga conta). Ignora erro de mira, crítico e armadura. */
  function weaponTimeToKill(w, hp) {
    if (w.damage <= 0) return Infinity;
    var n = Math.max(1, Math.ceil(hp / w.damage));
    if (w.mode === 'continuous') {
      var k = Math.floor((n - 1) / w.capacity);
      var r = n - k * w.capacity;
      return k * (w.capacity / w.rate + w.cooldown) + (r - 1) / w.rate;
    }
    if (w.mode === 'charged') return n * w.chargeTime + (n - 1) * w.cooldown;
    return (n - 1) * w.cooldown;
  }

  function fmtSec(t) {
    if (!isFinite(t)) return '—';
    if (t < 10) return (Math.round(t * 10) / 10).toLocaleString('pt-BR') + ' s';
    return Math.round(t).toLocaleString('pt-BR') + ' s';
  }
  function fmtDps(v) { return isFinite(v) ? (v >= 100 ? fmt(v) : (Math.round(v * 10) / 10).toLocaleString('pt-BR')) : 'instantâneo'; }

  function validEnemy(e) {
    return !!e && typeof e.id === 'string' && typeof e.name === 'string' &&
      isFinite(e.levelTier) && isFinite(e.hp) && isFinite(e.attack);
  }

  function parseStored(value) {
    var defaults = {
      baseAttack: 10, attackExponent: 1.15,
      baseHp: 80, hpExponent: 1.25,
      enemies: DEFAULT_ENEMIES.map(function (e) { return Object.assign({}, e); }),
      weapons: DEFAULT_WEAPONS.map(function (w) { return Object.assign({}, w); }),
    };
    if (!value) return defaults;
    try {
      var parsed = JSON.parse(value);
      return {
        baseAttack: clamp(Number(parsed.baseAttack), LIMITS.curveBase.min, LIMITS.curveBase.max) || defaults.baseAttack,
        attackExponent: clamp(Number(parsed.attackExponent), LIMITS.curveExp.min, LIMITS.curveExp.max) || defaults.attackExponent,
        baseHp: clamp(Number(parsed.baseHp), LIMITS.curveBase.min, LIMITS.curveBase.max) || defaults.baseHp,
        hpExponent: clamp(Number(parsed.hpExponent), LIMITS.curveExp.min, LIMITS.curveExp.max) || defaults.hpExponent,
        enemies: Array.isArray(parsed.enemies) ? parsed.enemies.filter(validEnemy) : defaults.enemies,
        // Campo novo: blobs salvos antes dele ganham as armas de exemplo (só ficam salvas se editadas).
        weapons: Array.isArray(parsed.weapons) ? parsed.weapons.map(normalizeWeapon).filter(Boolean) : defaults.weapons,
      };
    } catch (e) { return defaults; }
  }

  function playerAttackAt(state, level) { return state.baseAttack * Math.pow(Math.max(1, level), state.attackExponent); }
  function playerHpAt(state, level) { return state.baseHp * Math.pow(Math.max(1, level), state.hpExponent); }

  function ttkHits(enemyHp, atk) { return Math.max(1, Math.ceil(enemyHp / Math.max(0.01, atk))); }
  function survivalHits(hp, enemyAtk) { return Math.max(1, Math.ceil(hp / Math.max(0.01, enemyAtk))); }

  function ttkBadge(hits) {
    if (hits <= TTK_TRIVIAL_MAX) return { text: 'Trivial', cls: 'combat-badge-warn' };
    if (hits >= TTK_GRINDY_MIN) return { text: 'Arrastado', cls: 'combat-badge-warn' };
    return { text: 'OK', cls: 'combat-badge-ok' };
  }
  function survivalBadge(hits) {
    if (hits <= SURVIVAL_RISKY_MAX) return { text: 'Risco de morte rápida', cls: 'combat-badge-danger' };
    return { text: 'OK', cls: 'combat-badge-ok' };
  }

  function render(container, onChange) {
    var state = parseStored(container.getAttribute('data-value'));

    function persist() { onChange(JSON.stringify(state)); }

    var enemiesEl, resultsEl, chartEl;

    function computeRows() {
      return state.enemies.slice().sort(function (a, b) { return a.levelTier - b.levelTier; }).map(function (en) {
        var atk = playerAttackAt(state, en.levelTier);
        var hp = playerHpAt(state, en.levelTier);
        var ttk = ttkHits(en.hp, atk);
        var surv = survivalHits(hp, en.attack);
        return { enemy: en, playerAttack: atk, playerHp: hp, ttk: ttk, survival: surv, ttkBadge: ttkBadge(ttk), survivalBadge: survivalBadge(surv) };
      });
    }

    function repaint() {
      repaintWeapons();
      var rows = computeRows();

      if (!rows.length) {
        resultsEl.innerHTML = '<p class="text-xs text-muted">Adicione um inimigo de referência pra ver o balanço aqui.</p>';
        chartEl.innerHTML = '';
        return;
      }

      resultsEl.innerHTML =
        '<div class="combat-table">' +
        '  <div class="combat-table-head">' +
        '    <span>Inimigo</span><span>Nível</span><span>Golpes p/ matar</span><span>Golpes p/ morrer</span>' +
        '  </div>' +
        rows.map(function (r) {
          return (
            '<div class="combat-table-row">' +
            '  <span class="truncate">' + escapeHtml(r.enemy.name || '(sem nome)') + '</span>' +
            '  <span>' + r.enemy.levelTier + '</span>' +
            '  <span><strong>' + r.ttk + '</strong> <span class="combat-badge ' + r.ttkBadge.cls + '">' + r.ttkBadge.text + '</span></span>' +
            '  <span><strong>' + r.survival + '</strong> <span class="combat-badge ' + r.survivalBadge.cls + '">' + r.survivalBadge.text + '</span></span>' +
            '</div>'
          );
        }).join('') +
        '</div>';

      var maxTtk = Math.max.apply(null, rows.map(function (r) { return r.ttk; }).concat([1]));
      chartEl.innerHTML = rows.map(function (r) {
        var pct = r.ttk / maxTtk * 100;
        return '<div class="xp-bar-wrap"><div class="combat-bar" style="height:' + pct + '%"></div><span class="xp-bar-label">' + r.ttk + '</span></div>';
      }).join('');
    }

    // ---------- Armas ----------
    var weaponsEl, weaponResultsEl;

    function weaponFieldsMarkup(w) {
      var n = function (f, label, val, step, title) {
        return '<label class="combat-inline-label"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + label +
          '<input type="number" min="0" step="' + step + '" data-wf="' + f + '" value="' + val + '" class="input-field w-20 py-1 text-xs" /></label>';
      };
      var html = n('damage', 'Dano', w.damage, 1, w.mode === 'continuous' ? 'Dano por tiro' : 'Dano por disparo');
      if (w.mode === 'continuous') {
        html += n('rate', 'Tiros/s', w.rate, 0.5, 'Cadência enquanto a carga dura') +
          n('capacity', 'Carga', w.capacity, 1, 'Tiros até a carga zerar') +
          n('cooldown', 'Recarga (s)', w.cooldown, 0.5, 'Tempo parado depois que a carga zera');
      } else if (w.mode === 'charged') {
        html += n('chargeTime', 'Carga (s)', w.chargeTime, 0.1, 'Tempo segurando antes de disparar') +
          n('cooldown', 'Cooldown (s)', w.cooldown, 0.5, 'Tempo parado depois do disparo');
      } else {
        html += n('cooldown', 'Cooldown (s)', w.cooldown, 0.5, 'Tempo entre usos');
      }
      return html;
    }

    function renderWeaponRows() {
      weaponsEl.innerHTML = state.weapons.length
        ? state.weapons.map(function (w) {
          return (
            '<div class="combat-weapon-row" data-weapon="' + escapeHtml(w.id) + '">' +
            '  <input type="text" data-wf="name" value="' + escapeHtml(w.name) + '" class="input-field py-1 text-xs combat-weapon-name" placeholder="Nome da arma" />' +
            '  <select data-wf="mode" class="input-field py-1 text-xs combat-weapon-mode">' + Object.keys(WEAPON_MODES).map(function (k) {
              return '<option value="' + k + '"' + (k === w.mode ? ' selected' : '') + '>' + WEAPON_MODES[k] + '</option>';
            }).join('') + '</select>' +
            '  <div class="combat-weapon-fields">' + weaponFieldsMarkup(w) + '</div>' +
            '  <button type="button" class="flex-shrink-0 text-muted hover:text-primary" data-weapon-dup title="Duplicar (pra comparar uma variação)">' + GDC.icon('copy', { size: 14 }) + '</button>' +
            '  <button type="button" class="flex-shrink-0 text-muted hover:text-rose-500" data-weapon-remove title="Remover">' + GDC.icon('trash-2', { size: 14 }) + '</button>' +
            '</div>'
          );
        }).join('')
        : '<p class="text-xs text-muted">Nenhuma arma cadastrada ainda.</p>';
    }

    function repaintWeapons() {
      if (!weaponResultsEl) return;
      if (!state.weapons.length) { weaponResultsEl.innerHTML = ''; return; }
      var stats = state.weapons.map(weaponStats);
      var statRows = state.weapons.map(function (w, i) {
        var st = stats[i];
        return (
          '<div class="combat-table-row combat-weapon-stat-row">' +
          '  <span class="truncate">' + escapeHtml(w.name || '(sem nome)') + '</span>' +
          '  <span>' + fmt(st.dmgPerCycle) + '</span>' +
          '  <span>' + fmtSec(st.cycle) + '</span>' +
          '  <span>' + fmtDps(st.burstDps) + '</span>' +
          '  <span><strong>' + fmtDps(st.sustainedDps) + '</strong></span>' +
          '  <span>' + (w.mode === 'single' ? '—' : Math.round(st.uptime * 100) + '%') + '</span>' +
          '</div>'
        );
      }).join('');
      var enemies = state.enemies.slice().sort(function (a, b) { return a.levelTier - b.levelTier; });
      var matrix = '';
      if (enemies.length) {
        var cols = 'grid-template-columns: minmax(7rem, 1.4fr) repeat(' + state.weapons.length + ', minmax(5rem, 1fr))';
        matrix =
          '<h4 class="text-xs font-bold text-secondary mt-4 mb-2">Tempo pra matar cada inimigo (a mais rápida em destaque)</h4>' +
          '<div class="combat-matrix-scroll"><div class="combat-table combat-matrix">' +
          '  <div class="combat-table-head" style="' + cols + '"><span>Inimigo (HP)</span>' + state.weapons.map(function (w) { return '<span class="truncate">' + escapeHtml(w.name || '(sem nome)') + '</span>'; }).join('') + '</div>' +
          enemies.map(function (en) {
            var times = state.weapons.map(function (w) { return weaponTimeToKill(w, en.hp); });
            var best = Math.min.apply(null, times);
            return '<div class="combat-table-row" style="' + cols + '"><span class="truncate">' + escapeHtml(en.name || '(sem nome)') + ' <span class="text-muted">(' + fmt(en.hp) + ')</span></span>' +
              times.map(function (t) { return '<span' + (t === best && isFinite(t) && state.weapons.length > 1 ? ' class="combat-best"' : '') + '>' + fmtSec(t) + '</span>'; }).join('') + '</div>';
          }).join('') +
          '</div></div>';
      }
      var maxDps = Math.max.apply(null, stats.map(function (st) { return isFinite(st.sustainedDps) ? st.sustainedDps : 0; }).concat([1]));
      var bars = '<div class="combat-dps-bars">' + state.weapons.map(function (w, i) {
        var v = stats[i].sustainedDps;
        var pct = isFinite(v) ? v / maxDps * 100 : 100;
        return '<div class="combat-dps-row"><span class="truncate">' + escapeHtml(w.name || '(sem nome)') + '</span><div class="combat-dps-track"><div class="combat-dps-fill" style="width:' + pct.toFixed(1) + '%"></div></div><span>' + fmtDps(v) + '</span></div>';
      }).join('') + '</div>';
      weaponResultsEl.innerHTML =
        '<h4 class="text-xs font-bold text-secondary mb-2">DPS sustentado (com recarga/cooldown)</h4>' + bars +
        '<div class="combat-table combat-weapon-stats mt-3">' +
        '  <div class="combat-table-head combat-weapon-stat-row"><span>Arma</span><span>Dano/ciclo</span><span>Ciclo</span><span>DPS rajada</span><span>DPS sustentado</span><span>Atirando</span></div>' +
        statRows + '</div>' + matrix;
    }

    function bindWeapons() {
      weaponsEl.addEventListener('input', function (e) {
        var t = e.target, f = t.getAttribute('data-wf');
        if (!f || f === 'mode') return;
        var row = t.closest('[data-weapon]');
        var w = row && state.weapons.filter(function (x) { return x.id === row.getAttribute('data-weapon'); })[0];
        if (!w) return;
        if (f === 'name') w.name = t.value;
        else {
          var norm = normalizeWeapon(Object.assign({}, w, (function () { var o = {}; o[f] = t.value === '' ? 0 : Number(t.value); return o; })()));
          w[f] = norm[f];
        }
        persist(); repaintWeapons();
      });
      weaponsEl.addEventListener('change', function (e) {
        var t = e.target;
        if (t.getAttribute('data-wf') !== 'mode') return;
        var row = t.closest('[data-weapon]');
        var w = row && state.weapons.filter(function (x) { return x.id === row.getAttribute('data-weapon'); })[0];
        if (!w) return;
        w.mode = WEAPON_MODES[t.value] ? t.value : 'continuous';
        if (w.mode === 'charged' && !w.chargeTime) w.chargeTime = 1;
        persist(); renderWeaponRows(); repaintWeapons();
      });
      weaponsEl.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-weapon-remove], [data-weapon-dup]');
        if (!btn) return;
        var row = btn.closest('[data-weapon]');
        var idx = -1;
        state.weapons.forEach(function (x, i) { if (x.id === row.getAttribute('data-weapon')) idx = i; });
        if (idx === -1) return;
        if (btn.hasAttribute('data-weapon-dup')) {
          var copy = Object.assign({}, state.weapons[idx], { id: makeRowId().replace('enemy', 'weapon'), name: state.weapons[idx].name + ' (variação)' });
          state.weapons.splice(idx + 1, 0, copy);
        } else {
          state.weapons.splice(idx, 1);
        }
        persist(); renderWeaponRows(); repaintWeapons();
      });
    }

    function enemyRowsMarkup() {
      return state.enemies.map(function (en) {
        return (
          '<div class="flex items-center gap-2" data-enemy="' + en.id + '">' +
          '  <input type="text" data-f="name" value="' + escapeHtml(en.name) + '" class="input-field flex-1 py-1 text-xs" placeholder="Nome" />' +
          '  <label class="combat-inline-label">Nv<input type="number" min="1" max="200" data-f="levelTier" value="' + en.levelTier + '" class="input-field w-16 py-1 text-xs" /></label>' +
          '  <label class="combat-inline-label">HP<input type="number" min="0" data-f="hp" value="' + en.hp + '" class="input-field w-20 py-1 text-xs" /></label>' +
          '  <label class="combat-inline-label">Ataque<input type="number" min="0" data-f="attack" value="' + en.attack + '" class="input-field w-20 py-1 text-xs" /></label>' +
          '  <button type="button" class="flex-shrink-0 text-muted hover:text-rose-500" data-remove title="Remover">' + GDC.icon('trash-2', { size: 14 }) + '</button>' +
          '</div>'
        );
      }).join('');
    }

    function renderEnemyRows() {
      enemiesEl.innerHTML = state.enemies.length
        ? '<div class="space-y-1.5">' + enemyRowsMarkup() + '</div>'
        : '<p class="text-xs text-muted">Nenhum inimigo cadastrado ainda.</p>';

      enemiesEl.querySelectorAll('[data-enemy]').forEach(function (rowEl) {
        var id = rowEl.getAttribute('data-enemy');
        var en = state.enemies.filter(function (e) { return e.id === id; })[0];
        if (!en) return;
        var nameInput = rowEl.querySelector('[data-f="name"]');
        var tierInput = rowEl.querySelector('[data-f="levelTier"]');
        var hpInput = rowEl.querySelector('[data-f="hp"]');
        var atkInput = rowEl.querySelector('[data-f="attack"]');
        nameInput.addEventListener('input', function () { en.name = nameInput.value; persist(); repaint(); });
        tierInput.addEventListener('input', function () { en.levelTier = clamp(Math.round(Number(tierInput.value)), LIMITS.levelTier.min, LIMITS.levelTier.max); persist(); repaint(); });
        hpInput.addEventListener('input', function () { en.hp = clamp(Number(hpInput.value), LIMITS.stat.min, LIMITS.stat.max); persist(); repaint(); });
        atkInput.addEventListener('input', function () { en.attack = clamp(Number(atkInput.value), LIMITS.stat.min, LIMITS.stat.max); persist(); repaint(); });
        var removeBtn = rowEl.querySelector('[data-remove]');
        removeBtn.addEventListener('click', function () {
          var idx = state.enemies.indexOf(en);
          if (idx !== -1) state.enemies.splice(idx, 1);
          persist();
          renderEnemyRows();
          repaint();
        });
      });
    }

    container.innerHTML =
      '<div class="space-y-4">' +
      '  <div>' +
      '    <h4 class="text-xs font-bold text-secondary mb-2">Curva de poder do jogador (mesmo formato do XP Balancer: base × nível ^ expoente)</h4>' +
      '    <div class="grid grid-cols-2 gap-3">' +
      '      <label class="text-xs text-secondary">Ataque base<input type="number" min="0" id="combat-atk-base" value="' + state.baseAttack + '" class="input-field mt-1 py-1.5 text-xs" /></label>' +
      '      <label class="text-xs text-secondary">Expoente de ataque<input type="number" min="0.1" step="0.05" id="combat-atk-exp" value="' + state.attackExponent + '" class="input-field mt-1 py-1.5 text-xs" /></label>' +
      '      <label class="text-xs text-secondary">HP base<input type="number" min="0" id="combat-hp-base" value="' + state.baseHp + '" class="input-field mt-1 py-1.5 text-xs" /></label>' +
      '      <label class="text-xs text-secondary">Expoente de HP<input type="number" min="0.1" step="0.05" id="combat-hp-exp" value="' + state.hpExponent + '" class="input-field mt-1 py-1.5 text-xs" /></label>' +
      '    </div>' +
      '  </div>' +

      '  <div class="rounded-xl border border-default p-4 space-y-2">' +
      '    <h4 class="text-xs font-bold text-secondary">Inimigos de referência</h4>' +
      '    <div id="combat-enemies"></div>' +
      '    <button type="button" id="combat-add-enemy" class="btn-ghost py-1.5 text-xs">' + GDC.icon('plus', { size: 14 }) + 'Adicionar inimigo</button>' +
      '  </div>' +

      '  <div class="rounded-xl border border-default p-4">' +
      '    <h4 class="text-xs font-bold text-secondary mb-2">Golpes pra matar, por nível</h4>' +
      '    <div class="econ-chart-track" id="combat-chart"></div>' +
      '  </div>' +

      '  <div id="combat-results"></div>' +

      '  <div class="rounded-xl border border-default p-4 space-y-3">' +
      '    <div>' +
      '      <h4 class="text-xs font-bold text-secondary">Armas e modos de disparo</h4>' +
      '      <p class="text-xs text-muted mt-0.5">Contínuo = atira até a carga zerar e recarrega; carregado = segura e solta; uso único = cooldown entre usos. Duplique uma arma pra comparar linhas de upgrade lado a lado.</p>' +
      '    </div>' +
      '    <div id="combat-weapons" class="space-y-1.5"></div>' +
      '    <button type="button" id="combat-add-weapon" class="btn-ghost py-1.5 text-xs">' + GDC.icon('plus', { size: 14 }) + 'Adicionar arma</button>' +
      '    <div id="combat-weapon-results"></div>' +
      '  </div>' +
      '</div>';

    enemiesEl = container.querySelector('#combat-enemies');
    resultsEl = container.querySelector('#combat-results');
    chartEl = container.querySelector('#combat-chart');
    weaponsEl = container.querySelector('#combat-weapons');
    weaponResultsEl = container.querySelector('#combat-weapon-results');
    bindWeapons();
    container.querySelector('#combat-add-weapon').addEventListener('click', function () {
      state.weapons.push({ id: makeRowId().replace('enemy', 'weapon'), name: 'Arma ' + (state.weapons.length + 1), mode: 'continuous', damage: 10, rate: 2, capacity: 12, cooldown: 2, chargeTime: 0 });
      persist(); renderWeaponRows(); repaintWeapons();
    });

    container.querySelector('#combat-atk-base').addEventListener('input', function (e) {
      state.baseAttack = clamp(Number(e.target.value), LIMITS.curveBase.min, LIMITS.curveBase.max);
      persist(); repaint();
    });
    container.querySelector('#combat-atk-exp').addEventListener('input', function (e) {
      state.attackExponent = clamp(Number(e.target.value), LIMITS.curveExp.min, LIMITS.curveExp.max);
      persist(); repaint();
    });
    container.querySelector('#combat-hp-base').addEventListener('input', function (e) {
      state.baseHp = clamp(Number(e.target.value), LIMITS.curveBase.min, LIMITS.curveBase.max);
      persist(); repaint();
    });
    container.querySelector('#combat-hp-exp').addEventListener('input', function (e) {
      state.hpExponent = clamp(Number(e.target.value), LIMITS.curveExp.min, LIMITS.curveExp.max);
      persist(); repaint();
    });
    container.querySelector('#combat-add-enemy').addEventListener('click', function () {
      state.enemies.push({ id: makeRowId(), name: 'Inimigo ' + (state.enemies.length + 1), levelTier: 1, hp: 50, attack: 5 });
      persist();
      renderEnemyRows();
      repaint();
    });

    renderWeaponRows();
    renderEnemyRows();
    repaint();
  }

  GDC.ui.combatBalance = { render: render, weaponStats: weaponStats, weaponTimeToKill: weaponTimeToKill, normalizeWeapon: normalizeWeapon };
}(window));
