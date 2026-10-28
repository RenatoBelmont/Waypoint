import sys, os
from PIL import Image
import numpy as np
from scipy import ndimage as ndi
src = sys.argv[1]; out = sys.argv[2]
os.makedirs(out, exist_ok=True)
im = np.asarray(Image.open(src).convert('RGB')).astype(float)
L = im.mean(axis=2)
det = ndi.gaussian_filter(np.abs(L - ndi.gaussian_filter(L, 3)), 4)
thr = np.percentile(det, 45)
mask = det > thr
mask = ndi.binary_opening(mask, iterations=2); mask = ndi.binary_closing(mask, iterations=3); mask = ndi.binary_fill_holes(mask)
bands = [0,146,268,392,526,647,767,884,1024]
# soft alpha: smooth ramp of detail energy around threshold, then feathered by distance inside the mask
soft = np.clip((det - thr * 0.55) / (thr * 1.6), 0, 1)
# background estimate: normalized convolution of pixels outside mask
bgw = (~ndi.binary_dilation(mask, iterations=6)).astype(float)
bg = np.zeros_like(im)
den = ndi.gaussian_filter(bgw, 25) + 1e-6
for ch in range(3): bg[..., ch] = ndi.gaussian_filter(im[..., ch] * bgw, 25) / den
items = []
for r in range(8):
    y0, y1 = bands[r], bands[r+1]
    mb = np.zeros_like(mask); mb[y0:y1] = mask[y0:y1]
    lab, n = ndi.label(mb)
    objs = ndi.find_objects(lab)
    comps = []
    for i, sl in enumerate(objs):
        area = (lab[sl] == i + 1).sum()
        if area < 1200: continue
        comps.append((sl[1].start, sl[1].stop, sl[0].start, sl[0].stop, i + 1))
    comps.sort()
    for c, (xa, xb, ya, yb, li) in enumerate(comps):
        pad = 10
        X0, X1 = max(0, xa - pad), min(im.shape[1], xb + pad); Y0, Y1 = max(y0, ya - pad), min(y1, yb + pad)
        comp = (lab[Y0:Y1, X0:X1] == li)
        # alpha = soft detail inside a dilated component, feathered
        region = ndi.binary_dilation(comp, iterations=8)
        a = soft[Y0:Y1, X0:X1] * region
        a = np.maximum(a, ndi.gaussian_filter(comp.astype(float), 3) * 0.9)
        a = ndi.gaussian_filter(a, 1.2)
        a = np.clip((a - 0.08) / 0.85, 0, 1)
        I = im[Y0:Y1, X0:X1]; B = bg[Y0:Y1, X0:X1]
        ae = np.maximum(a, 0.25)[..., None]
        F = np.clip((I - (1 - ae) * B) / ae, 0, 255)
        # mistura: no miolo usa a cor original (sem artefato), na borda a descontaminada
        w = np.clip((a - 0.5) / 0.4, 0, 1)[..., None]
        C = I * w + F * (1 - w)
        rgba = np.dstack([C, a * 255]).astype('uint8')
        Image.fromarray(rgba, 'RGBA').save(os.path.join(out, 'r%d_c%02d.png' % (r, c)))
        items.append((r, c, X1 - X0, Y1 - Y0))
print(len(items))
for r in range(8): print(r, sum(1 for it in items if it[0] == r))
