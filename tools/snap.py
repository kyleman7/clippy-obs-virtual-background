"""Render frames of the background page with headless Chrome/Edge using virtual time, so
animations can be checked at exact moments without a visible window.

    python tools/snap.py OUT.png alert:900 think:1500 celebrate:1200 ...
Each item is <action>:<ms after the action starts>[:extra query]. Needs server.py running on 8787.
"""
import os, subprocess, sys, tempfile, time
from PIL import Image, ImageDraw

BROWSERS = [r'C:\Program Files\Google\Chrome\Application\chrome.exe',
            r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe']
browser = next(b for b in BROWSERS if os.path.exists(b))
out = sys.argv[1]; items = sys.argv[2:]
frames = []
tmp = tempfile.mkdtemp()
for i, item in enumerate(items):
    parts = item.split(':'); action, ms = parts[0], int(parts[1]); extra = ('&' + parts[2]) if len(parts) > 2 else ''
    url = f'http://127.0.0.1:8787/background.html?idle=0&nolink=1&run={action}&at=300{extra}'
    png = os.path.join(tmp, f'f{i}.png')
    cmd = [browser, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1920,1080',
           f'--virtual-time-budget={300 + ms + 400}', f'--screenshot={png}', f'--user-data-dir={os.path.join(tmp, "profile")}', url]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    if not os.path.exists(png):
        print('no frame for', item); continue
    im = Image.open(png).convert('RGB')
    if os.environ.get('ZOOM'): im = im.crop((150, 100, 1150, 950)).resize((640, 544), Image.LANCZOS)
    else: im = im.resize((640, 360), Image.LANCZOS)
    d = ImageDraw.Draw(im); d.rectangle((0, 0, 330, 30), fill=(0, 0, 0)); d.text((8, 8), f'{action} @ {ms} ms', fill=(255, 255, 255))
    frames.append(im); print('frame', item)
cols = 3; rows = (len(frames) + cols - 1) // cols
fh = frames[0].height
sheet = Image.new('RGB', (640 * cols + 10 * (cols - 1), fh * rows + 10 * (rows - 1)), 'white')
for i, f in enumerate(frames): sheet.paste(f, ((i % cols) * 650, (i // cols) * (fh + 10)))
sheet.save(out); print('sheet ->', out)
