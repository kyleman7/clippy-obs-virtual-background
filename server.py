#!/usr/bin/env python3
"""Clippy control server.

Serves the OBS background page and the control board, and relays board clicks to the
background page over server-sent events. Standard library only.

    python server.py                 # http://127.0.0.1:8787/  (board)   /background.html (OBS)
    python server.py --port 9000
    python server.py --host 0.0.0.0  # also reachable from a phone/tablet on the LAN

Any HTTP client can trigger an action too (Stream Deck "web request", curl, OBS scripts):
    GET  /do/<action>?key=value          e.g. /do/greet   /do/say?text=Hello
    POST /action   {"action": "...", ...}
"""
import argparse, json, os, queue, sys, threading, time, webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

HERE = os.path.dirname(os.path.abspath(__file__))
clients = set()
clients_lock = threading.Lock()
state = {'settings': {'autoIdle': True, 'sound': False}, 'pos': 'centerLeft', 'scale': 1.15, 'mode': 'idle', 'bg': True}

MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon'}


def sse_bytes(obj):
    return ('data: ' + json.dumps(obj) + '\n\n').encode('utf-8')


def handle(msg):
    """Update the remembered state and push the message to every connected background page."""
    act = msg.get('action')
    if act == 'setting' and msg.get('key') in state['settings']:
        state['settings'][msg['key']] = bool(msg.get('value'))
    elif act == 'move' and msg.get('pos'):
        state['pos'] = msg['pos']
    elif act == 'size' and msg.get('scale'):
        try: state['scale'] = float(msg['scale'])
        except (TypeError, ValueError): pass
    elif act in ('goodbye', 'hide'):
        state['mode'] = 'hidden'
    elif act == 'snooze':
        state['mode'] = 'sleep'
    elif act == 'bg':
        state['bg'] = bool(msg.get('value'))
    elif act not in ('look', 'size', 'setting', 'hideBalloon', 'say', 'stop'):
        state['mode'] = 'idle'
    print(time.strftime('%H:%M:%S'), 'action:', json.dumps(msg), flush=True)
    data = sse_bytes(msg)
    with clients_lock:
        for q in list(clients):
            q.put(data)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def log_message(self, fmt, *args):      # keep the console to actions only
        pass

    def guess_type(self, path):
        return MIME.get(os.path.splitext(path)[1].lower(), super().guess_type(path))

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_json(self, obj, code=200):
        data = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/events':
            return self.stream_events()
        if u.path == '/state':
            return self.send_json(state)
        if u.path.startswith('/do/'):
            msg = {'action': unquote(u.path[4:])}
            for k, v in parse_qs(u.query).items():
                msg[k] = v[0] if len(v) == 1 else v
            if isinstance(msg.get('options'), str):
                msg['options'] = [o for o in msg['options'].split('|') if o]
            handle(msg)
            return self.send_json({'ok': True, 'sent': msg})
        if u.path == '/':
            self.path = '/board.html'
        return super().do_GET()

    def do_POST(self):
        if urlparse(self.path).path != '/action':
            return self.send_json({'ok': False, 'error': 'not found'}, 404)
        n = int(self.headers.get('Content-Length') or 0)
        try:
            msg = json.loads(self.rfile.read(n) or b'{}')
            if not isinstance(msg, dict) or not msg.get('action'):
                raise ValueError('missing action')
        except (ValueError, json.JSONDecodeError) as e:
            return self.send_json({'ok': False, 'error': str(e)}, 400)
        handle(msg)
        return self.send_json({'ok': True})

    def stream_events(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Connection', 'keep-alive')
        self.end_headers()
        q = queue.Queue()
        with clients_lock:
            clients.add(q)
        print(time.strftime('%H:%M:%S'), 'background page connected from', self.client_address[0], flush=True)
        try:
            self.wfile.write(b'retry: 1500\n\n')
            self.wfile.write(sse_bytes({'type': 'state', 'state': state}))
            self.wfile.flush()
            while True:
                try:
                    item = q.get(timeout=15)
                except queue.Empty:
                    item = b': ping\n\n'
                self.wfile.write(item)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            with clients_lock:
                clients.discard(q)
            print(time.strftime('%H:%M:%S'), 'background page disconnected', flush=True)


def main():
    ap = argparse.ArgumentParser(description='Clippy control server')
    ap.add_argument('--host', default='127.0.0.1', help='bind address (use 0.0.0.0 to allow other devices on your network)')
    ap.add_argument('--port', type=int, default=8787)
    ap.add_argument('--no-open', action='store_true', help="don't open the control board in a browser")
    args = ap.parse_args()

    ThreadingHTTPServer.allow_reuse_address = True
    try:
        httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        print(f'Could not listen on {args.host}:{args.port}: {e}\nIs another copy already running? Try --port 8788.', file=sys.stderr)
        sys.exit(1)
    shown = 'localhost' if args.host in ('0.0.0.0', '::') else args.host
    print('Clippy control server')
    print(f'  Control board : http://{shown}:{args.port}/')
    print(f'  OBS browser source URL : http://{shown}:{args.port}/background.html   (1920 x 1080)')
    print('  Press Ctrl+C to stop.\n', flush=True)
    if not args.no_open:
        threading.Timer(0.6, lambda: webbrowser.open(f'http://{shown}:{args.port}/')).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()
