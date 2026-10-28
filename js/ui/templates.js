/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var root, gridEl, onSelect, activeTemplate, projectType;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cardMarkup(t) {
    var isActive = activeTemplate === t.name;
    return (
      '<button type="button" class="template-card card-surface' + (isActive ? ' btn-ghost-active' : '') + '" data-template="' + escapeHtml(t.name) + '">' +
      '  <div class="template-glow" style="background-color:' + t.color + '"></div>' +
      '  <div class="relative">' +
      '    <span class="mb-3 inline-block rounded-md px-2 py-0.5 font-semibold uppercase tracking-wide" style="font-size:11px;background-color:' + t.color + '20;color:' + t.color + '">' + escapeHtml(t.category) + '</span>' +
      '    <h3 class="font-display text-lg font-bold text-primary">' + escapeHtml(t.name) + '</h3>' +
      (isActive
        ? '    <span class="mt-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-500"><span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>Ativo</span>'
        : '') +
      '  </div>' +
      '</button>'
    );
  }

  function renderGrid() {
    gridEl.innerHTML = GDC.templatesFor(projectType).map(cardMarkup).join('');
    gridEl.querySelectorAll('[data-template]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-template');
        var template = GDC.templatesFor(projectType).filter(function (t) { return t.name === name; })[0];
        if (template && onSelect) onSelect(template);
      });
    });
  }

  function mount(container, opts) {
    root = container;
    onSelect = opts.onSelect;
    projectType = opts.projectType;
    activeTemplate = opts.activeTemplate || null;

    root.innerHTML =
      '<section id="templates" class="templates-embedded">' +
      '  <div class="mb-4">' +
      '    <h2 class="font-display text-lg font-bold text-primary">Comece com um template de gênero</h2>' +
      '    <p class="mt-1 text-sm text-secondary">Escolha um ponto de partida — o GDC é preenchido com uma estrutura inicial.</p>' +
      '  </div>' +
      '  <div class="template-grid" id="gdc-template-grid"></div>' +
      '</section>';

    gridEl = root.querySelector('#gdc-template-grid');
    renderGrid();
  }

  function setActive(name) {
    activeTemplate = name;
    renderGrid();
  }

  GDC.ui.templates = { mount: mount, setActive: setActive };
}(window));
