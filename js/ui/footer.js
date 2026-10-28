/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  function mount(container) {
    container.innerHTML =
      '<footer class="app-footer">' +
      '  <div class="row">' +
      '    <div class="flex items-center gap-2">' +
      '      <div class="gdc-logo-grid small surface-2">' +
      '        <span class="h-2 w-2 bg-amber-400"></span>' +
      '        <span class="h-2 w-2 bg-emerald-400"></span>' +
      '        <span class="h-2 w-2 bg-pink-400"></span>' +
      '        <span class="h-2 w-2 bg-blue-400"></span>' +
      '      </div>' +
      '      <span class="font-display text-sm font-bold text-primary">Waypoint</span>' +
      '      <span class="text-sm text-muted">— Indie devs tools</span>' +
      '    </div>' +
      '    <p class="text-xs text-muted">Ferramenta local para desenvolvedores indie.</p>' +
      '  </div>' +
      // Antes ficava no topo da página (logo abaixo do cabeçalho); movido pra cá a pedido do Renato —
      // vira um rodapé da página como um todo, em vez de ocupar espaço logo no primeiro contato.
      '  <p class="page-subline">Um construtor estruturado com templates de gênero, preview em tempo real e ferramentas para desenvolvimento de jogos.</p>' +
      '</footer>';
  }

  GDC.ui.footer = { mount: mount };
}(window));
