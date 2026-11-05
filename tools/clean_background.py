"""Remove the baked-in Clippy from the Bliss photo so the animated one can move freely.

Deterministic fill (no generative model):
  * sky   : rebuilt per row by blending the clean sky colours left and right of the box
  * grass : copied from a horizon-aligned window elsewhere in the photo, then brightness-matched
            per row to the grass on both sides of the box so no band or seam shows
Writes assets/bliss_clean.png at 1920x1080.
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'Clippy in the Bliss Landscape.png')
OUT = os.path.join(HERE, '..', 'assets', 'bliss_clean.png')
DEBUG = sys.argv[1] if len(sys.argv) > 1 else None

img = Image.open(SRC).convert('RGB')
a = np.asarray(img).astype(np.float32)
H, W, _ = a.shape
x0, x1, y0, y1 = 318, 582, 310, 778          # box with Clippy, his brows and his shadow

# --- horizon per column (first row where green clearly beats blue), smoothed
gmb = a[:, :, 1] - a[:, :, 2]
horizon = np.full(W, H // 2, dtype=int)
for x in range(W):
    idx = np.nonzero(gmb[:, x] > 25)[0]
    if len(idx): horizon[x] = idx[0]
hs = np.array([int(np.median(horizon[max(0, x - 7):x + 8])) for x in range(W)])
hl = float(np.median(hs[x0 - 45:x0 - 5])); hr = float(np.median(hs[x1 + 5:x1 + 45]))
xs_t = np.arange(x0, x1); u = (xs_t - x0) / (x1 - x0)
h_t = hl + (hr - hl) * u                      # target horizon inside the box

def smooth_rows(v, k=21):
    out = v.copy()
    for i in range(len(v)): out[i] = v[max(0, i - k // 2):i + k // 2 + 1].mean(axis=0)
    return out

# --- grass: pick the source window whose grass brightness best matches the neighbours
grass_rows = np.arange(int(max(hl, hr)) + 8, y1)
tl = a[grass_rows, x0 - 45:x0 - 5, :].mean(axis=1); tr = a[grass_rows, x1 + 5:x1 + 45, :].mean(axis=1)
def grass_score(dx):
    xs = xs_t + dx
    if xs.min() < 0 or xs.max() >= W: return None
    sl = a[grass_rows, xs[0]:xs[0] + 40, :].mean(axis=1); sr = a[grass_rows, xs[-1] - 40:xs[-1], :].mean(axis=1)
    return float(np.abs(sl - tl).mean() + np.abs(sr - tr).mean()) + abs(dx) * .004
best = min(((grass_score(dx), dx) for dx in list(range(-318, -274, 2)) + list(range(275, W - x1, 2)) if grass_score(dx) is not None))
dx = best[1]; print(f'grass source offset dx={dx} (score {best[0]:.1f})')

patch = a.copy()
for i, xt in enumerate(xs_t):
    xsrc = xt + dx
    shift = int(round(hs[xsrc] - h_t[i]))
    ys = np.clip(np.arange(y0, y1) + shift, 0, H - 1)
    patch[y0:y1, xt, :] = a[ys, xsrc, :]

# per-row, per-side brightness matching of the copied grass
rows = np.arange(y0, y1)
def side_means(src, xa, xb): return smooth_rows(src[rows, xa:xb, :].mean(axis=1))
gl = np.clip(side_means(a, x0 - 45, x0 - 5) / np.maximum(side_means(patch, x0, x0 + 40), 1), .6, 1.6)
gr = np.clip(side_means(a, x1 + 5, x1 + 45) / np.maximum(side_means(patch, x1 - 40, x1), 1), .6, 1.6)
first_grass = int(max(hl, hr)) + 8 - y0
gl[:first_grass] = gl[first_grass]; gr[:first_grass] = gr[first_grass]      # hold the first valid gain upward
gain = gl[:, None, :] * (1 - u)[None, :, None] + gr[:, None, :] * u[None, :, None]
patch[y0:y1, x0:x1, :] *= gain

# --- sky: blend the clean sky colour left and right of the box, row by row
def ref_col(xa, xb, hcap):
    out = np.zeros((H, 3), np.float32)
    for y in range(H):
        yy = min(y, int(hcap) - 8)
        px = a[yy, xa:xb, :]
        clean = px[px.min(axis=1) < 195]          # ignore cloud pixels so they don't streak across the fill
        out[y] = np.median(clean if len(clean) >= 6 else px, axis=0)
    return out
L = ref_col(x0 - 45, x0 - 5, hl); R = ref_col(x1 + 5, x1 + 45, hr)
fill = patch.copy()
for i, xt in enumerate(xs_t):
    hb = h_t[i]
    sky = L[y0:y1] * (1 - u[i]) + R[y0:y1] * u[i]
    yy = np.arange(y0, y1)
    w = np.clip((yy - (hb - 12)) / 14.0, 0, 1)[:, None]       # 0 = sky, 1 = patch, 14 px blend at the horizon
    fill[y0:y1, xt, :] = sky * (1 - w) + patch[y0:y1, xt, :] * w

# --- feathered composite into the original
mask = np.zeros((H, W), dtype=np.float32)
mask[y0 + 8:y1 - 8, x0 + 8:x1 - 8] = 1.0
mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(9))).astype(np.float32)[..., None] / 255.0
out = a * (1 - mask) + fill * mask
out_img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

if DEBUG:
    crop = (x0 - 160, y0 - 80, x1 + 160, y1 + 60)
    side = Image.new('RGB', ((crop[2] - crop[0]) * 2 + 10, crop[3] - crop[1]), 'white')
    side.paste(img.crop(crop), (0, 0)); side.paste(out_img.crop(crop), (crop[2] - crop[0] + 10, 0))
    side.save(DEBUG); print('debug ->', DEBUG)

final = out_img.resize((1920, 1080), Image.LANCZOS)
final.save(OUT, optimize=True)
print('wrote', OUT, final.size)
