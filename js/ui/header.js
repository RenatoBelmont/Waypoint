/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var statusEl, themeBtn, currentTheme;
  var onToggleTheme, onGotoProjects;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Só o ícone de nuvem fica visível; o texto expande ao passar o mouse (ou focar com Tab) — pedido do
  // Renato. Exceção: "Falha ao salvar" fica sempre aberto, porque é um aviso que não pode passar batido.
  var STATUS = {
    saving: { icon: 'cloud-upload', text: 'Salvando...' },
    saved: { icon: 'cloud-check', text: 'Alterações salvas localmente' },
    error: { icon: 'cloud-alert', text: 'Falha ao salvar' },
    idle: { icon: 'cloud-off', text: 'Alterações não salvas' },
  };
  function statusMarkup(status) {
    var st = STATUS[status] || STATUS.idle;
    var key = STATUS[status] ? status : 'idle';
    return '<span class="status-badge ' + key + '" tabindex="0" title="' + st.text + '" aria-label="' + st.text + '">' +
      GDC.icon(st.icon, { size: 15 }) + '<span class="status-badge-text">' + st.text + '</span></span>';
  }

  function mount(container, opts) {
    currentTheme = opts.theme;
    onToggleTheme = opts.onToggleTheme;
    onGotoProjects = opts.onGotoProjects;
    var tabsHtml = opts.tabsHtml || '';
    // Subtítulo mostra o nome do projeto aberto no lugar do texto genérico, quando disponível —
    // ajuda a não confundir qual projeto está ativo quando existe mais de um salvo no navegador.
    var subtitle = opts.projectName ? escapeHtml(opts.projectName) : 'Indie devs tools';

    // Mesmo padrão do 3D Workbench (pedido do Renato, pra os sistemas dele compartilharem um layout):
    // linha 1 = identidade grande (ícone + nome + projeto aberto) à esquerda e ações à direita;
    // linha 2 = faixa de abas ocupando a largura toda, distribuídas por igual, ícone sobre o rótulo.
    // Só a faixa de abas fica presa no topo ao rolar (ver stickToTabs abaixo).
    container.innerHTML =
      '<header class="app-header">' +
      '  <div class="row header-top">' +
      '    <div class="header-brand">' +
      '      <div class="gdc-logo-grid header-logo surface-2">' +
      '        <span class="bg-amber-400"></span><span class="bg-emerald-400"></span>' +
      '        <span class="bg-pink-400"></span><span class="bg-blue-400"></span>' +
      '      </div>' +
      '      <div class="min-w-0">' +
      '        <h1 class="header-title font-display">Waypoint</h1>' +
      '        <p class="header-subtitle">' + subtitle + '</p>' +
      '      </div>' +
      '    </div>' +
      '    <div class="header-actions">' +
      (onGotoProjects ? '      <button type="button" id="gdc-goto-projects" class="btn-ghost py-2 text-xs" title="Ver todos os projetos salvos neste navegador">' + GDC.icon('box', { size: 14 }) + 'Projetos</button>' : '') +
      '      <span id="gdc-save-status">' + statusMarkup('idle') + '</span>' +
      '      <button type="button" id="gdc-theme-toggle" class="btn-ghost h-9 w-9 p-0" aria-label="Alternar tema"></button>' +
      '    </div>' +
      '  </div>' +
      (tabsHtml ? '  <div class="row header-nav">' + tabsHtml + '</div>' : '') +
      '</header>';

    stickToTabs(container.querySelector('.app-header'));

    statusEl = container.querySelector('#gdc-save-status');
    themeBtn = container.querySelector('#gdc-theme-toggle');
    renderThemeButton();

    themeBtn.addEventListener('click', function () {
      if (onToggleTheme) onToggleTheme();
    });

    var projectsBtn = container.querySelector('#gdc-goto-projects');
    if (projectsBtn) projectsBtn.addEventListener('click', function () {
      if (onGotoProjects) onGotoProjects();
    });
  }

  /** O cabeçalho inteiro é sticky com `top` NEGATIVO igual à altura da linha de identidade: ao rolar,
   *  essa linha sai da tela e a faixa de abas fica presa no topo (sticky num filho não funcionaria —
   *  ele só gruda dentro da caixa do próprio pai, o header, que rola junto). */
  function stickToTabs(headerEl) {
    var top = headerEl && headerEl.querySelector('.header-top');
    if (!top || !headerEl.querySelector('.header-nav')) return;
    var apply = function () { headerEl.style.top = -top.offsetHeight + 'px'; };
    apply();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(apply).observe(top);
    else global.addEventListener('resize', apply);
  }

  function renderThemeButton() {
    themeBtn.title = currentTheme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro';
    themeBtn.innerHTML = currentTheme === 'dark' ? GDC.icon('sun', { size: 16 }) : GDC.icon('moon', { size: 16 });
  }

  function setTheme(theme) {
    currentTheme = theme;
    if (themeBtn) renderThemeButton();
  }

  function setStatus(status) {
    if (statusEl) statusEl.innerHTML = statusMarkup(status);
  }

  GDC.ui.header = { mount: mount, setStatus: setStatus, setTheme: setTheme };
}(window));
