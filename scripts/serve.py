"""Serve Wayfarer locally with opt-in access to the adjacent character workbooks."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import shutil
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit


PROJECT = Path(__file__).resolve().parents[1]
WORKBOOKS = PROJECT.parent / "Character Sheets"


class CampaignHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def get_workbooks(self):
        return {
            file.name: file for file in sorted(WORKBOOKS.glob("*.xlsx"))
            if file.is_file() and file.resolve().parent == WORKBOOKS.resolve()
        }

    def send_data(self, content, media_type):
        self.send_response(200)
        self.send_header("Content-Type", media_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.end_headers()
        self.wfile.write(content)

    def local_request(self):
        host = self.headers.get("Host", "").split(":", 1)[0].lower()
        return host in {"localhost", "127.0.0.1"} and self.headers.get("Sec-Fetch-Site") != "cross-site"

    def send_archive(self, include_body):
        if not self.local_request():
            self.send_error(403)
            return
        archive = next(iter(sorted(PROJECT.parent.glob("5etools*.zip"))), None)
        if archive is None or archive.resolve().parent != PROJECT.parent.resolve():
            self.send_error(404)
            return
        with archive.open("rb") as handle:
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(archive.stat().st_size))
            self.send_header("X-Archive-Name", archive.name)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.end_headers()
            if include_body:
                shutil.copyfileobj(handle, self.wfile)

    def do_HEAD(self):
        if urlsplit(self.path).path == "/local-archive":
            self.send_archive(False)
        else:
            super().do_HEAD()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/local-archive":
            self.send_archive(True)
            return
        if path == "/local-sheets" or path.startswith("/local-sheets/"):
            if not self.local_request():
                self.send_error(403)
                return
        if path == "/local-sheets":
            files = [{"name": name, "url": "/local-sheets/" + quote(name, safe="")} for name in self.get_workbooks()]
            self.send_data(json.dumps(files).encode(), "application/json")
        elif path.startswith("/local-sheets/"):
            file = self.get_workbooks().get(unquote(path.removeprefix("/local-sheets/")))
            if file is None:
                self.send_error(404)
                return
            self.send_data(file.read_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        else:
            super().do_GET()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=5173)
    args = parser.parse_args()
    handler = partial(CampaignHandler, directory=str(PROJECT / "dist"))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"Local Wayfarer available at http://127.0.0.1:{server.server_port}/", flush=True)
        server.serve_forever()
