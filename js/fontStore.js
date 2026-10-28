/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};

  // ---------------------------------------------------------------------------------------------
  // Guarda arquivos de fonte customizados (upload do usuário) num banco IndexedDB à parte
  // ("waypoint-media", mesmo banco do imageStore, mas num object store próprio "fonts") — mesmo
  // raciocínio do imageStore: bytes de arquivo não pertencem ao localStorage/doc.
  // ---------------------------------------------------------------------------------------------

  var DB_NAME = 'waypoint-media';
  var DB_VERSION = 2; // v2 adiciona o object store "fonts" ao banco que o imageStore já usa (v1)
  var STORE = 'fonts';

  var dbPromise = null;
  var loadedFamilies = {}; // family -> true, depois que um FontFace já foi carregado nesta sessão

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!('indexedDB' in global)) { reject(new Error('IndexedDB indisponível neste navegador.')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Não foi possível abrir o banco de fontes.')); };
    });
    return dbPromise;
  }

  function runRequest(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var store = tx.objectStore(STORE);
        var req = fn(store);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('Falha ao acessar o banco de fontes.')); };
      });
    });
  }

  /** Guarda um arquivo de fonte (.woff/.woff2/.ttf/.otf) sob um nome de família dado pelo usuário. */
  function put(file, familyName) {
    if (!file || file.size === undefined) return Promise.reject(new Error('Arquivo inválido.'));
    var id = GDC.makeId('font');
    var record = { id: id, blob: file, type: file.type || '', family: familyName, size: file.size, createdAt: Date.now() };
    return runRequest('readwrite', function (store) { return store.put(record); }).then(function () {
      return { id: id, family: familyName };
    });
  }

  /** Recria um registro de fonte a partir de bytes base64 (usado ao importar um backup completo),
   *  mantendo o id original das referências já salvas em doc.tools.cardDesigner (customFonts[].fontFileId)
   *  — espelha putFromBase64 do imageStore, mas guarda `family` também, já que o registro de fonte
   *  precisa dela pra montar o FontFace ao carregar (ensureLoaded). */
  function putFromBase64(id, base64, type, family) {
    var byteChars = atob(base64);
    var bytes = new Uint8Array(byteChars.length);
    for (var i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    var blob = new Blob([bytes], { type: type || '' });
    var record = { id: id, blob: blob, type: blob.type, family: family || '', size: blob.size, createdAt: Date.now() };
    return runRequest('readwrite', function (store) { return store.put(record); });
  }

  function readOne(id) {
    if (!id) return Promise.resolve(null);
    return runRequest('readonly', function (store) { return store.get(id); })
      .then(function (record) { return record || null; })
      .catch(function () { return null; });
  }

  function listAll() {
    return runRequest('readonly', function (store) { return store.getAll(); })
      .then(function (records) { return records || []; })
      .catch(function () { return []; });
  }

  function remove(id) {
    if (!id) return Promise.resolve();
    return runRequest('readwrite', function (store) { return store.delete(id); });
  }

  /** Carrega o FontFace de um registro salvo e registra em document.fonts, se ainda não estiver
   *  carregado nesta sessão (a página recarrega do zero a cada troca de projeto — ver comentário em
   *  app.js sobre reload completo na troca — então não há necessidade de "descarregar" fontes). */
  function ensureLoaded(id, familyName) {
    if (!id || !familyName) return Promise.resolve(false);
    var cacheKey = id + ':' + familyName;
    if (loadedFamilies[cacheKey]) return Promise.resolve(true);
    return readOne(id).then(function (record) {
      if (!record || !record.blob || typeof FontFace === 'undefined') return false;
      return record.blob.arrayBuffer().then(function (buf) {
        var face = new FontFace(familyName, buf);
        return face.load().then(function (loaded) {
          document.fonts.add(loaded);
          loadedFamilies[cacheKey] = true;
          return true;
        });
      });
    }).catch(function () { return false; });
  }

  /** Bytes em base64 de uma fonte salva — usado pelo Designer de Cartas pra embutir fontes
   *  customizadas via @font-face ao exportar PNG (o export roda fora do documento vivo, num
   *  <foreignObject> isolado, então precisa dos bytes embutidos em vez de depender do
   *  document.fonts já carregado na página) e pelo backup completo (storage.js), que também precisa
   *  de `family` junto pra poder recriar o registro certinho com putFromBase64 na importação. */
  function getBase64(id) {
    return readOne(id).then(function (record) {
      if (!record || !record.blob) return null;
      return new Promise(function (resolve) {
        var reader = new FileReader();
        reader.onloadend = function () {
          var result = String(reader.result || '');
          var comma = result.indexOf(',');
          resolve({ data: comma !== -1 ? result.slice(comma + 1) : result, type: record.type, family: record.family || '' });
        };
        reader.onerror = function () { resolve(null); };
        reader.readAsDataURL(record.blob);
      });
    });
  }

  GDC.fontStore = { put: put, putFromBase64: putFromBase64, listAll: listAll, remove: remove, ensureLoaded: ensureLoaded, getBase64: getBase64 };
}(window));
