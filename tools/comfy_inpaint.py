"""Inpaint Clippy out of the Bliss photo using the local ComfyUI instance (SD1.5 Realistic Vision).

Produces several candidates (different seeds) composited back into the full-resolution photo,
plus a comparison strip, so the best one can be picked by eye.
"""
import io, json, os, sys, time, uuid, urllib.request, urllib.parse
import numpy as np
from PIL import Image, ImageFilter

COMFY = 'http://127.0.0.1:8188'
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'Clippy in the Bliss Landscape.png')
OUTDIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'assets')
CKPT = 'Realistic_Vision_V6.0_NV_B1.safetensors'
BATCH = 4
os.makedirs(OUTDIR, exist_ok=True)

img = Image.open(SRC).convert('RGB'); W, H = img.size
bx0, bx1, by0, by1 = 318, 582, 310, 778            # box containing Clippy, brows and shadow
S = 768
cx, cy = (bx0 + bx1) // 2, (by0 + by1) // 2
cx0 = max(0, min(W - S, cx - S // 2)); cy0 = max(0, min(H - S, cy - S // 2))
crop = img.crop((cx0, cy0, cx0 + S, cy0 + S)).convert('RGBA')
alpha = np.full((S, S), 255, np.uint8)
alpha[by0 - cy0:by1 - cy0, bx0 - cx0:bx1 - cx0] = 0
crop.putalpha(Image.fromarray(alpha))
buf = io.BytesIO(); crop.save(buf, 'PNG'); data = buf.getvalue()

def upload(data, name):
    b = '----clippy' + uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
            f'Content-Type: image/png\r\n\r\n').encode() + data + \
           (f'\r\n--{b}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{b}--\r\n').encode()
    req = urllib.request.Request(COMFY + '/upload/image', data=body,
                                 headers={'Content-Type': f'multipart/form-data; boundary={b}'})
    return json.load(urllib.request.urlopen(req, timeout=60))

up = upload(data, 'clippy_inpaint_src.png'); print('uploaded', up)
name = up.get('name', 'clippy_inpaint_src.png')

graph = {
  "1": {"class_type": "LoadImage", "inputs": {"image": name}},
  "2": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
  "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 1], "text":
        "photo of the windows xp bliss wallpaper, rolling green grass hill, lush short grass, clear blue sky with soft white clouds, sunny day, sharp, high detail"}},
  "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 1], "text":
        "paperclip, clippy, cartoon, character, object, text, watermark, logo, blurry, person, tree, road, path, fence, building, rock, flower, low quality, deformed"}},
  "5": {"class_type": "VAEEncodeForInpaint", "inputs": {"pixels": ["1", 0], "vae": ["2", 2], "mask": ["1", 1], "grow_mask_by": 20}},
  "6": {"class_type": "RepeatLatentBatch", "inputs": {"samples": ["5", 0], "amount": BATCH}},
  "7": {"class_type": "KSampler", "inputs": {"model": ["2", 0], "positive": ["3", 0], "negative": ["4", 0],
        "latent_image": ["6", 0], "seed": 20261105, "steps": 30, "cfg": 5.5,
        "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0}},
  "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["2", 2]}},
  "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "clippy_clean"}},
}
client = uuid.uuid4().hex
req = urllib.request.Request(COMFY + '/prompt', data=json.dumps({"prompt": graph, "client_id": client}).encode(),
                             headers={'Content-Type': 'application/json'})
resp = json.load(urllib.request.urlopen(req, timeout=60)); print('queued', resp)
pid = resp['prompt_id']

t0 = time.time(); outputs = None
while time.time() - t0 < 900:
    hist = json.load(urllib.request.urlopen(COMFY + f'/history/{pid}', timeout=30))
    if pid in hist:
        st = hist[pid].get('status', {})
        if st.get('status_str') == 'error':
            print('ERROR', json.dumps(hist[pid]['status'], indent=1)[:3000]); sys.exit(1)
        outputs = hist[pid].get('outputs', {})
        if outputs: break
    time.sleep(1.5)
if not outputs:
    print('timed out'); sys.exit(1)
print(f'done in {time.time()-t0:.0f}s')

# composite each candidate back into the full photo, feathered, slightly beyond the box
mask = np.zeros((H, W), np.float32)
mask[by0 - 6:by1 + 6, bx0 - 6:bx1 + 6] = 1.0
mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(7))).astype(np.float32)[..., None] / 255.0
base = np.asarray(img).astype(np.float32)
cands = []
for node, out in outputs.items():
    for i, im in enumerate(out.get('images', [])):
        q = urllib.parse.urlencode({'filename': im['filename'], 'subfolder': im.get('subfolder', ''), 'type': im.get('type', 'output')})
        gen = Image.open(io.BytesIO(urllib.request.urlopen(COMFY + '/view?' + q, timeout=60).read())).convert('RGB')
        full = base.copy()
        full[cy0:cy0 + S, cx0:cx0 + S, :] = np.asarray(gen).astype(np.float32)
        comp = base * (1 - mask) + full * mask
        out_img = Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8))
        p = os.path.join(OUTDIR, f'comfy_cand_{len(cands)}.png'); out_img.save(p); cands.append(out_img); print('candidate', p)

# comparison strip of the box region
cw, ch = bx1 - bx0 + 200, by1 - by0 + 120
strip = Image.new('RGB', (cw * len(cands) + 10 * (len(cands) - 1), ch), 'white')
for i, c in enumerate(cands):
    strip.paste(c.crop((bx0 - 100, by0 - 60, bx1 + 100, by1 + 60)), (i * (cw + 10), 0))
sp = os.path.join(OUTDIR, 'comfy_compare.png'); strip.save(sp); print('strip', sp)
