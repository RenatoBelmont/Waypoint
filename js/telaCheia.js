/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};

  // ---------------------------------------------------------------------------------------------
  // Tela cheia padrão do Waypoint — a MESMA em todas as ferramentas (Mural, Habilidades, Mapas,
  // Designer de Cartas). É "tela cheia dentro da página": o palco da ferramenta passa a cobrir a
  // janela inteira (position:fixed), sem acionar o modo tela cheia do navegador (F11 / Fullscreen API).
  // Decisão do Renato, a partir do comportamento da aba Mapas. De brinde, elimina a classe de bugs da
  // API nativa: só descendentes do elemento em fullscreen são renderizados (popovers anexados no body
  // sumiam), CSS de :fullscreen/:-webkit-full-screen divergente entre navegadores (bug real do
  // Firefox) etc.
  //
  // Uso:  GDC.fullscreen.toggle(stageEl)
  //       stageEl.addEventListener('wpfullscreenchange', function (e) { e.detail.active ... })
  // Esc sai — mas só se nenhuma ferramenta já tratou o Esc antes (fechar menu, desselecionar...):
  // as ferramentas escutam no `document`, e este módulo no `window`, que recebe o evento DEPOIS
  // (fase de bolha); quem consome o Esc chama preventDefault() e a tela cheia continua.
  // ---------------------------------------------------------------------------------------------

  var current = null;

  function emit(el, active) {
    var ev;
    try { ev = new CustomEvent('wpfullscreenchange', { detail: { active: active } }); }
    catch (e) { ev = document.createEvent('CustomEvent'); ev.initCustomEvent('wpfullscreenchange', false, false, { active: active }); }
    el.dispatchEvent(ev);
    // Ferramentas com canvas/SVG dimensionado por ResizeObserver já se ajustam sozinhas; as demais
    // ouvem o resize normal da janela.
    global.dispatchEvent(new Event('resize'));
  }

  // position:fixed deixa de ser relativo à JANELA quando algum ancestral tem transform, filter,
  // backdrop-filter, perspective ou contain — aí o "fixo" fica preso dentro daquele ancestral (bug
  // real: o Designer de Cartas mora dentro de um .card-surface com backdrop-filter e a tela cheia
  // ocupava só o card). Neutraliza isso nos ancestrais enquanto a tela cheia estiver ativa.
  var trapped = [];
  function releaseAncestors(el) {
    for (var a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      var cs = global.getComputedStyle(a);
      var bf = cs.backdropFilter || cs.webkitBackdropFilter;
      if ((cs.transform && cs.transform !== 'none') || (cs.filter && cs.filter !== 'none') || (bf && bf !== 'none') ||
          (cs.perspective && cs.perspective !== 'none') || /paint|layout|strict|content/.test(cs.contain || '')) {
        a.classList.add('wp-fs-ancestor');
        trapped.push(a);
      }
    }
  }
  function restoreAncestors() {
    trapped.forEach(function (a) { a.classList.remove('wp-fs-ancestor'); });
    trapped = [];
  }

  function enter(el) {
    if (!el || current === el) return;
    if (current) exit();
    current = el;
    releaseAncestors(el);
    el.classList.add('wp-fullscreen');
    document.documentElement.classList.add('wp-fs-lock');
    emit(el, true);
  }

  function exit() {
    if (!current) return;
    var el = current;
    current = null;
    el.classList.remove('wp-fullscreen');
    restoreAncestors();
    document.documentElement.classList.remove('wp-fs-lock');
    emit(el, false);
  }

  function toggle(el) { if (current === el) exit(); else enter(el); }
  function isActive(el) { return el ? current === el : !!current; }

  /** Markup padrão do botão (mesmo ícone/título em todas as ferramentas). `cls` = classe de botão da
   *  barra da ferramenta (cada uma tem a sua, mas o conteúdo é sempre igual). */
  function buttonMarkup(cls, active, extraAttrs) {
    var label = active ? 'Sair da tela cheia (Esc)' : 'Tela cheia';
    return '<button type="button" class="' + cls + (active ? ' wp-btn-on' : '') + '" ' + (extraAttrs || '') +
      ' title="' + label + '" aria-label="' + label + '">' + GDC.icon(active ? 'minimize-2' : 'maximize-2', { size: 15 }) + '</button>';
  }

  global.addEventListener('keydown', function (e) {
    if (!current || e.key !== 'Escape' || e.defaultPrevented) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    // um modal aberto (fica fora do palco, por cima dele) tem prioridade sobre a tela cheia
    if (document.querySelector('.kanban-modal-overlay, .card-designer-modal-overlay, .skilltree-modal-overlay')) return;
    exit();
  });

  GDC.fullscreen = { enter: enter, exit: exit, toggle: toggle, isActive: isActive, buttonMarkup: buttonMarkup };
}(window));
