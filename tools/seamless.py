import sys, os, glob
from PIL import Image, ImageFilter
import numpy as np
src, out, N = sys.argv[1], sys.argv[2], int(sys.argv[3])
os.makedirs(out, exist_ok=True)
def ramp(n):
    # 0 nas bordas, 1 no meio, com transição suave (smoothstep) larga
    x = np.linspace(0, 1, n, endpoint=False) + 0.5 / n
    t = 1 - np.abs(2 * x - 1)          # 0..1..0
    t = np.clip((t - 0.05) / 0.6, 0, 1)
    return t * t * (3 - 2 * t)
for f in sorted(glob.glob(os.path.join(src, '*.png'))):
    im = Image.open(f).convert('RGB').resize((N, N), Image.LANCZOS)
    a = np.asarray(im).astype(float)
    w = ramp(N)
    # passo 1: emenda horizontal — mistura com a cópia deslocada meio ladrilho em x
    sx = np.roll(a, N // 2, axis=1)
    h = a * w[None, :, None] + sx * (1 - w[None, :, None])
    # passo 2: emenda vertical (h já é contínua em x; misturar só em y mantém isso)
    sy = np.roll(h, N // 2, axis=0)
    v = h * w[:, None, None] + sy * (1 - w[:, None, None])
    res = Image.fromarray(np.clip(v, 0, 255).astype('uint8'))
    res = res.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    res.save(os.path.join(out, os.path.basename(f)))
