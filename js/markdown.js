/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};

  function buildMarkdown(doc) {
    var title = doc.title.trim() || 'Jogo sem título';
    var docLabel = doc.projectType === 'boardgame' ? 'Documento de Design (Jogo de Tabuleiro)' : 'Documento de Design de Jogo (GDD)';
    var md = '# ' + docLabel + '\n\n## ' + title + '\n\n';
    var sectionMap = GDC.sectionMapFor(doc);

    GDC.groupsFor(doc).forEach(function (group) {
      md += '## ' + group.label + '\n\n';
      group.sectionIds.forEach(function (sectionId) {
        var meta = sectionMap[sectionId];
        var content = (doc.sections[sectionId] || '').trim();
        md += '### ' + meta.label + '\n\n';
        md += content ? (content + '\n\n') : '*A preencher...*\n\n';
      });
    });

    return md;
  }

  // ---------- Codex ----------

  function findCodexEntry(codex, id) {
    return codex.entries.filter(function (e) { return e.id === id; })[0] || null;
  }

  function codexFieldValueToMarkdown(codex, field, value) {
    switch (field.kind) {
      case 'select':
      case 'text':
        return value || '';
      case 'number':
        return (value === null || value === undefined) ? '' : String(value);
      case 'checkbox':
        return value ? 'Sim' : 'Não';
      case 'tags':
        return (value || []).join(', ');
      case 'reference': {
        var e = value ? findCodexEntry(codex, value) : null;
        return e ? e.name : '';
      }
      case 'reference-multi': {
        var names = (value || []).map(function (id) {
          var e2 = findCodexEntry(codex, id);
          return e2 ? e2.name : null;
        }).filter(Boolean);
        return names.join(', ');
      }
      default:
        return '';
    }
  }

  /** Gera um documento Markdown a partir do Codex, agrupado por tipo — cada entrada vira uma seção
   *  com seu resumo, campos e (no caso de "Ficha técnica") uma lista de atributos. */
  function buildCodexMarkdown(codex) {
    if (!codex.types.length) return '# Codex\n\n*Nenhum tipo criado ainda.*\n';
    var md = '# Codex\n\n';

    codex.types.forEach(function (type) {
      var entries = codex.entries.filter(function (e) { return e.typeId === type.id; })
        .slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'pt-BR'); });
      if (!entries.length) return;

      md += '## ' + type.name + '\n\n';
      entries.forEach(function (entry) {
        md += '### ' + (entry.name || '(sem nome)') + '\n\n';
        if ((entry.summary || '').trim()) md += entry.summary.trim() + '\n\n';

        type.fields.forEach(function (f) {
          var value = entry.fields[f.id];
          if (f.kind === 'longtext') {
            var text = (value || '').trim();
            if (text) md += '**' + f.label + ':**\n\n' + text + '\n\n';
            return;
          }
          if (f.kind === 'stats') {
            var rows = Array.isArray(value) ? value.filter(function (r) { return (r.label || '').trim() || (r.value || '').trim(); }) : [];
            if (rows.length) {
              md += '**' + f.label + ':**\n\n';
              rows.forEach(function (r) { md += '- ' + (r.label.trim() || '—') + ': ' + (r.value.trim() || '—') + '\n'; });
              md += '\n';
            }
            return;
          }
          var formatted = codexFieldValueToMarkdown(codex, f, value);
          if (formatted) md += '**' + f.label + ':** ' + formatted + '\n\n';
        });

        md += '---\n\n';
      });
    });

    return md;
  }

  // ---------- Exibição ----------
  /** Markdown → HTML seguro pra mostrar na tela (preview do GDD). Usa marked + DOMPurify (CDN, ver
   *  index.html) — o texto é do próprio usuário, mas pode vir de um JSON importado de outra pessoa,
   *  então sanitizar é obrigatório (marked sozinho deixa passar <script>/onerror etc.). Sem as
   *  bibliotecas (offline), cai pro texto puro com quebras de linha preservadas, como era antes. */
  function escHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /** Troca [[Nome]] por um botão (entrada encontrada) ou um span (não encontrada) ANTES do marked —
   *  o marked deixa HTML inline passar e o DOMPurify mantém atributos data-* (ALLOW_DATA_ATTR é o padrão).
   *  `resolve(nome)` devolve { id, label } ou null. */
  function replaceWikiLinks(src, resolve, decode) {
    return src.replace(/\[\[([^\[\]\n]+)\]\]/g, function (all, rawName) {
      var name = decode ? decode(rawName.trim()) : rawName.trim();
      if (!name) return all;
      var hit = resolve(name);
      if (hit) return '<button type="button" class="md-wikilink" data-goto-entry="' + escHtml(hit.id) + '">' + escHtml(hit.label || name) + '</button>';
      return '<span class="md-wikilink md-wikilink-missing" title="Nenhuma entrada do Codex com esse nome ainda">' + escHtml(name) + '</span>';
    });
  }

  /** `opts.resolveLink(nome)` (opcional) liga os [[Nome]] do texto às entradas do Codex. */
  function renderMarkdown(text, className, opts) {
    var src = String(text == null ? '' : text);
    var cls = className ? ' ' + className : '';
    var resolve = opts && typeof opts.resolveLink === 'function' ? opts.resolveLink : null;
    if (global.marked && typeof global.marked.parse === 'function' && global.DOMPurify && typeof global.DOMPurify.sanitize === 'function') {
      try {
        var withLinks = resolve ? replaceWikiLinks(src, resolve) : src;
        return '<div class="md-body' + cls + '">' + global.DOMPurify.sanitize(global.marked.parse(withLinks, { gfm: true, breaks: true })) + '</div>';
      } catch (e) { /* cai no texto puro abaixo */ }
    }
    // Offline: texto puro com quebras preservadas — os links continuam funcionando (o escape vem antes,
    // então o HTML inserido pelos links é o único HTML no resultado).
    var esc = escHtml(src);
    if (resolve) esc = replaceWikiLinks(esc, resolve, function (name) {
      return name.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    });
    return '<p class="whitespace-pre-wrap' + cls + '">' + esc + '</p>';
  }

  GDC.renderMarkdown = renderMarkdown;
  GDC.buildMarkdown = buildMarkdown;
  GDC.buildCodexMarkdown = buildCodexMarkdown;
}(window));
