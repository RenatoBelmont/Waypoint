/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};

  var LEGACY_STORAGE_KEY = 'gdc:project'; // chave única de projeto (versões pré-multiprojeto)
  var THEME_STORAGE_KEY = 'gdc:theme';
  var LEGACY_LAST_EXPORT_KEY = 'gdc:lastExport';
  var PROJECTS_INDEX_KEY = 'gdc:projects';
  var ACTIVE_PROJECT_KEY = 'gdc:activeProject';

  function projectDocKey(id) { return 'gdc:project:' + id; }
  function projectExportKey(id) { return 'gdc:lastExport:' + id; }

  // ---------- Índice de projetos ----------
  // O app agora guarda vários projetos no mesmo navegador. O índice é só metadado leve (id, nome,
  // tipo, datas) — o doc de cada projeto fica numa chave própria (projectDocKey), lido/escrito só
  // quando aquele projeto está aberto. Trocar de projeto = trocar ACTIVE_PROJECT_KEY + recarregar a
  // página: garante que nenhum estado interno de módulo (contadores, caches, layout calculado) do
  // projeto anterior sobrevive à troca, sem precisar caçar cada um deles um por um.

  function listProjects() {
    try {
      var raw = localStorage.getItem(PROJECTS_INDEX_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (p) { return p && typeof p.id === 'string'; })
        .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    } catch (e) {
      return [];
    }
  }

  function saveProjectsIndex(list) {
    try {
      localStorage.setItem(PROJECTS_INDEX_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      return false;
    }
  }

  function findProjectMeta(id) {
    return listProjects().filter(function (p) { return p.id === id; })[0] || null;
  }

  function touchProject(id) {
    var list = listProjects();
    var found = false;
    list = list.map(function (p) {
      if (p.id !== id) return p;
      found = true;
      return Object.assign({}, p, { updatedAt: Date.now() });
    });
    if (found) saveProjectsIndex(list);
  }

  function createProject(name, type) {
    var id = GDC.makeId('proj');
    var t = GDC.normalizeProjectType(type);
    var now = Date.now();
    var meta = { id: id, name: (name || '').trim() || 'Projeto sem título', type: t, createdAt: now, updatedAt: now };
    var list = listProjects().concat([meta]);
    saveProjectsIndex(list);
    var doc = GDC.createEmptyDocument(t);
    doc.title = meta.name;
    saveDocumentToStorage(id, doc);
    return id;
  }

  function renameProject(id, name) {
    var trimmed = (name || '').trim();
    if (!trimmed) return false;
    var list = listProjects().map(function (p) {
      return p.id === id ? Object.assign({}, p, { name: trimmed, updatedAt: Date.now() }) : p;
    });
    saveProjectsIndex(list);
    // Mantém o título dentro do próprio doc em sincronia com o nome na lista — os dois começam
    // iguais na criação, mas o usuário pode editar o título só dentro do GDC depois; aqui é o
    // caminho inverso (renomear pela lista), então atualiza o doc também.
    var doc = loadDocumentFromStorage(id);
    if (doc) {
      doc.title = trimmed;
      saveDocumentToStorage(id, doc);
    }
    return true;
  }

  function deleteProject(id) {
    var list = listProjects().filter(function (p) { return p.id !== id; });
    saveProjectsIndex(list);
    try {
      localStorage.removeItem(projectDocKey(id));
      localStorage.removeItem(projectExportKey(id));
    } catch (e) { /* ignore */ }
    if (getActiveProjectId() === id) clearActiveProjectId();
    // As imagens desse projeto (Codex/Notas/Mural) ficam no IndexedDB global e não são apagadas
    // aqui — a aba Saúde de qualquer outro projeto aberto depois vai listá-las como "sem uso" (já
    // que nenhum doc restante as referencia) e oferecer a limpeza de lá, com confirmação explícita.
  }

  function getActiveProjectId() {
    try { return localStorage.getItem(ACTIVE_PROJECT_KEY) || null; } catch (e) { return null; }
  }

  function setActiveProjectId(id) {
    try { localStorage.setItem(ACTIVE_PROJECT_KEY, id); } catch (e) { /* ignore */ }
  }

  function clearActiveProjectId() {
    try { localStorage.removeItem(ACTIVE_PROJECT_KEY); } catch (e) { /* ignore */ }
  }

  /** Migra o projeto único salvo por versões antigas (pré-multiprojeto) para o novo índice, na
   *  primeira vez que o app novo abre. Não faz nada se o índice já existe (mesmo vazio — significa
   *  que a migração já rodou, ou que é uma instalação nova sem nada pra migrar). */
  function runMigrationIfNeeded() {
    try {
      if (localStorage.getItem(PROJECTS_INDEX_KEY) !== null) return;
      var legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!legacyRaw) { saveProjectsIndex([]); return; }
      var legacyDoc;
      try { legacyDoc = GDC.normalizeDocument(JSON.parse(legacyRaw)); } catch (e) { saveProjectsIndex([]); return; }
      var id = GDC.makeId('proj');
      var now = Date.now();
      var meta = { id: id, name: legacyDoc.title.trim() || 'Meu projeto', type: legacyDoc.projectType, createdAt: now, updatedAt: now };
      saveProjectsIndex([meta]);
      saveDocumentToStorage(id, legacyDoc);
      var legacyExport = localStorage.getItem(LEGACY_LAST_EXPORT_KEY);
      if (legacyExport) localStorage.setItem(projectExportKey(id), legacyExport);
      setActiveProjectId(id);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      localStorage.removeItem(LEGACY_LAST_EXPORT_KEY);
    } catch (e) { /* localStorage indisponível — segue sem migrar, o app abre na lista de projetos vazia */ }
  }

  function loadDocumentFromStorage(id) {
    if (!id) return null;
    try {
      var raw = localStorage.getItem(projectDocKey(id));
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return GDC.normalizeDocument(parsed);
    } catch (e) {
      return null;
    }
  }

  /** Revisão do app que salvou o projeto neste navegador (0 = salvo antes de existir a marca). */
  function storedDocRevision(id) {
    try { var raw = localStorage.getItem(projectDocKey(id)); return raw ? (Number(JSON.parse(raw).appRevision) || 0) : 0; } catch (e) { return 0; }
  }

  function saveDocumentToStorage(id, doc) {
    if (!id) return false;
    try {
      localStorage.setItem(projectDocKey(id), JSON.stringify(Object.assign({}, doc, { appRevision: GDC.DATA_REVISION || 0 })));
      touchProject(id);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Une os ids de imagem em uso em TODOS os projetos salvos (não só o aberto no momento) — o banco
   *  de imagens (imageStore.js) é global, compartilhado entre projetos, então uma checagem de órfã
   *  que olhasse só o doc ativo marcaria como "sem uso" qualquer imagem pertencente a outro projeto
   *  fechado e a ofereceria pra exclusão por engano. `liveDoc`/`liveProjectId` deixam o projeto
   *  atualmente aberto entrar com o estado em memória (mais recente que o que já foi salvo) em vez
   *  de reler do storage. */
  function collectUsedImageIdsAllProjects(liveDoc, liveProjectId) {
    var used = {};
    listProjects().forEach(function (p) {
      var doc = (liveDoc && p.id === liveProjectId) ? liveDoc : loadDocumentFromStorage(p.id);
      if (!doc) return;
      Object.assign(used, GDC.collectUsedImageIds(doc));
    });
    return used;
  }

  function downloadBlob(content, type, filename) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /** Marca de versão/data gravada em todo arquivo exportado — a importação usa pra avisar de
   *  arquivo mais velho que o projeto local e recusar arquivo de uma versão mais nova do app. */
  function exportStamp() { return { appRevision: GDC.DATA_REVISION || 0, exportedAt: Date.now() }; }
  function stampForFile(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + 'h' + p(d.getMinutes());
  }
  function safeName(doc) { return ((doc.title || '').trim() || 'gdc-projeto').replace(/[\\/:*?"<>|]+/g, '-'); }

  function exportDocumentAsJson(doc) {
    var st = exportStamp();
    var json = JSON.stringify(Object.assign({}, doc, st), null, 2);
    downloadBlob(json, 'application/json', safeName(doc) + '_' + stampForFile(st.exportedAt) + '.json');
  }

  function recordExportTimestamp(projectId) {
    if (!projectId) return;
    try { localStorage.setItem(projectExportKey(projectId), String(Date.now())); } catch (e) { /* localStorage indisponível */ }
  }

  function getLastExportTimestamp(projectId) {
    if (!projectId) return null;
    try {
      var raw = localStorage.getItem(projectExportKey(projectId));
      return raw ? Number(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // ---------- Backup completo (JSON + imagens/fontes em base64) ----------
  // O export/import "normal" (acima) nunca inclui os bytes das imagens/fontes — elas ficam só no
  // IndexedDB local, referenciadas por id. Isso mantém o export do dia a dia leve e rápido. Quem
  // quiser um backup completo (por exemplo, pra levar o projeto pra outro navegador/computador) usa
  // este outro export, que embala tudo — texto + imagens + fontes customizadas em base64 — num único
  // arquivo JSON.
  //
  // Ids referenciados vêm de GDC.collectUsedImageIds/collectUsedFontIds (data.js) — a MESMA função
  // usada pra decidir o que é "órfão" na limpeza de armazenamento da aba Saúde. Antes esta seção
  // tinha sua própria varredura, mais curta (só Codex/Notas/Mural) — não enxergava capa de card do
  // Kanban nem nada do Designer de Cartas (ilustração/moldura por carta, verso por carta, biblioteca
  // de ícones, verso do baralho, fontes customizadas), então um backup "completo" saía incompleto:
  // ao importar em outro navegador, essas mídias ficavam com referência perdida. Reusar a mesma
  // varredura elimina essa divergência (e, de brinde, corrige o mesmo buraco na limpeza de órfãs —
  // ver o comentário em collectUsedImageIds em data.js).

  /** Gera e baixa um backup completo (documento + imagens + fontes customizadas em base64).
   *  Assíncrono — lê cada imagem/fonte do IndexedDB antes de montar o arquivo. */
  function exportFullBackup(doc) {
    var imageIds = GDC.collectUsedImageIds ? Object.keys(GDC.collectUsedImageIds(doc)) : [];
    var fontIds = GDC.collectUsedFontIds ? Object.keys(GDC.collectUsedFontIds(doc)) : [];
    var imagesPromise = (GDC.imageStore && imageIds.length)
      ? Promise.all(imageIds.map(function (id) {
          return GDC.imageStore.getBase64(id).then(function (result) { return { id: id, result: result }; });
        }))
      : Promise.resolve([]);
    var fontsPromise = (GDC.fontStore && fontIds.length)
      ? Promise.all(fontIds.map(function (id) {
          return GDC.fontStore.getBase64(id).then(function (result) { return { id: id, result: result }; });
        }))
      : Promise.resolve([]);
    return Promise.all([imagesPromise, fontsPromise]).then(function (results) {
      var media = {};
      results[0].forEach(function (p) { if (p.result) media[p.id] = p.result; });
      var fonts = {};
      results[1].forEach(function (p) { if (p.result) fonts[p.id] = p.result; });
      var st = exportStamp();
      var payload = Object.assign({}, doc, st, { media: media, fonts: fonts });
      // data/hora no nome: na pasta do Drive, o mais recente é o de nome "maior"
      downloadBlob(JSON.stringify(payload, null, 2), 'application/json', safeName(doc) + '-backup_' + stampForFile(st.exportedAt) + '.json');
    });
  }

  /** Se o JSON importado tiver um mapa `media` e/ou `fonts` (backup completo), regrava cada
   *  imagem/fonte no IndexedDB local antes de normalizar/aplicar o documento — assim, quando a UI
   *  renderizar, as imagens e fontes customizadas já existem e nenhuma referência aparece como
   *  "perdida" (o que incluía, antes desta correção, ilustrações/molduras/versos de carta, biblioteca
   *  de ícones e fontes enviadas pelo usuário no Designer de Cartas). */
  function hydrateImportedMedia(parsed) {
    var promises = [];
    if (parsed && typeof parsed.media === 'object' && parsed.media && GDC.imageStore) {
      Object.keys(parsed.media).forEach(function (id) {
        var m = parsed.media[id];
        if (!m || typeof m.data !== 'string') return;
        promises.push(GDC.imageStore.putFromBase64(id, m.data, m.type).catch(function () { /* ignora imagem individual corrompida */ }));
      });
    }
    if (parsed && typeof parsed.fonts === 'object' && parsed.fonts && GDC.fontStore && GDC.fontStore.putFromBase64) {
      Object.keys(parsed.fonts).forEach(function (id) {
        var f = parsed.fonts[id];
        if (!f || typeof f.data !== 'string') return;
        promises.push(GDC.fontStore.putFromBase64(id, f.data, f.type, f.family).catch(function () { /* ignora fonte individual corrompida */ }));
      });
    }
    return Promise.all(promises);
  }

  /** Valida um arquivo JSON importado antes de aceitar seu conteúdo como projeto. */
  function parseImportedJson(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: 'Arquivo inválido: não é um JSON válido.' };
    }

    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'Arquivo inválido: formato inesperado.' };
    }

    var hasKnownShape = ('sections' in parsed) || ('title' in parsed) || ('kanban' in parsed);
    if (!hasKnownShape) {
      return { ok: false, error: 'Arquivo inválido: não parece ser um projeto GDC.' };
    }

    if (Number(parsed.appRevision) > (GDC.DATA_REVISION || 0)) {
      return { ok: false, error: 'Este arquivo foi salvo por uma versão mais nova do Waypoint. Abra a cópia atualizada do app (ex.: a do Google Drive) pra importar — esta cópia descartaria partes do projeto.' };
    }
    if (typeof parsed.schemaVersion === 'number' && parsed.schemaVersion > GDC.SCHEMA_VERSION) {
      return { ok: false, error: 'Este arquivo foi salvo por uma versão mais nova do GDC. Atualize o app para importá-lo.' };
    }

    return { ok: true, document: GDC.normalizeDocument(parsed) };
  }

  GDC.THEME_STORAGE_KEY = THEME_STORAGE_KEY;
  GDC.loadDocumentFromStorage = loadDocumentFromStorage;
  GDC.saveDocumentToStorage = saveDocumentToStorage;
  GDC.exportDocumentAsJson = exportDocumentAsJson;
  GDC.recordExportTimestamp = recordExportTimestamp;
  GDC.getLastExportTimestamp = getLastExportTimestamp;
  GDC.parseImportedJson = parseImportedJson;
  GDC.storedDocRevision = storedDocRevision;
  GDC.downloadBlob = downloadBlob;
  GDC.exportFullBackup = exportFullBackup;
  GDC.hydrateImportedMedia = hydrateImportedMedia;

  // ---------- Multi-projeto ----------
  GDC.runMigrationIfNeeded = runMigrationIfNeeded;
  GDC.listProjects = listProjects;
  GDC.findProjectMeta = findProjectMeta;
  GDC.createProject = createProject;
  GDC.renameProject = renameProject;
  GDC.deleteProject = deleteProject;
  GDC.getActiveProjectId = getActiveProjectId;
  GDC.setActiveProjectId = setActiveProjectId;
  GDC.clearActiveProjectId = clearActiveProjectId;
  GDC.collectUsedImageIdsAllProjects = collectUsedImageIdsAllProjects;
}(window));
