/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  // ---------------------------------------------------------------------------------------------
  // Confirmação antes de importar um JSON/backup. Importar SUBSTITUI o projeto aberto inteiro (não
  // junta), então quem troca de computador precisa ver o que está prestes a acontecer: de quando é o
  // arquivo, se ele é mais velho que o que já existe aqui, se traz as imagens. E pode, em vez de
  // substituir, importar como um projeto novo (nada se perde).
  // ---------------------------------------------------------------------------------------------

  var overlayEl = null;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function fmt(ts) {
    if (!ts) return null;
    var d = new Date(ts);
    return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  function close() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape' && overlayEl) { e.preventDefault(); e.stopPropagation(); close(); } }

  /** Pura (testável): avisos a mostrar. info = { fileTitle, exportedAt, fileType, mediaCount, referencedImages,
   *  localTitle, localUpdatedAt, localType, localHasContent } */
  function analyze(info) {
    var w = [];
    if (info.exportedAt && info.localUpdatedAt && info.localHasContent && info.exportedAt < info.localUpdatedAt - 60000) {
      w.push({ level: 'danger', text: 'O arquivo é MAIS ANTIGO que a última alteração deste projeto neste computador (' + fmt(info.localUpdatedAt) + '). Substituir descarta o que foi feito aqui depois disso.' });
    }
    if (!info.exportedAt) w.push({ level: 'warn', text: 'Arquivo sem data (exportado por uma versão anterior do app) — confira se é o mais recente.' });
    if (!info.mediaCount && info.referencedImages) {
      w.push({ level: 'warn', text: 'O arquivo não traz imagens (é um "Exportar JSON", não um "Backup completo"). As ' + info.referencedImages + ' imagem(ns) do projeto só aparecem se já existirem neste navegador.' });
    }
    if (info.fileType && info.localType && info.fileType !== info.localType) {
      w.push({ level: 'warn', text: 'O arquivo é de outro tipo de projeto. Ao substituir, ele vira o tipo deste projeto — prefira "Importar como novo projeto".' });
    }
    return w;
  }

  /** opts: { info (ver analyze), onReplace(), onNew() } */
  function open(opts) {
    close();
    var info = opts.info, warns = analyze(info);
    var danger = warns.some(function (x) { return x.level === 'danger'; });
    var row = function (label, value) { return '<div class="bi-row"><span>' + label + '</span><strong>' + value + '</strong></div>'; };
    overlayEl = document.createElement('div');
    overlayEl.className = 'kanban-modal-overlay';
    overlayEl.innerHTML =
      '<div class="kanban-modal-panel bi-panel card-surface" role="dialog" aria-modal="true" aria-label="Importar projeto">' +
      '  <div class="kanban-modal-header">' +
      '    <div class="min-w-0"><h3 class="font-display text-base font-bold text-primary">Importar projeto</h3>' +
      '    <p class="text-xs text-muted">Substituir troca TODO o conteúdo do projeto aberto pelo do arquivo — não junta os dois.</p></div>' +
      '    <button type="button" class="kanban-icon-btn" data-bi="close" title="Fechar">' + GDC.icon('x', { size: 16 }) + '</button>' +
      '  </div>' +
      '  <div class="kanban-modal-body bi-body">' +
      '    <div class="bi-cols">' +
      '      <div class="bi-box"><p class="bi-box-title">' + GDC.icon('file-down', { size: 13 }) + 'Arquivo</p>' +
      row('Projeto', escapeHtml(info.fileTitle || '(sem título)')) +
      row('Exportado em', fmt(info.exportedAt) || 'sem data') +
      row('Imagens', info.mediaCount ? String(info.mediaCount) : 'nenhuma') + '</div>' +
      '      <div class="bi-box"><p class="bi-box-title">' + GDC.icon('monitor', { size: 13 }) + 'Neste computador</p>' +
      row('Projeto', escapeHtml(info.localTitle || '(sem título)')) +
      row('Última alteração', info.localHasContent ? (fmt(info.localUpdatedAt) || '—') : 'projeto vazio') + '</div>' +
      '    </div>' +
      (warns.length ? '<ul class="bi-warns">' + warns.map(function (x) { return '<li class="bi-warn bi-warn-' + x.level + '">' + GDC.icon(x.level === 'danger' ? 'alert-triangle' : 'info', { size: 14 }) + '<span>' + escapeHtml(x.text) + '</span></li>'; }).join('') + '</ul>' : '') +
      '  </div>' +
      '  <div class="kanban-modal-footer">' +
      '    <button type="button" class="btn-ghost py-2 text-xs" data-bi="close">Cancelar</button>' +
      '    <button type="button" class="btn-ghost py-2 text-xs" data-bi="new">' + GDC.icon('copy-plus', { size: 13 }) + 'Importar como novo projeto</button>' +
      '    <button type="button" class="' + (danger ? 'btn-ghost bi-danger' : 'btn-primary') + ' py-2 text-xs" data-bi="replace">' + GDC.icon('upload', { size: 13 }) + 'Substituir este projeto</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(overlayEl);
    document.addEventListener('keydown', onKey, true);
    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) { close(); return; }
      var b = e.target.closest('[data-bi]'); if (!b) return;
      var a = b.getAttribute('data-bi');
      if (a === 'close') { close(); return; }
      if (a === 'replace') {
        if (danger && !global.confirm('O arquivo é mais antigo que o que está neste computador. Substituir mesmo assim?')) return;
        close(); opts.onReplace(); return;
      }
      if (a === 'new') { close(); opts.onNew(); }
    });
    return true;
  }

  GDC.ui.backupImport = { open: open, close: close, analyze: analyze };
}(window));
