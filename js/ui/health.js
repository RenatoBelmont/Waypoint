/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var root, onExportJson, onGotoCodexEntry, currentProjectId;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function ringMarkup(pct) {
    var size = 44, stroke = 4, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    var offset = c * (1 - pct / 100);
    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" class="health-ring flex-shrink-0">' +
      '<circle cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r + '" fill="none" class="health-ring-track" stroke-width="' + stroke + '" />' +
      '<circle cx="' + (size / 2) + '" cy="' + (size / 2) + '" r="' + r + '" fill="none" class="health-ring-fill" stroke-width="' + stroke +
      '" stroke-dasharray="' + c + '" stroke-dashoffset="' + offset + '" transform="rotate(-90 ' + (size / 2) + ' ' + (size / 2) + ')" stroke-linecap="round" />' +
      '<text x="50%" y="52%" text-anchor="middle" dominant-baseline="middle" class="health-ring-text">' + pct + '%</text>' +
      '</svg>'
    );
  }

  var PRIORITY_META = {
    baixa: { label: 'Baixa', color: '#3b82f6' },
    media: { label: 'Média', color: '#f59e0b' },
    alta: { label: 'Alta', color: '#f43f5e' },
  };

  function milestoneProgress(m, cards) {
    var linked = cards.filter(function (c) { return !c.isMilestone && c.milestoneId === m.id; });
    if (linked.length === 0) return null;
    var done = linked.filter(function (c) { return c.column === 'done'; }).length;
    return { done: done, total: linked.length, pct: Math.round((done / linked.length) * 100) };
  }

  /** Pontua tarefas pendentes com base em sinais que já existem no projeto (prioridade, coluna, proximidade de marco, checklist) e explica o motivo. */
  function computeRecommendations(doc) {
    var cards = doc.kanban.cards;
    var milestones = cards.filter(function (c) { return c.isMilestone; });
    var milestoneMap = {};
    milestones.forEach(function (m) { milestoneMap[m.id] = milestoneProgress(m, cards); });

    var priorityWeight = { alta: 3, media: 2, baixa: 1 };
    var columnWeight = { doing: 3, review: 2.5, todo: 1.5, backlog: 1 };

    var candidates = cards.filter(function (c) { return !c.isMilestone && c.column !== 'done'; });

    var scored = candidates.map(function (c) {
      var reasons = [];
      var score = priorityWeight[c.priority] || 2;
      if (c.priority === 'alta') reasons.push({ text: 'Prioridade alta', weight: 3 });

      score += columnWeight[c.column] || 1;
      if (c.column === 'doing') reasons.push({ text: 'Já está em desenvolvimento', weight: 3 });
      else if (c.column === 'review') reasons.push({ text: 'Já está em teste/revisão', weight: 2.5 });

      if (c.milestoneId && milestoneMap[c.milestoneId]) {
        var mp = milestoneMap[c.milestoneId];
        var boost = (mp.pct / 100) * 2.5;
        score += boost;
        if (mp.pct >= 50) {
          var mCard = milestones.filter(function (m) { return m.id === c.milestoneId; })[0];
          reasons.push({ text: 'Perto de fechar o marco "' + mCard.title + '" (' + mp.pct + '%)', weight: boost });
        }
      }

      if (c.checklist && c.checklist.length > 0) {
        var doneItems = c.checklist.filter(function (t) { return t.done; }).length;
        var checklistPct = doneItems / c.checklist.length;
        score += checklistPct * 1.5;
        if (checklistPct >= 0.5) reasons.push({ text: 'Checklist quase completo (' + doneItems + '/' + c.checklist.length + ')', weight: checklistPct * 1.5 });
      }

      reasons.sort(function (a, b) { return b.weight - a.weight; });
      var reasonText = reasons.length ? reasons.slice(0, 2).map(function (r) { return r.text; }).join(' · ') : 'Próxima tarefa disponível no board';

      return { card: c, score: score, reason: reasonText };
    });

    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 3);
  }

  function recommendationsMarkup(doc) {
    var hasAnyPending = doc.kanban.cards.some(function (c) { return !c.isMilestone && c.column !== 'done'; });
    var recs = hasAnyPending ? computeRecommendations(doc) : [];

    var bodyHtml;
    if (!hasAnyPending) {
      var hasAnyCards = doc.kanban.cards.some(function (c) { return !c.isMilestone; });
      var msg = hasAnyCards
        ? 'Tudo em dia! Nenhuma tarefa pendente no momento.'
        : 'Nenhuma tarefa criada ainda — vá até o Kanban e adicione a primeira.';
      bodyHtml = '<p class="health-empty">' + escapeHtml(msg) + '</p>';
    } else {
      bodyHtml = recs.map(function (r, i) {
        var meta = PRIORITY_META[r.card.priority] || PRIORITY_META.media;
        return (
          '<div class="health-rec-row">' +
          '  <span class="health-rec-rank">' + (i + 1) + '</span>' +
          '  <div class="min-w-0 flex-1">' +
          '    <p class="health-rec-title">' + escapeHtml(r.card.title) + '</p>' +
          '    <p class="health-rec-reason">' + escapeHtml(r.reason) + '</p>' +
          '  </div>' +
          '  <span class="health-rec-priority" style="background-color:' + meta.color + '20;color:' + meta.color + '">' + meta.label + '</span>' +
          '</div>'
        );
      }).join('');
    }

    return (
      '<div class="card-surface health-recommend-card">' +
      '  <h3 class="font-display text-sm font-bold text-primary">' + GDC.icon('target', { size: 15, className: 'text-amber-400' }) + 'O que trabalhar agora?</h3>' +
      '  <div class="health-rec-list">' + bodyHtml + '</div>' +
      '</div>'
    );
  }

  function computeHealth(doc) {
    var sections = GDC.sectionsFor(doc);
    var filled = sections.filter(function (s) { return (doc.sections[s.id] || '').length >= s.minChars; });
    var gddPct = sections.length ? Math.round((filled.length / sections.length) * 100) : 0;
    var missingSections = sections.filter(function (s) { return (doc.sections[s.id] || '').length < s.minChars; });

    var cards = doc.kanban.cards;
    var normalCards = cards.filter(function (c) { return !c.isMilestone; });
    var doneCards = normalCards.filter(function (c) { return c.column === 'done'; });
    var kanbanPct = normalCards.length ? Math.round((doneCards.length / normalCards.length) * 100) : 0;

    var milestones = cards.filter(function (c) { return c.isMilestone; });
    var milestonesDone = milestones.filter(function (m) { return m.column === 'done'; });

    return {
      gddPct: gddPct, filledCount: filled.length, totalSections: sections.length, missingSections: missingSections,
      normalCardsTotal: normalCards.length, doneCardsTotal: doneCards.length, kanbanPct: kanbanPct,
      milestones: milestones, milestonesDoneCount: milestonesDone.length,
    };
  }

  // ---------- Codex: status de lore ----------
  // Um tipo do Codex entra aqui quando tem um campo SELETOR cujo rótulo contém "status" (mesma
  // convenção do resumo de progresso do próprio Codex). Opções que soam como "ainda não decidido"
  // contam como pendência — cobre Canônico/Proposta/A definir e o rastreador de assets (A criar).
  var PENDING_STATUS_RE = /propost|definir|pendente|rascunho|a criar|revis|ideia|aberto|em discuss/i;

  function computeCodexHealth(doc) {
    var codex = doc.codex || { types: [], entries: [] };
    var rows = [], pending = [];
    codex.types.forEach(function (t) {
      var field = t.fields.filter(function (f) { return f.kind === 'select' && /status/i.test(f.label) && (f.options || []).length; })[0];
      if (!field) return;
      var entries = codex.entries.filter(function (e) { return e.typeId === t.id; });
      var counts = field.options.map(function (o) { return { option: o, count: 0, pending: PENDING_STATUS_RE.test(o) }; });
      var empty = 0;
      entries.forEach(function (e) {
        var v = e.fields[field.id];
        var i = field.options.indexOf(v);
        if (i === -1) { empty++; return; }
        counts[i].count++;
        if (counts[i].pending) pending.push({ entry: e, type: t, status: v });
      });
      rows.push({ type: t, field: field, total: entries.length, counts: counts, empty: empty });
    });
    pending.sort(function (a, b) { return (b.entry.updatedAt || 0) - (a.entry.updatedAt || 0); });
    return { hasTypes: codex.types.length > 0, rows: rows, pending: pending };
  }

  var STATUS_SEG_COLORS = ['#10b981', '#f59e0b', '#8b5cf6', '#3b82f6', '#ec4899', '#14b8a6'];

  function codexHealthMarkup(doc) {
    var c = computeCodexHealth(doc);
    if (!c.hasTypes) return '';
    var title = '<h3 class="font-display text-sm font-bold text-primary">' + GDC.icon('book-open', { size: 15, className: 'text-amber-400' }) + 'Status do Codex</h3>';
    if (!c.rows.length) {
      return (
        '<div class="card-surface health-codex-card">' + title +
        '  <p class="health-empty">Adicione um campo seletor chamado "Status" aos tipos do Codex (ex.: Canônico / Proposta / A definir) para acompanhar aqui o que ainda está em aberto.</p>' +
        '</div>'
      );
    }
    var rowsHtml = c.rows.map(function (r) {
      var segs = r.counts.map(function (k, i) {
        if (!k.count || !r.total) return '';
        return '<span class="health-codex-seg" style="width:' + (k.count / r.total * 100) + '%;background-color:' + STATUS_SEG_COLORS[i % STATUS_SEG_COLORS.length] + '" title="' + escapeHtml(k.option) + ': ' + k.count + '"></span>';
      }).join('');
      var legend = r.counts.map(function (k, i) {
        return '<span class="health-codex-legend' + (k.pending && k.count ? ' health-codex-legend-pending' : '') + '"><i style="background-color:' + STATUS_SEG_COLORS[i % STATUS_SEG_COLORS.length] + '"></i>' + escapeHtml(k.option) + ' ' + k.count + '</span>';
      }).join('') + (r.empty ? '<span class="health-codex-legend"><i class="health-codex-legend-empty"></i>Sem status ' + r.empty + '</span>' : '');
      return (
        '<div class="health-codex-row">' +
        '  <p class="health-milestone-title">' + escapeHtml(r.type.name) + ' <span class="text-muted">· ' + r.total + '</span></p>' +
        '  <div class="health-codex-bar">' + segs + '</div>' +
        '  <div class="health-codex-legends">' + legend + '</div>' +
        '</div>'
      );
    }).join('');
    var pend = c.pending.slice(0, 6);
    var pendingHtml = pend.length
      ? '<p class="codex-field-label mt-1">Em aberto (' + c.pending.length + ')</p><div class="health-codex-pending">' + pend.map(function (p) {
        return '<button type="button" class="health-codex-pending-item" data-goto-entry="' + escapeHtml(p.entry.id) + '">' +
          GDC.icon(p.type.icon, { size: 12 }) + '<span class="min-w-0 flex-1 truncate text-left">' + escapeHtml(p.entry.name || '(sem nome)') + '</span>' +
          '<span class="health-codex-pending-status">' + escapeHtml(p.status) + '</span></button>';
      }).join('') + (c.pending.length > pend.length ? '<p class="text-xs text-muted">e mais ' + (c.pending.length - pend.length) + ' — use o filtro de Status no Codex.</p>' : '') + '</div>'
      : '<p class="health-empty">Nenhuma entrada em aberto.</p>';
    return '<div class="card-surface health-codex-card">' + title + rowsHtml + pendingHtml + '</div>';
  }

  function statMarkup(value, label, sub) {
    return (
      '<div class="card-surface health-stat">' +
      '  <span class="health-stat-value">' + escapeHtml(String(value)) + '</span>' +
      '  <span class="health-stat-label">' + escapeHtml(label) + '</span>' +
      (sub ? '  <span class="health-stat-sub">' + escapeHtml(sub) + '</span>' : '') +
      '</div>'
    );
  }

  var BACKUP_STALE_DAYS = 3;

  /** Lógica compartilhada entre o cartão de aviso (backupReminderMarkup) e a bolinha de notificação da
   *  aba (refreshNotifyDot) — as duas precisam concordar exatamente sobre quando avisar. */
  function backupWarningInfo(doc) {
    var hasContent = !!(doc.title && doc.title.trim()) ||
      Object.keys(doc.sections).some(function (k) { return (doc.sections[k] || '').trim(); }) ||
      doc.kanban.cards.length > 0;
    if (!hasContent) return { shouldWarn: false, lastExport: null, daysSince: null };

    var lastExport = GDC.getLastExportTimestamp ? GDC.getLastExportTimestamp(currentProjectId) : null;
    var daysSince = lastExport ? Math.floor((Date.now() - lastExport) / (24 * 60 * 60 * 1000)) : null;
    var shouldWarn = lastExport === null || daysSince >= BACKUP_STALE_DAYS;
    return { shouldWarn: shouldWarn, lastExport: lastExport, daysSince: daysSince };
  }

  function backupReminderMarkup(doc) {
    var info = backupWarningInfo(doc);
    if (!info.shouldWarn) return '';
    var lastExport = info.lastExport, daysSince = info.daysSince;

    var message = lastExport === null
      ? 'Você ainda não exportou um backup deste projeto. Por enquanto tudo é salvo só neste navegador — exportar uma cópia em JSON evita perder o trabalho se o cache for limpo.'
      : 'Seu último backup foi há ' + daysSince + ' dia' + (daysSince === 1 ? '' : 's') + '. Vale exportar uma cópia atualizada.';

    return (
      '<div class="card-surface health-backup-card">' +
      '  <div class="health-backup-text">' + GDC.icon('cloud-off', { size: 16, className: 'text-amber-400 flex-shrink-0' }) +
      '    <p>' + escapeHtml(message) + '</p>' +
      '  </div>' +
      '  <button type="button" class="btn-ghost py-1.5 text-xs" id="gdc-health-export">' + GDC.icon('download', { size: 14 }) + 'Exportar JSON</button>' +
      '</div>'
    );
  }

  // ---------- Armazenamento de imagens ----------
  // As imagens (Codex/Notas/Mural) ficam num banco à parte (ver imageStore.js) e HOJE nunca são
  // removidas de lá sozinhas — trocar a foto de uma nota ou apagar um item do mural com imagem deixa
  // o arquivo antigo "esquecido" nesse banco, ocupando espaço sem que o usuário perceba. Esse cartão
  // mostra o total ocupado e deixa limpar de uma vez só o que sobrou sem uso em nenhum lugar.

  function formatBytes(bytes) {
    if (!bytes) return '0 KB';
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function storageCardMarkup(info) {
    if (!info || info.totalCount === 0) return '';
    var totalText = info.totalCount + ' imagem' + (info.totalCount === 1 ? '' : 'ns') + ' · ' + formatBytes(info.totalBytes);
    if (!info.orphanCount) {
      return (
        '<div class="card-surface health-storage-card health-storage-card-ok">' +
        '  <div class="health-backup-text">' + GDC.icon('image', { size: 16, className: 'text-emerald-500 flex-shrink-0' }) +
        '    <p>Armazenamento de imagens: ' + escapeHtml(totalText) + '. Nenhuma sobrando sem uso.</p>' +
        '  </div>' +
        '</div>'
      );
    }
    var message = info.orphanCount + ' imagem' + (info.orphanCount === 1 ? '' : 'ns') + ' sem uso em nenhuma ficha, nota ou item do mural (' +
      formatBytes(info.orphanBytes) + ' de ' + formatBytes(info.totalBytes) + ' total) — provavelmente sobrou de uma troca ou exclusão anterior.';
    return (
      '<div class="card-surface health-storage-card">' +
      '  <div class="health-backup-text">' + GDC.icon('alert-triangle', { size: 16, className: 'text-amber-400 flex-shrink-0' }) +
      '    <p>' + escapeHtml(message) + '</p>' +
      '  </div>' +
      '  <button type="button" class="btn-ghost py-1.5 text-xs" id="gdc-health-clean-images">' + GDC.icon('trash-2', { size: 14 }) + 'Limpar não usadas</button>' +
      '</div>'
    );
  }

  /** Calcula uso (assíncrono, via IndexedDB) e injeta o cartão no placeholder síncrono já renderizado
   *  — mesmo padrão dos thumbnails (resolveThumbs): o resto da tela não espera essa consulta. */
  function refreshStorageCard(doc) {
    if (!GDC.imageStore) return;
    var wrapEl = root && root.querySelector('#gdc-health-storage');
    if (!wrapEl) return;
    GDC.imageStore.listAll().then(function (records) {
      // Usa a versão que soma referências de TODOS os projetos salvos, não só deste — o banco de
      // imagens é global (compartilhado entre projetos), então uma imagem em uso em outro projeto
      // nunca pode ser marcada como "órfã" e oferecida pra exclusão aqui.
      var usedIds = GDC.collectUsedImageIdsAllProjects ? GDC.collectUsedImageIdsAllProjects(doc, currentProjectId) : GDC.collectUsedImageIds(doc);
      var totalBytes = 0, orphanBytes = 0, orphanCount = 0, orphanIds = [];
      records.forEach(function (r) {
        totalBytes += r.size;
        if (!usedIds[r.id]) { orphanBytes += r.size; orphanCount++; orphanIds.push(r.id); }
      });
      var info = { totalCount: records.length, totalBytes: totalBytes, orphanCount: orphanCount, orphanBytes: orphanBytes };
      wrapEl.innerHTML = storageCardMarkup(info);
      var cleanBtn = wrapEl.querySelector('#gdc-health-clean-images');
      if (cleanBtn) {
        cleanBtn.addEventListener('click', function () {
          var msg = 'Excluir ' + orphanCount + ' imagem' + (orphanCount === 1 ? '' : 'ns') + ' sem uso (' + formatBytes(orphanBytes) + ')? Essa ação não pode ser desfeita.';
          if (!global.confirm(msg)) return;
          Promise.all(orphanIds.map(function (id) { return GDC.imageStore.remove(id); })).then(function () {
            refreshStorageCard(doc);
            refreshNotifyDot(doc);
          });
        });
      }
    });
  }

  // ---------- Bolinha de aviso na aba ----------
  // Pedido do Renato: um ponto vermelho na aba "Saúde" sempre que houver um aviso importante (backup
  // desatualizado ou imagens órfãs sobrando) — pra dar pra notar sem precisar entrar na aba. Só liga o
  // ícone de vínculo (na aba) quando existe pelo menos um dos dois avisos; some assim que o motivo some
  // (backup exportado, imagens órfãs limpas). Consulta o DOM da barra de abas direto (renderizada uma
  // vez em app.js) em vez de precisar de uma referência passada por opts — mais simples e não muda com
  // reset/import, já que a bolinha em si nunca é recriada, só escondida/mostrada.

  function checkOrphanWarning(doc, cb) {
    if (!GDC.imageStore) { cb(false); return; }
    GDC.imageStore.listAll().then(function (records) {
      var usedIds = GDC.collectUsedImageIdsAllProjects ? GDC.collectUsedImageIdsAllProjects(doc, currentProjectId) : GDC.collectUsedImageIds(doc);
      cb(records.some(function (r) { return !usedIds[r.id]; }));
    }).catch(function () { cb(false); });
  }

  // refreshNotifyDot é chamada de vários pontos (debounce do autosave, depois de exportar, depois de
  // limpar imagens órfãs, ao trocar pra aba Saúde...) e cada chamada dispara sua própria checagem
  // ASSÍNCRONA de órfãs (leitura no IndexedDB). Sem controle de ordem, uma checagem mais ANTIGA pode
  // terminar DEPOIS de uma mais nova (ex.: o autosave dispara uma checagem vendo uma imagem órfã, a
  // pessoa clica "Limpar não usadas" logo em seguida — o que dispara sua própria checagem, já sem
  // órfãs, e some a bolinha — mas se a checagem antiga (mais lenta) só resolver depois, ela reescreve
  // "tem órfã" por cima, e a bolinha "volta" sozinha sem motivo aparente). Esse era o bug relatado
  // ("o dot vermelho não está sumindo"): um número de sequência garante que só o resultado da chamada
  // mais RECENTE pode realmente atualizar a bolinha — qualquer resultado que chegue atrasado é
  // descartado.
  var notifyDotRequestId = 0;

  function refreshNotifyDot(doc) {
    var dotEl = document.querySelector('[data-tab-notify="saude"]');
    if (!dotEl) return;
    var myRequestId = ++notifyDotRequestId;
    if (backupWarningInfo(doc).shouldWarn) { dotEl.hidden = false; return; }
    // Backup em dia — ainda falta checar imagens órfãs (assíncrono) antes de poder esconder de vez.
    checkOrphanWarning(doc, function (hasOrphans) {
      if (myRequestId !== notifyDotRequestId) return; // uma chamada mais nova já assumiu — descarta
      dotEl.hidden = !hasOrphans;
    });
  }

  function render(doc) {
    var h = computeHealth(doc);
    var bodyEl = root.querySelector('#gdc-health-body');
    if (!bodyEl) return;

    var statsHtml =
      statMarkup(h.gddPct + '%', 'GDD completo', h.filledCount + ' de ' + h.totalSections + ' fichas preenchidas') +
      statMarkup(
        h.normalCardsTotal ? (h.doneCardsTotal + '/' + h.normalCardsTotal) : '—',
        'Tarefas concluídas',
        h.normalCardsTotal ? (h.kanbanPct + '% do board finalizado') : 'Nenhuma tarefa criada ainda'
      ) +
      statMarkup(
        h.milestones.length ? (h.milestonesDoneCount + '/' + h.milestones.length) : '—',
        'Marcos alcançados',
        h.milestones.length ? null : 'Nenhum marco criado ainda'
      );

    var milestonesHtml;
    if (h.milestones.length === 0) {
      milestonesHtml = '<p class="health-empty">Nenhum marco criado ainda — vá até o Kanban e clique em "Sugerir marcos", ou crie o seu.</p>';
    } else {
      milestonesHtml = h.milestones.map(function (m) {
        var p = milestoneProgress(m, doc.kanban.cards);
        var pct = p ? p.pct : 0;
        var subtext = p ? (p.done + ' de ' + p.total + ' tarefas concluídas') : 'Sem tarefas vinculadas ainda';
        return (
          '<div class="health-milestone-row">' +
          ringMarkup(pct) +
          '<div class="min-w-0 flex-1">' +
          '  <p class="health-milestone-title">' + escapeHtml(m.title) + '</p>' +
          '  <p class="health-milestone-sub">' + escapeHtml(subtext) + '</p>' +
          '</div>' +
          (m.column === 'done' ? '<span class="health-milestone-badge">' + GDC.icon('flag', { size: 11 }) + 'Concluído</span>' : '') +
          '</div>'
        );
      }).join('');
    }

    var missingHtml = '';
    if (h.missingSections.length > 0 && h.missingSections.length < h.totalSections) {
      missingHtml =
        '<div class="card-surface health-missing">' +
        '  <h3 class="font-display text-sm font-bold text-primary">Fichas ainda vazias</h3>' +
        '  <div class="health-missing-tags">' +
        h.missingSections.map(function (s) { return '<span class="health-missing-tag">' + escapeHtml(s.label) + '</span>'; }).join('') +
        '  </div>' +
        '</div>';
    } else if (h.missingSections.length === 0) {
      missingHtml =
        '<div class="card-surface health-missing health-missing-complete">' +
        '  <p>' + GDC.icon('check', { size: 14, className: 'text-emerald-500' }) + 'Todas as fichas do GDC estão preenchidas.</p>' +
        '</div>';
    }

    bodyEl.innerHTML =
      backupReminderMarkup(doc) +
      '<div id="gdc-health-storage"></div>' +
      recommendationsMarkup(doc) +
      '<div class="health-stats-grid">' + statsHtml + '</div>' +
      '<div class="card-surface health-milestones-card">' +
      '  <h3 class="font-display text-sm font-bold text-primary">Marcos do projeto</h3>' +
      '  <div class="health-milestone-list">' + milestonesHtml + '</div>' +
      '</div>' +
      codexHealthMarkup(doc) +
      missingHtml;

    var exportBtn = bodyEl.querySelector('#gdc-health-export');
    if (exportBtn) exportBtn.addEventListener('click', function () {
      if (onExportJson) onExportJson();
    });

    refreshStorageCard(doc);
    refreshNotifyDot(doc);
  }

  function mount(container, opts) {
    root = container;
    onExportJson = opts.onExportJson;
    onGotoCodexEntry = opts.onGotoCodexEntry;
    // Delegação ligada uma vez (o corpo é recriado a cada render).
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-goto-entry]');
      if (el && onGotoCodexEntry) onGotoCodexEntry(el.getAttribute('data-goto-entry'));
    });
    currentProjectId = opts.projectId || null;
    root.innerHTML =
      '<section id="saude" class="builder-section">' +
      '  <div class="mb-8 text-center">' +
      '    <div class="hero-badge">' + GDC.icon('activity', { size: 14, className: 'text-emerald-400' }) + 'Visão geral</div>' +
      '    <h2 class="font-display text-3xl font-bold text-primary">Saúde do Projeto</h2>' +
      '    <p class="mt-2 text-secondary">Um retrato rápido de onde seu projeto está — progresso do GDC/GDD, marcos do Kanban e o uso de armazenamento das imagens do projeto.</p>' +
      '  </div>' +
      '  <div id="gdc-health-body"></div>' +
      '  <div class="tab-help-note">' + GDC.icon('info', { size: 16 }) +
      '    <p><strong>Como funciona:</strong> os números aqui vêm direto do que você já preencheu — fichas do GDC/GDD e tarefas/marcos do Kanban e, no Codex, os tipos que têm um seletor "Status" (o que estiver como Proposta, A definir, A criar etc. aparece como em aberto). "O que trabalhar agora?" ranqueia suas tarefas pendentes por prioridade, andamento e proximidade de fechar um marco, e mostra o motivo de cada recomendação. Como o projeto vive só neste navegador por enquanto, esta aba também avisa quando seu backup em JSON está desatualizado, e quando sobram imagens (do Codex, Notas ou Mural) sem uso em lugar nenhum ocupando espaço.</p>' +
      '  </div>' +
      '</section>';
    render(opts.doc);
  }

  function update(doc) {
    if (root) render(doc);
  }

  GDC.ui.health = { mount: mount, update: update, refreshNotifyDot: refreshNotifyDot };
}(window));
