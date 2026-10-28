/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};

  // ---------------------------------------------------------------------------------------------
  // Gerador de ZIP "na mão", sem nenhuma biblioteca externa (mesmo raciocínio do pdfWriter.js — o
  // app é 100% local/offline). Só usa o método STORE (sem compressão): os arquivos que empacotamos
  // aqui são PNGs, que já saem comprimidos do próprio encoder do navegador — reimplementar DEFLATE
  // não ganharia quase nada de tamanho e adicionaria bastante código só por conta disso. O formato
  // ZIP aceita STORE normalmente (é só method=0 no header); qualquer descompactador abre sem
  // reclamar.
  // ---------------------------------------------------------------------------------------------

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  }());

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // Data/hora DOS (formato exigido pelos headers do ZIP) — não precisa ser exata, é só metadado.
  function dosDateTime() {
    var d = new Date();
    var time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
    var date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
    return { time: time, date: date };
  }

  function utf8Bytes(str) {
    return new Uint8Array(new TextEncoder().encode(str));
  }

  /** Pequeno builder de bytes que cresce sozinho (evita ficar recalculando tamanho total na mão a
   *  cada campo do header, como o pdfWriter.js faz pra string — aqui é binário, então bytes mesmo). */
  function ByteWriter() {
    this.chunks = [];
    this.length = 0;
  }
  ByteWriter.prototype.push = function (bytes) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  };
  ByteWriter.prototype.u16 = function (n) { this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff])); };
  ByteWriter.prototype.u32 = function (n) { this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff])); };
  ByteWriter.prototype.toBytes = function () {
    var out = new Uint8Array(this.length);
    var offset = 0;
    this.chunks.forEach(function (c) { out.set(c, offset); offset += c.length; });
    return out;
  };

  function create() {
    var entries = []; // { nameBytes, dataBytes, crc, dosTime, dosDate, localOffset }

    /** Adiciona um arquivo ao ZIP. `data` deve ser um Uint8Array (ou ArrayBuffer) com os bytes já
     *  prontos (ex.: o resultado de canvas.toBlob() convertido via arrayBuffer()). */
    function addFile(name, data) {
      var bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      entries.push({ nameBytes: utf8Bytes(name), dataBytes: bytes, crc: crc32(bytes), dt: dosDateTime() });
    }

    function toBytes() {
      var body = new ByteWriter();
      var offsets = [];

      entries.forEach(function (e) {
        offsets.push(body.length);
        body.u32(0x04034b50); // local file header signature
        body.u16(20); // version needed
        body.u16(0x0800); // general purpose flag: bit 11 = nome em UTF-8 (EFS), evita acento quebrado
        body.u16(0); // method = STORE
        body.u16(e.dt.time);
        body.u16(e.dt.date);
        body.u32(e.crc);
        body.u32(e.dataBytes.length); // compressed size (= uncompressed, STORE)
        body.u32(e.dataBytes.length); // uncompressed size
        body.u16(e.nameBytes.length);
        body.u16(0); // extra field length
        body.push(e.nameBytes);
        body.push(e.dataBytes);
      });

      var centralStart = body.length;
      entries.forEach(function (e, i) {
        body.u32(0x02014b50); // central file header signature
        body.u16(20); // version made by
        body.u16(20); // version needed
        body.u16(0x0800);
        body.u16(0);
        body.u16(e.dt.time);
        body.u16(e.dt.date);
        body.u32(e.crc);
        body.u32(e.dataBytes.length);
        body.u32(e.dataBytes.length);
        body.u16(e.nameBytes.length);
        body.u16(0); // extra field length
        body.u16(0); // comment length
        body.u16(0); // disk number start
        body.u16(0); // internal attributes
        body.u32(0); // external attributes
        body.u32(offsets[i]); // relative offset of local header
        body.push(e.nameBytes);
      });
      var centralSize = body.length - centralStart;

      body.u32(0x06054b50); // end of central directory signature
      body.u16(0); // disk number
      body.u16(0); // disk with central directory
      body.u16(entries.length); // entries on this disk
      body.u16(entries.length); // total entries
      body.u32(centralSize);
      body.u32(centralStart);
      body.u16(0); // comment length

      return body.toBytes();
    }

    function toBlob() {
      return new Blob([toBytes()], { type: 'application/zip' });
    }

    return { addFile: addFile, toBytes: toBytes, toBlob: toBlob };
  }

  GDC.zipWriter = { create: create };
}(window));
