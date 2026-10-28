/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // ---------------------------------------------------------------------------------------------
  // Diálogos: ferramenta da aba Ferramentas (blob JSON em doc.tools.dialogues, mesmo padrão das
  // outras). Pensada pra roteiro com condição — falas que só aparecem se algo aconteceu antes (ex.:
  // comentário do POGO sobre um artefato do Museu, hipótese que o jogador confirma ou refuta).
  //
  // { speakers: [{ id, name, codexId, color, expressions: [{ id, name, color }] }],
  //   conversations: [{ id, title, trigger, codexIds, lines: [line] }] }
  // line = { id, kind: 'line'|'choice', speakerId, expressionId, text, condition, effect,
  //          options: [{ id, text, effect, goto }] }  (options só em 'choice')
  //
  // Flags: booleanas, nomeadas pelo usuário. `condition` = termos separados por vírgula, todos
  // precisam valer ("viu_cratera, !hipotese_refutada"); `effect` = termos que ligam ("flag") ou
  // desligam ("!flag"). `goto` de uma opção = id de outra fala da mesma conversa, 'end' (encerra) ou
  // '' (segue pra próxima fala). Execução: as falas rodam em ordem; fala cuja condição não vale é
  // pulada. A checagem de flags olha o projeto inteiro (todas as conversas).
  //
  // Eventos por delegação no container — tools.js recria o container a cada render.
  // ---------------------------------------------------------------------------------------------

  var SPEAKER_COLORS = ['#06b6d4', '#f59e0b', '#8b5cf6', '#10b981', '#ec4899', '#3b82f6', '#f43f5e', '#84cc16'];

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 20000) : ''; }
  function strList(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x; }) : []; }
  function color(v, i) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : SPEAKER_COLORS[i % SPEAKER_COLORS.length]; }
  function id(prefix) { return GDC.makeId(prefix); }

  // ---------- Formato ----------

  function normalizeExpression(e, i) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') return null;
    return { id: e.id, name: str(e.name, 60) || 'Expressão', color: color(e.color, i) };
  }
  function normalizeSpeaker(sp, i) {
    if (!sp || typeof sp !== 'object' || typeof sp.id !== 'string') return null;
    var exps = (Array.isArray(sp.expressions) ? sp.expressions : []).map(normalizeExpression).filter(Boolean);
    if (!exps.length) exps = [{ id: id('exp'), name: 'Neutro', color: color(sp.color, i) }];
    return { id: sp.id, name: str(sp.name, 80), codexId: typeof sp.codexId === 'string' && sp.codexId ? sp.codexId : null, color: color(sp.color, i), expressions: exps };
  }
  function normalizeOption(o) {
    if (!o || typeof o !== 'object' || typeof o.id !== 'string') return null;
    return { id: o.id, text: str(o.text, 2000), effect: str(o.effect, 500), goto: str(o.goto, 200) };
  }
  function normalizeLine(l) {
    if (!l || typeof l !== 'object' || typeof l.id !== 'string') return null;
    var kind = l.kind === 'choice' ? 'choice' : 'line';
    return {
      id: l.id, kind: kind,
      speakerId: typeof l.speakerId === 'string' && l.speakerId ? l.speakerId : null,
      expressionId: typeof l.expressionId === 'string' && l.expressionId ? l.expressionId : null,
      text: str(l.text), condition: str(l.condition, 500), effect: str(l.effect, 500),
      options: kind === 'choice' ? (Array.isArray(l.options) ? l.options : []).map(normalizeOption).filter(Boolean) : [],
    };
  }
  function normalizeConversation(c) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') return null;
    return {
      id: c.id, title: str(c.title, 200), trigger: str(c.trigger, 1000), codexIds: strList(c.codexIds),
      lines: (Array.isArray(c.lines) ? c.lines : []).map(normalizeLine).filter(Boolean),
    };
  }
  function parseStored(value) {
    var empty = { speakers: [], conversations: [] };
    if (!value) return empty;
    var p;
    try { p = JSON.parse(value); } catch (e) { return empty; }
    if (!p || typeof p !== 'object') return empty;
    var speakers = (Array.isArray(p.speakers) ? p.speakers : []).map(normalizeSpeaker).filter(Boolean);
    var spIds = {};
    speakers.forEach(function (s) { spIds[s.id] = s; });
    var conversations = (Array.isArray(p.conversations) ? p.conversations : []).map(normalizeConversation).filter(Boolean);
    conversations.forEach(function (c) {
      c.lines.forEach(function (l) {
        var sp = l.speakerId && spIds[l.speakerId];
        if (!sp) { l.speakerId = null; l.expressionId = null; return; }
        if (l.expressionId && !sp.expressions.some(function (e) { return e.id === l.expressionId; })) l.expressionId = null;
      });
    });
    return { speakers: speakers, conversations: conversations };
  }

  // ---------- Flags ----------

  /** "a, !b" → [{ flag:'a', neg:false }, { flag:'b', neg:true }]. Aceita vírgula, "&&" ou " e ". */
  function parseTerms(s) {
    return String(s || '').split(/\s*(?:,|&&|\s+e\s+)\s*/i).map(function (t) { return t.trim(); }).filter(Boolean).map(function (t) {
      var neg = /^(!|não\s+|nao\s+)/i.test(t);
      return { flag: t.replace(/^(!|não\s+|nao\s+)/i, '').trim().toLowerCase().replace(/\s+/g, '_'), neg: neg };
    }).filter(function (t) { return t.flag; });
  }
  function conditionHolds(cond, flags) {
    return parseTerms(cond).every(function (t) { return !!flags[t.flag] !== t.neg; });
  }
  function applyEffect(effect, flags) {
    parseTerms(effect).forEach(function (t) { flags[t.flag] = !t.neg; });
  }

  /** Índice de flags do projeto: onde cada uma é lida (condições) e definida (efeitos) + avisos. */
  function analyze(state) {
    var flags = {};
    var get = function (f) { return flags[f] || (flags[f] = { name: f, reads: [], writes: [] }); };
    var issues = [];
    state.conversations.forEach(function (c) {
      var lineIds = {};
      c.lines.forEach(function (l) { lineIds[l.id] = true; });
      c.lines.forEach(function (l, i) {
        var where = { convId: c.id, conv: c.title || '(sem título)', n: i + 1 };
        parseTerms(l.condition).forEach(function (t) { get(t.flag).reads.push(Object.assign({ neg: t.neg }, where)); });
        parseTerms(l.effect).forEach(function (t) { get(t.flag).writes.push(where); });
        l.options.forEach(function (o) {
          parseTerms(o.effect).forEach(function (t) { get(t.flag).writes.push(where); });
          if (o.goto && o.goto !== 'end' && !lineIds[o.goto]) issues.push({ kind: 'goto', text: 'Opção "' + (o.text || '…') + '" salta para uma fala que não existe mais', where: where });
        });
        if (l.kind === 'choice' && !l.options.length) issues.push({ kind: 'choice', text: 'Escolha sem nenhuma opção', where: where });
      });
    });
    Object.keys(flags).forEach(function (f) {
      var fl = flags[f];
      // Ler "!flag" de algo nunca definido é sempre verdadeiro — só a leitura positiva é suspeita.
      if (fl.reads.some(function (r) { return !r.neg; }) && !fl.writes.length) {
        issues.push({ kind: 'never-set', flag: f, text: 'A flag "' + f + '" é exigida mas nenhum diálogo a define (pode vir do jogo — confira)', where: fl.reads[0] });
      }
    });
    var list = Object.keys(flags).sort().map(function (f) { return flags[f]; });
    return { flags: list, issues: issues };
  }

  /** Roda a conversa a partir das flags iniciais até a próxima escolha (ou o fim). `picks` = ids das
   *  opções já escolhidas, em ordem. Devolve { steps, pendingChoice, flags, ended }. */
  function simulate(conv, initialFlags, picks) {
    var flags = Object.assign({}, initialFlags);
    var steps = [], i = 0, guard = 0, pickIdx = 0;
    var indexOf = function (lineId) { for (var k = 0; k < conv.lines.length; k++) if (conv.lines[k].id === lineId) return k; return -1; };
    while (i < conv.lines.length && guard++ < 500) {
      var l = conv.lines[i];
      if (!conditionHolds(l.condition, flags)) { steps.push({ line: l, skipped: true }); i++; continue; }
      if (l.kind === 'line') {
        applyEffect(l.effect, flags);
        steps.push({ line: l });
        i++; continue;
      }
      // escolha
      applyEffect(l.effect, flags);
      if (pickIdx >= picks.length) return { steps: steps, pendingChoice: l, flags: flags, ended: false };
      var opt = l.options.filter(function (o) { return o.id === picks[pickIdx]; })[0];
      pickIdx++;
      if (!opt) return { steps: steps, pendingChoice: l, flags: flags, ended: false };
      steps.push({ line: l, picked: opt });
      applyEffect(opt.effect, flags);
      if (opt.goto === 'end') return { steps: steps, pendingChoice: null, flags: flags, ended: true };
      if (opt.goto) { var j = indexOf(opt.goto); if (j !== -1) { i = j; continue; } }
      i++;
    }
    return { steps: steps, pendingChoice: null, flags: flags, ended: true, loop: guard >= 500 };
  }

  // ---------- UI ----------

  function render(container, onChange, opts) {
    opts = opts || {};
    var codex = opts.codex || { types: [], entries: [] };
    var onGotoCodexEntry = opts.onGotoCodexEntry;
    var state = parseStored(container.getAttribute('data-value'));
    var expandedConv = null, editingSpeaker = null;
    var sim = null; // { convId, initial: {flag:bool}, picks: [] }

    function persist() { onChange(JSON.stringify(state)); }

    container.innerHTML =
      '<div class="space-y-4">' +
      '  <div class="dlg-speakers-wrap"></div>' +
      '  <div class="quest-toolbar">' +
      '    <span class="quest-progress-badge" data-dlg-count></span>' +
      '    <button type="button" class="btn-primary py-1.5 text-xs" data-da="add-conv">' + GDC.icon('plus', { size: 13 }) + 'Nova conversa</button>' +
      '  </div>' +
      '  <div class="dlg-convs"></div>' +
      '  <div class="dlg-flags"></div>' +
      '</div>';
    var speakersEl = container.querySelector('.dlg-speakers-wrap');
    var convsEl = container.querySelector('.dlg-convs');
    var flagsEl = container.querySelector('.dlg-flags');
    var countEl = container.querySelector('[data-dlg-count]');

    function speakerById(sid) { return state.speakers.filter(function (s) { return s.id === sid; })[0] || null; }
    function convById(cid) { return state.conversations.filter(function (c) { return c.id === cid; })[0] || null; }
    function entryById(eid) { return codex.entries.filter(function (e) { return e.id === eid; })[0] || null; }
    function typeById(tid) { return codex.types.filter(function (t) { return t.id === tid; })[0] || null; }
    function speakerName(sp) {
      if (!sp) return 'Narração';
      var e = sp.codexId && entryById(sp.codexId);
      return sp.name || (e && e.name) || 'Sem nome';
    }

    function codexOptions(exclude, current) {
      return codex.types.map(function (t) {
        var list = codex.entries.filter(function (e) { return e.typeId === t.id && (exclude || []).indexOf(e.id) === -1; })
          .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'pt-BR'); });
        if (!list.length) return '';
        return '<optgroup label="' + escapeHtml(t.name) + '">' + list.map(function (e) {
          return '<option value="' + escapeHtml(e.id) + '"' + (e.id === current ? ' selected' : '') + '>' + escapeHtml(e.name || '(sem nome)') + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
    }

    // ---------- Personagens ----------

    function renderSpeakers() {
      var chips = state.speakers.map(function (sp) {
        return '<button type="button" class="dlg-speaker-chip' + (editingSpeaker === sp.id ? ' dlg-speaker-chip-on' : '') + '" data-da="edit-speaker" data-id="' + escapeHtml(sp.id) + '">' +
          '<span class="dlg-dot" style="background-color:' + sp.color + '"></span>' + escapeHtml(speakerName(sp)) +
          '<span class="text-muted">· ' + sp.expressions.length + '</span></button>';
      }).join('');
      var editor = '';
      var sp = editingSpeaker && speakerById(editingSpeaker);
      if (sp) {
        var exps = sp.expressions.map(function (e) {
          return '<div class="dlg-exp-row" data-exp="' + escapeHtml(e.id) + '">' +
            '<input type="color" class="gdd-layout-color" data-sf="exp-color" value="' + e.color + '" title="Cor da expressão" />' +
            '<input type="text" class="input-field py-1 text-xs" data-sf="exp-name" value="' + escapeHtml(e.name) + '" placeholder="Expressão" />' +
            (sp.expressions.length > 1 ? '<button type="button" class="quest-chip-x" data-da="exp-remove" title="Remover expressão">' + GDC.icon('x', { size: 11 }) + '</button>' : '') +
            '</div>';
        }).join('');
        editor =
          '<div class="dlg-speaker-editor" data-speaker="' + escapeHtml(sp.id) + '">' +
          '  <div class="dlg-speaker-editor-row">' +
          '    <input type="color" class="gdd-layout-color" data-sf="color" value="' + sp.color + '" title="Cor do personagem" />' +
          '    <input type="text" class="input-field py-1.5 text-xs" data-sf="name" value="' + escapeHtml(sp.name) + '" placeholder="Nome (vazio = nome da entrada do Codex)" />' +
          (codex.types.length ? '    <select class="input-field py-1.5 text-xs" data-sf="codexId"><option value="">Sem vínculo com o Codex</option>' + codexOptions([], sp.codexId) + '</select>' : '') +
          (sp.codexId && entryById(sp.codexId) ? '    <button type="button" class="wp-icon-btn" data-da="goto-codex" data-id="' + escapeHtml(sp.codexId) + '" title="Abrir no Codex">' + GDC.icon('book-open', { size: 13 }) + '</button>' : '') +
          '    <button type="button" class="wp-icon-btn" data-da="speaker-remove" title="Excluir personagem">' + GDC.icon('trash-2', { size: 13 }) + '</button>' +
          '  </div>' +
          '  <p class="quest-field-label">Expressões</p>' +
          '  <div class="dlg-exps">' + exps + '</div>' +
          '  <button type="button" class="btn-ghost py-1 text-xs" data-da="exp-add">' + GDC.icon('plus', { size: 12 }) + 'Expressão</button>' +
          '</div>';
      }
      speakersEl.innerHTML =
        '<div class="dlg-speakers">' +
        '  <span class="quest-field-label">Quem fala</span>' + chips +
        '  <button type="button" class="btn-ghost py-1 text-xs" data-da="add-speaker">' + GDC.icon('plus', { size: 12 }) + 'Personagem</button>' +
        '</div>' + editor;
    }

    // ---------- Conversas ----------

    function lineLabel(conv, lineId) {
      var k = -1;
      conv.lines.forEach(function (l, i) { if (l.id === lineId) k = i; });
      if (k === -1) return null;
      var l = conv.lines[k];
      var t = (l.text || '').replace(/\s+/g, ' ').trim();
      return '#' + (k + 1) + (t ? ' ' + (t.length > 32 ? t.slice(0, 30) + '…' : t) : '');
    }

    function lineMarkup(conv, l, i) {
      var sp = speakerById(l.speakerId);
      var exp = sp && (sp.expressions.filter(function (e) { return e.id === l.expressionId; })[0] || null);
      var spOpts = '<option value="">Narração</option>' + state.speakers.map(function (s) {
        return '<option value="' + escapeHtml(s.id) + '"' + (s.id === l.speakerId ? ' selected' : '') + '>' + escapeHtml(speakerName(s)) + '</option>';
      }).join('');
      var expSel = sp ? '<select class="input-field py-1 text-xs dlg-exp-select" data-lf="expressionId" style="border-left:4px solid ' + (exp ? exp.color : 'transparent') + '"><option value="">Sem expressão</option>' + sp.expressions.map(function (e) {
        return '<option value="' + escapeHtml(e.id) + '"' + (e.id === l.expressionId ? ' selected' : '') + '>' + escapeHtml(e.name) + '</option>';
      }).join('') + '</select>' : '';
      var gotoOpts = function (cur) {
        return '<option value=""' + (!cur ? ' selected' : '') + '>Segue para a próxima</option><option value="end"' + (cur === 'end' ? ' selected' : '') + '>Encerra a conversa</option>' +
          conv.lines.map(function (x, k) {
            if (x.id === l.id) return '';
            return '<option value="' + escapeHtml(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>Vai para ' + escapeHtml(lineLabel(conv, x.id)) + '</option>';
          }).join('') +
          (cur && cur !== 'end' && !lineLabel(conv, cur) ? '<option value="' + escapeHtml(cur) + '" selected>⚠ fala removida</option>' : '');
      };
      var optionsHtml = l.kind === 'choice'
        ? '<div class="dlg-options">' + l.options.map(function (o) {
          return '<div class="dlg-option" data-opt="' + escapeHtml(o.id) + '">' +
            '<span class="dlg-option-bullet">' + GDC.icon('chevron-right', { size: 12 }) + '</span>' +
            '<input type="text" class="input-field py-1 text-xs" data-of="text" value="' + escapeHtml(o.text) + '" placeholder="Texto da opção (o que o jogador escolhe)" />' +
            '<input type="text" class="input-field py-1 text-xs dlg-flag-input" data-of="effect" value="' + escapeHtml(o.effect) + '" placeholder="define flags" title="Flags que esta opção liga (ou !flag pra desligar)" />' +
            '<select class="input-field py-1 text-xs dlg-goto" data-of="goto">' + gotoOpts(o.goto) + '</select>' +
            '<button type="button" class="quest-chip-x" data-da="opt-remove" title="Remover opção">' + GDC.icon('x', { size: 11 }) + '</button>' +
            '</div>';
        }).join('') + '<button type="button" class="btn-ghost py-1 text-xs" data-da="opt-add">' + GDC.icon('plus', { size: 12 }) + 'Opção</button></div>'
        : '';
      return (
        '<div class="dlg-line' + (l.kind === 'choice' ? ' dlg-line-choice' : '') + '" data-line="' + escapeHtml(l.id) + '" style="border-left-color:' + (sp ? sp.color : 'rgb(var(--border-hover))') + '">' +
        '  <div class="dlg-line-head">' +
        '    <span class="dlg-line-num">' + (i + 1) + '</span>' +
        (l.kind === 'choice' ? '<span class="dlg-kind">' + GDC.icon('list', { size: 11 }) + 'Escolha do jogador</span>' : '') +
        '    <select class="input-field py-1 text-xs dlg-speaker-select" data-lf="speakerId">' + spOpts + '</select>' + expSel +
        '    <span class="wp-stage-spacer"></span>' +
        '    <button type="button" class="wp-icon-btn" data-da="line-up" title="Subir"' + (i === 0 ? ' disabled' : '') + '>' + GDC.icon('chevron-up', { size: 13 }) + '</button>' +
        '    <button type="button" class="wp-icon-btn" data-da="line-down" title="Descer"' + (i === conv.lines.length - 1 ? ' disabled' : '') + '>' + GDC.icon('chevron-down', { size: 13 }) + '</button>' +
        '    <button type="button" class="wp-icon-btn" data-da="line-remove" title="Remover">' + GDC.icon('trash-2', { size: 13 }) + '</button>' +
        '  </div>' +
        '  <textarea class="input-field resize-y py-1.5 text-xs" rows="2" data-lf="text" placeholder="' + (l.kind === 'choice' ? 'Pergunta ou contexto da escolha (opcional)' : 'Fala') + '">' + escapeHtml(l.text) + '</textarea>' +
        '  <div class="dlg-line-flags">' +
        '    <label class="combat-inline-label" title="Flags que precisam estar ligadas (vírgula separa; !flag = desligada). Vazio = sempre aparece.">' + GDC.icon('lock', { size: 11 }) + 'Só se' +
        '      <input type="text" class="input-field py-1 text-xs dlg-flag-input" data-lf="condition" value="' + escapeHtml(l.condition) + '" placeholder="sempre" /></label>' +
        '    <label class="combat-inline-label" title="Flags que esta fala liga (ou !flag pra desligar) quando aparece">' + GDC.icon('flag', { size: 11 }) + 'Define' +
        '      <input type="text" class="input-field py-1 text-xs dlg-flag-input" data-lf="effect" value="' + escapeHtml(l.effect) + '" placeholder="nada" /></label>' +
        '  </div>' +
        optionsHtml +
        '</div>'
      );
    }

    function simMarkup(conv) {
      var allFlags = analyze(state).flags.map(function (f) { return f.name; });
      var initial = sim.initial;
      var run = simulate(conv, initial, sim.picks);
      var flagToggles = allFlags.length
        ? '<div class="dlg-sim-flags"><span class="quest-field-label">Flags no início:</span>' + allFlags.map(function (f) {
          return '<label class="dlg-sim-flag"><input type="checkbox" data-sim-flag="' + escapeHtml(f) + '"' + (initial[f] ? ' checked' : '') + ' />' + escapeHtml(f) + '</label>';
        }).join('') + '</div>'
        : '';
      var transcript = run.steps.map(function (st) {
        var l = st.line, sp = speakerById(l.speakerId);
        var exp = sp && sp.expressions.filter(function (e) { return e.id === l.expressionId; })[0];
        if (st.skipped) return '<div class="dlg-sim-skip">#' + (conv.lines.indexOf(l) + 1) + ' pulada — condição "' + escapeHtml(l.condition) + '" não vale</div>';
        var who = '<span class="dlg-sim-who" style="color:' + (sp ? sp.color : 'inherit') + '">' + escapeHtml(speakerName(sp)) + '</span>' +
          (exp ? '<span class="dlg-sim-exp" style="background-color:' + exp.color + '22;color:' + exp.color + '">' + escapeHtml(exp.name) + '</span>' : '');
        var body = l.text ? '<p>' + escapeHtml(l.text) + '</p>' : '';
        if (st.picked) body += '<p class="dlg-sim-picked">' + GDC.icon('chevron-right', { size: 12 }) + escapeHtml(st.picked.text || '(opção sem texto)') + '</p>';
        return '<div class="dlg-sim-bubble" style="border-left-color:' + (sp ? sp.color : 'rgb(var(--border-hover))') + '">' + who + body + '</div>';
      }).join('');
      var tail;
      if (run.pendingChoice) {
        var pc = run.pendingChoice, psp = speakerById(pc.speakerId);
        tail = '<div class="dlg-sim-bubble dlg-sim-choice" style="border-left-color:' + (psp ? psp.color : 'rgb(var(--border-hover))') + '">' +
          (pc.text ? '<p>' + escapeHtml(pc.text) + '</p>' : '') +
          '<div class="dlg-sim-picks">' + pc.options.map(function (o) {
            return '<button type="button" class="btn-ghost py-1 text-xs" data-da="sim-pick" data-id="' + escapeHtml(o.id) + '">' + escapeHtml(o.text || '(opção sem texto)') + '</button>';
          }).join('') + '</div></div>';
      } else {
        tail = '<div class="dlg-sim-end">' + (run.loop ? '⚠ A conversa entrou em loop (mais de 500 passos) — confira os saltos.' : 'Fim da conversa.') + '</div>';
      }
      var on = Object.keys(run.flags).filter(function (f) { return run.flags[f]; });
      return (
        '<div class="dlg-sim">' +
        '  <div class="dlg-sim-head"><span class="font-display text-xs font-bold text-primary">' + GDC.icon('play', { size: 12 }) + 'Simulação</span>' +
        '    <span class="wp-stage-spacer"></span>' +
        '    <button type="button" class="btn-ghost py-1 text-xs" data-da="sim-restart">' + GDC.icon('rotate-ccw', { size: 12 }) + 'Recomeçar</button>' +
        '    <button type="button" class="btn-ghost py-1 text-xs" data-da="sim-close">Fechar</button>' +
        '  </div>' + flagToggles +
        '  <div class="dlg-sim-transcript">' + (transcript || '') + tail + '</div>' +
        '  <p class="text-xs text-muted">Flags ligadas agora: ' + (on.length ? on.map(escapeHtml).join(', ') : 'nenhuma') + '</p>' +
        '</div>'
      );
    }

    function convMarkup(c) {
      var open = expandedConv === c.id;
      var speakersIn = {};
      c.lines.forEach(function (l) { if (l.speakerId) speakersIn[l.speakerId] = true; });
      var dots = Object.keys(speakersIn).map(function (sid) { var sp = speakerById(sid); return sp ? '<span class="dlg-dot" style="background-color:' + sp.color + '" title="' + escapeHtml(speakerName(sp)) + '"></span>' : ''; }).join('');
      var conds = c.lines.filter(function (l) { return l.condition.trim(); }).length;
      var head =
        '<button type="button" class="quest-card-head" data-da="toggle-conv">' +
        '  <span class="quest-card-icon" style="background-color:#06b6d420;color:#06b6d4">' + GDC.icon('message-square', { size: 14 }) + '</span>' +
        '  <span class="min-w-0 flex-1 text-left"><span class="quest-card-title">' + escapeHtml(c.title || '(sem título)') + '</span>' +
        (c.trigger ? '<span class="quest-card-giver">' + escapeHtml(c.trigger) + '</span>' : '') + '</span>' +
        '  <span class="dlg-dots">' + dots + '</span>' +
        (conds ? '<span class="quest-card-obj-count" title="Falas com condição">' + GDC.icon('lock', { size: 11 }) + conds + '</span>' : '') +
        '  <span class="quest-card-obj-count" title="Falas">' + GDC.icon('message-square', { size: 11 }) + c.lines.length + '</span>' +
        '</button>';
      if (!open) return '<div class="card-surface quest-card" data-conv="' + escapeHtml(c.id) + '">' + head + '</div>';
      var codexChips = c.codexIds.map(function (eid) {
        var e = entryById(eid); if (!e) return '';
        var t = typeById(e.typeId);
        return '<span class="quest-chip"><button type="button" class="quest-chip-link" data-da="goto-codex" data-id="' + escapeHtml(e.id) + '">' + (t ? GDC.icon(t.icon, { size: 10 }) : '') + escapeHtml(e.name || '(sem nome)') + '</button>' +
          '<button type="button" class="quest-chip-x" data-da="conv-codex-remove" data-id="' + escapeHtml(e.id) + '" title="Remover vínculo">' + GDC.icon('x', { size: 10 }) + '</button></span>';
      }).join('');
      var codexOpts = codexOptions(c.codexIds, null);
      return (
        '<div class="card-surface quest-card quest-card-expanded" data-conv="' + escapeHtml(c.id) + '">' + head +
        '  <div class="quest-card-body">' +
        '    <div class="quest-field-grid quest-field-grid-2">' +
        '      <div class="quest-field-row"><label class="quest-field-label">Título</label><input type="text" class="input-field py-1.5 text-xs" data-cf="title" value="' + escapeHtml(c.title) + '" placeholder="Ex.: POGO comenta o relógio digital" /></div>' +
        '      <div class="quest-field-row"><label class="quest-field-label">Quando acontece</label><input type="text" class="input-field py-1.5 text-xs" data-cf="trigger" value="' + escapeHtml(c.trigger) + '" placeholder="Ex.: ao expor um artefato Tier 2 no Museu" /></div>' +
        '    </div>' +
        '    <div class="quest-field-row"><label class="quest-field-label">Sobre (Codex)</label>' +
        (codex.types.length
          ? '<div class="quest-chips">' + (codexChips || '<span class="text-xs text-muted">Nenhuma entrada.</span>') + '</div>' +
            (codexOpts ? '<select class="input-field py-1 text-xs quest-add-select" data-cf-add="codex"><option value="">+ Vincular entrada do Codex...</option>' + codexOpts + '</select>' : '')
          : '<p class="text-xs text-muted">Crie entradas no Codex para vinculá-las aqui (artefato, local, personagem...).</p>') +
        '    </div>' +
        '    <div class="dlg-lines">' + (c.lines.length ? c.lines.map(function (l, i) { return lineMarkup(c, l, i); }).join('') : '<p class="quest-empty quest-empty-sm">Nenhuma fala ainda.</p>') + '</div>' +
        '    <div class="flex flex-wrap items-center gap-2">' +
        '      <button type="button" class="btn-ghost py-1 text-xs" data-da="line-add">' + GDC.icon('plus', { size: 12 }) + 'Fala</button>' +
        '      <button type="button" class="btn-ghost py-1 text-xs" data-da="choice-add">' + GDC.icon('list', { size: 12 }) + 'Escolha do jogador</button>' +
        '      <span class="wp-stage-spacer"></span>' +
        (c.lines.length ? '      <button type="button" class="btn-ghost py-1 text-xs" data-da="sim-open">' + GDC.icon('play', { size: 12 }) + 'Simular</button>' : '') +
        '    </div>' +
        (sim && sim.convId === c.id ? simMarkup(c) : '') +
        '    <div class="quest-card-actions">' +
        '      <button type="button" class="btn-ghost py-1.5 text-xs" data-da="toggle-conv">' + GDC.icon('chevron-down', { size: 13, className: 'rotate-180' }) + 'Fechar</button>' +
        '      <button type="button" class="btn-ghost py-1.5 text-xs" data-da="conv-dup">' + GDC.icon('copy', { size: 13 }) + 'Duplicar</button>' +
        '      <button type="button" class="btn-ghost py-1.5 text-xs text-rose-500" data-da="conv-remove">' + GDC.icon('trash-2', { size: 13 }) + 'Excluir</button>' +
        '    </div>' +
        '  </div>' +
        '</div>'
      );
    }

    function renderFlags() {
      var a = analyze(state);
      if (!a.flags.length && !a.issues.length) { flagsEl.innerHTML = ''; return; }
      var rows = a.flags.map(function (f) {
        var place = function (list) {
          var seen = {}, out = [];
          list.forEach(function (w) { var k = w.conv + ' #' + w.n; if (!seen[k]) { seen[k] = true; out.push('<button type="button" class="quest-chip-link" data-da="open-conv" data-id="' + escapeHtml(w.convId) + '">' + escapeHtml(k) + '</button>'); } });
          return out.length ? out.join(', ') : '<span class="text-muted">—</span>';
        };
        var warn = f.reads.some(function (r) { return !r.neg; }) && !f.writes.length;
        var unused = f.writes.length && !f.reads.length;
        return '<div class="combat-table-row dlg-flag-row"><span class="dlg-flag-name' + (warn ? ' dlg-flag-warn' : '') + '">' + escapeHtml(f.name) + '</span>' +
          '<span>' + place(f.writes) + '</span><span>' + place(f.reads) + (unused ? ' <span class="text-muted">(não usada)</span>' : '') + '</span></div>';
      }).join('');
      var issues = a.issues.length
        ? '<div class="dlg-issues">' + a.issues.map(function (it) {
          return '<p>' + GDC.icon('alert-circle', { size: 12 }) + escapeHtml(it.text) + ' — <button type="button" class="quest-chip-link" data-da="open-conv" data-id="' + escapeHtml(it.where.convId) + '">' + escapeHtml(it.where.conv + ' #' + it.where.n) + '</button></p>';
        }).join('') + '</div>'
        : '';
      flagsEl.innerHTML =
        '<div class="rounded-xl border border-default p-4 space-y-2">' +
        '  <h4 class="text-xs font-bold text-secondary">Flags do roteiro</h4>' + issues +
        (rows ? '<div class="combat-table"><div class="combat-table-head dlg-flag-row"><span>Flag</span><span>Definida em</span><span>Exigida em</span></div>' + rows + '</div>' : '') +
        '</div>';
    }

    function renderConvs() {
      var focus = null, a = document.activeElement;
      if (a && container.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) {
        var attr = ['data-lf', 'data-of', 'data-cf', 'data-sf'].filter(function (x) { return a.hasAttribute(x); })[0];
        if (attr) {
          var holder = a.closest('[data-opt]') || a.closest('[data-exp]') || a.closest('[data-line]') || a.closest('[data-speaker]') || a.closest('[data-conv]');
          var hAttr = holder && ['data-opt', 'data-exp', 'data-line', 'data-speaker', 'data-conv'].filter(function (x) { return holder.hasAttribute(x); })[0];
          focus = { attr: attr, val: a.getAttribute(attr), hAttr: hAttr, hVal: holder && holder.getAttribute(hAttr) };
        }
      }
      countEl.innerHTML = state.conversations.length ? GDC.icon('message-square', { size: 12 }) + ' ' + state.conversations.length + ' conversa' + (state.conversations.length === 1 ? '' : 's') : '';
      convsEl.innerHTML = state.conversations.length
        ? '<div class="quest-list">' + state.conversations.map(convMarkup).join('') + '</div>'
        : '<p class="quest-empty">Nenhuma conversa ainda. Cadastre quem fala em "Personagem" e depois crie uma conversa.</p>';
      renderFlags();
      if (focus) {
        var scope = focus.hAttr ? container.querySelector('[' + focus.hAttr + '="' + focus.hVal + '"]') : container;
        var el = scope && scope.querySelector('[' + focus.attr + '="' + focus.val + '"]');
        if (el) el.focus();
      }
    }

    function renderAll() { renderSpeakers(); renderConvs(); }

    // ---------- Eventos ----------

    function ctx(el) {
      var convEl = el.closest('[data-conv]'), lineEl = el.closest('[data-line]'), optEl = el.closest('[data-opt]');
      var conv = convEl && convById(convEl.getAttribute('data-conv'));
      var line = conv && lineEl && conv.lines.filter(function (l) { return l.id === lineEl.getAttribute('data-line'); })[0];
      var opt = line && optEl && line.options.filter(function (o) { return o.id === optEl.getAttribute('data-opt'); })[0];
      var spEl = el.closest('[data-speaker]');
      var sp = spEl && speakerById(spEl.getAttribute('data-speaker'));
      var expEl = el.closest('[data-exp]');
      var exp = sp && expEl && sp.expressions.filter(function (x) { return x.id === expEl.getAttribute('data-exp'); })[0];
      return { conv: conv, line: line, opt: opt, sp: sp, exp: exp };
    }

    function newLine(kind, conv) {
      var last = conv.lines[conv.lines.length - 1];
      return { id: id('ln'), kind: kind, speakerId: last ? last.speakerId : (state.speakers[0] ? state.speakers[0].id : null), expressionId: null, text: '', condition: '', effect: '',
        options: kind === 'choice' ? [{ id: id('op'), text: '', effect: '', goto: '' }, { id: id('op'), text: '', effect: '', goto: '' }] : [] };
    }

    container.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-da]');
      if (!btn || !container.contains(btn) || btn.disabled) return;
      var a = btn.getAttribute('data-da'), bid = btn.getAttribute('data-id');
      var c = ctx(btn);
      if (a === 'add-speaker') {
        var n = state.speakers.length;
        var sp = { id: id('spk'), name: '', codexId: null, color: SPEAKER_COLORS[n % SPEAKER_COLORS.length], expressions: [{ id: id('exp'), name: 'Neutro', color: SPEAKER_COLORS[n % SPEAKER_COLORS.length] }] };
        sp.name = 'Personagem ' + (n + 1);
        state.speakers.push(sp); editingSpeaker = sp.id;
        persist(); renderAll();
        var ni = speakersEl.querySelector('[data-sf="name"]'); if (ni) { ni.focus(); ni.select(); }
        return;
      }
      if (a === 'edit-speaker') { editingSpeaker = editingSpeaker === bid ? null : bid; renderSpeakers(); return; }
      if (a === 'speaker-remove' && c.sp) {
        var uses = 0;
        state.conversations.forEach(function (cv) { cv.lines.forEach(function (l) { if (l.speakerId === c.sp.id) uses++; }); });
        if (!global.confirm('Excluir "' + speakerName(c.sp) + '"?' + (uses ? ' As ' + uses + ' falas dele viram narração.' : ''))) return;
        state.conversations.forEach(function (cv) { cv.lines.forEach(function (l) { if (l.speakerId === c.sp.id) { l.speakerId = null; l.expressionId = null; } }); });
        state.speakers = state.speakers.filter(function (s) { return s !== c.sp; });
        editingSpeaker = null; persist(); renderAll(); return;
      }
      if (a === 'exp-add' && c.sp) { c.sp.expressions.push({ id: id('exp'), name: 'Nova', color: SPEAKER_COLORS[c.sp.expressions.length % SPEAKER_COLORS.length] }); persist(); renderAll(); return; }
      if (a === 'exp-remove' && c.sp && c.exp) {
        c.sp.expressions = c.sp.expressions.filter(function (x) { return x !== c.exp; });
        state.conversations.forEach(function (cv) { cv.lines.forEach(function (l) { if (l.expressionId === c.exp.id) l.expressionId = null; }); });
        persist(); renderAll(); return;
      }
      if (a === 'goto-codex') { if (onGotoCodexEntry && bid) onGotoCodexEntry(bid); return; }
      if (a === 'add-conv') {
        var cv = { id: id('conv'), title: '', trigger: '', codexIds: [], lines: [] };
        cv.lines.push(newLine('line', cv));
        state.conversations.push(cv); expandedConv = cv.id; sim = null;
        persist(); renderConvs();
        var ti = convsEl.querySelector('[data-conv="' + cv.id + '"] [data-cf="title"]'); if (ti) ti.focus();
        return;
      }
      if (a === 'open-conv') {
        expandedConv = bid; renderConvs();
        var ce = convsEl.querySelector('[data-conv="' + bid + '"]'); if (ce) ce.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      if (!c.conv) return;
      var conv = c.conv;
      if (a === 'toggle-conv') { expandedConv = expandedConv === conv.id ? null : conv.id; if (sim && sim.convId !== expandedConv) sim = null; renderConvs(); return; }
      if (a === 'conv-remove') {
        if (!global.confirm('Excluir a conversa "' + (conv.title || '(sem título)') + '"?')) return;
        state.conversations = state.conversations.filter(function (x) { return x !== conv; });
        expandedConv = null; sim = null; persist(); renderConvs(); return;
      }
      if (a === 'conv-dup') {
        var map = {};
        var copy = JSON.parse(JSON.stringify(conv));
        copy.id = id('conv'); copy.title = (conv.title || 'Conversa') + ' (cópia)';
        copy.lines.forEach(function (l) { var nid = id('ln'); map[l.id] = nid; l.id = nid; l.options.forEach(function (o) { o.id = id('op'); }); });
        copy.lines.forEach(function (l) { l.options.forEach(function (o) { if (map[o.goto]) o.goto = map[o.goto]; }); });
        state.conversations.splice(state.conversations.indexOf(conv) + 1, 0, copy);
        expandedConv = copy.id; sim = null; persist(); renderConvs(); return;
      }
      if (a === 'conv-codex-remove') { conv.codexIds = conv.codexIds.filter(function (x) { return x !== bid; }); persist(); renderConvs(); return; }
      if (a === 'line-add' || a === 'choice-add') {
        var nl = newLine(a === 'choice-add' ? 'choice' : 'line', conv);
        conv.lines.push(nl); persist(); renderConvs();
        var ta = convsEl.querySelector('[data-line="' + nl.id + '"] ' + (a === 'choice-add' ? '[data-of="text"]' : '[data-lf="text"]')); if (ta) ta.focus();
        return;
      }
      if (a === 'sim-open') { sim = { convId: conv.id, initial: {}, picks: [] }; renderConvs(); return; }
      if (a === 'sim-close') { sim = null; renderConvs(); return; }
      if (a === 'sim-restart' && sim) { sim.picks = []; renderConvs(); return; }
      if (a === 'sim-pick' && sim) { sim.picks.push(bid); renderConvs(); return; }
      if (!c.line) return;
      var idx = conv.lines.indexOf(c.line);
      if (a === 'line-up' || a === 'line-down') {
        var j = idx + (a === 'line-up' ? -1 : 1);
        if (j < 0 || j >= conv.lines.length) return;
        conv.lines[idx] = conv.lines[j]; conv.lines[j] = c.line;
        persist(); renderConvs(); return;
      }
      if (a === 'line-remove') {
        conv.lines.splice(idx, 1);
        // saltos que apontavam pra ela continuam guardados e aparecem como "⚠ fala removida" + aviso
        persist(); renderConvs(); return;
      }
      if (a === 'opt-add') { c.line.options.push({ id: id('op'), text: '', effect: '', goto: '' }); persist(); renderConvs(); return; }
      if (a === 'opt-remove' && c.opt) { c.line.options = c.line.options.filter(function (o) { return o !== c.opt; }); persist(); renderConvs(); return; }
    });

    // Texto: salva por tecla sem re-render. Campos que mudam o resto da tela (flags, título) re-renderizam
    // no "change" (ao sair do campo), adiado pro foco já estar no próximo campo.
    container.addEventListener('input', function (e) {
      var t = e.target;
      if (t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'color') return;
      var c = ctx(t);
      var lf = t.getAttribute('data-lf'), of = t.getAttribute('data-of'), cf = t.getAttribute('data-cf'), sf = t.getAttribute('data-sf');
      if (lf && c.line) c.line[lf] = t.value;
      else if (of && c.opt) c.opt[of] = t.value;
      else if (cf && c.conv) c.conv[cf] = t.value;
      else if (sf === 'name' && c.sp) c.sp.name = t.value;
      else if (sf === 'exp-name' && c.exp) c.exp.name = t.value;
      else return;
      persist();
    });

    container.addEventListener('change', function (e) {
      var t = e.target;
      var c = ctx(t);
      if (t.hasAttribute('data-sim-flag') && sim) { sim.initial[t.getAttribute('data-sim-flag')] = t.checked; sim.picks = []; renderConvs(); return; }
      if (t.tagName === 'SELECT') {
        var lf = t.getAttribute('data-lf'), of = t.getAttribute('data-of'), sf = t.getAttribute('data-sf');
        if (t.getAttribute('data-cf-add') === 'codex' && c.conv && t.value) { if (c.conv.codexIds.indexOf(t.value) === -1) c.conv.codexIds.push(t.value); persist(); renderConvs(); return; }
        if (lf && c.line) {
          c.line[lf] = t.value || null;
          if (lf === 'speakerId') c.line.expressionId = null;
          persist(); renderConvs(); return;
        }
        if (of && c.opt) { c.opt[of] = t.value; persist(); renderConvs(); return; }
        if (sf === 'codexId' && c.sp) { c.sp.codexId = t.value || null; persist(); renderAll(); return; }
        return;
      }
      if (t.type === 'color') {
        var sf2 = t.getAttribute('data-sf');
        if (sf2 === 'color' && c.sp) c.sp.color = t.value;
        else if (sf2 === 'exp-color' && c.exp) c.exp.color = t.value;
        else return;
        persist(); renderAll(); return;
      }
      var attr = t.getAttribute('data-lf') || t.getAttribute('data-of') || t.getAttribute('data-cf') || t.getAttribute('data-sf');
      if (!attr) return;
      // nomes (título, personagem, expressão) e flags aparecem em outros lugares da tela
      setTimeout(function () {
        if (t.hasAttribute('data-sf')) renderAll(); else renderConvs();
      }, 0);
    });

    renderAll();
  }

  GDC.ui.dialogues = { render: render, parseStored: parseStored, analyze: analyze, simulate: simulate, conditionHolds: conditionHolds, parseTerms: parseTerms };
}(window));
