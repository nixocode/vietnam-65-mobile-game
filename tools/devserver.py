"""Static file server for local playtesting, with caching disabled.

Browsers happily hold on to a previously fetched js/game.js, which makes a code
change look like it did nothing. Every response here is no-store so what runs in
the tab is always what is on disk.

It also accepts POST /__shot with a data: URL body and writes the decoded image
to assets/debug/. The automation browser pane never composites frames, so
screenshots of it time out; having the page hand its own canvas back is the only
way to actually LOOK at a rendered frame rather than infer it from numbers.
"""
import base64
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def do_POST(self):
        # DEVELOPMENT ONLY. This writes files to assets/debug/ and must never be
        # exposed beyond localhost. The server binds 127.0.0.1 and the name is
        # stripped to [A-Za-z0-9-_] so it cannot escape the directory, but the
        # endpoint has no business on a public host.
        if self.path.split('?')[0] != '/__shot':
            self.send_error(404)
            return
        try:
            n = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(n).decode('utf-8', 'replace')
            name = self.headers.get('X-Shot-Name', 'shot')
            name = ''.join(c for c in name if c.isalnum() or c in '-_') or 'shot'
            head, _, b64 = body.partition(',')
            ext = 'jpg' if 'jpeg' in head else 'png'
            out = os.path.join(ROOT, 'assets', 'debug', name + '.' + ext)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, 'wb') as f:
                f.write(base64.b64decode(b64))
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(out.encode())
        except Exception as e:
            self.send_error(500, str(e))

    def log_message(self, *a):
        pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8931
http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
