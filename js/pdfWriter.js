/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};

  // ---------------------------------------------------------------------------------------------
  // Gerador de PDF vetorial "na mão", sem nenhuma biblioteca externa (o app é 100% local/offline).
  // Só cobre o que o mural precisa: retângulos, polígonos, elipses preenchidas, linhas com traço
  // opcional tracejado/pontilhado, texto (fonte padrão Helvetica, sem precisar embutir a fonte) e
  // imagens (embutidas como JPEG puro via /DCTDecode, reaproveitando o encoder JPEG do próprio
  // navegador via <canvas>.toDataURL — não precisamos implementar compressão nós mesmos).
  // Coordenadas de entrada são sempre "de cima pra baixo" (y cresce descendo, igual DOM/tela); a
  // conversão pro sistema de coordenadas do PDF (origem embaixo à esquerda) acontece aqui dentro.
  // ---------------------------------------------------------------------------------------------

  // Larguras aproximadas (unidades/1000 em, escala Helvetica) por classe de caractere — não é a
  // tabela AFM exata, mas é o suficiente pra quebrar linha de forma razoável sem precisar transcrever
  // à mão uma tabela de 200+ números (risco de erro de digitação bem maior que o ganho de precisão).
  function charWidthUnits(ch) {
    if (ch === ' ' || ch === '\t') return 278;
    if ('iIl.,:;\'!|jft()[]'.indexOf(ch) !== -1) return 278;
    if ('mMW@'.indexOf(ch) !== -1) return 833;
    if (ch >= 'A' && ch <= 'Z') return 667;
    if (ch >= '0' && ch <= '9') return 556;
    return 556;
  }

  function measureText(str, size) {
    var units = 0;
    for (var i = 0; i < str.length; i++) units += charWidthUnits(str[i]);
    return (units / 1000) * size;
  }

  function wrapParagraphs(text, size, maxW) {
    var paras = String(text || '').split('\n');
    var lines = [];
    paras.forEach(function (p) {
      p = p.trim();
      if (!p) { lines.push(''); return; }
      var words = p.split(/\s+/).filter(Boolean);
      var cur = '';
      words.forEach(function (w) {
        var test = cur ? cur + ' ' + w : w;
        if (measureText(test, size) > maxW && cur) { lines.push(cur); cur = w; }
        else cur = test;
      });
      if (cur) lines.push(cur);
    });
    return lines;
  }

  // WinAnsiEncoding (cp1252) cobre os acentos do português direto (á, ã, ç, é...) porque, nessa
  // faixa, o valor do code point Unicode já bate com o byte cp1252 — mas pontuação "esperta" comum em
  // texto digitado (travessão, aspas curvas, reticências) mora fora do Latin-1 (>U+00FF) e precisa de
  // um byte específico da cp1252 (0x80-0x9F), por isso o mapeamento explícito abaixo antes de cair no
  // fallback '?'.
  var SMART_PUNCT_TO_CP1252 = {
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94,
    0x2013: 0x96, 0x2014: 0x97, 0x2026: 0x85, 0x20AC: 0x80,
  };

  function pdfEscapeText(str) {
    var out = '';
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      var byte = code <= 255 ? code : SMART_PUNCT_TO_CP1252[code];
      var ch = byte === undefined ? '?' : String.fromCharCode(byte);
      if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
      else out += ch;
    }
    return out;
  }

  function hexToRgb01(hex) {
    hex = String(hex || '#000000').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(hex, 16) || 0;
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }

  function fmt(n) { return (Math.round(n * 100) / 100).toString(); }

  function pad10(n) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < 10) s = '0' + s;
    return s;
  }

  function ellipsePoints(cx, cy, rx, ry) {
    var k = 0.5522848;
    var ox = rx * k, oy = ry * k;
    return [
      { m: true, x: cx + rx, y: cy },
      { x1: cx + rx, y1: cy + oy, x2: cx + ox, y2: cy + ry, x: cx, y: cy + ry },
      { x1: cx - ox, y1: cy + ry, x2: cx - rx, y2: cy + oy, x: cx - rx, y: cy },
      { x1: cx - rx, y1: cy - oy, x2: cx - ox, y2: cy - ry, x: cx, y: cy - ry },
      { x1: cx + ox, y1: cy - ry, x2: cx + rx, y2: cy - oy, x: cx + rx, y: cy },
    ];
  }

  function create(pageW, pageH) {
    var content = [];
    var xobjects = []; // { name, width, height, data (binary string JPEG) }

    function fy(y) { return fmt(pageH - y); } // topo->baixo (entrada) -> origem embaixo (PDF)

    function setFillColor(hex) {
      var c = hexToRgb01(hex);
      content.push(fmt(c.r) + ' ' + fmt(c.g) + ' ' + fmt(c.b) + ' rg');
    }
    function setStrokeColor(hex) {
      var c = hexToRgb01(hex);
      content.push(fmt(c.r) + ' ' + fmt(c.g) + ' ' + fmt(c.b) + ' RG');
    }

    function fillPolygon(points, hex) {
      if (!points || points.length < 3) return;
      setFillColor(hex);
      points.forEach(function (p, i) { content.push(fmt(p.x) + ' ' + fy(p.y) + (i === 0 ? ' m' : ' l')); });
      content.push('h f');
    }

    function fillRect(x, y, w, h, hex) {
      fillPolygon([{ x: x, y: y }, { x: x + w, y: y }, { x: x + w, y: y + h }, { x: x, y: y + h }], hex);
    }

    // Caminho de um retângulo de cantos arredondados (4 curvas de Bézier, uma por canto — mesma
    // aproximação usada em fillEllipse) sem preencher/pintar ainda, pra poder ser reaproveitado tanto
    // como preenchimento (fillRoundedRect) quanto como máscara de recorte pra imagem (image() com
    // radius) — reproduz o border-radius que post-its/formas/imagens já têm na tela.
    function roundedRectPathOps(x, y, w, h, r) {
      r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
      if (r < 0.5) {
        return [
          fmt(x) + ' ' + fy(y) + ' m', fmt(x + w) + ' ' + fy(y) + ' l',
          fmt(x + w) + ' ' + fy(y + h) + ' l', fmt(x) + ' ' + fy(y + h) + ' l', 'h',
        ];
      }
      var k = 0.5522848 * r;
      return [
        fmt(x + r) + ' ' + fy(y) + ' m',
        fmt(x + w - r) + ' ' + fy(y) + ' l',
        fmt(x + w - r + k) + ' ' + fy(y) + ' ' + fmt(x + w) + ' ' + fy(y + r - k) + ' ' + fmt(x + w) + ' ' + fy(y + r) + ' c',
        fmt(x + w) + ' ' + fy(y + h - r) + ' l',
        fmt(x + w) + ' ' + fy(y + h - r + k) + ' ' + fmt(x + w - r + k) + ' ' + fy(y + h) + ' ' + fmt(x + w - r) + ' ' + fy(y + h) + ' c',
        fmt(x + r) + ' ' + fy(y + h) + ' l',
        fmt(x + r - k) + ' ' + fy(y + h) + ' ' + fmt(x) + ' ' + fy(y + h - r + k) + ' ' + fmt(x) + ' ' + fy(y + h - r) + ' c',
        fmt(x) + ' ' + fy(y + r) + ' l',
        fmt(x) + ' ' + fy(y + r - k) + ' ' + fmt(x + r - k) + ' ' + fy(y) + ' ' + fmt(x + r) + ' ' + fy(y) + ' c',
        'h',
      ];
    }

    function fillRoundedRect(x, y, w, h, r, hex) {
      setFillColor(hex);
      content.push.apply(content, roundedRectPathOps(x, y, w, h, r));
      content.push('f');
    }

    function fillEllipse(cx, cy, rx, ry, hex) {
      setFillColor(hex);
      var pts = ellipsePoints(cx, cy, rx, ry);
      pts.forEach(function (p, i) {
        if (i === 0) content.push(fmt(p.x) + ' ' + fy(p.y) + ' m');
        else content.push(fmt(p.x1) + ' ' + fy(p.y1) + ' ' + fmt(p.x2) + ' ' + fy(p.y2) + ' ' + fmt(p.x) + ' ' + fy(p.y) + ' c');
      });
      content.push('h f');
    }

    function strokePolyline(points, hex, widthPt, dashArr) {
      if (!points || points.length < 2) return;
      setStrokeColor(hex);
      content.push(fmt(Math.max(widthPt, 0.5)) + ' w');
      content.push('1 J 1 j');
      content.push(dashArr && dashArr.length ? '[' + dashArr.join(' ') + '] 0 d' : '[] 0 d');
      points.forEach(function (p, i) { content.push(fmt(p.x) + ' ' + fy(p.y) + (i === 0 ? ' m' : ' l')); });
      content.push('S');
      content.push('[] 0 d');
    }

    // Texto com quebra de linha automática dentro de uma caixa (x,y,w,h) — corta linhas que não
    // couberem na altura (com "…" na última visível) em vez de vazar por cima de outros itens.
    function text(x, y, w, h, str, opts) {
      opts = opts || {};
      var size = opts.size || 12;
      var color = opts.color || '#18181b';
      var align = opts.align || 'left';
      var valign = opts.valign || 'top';
      var lineH = size * 1.25;
      var lines = wrapParagraphs(str, size, Math.max(w, 4));
      var maxLines = Math.max(1, Math.floor(h / lineH));
      var truncated = lines.length > maxLines;
      if (truncated) {
        lines = lines.slice(0, maxLines);
        var last = lines[maxLines - 1] || '';
        while (last.length && measureText(last + '…', size) > w) last = last.slice(0, -1);
        lines[maxLines - 1] = last + '…';
      }
      if (!lines.length) return;
      var c = hexToRgb01(color);
      var startY = valign === 'middle' ? y + Math.max(0, (h - lines.length * lineH) / 2) : y;
      content.push('BT');
      content.push('/F1 ' + fmt(size) + ' Tf');
      content.push(fmt(c.r) + ' ' + fmt(c.g) + ' ' + fmt(c.b) + ' rg');
      lines.forEach(function (line, i) {
        var baseY = startY + size * 0.92 + i * lineH;
        var lineW = measureText(line, size);
        var lineX = align === 'center' ? x + Math.max(0, (w - lineW) / 2) : x;
        content.push('1 0 0 1 ' + fmt(lineX) + ' ' + fy(baseY) + ' Tm');
        content.push('(' + pdfEscapeText(line) + ') Tj');
      });
      content.push('ET');
    }

    // jpegBinStr: string binária (cada char code = 1 byte, ex.: saída de atob()) com os bytes JPEG.
    // radius (opcional): recorta a imagem com o mesmo cantos-arredondados do quadro na tela, via
    // clipping path (W n) antes de desenhar — sem isso a imagem sairia sempre num retângulo reto.
    function image(x, y, w, h, jpegBinStr, pxW, pxH, radius) {
      var name = 'Im' + (xobjects.length + 1);
      xobjects.push({ name: name, width: pxW, height: pxH, data: jpegBinStr });
      content.push('q');
      if (radius) {
        content.push.apply(content, roundedRectPathOps(x, y, w, h, radius));
        content.push('W n');
      }
      content.push(fmt(w) + ' 0 0 ' + fmt(h) + ' ' + fmt(x) + ' ' + fy(y + h) + ' cm');
      content.push('/' + name + ' Do');
      content.push('Q');
    }

    function build() {
      var parts = [];
      var pos = 0;
      function push(s) { parts.push(s); pos += s.length; }

      push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

      var fontObjNum = 5;
      var contentObjNum = 4;
      var firstImageObjNum = 6;

      var xobjDict = xobjects.map(function (x, i) { return '/' + x.name + ' ' + (firstImageObjNum + i) + ' 0 R'; }).join(' ');
      var contentStr = content.join('\n');

      var objs = [];
      objs.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
      objs.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
      objs.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fmt(pageW) + ' ' + fmt(pageH) + ']' +
        ' /Resources << /Font << /F1 ' + fontObjNum + ' 0 R >>' + (xobjects.length ? ' /XObject << ' + xobjDict + ' >>' : '') + ' >>' +
        ' /Contents ' + contentObjNum + ' 0 R >>\nendobj\n');
      objs.push(contentObjNum + ' 0 obj\n<< /Length ' + contentStr.length + ' >>\nstream\n' + contentStr + '\nendstream\nendobj\n');
      objs.push(fontObjNum + ' 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
      xobjects.forEach(function (x, i) {
        var num = firstImageObjNum + i;
        objs.push(
          num + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + x.width + ' /Height ' + x.height +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + x.data.length + ' >>\nstream\n' +
          x.data + '\nendstream\nendobj\n'
        );
      });

      var offsets = [];
      objs.forEach(function (o) { offsets.push(pos); push(o); });

      var xrefStart = pos;
      var count = objs.length + 1;
      var xrefLines = ['xref', '0 ' + count, pad10(0) + ' 65535 f '];
      offsets.forEach(function (off) { xrefLines.push(pad10(off) + ' 00000 n '); });
      push(xrefLines.join('\n') + '\n');
      push('trailer\n<< /Size ' + count + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF');

      var full = parts.join('');
      var out = new Uint8Array(full.length);
      for (var i = 0; i < full.length; i++) out[i] = full.charCodeAt(i) & 0xFF;
      return out;
    }

    return {
      fillRect: fillRect, fillRoundedRect: fillRoundedRect, fillPolygon: fillPolygon, fillEllipse: fillEllipse,
      strokePolyline: strokePolyline, text: text, image: image, build: build,
    };
  }

  GDC.pdfWriter = { create: create, measureText: measureText };
}(window));
