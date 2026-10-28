/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var root, onOpen, onCreate, onRename, onDelete, onToggleTheme;
  var creating = false;
  var currentTheme = 'dark';
  var viewMode = 'grid';

  var VIEW_MODE_KEY = 'gdc:projectsViewMode';

  function readStoredViewMode() {
    try {
      var v = localStorage.getItem(VIEW_MODE_KEY);
      return (v === 'list' || v === 'grid') ? v : 'grid';
    } catch (e) {
      return 'grid';
    }
  }

  function persistViewMode(v) {
    try { localStorage.setItem(VIEW_MODE_KEY, v); } catch (e) { /* ignore */ }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function typeMeta(type) {
    return (GDC.PROJECT_TYPES || []).filter(function (t) { return t.id === type; })[0] ||
      { id: type, label: type, icon: 'box' };
  }

  function fmtDate(ts) {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  function projectCardMarkup(p) {
    var meta = typeMeta(p.type);
    return (
      '<div class="card-surface project-card">' +
      '  <button type="button" class="project-card-open" data-open-project="' + p.id + '">' +
      '    <h3 class="font-display text-base font-bold text-primary">' + escapeHtml(p.name) + '</h3>' +
      '    <span class="project-type-badge">' + GDC.icon(meta.icon, { size: 12 }) + escapeHtml(meta.label) + '</span>' +
      '    <p class="text-xs text-muted">Atualizado em ' + fmtDate(p.updatedAt) + '</p>' +
      '  </button>' +
      '  <div class="project-card-actions">' +
      '    <button type="button" class="btn-ghost h-8 w-8 p-0" data-rename-project="' + p.id + '" title="Renomear">' + GDC.icon('pencil', { size: 14 }) + '</button>' +
      '    <button type="button" class="btn-ghost h-8 w-8 p-0" data-delete-project="' + p.id + '" title="Excluir">' + GDC.icon('trash-2', { size: 14 }) + '</button>' +
      '  </div>' +
      '</div>'
    );
  }

  function projectListRowMarkup(p) {
    var meta = typeMeta(p.type);
    return (
      '<div class="card-surface project-list-row">' +
      '  <button type="button" class="project-list-row-open" data-open-project="' + p.id + '">' +
      '    <span class="project-type-badge">' + GDC.icon(meta.icon, { size: 12 }) + escapeHtml(meta.label) + '</span>' +
      '    <span class="font-display text-sm font-bold text-primary min-w-0 flex-1 truncate">' + escapeHtml(p.name) + '</span>' +
      '    <span class="text-xs text-muted flex-shrink-0">Atualizado em ' + fmtDate(p.updatedAt) + '</span>' +
      '  </button>' +
      '  <div class="project-card-actions project-list-row-actions">' +
      '    <button type="button" class="btn-ghost h-8 w-8 p-0" data-rename-project="' + p.id + '" title="Renomear">' + GDC.icon('pencil', { size: 14 }) + '</button>' +
      '    <button type="button" class="btn-ghost h-8 w-8 p-0" data-delete-project="' + p.id + '" title="Excluir">' + GDC.icon('trash-2', { size: 14 }) + '</button>' +
      '  </div>' +
      '</div>'
    );
  }
  function newProjectFormMarkup() {
    var typeOptions = (GDC.PROJECT_TYPES || []).map(function (t) {
      return '<option value="' + t.id + '">' + escapeHtml(t.label) + '</option>';
    }).join('');
    return (
      '<div class="card-surface project-new-form">' +
      '  <h3 class="font-display text-sm font-bold text-primary">Novo projeto</h3>' +
      '  <div class="project-new-row">' +
      '    <label class="project-new-field project-new-name"><span>Nome</span>' +
      '      <input type="text" id="proj-new-name" class="input-field" placeholder="Nome do projeto" />' +
      '    </label>' +
      '    <label class="project-new-field"><span>Tipo</span>' +
      '      <select id="proj-new-type" class="input-field">' + typeOptions + '</select>' +
      '    </label>' +
      '    <div class="project-new-actions">' +
      '      <button type="button" id="proj-new-confirm" class="btn-primary text-xs">' + GDC.icon('plus', { size: 14 }) + 'Criar</button>' +
      '      <button type="button" id="proj-new-cancel" class="btn-ghost text-xs">Cancelar</button>' +
      '    </div>' +
      '  </div>' +
      '</div>'
    );
  }

  function render() {
    var projects = GDC.listProjects ? GDC.listProjects() : [];
    // Lista vazia (seja no primeiro uso, seja depois de excluir o último projeto) sempre mostra o
    // formulário de criação direto — não faz sentido exigir um clique extra pra sair de uma tela
    // sem nada pra listar.
    if (!projects.length) creating = true;
    var listHtml = '';
    if (projects.length) {
      listHtml = viewMode === 'list'
        ? '<div class="projects-list">' + projects.map(projectListRowMarkup).join('') + '</div>'
        : '<div class="projects-grid">' + projects.map(projectCardMarkup).join('') + '</div>';
    } else {
      listHtml = '<p class="health-empty">' + (creating ? 'Nenhum projeto ainda — preencha o formulário acima.' : 'Nenhum projeto ainda — crie o primeiro em "Novo projeto", acima.') + '</p>';
    }

    var themeBtnHtml = onToggleTheme
      ? '<button type="button" id="proj-theme-toggle" class="btn-ghost h-9 w-9 p-0 projects-theme-toggle" aria-label="Alternar tema">' +
        (currentTheme === 'dark' ? GDC.icon('sun', { size: 16 }) : GDC.icon('moon', { size: 16 })) + '</button>'
      : '';

    var viewToggleHtml = projects.length
      ? '<div class="projects-view-toggle" role="group" aria-label="Modo de visualização">' +
        '  <button type="button" class="btn-ghost h-9 w-9 p-0' + (viewMode === 'grid' ? ' btn-ghost-active' : '') + '" data-view-mode="grid" title="Ver em cards">' + GDC.icon('layout-dashboard', { size: 15 }) + '</button>' +
        '  <button type="button" class="btn-ghost h-9 w-9 p-0' + (viewMode === 'list' ? ' btn-ghost-active' : '') + '" data-view-mode="list" title="Ver em lista">' + GDC.icon('list', { size: 15 }) + '</button>' +
        '</div>'
      : '';

    root.innerHTML =
      '<div class="min-h-screen bg-app projects-screen">' +
      themeBtnHtml +
      '  <div class="projects-screen-inner">' +
      '    <div class="mb-8 text-center">' +
      // width:fit-content é essencial aqui — sem ela, o grid 2x2 do logo (que só tem regras de
      // colunas/gap, sem largura própria) vira um bloco normal e herda 100% da largura do container
      // (~56rem), esparramando as 4 bolinhas pela tela inteira em vez de ficar compacto (bug
      // reportado: bolinhas em cantos opostos). No header isso nunca acontecia porque lá o logo é
      // item de um flex container, que naturalmente encolhe ao conteúdo — aqui, dentro de um bloco
      // centralizado por texto, precisa da largura explícita.
      '      <div class="gdc-logo-grid surface-2 mx-auto" style="width:fit-content">' +
      '        <span class="h-2.5 w-2.5 bg-amber-400"></span>' +
      '        <span class="h-2.5 w-2.5 bg-emerald-400"></span>' +
      '        <span class="h-2.5 w-2.5 bg-pink-400"></span>' +
      '        <span class="h-2.5 w-2.5 bg-blue-400"></span>' +
      '      </div>' +
      '      <h1 class="mt-3 font-display text-2xl font-bold text-primary">Waypoint</h1>' +
      '      <p class="mt-1 text-secondary">Escolha um projeto para abrir, ou crie um novo.</p>' +
      '    </div>' +
      '    <div class="projects-toolbar">' +
      (creating ? '' : '<button type="button" id="proj-new-toggle" class="btn-ghost py-2 text-xs">' + GDC.icon('plus', { size: 14 }) + 'Novo projeto</button>') +
      viewToggleHtml +
      '    </div>' +
      (creating ? newProjectFormMarkup() : '') +
      '    <div class="mt-4">' + listHtml + '</div>' +
      '  </div>' +
      '</div>';

    bindEvents();
  }

  function bindEvents() {
    var themeBtn = root.querySelector('#proj-theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', function () { if (onToggleTheme) onToggleTheme(); });

    root.querySelectorAll('[data-view-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-view-mode');
        if (mode === viewMode) return;
        viewMode = mode;
        persistViewMode(viewMode);
        render();
      });
    });

    var toggleBtn = root.querySelector('#proj-new-toggle');
    if (toggleBtn) toggleBtn.addEventListener('click', function () { creating = true; render(); });

    var cancelBtn = root.querySelector('#proj-new-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { creating = false; render(); });

    var confirmBtn = root.querySelector('#proj-new-confirm');
    if (confirmBtn) confirmBtn.addEventListener('click', function () {
      var nameInput = root.querySelector('#proj-new-name');
      var typeSelect = root.querySelector('#proj-new-type');
      var name = nameInput ? nameInput.value : '';
      var type = typeSelect ? typeSelect.value : GDC.DEFAULT_PROJECT_TYPE;
      if (onCreate) onCreate(name, type);
    });

    var nameInputEl = root.querySelector('#proj-new-name');
    if (nameInputEl) {
      nameInputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && confirmBtn) confirmBtn.click();
      });
      nameInputEl.focus();
    }

    root.querySelectorAll('[data-open-project]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-open-project');
        if (onOpen) onOpen(id);
      });
    });

    root.querySelectorAll('[data-rename-project]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-rename-project');
        var currentMeta = GDC.findProjectMeta ? GDC.findProjectMeta(id) : null;
        var name = global.prompt('Novo nome do projeto:', currentMeta ? currentMeta.name : '');
        if (name && name.trim() && onRename) onRename(id, name.trim());
      });
    });

    root.querySelectorAll('[data-delete-project]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-delete-project');
        var currentMeta = GDC.findProjectMeta ? GDC.findProjectMeta(id) : null;
        var name = currentMeta ? currentMeta.name : 'este projeto';
        var msg = 'Excluir "' + name + '"? Isso apaga o projeto deste navegador. Essa ação não pode ser desfeita.';
        if (!global.confirm(msg)) return;
        if (onDelete) onDelete(id);
      });
    });
  }

  function mount(container, opts) {
    root = container;
    onOpen = opts.onOpenProject;
    onCreate = opts.onCreateProject;
    onRename = opts.onRenameProject;
    onDelete = opts.onDeleteProject;
    onToggleTheme = opts.onToggleTheme;
    currentTheme = opts.theme || 'dark';
    viewMode = readStoredViewMode();
    var projects = GDC.listProjects ? GDC.listProjects() : [];
    creating = projects.length === 0;
    render();
  }

  function setTheme(theme) {
    currentTheme = theme;
    var themeBtn = root && root.querySelector('#proj-theme-toggle');
    if (themeBtn) {
      themeBtn.innerHTML = currentTheme === 'dark' ? GDC.icon('sun', { size: 16 }) : GDC.icon('moon', { size: 16 });
      themeBtn.title = currentTheme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro';
    }
  }

  GDC.ui.projects = { mount: mount, render: render, setTheme: setTheme };
}(window));
