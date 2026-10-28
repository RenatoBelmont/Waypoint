/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};

  // Conjunto compacto de ícones outline 24x24 (estilo "stroke", inspirado em lucide),
  // desenhados à mão para remover a dependência de lucide-react.
  var PATHS = {
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 19h14"/>',
    upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 19h14"/>',
    'file-json': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15c-.6 0-1 .4-1 1s.4 1 1 1"/><path d="M15 15c.6 0 1 .4 1 1s-.4 1-1 1"/>',
    'align-left': '<line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/>',
    'align-center': '<line x1="21" y1="6" x2="3" y2="6"/><line x1="17" y1="12" x2="7" y2="12"/><line x1="19" y1="18" x2="5" y2="18"/>',
    'align-right': '<line x1="21" y1="6" x2="3" y2="6"/><line x1="21" y1="12" x2="9" y2="12"/><line x1="21" y1="18" x2="7" y2="18"/>',
    'help-circle': '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    'layout-grid': '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    'alert-circle': '<circle cx="12" cy="12" r="10"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    'arrow-up-down': '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    'git-commit-vertical': '<path d="M12 3v6"/><circle cx="12" cy="12" r="3"/><path d="M12 15v6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'mouse-pointer-2': '<path d="M4.04 4.65a.5.5 0 0 1 .61-.61l15.48 5.77a.5.5 0 0 1-.06.95l-6.23 1.56a1 1 0 0 0-.73.73l-1.56 6.23a.5.5 0 0 1-.95.06z"/>',
    stamp: '<path d="M5 22h14"/><path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3c-1.66 0-3 1-3 3s1 2 1 3.5V13"/>',
    'circle-dot': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
    paintbrush: '<path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15"/>',
    'paint-bucket': '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z"/>',
    'copy-plus': '<line x1="15" x2="15" y1="12" y2="18"/><line x1="12" x2="18" y1="15" y2="15"/><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    'spray-can': '<path d="M3 3h.01"/><path d="M7 5h.01"/><path d="M11 7h.01"/><path d="M3 7h.01"/><path d="M7 9h.01"/><path d="M3 11h.01"/><rect width="4" height="4" x="15" y="5"/><path d="m19 9 2 2v10c0 .6-.4 1-1 1h-6c-.6 0-1-.4-1-1V11l2-2"/><path d="m13 14 8-2"/><path d="m13 19 8-2"/>',
    'lock-open': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    'settings-2': '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    'loader-2': '<path d="M21 12a9 9 0 1 1-6.2-8.5"/>',
    'cloud-off': '<path d="M5 5 19 19"/><path d="M9.5 5.5A5 5 0 0 1 18 9.5c1.7.2 3 1.7 3 3.4a3.6 3.6 0 0 1-.9 2.4"/><path d="M4.4 8.3A4.5 4.5 0 0 0 7 17h9"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v1"/><path d="M12 20v1"/><path d="M4.2 4.2l.7.7"/><path d="M19.1 19.1l.7.7"/><path d="M3 12h1"/><path d="M20 12h1"/><path d="M4.2 19.8l.7-.7"/><path d="M19.1 4.9l.7-.7"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    'file-down': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 12v6"/><path d="m9.5 15.5 2.5 2.5 2.5-2.5"/>',
    sparkles: '<path d="M9.9 2.6 11 6l3.4 1.1L11 8.3 9.9 11.7 8.8 8.3 5.4 7.1 8.8 6z"/><path d="M18.5 13 19.3 15.4 21.7 16.2 19.3 17 18.5 19.4 17.7 17 15.3 16.2 17.7 15.4z"/>',
    map: '<path d="M3 6.5 9 4l6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5"/><path d="M15 6.5V20"/>',
    // Status de salvamento (header.js) — o Lucide 0.460 não tem nuvem com check, então este é próprio;
    // os outros três são fallback offline dos equivalentes do Lucide.
    'cloud-check': '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="m9.5 14 2 2 3.5-3.5"/>',
    'cloud-upload': '<path d="M12 13v8"/><path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="m8 17 4-4 4 4"/>',
    'cloud-alert': '<path d="M12 12v4"/><path d="M12 20h.01"/><path d="M17 18h.5a1 1 0 0 0 0-9h-1.8A7 7 0 1 0 7 17.7"/>',
    // Ferramentas da aba Mapas (levelPlanner.js)
    hand: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.4l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
    brush: '<path d="m9.1 11.9 8.5-8.5a2.1 2.1 0 0 1 3 3l-8.5 8.5"/><path d="M7 14c-1.7 0-3 1.3-3 3 0 1.3-1 2-2 2 1 1.5 3 2 4.5 2 2.5 0 4.5-2 4.5-4.5 0-1.4-1.1-2.5-2.5-2.5z"/>',
    eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>',
    door: '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.6v15.8a.6.6 0 0 1-.8.6L5 19V5.2a1 1 0 0 1 .8-1L12.2 3a.6.6 0 0 1 .8.6z"/>',
    'brick-wall': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 9v6"/><path d="M16 15v6"/><path d="M16 3v6"/><path d="M3 15h18"/><path d="M3 9h18"/><path d="M8 15v6"/><path d="M8 3v6"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    'map-pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    'zoom-in': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
    'zoom-out': '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
    'redo-2': '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5 5.5 5.5 0 0 0 9.5 20H13"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>',
    'panel-right': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
    'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h13l-3 5 3 5H5"/>',
    trello: '<rect x="3" y="4" width="18" height="16" rx="2"/><rect x="6" y="7" width="4" height="7"/><rect x="14" y="7" width="4" height="4"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    x: '<path d="m6 6 12 12"/><path d="m18 6-12 12"/>',
    'trash-2': '<path d="M4 7h16"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/><path d="M19 7l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    'grip-vertical': '<circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.6 4.9L3 17.4 5.6 20l6.2-6.2a4 4 0 0 0 4.9-5.6l-2.6 2.6-2-2z"/>',
    'trending-up': '<path d="m3 17 6-6 4 4 7-8"/><path d="M15 7h5v5"/>',
    dices: '<rect x="3" y="11" width="9" height="9" rx="2"/><circle cx="7.5" cy="15.5" r=".8"/><rect x="12" y="3" width="9" height="9" rx="2" transform="rotate(15 16.5 7.5)"/><circle cx="14.5" cy="6" r=".6"/><circle cx="18.5" cy="9" r=".6"/>',
    'alert-triangle': '<path d="M10.3 3.9 1.9 18a1 1 0 0 0 .9 1.5h18.4a1 1 0 0 0 .9-1.5L13.7 3.9a1 1 0 0 0-1.7 0Z"/><path d="M12 9v4"/><path d="M12 16.5h.01"/>',
    'refresh-cw': '<path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"/><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8"/><path d="M3 21v-5h5"/><path d="M21 3v5h-5"/>',
    'undo-2': '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    'link-2': '<path d="M15 7h2a5 5 0 0 1 0 10h-2"/><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M8 12h8"/>',
    'inbox': '<path d="M4 12h4l2 3h4l2-3h4"/><path d="M5.5 5h13l2.5 7v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7z"/>',
    pencil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/>',
    'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/><path d="M9 9h1"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-5"/><path d="M12 8h.01"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    rocket: '<path d="M12 2.5c2.6 2.2 4.2 5.7 4.2 9.2 0 2-1 3.9-2 5l-2.2 2.2-2.2-2.2c-1-1.1-2-3-2-5 0-3.5 1.6-7 4.2-9.2Z"/><circle cx="12" cy="10.5" r="1.4"/><path d="M9 15.5 7 20l4-2.3"/><path d="M15 15.5l2 4.5-4-2.3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.4 2.5 3.8 6 3.8 9s-1.4 6.5-3.8 9"/><path d="M12 3c-2.4 2.5-3.8 6-3.8 9s1.4 6.5 3.8 9"/>',
    box: '<path d="M20 7 12 3 4 7v10l8 4 8-4Z"/><path d="M4 7l8 4 8-4"/><path d="M12 11v10"/>',
    'share-2': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/>',
    sliders: '<path d="M4 6h6"/><circle cx="13" cy="6" r="2"/><path d="M17 6h3"/><path d="M4 12h9"/><circle cx="16" cy="12" r="2"/><path d="M4 18h4"/><circle cx="11" cy="18" r="2"/><path d="M15 18h5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    'maximize-2': '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>',
    'minimize-2': '<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>',
    'book-open': '<path d="M12 7v13"/><path d="M4 5c2 0 5 .6 8 2 3-1.4 6-2 8-2v12c-2 0-5 .6-8 2-3-1.4-6-2-8-2Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    'sticky-note': '<path d="M4 4h16v12l-4 4H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M20 16h-4v4"/>',
    'layout-dashboard': '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    bold: '<path d="M6 4h8a4 4 0 0 1 0 8H6z"/><path d="M6 12h9a4 4 0 0 1 0 8H6z"/>',
    italic: '<line x1="19" x2="10" y1="4" y2="4"/><line x1="14" x2="5" y1="20" y2="20"/><line x1="15" x2="9" y1="4" y2="20"/>',
    underline: '<path d="M6 4v6a6 6 0 0 0 12 0V4"/><line x1="4" x2="20" y1="20" y2="20"/>',
    list: '<line x1="9" x2="20" y1="6" y2="6"/><line x1="9" x2="20" y1="12" y2="12"/><line x1="9" x2="20" y1="18" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    type: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
    square: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
    diamond: '<path d="M12 2 22 12 12 22 2 12Z"/>',
    circle: '<circle cx="12" cy="12" r="9"/>',
    'arrow-up-right': '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
    palette: '<path d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.5 9 7.5 0 2-1.5 3.5-3.5 3.5h-1.8a2 2 0 0 0-1 3.7c.4.3.6.8.6 1.3 0 1.1-1 2-2.3 2Z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/><circle cx="8.5" cy="15" r="1"/>',
    'list-ordered': '<line x1="10" x2="21" y1="6" y2="6"/><line x1="10" x2="21" y1="12" y2="12"/><line x1="10" x2="21" y1="18" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
    minus: '<path d="M5 12h14"/>',
    filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
    tag: '<path d="M12.6 2.6a2 2 0 0 0-1.4-.6H4a2 2 0 0 0-2 2v7.2c0 .5.2 1 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    layers: '<path d="m12.8 2.2 8.6 3.9a1 1 0 0 1 0 1.8l-8.6 3.9a2 2 0 0 1-1.6 0L2.6 7.9a1 1 0 0 1 0-1.8l8.6-3.9a2 2 0 0 1 1.6 0Z"/><path d="m22 12.2-8.6 3.9a2 2 0 0 1-1.6 0L2.6 12.2"/><path d="m22 17.2-8.6 3.9a2 2 0 0 1-1.6 0L2.6 17.2"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18"/><path d="M17 3v18"/><path d="M3 7.5h4"/><path d="M17 7.5h4"/><path d="M3 16.5h4"/><path d="M17 16.5h4"/>',
    'gamepad-2': '<line x1="6" x2="10" y1="12" y2="12"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="15" x2="15.01" y1="13" y2="13"/><line x1="18" x2="18.01" y1="11" y2="11"/><path d="M17.3 5H6.7A4 4 0 0 0 2.7 8.6C2.6 9.4 2 14.5 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.4-1.4A2 2 0 0 1 9.8 16h4.3a2 2 0 0 1 1.4.6L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.5-.6-6.6-.7-7.3A4 4 0 0 0 17.3 5Z"/>',
    'volume-2': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    mountain: '<path d="m8 3 4 8 5-5 5 15H2L8 3Z"/>',
    smartphone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
    // ---- Mural: toolbar redesenhada (seleção, desenho livre, formas básicas, fluxograma, linhas) ----
    'mouse-pointer': '<path d="m4 4 7.07 17 2.51-7.39L21 11.07Z"/>',
    'select-area': '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="4 3.2"/>',
    highlighter: '<path d="m9 11-6 6v3h3l6-6"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    triangle: '<path d="M12 3 22.4 21H1.6Z"/>',
    star: '<path d="M12 2.5 15 9l7 1-5.2 4.8L18.2 22 12 18.3 5.8 22l1.4-7.2L2 10l7-1Z"/>',
    pentagon: '<path d="M12 2 22 9.4 18.2 21H5.8L2 9.4Z"/>',
    hexagon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>',
    shapes: '<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
    workflow: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v3a2 2 0 0 0 2 2h6"/><rect width="8" height="8" x="13" y="14" rx="2"/>',
    'dashed-line': '<path d="M3 12h3.2"/><path d="M9.9 12h3.2"/><path d="M16.8 12h3.2"/>',
    crosshair: '<circle cx="12" cy="12" r="9"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/>',
  };

  /**
   * Retorna a marcação SVG de um ícone.
   * @param {string} name chave em PATHS
   * @param {Object} [opts] { size, className, spin }
   */
  // Ícones vêm do Lucide (CDN, ver index.html) quando ele carregou — são ~1700 ícones, então
  // qualquer nome novo já funciona sem desenhar nada à mão (antes, um nome esquecido aqui virava um
  // quadrado vazio no botão — aconteceu várias vezes). PATHS acima fica como fallback offline e pros
  // poucos desenhos próprios que o Lucide não tem (select-area, dashed-line, door).
  var lucideCache = {};
  function pascal(name) { return name.split('-').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(''); }
  function nodeToSvg(node) {
    var attrs = Object.keys(node[1] || {}).map(function (k) { return k + '="' + node[1][k] + '"'; }).join(' ');
    return '<' + node[0] + ' ' + attrs + '/>';
  }
  function lucideBody(name) {
    if (lucideCache[name] !== undefined) return lucideCache[name];
    var L = global.lucide;
    var node = L && L.icons && L.icons[pascal(name)];
    // formato do UMD: ['svg', attrs, [[tag, attrs], ...]]
    var children = node && Array.isArray(node[2]) ? node[2] : null;
    lucideCache[name] = children ? children.map(nodeToSvg).join('') : null;
    return lucideCache[name];
  }
  var warned = {};

  function icon(name, opts) {
    opts = opts || {};
    var size = opts.size || 16;
    var cls = 'icon' + (opts.className ? ' ' + opts.className : '') + (opts.spin ? ' animate-spin' : '');
    var body = PATHS[name] && !global.lucide ? PATHS[name] : (lucideBody(name) || PATHS[name] || '');
    if (!body && !warned[name]) { warned[name] = true; if (global.console) console.warn('[Waypoint] ícone inexistente: ' + name); }
    return '<svg class="' + cls + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" ' +
      'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + body + '</svg>';
  }

  GDC.icon = icon;
}(window));
