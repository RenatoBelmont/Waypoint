/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var root, bodyEl, copyBtn, downloadBtn, copyTimer, downloadTimer;
  var currentDoc;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hasContent(doc) {
    if (doc.title.trim().length > 0) return true;
    return GDC.groupsFor(doc).some(function (g) {
      return g.sectionIds.some(function (id) { return (doc.sections[id] || '').trim().length > 0; });
    });
  }

  function bodyMarkup(doc) {
    if (!hasContent(doc)) {
      return (
        '<div class="preview-empty">' +
        '  <div class="mb-4 gdc-logo-grid surface-2">' +
        '    <span class="h-6 w-6 bg-amber-400/20"></span>' +
        '    <span class="h-6 w-6 bg-emerald-400/20"></span>' +
        '    <span class="h-6 w-6 bg-pink-400/20"></span>' +
        '    <span class="h-6 w-6 bg-blue-400/20"></span>' +
        '  </div>' +
        '  <p class="font-display text-base font-semibold text-secondary">Seu GDD vai aparecer aqui</p>' +
        '  <p class="mt-1 text-sm text-muted">Preencha uma ficha ao lado — o GDD atualiza em tempo real.</p>' +
        '</div>'
      );
    }

    var groupsHtml = GDC.groupsFor(doc).map(function (group) {
      var filled = group.sectionIds.filter(function (id) { return (doc.sections[id] || '').trim().length > 0; });
      if (filled.length === 0) return '';
      var sectionsHtml = filled.map(function (id) {
        var meta = GDC.sectionMapFor(doc)[id];
        return (
          '<div class="animate-fade-in">' +
          '  <h3 class="mb-1.5 font-display text-sm font-semibold text-secondary">' + escapeHtml(meta.label) + '</h3>' +
          GDC.renderMarkdown(doc.sections[id].trim(), 'text-sm leading-relaxed text-secondary') +
          '</div>'
        );
      }).join('');
      return (
        '<div class="gdd-group-stack">' +
        '  <p class="text-xs font-semibold uppercase tracking-wider text-muted">' + escapeHtml(group.label) + '</p>' +
        sectionsHtml +
        '</div>'
      );
    }).join('');

    return (
      '<article class="space-y-7">' +
      '  <div>' +
      '    <p class="text-xs font-semibold uppercase tracking-wider text-muted">GDD — Game Design Document</p>' +
      '    <h2 class="mt-1 font-display text-2xl font-bold text-primary">' + escapeHtml(doc.title.trim() || 'Jogo sem título') + '</h2>' +
      '  </div>' +
      groupsHtml +
      '</article>'
    );
  }

  function mount(container) {
    root = container;
    root.innerHTML =
      '<div class="card-surface preview-panel">' +
      '  <div class="preview-header">' +
      '    <div class="flex items-center gap-2">' +
      '      <div class="preview-dots">' +
      '        <span class="bg-rose-500/60"></span>' +
      '        <span class="bg-amber-500/60"></span>' +
      '        <span class="bg-emerald-500/60"></span>' +
      '      </div>' +
      '      <h3 class="ml-2 font-display text-sm font-semibold text-primary">GDD gerado</h3>' +
      '    </div>' +
      '    <div class="flex items-center gap-2">' +
      '      <button type="button" id="gdc-preview-copy" class="btn-ghost px-3 py-1.5 text-xs" title="Copiar como Markdown"></button>' +
      '      <button type="button" id="gdc-preview-download" class="btn-ghost px-3 py-1.5 text-xs" title="Baixar como Markdown"></button>' +
      '    </div>' +
      '  </div>' +
      '  <div class="preview-body" id="gdc-preview-body"></div>' +
      '</div>';

    bodyEl = root.querySelector('#gdc-preview-body');
    copyBtn = root.querySelector('#gdc-preview-copy');
    downloadBtn = root.querySelector('#gdc-preview-download');

    renderCopyBtn(false);
    renderDownloadBtn(false);

    copyBtn.addEventListener('click', function () {
      if (!currentDoc) return;
      var md = GDC.buildMarkdown(currentDoc);
      var done = function () {
        renderCopyBtn(true);
        clearTimeout(copyTimer);
        copyTimer = setTimeout(function () { renderCopyBtn(false); }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(done).catch(function () {
          fallbackCopy(md);
          done();
        });
      } else {
        fallbackCopy(md);
        done();
      }
    });

    downloadBtn.addEventListener('click', function () {
      if (!currentDoc) return;
      var md = GDC.buildMarkdown(currentDoc);
      GDC.downloadBlob(md, 'text/markdown', (currentDoc.title.trim() || 'gdc-documento') + '.md');
      renderDownloadBtn(true);
      clearTimeout(downloadTimer);
      downloadTimer = setTimeout(function () { renderDownloadBtn(false); }, 2000);
    });
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function renderCopyBtn(copied) {
    copyBtn.innerHTML = (copied
      ? GDC.icon('check', { size: 14, className: 'text-emerald-500' })
      : GDC.icon('copy', { size: 14 })) + (copied ? 'Copiado' : 'Copiar');
  }

  function renderDownloadBtn(downloaded) {
    downloadBtn.innerHTML = (downloaded
      ? GDC.icon('check', { size: 14, className: 'text-emerald-500' })
      : GDC.icon('file-down', { size: 14 })) + (downloaded ? 'Baixado' : '.md');
  }

  function update(doc) {
    currentDoc = doc;
    if (bodyEl) bodyEl.innerHTML = bodyMarkup(doc);
  }

  GDC.ui.preview = { mount: mount, update: update };
}(window));
