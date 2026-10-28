/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // ---------------------------------------------------------------------------------------------
  // Importação de Markdown (.md) com prévia — distribui um documento longo (ex.: o GDD consolidado
  // de um jogo) entre GDD, Codex e Notas.
  //
  // 1. parse(): quebra o texto em títulos (#…######, ignorando os de dentro de blocos de código).
  // 2. buildBlocks(parsed, nível): cada título do nível escolhido vira um BLOCO (com tudo abaixo dele,
  //    inclusive subtítulos mais fundos); o título de nível menor mais próximo acima é o GRUPO. Texto
  //    entre um título de grupo e seu primeiro bloco vira um bloco "introdução" (ou o bloco inteiro do
  //    grupo, se ele não tiver filhos no nível escolhido).
  // 3. suggest(): destino padrão por bloco — seção do GDD com o mesmo nome; tipo do Codex cujo nome
  //    bate com o grupo (ou um TIPO NOVO com o nome do grupo, quando o grupo soa como coleção:
  //    Personagens, Bestiário, Locais...); senão, uma Nota. Tudo ajustável na prévia.
  // 4. applyPlan(doc, plano): muta o documento (só acrescenta: nunca apaga nem sobrescreve texto). O
  //    app tira um instantâneo antes e oferece "Desfazer".
  // ---------------------------------------------------------------------------------------------

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** Minúsculas, sem acento, sem numeração inicial ("6.1 ", "1. "), só letras/números/espaço. */
  function norm(s) {
    return cleanTitle(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /** Título sem numeração ("6.1 Elara" → "Elara"), sem marcação de ênfase e sem espaços sobrando. */
  function cleanTitle(s) {
    return String(s || '').replace(/[*_`]/g, '').replace(/^\s*(\d+(\.\d+)*)\.?\s+/, '').trim();
  }

  /** Converte "PERSONAGENS" / "personagens" em "Personagens"; mantém títulos já em caixa mista. */
  function niceCase(s) {
    var t = cleanTitle(s);
    if (t && t === t.toUpperCase() && /[A-ZÀ-Ý]/.test(t)) {
      return t.toLowerCase().replace(/(^|[\s(\-–/])(\p{L})/gu, function (m, a, b) { return a + b.toUpperCase(); })
        .replace(/\b(De|Da|Do|Das|Dos|E|O|A|Os|As|Em|No|Na|Para|Por|Com)\b/g, function (w) { return w.toLowerCase(); })
        .replace(/^(\p{L})/u, function (m) { return m.toUpperCase(); });
    }
    return t;
  }

  // ---------- 1. Parse ----------

  function parse(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var headings = [];
    var inFence = false;
    lines.forEach(function (line, i) {
      if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; return; }
      if (inFence) return;
      var m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i });
    });
    return { lines: lines, headings: headings };
  }

  function levelCounts(parsed) {
    var c = {};
    parsed.headings.forEach(function (h) { c[h.level] = (c[h.level] || 0) + 1; });
    return c;
  }

  /** Nível de divisão padrão: o mais raso com 5–150 títulos; se o nível logo abaixo também cabe e
   *  não multiplica demais os blocos (≤ 3×), desce um — documentos de lore costumam ter capítulos em
   *  "#" e as fichas (personagem, local...) em "##", e são as fichas que interessam ao Codex. */
  function defaultLevel(parsed) {
    var c = levelCounts(parsed);
    var levels = Object.keys(c).map(Number).sort();
    var ok = function (lv) { return c[lv] >= 5 && c[lv] <= 150; };
    for (var i = 0; i < levels.length; i++) {
      var lv = levels[i];
      if (!ok(lv)) continue;
      return (ok(lv + 1) && c[lv + 1] <= 3 * c[lv]) ? lv + 1 : lv;
    }
    return levels.length ? levels[Math.min(1, levels.length - 1)] : 1;
  }

  /** Remove linhas em branco e separadores "---" das pontas. */
  function trimBody(lines) {
    var a = 0, b = lines.length;
    var blank = function (l) { return !l.trim() || /^\s*([-*_]\s*){3,}$/.test(l); };
    while (a < b && blank(lines[a])) a++;
    while (b > a && blank(lines[b - 1])) b--;
    return lines.slice(a, b).join('\n');
  }

  // ---------- 2. Blocos ----------

  function buildBlocks(parsed, level) {
    var H = parsed.headings, L = parsed.lines;
    var blocks = [];
    var groupStack = []; // títulos de nível < level
    var seq = 0;
    function groupOf() {
      var g = groupStack[groupStack.length - 1];
      return g ? { key: 'g' + g.line, title: niceCase(g.text) } : { key: 'g-root', title: '' };
    }
    function endOf(idx, maxLevel) {
      for (var j = idx + 1; j < H.length; j++) if (H[j].level <= maxLevel) return H[j].line;
      return L.length;
    }
    // Texto antes do primeiro título.
    var firstLine = H.length ? H[0].line : L.length;
    var pre = trimBody(L.slice(0, firstLine));
    if (pre) blocks.push({ id: 'b' + (seq++), title: 'Texto inicial', heading: '', groupKey: 'g-root', groupTitle: '', body: pre, intro: true });

    H.forEach(function (h, idx) {
      if (h.level < level) {
        while (groupStack.length && groupStack[groupStack.length - 1].level >= h.level) groupStack.pop();
        groupStack.push(h);
        // Introdução: do título do grupo até o próximo título de nível <= level.
        var stop = endOf(idx, level);
        var hasChildAtLevel = false;
        for (var j = idx + 1; j < H.length && H[j].level > h.level; j++) { if (H[j].level === level) { hasChildAtLevel = true; break; } }
        var body = trimBody(L.slice(h.line + 1, hasChildAtLevel ? stop : endOf(idx, h.level)));
        if (body) {
          var g = groupOf();
          // `self`: o bloco É o próprio grupo (capítulo sem subdivisões no nível escolhido) — o nome
          // do grupo não diz nada sobre ele ser item de uma coleção.
          blocks.push({
            id: 'b' + (seq++), heading: h.text, groupKey: g.key, groupTitle: g.title, body: body,
            title: hasChildAtLevel ? niceCase(h.text) + ' (introdução)' : niceCase(h.text), intro: hasChildAtLevel, self: !hasChildAtLevel,
          });
        }
        return;
      }
      if (h.level > level) return; // já incluído no corpo do bloco acima
      var g2 = groupOf();
      blocks.push({
        id: 'b' + (seq++), heading: h.text, title: niceCase(h.text), groupKey: g2.key, groupTitle: g2.title,
        body: trimBody(L.slice(h.line + 1, endOf(idx, level))), intro: false,
      });
    });
    return blocks;
  }

  // ---------- Tabelas de ficha técnica ----------

  /** UMA tabela de exatamente 2 colunas vira linhas de "Ficha técnica" ({label, value}): a que tem
   *  cabeçalho de ficha ("Campo", "Atributo"...), ou a primeira de 2 colunas. O resto do texto (sem
   *  ela) volta como `rest`; as demais tabelas ficam no texto (renderizadas no modo leitura) — juntar
   *  várias numa ficha só misturaria contextos (ex.: "Expressão | Cor" do POGO não é ficha técnica). */
  function extractStats(md) {
    var lines = md.split('\n');
    var cells = function (l) { return l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); };
    var tables = [];
    for (var i = 0; i < lines.length; i++) {
      if (/^\s*\|/.test(lines[i]) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1]) && cells(lines[i]).length === 2) {
        var j = i + 2, rows = [];
        while (j < lines.length && /^\s*\|/.test(lines[j])) { rows.push(cells(lines[j])); j++; }
        if (rows.length && rows.every(function (r) { return r.length === 2; })) {
          tables.push({ start: i, end: j, header: cells(lines[i])[0].replace(/\*\*/g, ''), rows: rows });
        }
        i = j - 1;
      }
    }
    if (!tables.length) return { stats: [], rest: md };
    var pick = tables.filter(function (t) { return /^(campo|atributo|propriedade|caracter|dado|informa)/i.test(t.header); })[0] || tables[0];
    var stats = [];
    pick.rows.forEach(function (r) {
      var lab = r[0].replace(/\*\*/g, '').trim(), val = r[1].replace(/\*\*/g, '').trim();
      if (lab || val) stats.push({ label: lab, value: val });
    });
    return { stats: stats, rest: trimBody(lines.slice(0, pick.start).concat(lines.slice(pick.end))) };
  }

  /** Rebaixa os títulos de um trecho pra que o mais alto fique em `minLevel` (sem passar de ######). */
  function shiftHeadings(md, minLevel) {
    var lines = md.split('\n'), inFence = false, top = 7;
    lines.forEach(function (l) {
      if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return; }
      var m = !inFence && /^(#{1,6})\s/.exec(l);
      if (m) top = Math.min(top, m[1].length);
    });
    if (top === 7 || top >= minLevel) return md;
    var delta = minLevel - top;
    inFence = false;
    return lines.map(function (l) {
      if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return l; }
      if (inFence) return l;
      return l.replace(/^(#{1,6})(\s)/, function (m, h, sp) { return new Array(Math.min(6, h.length + delta) + 1).join('#') + sp; });
    }).join('\n');
  }

  /** Singular simples de uma palavra em português (só pra nomear tipo novo: "Personagens" → "Personagem"). */
  function singular(name) {
    if (/\s/.test(name)) return name;
    return name.replace(/ões$/, 'ão').replace(/ães$/, 'ão').replace(/ens$/, 'em').replace(/ais$/, 'al')
      .replace(/eis$/, 'el').replace(/([rsz])es$/, '$1').replace(/([^s])s$/, '$1');
  }

  // ---------- 3. Sugestões ----------

  // Grupo que soa como COLEÇÃO (cada filho é um item do Codex). Só no começo do título do grupo:
  // "Direção de Arte e Guia Tecnológico" não é uma coleção de tecnologias.
  var COLLECTION_RE = /^(personage|npcs?\b|elenco|bestiar|criatura|monstro|inimigo|locais|lugares|locaco|setores|zonas|regioes|planetas|mundos|equipament|ferramenta|itens|armas|naves|veiculos|faccoes|grupos|organizaco|tecnologias|artefatos|especies|reliquias)/;
  var TOC_RE = /^(sumario|indice|conteudo|table of contents|contents)$/;
  // Pistas por id das seções PADRÃO do GDD (as personalizadas casam só pelo nome).
  var SECTION_HINTS = {
    concept: /^(visao geral|conceito|pitch|premissa)/,
    gameplay: /^(jogabilidade|gameplay|loop)/,
    mechanics: /^(sistemas? de jogo|mecanicas?)\b/,
    controls: /^controles?\b/,
    progression: /^progressao/,
    world: /^(mundo|ambientacao|cenario)/,
    characters: /^personagens\b/,
    enemies: /^(bestiario|inimigos|criaturas|monstros)/,
    ui: /^(interface|hud|ui\b)/,
    art: /^(direcao de arte|arte\b|estilo visual)/,
    audio: /^(audio|som\b|trilha)/,
    references: /^(referencias|inspiracoes)/,
  };

  function typeMatchesGroup(type, groupNorm) {
    var tn = norm(type.name);
    if (!tn || !groupNorm) return false;
    var stem = tn.slice(0, Math.max(5, Math.min(tn.length, 7)));
    return groupNorm.indexOf(stem) === 0 || tn.indexOf(groupNorm.slice(0, 6)) === 0;
  }

  /** Seção do GDD para um título normalizado: nome igual, título começando pelo nome (≥ 6 letras),
   *  ou pista do id padrão. */
  function sectionFor(sections, n) {
    if (!n) return null;
    var hit = sections.filter(function (s) { return norm(s.label) === n; })[0] ||
      sections.filter(function (s) { var l = norm(s.label); return l.length >= 6 && n.indexOf(l) === 0; })[0] ||
      sections.filter(function (s) { return SECTION_HINTS[s.id] && SECTION_HINTS[s.id].test(n); })[0];
    return hit || null;
  }

  function suggest(doc, blocks) {
    var sections = GDC.sectionsFor(doc);
    var types = (doc.codex && doc.codex.types) || [];
    var entries = (doc.codex && doc.codex.entries) || [];
    return blocks.map(function (b) {
      var tn = norm(b.title.replace(/\(introdução\)$/, '')), gn = norm(b.groupTitle);
      if (TOC_RE.test(tn)) return 'skip';
      var sec = sectionFor(sections, tn);
      if (sec) return 'gdd:' + sec.id;
      if (!b.intro && !b.self && gn) {
        var t = types.filter(function (ty) { return typeMatchesGroup(ty, gn); })[0];
        if (t) {
          var dup = entries.some(function (e) { return e.typeId === t.id && norm(e.name) === norm(b.title); });
          return dup ? 'skip' : 'codex:' + t.id;
        }
        if (COLLECTION_RE.test(gn)) return 'codexnew:' + b.groupKey;
        var gsec = sectionFor(sections, gn);
        if (gsec) return 'gdd:' + gsec.id;
      }
      return b.body ? 'note' : 'skip';
    });
  }

  // ---------- 4. Aplicar ----------

  var NEW_TYPE_COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#14b8a6', '#f43f5e'];
  var IMPORT_GROUP_LABEL = 'Importado do .md';

  function iconForType(n) {
    if (/personag|npc/.test(n)) return 'user';
    if (/local|setor|zona|regi|planeta|mundo/.test(n)) return 'map';
    if (/nave|veicul/.test(n)) return 'rocket';
    if (/equipament|ferrament|item|arma|tecnolog/.test(n)) return 'wrench';
    if (/bestiar|criatur|monstr|inimig|especie/.test(n)) return 'target';
    return 'book-open';
  }

  /** `plan` = [{ block, dest }] (dest como nos selects: skip | note | gdd:<id> | gddnew | codex:<typeId> |
   *  codexnew:<groupKey>). Muta `doc` e devolve um resumo { gdd, gddNew, codex, types, notes }. */
  function applyPlan(doc, plan) {
    var r = { gdd: 0, gddNew: 0, codex: 0, types: 0, notes: 0 };
    var now = Date.now();
    var newTypes = {}; // groupKey -> type
    var layout = null;
    var codex = doc.codex;
    var addedTypes = [], addedEntries = [], addedNotes = [];

    plan.forEach(function (p) {
      var b = p.block, dest = p.dest || 'skip';
      if (dest === 'skip') return;
      if (dest === 'note') {
        addedNotes.push(GDC.normalizeNote({ id: GDC.makeId('note'), title: b.title, body: b.body, createdAt: now, updatedAt: now }));
        r.notes++; return;
      }
      if (dest.indexOf('gdd:') === 0) {
        var sid = dest.slice(4);
        var meta = GDC.sectionMapFor(doc)[sid];
        if (!meta) return;
        var cur = (doc.sections[sid] || '').trim();
        var sameName = norm(meta.label) === norm(b.title);
        var piece = sameName ? shiftHeadings(b.body, 3) : '### ' + b.title + '\n\n' + shiftHeadings(b.body, 4);
        doc.sections[sid] = cur ? cur + '\n\n' + piece : piece;
        r.gdd++; return;
      }
      if (dest === 'gddnew') {
        if (!layout) layout = GDC.cloneGddLayout(doc);
        var grp = layout.groups.filter(function (g) { return g.label === IMPORT_GROUP_LABEL; })[0];
        if (!grp) { grp = { id: GDC.makeId('grp'), label: IMPORT_GROUP_LABEL, sections: [] }; layout.groups.push(grp); }
        var nid = GDC.makeId('sec');
        var total = layout.groups.reduce(function (n, g) { return n + g.sections.length; }, 0);
        grp.sections.push({ id: nid, label: b.title, placeholder: '', minChars: GDC.GDD_CUSTOM_MIN_CHARS, color: GDC.GDD_SECTION_COLORS[total % GDC.GDD_SECTION_COLORS.length] });
        doc.sections[nid] = b.body;
        r.gddNew++; return;
      }
      var type = null;
      if (dest.indexOf('codexnew:') === 0) {
        var key = dest.slice(9);
        type = newTypes[key];
        if (!type) {
          var name = singular(niceCase(b.groupTitle)) || 'Importado';
          type = {
            id: GDC.makeId('type'), name: name, icon: iconForType(norm(name)),
            color: NEW_TYPE_COLORS[(codex.types.length + addedTypes.length) % NEW_TYPE_COLORS.length], gddSectionId: null,
            fields: [
              GDC.codexField('Status', 'select', { options: ['Canônico', 'Proposta', 'A definir'] }),
              GDC.codexField('Ficha técnica', 'stats'),
            ],
          };
          newTypes[key] = type; addedTypes.push(type); r.types++;
        }
      } else if (dest.indexOf('codex:') === 0) {
        var tid = dest.slice(6);
        type = codex.types.filter(function (t) { return t.id === tid; })[0];
      }
      if (!type) return;
      var fields = {};
      type.fields.forEach(function (f) { fields[f.id] = GDC.defaultCodexFieldValue(f.kind); });
      var statsField = type.fields.filter(function (f) { return f.kind === 'stats'; })[0];
      var summary = b.body;
      if (statsField) {
        var ex = extractStats(b.body);
        if (ex.stats.length) {
          fields[statsField.id] = ex.stats.map(function (s) { return { id: GDC.makeId('stat'), label: s.label, value: s.value }; });
          summary = ex.rest;
        }
      }
      // Marcador de proposta no texto (convenção comum: "🟡 Proposta") vira o status, quando existe a opção.
      var statusField = type.fields.filter(function (f) { return f.kind === 'select' && /status/i.test(f.label); })[0];
      if (statusField && /proposta/i.test(b.body) && /🟡/.test(b.body) && statusField.options.indexOf('Proposta') !== -1) fields[statusField.id] = 'Proposta';
      addedEntries.push({ id: GDC.makeId('entry'), typeId: type.id, name: b.title, summary: summary, fields: fields, createdAt: now, updatedAt: now });
      r.codex++;
    });

    // Mesmos objetos (codex/notes) — os módulos guardam referência a doc.codex.
    if (addedTypes.length) codex.types = codex.types.concat(addedTypes);
    if (addedEntries.length) codex.entries = codex.entries.concat(addedEntries);
    if (addedNotes.length) doc.notes = doc.notes.concat(addedNotes);
    if (layout) doc.gddLayout = GDC.normalizeGddLayout(layout);
    return r;
  }

  // ---------- Tela de prévia ----------

  var overlayEl = null;

  function excerpt(md) {
    var plain = md.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`|]/g, ' ').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\s+/g, ' ').trim();
    return plain.length > 140 ? plain.slice(0, 137) + '…' : plain;
  }

  function close() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape' && overlayEl) { e.preventDefault(); e.stopPropagation(); close(); } }

  /** opts: { doc, fileName, text, onApply(plan) } */
  function open(opts) {
    close();
    var doc = opts.doc;
    var parsed = parse(opts.text);
    if (!parsed.headings.length && !opts.text.trim()) return false;
    var counts = levelCounts(parsed);
    var level = defaultLevel(parsed);
    var blocks = [], dests = {};

    function rebuild() {
      blocks = buildBlocks(parsed, level);
      var sug = suggest(doc, blocks);
      dests = {};
      blocks.forEach(function (b, i) { dests[b.id] = sug[i]; });
    }
    rebuild();

    overlayEl = document.createElement('div');
    overlayEl.className = 'kanban-modal-overlay md-import-overlay';
    overlayEl.innerHTML =
      '<div class="kanban-modal-panel md-import-panel card-surface" role="dialog" aria-modal="true" aria-label="Importar Markdown">' +
      '  <div class="kanban-modal-header">' +
      '    <div class="min-w-0">' +
      '      <h3 class="font-display text-base font-bold text-primary">Importar ' + escapeHtml(opts.fileName || 'Markdown') + '</h3>' +
      '      <p class="text-xs text-muted">Escolha para onde vai cada bloco. Nada é apagado — só acrescentado, e dá pra desfazer logo depois.</p>' +
      '    </div>' +
      '    <button type="button" class="kanban-icon-btn" data-mi="close" title="Fechar">' + GDC.icon('x', { size: 16 }) + '</button>' +
      '  </div>' +
      '  <div class="md-import-bar"></div>' +
      '  <div class="kanban-modal-body md-import-body"></div>' +
      '  <div class="kanban-modal-footer">' +
      '    <span class="md-import-summary"></span>' +
      '    <button type="button" class="btn-ghost py-2 text-xs" data-mi="close">Cancelar</button>' +
      '    <button type="button" class="btn-primary py-2 text-xs" data-mi="apply">' + GDC.icon('upload', { size: 13 }) + 'Importar</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(overlayEl);
    document.addEventListener('keydown', onKey, true);

    var barEl = overlayEl.querySelector('.md-import-bar');
    var bodyEl = overlayEl.querySelector('.md-import-body');
    var sumEl = overlayEl.querySelector('.md-import-summary');

    function destOptions(b, current) {
      var o = function (v, l) { return '<option value="' + escapeHtml(v) + '"' + (v === current ? ' selected' : '') + '>' + escapeHtml(l) + '</option>'; };
      var html = o('skip', 'Ignorar') + o('note', 'Nota');
      html += '<optgroup label="GDD">' + o('gddnew', 'Nova seção no GDD') + GDC.sectionsFor(doc).map(function (s) { return o('gdd:' + s.id, 'Acrescentar em: ' + s.label); }).join('') + '</optgroup>';
      html += '<optgroup label="Codex">' + (doc.codex.types || []).map(function (t) { return o('codex:' + t.id, 'Entrada em: ' + t.name); }).join('') +
        (b.groupTitle ? o('codexnew:' + b.groupKey, 'Novo tipo: ' + singular(niceCase(b.groupTitle))) : '') + '</optgroup>';
      return html;
    }

    function dupWarning(b) {
      var d = dests[b.id] || '';
      if (d.indexOf('codex:') !== 0) return '';
      var tid = d.slice(6);
      var dup = doc.codex.entries.some(function (e) { return e.typeId === tid && norm(e.name) === norm(b.title); });
      return dup ? '<span class="md-import-warn">' + GDC.icon('alert-circle', { size: 11 }) + 'Já existe uma entrada com esse nome</span>' : '';
    }

    function renderBar() {
      var levels = Object.keys(counts).map(Number).sort();
      barEl.innerHTML =
        '<label class="codex-filter-item"><span class="codex-filter-label">Dividir por</span><select class="input-field py-1 text-xs" data-mi-level>' +
        levels.map(function (lv) {
          return '<option value="' + lv + '"' + (lv === level ? ' selected' : '') + '>' + new Array(lv + 1).join('#') + ' título de nível ' + lv + ' (' + counts[lv] + ')</option>';
        }).join('') + '</select></label>' +
        '<span class="text-xs text-muted">' + blocks.length + ' blocos</span>';
    }

    function renderSummary() {
      var c = { gdd: 0, codex: 0, note: 0, skip: 0 };
      blocks.forEach(function (b) {
        var d = dests[b.id] || 'skip';
        if (d === 'skip') c.skip++; else if (d === 'note') c.note++; else if (d.indexOf('gdd') === 0) c.gdd++; else c.codex++;
      });
      sumEl.textContent = c.gdd + ' no GDD · ' + c.codex + ' no Codex · ' + c.note + ' notas · ' + c.skip + ' ignorados';
    }

    function renderBody() {
      var groups = [], byKey = {};
      blocks.forEach(function (b) {
        if (!byKey[b.groupKey]) { byKey[b.groupKey] = { key: b.groupKey, title: b.groupTitle, list: [] }; groups.push(byKey[b.groupKey]); }
        byKey[b.groupKey].list.push(b);
      });
      bodyEl.innerHTML = groups.map(function (g) {
        var applyAll = g.list.length > 1
          ? '<select class="input-field py-1 text-xs" data-mi-group="' + escapeHtml(g.key) + '"><option value="">Aplicar a todos…</option>' + destOptions(g.list[0], null) + '</select>'
          : '';
        return (
          '<div class="md-import-group">' +
          // Capítulo com um bloco só (o próprio capítulo): o cabeçalho do grupo só repetiria o título.
          ((g.title || applyAll) && !(g.list.length === 1 && g.list[0].self) ? '<div class="md-import-group-head"><span class="md-import-group-title">' + escapeHtml(g.title || 'Sem grupo') + '</span>' + applyAll + '</div>' : '') +
          g.list.map(function (b) {
            return (
              '<div class="md-import-row" data-mi-row="' + b.id + '">' +
              '  <div class="min-w-0 flex-1">' +
              '    <p class="md-import-title">' + escapeHtml(b.title) + ' <span class="md-import-size">' + b.body.length + ' car.</span></p>' +
              '    <p class="md-import-excerpt">' + escapeHtml(excerpt(b.body) || '(sem texto)') + '</p>' +
              dupWarning(b) +
              '  </div>' +
              '  <select class="input-field py-1 text-xs md-import-dest" data-mi-dest="' + b.id + '">' + destOptions(b, dests[b.id]) + '</select>' +
              '</div>'
            );
          }).join('') +
          '</div>'
        );
      }).join('') || '<p class="quest-empty">Nenhum bloco encontrado nesse nível.</p>';
      renderSummary();
    }

    function renderAll() { renderBar(); renderBody(); }
    renderAll();

    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) { close(); return; }
      var btn = e.target.closest('[data-mi]');
      if (!btn) return;
      var a = btn.getAttribute('data-mi');
      if (a === 'close') { close(); return; }
      if (a === 'apply') {
        var plan = blocks.map(function (b) { return { block: b, dest: dests[b.id] || 'skip' }; }).filter(function (p) { return p.dest !== 'skip'; });
        if (!plan.length) { close(); return; }
        close();
        if (opts.onApply) opts.onApply(plan);
      }
    });
    overlayEl.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-mi-level')) { level = Number(t.value); rebuild(); renderAll(); return; }
      if (t.hasAttribute('data-mi-dest')) {
        var id = t.getAttribute('data-mi-dest');
        dests[id] = t.value;
        var row = t.closest('[data-mi-row]');
        var b = blocks.filter(function (x) { return x.id === id; })[0];
        var old = row.querySelector('.md-import-warn');
        if (old) old.remove();
        var w = dupWarning(b);
        if (w) row.querySelector('.min-w-0').insertAdjacentHTML('beforeend', w);
        renderSummary(); return;
      }
      if (t.hasAttribute('data-mi-group') && t.value) {
        var key = t.getAttribute('data-mi-group');
        var v = t.value;
        blocks.forEach(function (b) {
          if (b.groupKey !== key) return;
          // "Novo tipo" de outro grupo não faz sentido: cada grupo cria o seu.
          dests[b.id] = v.indexOf('codexnew:') === 0 ? 'codexnew:' + b.groupKey : v;
        });
        renderBody(); return;
      }
    });
    return true;
  }

  // ---------- Aviso pós-importação (com Desfazer) ----------

  var toastEl = null, toastTimer = null;
  function showDone(result, onUndo) {
    if (toastEl) toastEl.remove();
    var parts = [];
    if (result.gdd) parts.push(result.gdd + ' no GDD');
    if (result.gddNew) parts.push(result.gddNew + ' seções novas');
    if (result.codex) parts.push(result.codex + ' entradas no Codex' + (result.types ? ' (' + result.types + ' tipos novos)' : ''));
    if (result.notes) parts.push(result.notes + ' notas');
    toastEl = document.createElement('div');
    toastEl.className = 'md-import-toast card-surface';
    toastEl.innerHTML = GDC.icon('check', { size: 14, className: 'text-emerald-500' }) +
      '<span>Importado: ' + escapeHtml(parts.join(' · ') || 'nada') + '</span>' +
      '<button type="button" class="btn-ghost py-1 text-xs" data-mi-undo>Desfazer</button>' +
      '<button type="button" class="kanban-icon-btn" data-mi-dismiss title="Fechar">' + GDC.icon('x', { size: 13 }) + '</button>';
    document.body.appendChild(toastEl);
    var dismiss = function () { if (toastEl) { toastEl.remove(); toastEl = null; } if (toastTimer) clearTimeout(toastTimer); };
    toastEl.querySelector('[data-mi-undo]').addEventListener('click', function () { dismiss(); if (onUndo) onUndo(); });
    toastEl.querySelector('[data-mi-dismiss]').addEventListener('click', dismiss);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(dismiss, 20000);
  }

  GDC.mdImport = { shiftHeadings: shiftHeadings, singular: singular, parse: parse, buildBlocks: buildBlocks, defaultLevel: defaultLevel, suggest: suggest, applyPlan: applyPlan, extractStats: extractStats, cleanTitle: cleanTitle, niceCase: niceCase };
  GDC.ui.mdImport = { open: open, close: close, showDone: showDone };
}(window));
