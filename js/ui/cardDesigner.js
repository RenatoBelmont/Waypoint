/* global GDC */
(function (global) {
  'use strict';

  var GDC = global.GDC = global.GDC || {};
  GDC.ui = GDC.ui || {};

  var PRESETS = [
    { id: 'poker', label: 'Pôquer (63×88mm)', w: 63, h: 88 },
    { id: 'bridge', label: 'Bridge (57×89mm)', w: 57, h: 89 },
    { id: 'tarot', label: 'Tarot (70×120mm)', w: 70, h: 120 },
    { id: 'square', label: 'Quadrada grande (90×90mm)', w: 90, h: 90 },
    { id: 'custom', label: 'Personalizado', w: null, h: null },
  ];

  var FONT_OPTIONS = [
    { id: 'inherit', label: 'Padrão' },
    { id: "-apple-system, 'Segoe UI', system-ui, Roboto, Arial, sans-serif", label: 'Sem serifa (padrão do app)' },
    { id: "Georgia, 'Times New Roman', serif", label: 'Serifada (Georgia)' },
    { id: "'Courier New', Courier, monospace", label: 'Monoespaçada' },
    { id: "Impact, 'Arial Narrow', sans-serif", label: 'Condensada (títulos)' },
    { id: "'Trebuchet MS', Verdana, sans-serif", label: 'Arredondada' },
  ];

  // Fontes do Google (carregadas sob demanda via <link>, só quando escolhidas — não pesa o app se
  // não forem usadas). Curadoria pequena e variada, agora organizada por categoria (cada uma vira um
  // <optgroup> no seletor de fonte) pra facilitar achar o estilo certo em vez de rolar uma lista
  // plana — mesmas 5 famílias que o resto do mercado de design usa: sem serifa, serifada,
  // display/título, manuscrita e monoespaçada.
  var GOOGLE_FONT_CATEGORIES = [
    { id: 'sans', label: 'Sem serifa', fonts: ['Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Inter', 'Nunito', 'Raleway'] },
    { id: 'serif', label: 'Serifada', fonts: ['Playfair Display', 'Lora', 'Merriweather', 'Cinzel', 'Crimson Text', 'PT Serif', 'Bitter'] },
    { id: 'display', label: 'Display / títulos', fonts: ['Oswald', 'Bebas Neue', 'Anton', 'Alfa Slab One', 'Bungee', 'Righteous'] },
    { id: 'handwriting', label: 'Manuscrita', fonts: ['Caveat', 'Pacifico', 'Dancing Script', 'Permanent Marker', 'Kalam', 'Shadows Into Light'] },
    { id: 'monospace', label: 'Monoespaçada', fonts: ['Space Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Courier Prime'] },
  ];
  // Lista plana (todas as fontes, sem categoria) — usada onde só interessa "é uma fonte do Google
  // conhecida da curadoria", não a categoria dela.
  var GOOGLE_FONTS = GOOGLE_FONT_CATEGORIES.reduce(function (acc, cat) { return acc.concat(cat.fonts); }, []);
  var loadedGoogleFonts = {}; // name -> 'loading' | 'loaded' | 'error' — status real de cada fonte do
  // Google já pedida nesta sessão (module-scope: evita re-pedir a mesma entre re-renders)
  var googleFontFaceCssCache = {}; // name -> Promise<string> — CSS com @font-face já embutido em
  // base64 (bytes buscados uma vez, reaproveitados se a pessoa exportar PNG de novo na mesma sessão)
  var googleFontStatusListener = null; // reatribuído a cada render() — só uma instância montada por
  // vez (mesmo padrão de recordRecentColorFn) — avisa a UI quando uma fonte que estava "carregando"
  // termina de carregar OU falha, pra atualizar o aviso na hora certa mesmo sem a pessoa mexer em nada

  function setGoogleFontStatus(name, status) {
    loadedGoogleFonts[name] = status;
    if (googleFontStatusListener) { try { googleFontStatusListener(name, status); } catch (e) { /* nunca deixa a UI quebrar por causa de um callback de status */ } }
  }

  // Sem indicar o estado, uma fonte do Google que falhou em carregar (sem internet, por exemplo)
  // cai pra fonte substituta do navegador em silêncio — a pessoa via um resultado diferente do
  // esperado sem entender por quê (bug registrado no backlog). Agora rastreia de verdade: o <link>
  // carregando só confirma que o CSS chegou, não que o ARQUIVO da fonte baixou — por isso confirma
  // com a Font Loading API antes de marcar como sucesso.
  function ensureGoogleFontLoaded(name) {
    if (loadedGoogleFonts[name]) return;
    setGoogleFontStatus(name, 'loading');
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') + ':wght@400;700&display=swap';
    link.onload = function () {
      if (document.fonts && document.fonts.load) {
        document.fonts.load('700 12px "' + name + '"').then(function (loadedFonts) {
          setGoogleFontStatus(name, loadedFonts.length ? 'loaded' : 'error');
        }).catch(function () { setGoogleFontStatus(name, 'error'); });
      } else {
        setGoogleFontStatus(name, 'loaded');
      }
    };
    link.onerror = function () { setGoogleFontStatus(name, 'error'); };
    document.head.appendChild(link);
  }

  function blobToDataUri(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () { resolve(String(reader.result || '')); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Baixa o CSS de uma Google Font e embute os arquivos de fonte referenciados (url(...)) como
  // data: URI direto no texto do CSS, devolvendo um bloco de @font-face 100% autocontido — usado só
  // na exportação de PNG, onde a carta é renderizada isolada (fora do documento vivo, dentro de um
  // <svg><foreignObject>), então não pode depender de um <link> carregado na página: um @font-face
  // apontando pra fonts.gstatic.com de dentro desse SVG contaria como recurso de outra origem e
  // "sujaria" o canvas (toBlob/toDataURL passam a lançar erro de segurança). Falha em silêncio (ex.:
  // sem internet) — a carta exportada cai pra fonte padrão do sistema nesse caso, igual a fonte do
  // Google já se comporta hoje no preview se o navegador não conseguir buscar o <link>.
  function fetchGoogleFontFaceCssInlined(name) {
    if (googleFontFaceCssCache[name]) return googleFontFaceCssCache[name];
    var cssUrl = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(name).replace(/%20/g, '+') + ':wght@400;700&display=swap';
    var promise = fetch(cssUrl).then(function (r) { return r.text(); }).then(function (css) {
      var re = /url\(([^)]+)\)/g, m, urls = [];
      while ((m = re.exec(css))) { var u = m[1].replace(/['"]/g, ''); if (urls.indexOf(u) === -1) urls.push(u); }
      return Promise.all(urls.map(function (u) {
        return fetch(u).then(function (r) { return r.blob(); }).then(blobToDataUri).then(function (dataUri) { return { u: u, dataUri: dataUri }; });
      })).then(function (pairs) {
        var inlined = css;
        pairs.forEach(function (p) { inlined = inlined.split(p.u).join(p.dataUri); });
        return inlined;
      });
    }).catch(function () { return ''; });
    googleFontFaceCssCache[name] = promise;
    return promise;
  }

  // Reúne o @font-face de toda fonte "google:" ou "custom:" usada em algum campo de texto do
  // baralho, já com os bytes embutidos em base64 — ver comentário de fetchGoogleFontFaceCssInlined
  // acima sobre por que não dá pra só reaproveitar o <link>/FontFace já carregado na página normal.
  function buildEmbeddedFontFaceCss(state) {
    var googleNames = {}, customIds = {};
    state.fields.forEach(function (f) {
      if (f.type !== 'text' || typeof f.fontFamily !== 'string') return;
      if (f.fontFamily.indexOf('google:') === 0) googleNames[f.fontFamily.slice(7)] = true;
      else if (f.fontFamily.indexOf('custom:') === 0) customIds[f.fontFamily.slice(7)] = true;
    });
    var googlePromises = Object.keys(googleNames).map(fetchGoogleFontFaceCssInlined);
    var customPromises = Object.keys(customIds).map(function (id) {
      var cFont = (state.customFonts || []).filter(function (cf) { return cf.id === id; })[0];
      if (!cFont || !GDC.fontStore || !GDC.fontStore.getBase64) return Promise.resolve('');
      return GDC.fontStore.getBase64(cFont.fontFileId).then(function (res) {
        if (!res) return '';
        return '@font-face { font-family: "' + cFont.family.replace(/"/g, '') + '"; src: url(data:' + (res.type || 'font/ttf') + ';base64,' + res.data + '); }';
      }).catch(function () { return ''; });
    });
    return Promise.all(googlePromises.concat(customPromises)).then(function (arr) { return arr.join('\n'); });
  }

  // Converte a mesma HTML/CSS de impressão de UMA carta (frontCardHtml/backCardHtml, mm-based) num
  // PNG rasterizado, via um truque de SVG que não depende de nenhuma lib externa: embrulha a HTML
  // num <foreignObject>, serializa o SVG inteiro numa data: URI, carrega isso como <img> e desenha
  // num <canvas> no tamanho de saída (DPI alvo). O viewBox menor que o width/height do <svg> é o que
  // faz o navegador rasterizar o texto/traços na resolução mais alta (script maior), em vez de só
  // ampliar depois um bitmap pequeno e borrado.
  //
  // Importante: toda imagem referenciada dentro de `cardHtml` PRECISA já estar como data: URI (não
  // blob:) — um <img src="blob:..."> dentro do foreignObject "suja" o canvas de origem (mesmo sendo
  // uma URL da mesma aba), impedindo toBlob()/toDataURL() de funcionar. Por isso o export sempre
  // resolve as imagens via GDC.imageStore.getBase64 antes de chamar isto (ver handleExportPng).
  function renderCardToPngBlob(cardHtml, widthMm, heightMm, fontFaceCss, dpi) {
    var naturalW = widthMm * 96 / 25.4, naturalH = heightMm * 96 / 25.4; // "1x" CSS px (96dpi)
    var outW = Math.max(1, Math.round(widthMm * dpi / 25.4)), outH = Math.max(1, Math.round(heightMm * dpi / 25.4));
    var styleCss =
      '.cd-print-card{position:relative;overflow:hidden;box-sizing:border-box;}' +
      '.cd-print-field{position:absolute;overflow:hidden;white-space:pre-wrap;word-break:break-word;line-height:1.15;}' +
      '.cd-print-img{display:block;width:100%;height:100%;}' +
      '.cd-print-icons{display:flex;flex-wrap:wrap;align-content:center;align-items:center;justify-content:center;gap:1mm;}' +
      '.cd-print-icon-chip{display:inline-block;width:4mm;height:4mm;overflow:hidden;}' +
      '.cd-print-icon-chip-emoji{font-size:3.5mm;line-height:4mm;text-align:center;}' +
      (fontFaceCss || '');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + outW + '" height="' + outH + '" viewBox="0 0 ' + naturalW + ' ' + naturalH + '">' +
      '<foreignObject width="' + naturalW + '" height="' + naturalH + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + widthMm + 'mm;height:' + heightMm + 'mm">' +
      '<style>' + styleCss + '</style>' +
      cardHtml +
      '</div></foreignObject></svg>';
    var svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = outW; canvas.height = outH;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, outW, outH);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('canvas.toBlob devolveu null'));
        }, 'image/png');
      };
      img.onerror = function () { reject(new Error('Falha ao rasterizar a carta (SVG->imagem).')); };
      img.src = svgUrl;
    });
  }

  // Igual renderCardToPngBlob acima, mas rasteriza uma PÁGINA inteira (A4, com vários cartões já
  // posicionados dentro — mesmo HTML que a impressão via navegador usa) em vez de um cartão só, e
  // devolve JPEG em vez de PNG — usado só na exportação de PDF direta (ver buildPdfBlob): PDF sem
  // biblioteca externa embute imagem via o filtro DCTDecode, que aceita bytes de JPEG cru direto,
  // sem precisar implementar compressão própria (o filtro pra PNG, FlateDecode, exigiria isso).
  function renderPageToJpegBlob(pageInnerHtml, fontFaceCss, dpi, quality) {
    var widthMm = PRINT_PAGE_W_MM, heightMm = PRINT_PAGE_H_MM;
    var naturalW = widthMm * 96 / 25.4, naturalH = heightMm * 96 / 25.4;
    var outW = Math.max(1, Math.round(widthMm * dpi / 25.4)), outH = Math.max(1, Math.round(heightMm * dpi / 25.4));
    var styleCss =
      '.cd-print-page{width:' + widthMm + 'mm;height:' + heightMm + 'mm;padding:' + PRINT_MARGIN_MM + 'mm;box-sizing:border-box;display:flex;flex-wrap:wrap;align-content:flex-start;gap:' + PRINT_GAP_MM + 'mm;background:#fff;}' +
      '.cd-print-card-wrap{position:relative;}' +
      '.cd-print-card{position:relative;overflow:hidden;box-sizing:border-box;}' +
      '.cd-print-field{position:absolute;overflow:hidden;white-space:pre-wrap;word-break:break-word;line-height:1.15;}' +
      '.cd-print-img{display:block;width:100%;height:100%;}' +
      '.cd-print-icons{display:flex;flex-wrap:wrap;align-content:center;align-items:center;justify-content:center;gap:1mm;}' +
      '.cd-print-icon-chip{display:inline-block;width:4mm;height:4mm;overflow:hidden;}' +
      '.cd-print-icon-chip-emoji{font-size:3.5mm;line-height:4mm;text-align:center;}' +
      (fontFaceCss || '');
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + outW + '" height="' + outH + '" viewBox="0 0 ' + naturalW + ' ' + naturalH + '">' +
      '<foreignObject width="' + naturalW + '" height="' + naturalH + '">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + widthMm + 'mm;height:' + heightMm + 'mm;background:#fff;">' +
      '<style>' + styleCss + '</style>' +
      '<div class="cd-print-page">' + pageInnerHtml + '</div>' +
      '</div></foreignObject></svg>';
    var svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = outW; canvas.height = outH;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH); // JPEG não tem canal alfa — garante fundo branco sólido
        ctx.drawImage(img, 0, 0, outW, outH);
        canvas.toBlob(function (blob) {
          if (blob) resolve({ blob: blob, widthPx: outW, heightPx: outH }); else reject(new Error('canvas.toBlob devolveu null'));
        }, 'image/jpeg', quality);
      };
      img.onerror = function () { reject(new Error('Falha ao rasterizar a página (SVG->imagem).')); };
      img.src = svgUrl;
    });
  }

  // Monta um PDF mínimo (sem biblioteca externa) a partir de páginas JPEG já rasterizadas — cada
  // página vira um objeto de imagem (filtro DCTDecode, aceita os bytes do JPEG direto) desenhado
  // ocupando a página inteira. Estrutura PDF padrão: Catalog -> Pages -> [Page -> Content -> Image]
  // repetido, mais a tabela xref no fim apontando o offset de cada objeto (formato exigido pelo
  // spec, mas qualquer leitor de PDF tolera mesmo se os offsets não forem usados de fato por ele).
  function buildPdfBlob(pages) {
    var parts = [];
    var offsets = [0]; // índice 0 é o objeto livre padrão do PDF, nunca usado de verdade
    var pos = 0;
    function pushStr(s) {
      var bytes = new TextEncoder().encode(s);
      parts.push(bytes);
      pos += bytes.length;
    }
    function pushBytes(b) {
      parts.push(b);
      pos += b.length;
    }
    function beginObj(num) {
      offsets[num] = pos;
      pushStr(num + ' 0 obj\n');
    }

    var n = pages.length;
    var catalogNum = 1, pagesNum = 2;
    var firstPageNum = 3, firstImageNum = 3 + n, firstContentNum = 3 + 2 * n;
    var totalObjs = 3 + 3 * n; // maior número de objeto + 1

    pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    beginObj(catalogNum);
    pushStr('<< /Type /Catalog /Pages ' + pagesNum + ' 0 R >>\nendobj\n');

    beginObj(pagesNum);
    var kids = [];
    for (var i = 0; i < n; i++) kids.push((firstPageNum + i) + ' 0 R');
    pushStr('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\nendobj\n');

    for (var p = 0; p < n; p++) {
      var page = pages[p];
      var pageNum = firstPageNum + p, imgNum = firstImageNum + p, contentNum = firstContentNum + p;
      var wPt = (PRINT_PAGE_W_MM / 25.4 * 72).toFixed(2), hPt = (PRINT_PAGE_H_MM / 25.4 * 72).toFixed(2);

      beginObj(pageNum);
      pushStr('<< /Type /Page /Parent ' + pagesNum + ' 0 R /MediaBox [0 0 ' + wPt + ' ' + hPt + '] /Resources << /XObject << /Im0 ' + imgNum + ' 0 R >> >> /Contents ' + contentNum + ' 0 R >>\nendobj\n');

      var contentBytes = new TextEncoder().encode('q ' + wPt + ' 0 0 ' + hPt + ' 0 0 cm /Im0 Do Q');
      beginObj(contentNum);
      pushStr('<< /Length ' + contentBytes.length + ' >>\nstream\n');
      pushBytes(contentBytes);
      pushStr('\nendstream\nendobj\n');

      beginObj(imgNum);
      pushStr('<< /Type /XObject /Subtype /Image /Width ' + page.widthPx + ' /Height ' + page.heightPx + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.jpegBytes.length + ' >>\nstream\n');
      pushBytes(page.jpegBytes);
      pushStr('\nendstream\nendobj\n');
    }

    var xrefStart = pos;
    pushStr('xref\n0 ' + totalObjs + '\n0000000000 65535 f \n');
    for (var k = 1; k < totalObjs; k++) {
      var off = String(offsets[k] || 0);
      pushStr('0000000000'.slice(0, 10 - off.length) + off + ' 00000 n \n');
    }
    pushStr('trailer\n<< /Size ' + totalObjs + ' /Root ' + catalogNum + ' 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF');

    return new Blob(parts, { type: 'application/pdf' });
  }

  // Nome de arquivo seguro (sem barra, dois-pontos etc. que quebrariam em algum SO) a partir de um
  // texto livre (ex.: valor do primeiro campo de texto da carta) — cai num fallback se ficar vazio.
  function sanitizeFilename(str, fallback) {
    var cleaned = String(str || '').trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned.slice(0, 60) : fallback;
  }

  // Chave estável pra identificar uma combinação forma+cores (usada pra cachear/desduplicar
  // rasterizações de ícone de forma no export de PNG — duas cartas usando o mesmo ícone não
  // precisam rasterizar duas vezes).
  function shapeIconKey(icon) {
    return [icon.shape, icon.shapeFill, icon.shapeStroke || '', icon.shapeStrokeWidth || 0].join('|');
  }

  // Rasteriza UM ícone de forma (SHAPE_PRESETS) num PNG pequeno, devolvido como data: URI — usado só
  // no export de PNG por carta. Diferente do <svg> aninhado que shapeSvgMarkup() gera (usado no
  // preview/impressão ao vivo, onde funciona bem), esse aqui é um <svg> de NÍVEL RAIZ próprio
  // (sem nenhum foreignObject por perto) carregado como <img> e desenhado num canvas — evita de vez
  // um bug real encontrado: um <svg> aninhado DENTRO de um <foreignObject> que por sua vez está
  // dentro de outro <svg> usado como fonte de <img> (o truque que renderCardToPngBlob usa pra
  // rasterizar a carta inteira) simplesmente não desenha a forma nesse caminho específico, mesmo o
  // mesmo markup funcionando perfeitamente inserido direto no documento vivo.
  function shapeToPngDataUri(shapeId, fill, stroke, strokeWidth, sizePx) {
    var shape = SHAPE_PRESETS.filter(function (s) { return s.id === shapeId; })[0];
    if (!shape) return Promise.resolve(null);
    var strokeAttr = stroke ? 'stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' : 'stroke="none"';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + sizePx + '" height="' + sizePx + '" ' +
      'fill="' + fill + '" ' + strokeAttr + ' stroke-linejoin="round" stroke-linecap="round">' + shape.svg + '</svg>';
    var svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = sizePx; canvas.height = sizePx;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, sizePx, sizePx);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = function () { reject(new Error('Falha ao rasterizar ícone de forma.')); };
      img.src = svgUrl;
    });
  }

  // Igual shapeToPngDataUri acima, mas SEM travar num tamanho quadrado — usada pra rasterizar uma
  // CAMADA em formato de forma (Painel com "Forma" != retângulo), cujo campo pode ter qualquer
  // proporção largura/altura, ao contrário de um ícone (sempre quadrado). Mesmo raciocínio de fundo:
  // <svg> de nível raiz carregado como <img> e desenhado num canvas, pra fugir do bug de <svg>
  // aninhado dentro de foreignObject não desenhar nesse caminho de rasterização específico.
  function shapeFieldToPngDataUri(shapeId, fill, stroke, strokeWidth, widthPx, heightPx) {
    var shape = SHAPE_PRESETS.filter(function (s) { return s.id === shapeId; })[0];
    if (!shape) return Promise.resolve(null);
    var strokeAttr = stroke ? 'stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' : 'stroke="none"';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + widthPx + '" height="' + heightPx + '" ' +
      'preserveAspectRatio="none" fill="' + fill + '" ' + strokeAttr + ' stroke-linejoin="round" stroke-linecap="round">' + shape.svg + '</svg>';
    var svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = widthPx; canvas.height = heightPx;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, widthPx, heightPx);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = function () { reject(new Error('Falha ao rasterizar forma de camada.')); };
      img.src = svgUrl;
    });
  }

  // Junta os rasters de forma de TODOS os campos Painel com uma forma != retângulo — chamado uma vez
  // só no início do export de PNG (mesmo padrão de collectShapeIconRasters), na resolução real do
  // campo (proporcional a PNG_EXPORT_DPI, pra sair nítido igual o resto da exportação).
  function collectPanelShapeRasters(fields) {
    var targets = fields.filter(function (f) { return f.type === 'panel' && f.shape && f.shape !== 'rect'; });
    if (!targets.length) return Promise.resolve({});
    return Promise.all(targets.map(function (f) {
      var wPx = Math.max(1, Math.round(f.w * PNG_EXPORT_DPI / 25.4)), hPx = Math.max(1, Math.round(f.h * PNG_EXPORT_DPI / 25.4));
      var strokeWidthUnits = (f.borderColor && f.borderWidthMm > 0) ? (f.borderWidthMm * 24 / Math.max(1, Math.min(f.w, f.h))) : 0;
      return shapeFieldToPngDataUri(f.shape, f.bgColor || 'none', f.borderColor, strokeWidthUnits, wPx, hPx).then(function (uri) {
        return { key: 'panel:' + f.id, uri: uri };
      });
    })).then(function (pairs) {
      var map = {};
      pairs.forEach(function (p) { if (p.uri) map[p.key] = p.uri; });
      return map;
    });
  }

  // Versão pro CANVAS/impressão ao vivo (documento normal, sem o bug de rasterização) — <svg>
  // aninhado de verdade, redesenha junto com qualquer mudança de cor/forma sem precisar re-rasterizar.
  function panelShapeSvgMarkup(f) {
    var shape = SHAPE_PRESETS.filter(function (s) { return s.id === f.shape; })[0];
    if (!shape) return '';
    var strokeWidthUnits = (f.borderColor && f.borderWidthMm > 0) ? (f.borderWidthMm * 24 / Math.max(1, Math.min(f.w, f.h))) : 0;
    var strokeAttr = (f.borderColor && f.borderWidthMm > 0) ? 'stroke="' + f.borderColor + '" stroke-width="' + strokeWidthUnits + '"' : 'stroke="none"';
    return '<svg viewBox="0 0 24 24" preserveAspectRatio="none" style="width:100%;height:100%;display:block" fill="' + (f.bgColor || 'none') + '" ' + strokeAttr + ' stroke-linejoin="round" stroke-linecap="round">' + shape.svg + '</svg>';
  }

  // Reúne (deduplicado por shapeIconKey) e rasteriza todo ícone de forma da biblioteca do projeto,
  // de uma vez, antes de montar as cartas do export de PNG.
  function collectShapeIconRasters(state, sizePx) {
    var byKey = {};
    (state.iconLibrary || []).forEach(function (ic) {
      if (ic.shape) byKey[shapeIconKey(ic)] = ic;
    });
    var keys = Object.keys(byKey);
    return Promise.all(keys.map(function (key) {
      var ic = byKey[key];
      return shapeToPngDataUri(ic.shape, ic.shapeFill, ic.shapeStroke, ic.shapeStrokeWidth, sizePx).then(function (uri) { return { key: key, uri: uri }; });
    })).then(function (pairs) {
      var map = {};
      pairs.forEach(function (p) { if (p.uri) map[p.key] = p.uri; });
      return map;
    });
  }

  // Paleta curada — tons de saturação/luminosidade médias, nem escuros nem claros demais, pra
  // acelerar a escolha de cor sem abrir o seletor nativo toda vez (que continua disponível ao lado
  // pra qualquer cor fora da paleta).
  var COLOR_PALETTE = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#06b6d4',
    '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#78716c', '#a8a29e', '#3f3f46', '#f5f5f4',
  ];

  var LIMITS = {
    dim: { min: 20, max: 200 }, pos: { min: -500, max: 500 },
    font: { min: 1, max: 20 }, radius: { min: 0, max: 50 }, padding: { min: 0, max: 20 },
    bleed: { max: 15 }, qty: { min: 1, max: 999 }, customFonts: { max: 10 },
    rows: { max: 300 }, fields: { max: 16 }, icons: { max: 24 },
  };

  // Teto de segurança pra folha de impressão: rows.max (300) × qty.max (999) sozinhos permitem até
  // ~300 mil cartas expandidas (linhas × cópias) na mesma folha — cada uma virando um elemento real
  // no DOM pra imprimir, o que trava o navegador bem antes de chegar perto desse número. 2000 é
  // generoso pra qualquer baralho indie de verdade (um jogo grande tem centenas de cartas ÚNICAS,
  // não milhares de cópias da mesma) e ainda renderiza sem travar em qualquer computador razoável.
  var MAX_PRINTABLE_CARDS = 2000;
  // Teto mais leve (aviso, não bloqueio) pro export de PNG por carta — não sofre da mesma
  // multiplicação por cópias (um PNG por carta ÚNICA, não por cópia impressa), mas gerar centenas de
  // PNGs em 300dpi sequencialmente ainda pode demorar bastante ou pesar na memória do navegador.
  var PNG_EXPORT_WARN_THRESHOLD = 100;

  var DEFAULT_PREVIEW_SCALE = 5; // valor inicial/mínimo — o tamanho real reajusta pro espaço disponível (ver computeAutoScale)
  var PRINT_PAGE_W_MM = 210, PRINT_PAGE_H_MM = 297, PRINT_MARGIN_MM = 10, PRINT_GAP_MM = 3;
  var PNG_EXPORT_DPI = 300; // resolução de saída do export PNG por carta (impressão de qualidade ~ 300dpi)

  function clamp(n, min, max) {
    if (!isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  // Normaliza um ângulo de rotação pro intervalo [0, 360) — aceita qualquer número (inclusive
  // negativo ou maior que 360, que pode vir de um arraste ou de um valor digitado à mão) e devolve
  // sempre a forma "canônica" (ex.: -90 vira 270). Arredonda pro grau inteiro mais próximo — precisão
  // fracionária não ajuda em nada aqui e só deixaria o campo "Giro" feio de ler.
  function normalizeAngle(n) {
    var v = Math.round(Number(n));
    if (!isFinite(v)) return 0;
    v = v % 360;
    if (v < 0) v += 360;
    return v;
  }

  // Extrai um File de imagem de um evento de drop, ignorando qualquer outra coisa que tenha sido
  // arrastada (texto, link, múltiplos arquivos não-imagem etc.) — só usa o primeiro arquivo cujo
  // tipo comece com "image/". Retorna null se nada aproveitável foi solto.
  function extractDroppedImageFile(e) {
    var dt = e.dataTransfer;
    if (!dt || !dt.files || !dt.files.length) return null;
    for (var i = 0; i < dt.files.length; i++) {
      if (dt.files[i].type && dt.files[i].type.indexOf('image/') === 0) return dt.files[i];
    }
    return null;
  }

  // Liga um elemento como alvo de arrastar-e-soltar de arquivo de imagem: feedback visual durante o
  // arrasto (classe `card-designer-dropzone-active`) e chama `onFile(file)` só quando o que foi
  // solto é mesmo uma imagem. Precisa de dragover com preventDefault pra o navegador permitir o drop
  // (comportamento padrão é abrir o arquivo numa aba nova).
  function bindImageDropZone(el, onFile) {
    var depth = 0; // contador de dragenter/dragleave — evita "piscar" a classe ao passar por filhos
    el.addEventListener('dragenter', function (e) {
      e.preventDefault();
      depth++;
      el.classList.add('card-designer-dropzone-active');
    });
    el.addEventListener('dragover', function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('dragleave', function () {
      depth = Math.max(0, depth - 1);
      if (depth === 0) el.classList.remove('card-designer-dropzone-active');
    });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      depth = 0;
      el.classList.remove('card-designer-dropzone-active');
      var file = extractDroppedImageFile(e);
      if (file) onFile(file);
    });
  }

  // Mesmo raciocínio do arrastar-e-soltar de imagem acima, só que a "carga" arrastada não é um
  // arquivo do explorador — é o ID de um ícone da biblioteca do baralho (ver o atributo
  // `data-icon-drag` marcado como draggable="true" em iconSetRowMarkup). O tipo MIME próprio
  // (`text/x-gdc-icon-id`) deixa dar pra checar já no dragover/dragenter se é mesmo um ícone sendo
  // arrastado (sem precisar esperar o drop), então um arrasto de ARQUIVO por cima não aciona essa
  // zona por engano, e vice-versa.
  var ICON_DRAG_MIME = 'text/x-gdc-icon-id';

  function extractDraggedIconId(e) {
    var dt = e.dataTransfer;
    if (!dt) return null;
    var id = dt.getData(ICON_DRAG_MIME);
    return id || null;
  }

  function bindIconDropZone(el, onIconId) {
    var depth = 0;
    function isIconDrag(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, ICON_DRAG_MIME) !== -1; }
    el.addEventListener('dragenter', function (e) {
      if (!isIconDrag(e)) return;
      e.preventDefault();
      depth++;
      el.classList.add('card-designer-dropzone-active');
    });
    el.addEventListener('dragover', function (e) {
      if (!isIconDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('dragleave', function () {
      depth = Math.max(0, depth - 1);
      if (depth === 0) el.classList.remove('card-designer-dropzone-active');
    });
    el.addEventListener('drop', function (e) {
      var iconId = extractDraggedIconId(e);
      if (!iconId) return;
      e.preventDefault();
      e.stopPropagation(); // evita que a zona "criar campo novo" do card inteiro também dispare
      depth = 0;
      el.classList.remove('card-designer-dropzone-active');
      onIconId(iconId, e);
    });
  }

  function makeId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function escapeAttr(str) { return escapeHtml(str); }

  // Normaliza um texto pra COMPARAR nomes de coluna de CSV com rótulos de campo, de um jeito bem
  // mais tolerante que o antigo trim()+toLowerCase() sozinho (que exigia bater exatamente até
  // acento) — minúsculas, sem acento, sem espaço nas pontas nem espaços duplicados no meio. Usada
  // só pra SUGERIR o pareamento automático na tela de mapeamento (ver csvMappingModalMarkup); o
  // pareamento final sempre pode ser corrigido manualmente ali, então não precisa ser perfeito.
  function normalizeForMatch(str) {
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  function normalizeFontFamily(v) {
    if (typeof v !== 'string') return 'inherit';
    if (v.indexOf('google:') === 0 || v.indexOf('custom:') === 0) return v;
    return FONT_OPTIONS.some(function (o) { return o.id === v; }) ? v : 'inherit';
  }

  // fontFamily de um campo pode ser: um dos FONT_OPTIONS embutidos; "google:Nome Da Fonte"; ou
  // "custom:<id>" referenciando uma entrada de state.customFonts (fonte enviada pelo usuário).
  function fontFamilyCss(fontFamily, state) {
    if (typeof fontFamily === 'string' && fontFamily.indexOf('google:') === 0) {
      var gName = fontFamily.slice('google:'.length);
      ensureGoogleFontLoaded(gName);
      return "'" + gName + "', sans-serif";
    }
    if (typeof fontFamily === 'string' && fontFamily.indexOf('custom:') === 0) {
      var cId = fontFamily.slice('custom:'.length);
      var cFont = (state && state.customFonts || []).filter(function (f) { return f.id === cId; })[0];
      if (cFont) {
        if (GDC.fontStore) GDC.fontStore.ensureLoaded(cFont.fontFileId, cFont.family);
        return "'" + cFont.family + "', sans-serif";
      }
      return 'inherit';
    }
    var opt = FONT_OPTIONS.filter(function (f) { return f.id === fontFamily; })[0];
    return (opt && fontFamily !== 'inherit') ? fontFamily : 'inherit';
  }

  function textDecorationCss(f) {
    var parts = [];
    if (f.underline) parts.push('underline');
    if (f.strikethrough) parts.push('line-through');
    return parts.length ? parts.join(' ') : 'none';
  }

  function paletteMarkup(selector, current) {
    return '<div class="card-designer-palette">' + COLOR_PALETTE.map(function (c) {
      return '<button type="button" class="card-designer-swatch' + (c.toLowerCase() === (current || '').toLowerCase() ? ' card-designer-swatch-active' : '') + '" style="background-color:' + c + '" data-swatch-target="' + escapeAttr(selector) + '" data-swatch-color="' + c + '" title="' + c + '"></button>';
    }).join('') + '</div>';
  }

  // ---------- Seletor de cor ----------
  // O seletor (quadrado + matiz + HEX + conta-gotas + recentes + favoritas + harmonia) virou o padrão
  // do app inteiro: js/colorPicker.js. Aqui só passamos as recentes do baralho e ligamos a Harmonia.
  function openColorPicker(anchorEl, currentColor, onPick, onClose) {
    GDC.colorPicker.open(anchorEl, currentColor, { onPick: onPick, onClose: onClose, recent: recentColorsRef, harmony: true });
  }
  function closeColorPopover() { GDC.colorPicker.close(); }

  /** Troca um <input type="color"> nativo (escondido) por um botão visível que abre o popover
   *  customizado — mantém toda a lógica de atualização já ligada ao input escondido (dispara
   *  'input' nele, então quem já escutava esse evento continua funcionando sem mudança nenhuma). */
  function colorTriggerMarkup(hiddenInputId, currentColor, extraAttrs) {
    return '<button type="button" class="card-designer-color-trigger" style="background-color:' + currentColor + '" data-color-trigger-for="' + escapeAttr(hiddenInputId) + '" ' + (extraAttrs || '') + '></button>';
  }
  function bindColorTrigger(scopeEl) {
    scopeEl.querySelectorAll('[data-color-trigger-for]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var targetSel = btn.getAttribute('data-color-trigger-for');
        var input = document.querySelector(targetSel);
        if (!input || input.disabled) return;
        openColorPicker(btn, input.value, function (hex) {
          input.value = hex;
          btn.style.backgroundColor = hex;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, function (finalHex) {
          if (recordRecentColorFn) recordRecentColorFn(finalHex);
        });
      });
    });
  }

  // ---------- Estado / normalização ----------

  // Baralho novo começa em branco (nenhum campo) — antes vinha com 3 campos pré-definidos
  // (Título/Ilustração/Texto), que atrapalhava quem queria montar do zero do seu jeito.
  function defaultFields() {
    return [];
  }

  function defaultState() {
    return {
      preset: 'poker', cardWidthMm: 63, cardHeightMm: 88, bgColor: '#ffffff',
      bleedMm: 0, safeMarginMm: 3, showGuides: true, snapGridMm: 0,
      fields: defaultFields(),
      rows: [{ id: makeId('r'), qty: '1' }],
      back: { enabled: false, bgColor: '#ffffff', imageId: '', mirrorForDuplex: true, duplexMode: 'long', perCardBack: false },
      customFonts: [],
      iconLibrary: [],
      recentColors: [],
      cutMarks: true,
    };
  }

  // Formas geométricas prontas (viewBox 24x24) — usadas como alternativa a enviar uma imagem pra um
  // ícone: escolhe a forma, define cor de preenchimento e de contorno.
  var SHAPE_PRESETS = [
    { id: 'circle', label: 'Círculo', svg: '<circle cx="12" cy="12" r="9"/>' },
    { id: 'square', label: 'Quadrado', svg: '<rect x="4" y="4" width="16" height="16"/>' },
    { id: 'triangle', label: 'Triângulo', svg: '<polygon points="12,3 21,20 3,20"/>' },
    { id: 'diamond', label: 'Losango', svg: '<polygon points="12,2 22,12 12,22 2,12"/>' },
    { id: 'star', label: 'Estrela', svg: '<polygon points="12,2 15,9 22,9 16,14 18,21 12,17 6,21 8,14 2,9 9,9"/>' },
    { id: 'heart', label: 'Coração', svg: '<path d="M12 21s-8-5.5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 10c0 5.5-8 11-8 11z"/>' },
    { id: 'hexagon', label: 'Hexágono', svg: '<polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/>' },
    { id: 'shield', label: 'Escudo', svg: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/>' },
    { id: 'cross', label: 'Cruz', svg: '<path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/>' },
    { id: 'moon', label: 'Lua', svg: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>' },
    { id: 'lightning', label: 'Raio', svg: '<polygon points="13,2 4,14 11,14 9,22 20,10 12,10"/>' },
    { id: 'arrow', label: 'Seta', svg: '<polygon points="12,3 20,12 15,12 15,21 9,21 9,12 4,12"/>' },
    { id: 'ribbon', label: 'Faixa', svg: '<path d="M2 7h17l3 5-3 5H2l3-5z"/>' },
    { id: 'pentagon', label: 'Pentágono', svg: '<polygon points="12,2 22,9 18,21 6,21 2,9"/>' },
  ];

  function shapeSvgMarkup(shapeId, fill, stroke, strokeWidth) {
    var shape = SHAPE_PRESETS.filter(function (s) { return s.id === shapeId; })[0];
    if (!shape) return '';
    var strokeAttr = stroke ? 'stroke="' + stroke + '" stroke-width="' + strokeWidth + '"' : 'stroke="none"';
    // width/height vão via style (CSS), não como atributo cru do SVG — um <svg> aninhado dentro de
    // um <foreignObject> só resolve width/height="100%" corretamente quando isso é CSS de verdade;
    // como atributo de apresentação "cru", o export de PNG (que rasteriza a carta via um
    // <img src="data:image/svg+xml...">, um caminho diferente da pré-visualização/impressão normal,
    // que insere isso no documento vivo) simplesmente não desenha a forma — bug real encontrado e
    // confirmado isolando o mesmo markup direto no DOM (funcionava) vs via essa rasterização
    // (ícone de forma sumia, só o emoji continuava aparecendo).
    return '<svg viewBox="0 0 24 24" style="width:100%;height:100%" fill="' + fill + '" ' + strokeAttr + ' stroke-linejoin="round" stroke-linecap="round">' + shape.svg + '</svg>';
  }

  // Curadoria de emojis úteis pra jogos de tabuleiro/cartas — organizados em grupos simples. Não é
  // uma lista exaustiva de emojis do sistema (isso pede um picker/dataset à parte); é um atalho pros
  // mais comuns, e sempre dá pra colar qualquer outro emoji direto no campo de texto ao lado.
  var EMOJI_PRESETS = [
    '🔥', '💧', '🌪️', '⚡', '❄️', '🌱', '☠️', '💀', '🩸', '⚔️', '🛡️', '🏹',
    '🗡️', '🔫', '💣', '💎', '🪙', '💰', '🔑', '📜', '⭐', '✨', '🌙', '☀️',
    '❤️', '💚', '💙', '💜', '🖤', '🤍', '👑', '🏆', '🎯', '🎲', '🃏', '🧿',
    '🐉', '🦅', '🐺', '🦉', '🐍', '🕷️', '👁️', '🧠', '🦴', '🏰', '⚓', '🧪',
  ];

  // Modelos prontos — cada campo usa xf/yf/wf/hf (fração 0-1 do tamanho ATUAL da carta, não mm fixo)
  // pra funcionar em qualquer tamanho configurado; aplicarTemplate() converte pra mm na hora. Campo
  // tipo "background" é especial: sempre estica pra cobrir carta+sangria inteira, sem precisar de
  // xf/yf/wf/hf (mesma regra que já vale pro botão "Adicionar campo → Fundo").
  var CARD_TEMPLATES = [
    {
      id: 'simples', name: 'Carta Simples', description: 'Moldura fina, título, ilustração grande e descrição — o ponto de partida mais rápido.',
      fields: [
        { type: 'background', label: 'Fundo', bgColor: '#ffffff' },
        { type: 'frame', label: 'Moldura', xf: 0.04, yf: 0.04, wf: 0.92, hf: 0.92, bgColor: null, borderColor: '#d6d3d1', borderWidthMm: 1, borderRadius: 2 },
        { type: 'text', label: 'Título', xf: 0.08, yf: 0.06, wf: 0.84, hf: 0.1, fontSize: 4.2, bold: true, align: 'center' },
        { type: 'image', label: 'Ilustração', xf: 0.08, yf: 0.19, wf: 0.84, hf: 0.43, imageFit: 'cover' },
        { type: 'text', label: 'Descrição', xf: 0.08, yf: 0.66, wf: 0.84, hf: 0.26, fontSize: 3, align: 'left' },
      ],
    },
    {
      // Inspirado na estrutura de uma carta de criatura estilo Pokémon: nome + PV na mesma linha,
      // ícone de tipo, arte grande, faixa divisória escura, texto de ataques/habilidades, e um
      // rodapé com fraqueza/resistência/recuo.
      id: 'personagem', name: 'Personagem / Criatura', description: 'Estilo carta de criatura (tipo Pokémon): nome+PV, tipo, arte grande, ataques e rodapé de fraqueza/resistência/recuo.',
      fields: [
        { type: 'background', label: 'Fundo', bgColor: '#fef9e7' },
        { type: 'frame', label: 'Moldura', xf: 0.04, yf: 0.03, wf: 0.92, hf: 0.94, bgColor: null, borderColor: '#d4a017', borderWidthMm: 2.5, borderRadius: 3 },
        { type: 'text', label: 'Nome', xf: 0.09, yf: 0.045, wf: 0.5, hf: 0.07, fontSize: 3.6, bold: true, align: 'left' },
        { type: 'text', label: 'PV', xf: 0.6, yf: 0.045, wf: 0.2, hf: 0.07, fontSize: 3.6, bold: true, align: 'right', color: '#dc2626' },
        { type: 'icons', label: 'Tipo', xf: 0.82, yf: 0.045, wf: 0.09, hf: 0.07 },
        { type: 'image', label: 'Ilustração', xf: 0.09, yf: 0.14, wf: 0.82, hf: 0.4, imageFit: 'cover' },
        { type: 'panel', label: 'Faixa nome-tipo', xf: 0.09, yf: 0.55, wf: 0.82, hf: 0.07, bgColor: '#292524', borderRadius: 1 },
        { type: 'text', label: 'Ataques', xf: 0.09, yf: 0.64, wf: 0.82, hf: 0.22, fontSize: 2.8, align: 'left' },
        { type: 'panel', label: 'Rodapé', xf: 0.09, yf: 0.87, wf: 0.82, hf: 0.07, bgColor: '#f5f5f4', borderRadius: 1 },
        { type: 'icons', label: 'Fraqueza/Resistência', xf: 0.11, yf: 0.875, wf: 0.3, hf: 0.06 },
        { type: 'text', label: 'Recuo', xf: 0.5, yf: 0.875, wf: 0.38, hf: 0.06, fontSize: 2.4, align: 'right' },
      ],
    },
    {
      id: 'item', name: 'Item / Equipamento', description: 'Tag de custo, raridade, ilustração, título, texto de ambientação em itálico e efeito mecânico.',
      fields: [
        { type: 'background', label: 'Fundo', bgColor: '#ffffff' },
        { type: 'panel', label: 'Painel', xf: 0.06, yf: 0.05, wf: 0.88, hf: 0.9, bgColor: '#eef2f6', borderRadius: 3 },
        { type: 'panel', label: 'Tag de custo', xf: 0.08, yf: 0.07, wf: 0.18, hf: 0.07, bgColor: '#1d4ed8', borderRadius: 1 },
        { type: 'text', label: 'Custo', xf: 0.08, yf: 0.076, wf: 0.18, hf: 0.058, fontSize: 2.6, bold: true, align: 'center', color: '#ffffff' },
        { type: 'icons', label: 'Raridade', xf: 0.74, yf: 0.07, wf: 0.16, hf: 0.08 },
        { type: 'image', label: 'Ilustração', xf: 0.22, yf: 0.16, wf: 0.56, hf: 0.38, imageFit: 'contain' },
        { type: 'text', label: 'Título', xf: 0.1, yf: 0.56, wf: 0.8, hf: 0.09, fontSize: 3.4, bold: true, align: 'center' },
        { type: 'text', label: 'Sabor', xf: 0.12, yf: 0.655, wf: 0.76, hf: 0.09, fontSize: 2.3, italic: true, align: 'center', color: '#78716c' },
        { type: 'text', label: 'Descrição', xf: 0.12, yf: 0.75, wf: 0.76, hf: 0.16, fontSize: 2.6, align: 'center' },
      ],
    },
    {
      // Inspirado numa carta de feitiço/mágica estilo Magic: nome + custo de mana, linha de tipo,
      // arte, caixa de texto (regras + sabor em itálico) e poder/resistência no canto.
      id: 'feitico', name: 'Feitiço / Habilidade', description: 'Estilo carta de feitiço (tipo Magic): nome+custo, linha de tipo, arte, caixa de regras+sabor e poder/resistência.',
      fields: [
        { type: 'background', label: 'Fundo', bgColor: '#312e81' },
        { type: 'frame', label: 'Moldura', xf: 0.035, yf: 0.03, wf: 0.93, hf: 0.94, bgColor: null, borderColor: '#c4b5a0', borderWidthMm: 2, borderRadius: 2 },
        { type: 'text', label: 'Nome', xf: 0.08, yf: 0.045, wf: 0.55, hf: 0.07, fontSize: 3.6, bold: true, color: '#f5f3ff' },
        { type: 'icons', label: 'Custo de mana', xf: 0.68, yf: 0.045, wf: 0.26, hf: 0.07 },
        { type: 'panel', label: 'Linha de tipo', xf: 0.08, yf: 0.13, wf: 0.84, hf: 0.055, bgColor: '#c4b5a0', borderRadius: 1 },
        { type: 'text', label: 'Tipo', xf: 0.1, yf: 0.132, wf: 0.8, hf: 0.05, fontSize: 2.4, bold: true, color: '#1c1917' },
        { type: 'image', label: 'Ilustração', xf: 0.08, yf: 0.2, wf: 0.84, hf: 0.33, imageFit: 'cover' },
        { type: 'panel', label: 'Caixa de texto', xf: 0.08, yf: 0.55, wf: 0.84, hf: 0.33, bgColor: '#f5f0e6', borderRadius: 1 },
        { type: 'text', label: 'Regras', xf: 0.11, yf: 0.575, wf: 0.78, hf: 0.19, fontSize: 2.6, color: '#1c1917' },
        { type: 'text', label: 'Sabor', xf: 0.11, yf: 0.77, wf: 0.78, hf: 0.1, fontSize: 2.3, italic: true, color: '#57534e' },
        { type: 'panel', label: 'Poder/Resistência', xf: 0.72, yf: 0.885, wf: 0.2, hf: 0.06, bgColor: '#c4b5a0', borderRadius: 1 },
        { type: 'text', label: 'P/R', xf: 0.72, yf: 0.89, wf: 0.2, hf: 0.05, fontSize: 2.6, bold: true, align: 'center', color: '#1c1917' },
      ],
    },
    {
      // Inspirado numa carta de monstro estilo Yu-Gi-Oh: nome + atributo, estrelas de nível, arte,
      // linha de tipo/raça, caixa de efeito, e ATK/DEF no rodapé.
      id: 'monstro', name: 'Monstro (nível)', description: 'Estilo carta de monstro (tipo Yu-Gi-Oh): nome+atributo, nível, arte, tipo/raça, efeito e ATK/DEF.',
      fields: [
        { type: 'background', label: 'Fundo', bgColor: '#ea580c' },
        { type: 'frame', label: 'Moldura', xf: 0.035, yf: 0.03, wf: 0.93, hf: 0.94, bgColor: null, borderColor: '#1c1917', borderWidthMm: 2, borderRadius: 2 },
        { type: 'text', label: 'Nome', xf: 0.08, yf: 0.045, wf: 0.58, hf: 0.06, fontSize: 3.4, bold: true, color: '#1c1917' },
        { type: 'icons', label: 'Atributo', xf: 0.82, yf: 0.045, wf: 0.1, hf: 0.06 },
        { type: 'icons', label: 'Nível', xf: 0.08, yf: 0.11, wf: 0.5, hf: 0.05 },
        { type: 'image', label: 'Ilustração', xf: 0.12, yf: 0.17, wf: 0.76, hf: 0.33, imageFit: 'cover' },
        { type: 'panel', label: 'Linha de tipo', xf: 0.08, yf: 0.51, wf: 0.84, hf: 0.05, bgColor: '#78350f', borderRadius: 1 },
        { type: 'text', label: 'Tipo/Raça', xf: 0.1, yf: 0.512, wf: 0.8, hf: 0.046, fontSize: 2.2, color: '#fef3c7' },
        { type: 'panel', label: 'Caixa de efeito', xf: 0.08, yf: 0.57, wf: 0.84, hf: 0.3, bgColor: '#fef3c7', borderRadius: 1 },
        { type: 'text', label: 'Efeito', xf: 0.11, yf: 0.585, wf: 0.78, hf: 0.27, fontSize: 2.5, color: '#1c1917' },
        { type: 'panel', label: 'Estatísticas', xf: 0.5, yf: 0.885, wf: 0.42, hf: 0.06, bgColor: '#1c1917', borderRadius: 1 },
        { type: 'text', label: 'ATK/DEF', xf: 0.5, yf: 0.89, wf: 0.42, hf: 0.05, fontSize: 2.6, bold: true, align: 'center', color: '#fef3c7' },
      ],
    },
  ];

  function normalizeField(f) {
    var type = 'text';
    if (f && f.type === 'image') type = 'image';
    if (f && f.type === 'icons') type = 'icons';
    if (f && f.type === 'panel') type = 'panel';
    if (f && f.type === 'frame') type = 'frame';
    if (f && f.type === 'background') type = 'background';
    return {
      id: (f && typeof f.id === 'string') ? f.id : makeId('f'),
      type: type,
      label: (f && typeof f.label === 'string') ? f.label.slice(0, 30) : 'Campo',
      x: clamp(Number(f && f.x), LIMITS.pos.min, LIMITS.pos.max),
      y: clamp(Number(f && f.y), LIMITS.pos.min, LIMITS.pos.max),
      w: clamp(Number(f && f.w) || 20, 1, LIMITS.dim.max),
      h: clamp(Number(f && f.h) || 10, 1, LIMITS.dim.max),
      fontSize: clamp(Number(f && f.fontSize) || 4, LIMITS.font.min, LIMITS.font.max),
      align: (f && (f.align === 'center' || f.align === 'right')) ? f.align : 'left',
      color: (f && typeof f.color === 'string') ? f.color : '#18181b',
      fontFamily: normalizeFontFamily(f && f.fontFamily),
      bold: !!(f && f.bold),
      italic: !!(f && f.italic),
      underline: !!(f && f.underline),
      strikethrough: !!(f && f.strikethrough),
      bgColor: (f && typeof f.bgColor === 'string') ? f.bgColor : null,
      borderRadius: clamp(Number(f && f.borderRadius) || 0, LIMITS.radius.min, LIMITS.radius.max),
      paddingMm: clamp(Number(f && f.paddingMm) || 0, LIMITS.padding.min, LIMITS.padding.max),
      imageFit: (f && f.imageFit === 'contain') ? 'contain' : 'cover',
      rotation: normalizeAngle(f && f.rotation),
      // Cor/espessura de borda — disponível pra qualquer tipo de campo (é só CSS border por cima do
      // que já existia), não só Painel/Moldura/Fundo como quando foi introduzida.
      borderColor: (f && typeof f.borderColor === 'string') ? f.borderColor : null,
      borderWidthMm: clamp(Number(f && f.borderWidthMm) || 0, 0, LIMITS.padding.max),
      // Bloqueio — campo travado não move/redimensiona/gira por arraste nem responde a
      // Delete/setas; ainda dá pra selecionar (pra poder destravar) e editar valores digitados.
      locked: !!(f && f.locked),      // Opacidade do campo inteiro (0-100%) — CSS opacity puro, então cobre texto/imagem/formas
      // igual, sem precisar de um caminho de renderização separado por tipo.
      opacity: (f && isFinite(Number(f.opacity))) ? clamp(Number(f.opacity), 0, 100) : 100,
      // Sombra projetada — desligada por padrão; quando ligada, um único offset diagonal (mais
      // simples que 2 eixos independentes) e raio de desfoque configuráveis.
      shadow: !!(f && f.shadow),
      shadowColor: (f && typeof f.shadowColor === 'string') ? f.shadowColor : '#000000',
      shadowBlurMm: clamp(Number(f && f.shadowBlurMm) || 0, 0, 20),
      shadowOffsetMm: clamp(Number(f && f.shadowOffsetMm) || 0, 0, 20),
      // Gradiente — quando ligado, substitui a cor de fundo sólida (bgColor) por um degradê de
      // bgColor até gradientColor2, na direção escolhida.
      gradient: !!(f && f.gradient),
      gradientColor2: (f && typeof f.gradientColor2 === 'string') ? f.gradientColor2 : '#ffffff',
      gradientDirection: ['to right', 'to bottom', 'to bottom right', 'to top'].indexOf(f && f.gradientDirection) !== -1 ? f.gradientDirection : 'to bottom',
      // Forma da camada (só usada pelo tipo Painel) — 'rect' é o padrão de sempre (caixa comum);
      // qualquer outro valor precisa ser um id válido de SHAPE_PRESETS (círculo, losango, faixa...).
      shape: (f && f.shape && SHAPE_PRESETS.some(function (s) { return s.id === f.shape; })) ? f.shape : 'rect',
    };
  }

  // Um ícone da biblioteca do PROJETO (compartilhada por todos os campos do tipo "ícones" do
  // baralho inteiro — ver migrateIconsToLibrary logo abaixo pra migração de baralhos antigos, que
  // guardavam um iconSet próprio por campo).
  function normalizeLibraryIcon(ic) {
    return {
      id: (ic && typeof ic.id === 'string') ? ic.id : makeId('ic'),
      name: (ic && typeof ic.name === 'string') ? ic.name.slice(0, 20) : 'ícone',
      imageId: (ic && typeof ic.imageId === 'string') ? ic.imageId : '',
      shape: (ic && SHAPE_PRESETS.some(function (s) { return s.id === ic.shape; })) ? ic.shape : '',
      shapeFill: (ic && typeof ic.shapeFill === 'string') ? ic.shapeFill : '#3b82f6',
      shapeStroke: (ic && typeof ic.shapeStroke === 'string') ? ic.shapeStroke : null,
      shapeStrokeWidth: clamp(Number(ic && ic.shapeStrokeWidth) || 1, 0.5, 4),
      emoji: (ic && typeof ic.emoji === 'string') ? ic.emoji.slice(0, 8) : '',
    };
  }

  function iconDefsEqual(a, b) {
    return a.emoji === b.emoji && a.shape === b.shape && a.shapeFill === b.shapeFill && a.shapeStroke === b.shapeStroke && a.imageId === b.imageId;
  }

  // Baralhos salvos antes da biblioteca de ícones virar compartilhada guardavam um `iconSet` PRÓPRIO
  // por campo (mesmo ícone precisava ser cadastrado de novo em cada campo pra poder ser usado nele).
  // Migra isso pra `state.iconLibrary` (um array só, do baralho inteiro) — mescla por nome; quando
  // dois campos tinham ícones de MESMO NOME mas definições diferentes, desambigua renomeando o
  // segundo ("nome (2)") e reescreve os tokens das linhas que usavam esse nome, pra não perder qual
  // ícone cada carta tinha. Idempotente — se `iconLibrary` já existe, não faz nada.
  //
  // Recebe `rawFields` (os campos ANTES de passar por normalizeField) porque normalizeField() não
  // reconhece mais `iconSet` como propriedade de campo — se essa função lesse de `state.fields`
  // (já normalizado), o `iconSet` já teria sido descartado antes de chegar aqui, e a migração nunca
  // encontraria nada pra migrar (bug real: rodava sem erro, só que sempre com biblioteca vazia).
  function migrateIconsToLibrary(state, rawFields) {
    if (Array.isArray(state.iconLibrary)) return;
    state.iconLibrary = [];
    var byName = {};
    (rawFields || []).forEach(function (rf) {
      if (!rf || rf.type !== 'icons' || !Array.isArray(rf.iconSet)) return;
      var f = state.fields.filter(function (x) { return x.id === rf.id; })[0];
      if (!f) return;
      var renameMap = {};
      rf.iconSet.slice(0, LIMITS.icons.max).forEach(function (rawIc) {
        var ic = normalizeLibraryIcon(rawIc);
        var key = ic.name.toLowerCase();
        var existing = byName[key];
        if (existing && iconDefsEqual(existing, ic)) return; // já existe, idêntico -- reaproveita
        if (existing) {
          var n = 2;
          while (byName[(ic.name + ' (' + n + ')').toLowerCase()]) n++;
          renameMap[key] = ic.name + ' (' + n + ')';
          ic.name = renameMap[key];
        }
        byName[ic.name.toLowerCase()] = ic;
        state.iconLibrary.push(ic);
      });
      if (Object.keys(renameMap).length) {
        state.rows.forEach(function (row) {
          var tokens = parseIconTokens(row[f.id]);
          if (!tokens.length) return;
          var changed = false;
          var newTokens = tokens.map(function (t) {
            var mapped = renameMap[t.toLowerCase()];
            if (mapped) { changed = true; return mapped; }
            return t;
          });
          if (changed) row[f.id] = newTokens.join(', ');
        });
      }
    });
  }

  function ensureRowFields(state) {
    state.rows.forEach(function (row) {
      state.fields.forEach(function (f) {
        if (typeof row[f.id] !== 'string') row[f.id] = '';
      });
      if (typeof row.qty !== 'string' || !row.qty.trim()) row.qty = '1';
    });
  }

  function parseStored(value) {
    var fallback = defaultState();
    if (!value) { ensureRowFields(fallback); return fallback; }
    try {
      var p = JSON.parse(value);
      var fields = Array.isArray(p.fields) ? p.fields.slice(0, LIMITS.fields.max).map(normalizeField) : null;
      if (!fields || !fields.length) fields = fallback.fields;

      var rows = Array.isArray(p.rows) ? p.rows.slice(0, LIMITS.rows.max).map(function (r) {
        var row = { id: (r && typeof r.id === 'string') ? r.id : makeId('r'), qty: String(clamp(Number(r && r.qty) || 1, 1, 999)), backImageId: (r && typeof r.backImageId === 'string') ? r.backImageId : '' };
        fields.forEach(function (f) { row[f.id] = (r && typeof r[f.id] === 'string') ? r[f.id] : ''; });
        return row;
      }) : null;
      if (!rows || !rows.length) rows = [{ id: makeId('r'), qty: '1' }];

      var back = {
        enabled: !!(p.back && p.back.enabled),
        bgColor: (p.back && typeof p.back.bgColor === 'string') ? p.back.bgColor : '#ffffff',
        imageId: (p.back && typeof p.back.imageId === 'string') ? p.back.imageId : '',
        mirrorForDuplex: !(p.back && p.back.mirrorForDuplex === false),
        duplexMode: (p.back && p.back.duplexMode === 'short') ? 'short' : 'long',
        perCardBack: !!(p.back && p.back.perCardBack),
      };

      var state = {
        preset: (p && typeof p.preset === 'string') ? p.preset : 'custom',
        cardWidthMm: clamp(Number(p && p.cardWidthMm), LIMITS.dim.min, LIMITS.dim.max) || fallback.cardWidthMm,
        cardHeightMm: clamp(Number(p && p.cardHeightMm), LIMITS.dim.min, LIMITS.dim.max) || fallback.cardHeightMm,
        bgColor: (p && typeof p.bgColor === 'string') ? p.bgColor : '#ffffff',
        bleedMm: clamp(Number(p && p.bleedMm) || 0, 0, LIMITS.bleed.max),
        safeMarginMm: (p && p.safeMarginMm !== undefined) ? clamp(Number(p.safeMarginMm), 0, LIMITS.bleed.max) : 3,
        showGuides: !(p && p.showGuides === false),
        snapGridMm: [0, 1, 2, 5, 10].indexOf(Number(p && p.snapGridMm)) !== -1 ? Number(p.snapGridMm) : 0,
        customFonts: Array.isArray(p && p.customFonts) ? p.customFonts.slice(0, LIMITS.customFonts.max).map(function (cf) {
          return {
            id: (cf && typeof cf.id === 'string') ? cf.id : makeId('cf'),
            family: (cf && typeof cf.family === 'string') ? cf.family.slice(0, 40) : 'Fonte',
            fontFileId: (cf && typeof cf.fontFileId === 'string') ? cf.fontFileId : '',
          };
        }) : [],
        fields: fields, rows: rows, back: back,
        recentColors: Array.isArray(p && p.recentColors) ? p.recentColors.filter(function (c) { return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c); }).slice(0, 10) : [],
        cutMarks: !(p && p.cutMarks === false),
      };
      if (Array.isArray(p.iconLibrary)) state.iconLibrary = p.iconLibrary.slice(0, LIMITS.icons.max * 4).map(normalizeLibraryIcon);
      migrateIconsToLibrary(state, Array.isArray(p.fields) ? p.fields : []); // idempotente — não faz nada se iconLibrary já foi setado acima
      ensureRowFields(state);
      return state;
    } catch (e) {
      ensureRowFields(fallback);
      return fallback;
    }
  }

  function parseIconTokens(str) {
    return String(str || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // Painel/Moldura/Fundo são elementos de LAYOUT do baralho inteiro (a mesma moldura em toda carta),
  // não dado por carta — diferente de texto/imagem/ícones, que variam linha a linha. Por isso não
  // ganham coluna na tabela "Cartas" (nem no header nem no corpo): mostrar uma textarea vazia e sem
  // uso nenhum ali só teria poluído a tabela sem servir pra nada.
  function isPerCardDataField(f) { return f.type === 'text' || f.type === 'image' || f.type === 'icons'; }

  // ---------- Formatação parcial dentro do texto ----------
  // Marcação leve tipo markdown: **negrito**, *itálico*, __sublinhado__, ~~tachado~~. É aditiva sobre
  // o estilo base do campo (não substitui negrito/itálico/etc. já ligados no campo inteiro).

  function parseInlineMarkup(text) {
    var segments = [];
    var re = /(\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(.+?)\*)/g;
    var lastIndex = 0, match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index) });
      if (match[2] !== undefined) segments.push({ text: match[2], bold: true });
      else if (match[3] !== undefined) segments.push({ text: match[3], underline: true });
      else if (match[4] !== undefined) segments.push({ text: match[4], strike: true });
      else if (match[5] !== undefined) segments.push({ text: match[5], italic: true });
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });
    return segments;
  }

  function inlineMarkupHtml(text) {
    return parseInlineMarkup(String(text || '')).map(function (seg) {
      var styles = [];
      if (seg.bold) styles.push('font-weight:700');
      if (seg.italic) styles.push('font-style:italic');
      var deco = [];
      if (seg.underline) deco.push('underline');
      if (seg.strike) deco.push('line-through');
      if (deco.length) styles.push('text-decoration-line:' + deco.join(' '));
      if (!styles.length) return escapeHtml(seg.text);
      return '<span style="' + styles.join(';') + '">' + escapeHtml(seg.text) + '</span>';
    }).join('');
  }

  // Igual inlineMarkupHtml() acima, mas pro MODO DE EDIÇÃO (contenteditable) — a diferença crucial é
  // que os marcadores (**, __, ~~, *) NUNCA são removidos do texto, só ficam visualmente discretos
  // (opacidade baixa via .cd-live-marker). Remover os marcadores do DOM, como inlineMarkupHtml() faz,
  // perderia informação: o texto puro (el.textContent) deixaria de bater com o markdown de origem, e
  // não teria como reconstruir a string salva em state.rows a partir do que está editável na tela.
  // Preservando os marcadores, o texto puro ANTES e DEPOIS de renderizar é sempre idêntico — só ganha
  // <span>s por cima — o que também é o que deixa o reposicionamento do cursor (ver
  // getPlainTextCaretOffset/setPlainTextCaretOffset) simples e confiável.
  function liveInlineMarkupHtml(text) {
    var segments = [];
    var re = /(\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*(.+?)\*)/g;
    var lastIndex = 0, match;
    while ((match = re.exec(text)) !== null) {
      if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index) });
      if (match[2] !== undefined) segments.push({ marker: '**', inner: match[2], bold: true });
      else if (match[3] !== undefined) segments.push({ marker: '__', inner: match[3], underline: true });
      else if (match[4] !== undefined) segments.push({ marker: '~~', inner: match[4], strike: true });
      else if (match[5] !== undefined) segments.push({ marker: '*', inner: match[5], italic: true });
      lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });
    return segments.map(function (seg) {
      if (seg.marker === undefined) return escapeHtml(seg.text);
      var styles = [];
      if (seg.bold) styles.push('font-weight:700');
      if (seg.italic) styles.push('font-style:italic');
      var deco = [];
      if (seg.underline) deco.push('underline');
      if (seg.strike) deco.push('line-through');
      if (deco.length) styles.push('text-decoration-line:' + deco.join(' '));
      var markerHtml = '<span class="cd-live-marker">' + escapeHtml(seg.marker) + '</span>';
      return markerHtml + '<span style="' + styles.join(';') + '">' + escapeHtml(seg.inner) + '</span>' + markerHtml;
    }).join('');
  }

  // Deslocamento do cursor em CARACTERES DE TEXTO PURO desde o início de `el` — ignora onde a marcação
  // HTML (spans) está, então continua válido antes/depois de re-renderizar liveInlineMarkupHtml (que
  // nunca adiciona/remove caractere de texto, só embrulha em spans — ver comentário acima).
  function getPlainTextCaretOffset(el) {
    var sel = global.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return null;
    var pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  // Inverso de getPlainTextCaretOffset — anda pelos nós de texto descendentes de `el` até achar o que
  // contém o caractere de número `offset`, e posiciona o cursor ali.
  function setPlainTextCaretOffset(el, offset) {
    var range = document.createRange();
    var charsLeft = offset, found = false;
    (function walk(node) {
      if (found) return;
      if (node.nodeType === 3) {
        var len = node.textContent.length;
        if (charsLeft <= len) { range.setStart(node, charsLeft); range.setEnd(node, charsLeft); found = true; }
        else charsLeft -= len;
      } else {
        for (var i = 0; i < node.childNodes.length && !found; i++) walk(node.childNodes[i]);
      }
    })(el);
    if (!found) { range.selectNodeContents(el); range.collapse(false); }
    var sel = global.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** Envolve (ou desenvolve, se já estiver envolvido) o trecho selecionado num <textarea> com o
   *  marcador de formatação (**negrito**, *itálico*, __sublinhado__, ~~tachado~~) — é a mesma
   *  marcação que inlineMarkupHtml() já sabe interpretar, então nenhuma peça da renderização precisa
   *  mudar; só ganha um jeito de aplicar clicando/selecionando em vez de digitar os símbolos à mão. */
  function toggleTextWrap(textarea, marker) {
    var start = textarea.selectionStart, end = textarea.selectionEnd;
    if (start === end) { textarea.focus(); return; } // nada selecionado — não faz nada
    var value = textarea.value;
    var selected = value.slice(start, end);
    var before = value.slice(0, start), after = value.slice(end);
    var mLen = marker.length;
    var wrappedInside = selected.length >= 2 * mLen && selected.slice(0, mLen) === marker && selected.slice(-mLen) === marker;
    var wrappedOutside = before.slice(-mLen) === marker && after.slice(0, mLen) === marker;
    var newValue, newStart, newEnd;
    if (wrappedInside) {
      var unwrapped = selected.slice(mLen, selected.length - mLen);
      newValue = before + unwrapped + after;
      newStart = start; newEnd = start + unwrapped.length;
    } else if (wrappedOutside) {
      newValue = before.slice(0, before.length - mLen) + selected + after.slice(mLen);
      newStart = start - mLen; newEnd = end - mLen;
    } else {
      newValue = before + marker + selected + marker + after;
      newStart = start + mLen; newEnd = end + mLen;
    }
    textarea.value = newValue;
    textarea.focus();
    textarea.setSelectionRange(newStart, newEnd);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Mesma lógica de toggleTextWrap() acima, adaptada pra um elemento contenteditable (o campo de
   *  texto editado direto no canvas) em vez de um <textarea> — contenteditable não tem
   *  selectionStart/selectionEnd, então usa window.getSelection()/Range, convertendo pra deslocamento
   *  em caracteres de texto puro (mesma técnica de getPlainTextCaretOffset) em vez de usar
   *  range.startOffset/endOffset direto — que só seriam índices válidos em el.textContent se o
   *  elemento tivesse um único nó de texto dentro, o que deixou de ser verdade desde que
   *  liveInlineMarkupHtml passou a renderizar spans de marcação ao vivo (ver bindActiveTextEdit).
   *  Devolve false sem fazer nada se não houver texto selecionado dentro do elemento. */
  function toggleTextWrapEditable(el, marker) {
    var sel = global.getSelection();
    if (!sel || !sel.rangeCount) return false;
    var range = sel.getRangeAt(0);
    if (range.collapsed || !el.contains(range.commonAncestorContainer)) return false;
    var startRange = range.cloneRange();
    startRange.selectNodeContents(el);
    startRange.setEnd(range.startContainer, range.startOffset);
    var start = startRange.toString().length;
    var end = start + range.toString().length;
    var value = el.textContent;
    var selected = value.slice(start, end);
    var before = value.slice(0, start), after = value.slice(end);
    var mLen = marker.length;
    var wrappedInside = selected.length >= 2 * mLen && selected.slice(0, mLen) === marker && selected.slice(-mLen) === marker;
    var wrappedOutside = before.slice(-mLen) === marker && after.slice(0, mLen) === marker;
    var newValue, newStart, newEnd;
    if (wrappedInside) {
      var unwrapped = selected.slice(mLen, selected.length - mLen);
      newValue = before + unwrapped + after;
      newStart = start; newEnd = start + unwrapped.length;
    } else if (wrappedOutside) {
      newValue = before.slice(0, before.length - mLen) + selected + after.slice(mLen);
      newStart = start - mLen; newEnd = end - mLen;
    } else {
      newValue = before + marker + selected + marker + after;
      newStart = start + mLen; newEnd = end + mLen;
    }
    el.textContent = newValue;
    el.focus();
    var newRange = document.createRange();
    var node = el.firstChild || el;
    newRange.setStart(node, newStart);
    newRange.setEnd(node, newEnd);
    sel.removeAllRanges();
    sel.addRange(newRange);
    // Setar textContent na mão não dispara 'input' sozinho (só digitação de verdade dispara) — o
    // listener já ligado em bindActiveTextEdit é quem persiste e sincroniza a tabela "Cartas".
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  // ---------- CSV ----------

  function csvEscape(value) {
    var s = String(value == null ? '' : value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function rowsToCsv(fields, rows) {
    var header = fields.map(function (f) { return csvEscape(f.label); }).concat(['Cópias']).join(',');
    var lines = rows.map(function (r) {
      return fields.map(function (f) { return csvEscape(r[f.id] || ''); }).concat([csvEscape(r.qty || '1')]).join(',');
    });
    return [header].concat(lines).join('\r\n');
  }

  // Parser RFC4180-ish simples: respeita campos entre aspas (com vírgula/quebra de linha dentro) e
  // aspas duplicadas como escape ("" dentro de um campo vira ").
  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var len = text.length;
    while (i < len) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
    return rows.filter(function (r) { return r.length > 1 || (r[0] || '').trim() !== ''; });
  }

  // ---------- Render ----------

  var currentKeyHandler = null; // idem, pros atalhos de teclado (desfazer/refazer)

  // Histórico de desfazer/refazer fica em escopo de módulo (fora de render()) pra sobreviver aos
  // re-renders completos que undo()/redo() disparam — ver applyHistoryState(). Reseta sempre que a
  // ferramenta monta de novo com um valor novo (troca de projeto, import, etc.), exceto quando o
  // próprio undo/redo é quem chamou render() (flag skipHistoryReset).
  var moduleHistory = [];
  var moduleHistoryIndex = -1;
  var skipHistoryReset = false;

  // Cores recentes: lista compartilhada em escopo de módulo, igual o histórico acima — o seletor de
  // cor (openColorPicker) é uma função de módulo, sem acesso direto ao `state` do render() atual, e
  // só existe UMA instância do Designer de Cartas montada por vez. render() reatribui essas duas
  // referências a cada montagem, sempre apontando pra `state.recentColors` do documento carregado.
  var recentColorsRef = [];
  var recordRecentColorFn = null;

  function render(container, onChange) {
    var state = parseStored(container.getAttribute('data-value'));
    var selectedRowId = state.rows[0].id;
    var exporting = false;
    var exportingPng = false;
    var exportingPdf = false;
    var collapsedFields = {};

    if (!skipHistoryReset) {
      moduleHistory = [JSON.stringify(state)];
      moduleHistoryIndex = 0;
    }
    skipHistoryReset = false;

    recentColorsRef = state.recentColors;
    recordRecentColorFn = function (hex) {
      if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return;
      var h = hex.toLowerCase();
      state.recentColors = [h].concat(state.recentColors.filter(function (c) { return c.toLowerCase() !== h; })).slice(0, 10);
      recentColorsRef = state.recentColors;
      persist();
    };

    googleFontStatusListener = function (name, status) {
      // Só precisa atualizar a UI se a fonte que mudou de status for a do campo SELECIONADO agora —
      // pra qualquer outra, o aviso (se precisar) aparece na próxima vez que a pessoa abrir aquele
      // campo (updateContextToolbar já lê loadedGoogleFonts na hora de montar o HTML).
      var f = state.fields.filter(function (x) { return x.id === selectedFieldId; })[0];
      if (f && f.type === 'text' && f.fontFamily === 'google:' + name) updateContextToolbar();
    };

    container.innerHTML =
      '<div class="card-designer" id="cd-stage">' +
      '  <div class="card-designer-shell" id="cd-shell">' +

      '    <div class="card-designer-rail">' +
      '      <button type="button" class="card-designer-rail-btn" data-ribbon-tab="elements" title="Elementos">' + GDC.icon('shapes', { size: 19 }) + '</button>' +
      '      <button type="button" class="card-designer-rail-btn" data-ribbon-tab="layers" title="Camadas">' + GDC.icon('layers', { size: 19 }) + '</button>' +
      '      <button type="button" class="card-designer-rail-btn" data-ribbon-tab="cards" title="Cartas">' + GDC.icon('file-text', { size: 19 }) + '</button>' +
      '      <button type="button" class="card-designer-rail-btn" data-ribbon-tab="config" title="Config">' + GDC.icon('sliders', { size: 19 }) + '</button>' +
      '      <div class="card-designer-rail-spacer"></div>' +
      '      <button type="button" class="card-designer-rail-btn" id="cd-undo" title="Desfazer (Ctrl+Z)" disabled>' + GDC.icon('undo-2', { size: 17 }) + '</button>' +
      '      <button type="button" class="card-designer-rail-btn" id="cd-redo" title="Refazer (Ctrl+Y)" disabled>' + GDC.icon('rotate-ccw', { size: 17, className: 'card-designer-redo-icon' }) + '</button>' +
      '      <button type="button" class="card-designer-rail-btn" id="cd-help" title="Ajuda">' + GDC.icon('help-circle', { size: 18 }) + '</button>' +
      '    </div>' +

      '    <div class="card-designer-rail-panel" id="cd-rail-panel">' +
      '      <button type="button" class="card-designer-rail-panel-close" id="cd-rail-panel-close" title="Fechar painel">' + GDC.icon('x', { size: 15 }) + '</button>' +

      '      <div id="cd-ribbon-elements" class="card-surface">' +
      '        <h3 class="font-display text-xs font-bold text-primary mb-1">Adicionar elemento</h3>' +
      '        <p class="text-xs text-muted mb-3">Clique pra criar e posicionar automaticamente perto do centro da carta — depois é só arrastar.</p>' +
      '        <div class="card-designer-element-grid">' +
      '          <button type="button" class="card-designer-element-btn" data-quick-add="text">' + GDC.icon('type', { size: 20 }) + '<span>Texto</span></button>' +
      '          <button type="button" class="card-designer-element-btn" data-quick-add="image">' + GDC.icon('image', { size: 20 }) + '<span>Imagem</span></button>' +
      '          <button type="button" class="card-designer-element-btn" data-quick-add="shape">' + GDC.icon('shapes', { size: 20 }) + '<span>Formas</span></button>' +
      '          <button type="button" class="card-designer-element-btn" data-quick-add="iconset">' + GDC.icon('star', { size: 20 }) + '<span>Ícones</span></button>' +
      '          <button type="button" class="card-designer-element-btn" data-quick-add="panel">' + GDC.icon('square', { size: 20 }) + '<span>Painel</span></button>' +
      '          <button type="button" class="card-designer-element-btn" data-quick-add="frame">' + GDC.icon('maximize-2', { size: 20 }) + '<span>Moldura</span></button>' +
      '          <button type="button" class="card-designer-element-btn" data-quick-add="background">' + GDC.icon('layout-dashboard', { size: 20 }) + '<span>Fundo</span></button>' +
      '        </div>' +
      '        <div class="card-designer-field-card-row card-designer-iconset" style="margin-top:1.25rem">' +
      '          <div class="flex items-center justify-between w-full">' +
      '            <p class="text-xs text-secondary" title="Compartilhada entre todos os campos de ícones do baralho">Biblioteca de ícones do baralho</p>' +
      '            <button type="button" class="btn-ghost py-1 text-xs" data-add-icon>' + GDC.icon('plus', { size: 11 }) + 'Ícone</button>' +
      '          </div>' +
      '          <div class="card-designer-iconset-list" data-iconset-list>' + state.iconLibrary.map(function (ic) { return iconSetRowMarkup(ic); }).join('') + '</div>' +
      '        </div>' +
      '      </div>' +

      '      <div id="cd-ribbon-layers" class="card-surface" style="display:none">' +
      '        <div class="flex items-center justify-between mb-2">' +
      '          <h3 class="font-display text-xs font-bold text-primary">Camadas</h3>' +
      '          <div class="flex items-center gap-1">' +
      '            <div class="card-designer-add-field-wrap">' +
      '              <button type="button" id="cd-templates-btn" class="btn-ghost py-1.5 text-xs" title="Substitui os campos atuais por um layout pronto">' + GDC.icon('layout-dashboard', { size: 12 }) + 'Modelos</button>' +
      '              <div id="cd-templates-menu" class="card-designer-add-field-menu" style="display:none;min-width:14rem">' +
      CARD_TEMPLATES.map(function (tpl) {
        return '<button type="button" class="card-designer-add-field-menu-item" style="flex-direction:column;align-items:flex-start;gap:.125rem" data-apply-template="' + tpl.id + '" title="' + escapeAttr(tpl.description) + '">' +
          '<span style="font-weight:600">' + escapeHtml(tpl.name) + '</span>' +
          '<span class="text-muted" style="font-size:.6875rem;font-weight:400;white-space:normal">' + escapeHtml(tpl.description) + '</span>' +
          '</button>';
      }).join('') +
      '              </div>' +
      '            </div>' +
      '            <div class="card-designer-add-field-wrap">' +
      '              <button type="button" id="cd-add-field" class="btn-ghost py-1.5 text-xs">' + GDC.icon('plus', { size: 12 }) + 'Adicionar campo</button>' +
      '              <div id="cd-add-field-menu" class="card-designer-add-field-menu" style="display:none">' +
      '                <button type="button" class="card-designer-add-field-menu-item" data-quick-add-menu="text">' + GDC.icon('type', { size: 14 }) + 'Texto</button>' +
      '                <button type="button" class="card-designer-add-field-menu-item" data-quick-add-menu="image">' + GDC.icon('image', { size: 14 }) + 'Imagem</button>' +
      '                <button type="button" class="card-designer-add-field-menu-item" data-quick-add-menu="iconset">' + GDC.icon('star', { size: 14 }) + 'Ícones</button>' +
      '                <button type="button" class="card-designer-add-field-menu-item" data-quick-add-menu="shape">' + GDC.icon('shapes', { size: 14 }) + 'Forma</button>' +
      '                <button type="button" class="card-designer-add-field-menu-item" data-quick-add-menu="panel">' + GDC.icon('square', { size: 14 }) + 'Painel</button>' +
      '                <button type="button" class="card-designer-add-field-menu-item" data-quick-add-menu="frame">' + GDC.icon('maximize-2', { size: 14 }) + 'Moldura</button>' +
      '                <button type="button" class="card-designer-add-field-menu-item" data-quick-add-menu="background">' + GDC.icon('layout-dashboard', { size: 14 }) + 'Fundo</button>' +
      '              </div>' +
      '            </div>' +
      '          </div>' +
      '        </div>' +
      '        <div id="cd-fields-list" class="space-y-3"></div>' +
      '      </div>' +

      '      <div id="cd-ribbon-cards" class="card-surface" style="display:none">' +
      '        <div class="flex items-center justify-between gap-2 flex-wrap mb-2">' +
      '          <h3 class="font-display text-xs font-bold text-primary">Cartas (' + state.rows.length + ')</h3>' +
      '          <div class="flex items-center gap-2 flex-wrap">' +
      '            <div class="card-designer-view-tabs" style="margin:0">' +
      '              <button type="button" class="card-designer-view-tab card-designer-view-tab-active" data-cards-view="grid" title="Ver como grade visual">' + GDC.icon('layout-grid', { size: 13 }) + '</button>' +
      '              <button type="button" class="card-designer-view-tab" data-cards-view="table" title="Ver como tabela de dados">' + GDC.icon('table', { size: 13 }) + '</button>' +
      '            </div>' +
      '            <button type="button" id="cd-export-csv" class="btn-ghost py-1.5 text-xs" title="Exportar a tabela de dados como CSV">' + GDC.icon('file-down', { size: 12 }) + 'CSV</button>' +
      '            <button type="button" id="cd-import-csv" class="btn-ghost py-1.5 text-xs" title="Importar de um CSV (substitui as cartas atuais)">' + GDC.icon('file-json', { size: 12 }) + 'Importar CSV</button>' +
      '            <button type="button" id="cd-add-row" class="btn-ghost py-1.5 text-xs">' + GDC.icon('plus', { size: 12 }) + 'Adicionar carta</button>' +
      '          </div>' +
      '        </div>' +
      '        <p class="text-xs text-muted mb-2">Clique numa carta pra selecionar ela (o preview e a aba Camadas passam a editar ela). O conteúdo de cada campo edita-se em Camadas — aqui é só visão geral, quantidade e organização das cartas.</p>' +
      '        <div class="card-designer-cards-grid" id="cd-cards-grid"></div>' +
      '        <div class="card-designer-table-scroll" id="cd-table-scroll" style="display:none">' +
      '          <table class="card-designer-table" id="cd-table"></table>' +
      '        </div>' +
      '      </div>' +

      '      <div id="cd-ribbon-config" class="card-surface" style="display:none">' +
      '        <div class="card-designer-config">' +
      '          <div class="flex flex-wrap items-end gap-3">' +
      '            <label class="text-xs text-secondary">Tamanho da carta' +
      '              <select id="cd-preset" class="input-field mt-1">' +
      PRESETS.map(function (p) { return '<option value="' + p.id + '"' + (p.id === state.preset ? ' selected' : '') + '>' + escapeHtml(p.label) + '</option>'; }).join('') +
      '              </select>' +
      '            </label>' +
      '            <label class="text-xs text-secondary">Largura (mm)<input type="number" min="' + LIMITS.dim.min + '" max="' + LIMITS.dim.max + '" id="cd-width" value="' + state.cardWidthMm + '" class="input-field mt-1 w-20 py-1.5 text-xs" ' + (state.preset !== 'custom' ? 'disabled' : '') + ' /></label>' +
      '            <label class="text-xs text-secondary">Altura (mm)<input type="number" min="' + LIMITS.dim.min + '" max="' + LIMITS.dim.max + '" id="cd-height" value="' + state.cardHeightMm + '" class="input-field mt-1 w-20 py-1.5 text-xs" ' + (state.preset !== 'custom' ? 'disabled' : '') + ' /></label>' +
      '            <div class="text-xs text-secondary">Cor de fundo' +
      '              <div class="flex items-center gap-2 mt-1"><input type="color" id="cd-bg" value="' + state.bgColor + '" class="card-designer-color-input-hidden" />' + colorTriggerMarkup('#cd-bg', state.bgColor) + '</div>' +
      '            </div>' +
      '          </div>' +
      '          <div class="flex flex-wrap items-end gap-3 mt-3">' +
      '            <label class="text-xs text-secondary">Sangria (mm)<input type="number" min="0" max="' + LIMITS.bleed.max + '" step="0.5" id="cd-bleed" value="' + state.bleedMm + '" class="input-field mt-1 w-20 py-1.5 text-xs" title="Estende o fundo da carta além da linha de corte, pra não sobrar friso branco se o corte desalinhar um pouco" /></label>' +
      '            <label class="text-xs text-secondary">Margem de segurança (mm)<input type="number" min="0" max="' + LIMITS.bleed.max + '" step="0.5" id="cd-safe-margin" value="' + state.safeMarginMm + '" class="input-field mt-1 w-20 py-1.5 text-xs" title="Guia visual (só no preview) — evite colocar texto importante mais perto da borda do que isso" /></label>' +
      '            <label class="text-xs text-secondary flex items-center gap-2" style="padding-bottom:.5rem">' +
      '              <input type="checkbox" id="cd-show-guides" ' + (state.showGuides ? 'checked' : '') + ' /> Mostrar guias no preview' +
      '            </label>' +
      '            <label class="text-xs text-secondary flex items-center gap-2" style="padding-bottom:.5rem" title="Pequenas linhas no canto de cada carta na folha impressa, marcando onde cortar — padrão de gráfica profissional">' +
      '              <input type="checkbox" id="cd-cut-marks" ' + (state.cutMarks ? 'checked' : '') + ' /> Marcas de corte na impressão' +
      '            </label>' +
      '            <label class="text-xs text-secondary">Posicionamento<select id="cd-snap-grid" class="input-field mt-1 py-1.5 text-xs" title="Além do encaixe em centro/borda, trava a posição e o tamanho dos campos numa grade fixa">' +
      '              <option value="0"' + (state.snapGridMm === 0 ? ' selected' : '') + '>Livre</option>' +
      '              <option value="1"' + (state.snapGridMm === 1 ? ' selected' : '') + '>Grade de 1mm</option>' +
      '              <option value="2"' + (state.snapGridMm === 2 ? ' selected' : '') + '>Grade de 2mm</option>' +
      '              <option value="5"' + (state.snapGridMm === 5 ? ' selected' : '') + '>Grade de 5mm</option>' +
      '              <option value="10"' + (state.snapGridMm === 10 ? ' selected' : '') + '>Grade de 10mm</option>' +
      '            </select></label>' +
      '          </div>' +
      '        </div>' +
      '        <div class="card-designer-back mt-4">' +
      '          <label class="flex items-center gap-2 text-xs font-bold text-primary">' +
      '            <input type="checkbox" id="cd-back-enabled" ' + (state.back.enabled ? 'checked' : '') + ' /> Verso da carta' +
      '          </label>' +
      '          <p class="mt-1 text-xs text-muted">Um único verso compartilhado por todas as cartas do baralho (cor de fundo + uma imagem opcional cobrindo a carta inteira) — veja o resultado clicando em "Verso" acima do preview.</p>' +
      '          <div id="cd-back-body" class="mt-3" style="' + (state.back.enabled ? '' : 'display:none') + '"></div>' +
      '        </div>' +
      '        <div class="mt-4 pt-4" style="border-top:1px dashed rgb(var(--border-default) / .6)">' +
      '          <h4 class="text-xs font-bold text-primary mb-1">Layout entre projetos</h4>' +
      '          <p class="text-xs text-muted mb-2">Leva só o DESENHO da carta (tamanho, campos, posições, cores) pra outro projeto — não leva os dados das cartas nem imagens/ícones enviados (esses ficam só neste projeto).</p>' +
      '          <div class="flex items-center gap-2">' +
      '            <button type="button" id="cd-layout-export" class="btn-ghost py-1.5 text-xs">' + GDC.icon('download', { size: 13 }) + 'Exportar layout</button>' +
      '            <button type="button" id="cd-layout-import" class="btn-ghost py-1.5 text-xs">' + GDC.icon('upload', { size: 13 }) + 'Importar layout</button>' +
      '          </div>' +
      '        </div>' +
      '      </div>' +

      '    </div>' +

      '    <div class="card-designer-help-popover" id="cd-help-popover" style="display:none">' +
      '      <p>Defina o layout de uma carta (tamanho, campos de texto, imagem e ícones) e uma linha de dados por carta — o preview mostra a carta selecionada, e "Gerar folha para impressão" monta todas as cartas numa folha pronta pra imprimir/exportar em PDF pelo navegador.</p>' +
      '      <p class="mt-2">Dentro de um campo de texto, <code>**negrito**</code>, <code>*itálico*</code>, <code>__sublinhado__</code> e <code>~~tachado~~</code> destacam só um trecho (ou selecione o texto e use os botões N/I/S/T que aparecem), além do estilo do campo inteiro.</p>' +
      '    </div>' +

      '    <div class="card-designer-canvas-area">' +
      '      <div class="card-designer-canvas-topbar">' +
      '        <div class="card-designer-preview-side-tabs">' +
      '          <button type="button" class="card-designer-preview-side-tab card-designer-preview-side-tab-active" data-preview-side="front">Frente</button>' +
      '          <button type="button" class="card-designer-preview-side-tab" data-preview-side="back" ' + (state.back.enabled ? '' : 'disabled title="Ative o verso da carta pra ver o preview"') + '>Verso</button>' +
      '        </div>' +
      '        <div class="card-designer-canvas-topbar-actions">' +
      '          <button type="button" id="cd-export-png" class="btn-ghost py-1.5 text-xs" title="Baixa cada carta como um arquivo PNG separado (frente de cada linha + verso, se ativado) — várias cartas vêm num .zip">' + GDC.icon('image', { size: 13 }) + 'PNG</button>' +
      '          <button type="button" id="cd-export-pdf" class="btn-ghost py-1.5 text-xs" title="Baixa a folha inteira (todas as páginas, frente e verso) como um único arquivo PDF, pronto pra levar numa gráfica — sem passar pelo diálogo de impressão do navegador">' + GDC.icon('file-down', { size: 13 }) + 'PDF</button>' +
      '          <button type="button" id="cd-export" class="btn-primary py-1.5 text-xs" title="Monta uma folha com todas as cartas, pronta pra imprimir/exportar em PDF pelo navegador">' + GDC.icon('file-down', { size: 13 }) + 'Imprimir</button>' +
      '          <span class="wp-bar-sep"></span>' +
      '          ' + GDC.fullscreen.buttonMarkup('wp-icon-btn', false, 'id="cd-fullscreen"') +
      '        </div>' +
      '      </div>' +
      '      <div id="cd-context-toolbar" class="card-designer-context-toolbar"></div>' +
      '      <div id="cd-format-bar" class="card-designer-format-bar" style="display:none"></div>' +
      '      <div class="card-designer-preview-stage">' +
      '        <div id="cd-preview-card"></div>' +
      '        <div id="cd-back-preview-card" style="display:none"></div>' +
      '      </div>' +
      '      <p class="text-xs text-muted card-designer-print-tip">Na janela de impressão, ative "Gráficos em segundo plano" (em "Mais definições") pra cores e imagens saírem no PDF.</p>' +
      '    </div>' +

      '  </div>' +
      '</div>';

    var stageEl = container.querySelector('#cd-stage');
    var fsBtn = container.querySelector('#cd-fullscreen');
    var undoBtn = container.querySelector('#cd-undo');
    var redoBtn = container.querySelector('#cd-redo');
    var presetSel = container.querySelector('#cd-preset');
    var widthInput = container.querySelector('#cd-width');
    var heightInput = container.querySelector('#cd-height');
    var bgInput = container.querySelector('#cd-bg');
    var bleedInput = container.querySelector('#cd-bleed');
    var safeMarginInput = container.querySelector('#cd-safe-margin');
    var showGuidesInput = container.querySelector('#cd-show-guides');
    var fieldsListEl = container.querySelector('#cd-fields-list');
    var addFieldBtn = container.querySelector('#cd-add-field');
    var backEnabledEl = container.querySelector('#cd-back-enabled');
    var backBodyEl = container.querySelector('#cd-back-body');
    var backPreviewEl = container.querySelector('#cd-back-preview-card');
    var tableEl = container.querySelector('#cd-table');
    var addRowBtn = container.querySelector('#cd-add-row');
    var exportCsvBtn = container.querySelector('#cd-export-csv');
    var importCsvBtn = container.querySelector('#cd-import-csv');
    var rowCountLabel = container.querySelector('#cd-ribbon-cards h3');
    var previewEl = container.querySelector('#cd-preview-card');
    // Soltar um ícone arrastado em qualquer ponto VAZIO da carta (não em cima de um campo de ícones
    // já existente — esse caso tem sua própria zona de drop, por campo, dentro de bindDragHandlers,
    // que dá stopPropagation antes de chegar aqui) cria um campo de ícones NOVO bem na posição onde
    // soltou, com esse ícone já marcado — mais direto que criar o campo em Elementos e só depois
    // escolher o ícone. Ligado uma ÚNICA vez aqui (não dentro de bindDragHandlers, que roda a cada
    // repaintPreview) porque previewEl é o mesmo nó do início ao fim — só o CONTEÚDO dele é
    // recriado a cada repintura, o nó em si não; religar a cada repintura ia empilhar um listener de
    // 'drop' novo por cima do anterior toda vez, fazendo um único drop criar vários campos.
    bindIconDropZone(previewEl, function (iconId, e) {
      var icon = iconAt(iconId);
      if (!icon) return;
      var rect = previewEl.getBoundingClientRect();
      var dropMmX = (e.clientX - rect.left) / PREVIEW_SCALE;
      var dropMmY = (e.clientY - rect.top) / PREVIEW_SCALE;
      var w = 16, h = 16;
      var x = clamp(dropMmX - w / 2, 0, Math.max(0, state.cardWidthMm - w));
      var y = clamp(dropMmY - h / 2, 0, Math.max(0, state.cardHeightMm - h));
      var field = addNewField({ type: 'icons', label: 'Ícones', x: x, y: y, w: w, h: h });
      if (field) {
        var row = state.rows.filter(function (r) { return r.id === selectedRowId; })[0] || state.rows[0];
        if (row) {
          state.rows = state.rows.map(function (r) { if (r.id !== row.id) return r; var copy = Object.assign({}, r); copy[field.id] = icon.name; return copy; });
          persist();
          repaintTable();
          repaintPreview();
        }
        selectField(field.id, {});
      }
    });
    var exportBtn = container.querySelector('#cd-export');
    var exportPngBtn = container.querySelector('#cd-export-png');
    var exportPdfBtn = container.querySelector('#cd-export-pdf');
    var zoomLevel = 1; // fica travado em 1 — o tamanho agora vem do encaixe automático (ver computeAutoScale) mais o divisor arrastável, não de um zoom manual que perdia o campo de visão
    var selectedFieldId = null;
    var editingFieldId = null; // campo de texto atualmente editável direto no canvas (contenteditable)
    var dragState = null; // { fieldId, mode: 'move'|'resize', startX, startY, origX, origY, origW, origH }
    var previewStageEl = container.querySelector('.card-designer-preview-stage');
    var PREVIEW_SCALE = DEFAULT_PREVIEW_SCALE;

    // A carta se adapta ao espaço realmente disponível (largura da coluna direita, puxada pela
    // barra divisória arrastável, mais um teto de altura da janela) — "grande por si só, mas sempre
    // visível", em vez de um tamanho fixo que ou fica pequeno demais ou não cabe na tela.
    function computeAutoScale() {
      var stageW = previewStageEl ? previewStageEl.clientWidth : 320;
      var availW = Math.max(120, stageW - 40);
      var availH = Math.max(160, global.innerHeight * 0.68);
      var effW = state.cardWidthMm + 2 * state.bleedMm;
      var effH = state.cardHeightMm + 2 * state.bleedMm;
      var byWidth = availW / effW;
      var byHeight = availH / effH;
      // Teto reduzido (era 14) — em tamanhos extremos a caixa de seleção/alça de redimensionar
      // desalinhava. 8px/mm já dá uma carta bem grande e legível sem chegar nesse território.
      return clamp(Math.min(byWidth, byHeight), 2, 8);
    }
    function refreshAutoScale() {
      PREVIEW_SCALE = computeAutoScale();
    }

    // Se a ferramenta é montada enquanto a aba "Ferramentas" ainda está escondida (display:none), a
    // primeira medição de largura vem zerada e a carta nasce pequena demais — o ResizeObserver pega
    // o momento em que o espaço real aparece (aba fica visível, painel redimensiona, janela muda) e
    // recalcula a escala aí, sem precisar de um gatilho específico pra cada caso.
    if (typeof ResizeObserver !== 'undefined' && previewStageEl) {
      var lastObservedW = previewStageEl.clientWidth;
      var stageResizeObserver = new ResizeObserver(function () {
        if (previewStageEl.clientWidth === lastObservedW) return;
        lastObservedW = previewStageEl.clientWidth;
        refreshAutoScale();
        // Não repinta o canvas enquanto um campo de texto está em edição ali — repintar reconstrói o
        // próprio nó contenteditable, e removê-lo do DOM em foco dispara um blur nativo do navegador,
        // que por sua vez sai do modo de edição sozinho (efeito colateral real, encontrado depois do
        // painel lateral passar a EMPURRAR o canvas: abrir/fechar o painel agora redimensiona a área
        // do preview de verdade — antes, como o painel flutuava por cima, nada de tamanho mudava e
        // esse efeito nunca aparecia). A escala já foi atualizada acima; a repintura de verdade só
        // acontece quando a edição termina (ver exitTextEditMode, que já repinta na saída).
        if (editingFieldId) return;
        repaintPreview();
      });
      stageResizeObserver.observe(previewStageEl);
    }

    function persist() { onChange(JSON.stringify(state)); scheduleHistoryCheckpoint(); }

    // ---------- Desfazer / Refazer ----------

    var historyTimer = null;

    function updateUndoRedoButtons() {
      undoBtn.disabled = moduleHistoryIndex <= 0;
      redoBtn.disabled = moduleHistoryIndex >= moduleHistory.length - 1;
    }

    function pushHistoryCheckpoint() {
      var snap = JSON.stringify(state);
      if (snap === moduleHistory[moduleHistoryIndex]) return;
      moduleHistory = moduleHistory.slice(0, moduleHistoryIndex + 1);
      moduleHistory.push(snap);
      if (moduleHistory.length > 50) moduleHistory.shift();
      moduleHistoryIndex = moduleHistory.length - 1;
      updateUndoRedoButtons();
    }

    function scheduleHistoryCheckpoint() {
      if (historyTimer) clearTimeout(historyTimer);
      historyTimer = setTimeout(pushHistoryCheckpoint, 600);
    }

    function applyHistoryState(snap) {
      if (historyTimer) { clearTimeout(historyTimer); historyTimer = null; }
      onChange(snap);
      skipHistoryReset = true;
      container.setAttribute('data-value', snap);
      rerenderKeepingFullscreen();
    }

    /** Remonta o designer inteiro (desfazer/refazer, importar CSV) sem derrubar a tela cheia: o palco
     *  é recriado, então a tela cheia sai do antigo e entra de novo no novo. */
    function rerenderKeepingFullscreen() {
      var wasFs = GDC.fullscreen.isActive(stageEl);
      if (wasFs) GDC.fullscreen.exit();
      render(container, onChange);
      var fresh = wasFs && container.querySelector('#cd-stage');
      if (fresh) GDC.fullscreen.enter(fresh);
    }

    function doUndo() {
      if (historyTimer) { clearTimeout(historyTimer); historyTimer = null; pushHistoryCheckpoint(); } // captura edição pendente antes de voltar
      if (moduleHistoryIndex <= 0) return;
      moduleHistoryIndex--;
      applyHistoryState(moduleHistory[moduleHistoryIndex]);
    }

    function doRedo() {
      if (moduleHistoryIndex >= moduleHistory.length - 1) return;
      moduleHistoryIndex++;
      applyHistoryState(moduleHistory[moduleHistoryIndex]);
    }

    updateUndoRedoButtons();
    undoBtn.addEventListener('click', doUndo);
    redoBtn.addEventListener('click', doRedo);

    function handleKeydown(e) {
      var typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (typing) return; // deixa o navegador cuidar do desfazer nativo dentro de campos de texto
      var mod = e.ctrlKey || e.metaKey;
      if (mod) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
        else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
        else if ((e.key === 'd' || e.key === 'D') && selectedFieldId && !editingFieldId) { e.preventDefault(); duplicateField(selectedFieldId); }
        return;
      }
      if (!selectedFieldId || editingFieldId) return; // nada selecionado, ou editando texto no canvas (não intercepta teclas ali)
      var selectedField = state.fields.filter(function (x) { return x.id === selectedFieldId; })[0];
      if (selectedField && selectedField.locked) return; // campo travado: Delete/setas não fazem nada (evita edição acidental)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeField(selectedFieldId);
        return;
      }
      var arrowDelta = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
      if (arrowDelta) {
        e.preventDefault();
        var f = state.fields.filter(function (x) { return x.id === selectedFieldId; })[0];
        if (!f) return;
        // Shift move mais rápido (5mm), padrão 1mm — igual Figma/Canva, pra ajuste fino sem precisar
        // digitar X/Y na barra de contexto toda vez. Vai até a borda da sangria, mesmo limite que
        // arrastar com o mouse já usa (ver onDragMove).
        var step = e.shiftKey ? 5 : 1;
        var newX = clamp(f.x + arrowDelta[0] * step, -state.bleedMm, Math.max(-state.bleedMm, state.cardWidthMm + state.bleedMm - f.w));
        var newY = clamp(f.y + arrowDelta[1] * step, -state.bleedMm, Math.max(-state.bleedMm, state.cardHeightMm + state.bleedMm - f.h));
        updateField(selectedFieldId, { x: newX, y: newY });
        persist();
        repaintPreview();
        updateContextToolbar();
      }
    }
    if (currentKeyHandler) document.removeEventListener('keydown', currentKeyHandler);
    currentKeyHandler = handleKeydown;
    document.addEventListener('keydown', currentKeyHandler);

    // ---------- Edição direta no preview (arrastar pra mover, alça pra redimensionar) ----------

    var SNAP_THRESHOLD_MM = 2;

    function snapCoord(value, size, cardSize, bleedMm) {
      var targets = [0, (cardSize - size) / 2, cardSize - size];
      // Com sangria configurada, a borda EXTERNA da sangria também vira alvo de encaixe — é
      // exatamente até ali que uma ilustração "sangrando" precisa chegar, e sem isso o encaixe nos
      // outros 3 alvos (borda útil/centro) competia visualmente sem nunca ajudar a acertar esse.
      if (bleedMm > 0) { targets.push(-bleedMm); targets.push(cardSize + bleedMm - size); }
      for (var i = 0; i < targets.length; i++) {
        if (Math.abs(value - targets[i]) <= SNAP_THRESHOLD_MM) return { value: targets[i], snapped: i };
      }
      return { value: value, snapped: -1 };
    }

    function ensureAlignGuides() {
      var v = previewEl.querySelector('#cd-align-guide-v');
      var h = previewEl.querySelector('#cd-align-guide-h');
      if (!v) { v = document.createElement('div'); v.id = 'cd-align-guide-v'; v.className = 'card-designer-align-guide card-designer-align-guide-v'; previewEl.appendChild(v); }
      if (!h) { h = document.createElement('div'); h.id = 'cd-align-guide-h'; h.className = 'card-designer-align-guide card-designer-align-guide-h'; previewEl.appendChild(h); }
      return { v: v, h: h };
    }
    function removeAlignGuides() {
      var v = previewEl.querySelector('#cd-align-guide-v');
      var h = previewEl.querySelector('#cd-align-guide-h');
      if (v) v.parentNode.removeChild(v);
      if (h) h.parentNode.removeChild(h);
    }

    function toggleInlineIcon(fieldId, iconName) {
      var row = state.rows.filter(function (r) { return r.id === selectedRowId; })[0] || state.rows[0];
      if (!row) return;
      var tokens = parseIconTokens(row[fieldId]);
      var idx = tokens.findIndex(function (t) { return t.toLowerCase() === iconName.toLowerCase(); });
      if (idx === -1) tokens.push(iconName); else tokens.splice(idx, 1);
      var newValue = tokens.join(',');
      state.rows = state.rows.map(function (r) { if (r.id !== row.id) return r; var copy = Object.assign({}, r); copy[fieldId] = newValue; return copy; });
      persist();
      repaintFieldsList();
      repaintTable();
      repaintPreview();
      updateContextToolbar();
    }

    // Arrastar um ícone da biblioteca (painel Elementos) direto pro canvas e soltar em cima de um
    // campo de ícones EXISTENTE — sempre ADICIONA (não alterna/remove como toggleInlineIcon, que é
    // pro clique nos chips; um arrasto que "remove" seria contraintuitivo).
    function addIconToRowField(fieldId, iconId) {
      var icon = iconAt(iconId);
      if (!icon) return;
      var row = state.rows.filter(function (r) { return r.id === selectedRowId; })[0] || state.rows[0];
      if (!row) return;
      var tokens = parseIconTokens(row[fieldId]);
      if (tokens.some(function (t) { return t.toLowerCase() === icon.name.toLowerCase(); })) return;
      tokens.push(icon.name);
      var newValue = tokens.join(', ');
      state.rows = state.rows.map(function (r) { if (r.id !== row.id) return r; var copy = Object.assign({}, r); copy[fieldId] = newValue; return copy; });
      persist();
      repaintTable();
      repaintPreview();
      updateContextToolbar();
    }

    // ---------- Balão contextual: aparece ancorado no campo selecionado direto no canvas, com os
    // controles rápidos daquele tipo (ícones/texto/imagem) — sem precisar ir em Camadas ----------
    function canvasPopoverContentMarkup(f, currentRow) {
      var bgChecked = f.bgColor !== null;
      // Divisor fino (linha vertical), não quebra de linha — substitui as bordas tracejadas que
      // cada grupo (posição/aparência/tipo/avançado) tinha antes, quando cada um era uma <div>
      // separada empilhada verticalmente. Eram 6+ divs, cada uma forçando sua própria linha mesmo
      // sobrando bastante espaço horizontal (bug real reportado, com print em tela larga: a barra
      // ficava tão alta que empurrava a carta pra baixo da dobra). Agora é tudo UM flex-wrap só, que
      // preenche a largura disponível antes de quebrar — em tela larga cabe bem mais por linha.
      var DIV = '<span class="cd-toolbar-divider"></span>';
      var positionHtml =
        '  <label class="text-xs text-secondary">Tipo<select class="input-field mt-1 py-1 text-xs" style="width:6.5rem" data-cf-type="' + f.id + '">' +
        '    <option value="text"' + (f.type === 'text' ? ' selected' : '') + '>Texto</option>' +
        '    <option value="image"' + (f.type === 'image' ? ' selected' : '') + '>Imagem</option>' +
        '    <option value="icons"' + (f.type === 'icons' ? ' selected' : '') + '>Ícones</option>' +
        '    <option value="panel"' + (f.type === 'panel' ? ' selected' : '') + '>Painel</option>' +
        '    <option value="frame"' + (f.type === 'frame' ? ' selected' : '') + '>Moldura</option>' +
        '    <option value="background"' + (f.type === 'background' ? ' selected' : '') + '>Fundo</option>' +
        '  </select></label>' +
        '  <label class="text-xs text-secondary">X<input type="number" class="input-field mt-1 w-16 py-1 text-xs" data-cf-x="' + f.id + '" value="' + f.x + '" /></label>' +
        '  <label class="text-xs text-secondary">Y<input type="number" class="input-field mt-1 w-16 py-1 text-xs" data-cf-y="' + f.id + '" value="' + f.y + '" /></label>' +
        '  <label class="text-xs text-secondary">L<input type="number" min="1" class="input-field mt-1 w-16 py-1 text-xs" data-cf-w="' + f.id + '" value="' + f.w + '" /></label>' +
        '  <label class="text-xs text-secondary">A<input type="number" min="1" class="input-field mt-1 w-16 py-1 text-xs" data-cf-h="' + f.id + '" value="' + f.h + '" /></label>' +
        '  <label class="text-xs text-secondary" title="Rotação em graus">Giro<input type="number" step="1" class="input-field mt-1 w-16 py-1 text-xs" data-cf-rotation="' + f.id + '" value="' + f.rotation + '" /></label>' +
        '  <button type="button" class="btn-ghost h-8 w-8 p-0 mt-1" data-cf-duplicate="' + f.id + '" title="Duplicar campo (Ctrl+D)">' + GDC.icon('copy', { size: 14 }) + '</button>';
      var appearanceHtml =
        '  <label class="text-xs text-secondary flex items-center gap-1"><input type="checkbox" data-cf-has-bg="' + f.id + '" ' + (bgChecked ? 'checked' : '') + ' /> Fundo</label>' +
        '  <input type="color" class="card-designer-color-input-hidden" data-cf-bg="' + f.id + '" value="' + (f.bgColor || '#eeeeee') + '" ' + (bgChecked ? '' : 'disabled') + ' />' +
        colorTriggerMarkup('[data-cf-bg="' + f.id + '"]', f.bgColor || '#eeeeee', bgChecked ? '' : 'disabled') +
        '  <label class="text-xs text-secondary">Cantos<input type="number" min="0" max="' + LIMITS.radius.max + '" step="0.5" class="input-field mt-1 w-16 py-1 text-xs" data-cf-radius="' + f.id + '" value="' + f.borderRadius + '" /></label>' +
        '  <label class="text-xs text-secondary">Espaço<input type="number" min="0" max="' + LIMITS.padding.max + '" step="0.5" class="input-field mt-1 w-16 py-1 text-xs" data-cf-padding="' + f.id + '" value="' + f.paddingMm + '" title="Afasta o conteúdo da borda do campo"/></label>';
      var typeHtml = '';
      if (f.type === 'icons') {
        var currentTokens = parseIconTokens(currentRow ? currentRow[f.id] : '');
        typeHtml = inlineIconPickerMarkup(f, currentTokens);
      } else if (f.type === 'text') {
        typeHtml =
          '  <label class="text-xs text-secondary">Fonte<select class="input-field mt-1 py-1 text-xs" style="width:9rem" data-cf-fontfamily="' + f.id + '">' +
          '    <optgroup label="Padrão">' +
          FONT_OPTIONS.map(function (o) { return '<option value="' + escapeAttr(o.id) + '"' + (o.id === f.fontFamily ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>'; }).join('') +
          '    </optgroup>' +
          GOOGLE_FONT_CATEGORIES.map(function (cat) {
            return '    <optgroup label="' + escapeAttr(cat.label) + '">' +
              cat.fonts.map(function (name) { var v = 'google:' + name; return '<option value="' + escapeAttr(v) + '"' + (v === f.fontFamily ? ' selected' : '') + '>' + escapeHtml(name) + '</option>'; }).join('') +
              '    </optgroup>';
          }).join('') +
          (state.customFonts.length ? '    <optgroup label="Suas fontes">' +
            state.customFonts.map(function (cf) { var v = 'custom:' + cf.id; return '<option value="' + escapeAttr(v) + '"' + (v === f.fontFamily ? ' selected' : '') + '>' + escapeHtml(cf.family) + '</option>'; }).join('') +
            '    </optgroup>' : '') +
          '  </select></label>' +
          (function () {
            // Avisa quando a fonte do Google escolhida pra ESSE campo falhou em carregar (sem
            // internet, por exemplo) — sem isso, a carta mostra uma fonte substituta sem a pessoa
            // entender por quê (bug registrado no backlog).
            if (typeof f.fontFamily !== 'string' || f.fontFamily.indexOf('google:') !== 0) return '';
            var gName = f.fontFamily.slice(7);
            if (loadedGoogleFonts[gName] !== 'error') return '';
            return '<span class="card-designer-font-warning" title="Não deu pra carregar \'' + escapeAttr(gName) + '\' do Google Fonts (sem internet?) — mostrando uma fonte substituta por enquanto.">' + GDC.icon('cloud-off', { size: 13 }) + '</span>';
          })() +
          '  <button type="button" class="btn-ghost py-1.5 text-xs" data-cf-upload-font="' + f.id + '" title="Enviar arquivo de fonte (.woff, .woff2, .ttf, .otf)">' + GDC.icon('plus', { size: 12 }) + 'Fonte</button>' +
          '  <div class="card-designer-style-toggles">' +
          '    <button type="button" class="btn-ghost h-8 w-8 p-0' + (f.bold ? ' btn-ghost-active' : '') + '" data-cf-bold="' + f.id + '" title="Negrito"><strong>N</strong></button>' +
          '    <button type="button" class="btn-ghost h-8 w-8 p-0' + (f.italic ? ' btn-ghost-active' : '') + '" data-cf-italic="' + f.id + '" title="Itálico"><em>I</em></button>' +
          '    <button type="button" class="btn-ghost h-8 w-8 p-0' + (f.underline ? ' btn-ghost-active' : '') + '" data-cf-underline="' + f.id + '" title="Sublinhado"><span style="text-decoration:underline">S</span></button>' +
          '    <button type="button" class="btn-ghost h-8 w-8 p-0' + (f.strikethrough ? ' btn-ghost-active' : '') + '" data-cf-strike="' + f.id + '" title="Tachado"><span style="text-decoration:line-through">T</span></button>' +
          '  </div>' +
          '  <div class="card-designer-style-toggles">' +
          '    <button type="button" class="btn-ghost h-8 w-8 p-0' + (f.align === 'left' ? ' btn-ghost-active' : '') + '" data-cf-align="' + f.id + '|left" title="Alinhar à esquerda">' + GDC.icon('align-left', { size: 14 }) + '</button>' +
          '    <button type="button" class="btn-ghost h-8 w-8 p-0' + (f.align === 'center' ? ' btn-ghost-active' : '') + '" data-cf-align="' + f.id + '|center" title="Centralizar">' + GDC.icon('align-center', { size: 14 }) + '</button>' +
          '    <button type="button" class="btn-ghost h-8 w-8 p-0' + (f.align === 'right' ? ' btn-ghost-active' : '') + '" data-cf-align="' + f.id + '|right" title="Alinhar à direita">' + GDC.icon('align-right', { size: 14 }) + '</button>' +
          '  </div>' +
          '  <label class="text-xs text-secondary">Tam.<input type="number" min="' + LIMITS.font.min + '" max="' + LIMITS.font.max + '" step="0.5" class="input-field mt-1 w-16 py-1 text-xs" data-cf-font="' + f.id + '" value="' + f.fontSize + '" /></label>' +
          '  <div class="text-xs text-secondary">Cor<div class="flex items-center gap-2 mt-1"><input type="color" class="card-designer-color-input-hidden" data-cf-color="' + f.id + '" value="' + f.color + '" />' + colorTriggerMarkup('[data-cf-color="' + f.id + '"]', f.color) + '</div></div>';
      } else if (f.type === 'image') {
        var currentImgId = currentRow ? currentRow[f.id] : '';
        typeHtml =
          '  <label class="text-xs text-secondary">Ajuste<select class="input-field mt-1 py-1.5 text-xs" data-cf-imagefit="' + f.id + '">' +
          '    <option value="cover"' + (f.imageFit === 'cover' ? ' selected' : '') + '>Preencher</option>' +
          '    <option value="contain"' + (f.imageFit === 'contain' ? ' selected' : '') + '>Conter</option>' +
          '  </select></label>' +
          '  <button type="button" class="btn-ghost py-1.5 text-xs" data-cf-image="' + f.id + '" data-image-thumb="' + escapeAttr(currentImgId || '') + '">' + GDC.icon('image', { size: 14 }) + (currentImgId ? 'Trocar imagem' : 'Enviar imagem') + '</button>';
      } else if (f.type === 'frame') {
        var currentFrameImgId = currentRow ? currentRow[f.id] : '';
        typeHtml =
          '  <label class="text-xs text-secondary" title="Como a imagem decorativa se ajusta ao tamanho da moldura">Ajuste<select class="input-field mt-1 py-1.5 text-xs" data-cf-imagefit="' + f.id + '">' +
          '    <option value="cover"' + (f.imageFit === 'cover' ? ' selected' : '') + '>Preencher</option>' +
          '    <option value="contain"' + (f.imageFit === 'contain' ? ' selected' : '') + '>Conter</option>' +
          '  </select></label>' +
          '  <button type="button" class="btn-ghost py-1.5 text-xs" data-cf-image="' + f.id + '" data-image-thumb="' + escapeAttr(currentFrameImgId || '') + '" title="Aceita PNG, JPG ou SVG — uma moldura/borda vetorial com fundo transparente funciona melhor">' + GDC.icon('image', { size: 14 }) + (currentFrameImgId ? 'Trocar imagem da moldura' : 'Imagem de moldura (opcional)') + '</button>';
      } else if (f.type === 'panel') {
        typeHtml =
          '  <label class="text-xs text-secondary">Forma<select class="input-field mt-1 py-1.5 text-xs" data-cf-shape="' + f.id + '">' +
          '    <option value="rect"' + (f.shape === 'rect' ? ' selected' : '') + '>Retângulo</option>' +
          ['circle', 'diamond', 'ribbon', 'hexagon', 'pentagon', 'star', 'shield'].map(function (sid) {
            var sp = SHAPE_PRESETS.filter(function (s) { return s.id === sid; })[0];
            return sp ? '<option value="' + sp.id + '"' + (f.shape === sp.id ? ' selected' : '') + '>' + escapeHtml(sp.label) + '</option>' : '';
          }).join('') +
          '  </select></label>';
      }
      var borderChecked = f.borderColor !== null;
      var shadowChecked = f.shadow;
      var gradientChecked = f.gradient;
      var borderHtml =
        '  <label class="text-xs text-secondary" title="Opacidade do campo inteiro">Opacid. %<input type="number" min="0" max="100" step="5" class="input-field mt-1 w-16 py-1 text-xs" data-cf-opacity="' + f.id + '" value="' + f.opacity + '" /></label>' +
        '  <label class="text-xs text-secondary flex items-center gap-1"><input type="checkbox" data-cf-has-border="' + f.id + '" ' + (borderChecked ? 'checked' : '') + ' /> Borda</label>' +
        '  <input type="color" class="card-designer-color-input-hidden" data-cf-border-color="' + f.id + '" value="' + (f.borderColor || '#1f2937') + '" ' + (borderChecked ? '' : 'disabled') + ' />' +
        colorTriggerMarkup('[data-cf-border-color="' + f.id + '"]', f.borderColor || '#1f2937', borderChecked ? '' : 'disabled') +
        '  <label class="text-xs text-secondary">Espessura<input type="number" min="0" max="' + LIMITS.padding.max + '" step="0.5" class="input-field mt-1 w-16 py-1 text-xs" data-cf-border-width="' + f.id + '" value="' + f.borderWidthMm + '" ' + (borderChecked ? '' : 'disabled') + ' /></label>';
      var shadowHtml =
        '  <label class="text-xs text-secondary flex items-center gap-1"><input type="checkbox" data-cf-has-shadow="' + f.id + '" ' + (shadowChecked ? 'checked' : '') + ' /> Sombra</label>' +
        '  <input type="color" class="card-designer-color-input-hidden" data-cf-shadow-color="' + f.id + '" value="' + f.shadowColor + '" ' + (shadowChecked ? '' : 'disabled') + ' />' +
        colorTriggerMarkup('[data-cf-shadow-color="' + f.id + '"]', f.shadowColor, shadowChecked ? '' : 'disabled') +
        '  <label class="text-xs text-secondary">Desfoque<input type="number" min="0" max="20" step="0.5" class="input-field mt-1 w-16 py-1 text-xs" data-cf-shadow-blur="' + f.id + '" value="' + f.shadowBlurMm + '" ' + (shadowChecked ? '' : 'disabled') + ' /></label>' +
        '  <label class="text-xs text-secondary">Distância<input type="number" min="0" max="20" step="0.5" class="input-field mt-1 w-16 py-1 text-xs" data-cf-shadow-offset="' + f.id + '" value="' + f.shadowOffsetMm + '" ' + (shadowChecked ? '' : 'disabled') + ' /></label>';
      var gradientHtml =
        '  <label class="text-xs text-secondary flex items-center gap-1"><input type="checkbox" data-cf-has-gradient="' + f.id + '" ' + (gradientChecked ? 'checked' : '') + ' /> Gradiente</label>' +
        '  <input type="color" class="card-designer-color-input-hidden" data-cf-gradient-color2="' + f.id + '" value="' + f.gradientColor2 + '" ' + (gradientChecked ? '' : 'disabled') + ' />' +
        colorTriggerMarkup('[data-cf-gradient-color2="' + f.id + '"]', f.gradientColor2, gradientChecked ? '' : 'disabled') +
        '  <label class="text-xs text-secondary">Direção<select class="input-field mt-1 py-1 text-xs" data-cf-gradient-dir="' + f.id + '" ' + (gradientChecked ? '' : 'disabled') + '>' +
        ['to right', 'to bottom', 'to bottom right', 'to top'].map(function (d) {
          var labels = { 'to right': '→', 'to bottom': '↓', 'to bottom right': '↘', 'to top': '↑' };
          return '<option value="' + d + '"' + (d === f.gradientDirection ? ' selected' : '') + '>' + labels[d] + '</option>';
        }).join('') +
        '  </select></label>';
      return '<div class="card-designer-canvas-text-toolbar">' +
        positionHtml + (typeHtml ? DIV + typeHtml : '') + DIV + appearanceHtml + DIV + borderHtml + DIV + shadowHtml + DIV + gradientHtml +
        '</div>';
    }

    // Atribui um arquivo de imagem ao campo de uma linha específica — usado tanto pelo botão de
    // imagem do balão de contexto (clique -> seletor de arquivo) quanto pelo arrastar-e-soltar
    // direto sobre o campo no canvas. `file` já deve ser um File de imagem (quem chama valida).
    function assignImageToRowField(fieldId, rowId, file) {
      if (!GDC.imageStore) return;
      GDC.imageStore.put(file).then(function (meta) {
        state.rows = state.rows.map(function (r) { if (r.id !== rowId) return r; var copy = Object.assign({}, r); copy[fieldId] = meta.id; return copy; });
        persist();
        repaintFieldsList();
        repaintPreview();
        repaintTable();
        updateContextToolbar();
      });
    }

    function bindCanvasPopoverEvents(popoverEl) {
      var duplicateBtn = popoverEl.querySelector('[data-cf-duplicate]');
      if (duplicateBtn) duplicateBtn.addEventListener('click', function () {
        duplicateField(duplicateBtn.getAttribute('data-cf-duplicate'));
      });
      var fontFamilySelect = popoverEl.querySelector('[data-cf-fontfamily]');
      if (fontFamilySelect) fontFamilySelect.addEventListener('change', function () {
        updateField(fontFamilySelect.getAttribute('data-cf-fontfamily'), { fontFamily: fontFamilySelect.value });
        persist();
        repaintPreview();
      });
      var uploadFontBtn = popoverEl.querySelector('[data-cf-upload-font]');
      if (uploadFontBtn) uploadFontBtn.addEventListener('click', function () {
        if (state.customFonts.length >= LIMITS.customFonts.max) {
          global.alert('Limite de ' + LIMITS.customFonts.max + ' fontes personalizadas por projeto.');
          return;
        }
        var targetFieldId = uploadFontBtn.getAttribute('data-cf-upload-font');
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.woff,.woff2,.ttf,.otf,font/woff,font/woff2,font/ttf,font/otf';
        input.addEventListener('change', function () {
          var file = input.files && input.files[0];
          if (!file || !GDC.fontStore) return;
          var defaultName = file.name.replace(/\.(woff2?|ttf|otf)$/i, '').slice(0, 40) || 'Minha fonte';
          var name = global.prompt('Nome pra essa fonte (como vai aparecer na lista):', defaultName);
          if (!name || !name.trim()) return;
          GDC.fontStore.put(file, name.trim()).then(function (meta) {
            var customFont = { id: makeId('cf'), family: name.trim().replace(/['"]/g, ''), fontFileId: meta.id };
            state.customFonts = state.customFonts.concat([customFont]);
            updateField(targetFieldId, { fontFamily: 'custom:' + customFont.id });
            persist();
            repaintPreview();
            updateContextToolbar();
          }, function () {
            global.alert('Não consegui ler esse arquivo de fonte.');
          });
        });
        input.click();
      });
      var typeSelect = popoverEl.querySelector('[data-cf-type]');
      if (typeSelect) typeSelect.addEventListener('change', function () {
        var fieldId = typeSelect.getAttribute('data-cf-type');
        updateField(fieldId, { type: typeSelect.value });
        persist();
        repaintFieldsList();
        repaintTable();
        repaintPreview();
        updateContextToolbar();
      });
      // Posição/tamanho — mesmos 4 campos que existiam na lista de Camadas antes, só que agora
      // vivem na barra de contexto (a lista virou só uma lista de verdade, estilo Photoshop).
      ['x', 'y', 'w', 'h'].forEach(function (key) {
        var input = popoverEl.querySelector('[data-cf-' + key + ']');
        if (!input) return;
        input.addEventListener('input', function () {
          var fieldId = input.getAttribute('data-cf-' + key);
          var min = (key === 'w' || key === 'h') ? 1 : LIMITS.pos.min;
          var patch = {}; patch[key] = clamp(Number(input.value), min, LIMITS.pos.max);
          updateField(fieldId, patch);
          persist();
          repaintPreview();
        });
      });
      var rotationInput = popoverEl.querySelector('[data-cf-rotation]');
      if (rotationInput) rotationInput.addEventListener('input', function () {
        var fieldId = rotationInput.getAttribute('data-cf-rotation');
        updateField(fieldId, { rotation: normalizeAngle(rotationInput.value) });
        persist();
        repaintPreview();
      });
      var hasBgInput = popoverEl.querySelector('[data-cf-has-bg]');
      if (hasBgInput) hasBgInput.addEventListener('change', function () {
        var fieldId = hasBgInput.getAttribute('data-cf-has-bg');
        var colorInputEl = popoverEl.querySelector('[data-cf-bg]');
        updateField(fieldId, { bgColor: hasBgInput.checked ? (colorInputEl ? colorInputEl.value : '#eeeeee') : null });
        persist();
        repaintPreview();
        updateContextToolbar();
      });
      var cfBgInput = popoverEl.querySelector('[data-cf-bg]');
      if (cfBgInput) cfBgInput.addEventListener('input', function () {
        var fieldId = cfBgInput.getAttribute('data-cf-bg');
        updateField(fieldId, { bgColor: cfBgInput.value });
        persist();
        repaintPreview();
      });
      var radiusInput = popoverEl.querySelector('[data-cf-radius]');
      if (radiusInput) radiusInput.addEventListener('input', function () {
        var fieldId = radiusInput.getAttribute('data-cf-radius');
        updateField(fieldId, { borderRadius: clamp(Number(radiusInput.value) || 0, LIMITS.radius.min, LIMITS.radius.max) });
        persist();
        repaintPreview();
      });
      var paddingInput = popoverEl.querySelector('[data-cf-padding]');
      if (paddingInput) paddingInput.addEventListener('input', function () {
        var fieldId = paddingInput.getAttribute('data-cf-padding');
        updateField(fieldId, { paddingMm: clamp(Number(paddingInput.value) || 0, LIMITS.padding.min, LIMITS.padding.max) });
        persist();
        repaintPreview();
      });
      var hasBorderInput = popoverEl.querySelector('[data-cf-has-border]');
      if (hasBorderInput) hasBorderInput.addEventListener('change', function () {
        var fieldId = hasBorderInput.getAttribute('data-cf-has-border');
        var colorInputEl = popoverEl.querySelector('[data-cf-border-color]');
        updateField(fieldId, { borderColor: hasBorderInput.checked ? (colorInputEl ? colorInputEl.value : '#1f2937') : null });
        persist();
        repaintPreview();
        updateContextToolbar();
      });
      var cfBorderColorInput = popoverEl.querySelector('[data-cf-border-color]');
      if (cfBorderColorInput) cfBorderColorInput.addEventListener('input', function () {
        var fieldId = cfBorderColorInput.getAttribute('data-cf-border-color');
        updateField(fieldId, { borderColor: cfBorderColorInput.value });
        persist();
        repaintPreview();
      });
      var borderWidthInput = popoverEl.querySelector('[data-cf-border-width]');
      if (borderWidthInput) borderWidthInput.addEventListener('input', function () {
        var fieldId = borderWidthInput.getAttribute('data-cf-border-width');
        updateField(fieldId, { borderWidthMm: clamp(Number(borderWidthInput.value) || 0, 0, LIMITS.padding.max) });
        persist();
        repaintPreview();
      });
      var opacityInput = popoverEl.querySelector('[data-cf-opacity]');
      if (opacityInput) opacityInput.addEventListener('input', function () {
        var fieldId = opacityInput.getAttribute('data-cf-opacity');
        updateField(fieldId, { opacity: clamp(Number(opacityInput.value), 0, 100) });
        persist();
        repaintPreview();
      });
      var hasShadowInput = popoverEl.querySelector('[data-cf-has-shadow]');
      if (hasShadowInput) hasShadowInput.addEventListener('change', function () {
        var fieldId = hasShadowInput.getAttribute('data-cf-has-shadow');
        updateField(fieldId, { shadow: hasShadowInput.checked });
        persist();
        repaintPreview();
        updateContextToolbar();
      });
      var shadowColorInput = popoverEl.querySelector('[data-cf-shadow-color]');
      if (shadowColorInput) shadowColorInput.addEventListener('input', function () {
        var fieldId = shadowColorInput.getAttribute('data-cf-shadow-color');
        updateField(fieldId, { shadowColor: shadowColorInput.value });
        persist();
        repaintPreview();
      });
      var shadowBlurInput = popoverEl.querySelector('[data-cf-shadow-blur]');
      if (shadowBlurInput) shadowBlurInput.addEventListener('input', function () {
        var fieldId = shadowBlurInput.getAttribute('data-cf-shadow-blur');
        updateField(fieldId, { shadowBlurMm: clamp(Number(shadowBlurInput.value) || 0, 0, 20) });
        persist();
        repaintPreview();
      });
      var shadowOffsetInput = popoverEl.querySelector('[data-cf-shadow-offset]');
      if (shadowOffsetInput) shadowOffsetInput.addEventListener('input', function () {
        var fieldId = shadowOffsetInput.getAttribute('data-cf-shadow-offset');
        updateField(fieldId, { shadowOffsetMm: clamp(Number(shadowOffsetInput.value) || 0, 0, 20) });
        persist();
        repaintPreview();
      });
      var hasGradientInput = popoverEl.querySelector('[data-cf-has-gradient]');
      if (hasGradientInput) hasGradientInput.addEventListener('change', function () {
        var fieldId = hasGradientInput.getAttribute('data-cf-has-gradient');
        updateField(fieldId, { gradient: hasGradientInput.checked });
        persist();
        repaintPreview();
        updateContextToolbar();
      });
      var gradientColor2Input = popoverEl.querySelector('[data-cf-gradient-color2]');
      if (gradientColor2Input) gradientColor2Input.addEventListener('input', function () {
        var fieldId = gradientColor2Input.getAttribute('data-cf-gradient-color2');
        updateField(fieldId, { gradientColor2: gradientColor2Input.value });
        persist();
        repaintPreview();
      });
      var gradientDirSelect = popoverEl.querySelector('[data-cf-gradient-dir]');
      if (gradientDirSelect) gradientDirSelect.addEventListener('change', function () {
        var fieldId = gradientDirSelect.getAttribute('data-cf-gradient-dir');
        updateField(fieldId, { gradientDirection: gradientDirSelect.value });
        persist();
        repaintPreview();
      });
      var shapeSelect = popoverEl.querySelector('[data-cf-shape]');
      if (shapeSelect) shapeSelect.addEventListener('change', function () {
        var fieldId = shapeSelect.getAttribute('data-cf-shape');
        updateField(fieldId, { shape: shapeSelect.value });
        persist();
        repaintPreview();
      });
      popoverEl.querySelectorAll('[data-inline-icon-toggle]').forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var parts = btn.getAttribute('data-inline-icon-toggle').split('|');
          toggleInlineIcon(parts[0], parts[1]);
        };
      });
      popoverEl.querySelectorAll('[data-cf-bold], [data-cf-italic], [data-cf-underline], [data-cf-strike]').forEach(function (btn) {
        btn.addEventListener('mousedown', function (e) {
          var attr = ['bold', 'italic', 'underline', 'strike'].filter(function (k) { return btn.hasAttribute('data-cf-' + k); })[0];
          var key = attr === 'strike' ? 'strikethrough' : attr;
          var fieldId = btn.getAttribute('data-cf-' + attr);
          // Se o campo está sendo editado no canvas AGORA e tem um trecho de texto selecionado,
          // aplica a marcação só nesse trecho (negrito/itálico PARCIAL) em vez de alternar o campo
          // inteiro. preventDefault tem que ser no MOUSEDOWN, não no click: por padrão, o navegador
          // tira o foco do contenteditable assim que o mouse desce sobre outro elemento focável (o
          // próprio botão), o que colapsa a seleção de texto antes do clique sequer disparar.
          if (editingFieldId === fieldId) {
            var editableEl = previewEl.querySelector('[data-editable-field="' + fieldId + '"]');
            var sel = editableEl && global.getSelection();
            if (editableEl && sel && sel.rangeCount && !sel.isCollapsed && editableEl.contains(sel.getRangeAt(0).commonAncestorContainer)) {
              e.preventDefault();
              var markers = { bold: '**', italic: '*', underline: '__', strike: '~~' };
              toggleTextWrapEditable(editableEl, markers[attr]);
              return;
            }
          }
          e.preventDefault();
          var f = state.fields.filter(function (x) { return x.id === fieldId; })[0];
          if (!f) return;
          var patch = {}; patch[key] = !f[key];
          updateField(fieldId, patch);
          persist();
          repaintFieldsList();
          repaintPreview();
          updateContextToolbar();
        });
      });
      popoverEl.querySelectorAll('[data-cf-align]').forEach(function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          var parts = btn.getAttribute('data-cf-align').split('|');
          updateField(parts[0], { align: parts[1] });
          persist();
          repaintFieldsList();
          repaintPreview();
          updateContextToolbar();
        };
      });
      var fontInput = popoverEl.querySelector('[data-cf-font]');
      if (fontInput) fontInput.oninput = function () {
        var fieldId = fontInput.getAttribute('data-cf-font');
        updateField(fieldId, { fontSize: clamp(Number(fontInput.value), LIMITS.font.min, LIMITS.font.max) });
        persist();
        repaintFieldsList();
        repaintPreview();
      };
      var colorInput = popoverEl.querySelector('[data-cf-color]');
      if (colorInput) colorInput.oninput = function () {
        var fieldId = colorInput.getAttribute('data-cf-color');
        updateField(fieldId, { color: colorInput.value });
        persist();
        repaintFieldsList();
        repaintPreview();
      };
      bindColorTrigger(popoverEl);
      var fitSelect = popoverEl.querySelector('[data-cf-imagefit]');
      if (fitSelect) fitSelect.onchange = function () {
        var fieldId = fitSelect.getAttribute('data-cf-imagefit');
        updateField(fieldId, { imageFit: fitSelect.value });
        persist();
        repaintFieldsList();
        repaintPreview();
      };
      var imageBtn = popoverEl.querySelector('[data-cf-image]');
      if (imageBtn) imageBtn.onclick = function (e) {
        e.stopPropagation();
        var fieldId = imageBtn.getAttribute('data-cf-image');
        var rowId = selectedRowId;
        if (!rowId) return;
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', function () {
          var file = input.files && input.files[0];
          if (!file) return;
          assignImageToRowField(fieldId, rowId, file);
        });
        input.click();
      };
      if (GDC.imageStore) GDC.imageStore.resolveThumbs(popoverEl);
    }

    var contextToolbarEl = container.querySelector('#cd-context-toolbar');
    function updateContextToolbar() {
      var f = state.fields.filter(function (x) { return x.id === selectedFieldId; })[0];
      var shouldShow = !!f; // agora sempre mostra pra qualquer campo selecionado (posição/tamanho/fundo aparecem mesmo sem nada type-specific pra mostrar)
      contextToolbarEl.style.display = '';
      if (!shouldShow) {
        // Barra persistente (igual Canva) — nunca some, mesmo sem nada selecionado. Sem um campo
        // específico pra editar, mostra o nível "da carta inteira" (cor de fundo), que é o
        // equivalente mais próximo de editar a "página" quando nada está selecionado.
        contextToolbarEl.innerHTML =
          '<div class="card-designer-canvas-text-toolbar">' +
          '  <p class="text-xs text-muted" style="margin:0">Clique num elemento da carta pra editar — ou ajuste a carta inteira:</p>' +
          '  <div class="text-xs text-secondary">Cor de fundo da carta<div class="flex items-center gap-2 mt-1"><input type="color" class="card-designer-color-input-hidden" data-cf-card-bg value="' + state.bgColor + '" />' + colorTriggerMarkup('[data-cf-card-bg]', state.bgColor) + '</div></div>' +
          '</div>';
        var cardBgInput = contextToolbarEl.querySelector('[data-cf-card-bg]');
        if (cardBgInput) cardBgInput.addEventListener('input', function () {
          bgInput.value = cardBgInput.value;
          bgInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        bindColorTrigger(contextToolbarEl);
        return;
      }
      var currentRow = state.rows.filter(function (r) { return r.id === selectedRowId; })[0] || state.rows[0];
      contextToolbarEl.innerHTML = canvasPopoverContentMarkup(f, currentRow);
      bindCanvasPopoverEvents(contextToolbarEl);
    }

    function selectField(fieldId, opts) {
      selectedFieldId = fieldId;
      repaintPreview();
      updateContextToolbar();
      // Destaca a linha certa na lista de Camadas (se estiver aberta) sem precisar repintar a lista
      // inteira — troca só a classe, é bem mais barato que reconstruir todo o HTML da lista.
      fieldsListEl.querySelectorAll('[data-layer-select]').forEach(function (row) {
        row.classList.toggle('card-designer-layer-row-selected', row.getAttribute('data-layer-select') === fieldId);
      });
      if (opts && opts.syncFieldList) {
        collapsedFields[fieldId] = false;
        switchToLayersTab();
        repaintFieldsList();
        var card = fieldsListEl.querySelector('[data-field-row="' + fieldId + '"]');
        if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    function onDragMove(e) {
      if (!dragState) return;
      var f = state.fields.filter(function (x) { return x.id === dragState.fieldId; })[0];
      if (!f) return;
      if (dragState.mode === 'rotate') {
        var dx = e.clientX - dragState.centerX, dy = e.clientY - dragState.centerY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.moved = true;
        // atan2(dx, -dy) em vez do atan2(dy, dx) padrão: isso mede o ângulo a partir do NORTE (a
        // alça nasce no topo do campo, giro 0°), crescendo no sentido horário — o mesmo sentido que
        // transform:rotate(deg) usa em CSS. Com o atan2(y, x) de matemática pura, 0° apontaria pra
        // DIREITA em vez de pra cima, e a alça pareceria "atrasada" 90° em relação ao mouse.
        var angle = Math.atan2(dx, -dy) * 180 / Math.PI;
        if (e.shiftKey) angle = Math.round(angle / 15) * 15; // trava em passos de 15° (igual Figma/Canva)
        var rotation = normalizeAngle(angle);
        dragState.pendingRotation = rotation;
        var el = previewEl.querySelector('[data-field-id="' + f.id + '"]');
        if (el) el.style.transform = 'rotate(' + rotation + 'deg)';
        return;
      }
      var dxPx = e.clientX - dragState.startX, dyPx = e.clientY - dragState.startY;
      if (Math.abs(dxPx) > 2 || Math.abs(dyPx) > 2) dragState.moved = true;
      var dxMm = dxPx / zoomLevel / PREVIEW_SCALE, dyMm = dyPx / zoomLevel / PREVIEW_SCALE;
      var el = previewEl.querySelector('[data-field-id="' + f.id + '"]');
      if (!el) return;

      if (dragState.mode === 'move') {
        // O intervalo permitido vai até a borda da SANGRIA (não só a área útil da carta) — antes
        // travava em [0, cardWidth-largura], então dava pra digitar um X negativo na barra de
        // contexto (que aceita) mas não dava pra ARRASTAR até lá, o que não é nada intuitivo. Uma
        // ilustração que deveria "sangrar" até a borda de corte precisa conseguir ser arrastada pra
        // fora da área útil, não só digitada manualmente (bug real reportado do backlog).
        var maxX = Math.max(-state.bleedMm, state.cardWidthMm + state.bleedMm - f.w);
        var maxY = Math.max(-state.bleedMm, state.cardHeightMm + state.bleedMm - f.h);
        var rawX = clamp(dragState.origX + dxMm, -state.bleedMm, maxX);
        var rawY = clamp(dragState.origY + dyMm, -state.bleedMm, maxY);
        var snapX = snapCoord(rawX, f.w, state.cardWidthMm, state.bleedMm);
        var snapY = snapCoord(rawY, f.h, state.cardHeightMm, state.bleedMm);
        // Grade de posicionamento (se ligada em Config) entra só quando não encaixou em centro/borda
        // — esses dois continuam tendo prioridade, por serem mais "intencionais".
        if (snapX.snapped === -1 && state.snapGridMm > 0) snapX = { value: clamp(Math.round(rawX / state.snapGridMm) * state.snapGridMm, 0, maxX), snapped: -1 };
        if (snapY.snapped === -1 && state.snapGridMm > 0) snapY = { value: clamp(Math.round(rawY / state.snapGridMm) * state.snapGridMm, 0, maxY), snapped: -1 };
        dragState.pendingX = snapX.value; dragState.pendingY = snapY.value;
        el.style.left = ((snapX.value + state.bleedMm) * PREVIEW_SCALE) + 'px';
        el.style.top = ((snapY.value + state.bleedMm) * PREVIEW_SCALE) + 'px';

        // Guias visuais tipo Figma: uma linha aparece quando o campo encaixa na borda ou no centro
        // (vertical/horizontal) do cartão, pra deixar claro POR QUE ele "grudou" ali. Índices 0/1/2
        // são os alvos de sempre (borda útil esquerda/topo, centro, borda útil direita/baixo);
        // 3/4 são os dois novos alvos de sangria (só existem quando bleedMm > 0 — ver snapCoord) —
        // a posição de cada um é a mesma conta que fieldPreviewStyle já usa pra desenhar um campo
        // ali (esquerda: 0, ou seja SEM somar bleedMm; direita: bleedMm*2 + tamanho da carta).
        var guides = ensureAlignGuides();
        var xGuidePos = [state.bleedMm, state.bleedMm + state.cardWidthMm / 2, state.bleedMm + state.cardWidthMm, 0, state.bleedMm * 2 + state.cardWidthMm];
        var yGuidePos = [state.bleedMm, state.bleedMm + state.cardHeightMm / 2, state.bleedMm + state.cardHeightMm, 0, state.bleedMm * 2 + state.cardHeightMm];
        if (snapX.snapped !== -1) {
          guides.v.style.left = (xGuidePos[snapX.snapped] * PREVIEW_SCALE) + 'px';
          guides.v.style.display = 'block';
        } else {
          guides.v.style.display = 'none';
        }
        if (snapY.snapped !== -1) {
          guides.h.style.top = (yGuidePos[snapY.snapped] * PREVIEW_SCALE) + 'px';
          guides.h.style.display = 'block';
        } else {
          guides.h.style.display = 'none';
        }
      } else {
        var corner = dragState.corner || 'se';
        var rad = dragState.origRotation ? (dragState.origRotation * Math.PI / 180) : 0;
        // Girado, o movimento do mouse acontece no espaço da TELA, mas x/y/w/h do campo sempre
        // vivem no espaço LÓGICO (sem rotação — é só um transform visual, ver fieldPreviewStyle).
        // Pra arrastar um canto fazer sentido visualmente, o delta do mouse precisa ser
        // "desgirado" (rotação inversa) antes de aplicar em largura/altura/posição — sem isso, girar
        // o campo 90° faria a alça "direita" na tela redimensionar a ALTURA lógica em vez da
        // largura. Sem rotação (caso comum) isso é a identidade, então dxLocal/dyLocal == dxMm/dyMm.
        var dxLocal = dxMm, dyLocal = dyMm;
        if (rad) {
          dxLocal = dxMm * Math.cos(rad) + dyMm * Math.sin(rad);
          dyLocal = -dxMm * Math.sin(rad) + dyMm * Math.cos(rad);
        }
        // "growRight"/"growDown" dizem se esse canto empurra a borda direita/inferior (aumenta W/H
        // direto) ou a borda esquerda/superior (aumenta W/H MOVENDO x/y, com o canto oposto como
        // âncora fixa) — a mesma convenção de qualquer editor visual.
        var growRight = corner === 'se' || corner === 'ne';
        var growDown = corner === 'se' || corner === 'sw';
        var rawW = growRight ? dragState.origW + dxLocal : dragState.origW - dxLocal;
        var rawH = growDown ? dragState.origH + dyLocal : dragState.origH - dyLocal;
        var rawX = growRight ? dragState.origX : dragState.origX + dxLocal;
        var rawY = growDown ? dragState.origY : dragState.origY + dyLocal;
        var newW, newH, newX, newY;
        if (!dragState.origRotation) {
          // Sem rotação: o canto OPOSTO ao arrastado (a âncora) agora pode ir até a borda da
          // SANGRIA, não só da área útil da carta — mesmo raciocínio do arrastar-pra-mover acima:
          // uma ilustração "sangrando" até a borda de corte precisa disso pra dar pra fazer
          // arrastando o canto, não só digitando X/Y/L/A manualmente.
          var anchorRight = dragState.origX + dragState.origW, anchorBottom = dragState.origY + dragState.origH;
          if (growRight) { newW = clamp(rawW, 1, Math.max(1, state.cardWidthMm + state.bleedMm - dragState.origX)); newX = dragState.origX; }
          else { newX = clamp(rawX, -state.bleedMm, Math.max(-state.bleedMm, anchorRight - 1)); newW = anchorRight - newX; }
          if (growDown) { newH = clamp(rawH, 1, Math.max(1, state.cardHeightMm + state.bleedMm - dragState.origY)); newY = dragState.origY; }
          else { newY = clamp(rawY, -state.bleedMm, Math.max(-state.bleedMm, anchorBottom - 1)); newH = anchorBottom - newY; }
        } else {
          // Girado: travar contra a borda da carta exigiria considerar a caixa delimitadora do
          // retângulo GIRADO (não só o retângulo lógico) — fica pra uma fase futura se for preciso;
          // por ora usa os mesmos limites gerais que digitar X/Y/L/A na barra de contexto já aceita.
          newW = clamp(rawW, 1, LIMITS.dim.max);
          newH = clamp(rawH, 1, LIMITS.dim.max);
          newX = clamp(rawX, LIMITS.pos.min, LIMITS.pos.max);
          newY = clamp(rawY, LIMITS.pos.min, LIMITS.pos.max);
        }
        if (state.snapGridMm > 0) {
          newW = Math.max(1, Math.round(newW / state.snapGridMm) * state.snapGridMm);
          newH = Math.max(1, Math.round(newH / state.snapGridMm) * state.snapGridMm);
        }
        dragState.pendingW = newW; dragState.pendingH = newH; dragState.pendingX = newX; dragState.pendingY = newY;
        el.style.width = (newW * PREVIEW_SCALE) + 'px';
        el.style.height = (newH * PREVIEW_SCALE) + 'px';
        el.style.left = ((newX + state.bleedMm) * PREVIEW_SCALE) + 'px';
        el.style.top = ((newY + state.bleedMm) * PREVIEW_SCALE) + 'px';
      }
    }

    function onDragEnd() {
      if (!dragState) return;
      var moved = dragState.moved;
      var fieldId = dragState.fieldId;
      var mode = dragState.mode;
      var patch = null;
      if (moved) {
        if (mode === 'move') patch = { x: Math.round(dragState.pendingX * 10) / 10, y: Math.round(dragState.pendingY * 10) / 10 };
        else if (mode === 'rotate') patch = { rotation: dragState.pendingRotation };
        else patch = {
          w: Math.round(dragState.pendingW * 10) / 10, h: Math.round(dragState.pendingH * 10) / 10,
          x: Math.round(dragState.pendingX * 10) / 10, y: Math.round(dragState.pendingY * 10) / 10,
        };
      }
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      removeAlignGuides();
      dragState = null;
      if (patch) {
        updateField(fieldId, patch);
        persist();
        repaintFieldsList();
      }
      // Clique simples (sem arrastar) num campo de texto entra direto em edição — não precisa de
      // duplo-clique. Isso deixa arrastar (clique + mover) e editar (clique parado) no mesmo botão,
      // igual editores de carta como o ShuffleKit — só um clique "parado" vira edição, um clique que
      // efetivamente moveu o campo continua só selecionando.
      if (!moved && mode === 'move') {
        var draggedField = state.fields.filter(function (x) { return x.id === fieldId; })[0];
        if (draggedField && draggedField.type === 'text') { enterTextEditMode(fieldId); return; }
      }
      selectField(fieldId, { syncFieldList: !moved });
    }

    function bindDragHandlers() {
      previewEl.onclick = function (e) {
        if (e.target === previewEl) { exitTextEditMode(); selectField(null, {}); }
      };
      // Clicar no padding ao redor da carta (fora dela, mas dentro do painel de preview) também
      // desseleciona — antes só funcionava clicando dentro da carta mas fora de qualquer campo.
      container.querySelectorAll('.card-designer-preview-stage').forEach(function (stage) {
        stage.onclick = function (e) {
          if (e.target === stage) { exitTextEditMode(); selectField(null, {}); }
        };
      });
      previewEl.querySelectorAll('[data-field-id]').forEach(function (el) {
        var fieldId0 = el.getAttribute('data-field-id');
        el.addEventListener('mousedown', function (e) {
          if (e.target.closest('[data-resize-handle]') || e.target.closest('[data-rotate-handle]')) return;
          if (fieldId0 === editingFieldId) return; // editando texto: deixa o clique posicionar o cursor normalmente
          // Clicar em OUTRO campo enquanto um texto está em edição: sai do modo de edição primeiro
          // (persistindo o que já foi digitado) — não dá pra confiar só no blur nativo aqui, porque
          // o preventDefault logo abaixo (necessário pra iniciar o arrasto sem selecionar texto)
          // também suprime a troca de foco padrão do navegador em alguns casos.
          if (editingFieldId && editingFieldId !== fieldId0) exitTextEditMode();
          var fieldId = el.getAttribute('data-field-id');
          var f = state.fields.filter(function (x) { return x.id === fieldId; })[0];
          if (!f) return;
          if (f.locked) {
            // Campo travado: o clique só SELECIONA (pra poder inspecionar/destravar pela barra de
            // contexto), sem iniciar arrasto nenhum — é exatamente o que travar deveria impedir.
            e.preventDefault();
            selectField(fieldId, { syncFieldList: true });
            return;
          }
          e.preventDefault();
          dragState = { fieldId: fieldId, mode: 'move', startX: e.clientX, startY: e.clientY, origX: f.x, origY: f.y, pendingX: f.x, pendingY: f.y, moved: false };
          document.addEventListener('mousemove', onDragMove);
          document.addEventListener('mouseup', onDragEnd);
        });
        // Botão direito seleciona o campo e já abre o balão contextual na hora, sem precisar arrastar
        // nem clicar com o esquerdo primeiro — atalho rápido pra ajustar um campo que já está visível.
        el.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          var fieldId = el.getAttribute('data-field-id');
          if (editingFieldId && editingFieldId !== fieldId) exitTextEditMode();
          selectField(fieldId, {});
        });
        // Campo de imagem aceita soltar um arquivo direto do explorador, sem precisar abrir o
        // seletor de arquivo pelo balão de contexto.
        var fieldId2 = el.getAttribute('data-field-id');
        var f2 = state.fields.filter(function (x) { return x.id === fieldId2; })[0];
        if (f2 && f2.type === 'image') {
          bindImageDropZone(el, function (file) {
            var row = state.rows.filter(function (r) { return r.id === selectedRowId; })[0] || state.rows[0];
            if (!row) return;
            selectField(fieldId2, {});
            assignImageToRowField(fieldId2, row.id, file);
          });
        }
        // Campo de ícones aceita soltar um ícone arrastado da biblioteca (painel Elementos) — soma
        // à carta selecionada, sem precisar abrir o campo e clicar no chip correspondente.
        if (f2 && f2.type === 'icons') {
          bindIconDropZone(el, function (iconId) {
            selectField(fieldId2, {});
            addIconToRowField(fieldId2, iconId);
          });
        }
        // Campo de texto: entrar em edição agora é tratado no clique simples (ver onDragEnd,
        // ramo "!moved && mode === 'move'") — não depende de duplo-clique.
      });
      previewEl.querySelectorAll('[data-resize-handle]').forEach(function (el) {
        el.addEventListener('mousedown', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var fieldId = el.getAttribute('data-resize-handle');
          var corner = el.getAttribute('data-resize-corner') || 'se';
          var f = state.fields.filter(function (x) { return x.id === fieldId; })[0];
          if (!f) return;
          dragState = {
            fieldId: fieldId, mode: 'resize', corner: corner, startX: e.clientX, startY: e.clientY,
            origX: f.x, origY: f.y, origW: f.w, origH: f.h, origRotation: f.rotation,
            pendingX: f.x, pendingY: f.y, pendingW: f.w, pendingH: f.h, moved: false,
          };
          document.addEventListener('mousemove', onDragMove);
          document.addEventListener('mouseup', onDragEnd);
        });
      });
      previewEl.querySelectorAll('[data-rotate-handle]').forEach(function (el) {
        el.addEventListener('mousedown', function (e) {
          e.preventDefault();
          e.stopPropagation();
          var fieldId = el.getAttribute('data-rotate-handle');
          var f = state.fields.filter(function (x) { return x.id === fieldId; })[0];
          var fieldEl = previewEl.querySelector('[data-field-id="' + fieldId + '"]');
          if (!f || !fieldEl) return;
          // O centro em coordenadas de TELA é o pivô do giro — precisa vir do retângulo renderizado
          // de verdade (getBoundingClientRect), não recalculado a partir de x/y/w/h, porque a carta
          // pode estar com zoom/scroll/fullscreen aplicados.
          var rect = fieldEl.getBoundingClientRect();
          dragState = {
            fieldId: fieldId, mode: 'rotate',
            centerX: rect.left + rect.width / 2, centerY: rect.top + rect.height / 2,
            origRotation: f.rotation, pendingRotation: f.rotation, moved: false,
          };
          document.addEventListener('mousemove', onDragMove);
          document.addEventListener('mouseup', onDragEnd);
        });
      });

      // Se um campo está em edição neste repaint, liga o elemento contenteditable correspondente
      // (foi recriado do zero pelo innerHTML acima, então precisa religar toda vez).
      if (editingFieldId) bindActiveTextEdit(editingFieldId);
    }

    // Entra no modo de edição direto no canvas pro campo de texto `fieldId`: troca o <span> normal
    // (com inlineMarkupHtml já renderizado) por um contenteditable mostrando o texto cru — sair (blur
    // ou Esc) volta pro modo normal e persiste. Evita repintar a carta inteira a cada tecla digitada
    // (repaintPreview() destruiria o próprio nó sendo editado, perdendo foco/cursor no meio da
    // digitação) — só repinta ao ENTRAR e ao SAIR do modo de edição.
    function enterTextEditMode(fieldId) {
      if (editingFieldId === fieldId) return;
      editingFieldId = fieldId;
      selectField(fieldId, {}); // já repinta (bindDragHandlers liga o contenteditable no final)
    }

    function exitTextEditMode() {
      if (!editingFieldId) return;
      editingFieldId = null;
      persist();
      repaintPreview();
      repaintFieldsList();
      repaintTable();
    }

    function bindActiveTextEdit(fieldId) {
      var el = previewEl.querySelector('[data-editable-field="' + fieldId + '"]');
      if (!el) return;
      el.focus();
      // Cursor no fim do texto ao entrar em edição (mais previsível que deixar o navegador escolher).
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      var sel = global.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      el.addEventListener('input', function (e) {
        var rowId = selectedRowId;
        var text = el.textContent;
        state.rows = state.rows.map(function (r) { if (r.id !== rowId) return r; var copy = Object.assign({}, r); copy[fieldId] = text; return copy; });
        persist();
        // Repinta só a tabela/Camadas (fora de previewEl — não afeta o elemento sendo editado);
        // a própria carta NÃO repinta até sair do modo de edição (ver comentário em enterTextEditMode).
        repaintTable();
        var ta = fieldsListEl.querySelector('[data-inline-text="' + fieldId + '"]');
        if (ta && document.activeElement !== ta) ta.value = text;

        // Formatação visível ao vivo: durante composição de IME (chinês/japonês/coreano etc.), o
        // texto ainda está "provisório" — trocar o innerHTML no meio disso quebra o estado de
        // composição do navegador. Deixa o texto cru aparecer até o 'compositionend' de verdade
        // completar (ver o listener logo abaixo), e só então re-renderiza.
        if (e && e.isComposing) return;
        var caretOffset = getPlainTextCaretOffset(el);
        el.innerHTML = liveInlineMarkupHtml(text);
        if (caretOffset !== null) setPlainTextCaretOffset(el, caretOffset);
      });
      el.addEventListener('compositionend', function () {
        var caretOffset = getPlainTextCaretOffset(el);
        el.innerHTML = liveInlineMarkupHtml(el.textContent);
        if (caretOffset !== null) setPlainTextCaretOffset(el, caretOffset);
      });
      // O blur dispara SÍNCRONO como parte da troca de foco no mousedown de um novo alvo — se
      // esse novo alvo for um botão da lista de Camadas (mover/duplicar/remover), chamar
      // exitTextEditMode() aqui DIRETO troca o DOM da lista (repaintFieldsList) no MEIO do gesto
      // de clique, entre o mousedown e o mouseup — o navegador não sintetiza o evento "click" nesse
      // caso, porque o elemento que recebeu o mousedown some do documento antes do mouseup (bug real
      // encontrado testando o botão de duplicar: o clique simplesmente não fazia nada, sem erro
      // nenhum). Adiar a repintura em si (não o corte do estado de edição, que seria estranho
      // deixar pendente) pro próximo tick deixa o clique original completar contra o DOM ainda
      // intacto; o botão então dispara normalmente e a lista atualiza (pra refletir o texto editado
      // e, se for o caso, a própria ação do botão) logo em seguida.
      el.addEventListener('blur', function () { setTimeout(exitTextEditMode, 0); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); el.blur(); }
        // Enter normal insere quebra de linha (campo já suporta multi-linha) — só Esc/clicar fora sai.
      });
      el.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    }

    // ---------- Tela cheia (padrão do app: js/telaCheia.js) ----------
    // Se este render substituiu um palco que estava em tela cheia (reset/import), sai dela — senão a
    // página ficaria travada (sem rolagem) apontando pra um elemento que já não existe.
    if (GDC.fullscreen.isActive() && !document.querySelector('.wp-fullscreen')) GDC.fullscreen.exit();

    function toggleFullscreen() { GDC.fullscreen.toggle(stageEl); }

    stageEl.addEventListener('wpfullscreenchange', function (e) {
      var isFs = !!(e.detail && e.detail.active);
      var fresh = document.createElement('div');
      fresh.innerHTML = GDC.fullscreen.buttonMarkup('wp-icon-btn', isFs, 'id="cd-fullscreen"');
      fsBtn.className = fresh.firstChild.className;
      fsBtn.title = fresh.firstChild.title;
      fsBtn.setAttribute('aria-label', fresh.firstChild.title);
      fsBtn.innerHTML = fresh.firstChild.innerHTML;
    });
    fsBtn.addEventListener('click', toggleFullscreen);

    // ---------- Preview (carta selecionada) ----------

    // Opacidade/gradiente/sombra — mesmas 3 propriedades novas, usadas tanto no canvas quanto na
    // exportação/impressão, só que com unidades diferentes (px escalado vs mm direto) — daí receber
    // uma função de conversão em vez de duplicar essa lógica duas vezes.
    function fieldExtraStyle(f, mmToUnit) {
      var s = '';
      if (f.opacity < 100) s += 'opacity:' + (f.opacity / 100) + ';';
      if (f.gradient) s += 'background-image:linear-gradient(' + f.gradientDirection + ',' + (f.bgColor || '#ffffff') + ',' + f.gradientColor2 + ');';
      if (f.shadow) s += 'box-shadow:' + mmToUnit(f.shadowOffsetMm) + ' ' + mmToUnit(f.shadowOffsetMm) + ' ' + mmToUnit(f.shadowBlurMm) + ' 0 ' + f.shadowColor + ';';
      return s;
    }

    function fieldPreviewStyle(f) {
      var isShapedPanel = f.type === 'panel' && f.shape !== 'rect';
      var s = 'left:' + ((f.x + state.bleedMm) * PREVIEW_SCALE) + 'px;top:' + ((f.y + state.bleedMm) * PREVIEW_SCALE) + 'px;' +
        'width:' + (f.w * PREVIEW_SCALE) + 'px;height:' + (f.h * PREVIEW_SCALE) + 'px;' +
        'border-radius:' + (f.borderRadius * PREVIEW_SCALE) + 'px;box-sizing:border-box;' +
        'padding:' + (f.paddingMm * PREVIEW_SCALE) + 'px;';
      // Painel com uma FORMA (círculo, losango...) desenha o próprio preenchimento/contorno via SVG
      // (ver panelShapeSvgMarkup) — aplicar bgColor/border AQUI TAMBÉM desenharia uma caixa retangular
      // colorida por baixo da forma, que é exatamente a caixa que a forma deveria substituir.
      if (f.bgColor && !isShapedPanel) s += 'background-color:' + f.bgColor + ';';
      if (f.borderColor && f.borderWidthMm > 0 && !isShapedPanel) s += 'border:' + (f.borderWidthMm * PREVIEW_SCALE) + 'px solid ' + f.borderColor + ';';
      s += fieldExtraStyle(f, function (mm) { return (mm * PREVIEW_SCALE) + 'px'; });
      // Rotação é só visual (transform), nunca muda x/y/w/h — a "caixa" do campo continua reta no
      // espaço lógico da carta (é o que os cálculos de arrastar/colidir/exportar usam); só o
      // desenho gira em torno do próprio centro. Isso é deliberado: alças de redimensionar nos 4
      // cantos (próxima fase) usam essa mesma convenção — sem ela, teria que refazer a matemática
      // de posição toda vez que a rotação mudasse.
      if (f.rotation) s += 'transform:rotate(' + f.rotation + 'deg);transform-origin:center center;';
      return s;
    }

    function guidesOverlayHtml() {
      if (!state.showGuides) return '';
      var b = state.bleedMm * PREVIEW_SCALE;
      var s = (state.bleedMm + state.safeMarginMm) * PREVIEW_SCALE;
      var trimW = state.cardWidthMm * PREVIEW_SCALE, trimH = state.cardHeightMm * PREVIEW_SCALE;
      var safeW = trimW - 2 * state.safeMarginMm * PREVIEW_SCALE, safeH = trimH - 2 * state.safeMarginMm * PREVIEW_SCALE;
      var html = '';
      if (state.bleedMm > 0) {
        html += '<div class="card-designer-guide card-designer-guide-trim" style="left:' + b + 'px;top:' + b + 'px;width:' + trimW + 'px;height:' + trimH + 'px;"></div>';
      }
      if (state.safeMarginMm > 0 && safeW > 0 && safeH > 0) {
        html += '<div class="card-designer-guide card-designer-guide-safe" style="left:' + s + 'px;top:' + s + 'px;width:' + safeW + 'px;height:' + safeH + 'px;"></div>';
      }
      if (state.snapGridMm > 0) {
        var cell = state.snapGridMm * PREVIEW_SCALE;
        html += '<div class="card-designer-guide-grid" style="left:' + b + 'px;top:' + b + 'px;width:' + trimW + 'px;height:' + trimH + 'px;background-size:' + cell + 'px ' + cell + 'px;"></div>';
      }
      return html;
    }

    // 4 alças de redimensionar em formato de "L" (cantos), uma por canto — substituem a bolinha azul
    // única que só existia no canto inferior-direito. Cada uma guarda o próprio canto em
    // data-resize-corner; o canto OPOSTO ao arrastado é a âncora que fica parada (mesma convenção de
    // qualquer editor visual: puxar o canto superior-esquerdo redimensiona mantendo o
    // inferior-direito no lugar, e vice-versa).
    function cornerHandlesHtml(fieldId) {
      return ['nw', 'ne', 'sw', 'se'].map(function (corner) {
        return '<span class="card-designer-resize-handle card-designer-resize-handle-' + corner + '" data-resize-handle="' + fieldId + '" data-resize-corner="' + corner + '"></span>';
      }).join('');
    }

    // Gera o HTML de todos os campos de uma carta (linha de dados), na escala atual de PREVIEW_SCALE.
    // Reaproveitada tanto pelo canvas principal (interactive=true, com seleção/alça) quanto pelas
    // miniaturas da grade de baralho (interactive=false) — só troca o PREVIEW_SCALE antes de chamar
    // pra gerar num tamanho de miniatura, sem duplicar toda essa lógica de novo.
    function buildFieldsHtml(row, interactive) {
      function wrap(f, extraClass, innerHtml) {
        var style = fieldPreviewStyle(f);
        var sel = interactive && f.id === selectedFieldId ? ' card-designer-field-selected' : '';
        var showHandle = interactive && f.id === selectedFieldId && f.id !== editingFieldId && !f.locked;
        return '<div class="card-designer-field-preview ' + extraClass + sel + '" style="' + style + '" data-field-id="' + f.id + '">' +
          innerHtml +
          (interactive && f.locked ? '<span class="card-designer-lock-badge" title="Campo travado">🔒</span>' : '') +
          (showHandle ? cornerHandlesHtml(f.id) : '') +
          (showHandle ? '<span class="card-designer-rotate-handle" data-rotate-handle="' + f.id + '" title="Arraste pra girar (Shift trava em passos de 15°)">' + GDC.icon('refresh-cw', { size: 11 }) + '</span>' : '') +
          '</div>';
      }
      return state.fields.map(function (f) {
        if (f.type === 'panel' || f.type === 'frame' || f.type === 'background') {
          // Painel com uma forma (!= retângulo) desenha o preenchimento/contorno via SVG (ver
          // panelShapeSvgMarkup) — fieldPreviewStyle já sabe pra NÃO desenhar a caixa retangular
          // comum nesse caso (ver isShapedPanel lá). Moldura pode ter uma imagem própria (inclusive
          // SVG — mesmo pipeline de upload dos campos de Imagem comuns) por cima da borda CSS, pra
          // servir de moldura decorativa/vetorial.
          var shapeContent = (f.type === 'panel' && f.shape !== 'rect') ? panelShapeSvgMarkup(f) : '';
          var frameImgId = f.type === 'frame' && row ? row[f.id] : '';
          var frameImgHtml = frameImgId ? '<span data-preview-image="' + escapeAttr(frameImgId) + '" style="position:absolute;inset:0;background-size:' + f.imageFit + ';background-position:center;background-repeat:no-repeat"></span>' : '';
          return wrap(f, 'card-designer-field-panel', shapeContent + frameImgHtml);
        }
        if (f.type === 'image') {
          var imgId = row ? row[f.id] : '';
          return wrap(f, 'card-designer-field-image' + (imgId ? '' : ' card-designer-field-image-empty'), '<span data-preview-image="' + escapeAttr(imgId || '') + '" style="position:absolute;inset:0;background-size:' + f.imageFit + ';background-position:center;background-repeat:no-repeat"></span>' +
            (imgId ? '' : GDC.icon('image', { size: 16, className: 'text-muted' })));
        }
        if (f.type === 'icons') {
          var tokens = parseIconTokens(row ? row[f.id] : '');
          // Ícone escala junto com a altura do campo (e portanto com o zoom/escala da carta) — antes
          // ficava travado num tamanho fixo em pixel, então ficava minúsculo numa carta grande.
          var chipPx = Math.round(clamp(f.h * PREVIEW_SCALE * 0.7, 10, 300));
          var chipStyle = 'width:' + chipPx + 'px;height:' + chipPx + 'px;';
          var emojiChipStyle = chipStyle + 'font-size:' + Math.round(chipPx * 0.72) + 'px;';
          // Só mostra fileiras de ícone que cabem INTEIRAS no campo — sem isso, quando os ícones não
          // cabiam todos, uma fileira parcial aparecia cortada NO MEIO de cada ícone (o overflow:hidden
          // do campo tecnicamente funcionava certo, mas o resultado visual — meio ícone visível —
          // lia como bug de renderização quebrada). O que não cabe vira um chip "+N" no final, em vez
          // de simplesmente sumir sem nenhum aviso.
          var gapPx = 2;
          var perRow = Math.max(1, Math.floor((f.w * PREVIEW_SCALE + gapPx) / (chipPx + gapPx)));
          var maxRows = Math.max(1, Math.floor((f.h * PREVIEW_SCALE + gapPx) / (chipPx + gapPx)));
          var maxSlots = perRow * maxRows;
          var showMoreChip = tokens.length > maxSlots;
          var visibleCount = showMoreChip ? Math.max(0, maxSlots - 1) : tokens.length;
          var hiddenCount = tokens.length - visibleCount;
          var iconsHtml = tokens.length ? tokens.slice(0, visibleCount).map(function (tok) {
            var icon = state.iconLibrary.filter(function (ic) { return ic.name.toLowerCase() === tok.toLowerCase(); })[0];
            if (icon && icon.emoji) return '<span class="card-designer-icon-chip card-designer-icon-chip-emoji" style="' + emojiChipStyle + '">' + escapeHtml(icon.emoji) + '</span>';
            if (icon && icon.shape) return '<span class="card-designer-icon-chip" style="' + chipStyle + '">' + shapeSvgMarkup(icon.shape, icon.shapeFill, icon.shapeStroke, icon.shapeStrokeWidth) + '</span>';
            return '<span class="card-designer-icon-chip" style="' + chipStyle + '" data-preview-image="' + escapeAttr(icon ? icon.imageId : '') + '">' + (icon ? '' : '?') + '</span>';
          }).join('') + (hiddenCount > 0 ? '<span class="card-designer-icon-chip card-designer-icon-chip-more" style="' + chipStyle + '" title="+' + hiddenCount + ' ícone(s) — aumente o campo pra mostrar todos">+' + hiddenCount + '</span>' : '') : (interactive ? GDC.icon('image', { size: 14, className: 'text-muted' }) : '');
          return wrap(f, 'card-designer-field-icons' + (tokens.length ? '' : ' card-designer-field-icons-empty'), iconsHtml);
        }
        var textStyle = 'font-size:' + (f.fontSize * PREVIEW_SCALE) + 'px;color:' + f.color + ';text-align:' + f.align + ';' +
          'font-family:' + fontFamilyCss(f.fontFamily, state) + ';font-weight:' + (f.bold ? '700' : '400') + ';font-style:' + (f.italic ? 'italic' : 'normal') + ';' +
          'text-decoration-line:' + textDecorationCss(f) + ';width:100%;height:100%;white-space:pre-wrap;word-break:break-word;outline:none;';
        var isEditing = interactive && f.id === editingFieldId;
        // Editando: mostra o texto já com a formatação ao vivo (negrito/itálico/sublinhado reais
        // aparecendo enquanto a pessoa digita — ver liveInlineMarkupHtml), não mais o texto cru com
        // os marcadores **/./__/~~ à mostra. Os marcadores continuam no DOM (só discretos, via
        // .cd-live-marker), então o texto puro salvo em state.rows nunca se perde. Sair do modo de
        // edição troca pro <span> "definitivo" com inlineMarkupHtml() (que aí sim remove os
        // marcadores da exibição, já que não tem mais por que aparecer fora de edição).
        var textInner = isEditing
          ? liveInlineMarkupHtml(row ? row[f.id] : '')
          : inlineMarkupHtml(row ? row[f.id] : '');
        var editableAttrs = isEditing ? ' contenteditable="true" data-editable-field="' + f.id + '"' : '';
        return wrap(f, 'card-designer-field-text' + (isEditing ? ' card-designer-field-text-editing' : ''), '<span style="display:block;' + textStyle + '"' + editableAttrs + '>' + textInner + '</span>');
      }).join('');
    }

    function repaintPreview() {
      var row = state.rows.filter(function (r) { return r.id === selectedRowId; })[0] || state.rows[0];
      var w = (state.cardWidthMm + 2 * state.bleedMm) * PREVIEW_SCALE, h = (state.cardHeightMm + 2 * state.bleedMm) * PREVIEW_SCALE;
      previewEl.style.width = w + 'px';
      previewEl.style.height = h + 'px';
      previewEl.style.backgroundColor = state.bgColor;

      previewEl.innerHTML = buildFieldsHtml(row, true) + guidesOverlayHtml();

      previewEl.querySelectorAll('[data-preview-image]').forEach(function (el) {
        var id = el.getAttribute('data-preview-image');
        if (!id || !GDC.imageStore) return;
        GDC.imageStore.getURL(id).then(function (url) {
          if (url) el.style.backgroundImage = 'url(' + url + ')';
        });
      });

      bindDragHandlers();
    }

    function repaintBackPreview() {
      if (!state.back.enabled) return;
      var w = (state.cardWidthMm + 2 * state.bleedMm) * PREVIEW_SCALE, h = (state.cardHeightMm + 2 * state.bleedMm) * PREVIEW_SCALE;
      backPreviewEl.style.width = w + 'px';
      backPreviewEl.style.height = h + 'px';
      backPreviewEl.style.backgroundColor = state.back.bgColor;
      backPreviewEl.innerHTML = '';
      if (state.back.imageId && GDC.imageStore) {
        GDC.imageStore.getURL(state.back.imageId).then(function (url) {
          if (url) backPreviewEl.style.backgroundImage = 'url(' + url + ')';
        });
        backPreviewEl.style.backgroundSize = 'cover';
        backPreviewEl.style.backgroundPosition = 'center';
      } else {
        backPreviewEl.style.backgroundImage = 'none';
      }
    }

    // ---------- Configuração da carta ----------

    presetSel.addEventListener('change', function () {
      var preset = PRESETS.filter(function (p) { return p.id === presetSel.value; })[0];
      state.preset = presetSel.value;
      if (preset && preset.w) {
        state.cardWidthMm = preset.w;
        state.cardHeightMm = preset.h;
        widthInput.value = preset.w;
        heightInput.value = preset.h;
      }
      widthInput.disabled = state.preset !== 'custom';
      heightInput.disabled = state.preset !== 'custom';
      persist();
      refreshAutoScale();
      repaintPreview();
      repaintBackPreview();
    });
    widthInput.addEventListener('input', function () {
      state.cardWidthMm = clamp(Number(widthInput.value), LIMITS.dim.min, LIMITS.dim.max);
      persist();
      refreshAutoScale();
      repaintPreview();
      repaintBackPreview();
    });
    heightInput.addEventListener('input', function () {
      state.cardHeightMm = clamp(Number(heightInput.value), LIMITS.dim.min, LIMITS.dim.max);
      persist();
      refreshAutoScale();
      repaintPreview();
      repaintBackPreview();
    });
    bgInput.addEventListener('input', function () {
      state.bgColor = bgInput.value;
      persist();
      repaintPreview();
    });
    bindColorTrigger(container.querySelector('.card-designer-config'));
    bleedInput.addEventListener('input', function () {
      state.bleedMm = clamp(Number(bleedInput.value) || 0, 0, LIMITS.bleed.max);
      persist();
      refreshAutoScale();
      repaintPreview();
      repaintBackPreview();
    });
    safeMarginInput.addEventListener('input', function () {
      state.safeMarginMm = clamp(Number(safeMarginInput.value) || 0, 0, LIMITS.bleed.max);
      persist();
      repaintPreview();
    });
    showGuidesInput.addEventListener('change', function () {
      state.showGuides = showGuidesInput.checked;
      persist();
      repaintPreview();
    });
    var cutMarksInput = container.querySelector('#cd-cut-marks');
    if (cutMarksInput) cutMarksInput.addEventListener('change', function () {
      state.cutMarks = cutMarksInput.checked;
      persist();
    });

    var snapGridInput = container.querySelector('#cd-snap-grid');
    snapGridInput.addEventListener('change', function () {
      state.snapGridMm = Number(snapGridInput.value) || 0;
      persist();
      repaintPreview();
    });

    // ---------- Verso da carta ----------

    function assignBackImage(file) {
      if (!GDC.imageStore) return;
      GDC.imageStore.put(file).then(function (meta) {
        state.back.imageId = meta.id;
        persist();
        repaintBackBody();
        repaintBackPreview();
      });
    }

    function repaintBackBody() {
      backBodyEl.innerHTML =
        '<div class="flex flex-wrap items-end gap-3">' +
        '  <div class="text-xs text-secondary">Cor de fundo' +
        '    <div class="flex items-center gap-2 mt-1"><input type="color" id="cd-back-bg" value="' + state.back.bgColor + '" class="card-designer-color-input-hidden" />' + colorTriggerMarkup('#cd-back-bg', state.back.bgColor) + '</div>' +
        '  </div>' +
        (state.back.perCardBack ? '' :
          '  <div class="text-xs text-secondary">' +
          '    <span class="block mb-1">Imagem (cobre a carta inteira)</span>' +
          '    <button type="button" id="cd-back-image-pick" class="card-designer-img-cell" data-image-thumb="' + escapeAttr(state.back.imageId || '') + '" style="width:3.5rem;height:3.5rem">' +
          (state.back.imageId ? '' : GDC.icon('image', { size: 16, className: 'text-muted' })) + '</button>' +
          (state.back.imageId ? '<button type="button" id="cd-back-image-clear" class="btn-ghost py-1 text-xs mt-1">Remover imagem</button>' : '') +
          '  </div>') +
        '  <label class="text-xs text-secondary flex items-center gap-2" style="padding-bottom:.5rem" title="Cada carta pode ter uma imagem de verso diferente (defina na aba Cartas, visão de tabela) em vez de uma imagem única pra todo o baralho">' +
        '    <input type="checkbox" id="cd-back-percard" ' + (state.back.perCardBack ? 'checked' : '') + ' /> Verso individual por carta' +
        '  </label>' +
        '  <label class="text-xs text-secondary flex items-center gap-2" style="padding-bottom:.5rem">' +
        '    <input type="checkbox" id="cd-back-mirror" ' + (state.back.mirrorForDuplex ? 'checked' : '') + ' /> Espelhar pra impressão frente-e-verso' +
        '  </label>' +
        '  <label class="text-xs text-secondary" title="Como a folha vira fisicamente ao imprimir dos dois lados — muda qual eixo (linhas ou colunas) precisa inverter pro verso alinhar certo com a frente">Virada<select id="cd-back-duplexmode" class="input-field mt-1 py-1.5 text-xs" ' + (state.back.mirrorForDuplex ? '' : 'disabled') + '>' +
        '    <option value="long"' + (state.back.duplexMode === 'long' ? ' selected' : '') + '>Borda longa (livro)</option>' +
        '    <option value="short"' + (state.back.duplexMode === 'short' ? ' selected' : '') + '>Borda curta (bloco)</option>' +
        '  </select></label>' +
        '</div>';

      if (GDC.imageStore) GDC.imageStore.resolveThumbs(backBodyEl);

      backBodyEl.querySelector('#cd-back-bg').addEventListener('input', function (e) {
        state.back.bgColor = e.target.value;
        persist();
        repaintBackPreview();
      });
      backBodyEl.querySelector('#cd-back-mirror').addEventListener('change', function (e) {
        state.back.mirrorForDuplex = e.target.checked;
        persist();
        repaintBackBody();
      });
      backBodyEl.querySelector('#cd-back-duplexmode').addEventListener('change', function (e) {
        state.back.duplexMode = e.target.value === 'short' ? 'short' : 'long';
        persist();
      });
      backBodyEl.querySelector('#cd-back-percard').addEventListener('change', function (e) {
        state.back.perCardBack = e.target.checked;
        persist();
        repaintBackBody();
        repaintBackPreview();
        repaintTable();
      });
      bindColorTrigger(backBodyEl);
      var pickBtn = backBodyEl.querySelector('#cd-back-image-pick');
      if (pickBtn) pickBtn.addEventListener('click', function () {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', function () {
          var file = input.files && input.files[0];
          if (!file) return;
          assignBackImage(file);
        });
        input.click();
      });
      var clearBtn = backBodyEl.querySelector('#cd-back-image-clear');
      if (clearBtn) clearBtn.addEventListener('click', function () {
        state.back.imageId = '';
        persist();
        repaintBackBody();
        repaintBackPreview();
      });
    }

    backEnabledEl.addEventListener('change', function () {
      state.back.enabled = backEnabledEl.checked;
      backBodyEl.style.display = state.back.enabled ? '' : 'none';
      var backTab = container.querySelector('[data-preview-side="back"]');
      backTab.disabled = !state.back.enabled;
      backTab.title = state.back.enabled ? '' : 'Ative o verso da carta pra ver o preview';
      if (!state.back.enabled) setPreviewSide('front');
      persist();
      repaintBackPreview();
    });
    repaintBackBody();
    repaintBackPreview();
    // O card do verso não é recriado a cada repaint (só o innerHTML muda), então a dropzone é
    // ligada uma única vez aqui, não dentro de repaintBackPreview.
    bindImageDropZone(backPreviewEl, function (file) { assignBackImage(file); });

    // ---------- Frente/Verso ----------

    function setPreviewSide(side) {
      previewEl.style.display = side === 'front' ? '' : 'none';
      backPreviewEl.style.display = side === 'back' ? '' : 'none';
      container.querySelectorAll('[data-preview-side]').forEach(function (btn) {
        btn.classList.toggle('card-designer-preview-side-tab-active', btn.getAttribute('data-preview-side') === side);
      });
    }
    container.querySelectorAll('[data-preview-side]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        setPreviewSide(btn.getAttribute('data-preview-side'));
      });
    });

    // ---------- Campos ----------

    function inlineIconPickerMarkup(f, currentTokens) {
      return '      <div class="card-designer-inline-icon-picker" data-inline-icon-picker="' + f.id + '">' +
        state.iconLibrary.map(function (ic) {
          var active = currentTokens.some(function (t) { return t.toLowerCase() === ic.name.toLowerCase(); });
          var thumb = ic.emoji
            ? '<span class="card-designer-icon-pick-thumb card-designer-icon-pick-thumb-emoji">' + escapeHtml(ic.emoji) + '</span>'
            : ic.shape
              ? '<span class="card-designer-icon-pick-thumb">' + shapeSvgMarkup(ic.shape, ic.shapeFill, ic.shapeStroke, ic.shapeStrokeWidth) + '</span>'
              : '<span class="card-designer-icon-pick-thumb" data-preview-image="' + escapeAttr(ic.imageId || '') + '"></span>';
          return '<button type="button" class="card-designer-icon-pick-chip' + (active ? ' card-designer-icon-pick-chip-active' : '') + '" data-inline-icon-toggle="' + f.id + '|' + escapeAttr(ic.name) + '">' +
            thumb + '<span>' + escapeHtml(ic.name) + '</span>' + (active ? GDC.icon('check', { size: 11 }) : '') + '</button>';
        }).join('') +
        '      </div>';
    }

    function iconSetRowMarkup(icon) {
      var isShape = !!icon.shape;
      var isEmoji = !!icon.emoji;
      var previewHtml = isEmoji
        ? '<span class="card-designer-shape-preview card-designer-icon-draggable" draggable="true" data-icon-drag="' + icon.id + '" title="Arraste pro canvas" style="width:1.5rem;height:1.5rem;font-size:1.25rem;line-height:1">' + escapeHtml(icon.emoji) + '</span>'
        : isShape
          ? '<span class="card-designer-shape-preview card-designer-icon-draggable" draggable="true" data-icon-drag="' + icon.id + '" title="Arraste pro canvas" style="width:1.5rem;height:1.5rem">' + shapeSvgMarkup(icon.shape, icon.shapeFill, icon.shapeStroke, icon.shapeStrokeWidth) + '</span>'
          : '<button type="button" class="card-designer-img-cell card-designer-icon-draggable" draggable="true" data-icon-drag="' + icon.id + '" title="Arraste pro canvas" data-pick-icon-image="' + icon.id + '" data-image-thumb="' + escapeAttr(icon.imageId || '') + '">' +
            (icon.imageId ? '' : GDC.icon('image', { size: 12, className: 'text-muted' })) + '</button>';

      var shapeControlsHtml = isShape
        ? '  <div class="card-designer-iconset-shape-controls">' +
          '    <div class="card-designer-shape-grid">' +
          SHAPE_PRESETS.map(function (s) {
            return '<button type="button" class="card-designer-shape-btn' + (s.id === icon.shape ? ' card-designer-shape-btn-active' : '') + '" data-pick-shape="' + icon.id + '|' + s.id + '" title="' + escapeAttr(s.label) + '">' + shapeSvgMarkup(s.id, icon.shapeFill, null, 0) + '</button>';
          }).join('') +
          '    </div>' +
          '    <div class="flex items-center gap-2 mt-2">' +
          '      <span class="text-xs text-secondary">Preench.</span>' + colorTriggerMarkup('[data-icon-fill="' + icon.id + '"]', icon.shapeFill) +
          '      <input type="color" class="card-designer-color-input-hidden" data-icon-fill="' + icon.id + '" value="' + icon.shapeFill + '" />' +
          '      <label class="text-xs text-secondary flex items-center gap-1"><input type="checkbox" data-icon-has-stroke="' + icon.id + '" ' + (icon.shapeStroke ? 'checked' : '') + ' /> Contorno</label>' +
          colorTriggerMarkup('[data-icon-stroke="' + icon.id + '"]', icon.shapeStroke || '#000000', icon.shapeStroke ? '' : 'disabled') +
          '      <input type="color" class="card-designer-color-input-hidden" data-icon-stroke="' + icon.id + '" value="' + (icon.shapeStroke || '#000000') + '" ' + (icon.shapeStroke ? '' : 'disabled') + ' />' +
          '    </div>' +
          '  </div>'
        : '';

      var emojiControlsHtml = isEmoji
        ? '  <div class="card-designer-iconset-emoji-controls">' +
          '    <div class="card-designer-emoji-grid">' +
          EMOJI_PRESETS.map(function (e) {
            return '<button type="button" class="card-designer-emoji-btn' + (e === icon.emoji ? ' card-designer-emoji-btn-active' : '') + '" data-pick-emoji="' + icon.id + '|' + escapeAttr(e) + '">' + e + '</button>';
          }).join('') +
          '    </div>' +
          '    <input type="text" class="input-field py-1 text-xs mt-2" style="width:6rem" data-icon-emoji-custom="' + icon.id + '" value="' + escapeAttr(icon.emoji) + '" placeholder="ou cole aqui" maxlength="8" />' +
          '  </div>'
        : '';

      return (
        '<div class="card-designer-iconset-row" data-icon-row="' + icon.id + '">' +
        '  <div class="flex items-center gap-2">' +
        previewHtml +
        '    <input type="text" class="input-field py-1 text-xs w-20" data-icon-name="' + icon.id + '" value="' + escapeAttr(icon.name) + '" placeholder="Nome" />' +
        '    <select class="input-field py-1 text-xs" style="width:5.5rem" data-icon-source="' + icon.id + '">' +
        '      <option value="image"' + (!isShape && !isEmoji ? ' selected' : '') + '>Imagem</option>' +
        '      <option value="shape"' + (isShape ? ' selected' : '') + '>Forma</option>' +
        '      <option value="emoji"' + (isEmoji ? ' selected' : '') + '>Emoji</option>' +
        '    </select>' +
        '    <button type="button" class="text-muted hover:text-rose-500" data-remove-icon="' + icon.id + '" title="Remover ícone da biblioteca (some de qualquer carta que o usava)">' + GDC.icon('x', { size: 12 }) + '</button>' +
        '  </div>' +
        shapeControlsHtml +
        emojiControlsHtml +
        '</div>'
      );
    }

    function iconAt(iconId) {
      return state.iconLibrary.filter(function (ic) { return ic.id === iconId; })[0];
    }
    function updateIcon(iconId, patch) {
      state.iconLibrary = state.iconLibrary.map(function (ic) { return ic.id === iconId ? Object.assign({}, ic, patch) : ic; });
    }

    // Uma linha por campo, no estilo Photoshop: nome, tipo, arrastar pra reordenar, clicar pra
    // selecionar (abre a barra de contexto com posição/estilo — ver canvasPopoverContentMarkup).
    // Tudo que antes vivia aqui dentro (posição, fonte, cor, "nesta carta"...) morou na barra de
    // contexto quando um campo é selecionado; a biblioteca de ícones do baralho morou em Elementos.
    var FIELD_TYPE_META = {
      text: { icon: 'type', label: 'Texto' },
      image: { icon: 'image', label: 'Imagem' },
      icons: { icon: 'star', label: 'Ícones' },
      panel: { icon: 'square', label: 'Painel' },
      frame: { icon: 'maximize-2', label: 'Moldura' },
      background: { icon: 'layout-dashboard', label: 'Fundo' },
    };
    function fieldCardMarkup(f, index) {
      var meta = FIELD_TYPE_META[f.type] || FIELD_TYPE_META.text;
      var selected = f.id === selectedFieldId;
      var atFront = index === state.fields.length - 1, atBack = index === 0;
      return (
        '<div class="card-designer-layer-row' + (selected ? ' card-designer-layer-row-selected' : '') + '" data-field-row="' + f.id + '" data-layer-select="' + f.id + '">' +
        '  <span class="card-designer-layer-drag-handle" data-drag-handle="' + f.id + '" title="Arraste pra reordenar">' + GDC.icon('grip-vertical', { size: 14 }) + '</span>' +
        '  <span class="card-designer-layer-type-icon" title="' + meta.label + '">' + GDC.icon(meta.icon, { size: 14 }) + '</span>' +
        '  <input type="text" class="card-designer-layer-name-input" data-f-label="' + f.id + '" value="' + escapeAttr(f.label) + '" placeholder="Nome do campo" />' +
        '  <div class="card-designer-layer-arrange-group">' +
        '    <button type="button" class="btn-ghost card-designer-layer-arrange-btn" data-bring-to-front="' + f.id + '" title="Trazer pra frente (topo de tudo)" ' + (atFront ? 'disabled' : '') + '>↑↑</button>' +
        '    <button type="button" class="btn-ghost card-designer-layer-arrange-btn" data-move-field-up="' + f.id + '" title="Avançar uma camada (sobe um nível, renderiza mais por cima)" ' + (atFront ? 'disabled' : '') + '>↑</button>' +
        '    <button type="button" class="btn-ghost card-designer-layer-arrange-btn" data-move-field-down="' + f.id + '" title="Recuar uma camada (desce um nível, renderiza mais por baixo)" ' + (atBack ? 'disabled' : '') + '>↓</button>' +
        '    <button type="button" class="btn-ghost card-designer-layer-arrange-btn" data-send-to-back="' + f.id + '" title="Mandar pra trás (fundo de tudo)" ' + (atBack ? 'disabled' : '') + '>↓↓</button>' +
        '  </div>' +
        '  <button type="button" class="btn-ghost h-7 w-7 p-0" data-duplicate-field="' + f.id + '" title="Duplicar campo (Ctrl+D)" ' + (state.fields.length >= LIMITS.fields.max ? 'disabled' : '') + '>' + GDC.icon('copy', { size: 13 }) + '</button>' +
        '  <button type="button" class="btn-ghost h-7 w-7 p-0 text-xs" data-toggle-lock="' + f.id + '" title="' + (f.locked ? 'Destravar campo' : 'Travar campo (impede mover/redimensionar/girar sem querer)') + '">' + (f.locked ? '🔒' : '🔓') + '</button>' +
        '  <button type="button" class="text-muted hover:text-rose-500" data-remove-field="' + f.id + '" title="Remover campo">' + GDC.icon('x', { size: 13 }) + '</button>' +
        '</div>'
      );
    }

    function updateField(id, patch) {
      state.fields = state.fields.map(function (f) { return f.id === id ? Object.assign({}, f, patch) : f; });
    }

    function repaintFieldsList() {
      // A lista mostra do topo pra baixo na mesma ordem visual da carta: quem está NA FRENTE
      // (renderiza por cima) fica no TOPO da lista — é a convenção padrão de painel de camadas
      // (Figma, Photoshop etc.) e evita a confusão de setas "invertidas" e campo em cima que
      // parecia renderizar atrás: antes a lista mostrava o mais-atrás primeiro, sem bater com o
      // que a pessoa via na carta.
      fieldsListEl.innerHTML = state.fields.map(function (f, i) { return { f: f, i: i }; }).reverse()
        .map(function (pair) { return fieldCardMarkup(pair.f, pair.i); }).join('');
      if (GDC.imageStore) GDC.imageStore.resolveThumbs(fieldsListEl);
      fieldsListEl.querySelectorAll('[data-preview-image]').forEach(function (el) {
        var id = el.getAttribute('data-preview-image');
        if (!id || !GDC.imageStore) return;
        GDC.imageStore.getURL(id).then(function (url) { if (url) el.style.backgroundImage = 'url(' + url + ')'; });
      });
      addFieldBtn.disabled = state.fields.length >= LIMITS.fields.max;
      bindFieldsListEvents();
    }

    // ---------- Biblioteca de ícones do baralho (mora no painel Elementos, não mais dentro de cada
    // campo de ícones — ver repaintIconLibraryPanel abaixo) ----------

    var iconLibraryListEl = container.querySelector('#cd-ribbon-elements [data-iconset-list]');

    // O botão "+ Ícone" vive FORA de [data-iconset-list] (é irmão dele, não filho — ver o HTML do
    // painel Elementos), então repaintIconLibraryPanel() nunca o recria; religar o clique nele
    // dentro de bindIconLibraryEvents() (chamada a cada repintura) empilhava um listener novo em
    // cima do anterior a cada ícone adicionado — bug real encontrado: 1 clique virava 2 ícones, o
    // próximo virava mais 4, dobrando a cada vez (1→3→7→15...). Por isso esse belisco em particular
    // é ligado uma ÚNICA vez aqui fora, igual o drop de ícone em área vazia do canvas.
    var addIconBtn = container.querySelector('[data-add-icon]');
    if (addIconBtn) addIconBtn.addEventListener('click', function () {
      if (state.iconLibrary.length >= LIMITS.icons.max * 4) return;
      // Precisa dos MESMOS valores padrão que normalizeLibraryIcon() daria (shapeFill etc.) — sem
      // isso, um ícone recém-criado guardava shapeFill undefined até a pessoa abrir o seletor de
      // cor manualmente, e o SVG saía com fill="undefined" (literalmente inválido, invisível).
      var newIcon = { id: makeId('ic'), name: 'ícone' + (state.iconLibrary.length + 1), imageId: '', shape: '', shapeFill: '#3b82f6', shapeStroke: null, shapeStrokeWidth: 1, emoji: '' };
      state.iconLibrary = state.iconLibrary.concat([newIcon]);
      persist();
      repaintIconLibraryPanel();
    });


    function repaintIconLibraryPanel() {
      if (!iconLibraryListEl) return;
      iconLibraryListEl.innerHTML = state.iconLibrary.map(function (ic) { return iconSetRowMarkup(ic); }).join('');
      if (GDC.imageStore) GDC.imageStore.resolveThumbs(iconLibraryListEl);
      bindIconLibraryEvents();
    }

    function bindIconLibraryEvents() {
      container.querySelectorAll('[data-icon-drag]').forEach(function (el) {
        el.addEventListener('dragstart', function (e) {
          var iconId = el.getAttribute('data-icon-drag');
          e.dataTransfer.setData(ICON_DRAG_MIME, iconId);
          e.dataTransfer.effectAllowed = 'copy';
        });
      });
      container.querySelectorAll('[data-icon-name]').forEach(function (el) {
        el.addEventListener('input', function () {
          var iconId = el.getAttribute('data-icon-name');
          var oldIcon = iconAt(iconId);
          var oldName = oldIcon ? oldIcon.name : null;
          var newName = el.value.slice(0, 20);
          updateIcon(iconId, { name: newName });
          // Quem seleciona um ícone (no popover da tabela ou no seletor inline) grava o NOME dele na
          // célula de dados, pra manter o CSV legível — mas isso quebrava silenciosamente sempre que
          // o ícone era renomeado depois de já escolhido: a célula continuava com o nome antigo, que
          // não batia com nada, e o ícone sumia da carta sem nenhum aviso. Renomear agora arrasta a
          // seleção junto, em TODOS os campos de ícones (a biblioteca é compartilhada pelo baralho
          // inteiro, então qualquer campo pode estar referenciando esse nome).
          if (oldName && oldName.toLowerCase() !== newName.toLowerCase()) {
            var iconFieldIds = state.fields.filter(function (f) { return f.type === 'icons'; }).map(function (f) { return f.id; });
            state.rows = state.rows.map(function (r) {
              var copy = null;
              iconFieldIds.forEach(function (fid) {
                var tokens = parseIconTokens(r[fid]);
                if (!tokens.some(function (t) { return t.toLowerCase() === oldName.toLowerCase(); })) return;
                if (!copy) copy = Object.assign({}, r);
                copy[fid] = tokens.map(function (t) { return t.toLowerCase() === oldName.toLowerCase() ? newName : t; }).join(', ');
              });
              return copy || r;
            });
            repaintTable();
          }
          persist();
          repaintPreview();
          updateContextToolbar();
        });
      });
      container.querySelectorAll('[data-pick-icon-image]').forEach(function (el) {
        el.addEventListener('click', function () {
          var iconId = el.getAttribute('data-pick-icon-image');
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file || !GDC.imageStore) return;
            GDC.imageStore.put(file).then(function (meta) {
              updateIcon(iconId, { imageId: meta.id });
              persist();
              repaintIconLibraryPanel();
              repaintPreview();
            });
          });
          input.click();
        });
      });
      container.querySelectorAll('[data-remove-icon]').forEach(function (el) {
        el.addEventListener('click', function () {
          var iconId = el.getAttribute('data-remove-icon');
          state.iconLibrary = state.iconLibrary.filter(function (ic) { return ic.id !== iconId; });
          persist();
          repaintIconLibraryPanel();
          repaintPreview();
          updateContextToolbar();
        });
      });
      container.querySelectorAll('[data-icon-source]').forEach(function (el) {
        el.addEventListener('change', function () {
          var iconId = el.getAttribute('data-icon-source');
          var icon = iconAt(iconId);
          if (el.value === 'shape') {
            updateIcon(iconId, { shape: (icon && icon.shape) || 'circle', emoji: '' });
          } else if (el.value === 'emoji') {
            updateIcon(iconId, { shape: '', emoji: (icon && icon.emoji) || EMOJI_PRESETS[0] });
          } else {
            updateIcon(iconId, { shape: '', emoji: '' });
          }
          persist();
          repaintIconLibraryPanel();
          repaintPreview();
        });
      });
      container.querySelectorAll('[data-pick-emoji]').forEach(function (el) {
        el.addEventListener('click', function () {
          var parts = el.getAttribute('data-pick-emoji').split('|');
          updateIcon(parts[0], { emoji: parts[1] });
          persist();
          repaintIconLibraryPanel();
          repaintPreview();
        });
      });
      container.querySelectorAll('[data-icon-emoji-custom]').forEach(function (el) {
        el.addEventListener('input', function () {
          var iconId = el.getAttribute('data-icon-emoji-custom');
          updateIcon(iconId, { emoji: el.value.slice(0, 8) });
          persist();
          repaintPreview();
        });
      });
      container.querySelectorAll('[data-pick-shape]').forEach(function (el) {
        el.addEventListener('click', function () {
          var parts = el.getAttribute('data-pick-shape').split('|');
          updateIcon(parts[0], { shape: parts[1] });
          persist();
          repaintIconLibraryPanel();
          repaintPreview();
        });
      });
      container.querySelectorAll('[data-icon-fill]').forEach(function (el) {
        el.addEventListener('input', function () {
          var iconId = el.getAttribute('data-icon-fill');
          updateIcon(iconId, { shapeFill: el.value });
          persist();
          repaintIconLibraryPanel();
          repaintPreview();
        });
      });
      container.querySelectorAll('[data-icon-has-stroke]').forEach(function (el) {
        el.addEventListener('change', function () {
          var iconId = el.getAttribute('data-icon-has-stroke');
          var strokeInput = container.querySelector('[data-icon-stroke="' + iconId + '"]');
          updateIcon(iconId, { shapeStroke: el.checked ? (strokeInput ? strokeInput.value : '#000000') : null });
          persist();
          repaintIconLibraryPanel();
          repaintPreview();
        });
      });
      container.querySelectorAll('[data-icon-stroke]').forEach(function (el) {
        el.addEventListener('input', function () {
          var iconId = el.getAttribute('data-icon-stroke');
          updateIcon(iconId, { shapeStroke: el.value });
          persist();
          repaintIconLibraryPanel();
          repaintPreview();
        });
      });
      bindColorTrigger(container.querySelector('#cd-ribbon-elements'));
    }

    function bindFieldsListEvents() {
      fieldsListEl.querySelectorAll('[data-drag-handle]').forEach(function (handle) {
        handle.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var fieldId = handle.getAttribute('data-drag-handle');
          var card = fieldsListEl.querySelector('[data-field-row="' + fieldId + '"]');
          if (!card) return;
          card.classList.add('card-designer-layer-dragging');
          document.body.classList.add('card-designer-resizing-cols'); // reaproveita o cursor/no-select global

          function onMove(ev) {
            var cards = Array.prototype.slice.call(fieldsListEl.querySelectorAll('[data-field-row]'));
            var overCard = cards.filter(function (c) {
              if (c === card) return false;
              var r = c.getBoundingClientRect();
              return ev.clientY >= r.top && ev.clientY <= r.bottom;
            })[0];
            if (!overCard) return;
            var overRect = overCard.getBoundingClientRect();
            var overMid = overRect.top + overRect.height / 2;
            if (ev.clientY < overMid) fieldsListEl.insertBefore(card, overCard);
            else fieldsListEl.insertBefore(card, overCard.nextSibling);
          }
          function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            card.classList.remove('card-designer-layer-dragging');
            document.body.classList.remove('card-designer-resizing-cols');
            // A lista mostra do topo (frente) pra baixo (fundo) — o oposto da ordem interna do
            // array (fundo primeiro). Lê a ordem final do DOM e inverte de volta antes de salvar.
            var newDisplayOrder = Array.prototype.slice.call(fieldsListEl.querySelectorAll('[data-field-row]')).map(function (c) { return c.getAttribute('data-field-row'); });
            var newArrayOrder = newDisplayOrder.slice().reverse();
            var reordered = newArrayOrder.map(function (id) { return state.fields.filter(function (f) { return f.id === id; })[0]; }).filter(Boolean);
            if (reordered.length === state.fields.length) {
              state.fields = reordered;
              persist();
              repaintPreview();
            }
            repaintFieldsList();
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      });
      fieldsListEl.querySelectorAll('[data-inline-text]').forEach(function (el) {
        el.addEventListener('input', function () {
          var fieldId = el.getAttribute('data-inline-text');
          if (!selectedRowId) return;
          state.rows = state.rows.map(function (r) { if (r.id !== selectedRowId) return r; var copy = Object.assign({}, r); copy[fieldId] = el.value; return copy; });
          persist();
          repaintPreview();
          repaintTable();
        });
        el.addEventListener('focus', function () {
          var bar = el.parentElement.querySelector('[data-inline-format-bar]');
          if (bar) bar.style.display = 'flex';
        });
        el.addEventListener('blur', function () {
          var bar = el.parentElement.querySelector('[data-inline-format-bar]');
          if (bar) setTimeout(function () { bar.style.display = 'none'; }, 150);
        });
      });
      fieldsListEl.querySelectorAll('[data-inline-wrap]').forEach(function (btn) {
        btn.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var bar = btn.closest('[data-inline-format-bar]');
          var fieldId = bar.getAttribute('data-inline-format-bar');
          var textarea = fieldsListEl.querySelector('[data-inline-text="' + fieldId + '"]');
          if (!textarea) return;
          var markers = { bold: '**', italic: '*', underline: '__', strike: '~~' };
          toggleTextWrap(textarea, markers[btn.getAttribute('data-inline-wrap')]);
        });
      });
      fieldsListEl.querySelectorAll('[data-inline-image]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var fieldId = btn.getAttribute('data-inline-image');
          var rowId = selectedRowId;
          if (!rowId) return;
          var input2 = document.createElement('input');
          input2.type = 'file';
          input2.accept = 'image/*';
          input2.addEventListener('change', function () {
            var file = input2.files && input2.files[0];
            if (!file || !GDC.imageStore) return;
            GDC.imageStore.put(file).then(function (meta) {
              state.rows = state.rows.map(function (r) { if (r.id !== rowId) return r; var copy = Object.assign({}, r); copy[fieldId] = meta.id; return copy; });
              persist();
              repaintFieldsList();
              repaintPreview();
              repaintTable();
            });
          });
          input2.click();
        });
      });
      fieldsListEl.querySelectorAll('[data-upload-font]').forEach(function (el) {
        el.addEventListener('click', function () {
          if (state.customFonts.length >= LIMITS.customFonts.max) {
            global.alert('Limite de ' + LIMITS.customFonts.max + ' fontes personalizadas por projeto.');
            return;
          }
          var targetFieldId = el.getAttribute('data-upload-font');
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = '.woff,.woff2,.ttf,.otf,font/woff,font/woff2,font/ttf,font/otf';
          input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file || !GDC.fontStore) return;
            var defaultName = file.name.replace(/\.(woff2?|ttf|otf)$/i, '').slice(0, 40) || 'Minha fonte';
            var name = global.prompt('Nome pra essa fonte (como vai aparecer na lista):', defaultName);
            if (!name || !name.trim()) return;
            GDC.fontStore.put(file, name.trim()).then(function (meta) {
              var customFont = { id: makeId('cf'), family: name.trim().replace(/['"]/g, ''), fontFileId: meta.id };
              state.customFonts = state.customFonts.concat([customFont]);
              updateField(targetFieldId, { fontFamily: 'custom:' + customFont.id });
              persist();
              repaintFieldsList();
              repaintPreview();
            }, function () {
              global.alert('Não consegui ler esse arquivo de fonte.');
            });
          });
          input.click();
        });
      });
      bindColorTrigger(fieldsListEl);
      fieldsListEl.querySelectorAll('[data-toggle-collapse]').forEach(function (el) {
        el.addEventListener('click', function () {
          var id = el.getAttribute('data-toggle-collapse');
          collapsedFields[id] = !collapsedFields[id];
          repaintFieldsList();
        });
      });
      fieldsListEl.querySelectorAll('[data-f-label]').forEach(function (el) {
        el.addEventListener('input', function () {
          updateField(el.getAttribute('data-f-label'), { label: el.value.slice(0, 30) });
          persist();
          repaintTableHeader();
        });
      });
      fieldsListEl.querySelectorAll('[data-f-type]').forEach(function (el) {
        el.addEventListener('change', function () {
          var id = el.getAttribute('data-f-type');
          var patch = { type: el.value };
          updateField(id, patch);
          persist();
          repaintFieldsList();
          repaintTable();
          repaintPreview();
        });
      });
      function bindNum(attr, key, min, max) {
        fieldsListEl.querySelectorAll('[' + attr + ']').forEach(function (el) {
          el.addEventListener('input', function () {
            var id = el.getAttribute(attr);
            updateField(id, (function () { var p = {}; p[key] = clamp(Number(el.value), min, max); return p; })());
            persist();
            repaintPreview();
          });
        });
      }
      // X/Y/W/H digitados à mão também não podem colocar o campo pra fora da carta — o limite
      // depende do tamanho atual do PRÓPRIO campo (pra X/Y) ou da posição atual dele (pra W/H), por
      // isso não dá pra usar o bindNum genérico (que só tem um min/max fixo).
      function bindBoundedNum(attr, key) {
        fieldsListEl.querySelectorAll('[' + attr + ']').forEach(function (el) {
          el.addEventListener('input', function () {
            var id = el.getAttribute(attr);
            var f = state.fields.filter(function (x) { return x.id === id; })[0];
            if (!f) return;
            var raw = Number(el.value);
            var val;
            if (key === 'x') val = clamp(raw, 0, Math.max(0, state.cardWidthMm - f.w));
            else if (key === 'y') val = clamp(raw, 0, Math.max(0, state.cardHeightMm - f.h));
            else if (key === 'w') val = clamp(raw, 1, Math.max(1, state.cardWidthMm - f.x));
            else val = clamp(raw, 1, Math.max(1, state.cardHeightMm - f.y));
            var patch = {}; patch[key] = val;
            updateField(id, patch);
            persist();
            repaintPreview();
          });
        });
      }
      bindBoundedNum('data-f-x', 'x');
      bindBoundedNum('data-f-y', 'y');
      bindBoundedNum('data-f-w', 'w');
      bindBoundedNum('data-f-h', 'h');
      bindNum('data-f-font', 'fontSize', LIMITS.font.min, LIMITS.font.max);
      bindNum('data-f-radius', 'borderRadius', LIMITS.radius.min, LIMITS.radius.max);
      bindNum('data-f-padding', 'paddingMm', LIMITS.padding.min, LIMITS.padding.max);
      fieldsListEl.querySelectorAll('[data-f-fontfamily]').forEach(function (el) {
        el.addEventListener('change', function () {
          updateField(el.getAttribute('data-f-fontfamily'), { fontFamily: el.value });
          persist();
          repaintPreview();
        });
      });
      fieldsListEl.querySelectorAll('[data-f-align]').forEach(function (el) {
        el.addEventListener('change', function () {
          updateField(el.getAttribute('data-f-align'), { align: el.value });
          persist();
          repaintPreview();
        });
      });
      fieldsListEl.querySelectorAll('[data-f-imagefit]').forEach(function (el) {
        el.addEventListener('change', function () {
          updateField(el.getAttribute('data-f-imagefit'), { imageFit: el.value });
          persist();
          repaintPreview();
        });
      });
      fieldsListEl.querySelectorAll('[data-f-color]').forEach(function (el) {
        el.addEventListener('input', function () {
          updateField(el.getAttribute('data-f-color'), { color: el.value });
          persist();
          repaintPreview();
        });
      });
      fieldsListEl.querySelectorAll('[data-f-bold]').forEach(function (el) {
        el.addEventListener('click', function () { toggleBoolStyle(el, 'data-f-bold', 'bold'); });
      });
      fieldsListEl.querySelectorAll('[data-f-italic]').forEach(function (el) {
        el.addEventListener('click', function () { toggleBoolStyle(el, 'data-f-italic', 'italic'); });
      });
      fieldsListEl.querySelectorAll('[data-f-underline]').forEach(function (el) {
        el.addEventListener('click', function () { toggleBoolStyle(el, 'data-f-underline', 'underline'); });
      });
      fieldsListEl.querySelectorAll('[data-f-strike]').forEach(function (el) {
        el.addEventListener('click', function () { toggleBoolStyle(el, 'data-f-strike', 'strikethrough'); });
      });
      function toggleBoolStyle(el, attr, key) {
        var id = el.getAttribute(attr);
        var f = state.fields.filter(function (x) { return x.id === id; })[0];
        var patch = {};
        patch[key] = !f[key];
        updateField(id, patch);
        persist();
        repaintFieldsList();
        repaintPreview();
      }
      fieldsListEl.querySelectorAll('[data-f-has-bg]').forEach(function (el) {
        el.addEventListener('change', function () {
          var id = el.getAttribute('data-f-has-bg');
          var colorInput = fieldsListEl.querySelector('[data-f-bg="' + id + '"]');
          updateField(id, { bgColor: el.checked ? (colorInput ? colorInput.value : '#eeeeee') : null });
          persist();
          repaintFieldsList();
          repaintPreview();
        });
      });
      fieldsListEl.querySelectorAll('[data-f-bg]').forEach(function (el) {
        el.addEventListener('input', function () {
          updateField(el.getAttribute('data-f-bg'), { bgColor: el.value });
          persist();
          repaintPreview();
        });
      });
      fieldsListEl.querySelectorAll('[data-move-field-up]').forEach(function (el) {
        el.addEventListener('click', function () { moveField(el.getAttribute('data-move-field-up'), 1); });
      });
      fieldsListEl.querySelectorAll('[data-move-field-down]').forEach(function (el) {
        el.addEventListener('click', function () { moveField(el.getAttribute('data-move-field-down'), -1); });
      });
      fieldsListEl.querySelectorAll('[data-bring-to-front]').forEach(function (el) {
        el.addEventListener('click', function () { bringToFront(el.getAttribute('data-bring-to-front')); });
      });
      fieldsListEl.querySelectorAll('[data-send-to-back]').forEach(function (el) {
        el.addEventListener('click', function () { sendToBack(el.getAttribute('data-send-to-back')); });
      });
      fieldsListEl.querySelectorAll('[data-toggle-lock]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          var fieldId = el.getAttribute('data-toggle-lock');
          var f = state.fields.filter(function (x) { return x.id === fieldId; })[0];
          if (!f) return;
          updateField(fieldId, { locked: !f.locked });
          persist();
          repaintFieldsList();
          repaintPreview();
          if (fieldId === selectedFieldId) updateContextToolbar();
        });
      });
      fieldsListEl.querySelectorAll('[data-duplicate-field]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          duplicateField(el.getAttribute('data-duplicate-field'));
        });
      });
      // ---------------------------------------------------------------------------------------
      fieldsListEl.querySelectorAll('[data-remove-field]').forEach(function (el) {
        el.addEventListener('click', function () {
          removeField(el.getAttribute('data-remove-field'));
        });
      });
      // Clicar na linha (fora dos controles interativos dela) seleciona o campo — mesmo efeito de
      // clicar nele no canvas: abre a barra de contexto com posição/estilo pra editar.
      fieldsListEl.querySelectorAll('[data-layer-select]').forEach(function (row) {
        row.addEventListener('click', function (e) {
          if (e.target.closest('input, select, button')) return;
          selectField(row.getAttribute('data-layer-select'), {});
        });
      });
    }

    // Também usado pela tecla Delete/Backspace com um campo selecionado (ver handleKeydown), não só
    // pelo × da lista de Camadas.
    function removeField(id) {
      if (state.fields.length <= 0) return;
      state.fields = state.fields.filter(function (f) { return f.id !== id; });
      if (selectedFieldId === id) selectedFieldId = null;
      persist();
      repaintFieldsList();
      repaintTable();
      repaintPreview();
      updateContextToolbar();
    }

    function moveField(id, dir) {
      var idx = state.fields.findIndex(function (f) { return f.id === id; });
      var target = idx + dir;
      if (idx === -1 || target < 0 || target >= state.fields.length) return;
      var copy = state.fields.slice();
      var tmp = copy[idx];
      copy[idx] = copy[target];
      copy[target] = tmp;
      state.fields = copy;
      persist();
      repaintFieldsList();
      repaintPreview();
    }

    // Trazer pra frente / mandar pra trás (arranjo de camada estilo Figma) — vão direto pro topo/fim
    // do array, diferente de moveField (que troca só com o vizinho). Reaproveita o mesmo trio de
    // repinturas que moveField já usa.
    function bringToFront(id) {
      var idx = state.fields.findIndex(function (f) { return f.id === id; });
      if (idx === -1 || idx === state.fields.length - 1) return;
      var copy = state.fields.slice();
      var item = copy.splice(idx, 1)[0];
      copy.push(item);
      state.fields = copy;
      persist();
      repaintFieldsList();
      repaintPreview();
    }
    function sendToBack(id) {
      var idx = state.fields.findIndex(function (f) { return f.id === id; });
      if (idx === -1 || idx === 0) return;
      var copy = state.fields.slice();
      var item = copy.splice(idx, 1)[0];
      copy.unshift(item);
      state.fields = copy;
      persist();
      repaintFieldsList();
      repaintPreview();
    }

    // Duplica um campo existente (Ctrl+D ou botão) — clona todas as propriedades visuais, desvia um
    // pouco a posição (mesmo raciocínio de addNewField, pra não nascer exatamente em cima do
    // original) e entra na lista de camadas logo À FRENTE do original (renderiza por cima, fica
    // vizinho na lista). Também duplica o CONTEÚDO do campo em toda carta do baralho (cada linha em
    // state.rows), não só a definição visual — senão a cópia nasceria vazia em todas as cartas.
    function duplicateField(id) {
      if (state.fields.length >= LIMITS.fields.max) return null;
      var idx = state.fields.findIndex(function (f) { return f.id === id; });
      if (idx === -1) return null;
      var original = state.fields[idx];
      var offset = 4;
      var newX = clamp(original.x + offset, 0, Math.max(0, state.cardWidthMm - original.w));
      var newY = clamp(original.y + offset, 0, Math.max(0, state.cardHeightMm - original.h));
      var copy = Object.assign({}, original, { id: makeId('f'), label: (original.label || 'Campo').slice(0, 26) + ' (cópia)', x: newX, y: newY });
      var fields = state.fields.slice();
      fields.splice(idx + 1, 0, copy);
      state.fields = fields;
      state.rows = state.rows.map(function (r) {
        var patched = Object.assign({}, r);
        patched[copy.id] = r[id] || '';
        return patched;
      });
      persist();
      repaintFieldsList();
      repaintTable();
      selectField(copy.id, { syncFieldList: true });
      return copy;
    }

    function addNewField(extra) {
      if (state.fields.length >= LIMITS.fields.max) return null;
      // Novo campo nasce perto do centro da carta (com um leve desvio a cada novo campo, pra não
      // empilhar vários exatamente um em cima do outro) — evitar o canto (4,4), onde o Título
      // costuma estar, que deixava campos novos escondidos atrás dele sem nenhum aviso visual.
      var w = extra.w || 20, h = extra.h || 10, stagger = (state.fields.length % 5) * 4;
      var x = clamp((state.cardWidthMm - w) / 2 + stagger, 0, state.cardWidthMm - w);
      var y = clamp((state.cardHeightMm - h) / 2 + stagger, 0, state.cardHeightMm - h);
      var field = normalizeField(Object.assign({ label: 'Campo', x: x, y: y, w: w, h: h }, extra));
      state.fields = state.fields.concat([field]);
      ensureRowFields(state);
      persist();
      repaintFieldsList();
      repaintTable();
      repaintPreview();
      return field;
    }

    // ---------- Rail: ícones à esquerda abrem/fecham um painel flutuante por cima do canvas (em vez
    // de uma coluna fixa sempre ocupando espaço) — clicar no mesmo ícone já aberto fecha de novo. ----------

    var railPanelEl = container.querySelector('#cd-rail-panel');

    function openRailPanel(target) {
      ['elements', 'layers', 'cards', 'config'].forEach(function (name) {
        var panel = container.querySelector('#cd-ribbon-' + name);
        if (panel) panel.style.display = name === target ? '' : 'none';
      });
      container.querySelectorAll('[data-ribbon-tab]').forEach(function (t) {
        t.classList.toggle('card-designer-rail-btn-active', t.getAttribute('data-ribbon-tab') === target);
      });
      railPanelEl.classList.add('card-designer-rail-panel-open');
      // A aba Cartas (grade + tabela) só repinta quando algo muda enquanto ELA MESMA está aberta —
      // mudanças feitas com outra aba aberta (cor/borda/posição/etc. de um campo, todas via
      // repaintPreview() sozinho, sem repaintTable()) não a atualizam. Bug real reportado: mudar a
      // cor de fundo de um campo Fundo enquanto Camadas estava aberta, aí abrir Cartas, mostrava a
      // miniatura com a cor VELHA. Reforçar aqui, sempre que a aba abre, garante que ela nunca fica
      // desatualizada — sem precisar caçar todo handler que mexe em algo visível na miniatura.
      if (target === 'cards') repaintTable();
    }

    function closeRailPanel() {
      railPanelEl.classList.remove('card-designer-rail-panel-open');
      container.querySelectorAll('[data-ribbon-tab]').forEach(function (t) { t.classList.remove('card-designer-rail-btn-active'); });
    }

    container.querySelectorAll('[data-ribbon-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var target = tab.getAttribute('data-ribbon-tab');
        var alreadyOpen = railPanelEl.classList.contains('card-designer-rail-panel-open') && tab.classList.contains('card-designer-rail-btn-active');
        if (alreadyOpen) closeRailPanel(); else openRailPanel(target);
      });
    });

    var railPanelCloseBtn = container.querySelector('#cd-rail-panel-close');
    if (railPanelCloseBtn) railPanelCloseBtn.addEventListener('click', closeRailPanel);

    var helpBtn = container.querySelector('#cd-help');
    var helpPopoverEl = container.querySelector('#cd-help-popover');
    if (helpBtn && helpPopoverEl) {
      helpBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        helpPopoverEl.style.display = helpPopoverEl.style.display === 'none' ? '' : 'none';
      });
      document.addEventListener('mousedown', function (e) {
        if (helpPopoverEl.style.display !== 'none' && !helpPopoverEl.contains(e.target) && e.target !== helpBtn) {
          helpPopoverEl.style.display = 'none';
        }
      });
    }

    function switchToLayersTab() {
      openRailPanel('layers');
    }

    container.querySelectorAll('[data-cards-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.getAttribute('data-cards-view');
        var gridEl = container.querySelector('#cd-cards-grid');
        var tableScrollEl = container.querySelector('#cd-table-scroll');
        if (gridEl) gridEl.style.display = target === 'grid' ? '' : 'none';
        if (tableScrollEl) tableScrollEl.style.display = target === 'table' ? '' : 'none';
        container.querySelectorAll('[data-cards-view]').forEach(function (b) {
          b.classList.toggle('card-designer-view-tab-active', b === btn);
        });
      });
    });

    // Lógica de criação compartilhada entre o grid "Adicionar elemento" (painel Elementos) e a lista
    // de escolha do botão "Adicionar campo" (painel Camadas) — os dois caminhos levam ao mesmo lugar.
    // Aplica um modelo pronto (CARD_TEMPLATES) — SUBSTITUI todos os campos atuais (com confirmação,
    // mesmo padrão de aviso destrutivo que a importação de CSV já usa). Posições/tamanhos do modelo
    // são frações do tamanho ATUAL da carta (xf/yf/wf/hf, 0-1), convertidas pra mm aqui — assim o
    // mesmo modelo funciona em qualquer preset de tamanho, não só no que ele foi desenhado pensando.
    // Campo tipo "background" ignora xf/yf/wf/hf (sempre estica pra cobrir carta+sangria inteira,
    // igual ao "Adicionar campo → Fundo").
    function applyTemplate(tpl) {
      if (!global.confirm('Aplicar o modelo "' + tpl.name + '" vai SUBSTITUIR ' + (state.fields.length ? 'os ' + state.fields.length + ' campo(s) atuais' : 'o layout atual (vazio)') + '. Continuar?')) return;
      var newFields = tpl.fields.map(function (spec) {
        if (spec.type === 'background') {
          return normalizeField(Object.assign({}, spec, {
            x: -state.bleedMm, y: -state.bleedMm,
            w: state.cardWidthMm + state.bleedMm * 2, h: state.cardHeightMm + state.bleedMm * 2,
          }));
        }
        return normalizeField(Object.assign({}, spec, {
          x: Math.round(spec.xf * state.cardWidthMm * 10) / 10,
          y: Math.round(spec.yf * state.cardHeightMm * 10) / 10,
          w: Math.round(spec.wf * state.cardWidthMm * 10) / 10,
          h: Math.round(spec.hf * state.cardHeightMm * 10) / 10,
        }));
      });
      state.fields = newFields;
      ensureRowFields(state);
      selectedFieldId = null;
      persist();
      repaintFieldsList();
      repaintTable();
      repaintPreview();
      updateContextToolbar();
      switchToLayersTab();
    }

    function quickAddField(kind) {
      var field = null;
      if (kind === 'text') {
        field = addNewField({ type: 'text', label: 'Texto' });
      } else if (kind === 'image') {
        field = addNewField({ type: 'image', label: 'Imagem', w: 30, h: 30 });
      } else if (kind === 'shape') {
        var existingShapeIcon = state.iconLibrary.filter(function (ic) { return ic.shape; })[0];
        var shapeIcon = existingShapeIcon || { id: makeId('ic'), name: 'forma1', imageId: '', shape: 'circle', shapeFill: '#3b82f6', shapeStroke: null, shapeStrokeWidth: 1, emoji: '' };
        if (!existingShapeIcon) state.iconLibrary = state.iconLibrary.concat([shapeIcon]);
        field = addNewField({ type: 'icons', label: 'Forma', w: 16, h: 16 });
        if (field) {
          var row = state.rows.filter(function (r) { return r.id === selectedRowId; })[0] || state.rows[0];
          if (row) {
            state.rows = state.rows.map(function (r) { if (r.id !== row.id) return r; var copy = Object.assign({}, r); copy[field.id] = shapeIcon.name; return copy; });
            persist();
            repaintTable();
            repaintPreview();
          }
        }
      } else if (kind === 'iconset') {
        field = addNewField({ type: 'icons', label: 'Ícones', w: 30, h: 16 });
      } else if (kind === 'panel') {
        field = addNewField({ type: 'panel', label: 'Painel', w: 40, h: 25, bgColor: '#e2e8f0', borderRadius: 2 });
      } else if (kind === 'frame') {
        // Moldura nasce encostada nos 4 lados da carta (com um inset de 3mm, senão a borda ficaria
        // cortada bem em cima da linha de corte) em vez de perto do centro como os outros tipos —
        // é o tamanho que uma moldura decorativa faz sentido ter por padrão; a pessoa redimensiona
        // se quiser algo diferente.
        var inset = 3;
        field = addNewField({
          type: 'frame', label: 'Moldura',
          x: inset, y: inset, w: Math.max(1, state.cardWidthMm - inset * 2), h: Math.max(1, state.cardHeightMm - inset * 2),
          bgColor: null, borderColor: '#1f2937', borderWidthMm: 2,
        });
      } else if (kind === 'background') {
        // Fundo nasce cobrindo a carta INTEIRA incluindo a sangria (posição negativa) — é o único
        // jeito de uma camada de fundo realmente ocupar a área de sangria, já que campos de imagem
        // comuns ficam limitados à área útil da carta (bug conhecido, registrado no backlog). Manda
        // pra trás de tudo na hora de nascer, que é o comportamento esperado de um fundo — mas
        // continua sendo uma camada normal depois, redimensionável/reordenável como qualquer outra.
        field = addNewField({
          type: 'background', label: 'Fundo',
          x: -state.bleedMm, y: -state.bleedMm, w: state.cardWidthMm + state.bleedMm * 2, h: state.cardHeightMm + state.bleedMm * 2,
          bgColor: '#ffffff',
        });
        if (field) sendToBack(field.id);
      }
      if (field) {
        selectField(field.id, { syncFieldList: true });
        switchToLayersTab();
      }
      return field;
    }

    container.querySelectorAll('[data-quick-add]').forEach(function (btn) {
      btn.addEventListener('click', function () { quickAddField(btn.getAttribute('data-quick-add')); });
    });

    // "Adicionar campo" (painel Camadas) virou lista de escolha em vez de adicionar sempre um campo
    // de texto padrão — mesmas 4 opções do grid "Adicionar elemento" (Elementos), só que mais perto
    // de onde a pessoa provavelmente já está trabalhando (a aba Camadas).
    var addFieldMenuEl = container.querySelector('#cd-add-field-menu');
    function closeAddFieldMenu() { if (addFieldMenuEl) addFieldMenuEl.style.display = 'none'; }
    if (addFieldBtn && addFieldMenuEl) {
      addFieldBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        addFieldMenuEl.style.display = addFieldMenuEl.style.display === 'none' ? '' : 'none';
      });
      addFieldMenuEl.querySelectorAll('[data-quick-add-menu]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          quickAddField(btn.getAttribute('data-quick-add-menu'));
          closeAddFieldMenu();
        });
      });
      document.addEventListener('mousedown', function (e) {
        if (addFieldMenuEl.style.display !== 'none' && !addFieldMenuEl.contains(e.target) && e.target !== addFieldBtn) closeAddFieldMenu();
      });
    }

    // Menu "Modelos" — mesmo padrão do menu "Adicionar campo" acima (toggle + fecha ao clicar fora),
    // só que aplicar um item SUBSTITUI o layout inteiro (ver applyTemplate, que já confirma antes).
    var templatesBtn = container.querySelector('#cd-templates-btn');
    var templatesMenuEl = container.querySelector('#cd-templates-menu');
    function closeTemplatesMenu() { if (templatesMenuEl) templatesMenuEl.style.display = 'none'; }
    if (templatesBtn && templatesMenuEl) {
      templatesBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        templatesMenuEl.style.display = templatesMenuEl.style.display === 'none' ? '' : 'none';
      });
      templatesMenuEl.querySelectorAll('[data-apply-template]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var tpl = CARD_TEMPLATES.filter(function (t) { return t.id === btn.getAttribute('data-apply-template'); })[0];
          closeTemplatesMenu();
          if (tpl) applyTemplate(tpl);
        });
      });
      document.addEventListener('mousedown', function (e) {
        if (templatesMenuEl.style.display !== 'none' && !templatesMenuEl.contains(e.target) && e.target !== templatesBtn) closeTemplatesMenu();
      });
    }

    // ---------- Tabela de dados ----------

    function repaintTableHeader() {
      var headEl = tableEl.querySelector('thead');
      if (!headEl) return;
      headEl.innerHTML = '<tr><th></th>' + state.fields.filter(isPerCardDataField).map(function (f) { return '<th>' + escapeHtml(f.label) + '</th>'; }).join('') + '<th></th></tr>';
    }

  var activeIconPopover = null;
  function closeIconPopover() {
    if (activeIconPopover) {
      activeIconPopover.parentNode.removeChild(activeIconPopover);
      document.removeEventListener('mousedown', handleIconPopoverOutsideClick, true);
      activeIconPopover = null;
    }
  }
  function handleIconPopoverOutsideClick(e) {
    if (activeIconPopover && !activeIconPopover.contains(e.target)) closeIconPopover();
  }

  /** Popover com os ícones já configurados no campo (Camadas → campo → Ícones deste campo), como
   *  chips clicáveis pra ligar/desligar — resolve o problema de precisar digitar o nome exato de
   *  memória na tabela de dados (e de não ter feedback nenhum quando o nome não bate com nada). */
  function openIconPicker(anchorEl, field, currentValue, onChange) {
    closeIconPopover();
    var selected = parseIconTokens(currentValue);
    var pop = document.createElement('div');
    pop.className = 'card-designer-icon-popover';

    if (!state.iconLibrary.length) {
      pop.innerHTML = '<p class="text-xs text-muted" style="max-width:14rem">Nenhum ícone na biblioteca do baralho ainda. Vá em <strong>Camadas → ' + escapeHtml(field.label) + ' → Biblioteca de ícones do baralho</strong> pra adicionar.</p>';
    } else {
      pop.innerHTML = state.iconLibrary.map(function (ic) {
        var isSel = selected.some(function (s) { return s.toLowerCase() === ic.name.toLowerCase(); });
        var thumb = ic.emoji
          ? '<span class="card-designer-icon-pick-thumb card-designer-icon-pick-thumb-emoji">' + escapeHtml(ic.emoji) + '</span>'
          : ic.shape
            ? '<span class="card-designer-icon-pick-thumb">' + shapeSvgMarkup(ic.shape, ic.shapeFill, ic.shapeStroke, ic.shapeStrokeWidth) + '</span>'
            : '<span class="card-designer-icon-pick-thumb" data-preview-image="' + escapeAttr(ic.imageId || '') + '"></span>';
        return '<button type="button" class="card-designer-icon-pick-chip' + (isSel ? ' card-designer-icon-pick-chip-active' : '') + '" data-icon-pick="' + escapeAttr(ic.name) + '">' +
          thumb + '<span>' + escapeHtml(ic.name) + '</span>' + (isSel ? GDC.icon('check', { size: 11 }) : '') + '</button>';
      }).join('');
    }
    // Mesmo raciocínio do seletor de cor (tela cheia via CSS, body sempre renderizado).
    var iconPopoverParent = document.body;
    iconPopoverParent.appendChild(pop);
    activeIconPopover = pop;

    pop.querySelectorAll('[data-preview-image]').forEach(function (el) {
      var id = el.getAttribute('data-preview-image');
      if (!id || !GDC.imageStore) return;
      GDC.imageStore.getURL(id).then(function (url) { if (url) el.style.backgroundImage = 'url(' + url + ')'; });
    });

    var rect = anchorEl.getBoundingClientRect();
    var popW = 220;
    var left = Math.min(rect.left, window.innerWidth - popW - 12);
    var top = rect.bottom + 6;
    if (top + 260 > window.innerHeight) top = Math.max(8, rect.top - 260 - 6);
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = top + 'px';

    pop.querySelectorAll('[data-icon-pick]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-icon-pick');
        var idx = selected.findIndex(function (s) { return s.toLowerCase() === name.toLowerCase(); });
        if (idx === -1) selected.push(name); else selected.splice(idx, 1);
        btn.classList.toggle('card-designer-icon-pick-chip-active');
        onChange(selected.join(','));
      });
    });

    setTimeout(function () { document.addEventListener('mousedown', handleIconPopoverOutsideClick, true); }, 0);
  }

  function tableCellMarkup(r, f) {
      if (f.type === 'image') {
        return '<td><button type="button" class="card-designer-img-cell" data-pick-image="' + r.id + '|' + f.id + '" data-image-thumb="' + escapeAttr(r[f.id] || '') + '">' +
          (r[f.id] ? '' : GDC.icon('image', { size: 14, className: 'text-muted' })) + '</button></td>';
      }
      if (f.type === 'icons') {
        var tokens = parseIconTokens(r[f.id]);
        var summary = tokens.length ? tokens.join(', ') : 'Escolher ícones…';
        return '<td><button type="button" class="card-designer-icon-cell-btn" data-pick-icons="' + r.id + '|' + f.id + '" title="Escolher quais ícones aparecem nesta carta">' +
          '<span class="' + (tokens.length ? '' : 'text-muted') + '">' + escapeHtml(summary) + '</span>' + GDC.icon('chevron-down', { size: 12 }) + '</button></td>';
      }
      return '<td><div class="card-designer-cell-wrap">' +
        '<textarea class="input-field py-1 text-xs card-designer-cell-textarea" data-cell="' + r.id + '|' + f.id + '" rows="1">' + escapeHtml(r[f.id] || '') + '</textarea>' +
        '<div class="card-designer-cell-format-bar" data-cell-format-bar="' + r.id + '|' + f.id + '" style="display:none">' +
        '  <button type="button" data-wrap="bold" title="Negrito no trecho selecionado"><b>N</b></button>' +
        '  <button type="button" data-wrap="italic" title="Itálico no trecho selecionado"><i>I</i></button>' +
        '  <button type="button" data-wrap="underline" title="Sublinhado no trecho selecionado"><u>S</u></button>' +
        '  <button type="button" data-wrap="strike" title="Tachado no trecho selecionado"><s>T</s></button>' +
        '</div>' +
        '</div></td>';
    }

    // Grade visual do baralho — miniatura de cada carta lado a lado (inspirado na aba "Cards" do
    // shufflekit.com), como alternativa à tabela de dados em linhas. Reaproveita buildFieldsHtml
    // trocando temporariamente a escala pra um tamanho de miniatura, sem afetar o canvas principal.
    function repaintCardsGrid() {
      var gridEl = container.querySelector('#cd-cards-grid');
      if (!gridEl) return;
      var THUMB_W = 132;
      var savedScale = PREVIEW_SCALE;
      PREVIEW_SCALE = THUMB_W / state.cardWidthMm;
      var w = (state.cardWidthMm + 2 * state.bleedMm) * PREVIEW_SCALE;
      var h = (state.cardHeightMm + 2 * state.bleedMm) * PREVIEW_SCALE;
      gridEl.innerHTML = state.rows.map(function (row, i) {
        var qty = parseInt(row.qty, 10) || 1;
        // Troca data-field-id por data-thumb-field-id: as miniaturas não são interativas, e usar o
        // mesmo atributo do canvas principal faz qualquer seletor "[data-field-id]" genérico pegar os
        // campos escondidos da miniatura junto (fica no DOM mesmo com a grade fora de vista).
        var fieldsHtml = buildFieldsHtml(row, false).replace(/data-field-id="/g, 'data-thumb-field-id="');
        return '<div class="card-designer-card-thumb-wrap">' +
          '  <button type="button" class="card-designer-card-thumb-btn' + (row.id === selectedRowId ? ' card-designer-card-thumb-selected' : '') + '" data-row-select="' + row.id + '">' +
          '    <span class="card-designer-card-thumb" style="width:' + w + 'px;height:' + h + 'px;background-color:' + state.bgColor + '">' + fieldsHtml + '</span>' +
          '    <span class="card-designer-card-thumb-label">#' + (i + 1) + (qty > 1 ? ' ×' + qty : '') + '</span>' +
          '  </button>' +
          (state.rows.length > 1 ? '  <button type="button" class="card-designer-card-thumb-remove" data-remove-row-grid="' + row.id + '" title="Excluir esta carta">' + GDC.icon('x', { size: 12 }) + '</button>' : '') +
          '</div>';
      }).join('');
      PREVIEW_SCALE = savedScale;
      gridEl.querySelectorAll('[data-preview-image]').forEach(function (el) {
        var id = el.getAttribute('data-preview-image');
        if (!id || !GDC.imageStore) return;
        GDC.imageStore.getURL(id).then(function (url) {
          if (url) el.style.backgroundImage = 'url(' + url + ')';
        });
      });
      gridEl.querySelectorAll('[data-row-select]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectedRowId = btn.getAttribute('data-row-select');
          repaintTable();
          repaintPreview();
          repaintFieldsList();
          updateContextToolbar();
        });
      });
      // A grade é a visão PADRÃO da aba Cartas, mas só a tabela tinha um jeito de excluir uma carta
      // — quem nunca abria a tabela não tinha como excluir nenhuma. Agora a grade também tem.
      gridEl.querySelectorAll('[data-remove-row-grid]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (state.rows.length <= 1) return;
          var id = btn.getAttribute('data-remove-row-grid');
          var idx = state.rows.findIndex(function (r) { return r.id === id; });
          state.rows = state.rows.filter(function (r) { return r.id !== id; });
          if (selectedRowId === id) selectedRowId = (state.rows[idx] || state.rows[state.rows.length - 1]).id;
          persist();
          repaintCardsGrid();
          repaintTable();
          repaintPreview();
          repaintFieldsList();
          updateContextToolbar();
        });
      });
    }

    function repaintTable() {
      repaintCardsGrid();
      var showBackCol = state.back.enabled && state.back.perCardBack;
      var headHtml = '<tr><th></th>' + state.fields.filter(isPerCardDataField).map(function (f) { return '<th>' + escapeHtml(f.label) + '</th>'; }).join('') +
        (showBackCol ? '<th>Verso</th>' : '') + '<th>Cópias</th><th></th><th></th></tr>';
      var bodyHtml = state.rows.map(function (r, i) {
        var cells = state.fields.filter(isPerCardDataField).map(function (f) { return tableCellMarkup(r, f); }).join('');
        var backCell = showBackCol ? (
          '<td><button type="button" class="card-designer-img-cell" data-row-back-image="' + r.id + '" data-image-thumb="' + escapeAttr(r.backImageId || '') + '" style="width:2.25rem;height:2.25rem" title="Imagem de verso só desta carta">' +
          (r.backImageId ? '' : GDC.icon('image', { size: 13, className: 'text-muted' })) + '</button></td>'
        ) : '';
        var qtyCell = '<td><input type="number" min="' + LIMITS.qty.min + '" max="' + LIMITS.qty.max + '" class="input-field py-1 text-xs w-16" data-qty="' + r.id + '" value="' + (r.qty || '1') + '" title="Quantas cópias dessa carta entram no baralho final" /></td>';
        return '<tr class="' + (r.id === selectedRowId ? 'card-designer-row-selected' : '') + '" data-row-select="' + r.id + '">' +
          '<td class="card-designer-row-num">' + (i + 1) + '</td>' + cells + backCell + qtyCell +
          '<td><button type="button" class="text-muted hover:text-primary" data-duplicate-row="' + r.id + '" title="Duplicar carta" ' + (state.rows.length >= LIMITS.rows.max ? 'disabled' : '') + '>' + GDC.icon('plus', { size: 12 }) + '</button></td>' +
          '<td><button type="button" class="text-muted hover:text-rose-500" data-remove-row="' + r.id + '" title="Remover" ' + (state.rows.length <= 1 ? 'disabled' : '') + '>' + GDC.icon('x', { size: 12 }) + '</button></td></tr>';
      }).join('');

      tableEl.innerHTML = '<thead>' + headHtml + '</thead><tbody>' + bodyHtml + '</tbody>';
      if (GDC.imageStore) GDC.imageStore.resolveThumbs(tableEl);

      tableEl.querySelectorAll('[data-row-back-image]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var rowId = btn.getAttribute('data-row-back-image');
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file || !GDC.imageStore) return;
            GDC.imageStore.put(file).then(function (meta) {
              state.rows = state.rows.map(function (r) { return r.id === rowId ? Object.assign({}, r, { backImageId: meta.id }) : r; });
              persist();
              repaintTable();
              if (rowId === selectedRowId) repaintBackPreview();
            });
          });
          input.click();
        });
      });

      addRowBtn.disabled = state.rows.length >= LIMITS.rows.max;
      var totalCopies = state.rows.reduce(function (s, r) { return s + (parseInt(r.qty, 10) || 1); }, 0);
      rowCountLabel.textContent = 'Cartas (' + state.rows.length + ' únicas, ' + totalCopies + ' cópias no total)';

      tableEl.querySelectorAll('[data-qty]').forEach(function (el) {
        el.addEventListener('input', function () {
          var id = el.getAttribute('data-qty');
          var v = String(clamp(Number(el.value) || 1, LIMITS.qty.min, LIMITS.qty.max));
          state.rows = state.rows.map(function (r) { return r.id === id ? Object.assign({}, r, { qty: v }) : r; });
          persist();
          rowCountLabel.textContent = 'Cartas (' + state.rows.length + ' únicas, ' + state.rows.reduce(function (s, r) { return s + (parseInt(r.qty, 10) || 1); }, 0) + ' cópias no total)';
        });
        el.addEventListener('click', function (e) { e.stopPropagation(); });
      });

      tableEl.querySelectorAll('[data-row-select]').forEach(function (tr) {
        tr.addEventListener('click', function (e) {
          if (e.target.closest('textarea, input, button')) return;
          selectedRowId = tr.getAttribute('data-row-select');
          repaintTable();
          repaintPreview();
          repaintFieldsList();
          updateContextToolbar();
        });
      });
      tableEl.querySelectorAll('[data-cell]').forEach(function (el) {
        el.addEventListener('input', function () {
          var parts = el.getAttribute('data-cell').split('|');
          state.rows = state.rows.map(function (r) { if (r.id !== parts[0]) return r; var copy = Object.assign({}, r); copy[parts[1]] = el.value; return copy; });
          persist();
          if (parts[0] === selectedRowId) repaintPreview();
        });
        el.addEventListener('click', function (e) { e.stopPropagation(); selectedRowId = el.getAttribute('data-cell').split('|')[0]; });
        el.addEventListener('focus', function () {
          var bar = el.parentElement.querySelector('[data-cell-format-bar]');
          if (bar) bar.style.display = 'flex';
        });
        el.addEventListener('blur', function () {
          var bar = el.parentElement.querySelector('[data-cell-format-bar]');
          if (bar) setTimeout(function () { bar.style.display = 'none'; }, 150);
        });
      });
      tableEl.querySelectorAll('[data-wrap]').forEach(function (btn) {
        // mousedown (não click) + preventDefault: clicar no botão não pode tirar o foco/a seleção
        // do textarea antes da gente ler selectionStart/End, senão perde justamente o trecho que a
        // pessoa selecionou.
        btn.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var bar = btn.closest('[data-cell-format-bar]');
          var parts = bar.getAttribute('data-cell-format-bar').split('|');
          var textarea = tableEl.querySelector('[data-cell="' + parts[0] + '|' + parts[1] + '"]');
          if (!textarea) return;
          var markers = { bold: '**', italic: '*', underline: '__', strike: '~~' };
          var marker = markers[btn.getAttribute('data-wrap')];
          toggleTextWrap(textarea, marker);
        });
      });
      tableEl.querySelectorAll('[data-pick-image]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var parts = btn.getAttribute('data-pick-image').split('|');
          var input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file || !GDC.imageStore) return;
            GDC.imageStore.put(file).then(function (meta) {
              state.rows = state.rows.map(function (r) { if (r.id !== parts[0]) return r; var copy = Object.assign({}, r); copy[parts[1]] = meta.id; return copy; });
              persist();
              repaintTable();
              if (parts[0] === selectedRowId) repaintPreview();
            });
          });
          input.click();
        });
      });
      tableEl.querySelectorAll('[data-pick-icons]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var parts = btn.getAttribute('data-pick-icons').split('|');
          var rowId = parts[0], fieldId = parts[1];
          var f = state.fields.filter(function (x) { return x.id === fieldId; })[0];
          if (!f) return;
          var row = state.rows.filter(function (r) { return r.id === rowId; })[0];
          openIconPicker(btn, f, row ? row[fieldId] : '', function (newValue) {
            state.rows = state.rows.map(function (r) { if (r.id !== rowId) return r; var copy = Object.assign({}, r); copy[fieldId] = newValue; return copy; });
            persist();
            var summaryEl = btn.querySelector('span');
            var tokens = parseIconTokens(newValue);
            summaryEl.textContent = tokens.length ? tokens.join(', ') : 'Escolher ícones…';
            summaryEl.classList.toggle('text-muted', !tokens.length);
            if (rowId === selectedRowId) { repaintPreview(); repaintFieldsList(); }
          });
        });
      });
      tableEl.querySelectorAll('[data-duplicate-row]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          if (state.rows.length >= LIMITS.rows.max) return;
          var id = el.getAttribute('data-duplicate-row');
          var source = state.rows.filter(function (r) { return r.id === id; })[0];
          if (!source) return;
          var copy = Object.assign({}, source, { id: makeId('r') });
          var idx = state.rows.findIndex(function (r) { return r.id === id; });
          var newRows = state.rows.slice();
          newRows.splice(idx + 1, 0, copy);
          state.rows = newRows;
          selectedRowId = copy.id;
          persist();
          repaintTable();
          repaintPreview();
        });
      });
      tableEl.querySelectorAll('[data-remove-row]').forEach(function (el) {
        el.addEventListener('click', function (e) {
          e.stopPropagation();
          if (state.rows.length <= 1) return;
          var id = el.getAttribute('data-remove-row');
          state.rows = state.rows.filter(function (r) { return r.id !== id; });
          if (selectedRowId === id) selectedRowId = state.rows[0].id;
          persist();
          repaintTable();
          repaintPreview();
        });
      });
    }

    addRowBtn.addEventListener('click', function () {
      if (state.rows.length >= LIMITS.rows.max) return;
      var row = { id: makeId('r'), qty: '1' };
      state.fields.forEach(function (f) { row[f.id] = ''; });
      state.rows = state.rows.concat([row]);
      persist();
      repaintTable();
    });

    exportCsvBtn.addEventListener('click', function () {
      var csv = rowsToCsv(state.fields.filter(isPerCardDataField), state.rows);
      if (GDC.downloadBlob) GDC.downloadBlob(csv, 'text/csv;charset=utf-8', 'cartas.csv');
    });

    // Acha a coluna do CSV que melhor bate com um rótulo de campo — usado só pra PRÉ-SELECIONAR o
    // mapeamento no modal (ver csvMappingModalMarkup), nunca pra decidir sozinho: a pessoa sempre vê
    // e pode corrigir cada linha antes de confirmar. -1 quando não achou nada parecido.
    function bestHeaderMatch(label, headers, extraAliases) {
      var target = normalizeForMatch(label);
      var idx = headers.findIndex(function (h) { return normalizeForMatch(h) === target; });
      if (idx !== -1) return idx;
      if (extraAliases) {
        for (var i = 0; i < extraAliases.length; i++) {
          var aliasTarget = normalizeForMatch(extraAliases[i]);
          idx = headers.findIndex(function (h) { return normalizeForMatch(h) === aliasTarget; });
          if (idx !== -1) return idx;
        }
      }
      return -1;
    }

    function csvMappingModalMarkup(headers, dataFields, rowCount) {
      var optionsFor = function (selectedIdx) {
        return '<option value="-1">(nenhuma)</option>' +
          headers.map(function (h, i) { return '<option value="' + i + '"' + (i === selectedIdx ? ' selected' : '') + '>' + escapeHtml(h) + '</option>'; }).join('');
      };
      var fieldRows = dataFields.map(function (f) {
        var best = bestHeaderMatch(f.label, headers);
        return '<div class="card-designer-csv-map-row">' +
          '  <label>' + escapeHtml(f.label) + '</label>' +
          '  <select class="input-field' + (best === -1 ? ' card-designer-csv-map-unmatched' : '') + '" data-csv-map-field="' + f.id + '">' + optionsFor(best) + '</select>' +
          '</div>';
      }).join('');
      var bestQty = bestHeaderMatch('cópias', headers, ['cópias', 'copias', 'qty', 'quantidade']);
      var qtyRow = '<div class="card-designer-csv-map-row">' +
        '  <label>Cópias</label>' +
        '  <select class="input-field" data-csv-map-qty>' + optionsFor(bestQty) + '</select>' +
        '</div>';
      return '<div class="card-designer-modal-panel card-surface">' +
        '  <div class="card-designer-modal-header">' +
        '    <h3 class="font-display text-sm font-bold text-primary">Importar CSV — associar colunas</h3>' +
        '    <button type="button" class="btn-ghost h-8 w-8 p-0" data-csv-cancel>' + GDC.icon('x', { size: 16 }) + '</button>' +
        '  </div>' +
        '  <div class="card-designer-modal-body">' +
        '    <p class="text-xs text-secondary">' + rowCount + ' linha(s) de dados encontradas. Escolha qual coluna do CSV preenche cada campo — sugeri um pareamento automático, mas confira antes de importar. Campos marcados não acharam uma coluna parecida.</p>' +
        fieldRows + qtyRow +
        '  </div>' +
        '  <div class="card-designer-modal-footer">' +
        '    <button type="button" class="btn-ghost py-2 text-xs" data-csv-cancel>Cancelar</button>' +
        '    <button type="button" class="btn-primary py-2 text-xs" data-csv-confirm>Importar</button>' +
        '  </div>' +
        '</div>';
    }

    function openCsvMappingModal(headers, dataLines) {
      var dataFields = state.fields.filter(isPerCardDataField);
      var overlay = document.createElement('div');
      overlay.className = 'card-designer-modal-overlay';
      overlay.innerHTML = csvMappingModalMarkup(headers, dataFields, dataLines.length);
      document.body.appendChild(overlay);
      function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }
      overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
      overlay.querySelectorAll('[data-csv-cancel]').forEach(function (btn) { btn.addEventListener('click', close); });
      overlay.querySelector('[data-csv-confirm]').addEventListener('click', function () {
        if (!global.confirm('Importar vai SUBSTITUIR as ' + state.rows.length + ' carta(s) atual(is) pelas ' + dataLines.length + ' linha(s) do CSV. Continuar?')) return;
        var qtySelect = overlay.querySelector('[data-csv-map-qty]');
        var qtyCol = qtySelect ? Number(qtySelect.value) : -1;
        var colForField = {};
        dataFields.forEach(function (f) {
          var sel = overlay.querySelector('[data-csv-map-field="' + f.id + '"]');
          colForField[f.id] = sel ? Number(sel.value) : -1;
        });
        var newRows = dataLines.map(function (cols) {
          var row = { id: makeId('r'), qty: qtyCol !== -1 ? String(clamp(Number(cols[qtyCol]) || 1, LIMITS.qty.min, LIMITS.qty.max)) : '1' };
          state.fields.forEach(function (f) {
            var colIdx = isPerCardDataField(f) ? colForField[f.id] : -1;
            row[f.id] = (colIdx !== undefined && colIdx !== -1 && cols[colIdx] != null) ? cols[colIdx] : '';
          });
          return row;
        }).slice(0, LIMITS.rows.max);
        state.rows = newRows.length ? newRows : state.rows;
        selectedRowId = state.rows[0].id;
        persist();
        repaintTable();
        repaintPreview();
        close();
      });
    }

    importCsvBtn.addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var parsed;
          try { parsed = parseCsv(String(reader.result)); } catch (e) { parsed = null; }
          if (!parsed || parsed.length < 1) {
            global.alert('Não consegui ler esse CSV.');
            return;
          }
          var headers = parsed[0].map(function (h) { return h.trim(); });
          var dataLines = parsed.slice(1);
          if (!dataLines.length) {
            global.alert('O CSV não tem nenhuma linha de dados (só o cabeçalho).');
            return;
          }
          openCsvMappingModal(headers, dataLines);
        };
        reader.readAsText(file, 'utf-8');
      });
      input.click();
    });

    // ---------- Exportar folha para impressão ----------

    function pageGrid() {
      var effW = state.cardWidthMm + 2 * state.bleedMm, effH = state.cardHeightMm + 2 * state.bleedMm;
      var cols = Math.max(1, Math.floor((PRINT_PAGE_W_MM - 2 * PRINT_MARGIN_MM + PRINT_GAP_MM) / (effW + PRINT_GAP_MM)));
      var rowsPerPage = Math.max(1, Math.floor((PRINT_PAGE_H_MM - 2 * PRINT_MARGIN_MM + PRINT_GAP_MM) / (effH + PRINT_GAP_MM)));
      return { cols: cols, rowsPerPage: rowsPerPage, perPage: cols * rowsPerPage };
    }

    // Expande as linhas respeitando a quantidade de cópias de cada carta — a folha de impressão
    // repete a carta o número de vezes pedido, em vez de imprimir só uma cópia de cada linha única
    // da tabela de dados.
    function expandedPrintRows() {
      var expanded = [];
      state.rows.forEach(function (r) {
        var qty = clamp(parseInt(r.qty, 10) || 1, LIMITS.qty.min, LIMITS.qty.max);
        for (var i = 0; i < qty; i++) expanded.push(r);
      });
      return expanded;
    }

    function fieldPrintHtml(f, row, imageUrlMap, shapeUrlMap) {
      var isShapedPanel = f.type === 'panel' && f.shape !== 'rect';
      var style = 'left:' + (f.x + state.bleedMm) + 'mm;top:' + (f.y + state.bleedMm) + 'mm;width:' + f.w + 'mm;height:' + f.h + 'mm;' +
        'border-radius:' + f.borderRadius + 'mm;box-sizing:border-box;padding:' + f.paddingMm + 'mm;' +
        (f.bgColor && !isShapedPanel ? 'background-color:' + f.bgColor + ';' : '') +
        (f.borderColor && f.borderWidthMm > 0 && !isShapedPanel ? 'border:' + f.borderWidthMm + 'mm solid ' + f.borderColor + ';' : '') +
        fieldExtraStyle(f, function (mm) { return mm + 'mm'; }) +
        (f.rotation ? 'transform:rotate(' + f.rotation + 'deg);transform-origin:center center;' : '');
      if (isShapedPanel) {
        // shapeUrlMap só vem preenchido no export de PNG (rasterização via foreignObject, onde um
        // <svg> aninhado não desenha — ver o comentário grande em shapeToPngDataUri). Na impressão ao
        // vivo (shapeUrlMap null), o documento é normal, então o <svg> aninhado funciona direto.
        var panelShapeInner = shapeUrlMap && shapeUrlMap['panel:' + f.id]
          ? '<img src="' + shapeUrlMap['panel:' + f.id] + '" class="cd-print-img" style="object-fit:fill" />'
          : panelShapeSvgMarkup(f);
        return '<div class="cd-print-field" style="' + style + 'overflow:hidden;">' + panelShapeInner + '</div>';
      }
      if (f.type === 'frame') {
        // Moldura pode ter uma imagem decorativa própria (inclusive SVG) por cima da borda CSS —
        // mesmo mapa de URLs que campos de Imagem comuns já usam (ver collectImageIds, estendido pra
        // incluir campos tipo "frame").
        var frameUrl = imageUrlMap[row[f.id]];
        return '<div class="cd-print-field" style="' + style + 'overflow:hidden;">' + (frameUrl ? '<img src="' + frameUrl + '" class="cd-print-img" style="object-fit:' + f.imageFit + '" />' : '') + '</div>';
      }
      if (f.type === 'panel' || f.type === 'background') {
        return '<div class="cd-print-field" style="' + style + '"></div>';
      }
      if (f.type === 'image') {
        var url = imageUrlMap[row[f.id]];
        return '<div class="cd-print-field" style="' + style + 'overflow:hidden;">' + (url ? '<img src="' + url + '" class="cd-print-img" style="object-fit:' + f.imageFit + '" />' : '') + '</div>';
      }
      if (f.type === 'icons') {
        var tokens = parseIconTokens(row[f.id]);
        var printChipMm = clamp(f.h * 0.7, 3, 40);
        var printChipStyle = 'width:' + printChipMm + 'mm;height:' + printChipMm + 'mm;';
        var printEmojiStyle = printChipStyle + 'font-size:' + (printChipMm * 0.72) + 'mm;line-height:' + printChipMm + 'mm;';
        // Mesmo raciocínio de buildFieldsHtml (canvas): só fileiras INTEIRAS de ícone, o resto vira
        // um chip "+N" — sem isso, ícones que não cabiam apareciam cortados pela metade no PDF/PNG.
        var printGapMm = 1;
        var printPerRow = Math.max(1, Math.floor((f.w + printGapMm) / (printChipMm + printGapMm)));
        var printMaxRows = Math.max(1, Math.floor((f.h + printGapMm) / (printChipMm + printGapMm)));
        var printMaxSlots = printPerRow * printMaxRows;
        var printShowMore = tokens.length > printMaxSlots;
        var printVisibleCount = printShowMore ? Math.max(0, printMaxSlots - 1) : tokens.length;
        var printHiddenCount = tokens.length - printVisibleCount;
        var chips = tokens.slice(0, printVisibleCount).map(function (tok) {
          var icon = state.iconLibrary.filter(function (ic) { return ic.name.toLowerCase() === tok.toLowerCase(); })[0];
          if (icon && icon.emoji) return '<span class="cd-print-icon-chip cd-print-icon-chip-emoji" style="' + printEmojiStyle + '">' + escapeHtml(icon.emoji) + '</span>';
          if (icon && icon.shape) {
            // shapeUrlMap (só passado no export de PNG) troca o <svg> aninhado por um <img> já
            // rasterizado — ver comentário grande em collectShapeIconRasters sobre por que o <svg>
            // aninhado não pode ir para esse caminho específico (rasterização via foreignObject).
            var shapeInner = shapeUrlMap
              ? '<img src="' + shapeUrlMap[shapeIconKey(icon)] + '" class="cd-print-img" style="object-fit:contain" />'
              : shapeSvgMarkup(icon.shape, icon.shapeFill, icon.shapeStroke, icon.shapeStrokeWidth);
            return '<span class="cd-print-icon-chip" style="' + printChipStyle + '">' + shapeInner + '</span>';
          }
          var iu = icon && imageUrlMap[icon.imageId];
          return '<span class="cd-print-icon-chip" style="' + printChipStyle + '">' + (iu ? '<img src="' + iu + '" class="cd-print-img" />' : '') + '</span>';
        }).join('') + (printHiddenCount > 0 ? '<span class="cd-print-icon-chip" style="' + printChipStyle + 'display:flex;align-items:center;justify-content:center;background-color:rgb(0 0 0 / .06);font-size:' + (printChipMm * 0.4) + 'mm;">+' + printHiddenCount + '</span>' : '');
        return '<div class="cd-print-field cd-print-icons" style="' + style + '">' + chips + '</div>';
      }
      var textStyle = style + 'font-size:' + f.fontSize + 'mm;color:' + f.color + ';text-align:' + f.align + ';' +
        'font-family:' + fontFamilyCss(f.fontFamily, state) + ';font-weight:' + (f.bold ? '700' : '400') + ';font-style:' + (f.italic ? 'italic' : 'normal') + ';' +
        'text-decoration-line:' + textDecorationCss(f) + ';';
      return '<div class="cd-print-field" style="' + textStyle + '">' + inlineMarkupHtml(row[f.id]) + '</div>';
    }

    function frontCardHtml(row, imageUrlMap, shapeUrlMap) {
      var effW = state.cardWidthMm + 2 * state.bleedMm, effH = state.cardHeightMm + 2 * state.bleedMm;
      var fieldsHtml = state.fields.map(function (f) { return fieldPrintHtml(f, row, imageUrlMap, shapeUrlMap); }).join('');
      return '<div class="cd-print-card" style="width:' + effW + 'mm;height:' + effH + 'mm;background-color:' + state.bgColor + ';">' + fieldsHtml + '</div>';
    }

    function backCardHtml(imageUrlMap, row) {
      var effW = state.cardWidthMm + 2 * state.bleedMm, effH = state.cardHeightMm + 2 * state.bleedMm;
      // Verso individual por carta: cada linha pode ter sua própria imagem de verso (row.backImageId)
      // em vez de todas compartilharem a mesma (state.back.imageId) — só vale quando a opção está
      // ligada E a linha realmente tem uma atribuída; senão cai pra imagem compartilhada de sempre.
      var imgId = (state.back.perCardBack && row && row.backImageId) ? row.backImageId : state.back.imageId;
      var url = imageUrlMap[imgId];
      return '<div class="cd-print-card" style="width:' + effW + 'mm;height:' + effH + 'mm;background-color:' + state.back.bgColor + ';overflow:hidden;">' +
        (url ? '<img src="' + url + '" class="cd-print-img" style="position:absolute;left:0;top:0;width:100%;height:100%;" />' : '') +
        '</div>';
    }

    // Espelha os versos de uma página pra alinhar com a frente na impressão física frente-e-verso —
    // qual eixo precisa inverter depende de qual borda a folha vira fisicamente:
    // - "long" (borda longa, tipo folha de livro): vira ao redor do eixo VERTICAL — o que tava à
    //   direita na frente aparece à esquerda no verso, então espelha as COLUNAS dentro de cada linha.
    // - "short" (borda curta, tipo bloco/calendário): vira ao redor do eixo HORIZONTAL — o que tava
    //   embaixo aparece em cima, então espelha as LINHAS dentro de cada coluna.
    // Só faz sentido combinado com verso individual por carta (verso único é visualmente idêntico
    // não importa a ordem) — mas funciona do mesmo jeito nos dois casos.
    function mirrorBackCardsForDuplex(cards, grid, mode) {
      if (mode === 'short') {
        if (grid.rowsPerPage <= 1) return cards;
        var byCol = [];
        for (var c = 0; c < grid.cols; c++) {
          var colCards = [];
          for (var r = 0; r < grid.rowsPerPage; r++) {
            var idx = r * grid.cols + c;
            if (idx < cards.length) colCards.push(cards[idx]);
          }
          byCol.push(colCards.slice().reverse());
        }
        var reassembled = [];
        for (var r2 = 0; r2 < grid.rowsPerPage; r2++) {
          for (var c2 = 0; c2 < grid.cols; c2++) {
            if (byCol[c2][r2] !== undefined) reassembled.push(byCol[c2][r2]);
          }
        }
        return reassembled;
      }
      if (grid.cols <= 1) return cards;
      var mirrored = [];
      for (var rIdx = 0; rIdx < Math.ceil(cards.length / grid.cols); rIdx++) {
        var lineStart = rIdx * grid.cols;
        var line = cards.slice(lineStart, lineStart + grid.cols);
        mirrored = mirrored.concat(line.slice().reverse());
      }
      return mirrored;
    }

    // Marcas de corte: 2 tracinhos por canto (um horizontal, um vertical), apontando exatamente pra
    // linha de corte — precisam ficar FORA da caixa do cartão pra não cortar em cima da própria arte,
    // mas .cd-print-card tem overflow:hidden (necessário pra cortar texto/imagem que estoura o
    // campo). Por isso as marcas não vão dentro do cartão: ver wrapCardWithCutMarks logo abaixo, que
    // embrulha o cartão num container SEM overflow:hidden, só pra elas poderem "vazar" pra fora.
    function cutMarksHtml(effW, effH) {
      var len = 3, gap = 0.8, thick = 0.15, half = thick / 2;
      var marks = [
        { left: -(gap + len), top: -half, w: len, h: thick },
        { left: -half, top: -(gap + len), w: thick, h: len },
        { left: effW + gap, top: -half, w: len, h: thick },
        { left: effW - half, top: -(gap + len), w: thick, h: len },
        { left: -(gap + len), top: effH - half, w: len, h: thick },
        { left: -half, top: effH + gap, w: thick, h: len },
        { left: effW + gap, top: effH - half, w: len, h: thick },
        { left: effW - half, top: effH + gap, w: thick, h: len },
      ];
      return marks.map(function (m) {
        return '<div style="position:absolute;left:' + m.left + 'mm;top:' + m.top + 'mm;width:' + m.w + 'mm;height:' + m.h + 'mm;background:#000;"></div>';
      }).join('');
    }

    function wrapCardWithCutMarks(cardHtml, effW, effH) {
      if (!state.cutMarks) return cardHtml;
      return '<div class="cd-print-card-wrap" style="position:relative;width:' + effW + 'mm;height:' + effH + 'mm;flex-shrink:0;">' + cardHtml + cutMarksHtml(effW, effH) + '</div>';
    }

    // Devolve um array com o CONTEÚDO (sem o <div class="cd-print-page"> em volta) de cada página —
    // separado de buildPrintSheetHtml pra poder reaproveitar EXATAMENTE a mesma montagem tanto na
    // impressão via navegador quanto na exportação de PDF direta (rasteriza página por página).
    function buildPrintPages(imageUrlMap) {
      var grid = pageGrid();
      var pages = [];
      var printRows = expandedPrintRows();
      var effW = state.cardWidthMm + 2 * state.bleedMm, effH = state.cardHeightMm + 2 * state.bleedMm;

      for (var i = 0; i < printRows.length; i += grid.perPage) {
        var chunk = printRows.slice(i, i + grid.perPage);
        pages.push(chunk.map(function (r) { return wrapCardWithCutMarks(frontCardHtml(r, imageUrlMap), effW, effH); }).join(''));
      }

      if (state.back.enabled) {
        for (var j = 0; j < printRows.length; j += grid.perPage) {
          var chunkRows = printRows.slice(j, j + grid.perPage);
          var cards = chunkRows.map(function (r) { return backCardHtml(imageUrlMap, r); });
          if (state.back.mirrorForDuplex) cards = mirrorBackCardsForDuplex(cards, grid, state.back.duplexMode);
          pages.push(cards.map(function (c) { return wrapCardWithCutMarks(c, effW, effH); }).join(''));
        }
      }
      return pages;
    }

    function buildPrintSheetHtml(imageUrlMap) {
      return buildPrintPages(imageUrlMap).map(function (p) { return '<div class="cd-print-page">' + p + '</div>'; }).join('');
    }

    function collectImageIds() {
      var ids = {};
      state.rows.forEach(function (r) {
        state.fields.forEach(function (f) { if ((f.type === 'image' || f.type === 'frame') && r[f.id]) ids[r[f.id]] = true; });
        if (state.back.perCardBack && r.backImageId) ids[r.backImageId] = true;
      });
      state.iconLibrary.forEach(function (ic) { if (ic.imageId) ids[ic.imageId] = true; });
      if (state.back.enabled && state.back.imageId) ids[state.back.imageId] = true;
      return Object.keys(ids);
    }

    function cleanupPrintSheet() {
      var existing = document.getElementById('cd-print-sheet');
      if (existing) existing.parentNode.removeChild(existing);
      global.removeEventListener('afterprint', cleanupPrintSheet);
    }

    function collectFontLoadPromises() {
      var promises = [];
      state.fields.forEach(function (f) {
        if (f.type !== 'text') return;
        if (typeof f.fontFamily === 'string' && f.fontFamily.indexOf('custom:') === 0) {
          var cFont = state.customFonts.filter(function (cf) { return cf.id === f.fontFamily.slice(7); })[0];
          if (cFont && GDC.fontStore) promises.push(GDC.fontStore.ensureLoaded(cFont.fontFileId, cFont.family));
        } else if (typeof f.fontFamily === 'string' && f.fontFamily.indexOf('google:') === 0) {
          var gName = f.fontFamily.slice(7);
          ensureGoogleFontLoaded(gName);
          if (document.fonts && document.fonts.load) promises.push(document.fonts.load('700 12px "' + gName + '"').catch(function () {}));
        }
      });
      return Promise.all(promises);
    }

    function handleExport() {
      if (exporting) return;
      var printableWMm = PRINT_PAGE_W_MM - 2 * PRINT_MARGIN_MM, printableHMm = PRINT_PAGE_H_MM - 2 * PRINT_MARGIN_MM;
      var effWMm = state.cardWidthMm + 2 * state.bleedMm, effHMm = state.cardHeightMm + 2 * state.bleedMm;
      if (effWMm > printableWMm || effHMm > printableHMm) {
        // pageGrid() força no mínimo 1 coluna e 1 linha por página mesmo quando a carta (+ sangria)
        // não cabe na área imprimível do A4 — sem esse aviso, a folha saía cortada silenciosamente
        // (bug real registrado no backlog). Bloqueia em vez de deixar passar, porque não tem um jeito
        // razoável de "corrigir sozinho" — só reduzir a carta ou trocar de papel resolve de verdade.
        global.alert(
          'A carta (' + effWMm.toFixed(0) + '×' + effHMm.toFixed(0) + 'mm com sangria) é maior que a área imprimível de uma página A4 (' + printableWMm.toFixed(0) + '×' + printableHMm.toFixed(0) + 'mm, já descontando a margem).\n\n' +
          'Imprimir assim sairia cortado. Reduza o tamanho da carta ou a sangria (aba Config), ou reduza a margem de impressão.'
        );
        return;
      }
      var totalPrintable = expandedPrintRows().length;
      if (totalPrintable > MAX_PRINTABLE_CARDS) {
        global.alert(
          'Essa folha teria ' + totalPrintable.toLocaleString('pt-BR') + ' cartas no total (cartas únicas × cópias) — passa do limite seguro de ' + MAX_PRINTABLE_CARDS.toLocaleString('pt-BR') + '.\n\n' +
          'Montar tudo isso de uma vez arrisca travar o navegador. Reduza a quantidade de cópias por carta ou o número de cartas únicas (aba Cartas), ou exporte em lotes menores.'
        );
        return;
      }
      exporting = true;
      exportBtn.disabled = true;
      var ids = collectImageIds();
      var lookups = GDC.imageStore
        ? Promise.all(ids.map(function (id) { return GDC.imageStore.getURL(id).then(function (url) { return { id: id, url: url }; }); }))
        : Promise.resolve([]);
      Promise.all([lookups, collectFontLoadPromises()]).then(function (results) {
        var pairs = results[0];
        var map = {};
        pairs.forEach(function (p) { if (p.url) map[p.id] = p.url; });
        cleanupPrintSheet();
        var sheet = document.createElement('div');
        sheet.id = 'cd-print-sheet';
        sheet.innerHTML = buildPrintSheetHtml(map);
        document.body.appendChild(sheet);
        global.addEventListener('afterprint', cleanupPrintSheet);
        global.print();
        exporting = false;
        exportBtn.disabled = false;
      }, function () {
        exporting = false;
        exportBtn.disabled = false;
      });
    }

    exportBtn.addEventListener('click', handleExport);

    // Exportação de PDF direta: rasteriza cada página (as mesmas que a impressão via navegador
    // monta — ver buildPrintPages) em JPEG e junta tudo num PDF na hora, sem passar pelo diálogo de
    // impressão do navegador (que hoje é o único jeito de "salvar como PDF" — pedido registrado no
    // backlog). Mesmas proteções de sangria/tamanho de página e limite de cartas que a impressão já
    // tinha, porque o gargalo é o mesmo (montar um monte de elemento).
    function handleExportPdf() {
      if (exportingPdf) return;
      var printableWMm = PRINT_PAGE_W_MM - 2 * PRINT_MARGIN_MM, printableHMm = PRINT_PAGE_H_MM - 2 * PRINT_MARGIN_MM;
      var effWMm = state.cardWidthMm + 2 * state.bleedMm, effHMm = state.cardHeightMm + 2 * state.bleedMm;
      if (effWMm > printableWMm || effHMm > printableHMm) {
        global.alert(
          'A carta (' + effWMm.toFixed(0) + '×' + effHMm.toFixed(0) + 'mm com sangria) é maior que a área imprimível de uma página A4 (' + printableWMm.toFixed(0) + '×' + printableHMm.toFixed(0) + 'mm, já descontando a margem).\n\n' +
          'O PDF sairia cortado. Reduza o tamanho da carta ou a sangria (aba Config), ou reduza a margem de impressão.'
        );
        return;
      }
      var totalPrintable = expandedPrintRows().length;
      if (totalPrintable > MAX_PRINTABLE_CARDS) {
        global.alert(
          'Esse PDF teria ' + totalPrintable.toLocaleString('pt-BR') + ' cartas no total (cartas únicas × cópias) — passa do limite seguro de ' + MAX_PRINTABLE_CARDS.toLocaleString('pt-BR') + '.\n\n' +
          'Montar tudo isso de uma vez arrisca travar o navegador. Reduza a quantidade de cópias por carta ou o número de cartas únicas (aba Cartas), ou exporte em lotes menores.'
        );
        return;
      }
      var failedFontNames = [];
      state.fields.forEach(function (f) {
        if (f.type !== 'text' || typeof f.fontFamily !== 'string' || f.fontFamily.indexOf('google:') !== 0) return;
        var gName = f.fontFamily.slice(7);
        if (loadedGoogleFonts[gName] === 'error' && failedFontNames.indexOf(gName) === -1) failedFontNames.push(gName);
      });
      if (failedFontNames.length) {
        var proceedFonts = global.confirm(
          'Essa(s) fonte(s) do Google não carregaram (sem internet?): ' + failedFontNames.join(', ') + '.\n\n' +
          'O PDF vai sair com uma fonte substituta no lugar dessas. Quer continuar mesmo assim?'
        );
        if (!proceedFonts) return;
      }
      exportingPdf = true;
      exportPdfBtn.disabled = true;
      var originalLabel = exportPdfBtn.innerHTML;
      exportPdfBtn.innerHTML = GDC.icon('loader-2', { size: 13 }) + 'Gerando PDF...';

      var ids = collectImageIds();
      var lookups = GDC.imageStore
        ? Promise.all(ids.map(function (id) { return GDC.imageStore.getURL(id).then(function (url) { return { id: id, url: url }; }); }))
        : Promise.resolve([]);

      Promise.all([lookups, collectFontLoadPromises(), buildEmbeddedFontFaceCss(state)]).then(function (results) {
        var pairs = results[0], fontFaceCss = results[2];
        var map = {};
        pairs.forEach(function (p) { if (p.url) map[p.id] = p.url; });
        var pageInnerHtmls = buildPrintPages(map);
        if (!pageInnerHtmls.length) throw new Error('Nada pra exportar — o baralho não tem nenhuma carta.');
        // 150dpi é um bom meio-termo pra PDF: nítido o bastante pra imprimir cartas com qualidade,
        // sem gerar um arquivo enorme (300dpi numa página A4 inteira pesaria muito mais).
        return pageInnerHtmls.reduce(function (chain, pageHtml) {
          return chain.then(function (acc) {
            return renderPageToJpegBlob(pageHtml, fontFaceCss, 150, 0.9).then(function (res) {
              return res.blob.arrayBuffer().then(function (buf) {
                acc.push({ jpegBytes: new Uint8Array(buf), widthPx: res.widthPx, heightPx: res.heightPx });
                return acc;
              });
            });
          });
        }, Promise.resolve([]));
      }).then(function (pages) {
        var pdfBlob = buildPdfBlob(pages);
        var url = URL.createObjectURL(pdfBlob);
        var a = document.createElement('a');
        a.href = url;
        a.download = sanitizeFilename(state.preset, 'baralho') + '.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      }).catch(function (err) {
        global.alert('Não consegui gerar o PDF: ' + (err && err.message ? err.message : 'erro desconhecido') + '.');
      }).then(function () {
        exportingPdf = false;
        exportPdfBtn.disabled = false;
        exportPdfBtn.innerHTML = originalLabel;
      });
    }
    exportPdfBtn.addEventListener('click', handleExportPdf);

    // Layout entre projetos: exporta só o DESENHO da carta (dimensões, campos, cores, config de
    // verso) como um .json — sem os dados das cartas (rows) nem referências de mídia (imageId, que
    // só faz sentido dentro do IndexedDB DESTE projeto). Importar troca o layout mantendo os dados
    // que já existem (ensureRowFields reconcilia: campo novo entra em branco em toda carta, campo
    // removido simplesmente não aparece mais).
    var layoutExportBtn = container.querySelector('#cd-layout-export');
    var layoutImportBtn = container.querySelector('#cd-layout-import');
    if (layoutExportBtn) layoutExportBtn.addEventListener('click', function () {
      var payload = {
        kind: 'waypoint-card-layout', version: 1,
        preset: state.preset, cardWidthMm: state.cardWidthMm, cardHeightMm: state.cardHeightMm,
        bgColor: state.bgColor, bleedMm: state.bleedMm, safeMarginMm: state.safeMarginMm,
        showGuides: state.showGuides, snapGridMm: state.snapGridMm, cutMarks: state.cutMarks,
        fields: state.fields,
        back: { enabled: state.back.enabled, bgColor: state.back.bgColor, mirrorForDuplex: state.back.mirrorForDuplex, duplexMode: state.back.duplexMode, perCardBack: state.back.perCardBack },
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = sanitizeFilename(state.preset, 'layout') + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    if (layoutImportBtn) layoutImportBtn.addEventListener('click', function () {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var parsed;
          try { parsed = JSON.parse(String(reader.result)); } catch (e) { parsed = null; }
          if (!parsed || !Array.isArray(parsed.fields)) {
            global.alert('Esse arquivo não parece ser um layout válido do Designer de Cartas.');
            return;
          }
          if (!global.confirm('Importar vai SUBSTITUIR o layout atual (' + state.fields.length + ' campo(s)) pelo layout do arquivo (' + parsed.fields.length + ' campo(s)). Os dados já preenchidos nas cartas são mantidos onde possível. Continuar?')) return;

          state.fields = parsed.fields.slice(0, LIMITS.fields.max).map(normalizeField);
          if (typeof parsed.preset === 'string') state.preset = parsed.preset;
          if (isFinite(Number(parsed.cardWidthMm))) state.cardWidthMm = clamp(Number(parsed.cardWidthMm), LIMITS.dim.min, LIMITS.dim.max);
          if (isFinite(Number(parsed.cardHeightMm))) state.cardHeightMm = clamp(Number(parsed.cardHeightMm), LIMITS.dim.min, LIMITS.dim.max);
          if (typeof parsed.bgColor === 'string') state.bgColor = parsed.bgColor;
          if (isFinite(Number(parsed.bleedMm))) state.bleedMm = clamp(Number(parsed.bleedMm), 0, LIMITS.bleed.max);
          if (isFinite(Number(parsed.safeMarginMm))) state.safeMarginMm = clamp(Number(parsed.safeMarginMm), 0, LIMITS.bleed.max);
          if (typeof parsed.showGuides === 'boolean') state.showGuides = parsed.showGuides;
          if ([0, 1, 2, 5, 10].indexOf(Number(parsed.snapGridMm)) !== -1) state.snapGridMm = Number(parsed.snapGridMm);
          if (typeof parsed.cutMarks === 'boolean') state.cutMarks = parsed.cutMarks;
          if (parsed.back && typeof parsed.back === 'object') {
            state.back.enabled = !!parsed.back.enabled;
            if (typeof parsed.back.bgColor === 'string') state.back.bgColor = parsed.back.bgColor;
            state.back.mirrorForDuplex = !(parsed.back.mirrorForDuplex === false);
            state.back.duplexMode = parsed.back.duplexMode === 'short' ? 'short' : 'long';
            state.back.perCardBack = !!parsed.back.perCardBack;
          }
          ensureRowFields(state);
          selectedFieldId = null;
          persist();
          // Tantas propriedades diferentes mudam de uma vez (dimensão, preset, verso, campos...) que
          // remontar tudo é bem mais simples e seguro do que chamar cada repaintX manualmente e
          // arriscar esquecer uma — mesmo padrão que desfazer/refazer já usa (ver applyHistoryState).
          skipHistoryReset = true;
          container.setAttribute('data-value', JSON.stringify(state));
          rerenderKeepingFullscreen();
        };
        reader.readAsText(file, 'utf-8');
      });
      input.click();
    });

    // ---------- Exportar PNG por carta ----------
    // Frente de cada linha (uma imagem por carta única do baralho — não multiplica pela coluna
    // "Cópias", que é só pra folha de impressão) + verso (uma só vez, compartilhado) se ativado.
    // Uma carta só -> baixa o PNG direto; mais de uma -> empacota num .zip (GDC.zipWriter).
    function handleExportPng() {
      if (exportingPng) return;
      var failedFontNames = [];
      state.fields.forEach(function (f) {
        if (f.type !== 'text' || typeof f.fontFamily !== 'string' || f.fontFamily.indexOf('google:') !== 0) return;
        var gName = f.fontFamily.slice(7);
        if (loadedGoogleFonts[gName] === 'error' && failedFontNames.indexOf(gName) === -1) failedFontNames.push(gName);
      });
      if (failedFontNames.length) {
        var proceedFonts = global.confirm(
          'Essa(s) fonte(s) do Google não carregaram (sem internet?): ' + failedFontNames.join(', ') + '.\n\n' +
          'O PNG vai sair com uma fonte substituta no lugar dessas. Quer continuar mesmo assim?'
        );
        if (!proceedFonts) return;
      }
      if (state.rows.length > PNG_EXPORT_WARN_THRESHOLD) {
        var proceed = global.confirm(
          'Isso vai gerar ' + state.rows.length + ' arquivos PNG em alta resolução (300dpi), um por carta única — pode demorar um pouco e pesar na memória do navegador.\n\n' +
          'Quer continuar mesmo assim?'
        );
        if (!proceed) return;
      }
      exportingPng = true;
      exportPngBtn.disabled = true;
      var originalLabel = exportPngBtn.innerHTML;
      exportPngBtn.innerHTML = GDC.icon('loader-2', { size: 14 }) + 'Gerando PNG...';

      var ids = collectImageIds();
      var lookups = GDC.imageStore
        ? Promise.all(ids.map(function (id) { return GDC.imageStore.getBase64(id).then(function (res) { return { id: id, res: res }; }); }))
        : Promise.resolve([]);
      var shapeRastersLookup = collectShapeIconRasters(state, 512);
      var panelShapeRastersLookup = collectPanelShapeRasters(state.fields);

      Promise.all([lookups, buildEmbeddedFontFaceCss(state), shapeRastersLookup, panelShapeRastersLookup]).then(function (results) {
        var pairs = results[0], fontFaceCss = results[1], shapeUrlMap = Object.assign({}, results[2], results[3]);
        var map = {};
        pairs.forEach(function (p) { if (p.res) map[p.id] = 'data:' + (p.res.type || 'image/png') + ';base64,' + p.res.data; });

        var widthMm = state.cardWidthMm + 2 * state.bleedMm, heightMm = state.cardHeightMm + 2 * state.bleedMm;
        var titleField = state.fields.filter(function (f) { return f.type === 'text'; })[0];
        var jobs = state.rows.map(function (row, i) {
          var name = sanitizeFilename(titleField ? row[titleField.id] : '', 'carta-' + (i + 1));
          return { name: name, html: frontCardHtml(row, map, shapeUrlMap) };
        });
        if (state.back.enabled) {
          if (state.back.perCardBack) {
            // Um PNG de verso por carta ÚNICA (não por cópia impressa) — mesmo nome da frente
            // correspondente, com "-verso" no final, pra ficar fácil de casar os dois arquivos.
            state.rows.forEach(function (row, i) {
              var name = sanitizeFilename(titleField ? row[titleField.id] : '', 'carta-' + (i + 1));
              jobs.push({ name: name + '-verso', html: backCardHtml(map, row) });
            });
          } else {
            jobs.push({ name: 'verso', html: backCardHtml(map) });
          }
        }

        return jobs.reduce(function (chain, job, idx) {
          return chain.then(function (acc) {
            exportPngBtn.innerHTML = GDC.icon('loader-2', { size: 14 }) + 'Gerando PNG... (' + (idx + 1) + '/' + jobs.length + ')';
            return renderCardToPngBlob(job.html, widthMm, heightMm, fontFaceCss, PNG_EXPORT_DPI).then(function (blob) {
              acc.push({ name: job.name, blob: blob });
              return acc;
            });
          });
        }, Promise.resolve([]));
      }).then(function (files) {
        // Nomes repetidos (mesmo texto em cartas diferentes) ganham um sufixo numérico — senão o
        // zip acaba com duas entradas de mesmo nome, que a maioria dos descompactadores só sobrescreve.
        var seen = {};
        files.forEach(function (f) {
          var base = f.name;
          seen[base] = (seen[base] || 0) + 1;
          f.filename = (seen[base] > 1 ? base + '-' + seen[base] : base) + '.png';
        });

        if (files.length === 1) {
          downloadBlobFile(files[0].blob, files[0].filename);
        } else {
          var zip = GDC.zipWriter.create();
          var zipPromises = files.map(function (f) {
            return f.blob.arrayBuffer().then(function (buf) { zip.addFile(f.filename, buf); });
          });
          return Promise.all(zipPromises).then(function () {
            downloadBlobFile(zip.toBlob(), 'cartas-png.zip');
          });
        }
      }).catch(function (err) {
        global.alert('Não consegui gerar o(s) PNG(s). ' + (err && err.message ? err.message : 'Tente de novo.'));
      }).then(function () {
        exportingPng = false;
        exportPngBtn.disabled = false;
        exportPngBtn.innerHTML = originalLabel;
      });
    }

    function downloadBlobFile(blob, filename) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    exportPngBtn.addEventListener('click', handleExportPng);

    refreshAutoScale();
    repaintFieldsList();
    repaintTable();
    repaintPreview();
    updateContextToolbar(); // barra persistente (igual Canva) — já nasce mostrando o estado "nada selecionado"
    bindIconLibraryEvents(); // a biblioteca de ícones já vem no HTML inicial (painel Elementos) — precisa ligar os eventos uma vez no mount, não só depois de repaintIconLibraryPanel()
  }

  GDC.ui.cardDesigner = { render: render };
}(window));
