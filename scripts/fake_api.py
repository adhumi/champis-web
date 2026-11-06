"""Fausse API pour la CI : répond à tout GET par le chemin, l'hôte et le X-Forwarded-For reçus,
pour vérifier le relais du Caddyfile sans réseau ni production. Usage : python3 scripts/fake_api.py [port]."""

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Echo(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        body = json.dumps(
            {
                "path": self.path,
                "host": self.headers.get("Host"),
                "x_forwarded_for": self.headers.get("X-Forwarded-For"),
            }
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Server", "fausse-api")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    ThreadingHTTPServer(("127.0.0.1", port), Echo).serve_forever()
