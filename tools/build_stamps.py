"""Monta js/stampPack.js com carimbos de objetos (PNG com fundo transparente) em categorias próprias.
Uso: python3 build_stamps.py saida.js "Categoria A" pastaA ["Categoria B" pastaB ...]
Cada imagem é recortada na área visível (+2% de margem), reduzida a no máx. 512 px no lado maior e
guardada como WebP em data: URI (imagem de arquivo local "sujaria" o canvas e travaria o export PNG).
Nome do carimbo = nome do arquivo (escapes #Uxxxx de zip viram acentos; *_1024x1024_alta_resolucao
vira só o começo, com underscores trocados por espaço)."""
import sys, os, re, glob, io, json, base64, unicodedata
from PIL import Image
import numpy as np

def nice(base):
    name = re.sub(r'#U([0-9a-fA-F]{4})', lambda m: chr(int(m.group(1), 16)), base)
    name = re.sub(r'_\d+x\d+(_alta_resolucao)?$', '', name)
    if '_' in name and ' ' not in name: name = name.replace('_', ' ').capitalize()
    return name

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:16]

out = sys.argv[1]; args = sys.argv[2:]
cats, items = [], []
for i in range(0, len(args), 2):
    cat, folder = args[i], args[i + 1]
    cats.append(cat)
    for n, f in enumerate(sorted(glob.glob(os.path.join(folder, '*.png')) + glob.glob(os.path.join(folder, '*.webp')))):
        im = Image.open(f).convert('RGBA')
        a = np.asarray(im)[..., 3]
        ys, xs = np.nonzero(a > 8)
        if not len(xs): continue
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        pad = int(max(x1 - x0, y1 - y0) * 0.02)
        im = im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))
        k = 512 / max(im.size)
        if k < 1: im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
        b = io.BytesIO(); im.save(b, 'WEBP', quality=84, method=6, alpha_quality=90)
        items.append({'id': 'ob-%s-%d' % (slug(cat), n + 1), 'name': nice(os.path.basename(f).rsplit('.', 1)[0]), 'cat': cat,
                      'kind': 'object', 'w': im.width, 'h': im.height,
                      'src': 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode()})
js = ('/* Gerado por tools/build_stamps.py — não editar à mão. Carimbos de objetos (vista 3/4, fundo\n'
      '   transparente) em categorias próprias; aparecem só na biblioteca da ferramenta Carimbo. */\n'
      '(function (global) {\n  var GDC = global.GDC = global.GDC || {};\n  GDC.STAMP_PACK = ' +
      json.dumps({'cats': cats, 'items': items}, ensure_ascii=False, separators=(',', ':')) + ';\n}(window));\n')
open(out, 'w', encoding='utf-8').write(js)
print(len(items), 'carimbos,', len(js) // 1024, 'KB')
