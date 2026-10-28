/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};

  // ---------------------------------------------------------------------------------------------
  // Guarda os *bytes* de imagens de referência fora do documento/localStorage, num banco IndexedDB
  // à parte ("waypoint-media"). O localStorage tem um limite prático de poucos MB por origem — bom
  // o bastante pro projeto inteiro em texto (GDD, Kanban, Codex...), mas ruim pra imagens em base64
  // (que ainda ficam ~33% maiores). O IndexedDB aceita Blobs nativamente e tem um limite muito mais
  // alto (na prática, centenas de MB a alguns GB, dependendo do navegador/disco).
  //
  // O documento (doc.*) nunca guarda a imagem em si — só o `id` gerado aqui. Isso mantém o export
  // JSON normal leve e rápido; quem quiser um backup com as imagens junto usa "Exportar backup
  // completo", que empacota tudo (ver handleExportFullBackup em app.js).
  //
  // Continua 100% local: sem servidor, sem login, funciona offline via file://.
  // ---------------------------------------------------------------------------------------------

  var DB_NAME = 'waypoint-media';
  // v2: mesmo banco agora também guarda o object store "fonts" (ver fontStore.js) — os dois módulos
  // precisam pedir a MESMA versão, senão quem abrir primeiro travaria o outro (IndexedDB rejeita
  // abrir um banco existente com uma versão mais baixa do que a já criada). Por segurança, o handler
  // de upgrade daqui também cria "fonts" se faltar, e vice-versa no fontStore — funciona não importa
  // qual dos dois módulos for o primeiro a de fato abrir o banco.
  var DB_VERSION = 2;
  var STORE = 'images';

  var dbPromise = null;
  var urlCache = {}; // id -> object URL já criada (evita reler o Blob do IDB a cada render)

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in global)) { reject(new Error('IndexedDB indisponível neste navegador.')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('fonts')) db.createObjectStore('fonts', { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Não foi possível abrir o banco de imagens.')); };
    });
    return dbPromise;
  }

  /** Executa uma única operação de escrita/leitura numa transação e resolve com o resultado do
   *  IDBRequest devolvido por `fn`. */
  function runRequest(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var store = tx.objectStore(STORE);
        var req = fn(store);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('Falha ao acessar o banco de imagens.')); };
      });
    });
  }

  function readImageDimensions(blob) {
    return new Promise(function (resolve) {
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(blob).then(function (bmp) {
          var dims = { width: bmp.width, height: bmp.height };
          if (bmp.close) bmp.close();
          resolve(dims);
        }).catch(function () { resolve({ width: 0, height: 0 }); });
        return;
      }
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve({ width: 0, height: 0 }); };
      img.src = url;
    });
  }

  /** Guarda um arquivo/blob de imagem (de um <input type="file"> ou drag-and-drop) e devolve os
   *  metadados leves (sem os bytes) que o documento deve referenciar. */
  function put(file) {
    if (!file || file.size === undefined) return Promise.reject(new Error('Arquivo inválido.'));
    var id = GDC.makeId('img');
    return readImageDimensions(file).then(function (dims) {
      var record = {
        id: id, blob: file, type: file.type || 'image/png',
        width: dims.width, height: dims.height, size: file.size, createdAt: Date.now(),
      };
      return runRequest('readwrite', function (store) { return store.put(record); }).then(function () {
        return { id: id, width: dims.width, height: dims.height, size: file.size, type: record.type };
      });
    });
  }

  /** Recria um registro a partir de bytes base64 (usado ao importar um backup completo), mantendo
   *  o id original das referências já salvas no documento importado. */
  function putFromBase64(id, base64, type) {
    var byteChars = atob(base64);
    var bytes = new Uint8Array(byteChars.length);
    for (var i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    var blob = new Blob([bytes], { type: type || 'image/png' });
    return readImageDimensions(blob).then(function (dims) {
      var record = { id: id, blob: blob, type: blob.type, width: dims.width, height: dims.height, size: blob.size, createdAt: Date.now() };
      return runRequest('readwrite', function (store) { return store.put(record); });
    }).then(function () {
      if (urlCache[id]) { URL.revokeObjectURL(urlCache[id]); delete urlCache[id]; }
    });
  }

  function readOne(id) {
    if (!id) return Promise.resolve(null);
    return runRequest('readonly', function (store) { return store.get(id); })
      .then(function (record) { return record || null; })
      .catch(function () { return null; });
  }

  /** URL de exibição (cria e cacheia um object URL na primeira vez). Resolve null se a imagem não
   *  existir mais (por exemplo, referência órfã de um projeto importado sem o backup de mídia). */
  function getURL(id) {
    if (!id) return Promise.resolve(null);
    if (urlCache[id]) return Promise.resolve(urlCache[id]);
    return readOne(id).then(function (record) {
      if (!record || !record.blob) return null;
      var url = URL.createObjectURL(record.blob);
      urlCache[id] = url;
      return url;
    });
  }

  /** Bytes em base64 (usados apenas pelo "Exportar backup completo"). */
  function getBase64(id) {
    return readOne(id).then(function (record) {
      if (!record || !record.blob) return null;
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onloadend = function () {
          var result = String(reader.result || '');
          var comma = result.indexOf(',');
          resolve({ data: comma !== -1 ? result.slice(comma + 1) : result, type: record.type });
        };
        reader.onerror = function () { resolve(null); };
        reader.readAsDataURL(record.blob);
      });
    });
  }

  function remove(id) {
    if (!id) return Promise.resolve();
    if (urlCache[id]) { URL.revokeObjectURL(urlCache[id]); delete urlCache[id]; }
    return runRequest('readwrite', function (store) { return store.delete(id); });
  }

  function listIds() {
    return runRequest('readonly', function (store) { return store.getAllKeys(); })
      .then(function (keys) { return keys ? keys.map(String) : []; })
      .catch(function () { return []; });
  }

  /** Metadados (sem os bytes) de TODAS as imagens guardadas — usado pelo cartão de armazenamento na
   *  aba Saúde, pra listar/somar o que está ocupando espaço sem precisar reler cada Blob. */
  function listAll() {
    return runRequest('readonly', function (store) { return store.getAll(); })
      .then(function (records) {
        return (records || []).map(function (r) {
          return { id: r.id, size: r.size || 0, width: r.width || 0, height: r.height || 0, type: r.type, createdAt: r.createdAt || 0 };
        });
      })
      .catch(function () { return []; });
  }

  /** Utilitário compartilhado por Codex/Notas/Mural: procura elementos `[data-image-thumb="id"]`
   *  dentro de `container` e aplica a URL de exibição como background-image assim que resolvida
   *  (o markup é montado de forma síncrona só com um ícone de placeholder). Marca com classes
   *  genéricas (img-thumb-loaded/img-thumb-missing) — o tamanho/formato de cada thumb continua
   *  vindo da classe própria do módulo (.codex-image-thumb, .notes-image-thumb, .mural-item-image...). */
  function resolveThumbs(container) {
    if (!container) return;
    container.querySelectorAll('[data-image-thumb]').forEach(function (el) {
      var id = el.getAttribute('data-image-thumb');
      if (!id || el.classList.contains('img-thumb-loaded') || el.classList.contains('img-thumb-missing')) return;
      getURL(id).then(function (url) {
        if (!url) { el.classList.add('img-thumb-missing'); return; }
        el.style.backgroundImage = 'url(' + url + ')';
        el.classList.add('img-thumb-loaded');
        el.setAttribute('data-image-url', url);
        // visualização grande: a caixa assume a proporção da imagem (até um teto de altura no CSS)
        if (el.classList.contains('img-full') || el.classList.contains('img-ar')) {
          var im = new Image();
          im.onload = function () { if (im.naturalWidth && im.naturalHeight) { el.style.setProperty('--img-ar', im.naturalWidth + ' / ' + im.naturalHeight); el.dispatchEvent(new CustomEvent('wp-image-sized', { bubbles: true })); } };
          im.src = url;
        }
      });
    });
  }

  // Visualizador: clique numa imagem grande (.img-full) abre ela inteira por cima da página.
  function openViewer(url) {
    var ov = document.createElement('div');
    ov.className = 'img-viewer';
    ov.innerHTML = '<img alt="" /><button type="button" class="img-viewer-close" aria-label="Fechar">×</button>';
    ov.querySelector('img').src = url;
    var close = function () { ov.remove(); document.removeEventListener('keydown', onKey, true); };
    var onKey = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    ov.addEventListener('click', close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('.img-full.img-thumb-loaded');
    if (el && el.getAttribute('data-image-url')) openViewer(el.getAttribute('data-image-url'));
  });

  GDC.imageStore = {
    put: put,
    putFromBase64: putFromBase64,
    getURL: getURL,
    getBase64: getBase64,
    remove: remove,
    listIds: listIds,
    listAll: listAll,
    resolveThumbs: resolveThumbs,
    openViewer: openViewer,
  };
}(window));
