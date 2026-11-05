"""Trace the supplied logo image into clean vector paths (potrace), one layer per colour.
Output: traced.json with path data for the 'light' layer (cream ∪ orange) and the orange layer,
in the image's own coordinate space, plus the content bounding box."""
import json, sys, os
import numpy as np
from PIL import Image, ImageFilter
import potrace

SRC = sys.argv[1]; OUT = sys.argv[2]
im = Image.open(SRC).convert('RGB')
W, H = im.size
# 2x upscale + light blur: smoother edges for tracing
im = im.resize((W * 2, H * 2), Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
a = np.asarray(im).astype(np.int32)
pal = {'navy': (16, 33, 64), 'cream': (252, 246, 235), 'orange': (255, 78, 16)}
d = {k: ((a - np.array(v)) ** 2).sum(-1) for k, v in pal.items()}
lab = np.argmin(np.stack([d['navy'], d['cream'], d['orange']]), axis=0)   # 0 navy, 1 cream, 2 orange
light = lab != 0
orange = lab == 2

def trace(mask):
    bm = potrace.Bitmap(mask)
    plist = bm.trace(turdsize=60, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.0, opticurve=True, opttolerance=0.2)
    parts = []
    for curve in plist:
        pts = [curve.start_point] + [x.end_point for x in curve.segments]
        xs_ = [q.x / 2 for q in pts]; ys_ = [q.y / 2 for q in pts]
        fs = curve.start_point
        seg = [f'M{fs.x/2:.1f},{fs.y/2:.1f}']
        for s in curve.segments:
            if s.is_corner:
                seg.append(f'L{s.c.x/2:.1f},{s.c.y/2:.1f}L{s.end_point.x/2:.1f},{s.end_point.y/2:.1f}')
            else:
                seg.append(f'C{s.c1.x/2:.1f},{s.c1.y/2:.1f} {s.c2.x/2:.1f},{s.c2.y/2:.1f} {s.end_point.x/2:.1f},{s.end_point.y/2:.1f}')
        seg.append('Z')
        parts.append({'d': ''.join(seg), 'bbox': [min(xs_), min(ys_), max(xs_), max(ys_)], 'area': (max(xs_) - min(xs_)) * (max(ys_) - min(ys_))})
    return parts

ys, xs = np.nonzero(light)
bbox = [float(xs.min()) / 2, float(ys.min()) / 2, float(xs.max()) / 2, float(ys.max()) / 2]
res = {'w': W, 'h': H, 'bbox': bbox, 'light': trace(light), 'orange': trace(orange)}
json.dump(res, open(OUT, 'w'))
print('bbox', bbox, 'light', len(res['light']), 'orange', len(res['orange']))
