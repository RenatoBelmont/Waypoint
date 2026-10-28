import sys, os, glob, io, base64, json, math
from PIL import Image
import numpy as np
from scipy import ndimage as ndi
texdir, brdir, outjs = sys.argv[1], sys.argv[2], sys.argv[3]
TEX_CATS = ['Grama', 'Terra', 'Areia e praia', 'Rocha', 'Vegetação e pântano', 'Neve e gelo', 'Vulcânico', 'Cristal e arcano']
TEX_SLUG = ['grama', 'terra', 'areia', 'rocha', 'mata', 'neve', 'vulcao', 'cristal']
def b64(im, fmt, **kw):
    b = io.BytesIO(); im.save(b, fmt, **kw); return 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode()
textures = []
for f in sorted(glob.glob(os.path.join(texdir, '*.png'))):
    n = os.path.basename(f)[:-4]; r = int(n[1]); c = int(n.split('_c')[1])
    avg = np.asarray(Image.open(f).convert('RGB')).reshape(-1, 3).mean(axis=0)
    textures.append({'id': 'px-%s-%d' % (TEX_SLUG[r], c + 1), 'name': '%s %d' % (TEX_CATS[r], c + 1), 'cat': TEX_CATS[r],
                     'avg': '#%02x%02x%02x' % tuple(int(x) for x in avg),
                     'src': b64(Image.open(f), 'WEBP', quality=80, method=6)})
# pincéis: linha → categoria/comportamento
def brush_meta(r, c):
    if r == 0: return ('Copas de árvore', 'patch') if c >= 7 else ('Grama', 'patch')
    if r == 1: return ('Terra e areia', 'patch')
    if r == 2: return ('Rocha e lava', 'patch')
    if r == 3: return ('Neve e gelo', 'patch') if c <= 6 else ('Pântano', 'patch')
    if r == 4: return ('Pântano', 'patch') if c <= 4 else ('Cristais', 'patch')
    if r == 5: return ('Cristas e falésias', 'line')
    if r == 6: return ('Margens e costas', 'edge')
    return ('Espalhados', 'scatter')
def pca_angle(a):
    ys, xs = np.nonzero(a > 0.4)
    if len(xs) < 10: return 0.0
    x = xs - xs.mean(); y = ys - ys.mean()
    cov = np.cov(np.vstack([x, y])); w, v = np.linalg.eigh(cov); d = v[:, np.argmax(w)]
    return math.degrees(math.atan2(d[1], d[0]))
def edge_angle(rgb, a):
    L = ndi.gaussian_filter(rgb.mean(axis=2), 6)
    gx = ndi.sobel(L, 1); gy = ndi.sobel(L, 0)
    m = a > 0.6
    jxx = (gx * gx)[m].sum(); jyy = (gy * gy)[m].sum(); jxy = (gx * gy)[m].sum()
    theta = 0.5 * math.atan2(2 * jxy, jxx - jyy)  # direção do gradiente dominante
    return math.degrees(theta) + 90               # a borda corre perpendicular ao gradiente
counters = {}
brushes = []
for f in sorted(glob.glob(os.path.join(brdir, '*.png'))):
    n = os.path.basename(f)[:-4]; r = int(n[1]); c = int(n.split('_c')[1])
    cat, kind = brush_meta(r, c)
    counters[cat] = counters.get(cat, 0) + 1
    im = Image.open(f).convert('RGBA')
    arr = np.asarray(im).astype(float) / 255
    ang = 0.0
    if kind == 'line': ang = pca_angle(arr[..., 3])
    elif kind == 'edge': ang = edge_angle(arr[..., :3] * 255, arr[..., 3])
    slug = ''.join(ch for ch in cat.lower().replace(' ', '-') if ch.isalnum() or ch == '-')
    brushes.append({'id': 'bk-%d-%d' % (r, c), 'name': '%s %d' % (cat, counters[cat]), 'cat': cat, 'kind': kind,
                    'angle': round(ang, 1), 'w': im.size[0], 'h': im.size[1],
                    'src': b64(im, 'WEBP', quality=82, method=6, alpha_quality=85)})
js = ('/* Gerado automaticamente (scratchpad build_pack.py) a partir dos atlas do Renato — não editar à mão.\n'
      '   Texturas: 256 px, emendadas pra repetir sem costura. Pincéis: recortados com transparência.\n'
      '   angle = orientação natural da imagem (graus) — pincéis de crista/margem giram pra seguir o traço. */\n'
      '(function (global) {\n  var GDC = global.GDC = global.GDC || {};\n  GDC.TERRAIN_PACK = ' +
      json.dumps({'textureCats': TEX_CATS, 'textures': textures, 'brushes': brushes}, ensure_ascii=False, separators=(',', ':')) +
      ';\n}(window));\n')
open(outjs, 'w', encoding='utf-8').write(js)
print(len(textures), 'texturas,', len(brushes), 'pincéis,', len(js) // 1024, 'KB')
for b in brushes:
    if b['kind'] in ('line', 'edge'): print(b['id'], b['kind'], b['angle'])
