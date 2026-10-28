/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var TYPE_ICON_CHOICES = ['user', 'map', 'globe', 'box', 'rocket', 'target', 'wrench', 'sliders', 'book-open', 'file-text', 'flag', 'inbox', 'sparkles'];

  var root, codexState, gddSections, gddProjectType, gddDoc, callbacks;
  // gddDoc: o documento inteiro, quando disponível — o layout do GDD pode ser personalizado por
  // projeto (doc.gddLayout), então a lista de seções depende do doc, não só do tipo.
  function gddSchemaArg() { return gddDoc || gddProjectType; }
  function gddSectionText(id) { var src = gddDoc ? gddDoc.sections : gddSections; return (src && src[id]) || ''; }
  var activeTypeId = 'all';
  // Filtros e ordenação da lista de entradas (só na memória da sessão — não vão pro documento).
  // fieldFilters[typeId][fieldId] = valor escolhido; sortState[typeId | 'all'] = 'name' | 'updated' |
  // 'field:<fieldId>:asc' | 'field:<fieldId>:desc'.
  var fieldFilters = {};
  var sortState = {};
  var FILTERABLE_KINDS = ['select', 'tags', 'checkbox', 'reference', 'reference-multi'];
  var SORTABLE_KINDS = ['number', 'text', 'select'];
  // Linha do tempo: por tipo, quando ele tem ao menos um campo Número. viewByType[typeId] = 'list' |
  // 'timeline'; timelineCfg[typeId] = { start, end, label } (ids de campo; end/label opcionais).
  var viewByType = {};
  var timelineCfg = {};
  var searchQuery = '';
  var expandedEntryId = null;
  // Entrada aberta em modo LEITURA (Markdown renderizado, links clicáveis) ou EDIÇÃO (formulário).
  // Abrir uma entrada que já tem conteúdo começa em leitura; entrada nova/vazia começa em edição.
  var entryReading = false;
  var viewMode = 'browse'; // 'browse' | 'types'
  var editingTypeId = null;
  var editingTypeDraft = null;
  var isCreatingType = false;
  var graphOpen = false;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function truncate(str, max) {
    if (!str) return '';
    return str.length > max ? str.slice(0, max).trim() + '…' : str;
  }

  function typeById(id) {
    return codexState.types.filter(function (t) { return t.id === id; })[0] || null;
  }

  function entryById(id) {
    return codexState.entries.filter(function (e) { return e.id === id; })[0] || null;
  }

  function findEntryByName(name) {
    var key = (name || '').trim().toLowerCase();
    if (!key) return null;
    return codexState.entries.filter(function (e) { return (e.name || '').trim().toLowerCase() === key; })[0] || null;
  }

  // ---------- Link chips (parsing [[Nome]] em campos de texto longo) ----------

  function linkChipsMarkup(text) {
    var names = GDC.parseWikiLinkNames(text);
    if (!names.length) return '';
    return names.map(function (name) {
      var target = findEntryByName(name);
      if (target) {
        return '<button type="button" class="codex-link-chip" data-goto-entry="' + target.id + '">' +
          GDC.icon('link-2', { size: 10 }) + escapeHtml(target.name || '(sem nome)') + '</button>';
      }
      return '<span class="codex-link-chip codex-link-chip-missing" title="Nenhuma entrada com esse nome ainda">' + escapeHtml(name) + '</span>';
    }).join('');
  }

  // ---------- Relações (referências + links + backlinks) ----------

  function relationChip(label, entryRef) {
    if (!entryRef) return '<span class="codex-rel-chip codex-rel-chip-missing">' + escapeHtml(label) + '</span>';
    var t = typeById(entryRef.typeId);
    return '<button type="button" class="codex-rel-chip" data-goto-entry="' + entryRef.id + '">' +
      (t ? GDC.icon(t.icon, { size: 11 }) : '') + escapeHtml(entryRef.name || '(sem nome)') + '</button>';
  }

  function relationsMarkup(entryId) {
    var rel = GDC.codexRelationsFor(codexState, entryId);
    var hasAny = rel.referencesOut.length || rel.linksOut.length || rel.backlinks.length;
    if (!hasAny) {
      return '<p class="codex-relations-empty">Sem relações ainda — use um campo de Referência ou <code>[[Nome]]</code> no texto pra linkar outra entrada.</p>';
    }

    var refsHtml = rel.referencesOut.map(function (r) {
      var chipsHtml = r.entries.map(function (e) { return relationChip(e ? e.name : '(entrada removida)', e); }).join('');
      return '<div class="codex-rel-row"><span class="codex-rel-field-label">' + escapeHtml(r.fieldLabel) + '</span>' +
        '<span class="codex-rel-chip-row">' + chipsHtml + '</span></div>';
    }).join('');

    var linksHtml = rel.linksOut.map(function (l) { return relationChip(l.name, l.entry); }).join('');

    var backHtml = rel.backlinks.map(function (b) {
      return relationChip((b.fieldLabel ? b.fieldLabel + ': ' : '') + (b.entry.name || '(sem nome)'), b.entry);
    }).join('');

    return (
      (refsHtml ? '<div class="codex-rel-group"><p class="codex-rel-group-title">Referências</p>' + refsHtml + '</div>' : '') +
      (linksHtml ? '<div class="codex-rel-group"><p class="codex-rel-group-title">Links no texto</p><div class="codex-rel-chip-row">' + linksHtml + '</div></div>' : '') +
      (backHtml ? '<div class="codex-rel-group"><p class="codex-rel-group-title">Referenciado por</p><div class="codex-rel-chip-row">' + backHtml + '</div></div>' : '')
    );
  }

  // Só troca o innerHTML se o conteúdo realmente mudou. Sem isso, um "change" redundante (disparado
  // no blur de um textarea — por exemplo, ao clicar num chip ou relação logo abaixo dele) recriaria
  // os elementos do zero no meio do próprio clique, e o alvo sob o cursor deixaria de existir antes
  // do clique terminar. O "input" a cada tecla já mantém tudo atualizado; isso só evita retrabalho.
  // Importante: comparamos com o que NÓS mesmos atribuímos da última vez (guardado numa propriedade
  // no próprio elemento), não com `el.innerHTML` — o navegador normaliza a marcação ao serializá-la
  // de volta (aspas, ordem de atributos...), então comparar com a leitura quase nunca bate.
  function refreshLinkChips(formEl, fieldKey, value) {
    var chipsEl = formEl.querySelector('[data-link-chips="' + fieldKey + '"]');
    if (!chipsEl) return;
    var next = linkChipsMarkup(value);
    if (chipsEl.__lastMarkup === next) return;
    chipsEl.innerHTML = next;
    chipsEl.__lastMarkup = next;
  }

  function refreshRelations(formEl, entryId) {
    var relEl = formEl.querySelector('[data-relations="' + entryId + '"]');
    if (!relEl) return;
    var next = relationsMarkup(entryId);
    if (relEl.__lastMarkup === next) return;
    relEl.innerHTML = next;
    relEl.__lastMarkup = next;
  }

  // ---------- Imagens (campos de tipo "image" + capa do card) ----------
  // resolveImageThumbs (compartilhado com Notas/Mural) busca a URL de cada thumb assincronamente
  // via IndexedDB e aplica como background-image — o markup em si é montado de forma síncrona, só
  // com um ícone de placeholder, pra não travar a renderização esperando cada imagem carregar.
  function resolveImageThumbs(container) {
    if (GDC.imageStore) GDC.imageStore.resolveThumbs(container);
  }

  function handleImageUpload(formEl, entry, fieldId, file) {
    if (!file || !GDC.imageStore) return;
    if (file.type && file.type.indexOf('image/') !== 0) return;
    GDC.imageStore.put(file).then(function (meta) {
      entry.fields[fieldId] = meta.id;
      var patch = {}; patch[fieldId] = meta.id;
      if (callbacks.onUpdateEntry) callbacks.onUpdateEntry(entry.id, { fields: patch });
      refreshDynamicField(formEl, entry, fieldId, meta.id);
      resolveImageThumbs(formEl);
    }).catch(function () { /* falha ao ler/guardar a imagem — mantém o campo como estava */ });
  }

  // ---------- Campos de entrada por tipo de campo ----------

  function fieldInputMarkup(field, value) {
    switch (field.kind) {
      case 'longtext':
        return (
          '<textarea class="input-field resize-y" rows="3" data-entry-field="' + field.id + '" placeholder="Use [[Nome]] para linkar outra entrada">' + escapeHtml(value || '') + '</textarea>' +
          '<div class="codex-link-chips" data-link-chips="' + field.id + '">' + linkChipsMarkup(value) + '</div>'
        );
      case 'select': {
        var opts = '<option value="">—</option>' + (field.options || []).map(function (o) {
          return '<option value="' + escapeHtml(o) + '"' + (o === value ? ' selected' : '') + '>' + escapeHtml(o) + '</option>';
        }).join('');
        return '<select class="input-field" data-entry-field="' + field.id + '">' + opts + '</select>';
      }
      case 'tags':
        return '<input type="text" class="input-field" data-entry-field="' + field.id + '" placeholder="separadas por vírgula" value="' + escapeHtml((value || []).join(', ')) + '" />';
      case 'reference': {
        var refType = typeById(field.refTypeId);
        var candidates = refType ? codexState.entries.filter(function (e) { return e.typeId === refType.id; }) : [];
        var refOpts = '<option value="">Nenhuma</option>' + candidates.map(function (e) {
          return '<option value="' + e.id + '"' + (e.id === value ? ' selected' : '') + '>' + escapeHtml(e.name || '(sem nome)') + '</option>';
        }).join('');
        return '<select class="input-field" data-entry-field="' + field.id + '">' + refOpts + '</select>' +
          (refType ? '' : '<p class="codex-field-hint">O tipo referenciado por este campo não existe mais.</p>');
      }
      case 'reference-multi': {
        var refType2 = typeById(field.refTypeId);
        var selectedIds = Array.isArray(value) ? value : [];
        var selectedEntries = selectedIds.map(function (id) { return entryById(id); }).filter(Boolean);
        var candidates2 = refType2 ? codexState.entries.filter(function (e) { return e.typeId === refType2.id && selectedIds.indexOf(e.id) === -1; }) : [];
        var chips = selectedEntries.map(function (e) {
          return '<span class="codex-multiref-chip">' + escapeHtml(e.name || '(sem nome)') +
            '<button type="button" data-multiref-remove="' + field.id + '::' + e.id + '" title="Remover">' + GDC.icon('x', { size: 10 }) + '</button></span>';
        }).join('');
        var addOpts = '<option value="">+ Adicionar...</option>' + candidates2.map(function (e) {
          return '<option value="' + e.id + '">' + escapeHtml(e.name || '(sem nome)') + '</option>';
        }).join('');
        return (
          '<div class="codex-multiref" data-multiref="' + field.id + '">' +
          (chips ? '<div class="codex-multiref-chips">' + chips + '</div>' : '') +
          '<select class="input-field" data-multiref-add="' + field.id + '">' + addOpts + '</select>' +
          (refType2 ? '' : '<p class="codex-field-hint">O tipo referenciado por este campo não existe mais.</p>') +
          '</div>'
        );
      }
      case 'stats': {
        var rows = Array.isArray(value) ? value : [];
        var rowsHtml = rows.map(function (r, i) {
          return (
            '<div class="codex-stats-row">' +
            '  <input type="text" class="input-field py-1 text-xs" data-stats-label="' + field.id + '::' + i + '" placeholder="Atributo (ex: HP)" value="' + escapeHtml(r.label) + '" />' +
            '  <input type="text" class="input-field py-1 text-xs" data-stats-value="' + field.id + '::' + i + '" placeholder="Valor" value="' + escapeHtml(r.value) + '" />' +
            '  <button type="button" data-stats-remove="' + field.id + '::' + i + '" title="Remover">' + GDC.icon('x', { size: 12 }) + '</button>' +
            '</div>'
          );
        }).join('');
        return (
          '<div class="codex-stats-editor" data-stats="' + field.id + '">' +
          rowsHtml +
          '<button type="button" class="btn-ghost py-1 text-xs" data-stats-add="' + field.id + '">' + GDC.icon('plus', { size: 12 }) + 'Adicionar atributo</button>' +
          '</div>'
        );
      }
      case 'number':
        return '<input type="number" class="input-field" data-entry-field="' + field.id + '" value="' + (value === null || value === undefined ? '' : value) + '" />';
      case 'checkbox':
        return '<label class="codex-checkbox-label"><input type="checkbox" data-entry-field="' + field.id + '" ' + (value ? 'checked' : '') + ' /> Sim</label>';
      case 'image':
        return (
          '<div class="codex-image-field" data-image-field="' + field.id + '">' +
          (value
            ? (
              '<div class="codex-image-thumb img-full" title="Clique pra ampliar" data-image-thumb="' + value + '">' + GDC.icon('image', { size: 16 }) + '</div>' +
              '<div class="codex-image-actions">' +
              '  <label class="btn-ghost py-1 text-xs" title="Trocar imagem">' + GDC.icon('upload', { size: 12 }) + 'Trocar' +
              '    <input type="file" accept="image/*" class="hidden" data-image-upload="' + field.id + '" />' +
              '  </label>' +
              '  <button type="button" class="btn-ghost py-1 text-xs" data-image-remove="' + field.id + '">' + GDC.icon('trash-2', { size: 12 }) + 'Remover</button>' +
              '</div>'
            )
            : (
              '<label class="codex-image-dropzone" data-image-dropzone="' + field.id + '">' +
              GDC.icon('image', { size: 18 }) + '<span>Adicionar imagem — clique ou arraste</span>' +
              '  <input type="file" accept="image/*" class="hidden" data-image-upload="' + field.id + '" />' +
              '</label>'
            )
          ) +
          '</div>'
        );
      default:
        return '<input type="text" class="input-field" data-entry-field="' + field.id + '" value="' + escapeHtml(value || '') + '" />';
    }
  }

  // ---------- Entradas: card colapsado / formulário expandido ----------

  function gdcAssistMarkup(entry, type) {
    if (!type.gddSectionId || entry.summary.trim()) return '';
    var sectionMeta = GDC.sectionMapFor(gddSchemaArg())[type.gddSectionId];
    var sectionText = gddSectionText(type.gddSectionId).trim();
    if (!sectionMeta || !sectionText) return '';
    return (
      '<div class="codex-gdc-assist" data-gdc-assist="' + entry.id + '">' +
      '  <p class="codex-gdc-assist-label">' + GDC.icon('file-text', { size: 12 }) + 'Texto atual do GDC — seção "' + escapeHtml(sectionMeta.label) + '"</p>' +
      '  <p class="codex-gdc-assist-text">' + escapeHtml(sectionText) + '</p>' +
      '  <button type="button" class="btn-ghost py-1 text-xs" data-action="use-gdc-summary">' + GDC.icon('download', { size: 12 }) + 'Usar como resumo inicial</button>' +
      '</div>'
    );
  }

  function entryHasContent(entry, type) {
    if ((entry.summary || '').trim()) return true;
    return type.fields.some(function (f) {
      var v = entry.fields[f.id];
      if (Array.isArray(v)) return v.length > 0;
      if (f.kind === 'checkbox') return !!v;
      return v !== null && v !== undefined && String(v).trim() !== '';
    });
  }

  function resolveWikiLink(name) {
    var hit = findEntryByName(name);
    return hit ? { id: hit.id, label: hit.name || name } : null;
  }

  function mdBlock(text) {
    return GDC.renderMarkdown(text, 'codex-read-md', { resolveLink: resolveWikiLink });
  }

  function readValueMarkup(f, v) {
    switch (f.kind) {
      case 'longtext': return (v || '').trim() ? mdBlock(v) : '';
      case 'text': return (v || '').trim() ? '<p class="codex-read-text">' + escapeHtml(v) + '</p>' : '';
      case 'number': return (v === null || v === undefined) ? '' : '<p class="codex-read-text">' + escapeHtml(String(v)) + '</p>';
      case 'checkbox': return '<p class="codex-read-text">' + (v ? 'Sim' : 'Não') + '</p>';
      case 'select': return v ? '<span class="codex-read-chip">' + escapeHtml(v) + '</span>' : '';
      case 'tags':
        return (v && v.length) ? '<div class="codex-read-chips">' + v.map(function (t) { return '<span class="codex-read-chip">' + escapeHtml(t) + '</span>'; }).join('') + '</div>' : '';
      case 'reference':
      case 'reference-multi': {
        var ids = Array.isArray(v) ? v : (v ? [v] : []);
        var chips = ids.map(function (id) { var en = entryById(id); return en ? relationChip(en.name, en) : ''; }).join('');
        return chips ? '<div class="codex-read-chips">' + chips + '</div>' : '';
      }
      case 'stats': {
        var rows = (v || []).filter(function (r) { return (r.label || '').trim() || (r.value || '').trim(); });
        if (!rows.length) return '';
        return '<table class="codex-read-stats"><tbody>' + rows.map(function (r) {
          return '<tr><th>' + escapeHtml(r.label || '—') + '</th><td>' + escapeHtml(r.value || '—') + '</td></tr>';
        }).join('') + '</tbody></table>';
      }
      case 'image': return v ? '<div class="codex-read-image img-full" title="Clique pra ampliar" data-image-thumb="' + v + '"></div>' : '';
      default: return '';
    }
  }

  /** Paletas/estilos da Direção de arte ligados a esta entrada (só leitura; edição na aba Arte). */
  function artLinksMarkup(entryId) {
    var art = gddDoc && gddDoc.artDirection;
    if (!art || !GDC.artDirection) return '';
    var l = GDC.artDirection.linksFor(art, entryId);
    if (!l.palettes.length && !l.styles.length) return '';
    var chip = function (it, isPal) {
      var strip = isPal ? '<span class="art-strip art-strip-sm">' + it.colors.slice(0, 8).map(function (c) { return '<span style="background-color:' + c.hex + '"></span>'; }).join('') + '</span>' : GDC.icon('palette', { size: 11 });
      return '<button type="button" class="codex-rel-chip" data-goto-art="' + it.id + '">' + strip + escapeHtml(it.name || (isPal ? 'Paleta' : 'Estilo')) + '</button>';
    };
    return '<div class="codex-read-field"><p class="codex-field-label">Direção de arte</p><div class="codex-read-chips">' +
      l.palettes.map(function (p) { return chip(p, true); }).join('') + l.styles.map(function (st) { return chip(st, false); }).join('') + '</div></div>';
  }

  function entryHeadMarkup(entry, type, reading, nameHtml) {
    return (
      '  <div class="codex-entry-form-head">' +
      '    <span class="codex-entry-icon" style="background-color:' + type.color + '20;color:' + type.color + '">' + GDC.icon(type.icon, { size: 14 }) + '</span>' +
      nameHtml +
      '    <div class="flex items-center gap-1 flex-shrink-0">' +
      '      <button type="button" class="kanban-icon-btn" data-action="toggle-entry-read" title="' + (reading ? 'Editar' : 'Ler') + '" aria-label="' + (reading ? 'Editar' : 'Ler') + '">' + GDC.icon(reading ? 'pencil' : 'eye', { size: 14 }) + '</button>' +
      '      <button type="button" class="kanban-icon-btn" data-action="collapse-entry" title="Fechar">' + GDC.icon('chevron-down', { size: 14 }) + '</button>' +
      '      <button type="button" class="kanban-icon-btn kanban-icon-btn-danger" data-action="delete-entry" title="Excluir">' + GDC.icon('trash-2', { size: 14 }) + '</button>' +
      '    </div>' +
      '  </div>'
    );
  }

  /** Modo leitura: o mesmo conteúdo do formulário, mas com Markdown renderizado, [[Nome]] clicável e
   *  campos vazios escondidos. Os botões da cabeça são os mesmos do formulário (data-entry-form igual),
   *  então excluir/fechar funcionam sem caminho separado. */
  function entryReadMarkup(entry, type) {
    // Ordem de leitura: fatos curtos primeiro (ficha técnica, status, tags, referências, imagem), depois
    // o resumo e os textos longos — numa ficha importada, o resumo pode ter várias telas.
    var fieldHtml = function (f) {
      var html = readValueMarkup(f, entry.fields[f.id]);
      return html ? '<div class="codex-read-field"><p class="codex-field-label">' + escapeHtml(f.label) + '</p>' + html + '</div>' : '';
    };
    var parts = [];
    type.fields.forEach(function (f) { if (f.kind !== 'longtext') { var h = fieldHtml(f); if (h) parts.push(h); } });
    if ((entry.summary || '').trim()) parts.push('<div class="codex-read-summary">' + mdBlock(entry.summary) + '</div>');
    type.fields.forEach(function (f) { if (f.kind === 'longtext') { var h = fieldHtml(f); if (h) parts.push(h); } });
    return (
      '<div class="codex-entry-form codex-entry-read" data-entry-form="' + entry.id + '">' +
      entryHeadMarkup(entry, type, true, '<h3 class="codex-read-title">' + escapeHtml(entry.name || '(sem nome)') + '<span class="codex-entry-type-badge">' + escapeHtml(type.name) + '</span></h3>') +
      (parts.length ? parts.join('') : '<p class="text-xs text-muted">Nada preenchido ainda — clique no lápis para editar.</p>') +
      artLinksMarkup(entry.id) +
      '  <div class="codex-relations" data-relations="' + entry.id + '">' + relationsMarkup(entry.id) + '</div>' +
      '</div>'
    );
  }

  function entryFormMarkup(entry, type) {
    var fieldsHtml = type.fields.map(function (f) {
      return (
        '<div class="codex-field-row">' +
        '  <label class="codex-field-label">' + escapeHtml(f.label) + '</label>' +
        fieldInputMarkup(f, entry.fields[f.id]) +
        '</div>'
      );
    }).join('');

    return (
      '<div class="codex-entry-form" data-entry-form="' + entry.id + '">' +
      entryHeadMarkup(entry, type, false, '    <input type="text" class="input-field font-display text-sm font-semibold" data-entry-field="__name" placeholder="Nome" value="' + escapeHtml(entry.name) + '" />') +
      gdcAssistMarkup(entry, type) +
      '  <div class="codex-field-row">' +
      '    <label class="codex-field-label">Resumo</label>' +
      '    <textarea class="input-field resize-y" rows="3" data-entry-field="__summary" placeholder="Use [[Nome]] para linkar outra entrada">' + escapeHtml(entry.summary) + '</textarea>' +
      '    <div class="codex-link-chips" data-link-chips="__summary">' + linkChipsMarkup(entry.summary) + '</div>' +
      '  </div>' +
      fieldsHtml +
      '  <div class="codex-relations" data-relations="' + entry.id + '">' + relationsMarkup(entry.id) + '</div>' +
      '</div>'
    );
  }

  function entryCoverImageId(entry, type) {
    var imgField = type.fields.filter(function (f) { return f.kind === 'image'; })[0];
    return imgField ? entry.fields[imgField.id] : null;
  }

  function entryCardMarkup(entry) {
    var type = typeById(entry.typeId);
    if (!type) return '';
    if (expandedEntryId === entry.id) {
      return '<div class="codex-entry-card codex-entry-card-expanded card-surface" data-entry-card="' + entry.id + '">' +
        (entryReading ? entryReadMarkup(entry, type) : entryFormMarkup(entry, type)) + '</div>';
    }
    var rel = GDC.codexRelationsFor(codexState, entry.id);
    var relCount = rel.referencesOut.reduce(function (n, r) { return n + r.entries.filter(Boolean).length; }, 0) +
      rel.linksOut.filter(function (l) { return l.entry; }).length + rel.backlinks.length;
    var coverId = entryCoverImageId(entry, type);
    return (
      '<div class="codex-entry-card card-surface" data-entry-card="' + entry.id + '">' +
      (coverId ? '<div class="codex-entry-cover" data-image-thumb="' + coverId + '"></div>' : '') +
      '  <button type="button" class="codex-entry-card-head" data-action="expand-entry">' +
      '    <span class="codex-entry-icon" style="background-color:' + type.color + '20;color:' + type.color + '">' + GDC.icon(type.icon, { size: 14 }) + '</span>' +
      '    <span class="min-w-0 flex-1">' +
      '      <span class="codex-entry-name">' + escapeHtml(entry.name || '(sem nome)') + '</span>' +
      (activeTypeId === 'all' ? '<span class="codex-entry-type-badge">' + escapeHtml(type.name) + '</span>' : '') +
      '    </span>' +
      (relCount ? '<span class="codex-entry-rel-count">' + GDC.icon('link-2', { size: 10 }) + relCount + '</span>' : '') +
      '  </button>' +
      (entry.summary ? '<p class="codex-entry-summary">' + escapeHtml(truncate(entry.summary, 140)) + '</p>' : '') +
      '</div>'
    );
  }

  /** Texto pesquisável de uma entrada: nome, resumo e o conteúdo dos campos de texto/seletor/tags. */
  function entrySearchText(e, type) {
    var parts = [e.name || '', e.summary || ''];
    if (type) {
      type.fields.forEach(function (f) {
        var v = e.fields[f.id];
        if (f.kind === 'text' || f.kind === 'longtext' || f.kind === 'select') parts.push(v || '');
        else if (f.kind === 'tags') parts.push((v || []).join(' '));
        else if (f.kind === 'number' && v !== null && v !== undefined) parts.push(String(v));
        else if (f.kind === 'stats') (v || []).forEach(function (r) { parts.push(r.label + ' ' + r.value); });
      });
    }
    return parts.join('\n').toLowerCase();
  }

  function activeFiltersFor(typeId) {
    var all = fieldFilters[typeId] || {};
    var type = typeById(typeId);
    if (!type) return {};
    var out = {};
    type.fields.forEach(function (f) { if (all[f.id] !== undefined && all[f.id] !== '') out[f.id] = all[f.id]; });
    return out;
  }

  function matchesFilter(e, field, wanted) {
    var v = e.fields[field.id];
    if (field.kind === 'checkbox') return (wanted === 'yes') === !!v;
    if (field.kind === 'tags' || field.kind === 'reference-multi') {
      if (wanted === '__empty__') return !(v && v.length);
      return Array.isArray(v) && v.indexOf(wanted) !== -1;
    }
    if (wanted === '__empty__') return !v;
    return v === wanted;
  }

  function sortValue(e, field) {
    var v = e.fields[field.id];
    if (field.kind === 'number') return (typeof v === 'number' && isFinite(v)) ? v : null;
    if (field.kind === 'select') { var i = (field.options || []).indexOf(v); return i === -1 ? null : i; }
    return v ? String(v) : null;
  }

  function byName(a, b) { return (a.name || '').localeCompare(b.name || '', 'pt-BR'); }

  function sortEntries(list, key) {
    var type = activeTypeId !== 'all' ? typeById(activeTypeId) : null;
    if (key === 'updated') { list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); }); return list; }
    var m = /^field:(.+):(asc|desc)$/.exec(key || '');
    var field = m && type ? type.fields.filter(function (f) { return f.id === m[1]; })[0] : null;
    if (!field) { list.sort(byName); return list; }
    var dir = m[2] === 'desc' ? -1 : 1;
    list.sort(function (a, b) {
      var va = sortValue(a, field), vb = sortValue(b, field);
      // Vazio sempre por último, nos dois sentidos — "A definir" não deve abrir a lista.
      if (va === null && vb === null) return byName(a, b);
      if (va === null) return 1;
      if (vb === null) return -1;
      var c = typeof va === 'number' ? va - vb : va.localeCompare(vb, 'pt-BR', { numeric: true });
      return c !== 0 ? c * dir : byName(a, b);
    });
    return list;
  }

  function filteredEntries() {
    var list = codexState.entries.slice();
    var typeMap = {};
    codexState.types.forEach(function (t) { typeMap[t.id] = t; });
    if (activeTypeId !== 'all') {
      list = list.filter(function (e) { return e.typeId === activeTypeId; });
      var type = typeMap[activeTypeId];
      var filters = activeFiltersFor(activeTypeId);
      Object.keys(filters).forEach(function (fieldId) {
        var field = type.fields.filter(function (f) { return f.id === fieldId; })[0];
        if (field) list = list.filter(function (e) { return matchesFilter(e, field, filters[fieldId]); });
      });
    }
    var q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter(function (e) { return entrySearchText(e, typeMap[e.typeId]).indexOf(q) !== -1; });
    return sortEntries(list, sortState[activeTypeId] || 'name');
  }

  // ---------- Barra de filtros/ordenação (acima da lista) ----------

  function filterOptionsFor(field, typeId) {
    var entries = codexState.entries.filter(function (e) { return e.typeId === typeId; });
    if (field.kind === 'checkbox') return [{ v: 'yes', l: 'Sim' }, { v: 'no', l: 'Não' }];
    var opts = [];
    if (field.kind === 'select') {
      opts = (field.options || []).map(function (o) { return { v: o, l: o }; });
    } else if (field.kind === 'tags') {
      var seen = {};
      entries.forEach(function (e) { (e.fields[field.id] || []).forEach(function (t) { seen[t] = true; }); });
      opts = Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); }).map(function (t) { return { v: t, l: t }; });
    } else {
      var used = {};
      entries.forEach(function (e) {
        var v = e.fields[field.id];
        (Array.isArray(v) ? v : (v ? [v] : [])).forEach(function (id) { used[id] = true; });
      });
      opts = Object.keys(used).map(function (id) { var en = entryById(id); return en ? { v: id, l: en.name || '(sem nome)' } : null; })
        .filter(Boolean).sort(function (a, b) { return a.l.localeCompare(b.l, 'pt-BR'); });
    }
    if (!opts.length) return [];
    return opts.concat([{ v: '__empty__', l: '(vazio)' }]);
  }

  // ---------- Linha do tempo ----------

  function numberFields(type) { return type ? type.fields.filter(function (f) { return f.kind === 'number'; }) : []; }
  function textFields(type) { return type ? type.fields.filter(function (f) { return f.kind === 'text'; }) : []; }

  function fieldExists(list, id) { return list.some(function (f) { return f.id === id; }); }

  /** Configuração efetiva: a escolhida pelo usuário, ou um palpite pelos rótulos (Ano/Data → início,
   *  Fim/Até → fim, Data aproximada/Quando/Período → rótulo). */
  function timelineConfig(type) {
    var nums = numberFields(type), texts = textFields(type);
    var c = timelineCfg[type.id] || {};
    var guess = function (list, re) { return (list.filter(function (f) { return re.test(f.label); })[0] || null); };
    var start = fieldExists(nums, c.start) ? c.start : ((guess(nums, /ano|data|year|in[ií]cio/i) || nums[0] || {}).id || null);
    var end = c.end !== undefined ? (fieldExists(nums, c.end) ? c.end : null)
      : ((guess(nums.filter(function (f) { return f.id !== start; }), /fim|at[ée]|t[ée]rmino|end/i) || {}).id || null);
    var label = c.label !== undefined ? (fieldExists(texts, c.label) ? c.label : null)
      : ((guess(texts, /aproxim|data|quando|per[ií]odo|[ée]poca/i) || {}).id || null);
    return { start: start, end: end === start ? null : end, label: label };
  }

  function fmtYear(n) { return (Math.round(n * 100) / 100).toLocaleString('pt-BR', { useGrouping: false }); }

  function timelineControlsMarkup(type) {
    var cfg = timelineConfig(type);
    var nums = numberFields(type), texts = textFields(type);
    var sel = function (role, list, current, allowNone) {
      return '<select class="input-field py-1 text-xs" data-timeline-cfg="' + role + '">' +
        (allowNone ? '<option value="">—</option>' : '') +
        list.map(function (f) { return '<option value="' + f.id + '"' + (f.id === current ? ' selected' : '') + '>' + escapeHtml(f.label) + '</option>'; }).join('') +
        '</select>';
    };
    return (
      '<label class="codex-filter-item"><span class="codex-filter-label">Data</span>' + sel('start', nums, cfg.start, false) + '</label>' +
      (nums.length > 1 ? '<label class="codex-filter-item"><span class="codex-filter-label">Fim</span>' + sel('end', nums.filter(function (f) { return f.id !== cfg.start; }), cfg.end, true) + '</label>' : '') +
      (texts.length ? '<label class="codex-filter-item" title="Texto mostrado no lugar do número (ex.: ~2522–2530)"><span class="codex-filter-label">Rótulo</span>' + sel('label', texts, cfg.label, true) + '</label>' : '')
    );
  }

  function timelineMarkup(type, list) {
    var cfg = timelineConfig(type);
    var dated = [], undated = [];
    list.forEach(function (e) {
      var a = e.fields[cfg.start];
      if (typeof a !== 'number' || !isFinite(a)) { undated.push(e); return; }
      var b = cfg.end ? e.fields[cfg.end] : null;
      if (typeof b !== 'number' || !isFinite(b) || b < a) b = null;
      dated.push({ e: e, a: a, b: b });
    });
    dated.sort(function (x, y) { return x.a - y.a || ((x.b || x.a) - (y.b || y.a)) || (x.e.name || '').localeCompare(y.e.name || '', 'pt-BR'); });
    undated.sort(function (x, y) { return (x.name || '').localeCompare(y.name || '', 'pt-BR'); });

    var statusField = type.fields.filter(function (f) { return f.kind === 'select' && /status/i.test(f.label); })[0];
    // Espaço vertical proporcional ao intervalo até o evento anterior: o mediano vira o espaço "normal",
    // e o resto escala em torno dele (com teto) — séculos de vazio não viram uma página em branco.
    var gaps = [];
    for (var i = 1; i < dated.length; i++) gaps.push(dated[i].a - dated[i - 1].a);
    var sortedGaps = gaps.filter(function (g) { return g > 0; }).sort(function (x, y) { return x - y; });
    var median = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 1;

    var item = function (d, idx) {
      var e = d.e;
      var labelText = cfg.label && (e.fields[cfg.label] || '').trim();
      var when = labelText ? labelText : (d.b !== null ? fmtYear(d.a) + ' – ' + fmtYear(d.b) : fmtYear(d.a));
      var gapHtml = '';
      if (idx > 0) {
        var g = d.a - dated[idx - 1].a;
        var space = g <= 0 ? 0 : Math.min(4, 0.75 * Math.log2(1 + g / median) * 2);
        gapHtml = '<div class="codex-tl-gap" style="height:' + space.toFixed(2) + 'rem">' +
          (g > 0 && g >= median * 4 ? '<span>+' + fmtYear(g) + '</span>' : '') + '</div>';
      }
      var st = statusField ? e.fields[statusField.id] : '';
      return gapHtml +
        '<div class="codex-tl-item' + (d.b !== null ? ' codex-tl-item-range' : '') + '">' +
        '  <div class="codex-tl-when">' + escapeHtml(when) + '</div>' +
        '  <div class="codex-tl-dot" style="border-color:' + type.color + '"></div>' +
        '  <button type="button" class="codex-tl-card card-surface" data-timeline-open="' + e.id + '">' +
        '    <span class="codex-tl-name">' + escapeHtml(e.name || '(sem nome)') + (st ? '<span class="codex-read-chip">' + escapeHtml(st) + '</span>' : '') + '</span>' +
        (e.summary ? '<span class="codex-tl-summary">' + escapeHtml(truncate(e.summary.replace(/\s+/g, ' '), 160)) + '</span>' : '') +
        '  </button>' +
        '</div>';
    };

    var html = dated.length
      ? '<div class="codex-timeline" style="--tl-color:' + type.color + '">' + dated.map(item).join('') + '</div>'
      : '<p class="codex-empty">Nenhuma entrada com o campo "' + escapeHtml((type.fields.filter(function (f) { return f.id === cfg.start; })[0] || {}).label || 'Data') + '" preenchido.</p>';
    if (undated.length) {
      html += '<div class="codex-tl-undated"><p class="codex-field-label">A definir (' + undated.length + ')</p><div class="codex-read-chips">' +
        undated.map(function (e) { return '<button type="button" class="codex-rel-chip" data-timeline-open="' + e.id + '">' + escapeHtml(e.name || '(sem nome)') + '</button>'; }).join('') +
        '</div></div>';
    }
    return html;
  }

  function filterBarMarkup(total, shown) {
    var key = activeTypeId;
    var type = key !== 'all' ? typeById(key) : null;
    var canTimeline = numberFields(type).length > 0;
    var isTimeline = canTimeline && viewByType[key] === 'timeline';
    var current = sortState[key] || 'name';
    var sortOpts = [{ v: 'name', l: 'Nome (A–Z)' }, { v: 'updated', l: 'Editadas recentemente' }];
    if (type) {
      type.fields.filter(function (f) { return SORTABLE_KINDS.indexOf(f.kind) !== -1; }).forEach(function (f) {
        var up = f.kind === 'number' ? 'menor → maior' : (f.kind === 'select' ? 'ordem das opções' : 'A–Z');
        var down = f.kind === 'number' ? 'maior → menor' : (f.kind === 'select' ? 'ordem inversa' : 'Z–A');
        sortOpts.push({ v: 'field:' + f.id + ':asc', l: f.label + ' (' + up + ')' });
        sortOpts.push({ v: 'field:' + f.id + ':desc', l: f.label + ' (' + down + ')' });
      });
    }
    var sortHtml = '<label class="codex-filter-item">' + GDC.icon('arrow-up-down', { size: 12 }) +
      '<select class="input-field py-1 text-xs" data-codex-sort>' + sortOpts.map(function (o) {
        return '<option value="' + escapeHtml(o.v) + '"' + (o.v === current ? ' selected' : '') + '>' + escapeHtml(o.l) + '</option>';
      }).join('') + '</select></label>';

    var filtersHtml = '';
    var active = type ? activeFiltersFor(key) : {};
    if (type) {
      filtersHtml = type.fields.filter(function (f) { return FILTERABLE_KINDS.indexOf(f.kind) !== -1; }).map(function (f) {
        var opts = filterOptionsFor(f, key);
        if (!opts.length) return '';
        var val = active[f.id];
        return '<label class="codex-filter-item' + (val !== undefined ? ' codex-filter-item-on' : '') + '"><span class="codex-filter-label">' + escapeHtml(f.label) + '</span>' +
          '<select class="input-field py-1 text-xs" data-codex-filter="' + f.id + '"><option value="">Todos</option>' + opts.map(function (o) {
            return '<option value="' + escapeHtml(o.v) + '"' + (o.v === val ? ' selected' : '') + '>' + escapeHtml(o.l) + '</option>';
          }).join('') + '</select></label>';
      }).join('');
    }
    var nActive = Object.keys(active).length;
    var narrowed = nActive > 0 || searchQuery.trim();
    var viewToggle = canTimeline
      ? '<div class="codex-view-toggle" role="group" aria-label="Visualização">' +
        '<button type="button" class="wp-icon-btn' + (!isTimeline ? ' wp-btn-on' : '') + '" data-codex-view="list" title="Lista" aria-label="Lista">' + GDC.icon('layout-grid', { size: 14 }) + '</button>' +
        '<button type="button" class="wp-icon-btn' + (isTimeline ? ' wp-btn-on' : '') + '" data-codex-view="timeline" title="Linha do tempo" aria-label="Linha do tempo">' + GDC.icon('git-commit-vertical', { size: 14 }) + '</button>' +
        '</div>'
      : '';
    return (
      '<div class="codex-filter-bar">' +
      filtersHtml +
      (nActive ? '<button type="button" class="btn-ghost py-1 text-xs" data-action="clear-filters">' + GDC.icon('x', { size: 12 }) + 'Limpar filtros</button>' : '') +
      '<span class="wp-stage-spacer"></span>' +
      (narrowed ? '<span class="codex-filter-count">' + shown + ' de ' + total + '</span>' : '') +
      (isTimeline ? timelineControlsMarkup(type) : sortHtml) +
      viewToggle +
      '</div>'
    );
  }

  function emptyTypesMarkup() {
    return (
      '<div class="codex-empty-state">' +
      '  <p class="codex-empty-state-title">Nenhum tipo criado ainda</p>' +
      '  <p class="codex-empty-state-sub">Um tipo é uma categoria — Personagem, Local, Boss... com os campos que você quiser. Comece do zero ou use um conjunto pronto pra editar depois.</p>' +
      '  <div class="flex items-center justify-center gap-2 mt-3">' +
      '    <button type="button" class="btn-ghost py-1.5 text-xs" data-action="open-type-manager">' + GDC.icon('plus', { size: 13 }) + 'Novo tipo em branco</button>' +
      '    <button type="button" class="btn-primary py-1.5 text-xs" data-action="use-suggested-types">' + GDC.icon('sparkles', { size: 13 }) + 'Usar conjunto sugerido</button>' +
      '  </div>' +
      '</div>'
    );
  }

  // Resumo de progresso por categoria — aparece acima da lista quando o tipo ativo tem campos que
  // parecem ser "Categoria" e "Status" (do jeito que o tipo "Asset de Produção" já vem pronto, mas
  // funciona pra qualquer tipo renomeado/duplicado do usuário que siga o mesmo padrão). Considera
  // "pronto" a ÚLTIMA opção do campo de status (A criar → Em produção → Pronto), não um texto fixo,
  // pra não quebrar se o usuário editar os nomes das opções depois.
  function assetProgressSummaryMarkup(type) {
    var catField = type.fields.filter(function (f) { return f.kind === 'select' && /categoria/i.test(f.label); })[0];
    var statusField = type.fields.filter(function (f) { return f.kind === 'select' && /status/i.test(f.label); })[0];
    if (!catField || !statusField) return '';
    var entries = codexState.entries.filter(function (e) { return e.typeId === type.id; });
    if (!entries.length) return '';
    var doneValue = (statusField.options || [])[statusField.options.length - 1];
    var groups = {};
    entries.forEach(function (e) {
      var cat = e.fields[catField.id] || 'Sem categoria';
      if (!groups[cat]) groups[cat] = { done: 0, total: 0 };
      groups[cat].total++;
      if (doneValue && e.fields[statusField.id] === doneValue) groups[cat].done++;
    });
    var order = (catField.options || []).concat(['Sem categoria']);
    var cats = Object.keys(groups).sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
    var chips = cats.map(function (cat) {
      var g = groups[cat];
      var pct = g.total ? Math.round((g.done / g.total) * 100) : 0;
      return (
        '<div class="asset-progress-chip">' +
        '  <span class="asset-progress-chip-label">' + escapeHtml(cat) + '</span>' +
        '  <div class="asset-progress-chip-bar"><div class="asset-progress-chip-fill" style="width:' + pct + '%"></div></div>' +
        '  <span class="asset-progress-chip-count">' + g.done + '/' + g.total + '</span>' +
        '</div>'
      );
    }).join('');
    return '<div class="asset-progress-summary">' + chips + '</div>';
  }

  function gridMarkup() {
    if (codexState.types.length === 0) return emptyTypesMarkup();
    var list = filteredEntries();
    var summary = activeTypeId !== 'all' && typeById(activeTypeId) ? assetProgressSummaryMarkup(typeById(activeTypeId)) : '';
    var total = activeTypeId === 'all' ? codexState.entries.length : codexState.entries.filter(function (e) { return e.typeId === activeTypeId; }).length;
    var bar = total ? filterBarMarkup(total, list.length) : '';
    if (list.length === 0) {
      var narrowed = searchQuery.trim() || Object.keys(activeFiltersFor(activeTypeId)).length;
      return summary + bar + '<p class="codex-empty">' + (narrowed ? 'Nenhuma entrada encontrada com essa busca/filtro.' : 'Nenhuma entrada ainda — clique em "Nova entrada" para criar a primeira.') + '</p>';
    }
    var tlType = activeTypeId !== 'all' ? typeById(activeTypeId) : null;
    if (tlType && viewByType[activeTypeId] === 'timeline' && numberFields(tlType).length) {
      return summary + bar + timelineMarkup(tlType, list);
    }
    return summary + bar + '<div class="codex-entry-grid">' + list.map(entryCardMarkup).join('') + '</div>';
  }

  // ---------- Gerenciador de tipos ----------

  function iconOptionsMarkup(selected) {
    return TYPE_ICON_CHOICES.map(function (k) {
      return '<option value="' + k + '"' + (k === selected ? ' selected' : '') + '>' + k + '</option>';
    }).join('');
  }

  function typeFieldEditorRowMarkup(f, i) {
    var kindOptions = GDC.CODEX_FIELD_KINDS.map(function (k) {
      return '<option value="' + k.id + '"' + (k.id === f.kind ? ' selected' : '') + '>' + escapeHtml(k.label) + '</option>';
    }).join('');
    var extra = '';
    if (f.kind === 'select') {
      extra = '<input type="text" class="input-field py-1 text-xs" data-field-options="' + i + '" placeholder="opções separadas por vírgula" value="' + escapeHtml((f.options || []).join(', ')) + '" />';
    } else if (f.kind === 'reference' || f.kind === 'reference-multi') {
      var choices = codexState.types.map(function (t) {
        return '<option value="' + t.id + '"' + (t.id === f.refTypeId ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>';
      }).join('');
      extra = '<select class="input-field py-1 text-xs" data-field-ref="' + i + '"><option value="">Escolha o tipo referenciado</option>' + choices + '</select>';
    }
    return (
      '<div class="codex-field-editor-row" data-field-editor="' + i + '">' +
      '  <input type="text" class="input-field py-1 text-xs" data-field-label="' + i + '" placeholder="Nome do campo" value="' + escapeHtml(f.label) + '" />' +
      '  <select class="input-field py-1 text-xs" data-field-kind="' + i + '">' + kindOptions + '</select>' +
      extra +
      '  <button type="button" class="text-muted hover:text-rose-500" data-remove-field="' + i + '" title="Remover campo">' + GDC.icon('x', { size: 12 }) + '</button>' +
      '</div>'
    );
  }

  function typeColorSwatchesMarkup(selected) {
    var dots = GDC.MILESTONE_COLOR_PALETTE.map(function (hex) {
      return '<button type="button" class="kanban-color-swatch' + (selected === hex ? ' selected' : '') +
        '" data-tf-color-swatch="' + hex + '" style="background-color:' + hex + '" title="' + hex + '"></button>';
    }).join('');
    return (
      '<div class="kanban-color-swatches">' + dots +
      '  <label class="kanban-color-custom" title="Cor personalizada"><input type="color" data-tf="color" value="' + selected + '" /></label>' +
      '</div>'
    );
  }

  function typeEditFormMarkup() {
    var d = editingTypeDraft;
    var gddOptions = '<option value="">Nenhuma</option>' + GDC.sectionsFor(gddSchemaArg()).map(function (s) {
      return '<option value="' + s.id + '"' + (s.id === d.gddSectionId ? ' selected' : '') + '>' + escapeHtml(s.label) + '</option>';
    }).join('');
    var fieldsHtml = d.fields.map(typeFieldEditorRowMarkup).join('');
    return (
      '<div class="codex-type-row codex-type-row-editing card-surface" data-type-edit-form="' + editingTypeId + '">' +
      '  <div class="codex-type-edit-basics">' +
      '    <input type="text" class="input-field py-1.5 text-xs" data-tf="name" placeholder="Nome do tipo" value="' + escapeHtml(d.name) + '" />' +
      '    <select class="input-field py-1.5 text-xs" data-tf="icon" title="Ícone">' + iconOptionsMarkup(d.icon) + '</select>' +
      '  </div>' +
      '  <div class="codex-field-row">' +
      '    <label class="codex-field-label">Cor</label>' +
      typeColorSwatchesMarkup(d.color) +
      '  </div>' +
      '  <div class="codex-field-row">' +
      '    <label class="codex-field-label">Seção do GDC associada (opcional — usada como sugestão de resumo inicial)</label>' +
      '    <select class="input-field py-1.5 text-xs" data-tf="gddSectionId">' + gddOptions + '</select>' +
      '  </div>' +
      '  <div class="codex-type-fields-editor">' +
      '    <p class="codex-field-label">Campos</p>' +
      fieldsHtml +
      '    <button type="button" class="btn-ghost py-1 text-xs" data-action="add-field">' + GDC.icon('plus', { size: 12 }) + 'Adicionar campo</button>' +
      '  </div>' +
      '  <div class="flex items-center gap-2 mt-2">' +
      '    <button type="button" class="btn-primary flex-1 py-1.5 text-xs" data-action="save-type">Salvar tipo</button>' +
      '    <button type="button" class="btn-ghost py-1.5 text-xs" data-action="cancel-type">Cancelar</button>' +
      '  </div>' +
      '</div>'
    );
  }

  function typeViewRowMarkup(t) {
    var entryCount = codexState.entries.filter(function (e) { return e.typeId === t.id; }).length;
    var gddSectionMap = GDC.sectionMapFor(gddSchemaArg());
    var gddNote = (t.gddSectionId && gddSectionMap[t.gddSectionId]) ? ' · ligado ao GDC: ' + escapeHtml(gddSectionMap[t.gddSectionId].label) : '';
    return (
      '<div class="codex-type-row card-surface" data-type-row="' + t.id + '">' +
      '  <span class="codex-type-dot" style="background-color:' + t.color + '"></span>' +
      GDC.icon(t.icon, { size: 15 }) +
      '  <span class="min-w-0 flex-1">' +
      '    <span class="codex-type-row-name">' + escapeHtml(t.name) + '</span>' +
      '    <span class="codex-type-row-sub">' + t.fields.length + ' campo(s) · ' + entryCount + ' entrada(s)' + gddNote + '</span>' +
      '  </span>' +
      '  <div class="flex items-center gap-1 flex-shrink-0">' +
      '    <button type="button" class="kanban-icon-btn" data-action="edit-type" title="Editar">' + GDC.icon('pencil', { size: 13 }) + '</button>' +
      '    <button type="button" class="kanban-icon-btn kanban-icon-btn-danger" data-action="delete-type" title="Excluir">' + GDC.icon('trash-2', { size: 14 }) + '</button>' +
      '  </div>' +
      '</div>'
    );
  }

  function typeManagerMarkup() {
    var listHtml = codexState.types.map(function (t) {
      return (editingTypeId === t.id && !isCreatingType) ? typeEditFormMarkup() : typeViewRowMarkup(t);
    }).join('') + (isCreatingType ? typeEditFormMarkup() : '');

    return (
      '<div class="codex-type-manager">' +
      '  <div class="codex-type-manager-head">' +
      '    <h3 class="font-display text-sm font-bold text-primary">Tipos do Codex</h3>' +
      '    <div class="flex items-center gap-2">' +
      (codexState.types.length === 0 ? '<button type="button" class="btn-ghost py-1.5 text-xs" data-action="use-suggested-types">' + GDC.icon('sparkles', { size: 13 }) + 'Usar conjunto sugerido</button>' : '') +
      '      <button type="button" class="btn-primary py-1.5 text-xs" data-action="new-type">' + GDC.icon('plus', { size: 13 }) + 'Novo tipo</button>' +
      '    </div>' +
      '  </div>' +
      (codexState.types.length === 0 && !isCreatingType
        ? '<p class="codex-empty">Nenhum tipo ainda.</p>'
        : '<div class="codex-type-manager-list">' + listHtml + '</div>') +
      '</div>'
    );
  }

  // ---------- Sidebar / toolbar / shell ----------

  function typeCountsMap() {
    var m = {};
    codexState.entries.forEach(function (e) { m[e.typeId] = (m[e.typeId] || 0) + 1; });
    return m;
  }

  function sidebarMarkup() {
    if (viewMode === 'types') {
      return '<div class="codex-sidebar"><button type="button" class="btn-ghost py-1.5 text-xs w-full justify-center" data-action="close-type-manager">' + GDC.icon('undo-2', { size: 13 }) + 'Voltar</button></div>';
    }
    var counts = typeCountsMap();
    var typesHtml = codexState.types.map(function (t) {
      return (
        '<button type="button" class="codex-type-item' + (activeTypeId === t.id ? ' codex-type-item-active' : '') + '" data-select-type="' + t.id + '">' +
        '  <span class="codex-type-dot" style="background-color:' + t.color + '"></span>' +
        GDC.icon(t.icon, { size: 14 }) +
        '  <span class="flex-1 truncate text-left">' + escapeHtml(t.name) + '</span>' +
        '  <span class="codex-type-count">' + (counts[t.id] || 0) + '</span>' +
        '</button>'
      );
    }).join('');
    var hasAssetTracker = codexState.types.some(function (t) { return t.name === 'Asset de Produção'; });
    return (
      '<div class="codex-sidebar">' +
      '  <button type="button" class="codex-type-item' + (activeTypeId === 'all' ? ' codex-type-item-active' : '') + '" data-select-type="all">' +
      '    <span class="flex-1 truncate text-left">Todos</span><span class="codex-type-count">' + codexState.entries.length + '</span>' +
      '  </button>' +
      '  <div class="codex-type-list">' + typesHtml + '</div>' +
      (hasAssetTracker ? '' :
        '  <button type="button" class="btn-ghost py-1.5 text-xs w-full justify-center" data-action="add-asset-tracker-type" title="Cria uma seção separada pra rastrear NPCs, instalações, ferramentas etc. que faltam produzir">' +
        GDC.icon('box', { size: 13 }) + 'Rastreador de assets</button>') +
      '  <button type="button" class="btn-ghost py-1.5 text-xs w-full justify-center" data-action="open-type-manager">' + GDC.icon('sliders', { size: 13 }) + 'Gerenciar tipos</button>' +
      '</div>'
    );
  }

  function toolbarMarkup() {
    if (viewMode === 'types') {
      return '<div class="codex-toolbar"><p class="text-sm text-secondary">Crie e edite os tipos de entrada do seu Codex.</p></div>';
    }
    var typeOptions = codexState.types.map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === activeTypeId ? ' selected' : '') + '>' + escapeHtml(t.name) + '</option>';
    }).join('');
    var newEntryHtml = codexState.types.length
      ? '<select class="input-field py-1.5 text-xs" id="codex-new-type-select">' + typeOptions + '</select>' +
        '<button type="button" class="btn-primary py-1.5 text-xs" data-action="new-entry">' + GDC.icon('plus', { size: 13 }) + 'Nova entrada</button>'
      : '';
    return (
      '<div class="codex-toolbar">' +
      '  <div class="codex-search-wrap">' + GDC.icon('search', { size: 14 }) +
      '    <input type="text" class="codex-search-input" id="codex-search" placeholder="Buscar em nomes e campos..." value="' + escapeHtml(searchQuery) + '" />' +
      '  </div>' +
      '  <div class="flex items-center gap-2 flex-wrap">' +
      newEntryHtml +
      '    <button type="button" class="btn-ghost py-1.5 text-xs" data-action="export-codex-md" title="Exportar Codex como Markdown">' + GDC.icon('file-down', { size: 13 }) + '.md</button>' +
      '    <button type="button" class="btn-ghost py-1.5 text-xs' + (graphOpen ? ' btn-ghost-active' : '') + '" data-action="toggle-graph">' + GDC.icon('share-2', { size: 13 }) + 'Grafo</button>' +
      '  </div>' +
      '</div>'
    );
  }

  function mainAreaMarkup() {
    return viewMode === 'types' ? typeManagerMarkup() : gridMarkup();
  }

  function shellMarkup() {
    return (
      '<section id="codex" class="builder-section">' +
      '  <div class="mb-8 text-center">' +
      '    <div class="hero-badge">' + GDC.icon('book-open', { size: 14, className: 'text-fuchsia-400' }) + 'Referência do projeto</div>' +
      '    <h2 class="font-display text-3xl font-bold text-primary">Codex</h2>' +
      '    <p class="mt-2 text-secondary">Personagens, locais, mecânicas e tudo mais que dá corpo ao seu mundo — em fichas ligadas entre si.</p>' +
      '  </div>' +
      '  <div id="codex-toolbar"></div>' +
      '  <div class="codex-layout" id="codex-layout">' +
      '    <div class="codex-layout-sidebar" id="codex-sidebar"></div>' +
      '    <div class="codex-layout-main" id="codex-main"></div>' +
      '    <div class="codex-graph-panel" id="codex-graph-panel" style="display:none"></div>' +
      '  </div>' +
      '  <div class="tab-help-note">' + GDC.icon('info', { size: 16 }) +
      '    <p><strong>Como funciona:</strong> crie tipos (Personagem, Local, Boss...) com os campos que fizerem sentido pro seu projeto, inclusive campos de Referência, que ligam uma entrada à outra. Use <code>[[Nome]]</code> em qualquer texto longo pra linkar outra entrada sem precisar de um campo dedicado — o Codex resolve o link e mostra quem referencia quem. Tipos ligados a uma seção do GDC mostram o texto atual dela como sugestão de resumo ao criar a primeira entrada; a importação é manual e feita uma única vez — depois disso, Codex e GDC vivem de forma independente, sem sincronizar de volta.</p>' +
      '  </div>' +
      '</section>'
    );
  }

  // ---------- Navegação a partir de um link/relação/nó do grafo ----------

  function expandToEntry(id) {
    var entry = entryById(id);
    if (!entry) return;
    activeTypeId = 'all';
    searchQuery = '';
    viewMode = 'browse';
    expandedEntryId = id;
    entryReading = true; // navegar por link = ler
    render();
    var cardEl = root.querySelector('[data-entry-card="' + id + '"]');
    if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- Eventos delegados (um único listener no root evita perder foco em re-renders parciais) ----------

  function handleRootClick(e) {
    var el;

    if ((el = e.target.closest('[data-goto-entry]'))) { expandToEntry(el.getAttribute('data-goto-entry')); return; }
    if ((el = e.target.closest('[data-goto-art]'))) { if (callbacks.onGotoArt) callbacks.onGotoArt(el.getAttribute('data-goto-art')); return; }

    if ((el = e.target.closest('[data-codex-view]'))) { viewByType[activeTypeId] = el.getAttribute('data-codex-view'); renderMain(); return; }
    if ((el = e.target.closest('[data-timeline-open]'))) {
      // Abre a entrada em leitura na LISTA do mesmo tipo (o botão de visualização volta pra linha do tempo).
      viewByType[activeTypeId] = 'list';
      expandedEntryId = el.getAttribute('data-timeline-open');
      entryReading = true;
      render();
      var tlCard = root.querySelector('[data-entry-card="' + expandedEntryId + '"]');
      if (tlCard) tlCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if ((el = e.target.closest('[data-action="clear-filters"]'))) { delete fieldFilters[activeTypeId]; renderMain(); return; }
    if ((el = e.target.closest('[data-select-type]'))) { activeTypeId = el.getAttribute('data-select-type'); render(); return; }

    if ((el = e.target.closest('[data-action="open-type-manager"]'))) { viewMode = 'types'; render(); return; }

    if ((el = e.target.closest('[data-action="close-type-manager"]'))) {
      viewMode = 'browse'; editingTypeId = null; editingTypeDraft = null; isCreatingType = false;
      render(); return;
    }

    if ((el = e.target.closest('[data-action="use-suggested-types"]'))) {
      GDC.buildSuggestedCodexTypes().forEach(function (t) { if (callbacks.onAddType) callbacks.onAddType(t); });
      render(); return;
    }

    // Adiciona (uma vez só) o tipo pronto "Asset de Produção" — separado dos tipos de lore/worldbuilding
    // acima, pra rastrear o que ainda falta criar pro jogo (NPCs, instalações, ferramentas...). Como o
    // Codex já filtra por tipo na barra lateral, selecioná-lo aqui já isola esses assets dos demais.
    if ((el = e.target.closest('[data-action="add-asset-tracker-type"]'))) {
      var assetType = GDC.buildAssetTrackerCodexType(codexState.types);
      if (callbacks.onAddType) callbacks.onAddType(assetType);
      activeTypeId = assetType.id;
      render(); return;
    }

    if ((el = e.target.closest('[data-action="new-type"]'))) {
      editingTypeId = GDC.makeId('type');
      isCreatingType = true;
      editingTypeDraft = { name: '', icon: 'file-text', color: '#94a3b8', gddSectionId: '', fields: [] };
      render(); return;
    }

    if ((el = e.target.closest('[data-action="edit-type"]'))) {
      var row = el.closest('[data-type-row]');
      var t = typeById(row.getAttribute('data-type-row'));
      if (!t) return;
      editingTypeId = t.id;
      isCreatingType = false;
      editingTypeDraft = {
        name: t.name, icon: t.icon, color: t.color, gddSectionId: t.gddSectionId || '',
        fields: t.fields.map(function (f) { return Object.assign({}, f, { options: (f.options || []).slice() }); }),
      };
      render(); return;
    }

    if ((el = e.target.closest('[data-action="delete-type"]'))) {
      var row2 = el.closest('[data-type-row]');
      var id2 = row2.getAttribute('data-type-row');
      var t2 = typeById(id2);
      if (!t2) return;
      var count = codexState.entries.filter(function (e2) { return e2.typeId === id2; }).length;
      var msg = count > 0
        ? 'Excluir o tipo "' + t2.name + '"? As ' + count + ' entrada(s) desse tipo também serão apagadas. Essa ação não pode ser desfeita.'
        : 'Excluir o tipo "' + t2.name + '"? Essa ação não pode ser desfeita.';
      if (!global.confirm(msg)) return;
      if (callbacks.onDeleteType) callbacks.onDeleteType(id2);
      if (activeTypeId === id2) activeTypeId = 'all';
      render(); return;
    }

    if ((el = e.target.closest('[data-action="add-field"]'))) {
      editingTypeDraft.fields.push(GDC.codexField('Novo campo', 'text'));
      render(); return;
    }

    if ((el = e.target.closest('[data-remove-field]'))) {
      editingTypeDraft.fields.splice(Number(el.getAttribute('data-remove-field')), 1);
      render(); return;
    }

    if ((el = e.target.closest('[data-action="save-type"]'))) {
      if (!editingTypeDraft.name.trim()) return;
      var payload = {
        id: editingTypeId, name: editingTypeDraft.name.trim(), icon: editingTypeDraft.icon, color: editingTypeDraft.color,
        gddSectionId: editingTypeDraft.gddSectionId || null,
        fields: editingTypeDraft.fields.filter(function (f) { return f.label.trim(); }),
      };
      if (isCreatingType) { if (callbacks.onAddType) callbacks.onAddType(payload); }
      else if (callbacks.onUpdateType) callbacks.onUpdateType(editingTypeId, payload);
      editingTypeId = null; editingTypeDraft = null; isCreatingType = false;
      render(); return;
    }

    if ((el = e.target.closest('[data-action="cancel-type"]'))) {
      editingTypeId = null; editingTypeDraft = null; isCreatingType = false;
      render(); return;
    }

    if ((el = e.target.closest('[data-action="expand-entry"]'))) {
      expandedEntryId = el.closest('[data-entry-card]').getAttribute('data-entry-card');
      var openEntry = entryById(expandedEntryId), openType = openEntry && typeById(openEntry.typeId);
      entryReading = !!(openEntry && openType && entryHasContent(openEntry, openType));
      render(); return;
    }
    if ((el = e.target.closest('[data-action="toggle-entry-read"]'))) {
      entryReading = !entryReading;
      // Sai de algum campo em edição antes: o valor já foi salvo no "input"; re-render aqui é seguro.
      render(); return;
    }

    if ((el = e.target.closest('[data-action="collapse-entry"]'))) { expandedEntryId = null; render(); return; }

    if ((el = e.target.closest('[data-action="delete-entry"]'))) {
      var form = el.closest('[data-entry-form]');
      var eid = form.getAttribute('data-entry-form');
      var entry = entryById(eid);
      if (!global.confirm('Excluir "' + (entry ? (entry.name || '(sem nome)') : '') + '"? Essa ação não pode ser desfeita.')) return;
      if (callbacks.onDeleteEntry) callbacks.onDeleteEntry(eid);
      expandedEntryId = null;
      render(); return;
    }

    if ((el = e.target.closest('[data-action="use-gdc-summary"]'))) {
      var box = el.closest('[data-gdc-assist]');
      var eid2 = box.getAttribute('data-gdc-assist');
      var entry2 = entryById(eid2);
      var type2 = entry2 && typeById(entry2.typeId);
      if (!entry2 || !type2 || !type2.gddSectionId) return;
      var text = gddSectionText(type2.gddSectionId).trim();
      if (!text) return;
      entry2.summary = text;
      if (callbacks.onUpdateEntry) callbacks.onUpdateEntry(eid2, { summary: text });
      render(); return;
    }

    if ((el = e.target.closest('[data-action="new-entry"]'))) {
      var sel = root.querySelector('#codex-new-type-select');
      var typeId = sel ? sel.value : (codexState.types[0] && codexState.types[0].id);
      if (!typeId || !callbacks.onAddEntry) return;
      var created = callbacks.onAddEntry(typeId);
      if (created) {
        activeTypeId = typeId;
        expandedEntryId = created.id;
        entryReading = false;
        render();
        var cardEl = root.querySelector('[data-entry-card="' + created.id + '"]');
        if (cardEl) cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    if ((el = e.target.closest('[data-action="toggle-graph"]'))) {
      graphOpen = !graphOpen;
      var layoutEl = root.querySelector('#codex-layout');
      if (layoutEl) layoutEl.classList.toggle('codex-layout-graph-open', graphOpen);
      var panel = root.querySelector('#codex-graph-panel');
      if (panel) panel.style.display = graphOpen ? '' : 'none';
      if (GDC.ui.codexGraph) { if (graphOpen) GDC.ui.codexGraph.show(); else GDC.ui.codexGraph.hide(); }
      el.classList.toggle('btn-ghost-active', graphOpen);
      return;
    }

    if ((el = e.target.closest('[data-action="export-codex-md"]'))) {
      GDC.downloadBlob(GDC.buildCodexMarkdown(codexState), 'text/markdown', 'codex.md');
      return;
    }

    if ((el = e.target.closest('[data-tf-color-swatch]'))) {
      if (editingTypeDraft) editingTypeDraft.color = el.getAttribute('data-tf-color-swatch');
      render(); return;
    }

    if ((el = e.target.closest('[data-multiref-remove]'))) {
      var mrParts = el.getAttribute('data-multiref-remove').split('::');
      var mrFieldId = mrParts[0], mrRemoveId = mrParts[1];
      var mrForm = el.closest('[data-entry-form]');
      var mrEntryId = mrForm.getAttribute('data-entry-form');
      var mrEntry = entryById(mrEntryId);
      var mrNext = (Array.isArray(mrEntry.fields[mrFieldId]) ? mrEntry.fields[mrFieldId] : []).filter(function (id) { return id !== mrRemoveId; });
      mrEntry.fields[mrFieldId] = mrNext;
      var mrPatch = {}; mrPatch[mrFieldId] = mrNext;
      if (callbacks.onUpdateEntry) callbacks.onUpdateEntry(mrEntryId, { fields: mrPatch });
      refreshDynamicField(mrForm, mrEntry, mrFieldId, mrNext);
      refreshRelations(mrForm, mrEntryId);
      return;
    }

    if ((el = e.target.closest('[data-stats-add]'))) {
      var saFieldId = el.getAttribute('data-stats-add');
      var saForm = el.closest('[data-entry-form]');
      var saEntryId = saForm.getAttribute('data-entry-form');
      var saEntry = entryById(saEntryId);
      var saRows = (Array.isArray(saEntry.fields[saFieldId]) ? saEntry.fields[saFieldId] : []).slice();
      saRows.push({ id: GDC.makeId('stat'), label: '', value: '' });
      saEntry.fields[saFieldId] = saRows;
      var saPatch = {}; saPatch[saFieldId] = saRows;
      if (callbacks.onUpdateEntry) callbacks.onUpdateEntry(saEntryId, { fields: saPatch });
      refreshDynamicField(saForm, saEntry, saFieldId, saRows);
      var newRowInput = saForm.querySelector('[data-stats-label="' + saFieldId + '::' + (saRows.length - 1) + '"]');
      if (newRowInput) newRowInput.focus();
      return;
    }

    if ((el = e.target.closest('[data-image-remove]'))) {
      var irFieldId = el.getAttribute('data-image-remove');
      var irForm = el.closest('[data-entry-form]');
      var irEntryId = irForm.getAttribute('data-entry-form');
      var irEntry = entryById(irEntryId);
      irEntry.fields[irFieldId] = null;
      var irPatch = {}; irPatch[irFieldId] = null;
      if (callbacks.onUpdateEntry) callbacks.onUpdateEntry(irEntryId, { fields: irPatch });
      refreshDynamicField(irForm, irEntry, irFieldId, null);
      return;
    }

    if ((el = e.target.closest('[data-stats-remove]'))) {
      var srParts = el.getAttribute('data-stats-remove').split('::');
      var srFieldId = srParts[0], srIdx = Number(srParts[1]);
      var srForm = el.closest('[data-entry-form]');
      var srEntryId = srForm.getAttribute('data-entry-form');
      var srEntry = entryById(srEntryId);
      var srRows = (Array.isArray(srEntry.fields[srFieldId]) ? srEntry.fields[srFieldId] : []).slice();
      srRows.splice(srIdx, 1);
      srEntry.fields[srFieldId] = srRows;
      var srPatch = {}; srPatch[srFieldId] = srRows;
      if (callbacks.onUpdateEntry) callbacks.onUpdateEntry(srEntryId, { fields: srPatch });
      refreshDynamicField(srForm, srEntry, srFieldId, srRows);
      return;
    }
  }

  /** Substitui só o wrapper de um campo dinâmico (multiref/stats) pelo seu markup atualizado —
   *  evita um render() completo (que perderia o foco em outros campos do mesmo formulário). */
  function refreshDynamicField(formEl, entry, fieldId, value) {
    var type = typeById(entry.typeId);
    var field = type && type.fields.filter(function (f) { return f.id === fieldId; })[0];
    if (!field) return;
    var wrapSelector = field.kind === 'stats' ? '[data-stats="' + fieldId + '"]'
      : field.kind === 'image' ? '[data-image-field="' + fieldId + '"]'
        : '[data-multiref="' + fieldId + '"]';
    var wrapEl = formEl.querySelector(wrapSelector);
    if (wrapEl) wrapEl.outerHTML = fieldInputMarkup(field, value);
  }

  function handleRootInput(e) {
    var t = e.target;

    if (t.id === 'codex-search') { searchQuery = t.value; renderMain(); return; }
    if (t.matches('[data-codex-sort]')) {
      if (e.type !== 'change') return;
      sortState[activeTypeId] = t.value; renderMain(); return;
    }
    if (t.matches('[data-timeline-cfg]')) {
      if (e.type !== 'change') return;
      var tc = timelineCfg[activeTypeId] || (timelineCfg[activeTypeId] = {});
      var role = t.getAttribute('data-timeline-cfg');
      tc[role] = t.value || null;
      // Trocar o início pode tornar o "fim" igual a ele — o palpite de fim é refeito.
      if (role === 'start' && tc.end === tc.start) tc.end = undefined;
      renderMain(); return;
    }
    if (t.matches('[data-codex-filter]')) {
      if (e.type !== 'change') return;
      var ff = fieldFilters[activeTypeId] || (fieldFilters[activeTypeId] = {});
      if (t.value === '') delete ff[t.getAttribute('data-codex-filter')];
      else ff[t.getAttribute('data-codex-filter')] = t.value;
      renderMain(); return;
    }

    if (t.matches('[data-tf]')) {
      if (!editingTypeDraft) return;
      editingTypeDraft[t.getAttribute('data-tf')] = t.value;
      return;
    }
    if (t.matches('[data-field-label]')) {
      editingTypeDraft.fields[Number(t.getAttribute('data-field-label'))].label = t.value;
      return;
    }
    if (t.matches('[data-field-kind]')) {
      editingTypeDraft.fields[Number(t.getAttribute('data-field-kind'))].kind = t.value;
      render(); return;
    }
    if (t.matches('[data-field-options]')) {
      editingTypeDraft.fields[Number(t.getAttribute('data-field-options'))].options =
        t.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      return;
    }
    if (t.matches('[data-field-ref]')) {
      editingTypeDraft.fields[Number(t.getAttribute('data-field-ref'))].refTypeId = t.value || null;
      return;
    }

    if (t.matches('[data-image-upload]')) {
      var iuFieldId = t.getAttribute('data-image-upload');
      var iuFile = t.files && t.files[0];
      var iuForm = t.closest('[data-entry-form]');
      var iuEntry = entryById(iuForm.getAttribute('data-entry-form'));
      if (iuFile && iuEntry) handleImageUpload(iuForm, iuEntry, iuFieldId, iuFile);
      t.value = '';
      return;
    }

    if (t.matches('[data-multiref-add]')) {
      var maFieldId = t.getAttribute('data-multiref-add');
      var addId = t.value;
      if (!addId) return;
      var maForm = t.closest('[data-entry-form]');
      var maEntryId = maForm.getAttribute('data-entry-form');
      var maEntry = entryById(maEntryId);
      var maNext = (Array.isArray(maEntry.fields[maFieldId]) ? maEntry.fields[maFieldId] : []).slice();
      if (maNext.indexOf(addId) === -1) maNext.push(addId);
      maEntry.fields[maFieldId] = maNext;
      var maPatch = {}; maPatch[maFieldId] = maNext;
      if (callbacks.onUpdateEntry) callbacks.onUpdateEntry(maEntryId, { fields: maPatch });
      refreshDynamicField(maForm, maEntry, maFieldId, maNext);
      refreshRelations(maForm, maEntryId);
      return;
    }

    if (t.matches('[data-stats-label]') || t.matches('[data-stats-value]')) {
      var isLabel = t.matches('[data-stats-label]');
      var raw = (isLabel ? t.getAttribute('data-stats-label') : t.getAttribute('data-stats-value')).split('::');
      var slFieldId = raw[0], slIdx = Number(raw[1]);
      var slForm = t.closest('[data-entry-form]');
      var slEntryId = slForm.getAttribute('data-entry-form');
      var slEntry = entryById(slEntryId);
      var slRows = Array.isArray(slEntry.fields[slFieldId]) ? slEntry.fields[slFieldId] : [];
      if (!slRows[slIdx]) return;
      slRows[slIdx][isLabel ? 'label' : 'value'] = t.value;
      var slPatch = {}; slPatch[slFieldId] = slRows;
      if (callbacks.onUpdateEntry) callbacks.onUpdateEntry(slEntryId, { fields: slPatch });
      return;
    }

    if (t.matches('[data-entry-field]')) {
      var form = t.closest('[data-entry-form]');
      if (!form) return;
      var entryId = form.getAttribute('data-entry-form');
      var fieldKey = t.getAttribute('data-entry-field');

      if (fieldKey === '__name') {
        if (callbacks.onUpdateEntry) callbacks.onUpdateEntry(entryId, { name: t.value });
        return;
      }
      if (fieldKey === '__summary') {
        if (callbacks.onUpdateEntry) callbacks.onUpdateEntry(entryId, { summary: t.value });
        refreshLinkChips(form, '__summary', t.value);
        refreshRelations(form, entryId);
        return;
      }

      var entry = entryById(entryId);
      var type = entry && typeById(entry.typeId);
      var field = type && type.fields.filter(function (f) { return f.id === fieldKey; })[0];
      if (!field) return;

      var value;
      if (field.kind === 'checkbox') value = t.checked;
      else if (field.kind === 'tags') value = t.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      else if (field.kind === 'number') value = t.value === '' ? null : Number(t.value);
      else value = t.value;

      var patchFields = {};
      patchFields[field.id] = value;
      if (callbacks.onUpdateEntry) callbacks.onUpdateEntry(entryId, { fields: patchFields });

      if (field.kind === 'longtext') refreshLinkChips(form, field.id, value);
      if (field.kind === 'longtext' || field.kind === 'reference') refreshRelations(form, entryId);
    }
  }

  // ---------- Render / mount ----------

  function render() {
    root.querySelector('#codex-toolbar').innerHTML = toolbarMarkup();
    root.querySelector('#codex-sidebar').innerHTML = sidebarMarkup();
    root.querySelector('#codex-main').innerHTML = mainAreaMarkup();
    if (GDC.ui.codexGraph) GDC.ui.codexGraph.setData(codexState);
    resolveImageThumbs(root);
  }

  function renderMain() {
    root.querySelector('#codex-main').innerHTML = mainAreaMarkup();
    resolveImageThumbs(root);
  }

  function mount(container, opts) {
    root = container;
    codexState = opts.codex;
    gddSections = opts.gddSections || {};
    gddProjectType = opts.projectType;
    gddDoc = opts.doc || null;
    callbacks = {
      onAddType: opts.onAddType, onUpdateType: opts.onUpdateType, onDeleteType: opts.onDeleteType,
      onAddEntry: opts.onAddEntry, onUpdateEntry: opts.onUpdateEntry, onDeleteEntry: opts.onDeleteEntry,
      onGotoArt: opts.onGotoArt,
    };
    activeTypeId = 'all'; searchQuery = ''; expandedEntryId = null; fieldFilters = {}; sortState = {}; viewByType = {}; timelineCfg = {};
    editingTypeId = null; editingTypeDraft = null; isCreatingType = false;
    viewMode = 'browse'; graphOpen = false;

    root.innerHTML = shellMarkup();
    root.addEventListener('click', handleRootClick);
    root.addEventListener('input', handleRootInput);
    root.addEventListener('change', handleRootInput);

    // Drag-and-drop de imagem direto sobre um campo de imagem (além de clicar pra escolher o arquivo).
    root.addEventListener('dragover', function (e) {
      if (!e.target.closest('[data-image-field]')) return;
      e.preventDefault();
      var zone = e.target.closest('[data-image-dropzone]');
      if (zone) zone.classList.add('codex-image-dropzone-hover');
    });
    root.addEventListener('dragleave', function (e) {
      var zone = e.target.closest('[data-image-dropzone]');
      if (zone) zone.classList.remove('codex-image-dropzone-hover');
    });
    root.addEventListener('drop', function (e) {
      var wrap = e.target.closest('[data-image-field]');
      if (!wrap) return;
      e.preventDefault();
      var zone = e.target.closest('[data-image-dropzone]');
      if (zone) zone.classList.remove('codex-image-dropzone-hover');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      var form = wrap.closest('[data-entry-form]');
      var entry = form && entryById(form.getAttribute('data-entry-form'));
      var fieldId = wrap.getAttribute('data-image-field');
      if (file && entry) handleImageUpload(form, entry, fieldId, file);
    });

    if (GDC.ui.codexGraph) {
      GDC.ui.codexGraph.mount(root.querySelector('#codex-graph-panel'), { onGotoEntry: expandToEntry });
    }

    render();
  }

  function reset(codex, gddSectionsArg, projectTypeArg, docArg) {
    codexState = codex;
    gddSections = gddSectionsArg || {};
    if (projectTypeArg) gddProjectType = projectTypeArg;
    if (docArg) gddDoc = docArg;
    activeTypeId = 'all'; searchQuery = ''; expandedEntryId = null; fieldFilters = {}; sortState = {}; viewByType = {}; timelineCfg = {};
    editingTypeId = null; editingTypeDraft = null; isCreatingType = false;
    viewMode = 'browse';
    if (graphOpen) {
      graphOpen = false;
      var panel = root.querySelector('#codex-graph-panel');
      if (panel) panel.style.display = 'none';
      var layoutEl = root.querySelector('#codex-layout');
      if (layoutEl) layoutEl.classList.remove('codex-layout-graph-open');
      if (GDC.ui.codexGraph) GDC.ui.codexGraph.hide();
    }
    render();
  }

  GDC.ui.codex = { mount: mount, reset: reset, gotoEntry: expandToEntry };
}(window));
