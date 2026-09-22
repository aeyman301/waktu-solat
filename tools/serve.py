#!/usr/bin/env python3
"""Serve the page and relay the prayer-time APIs from one origin.

The Node equivalent is tools/serve.mjs (`npm start`); this exists for a box
with Python but no Node. Keep the two in step.

The browser refuses to read solat.my or e-solat.gov.my from a page on another
origin because neither sends an Access-Control-Allow-Origin header. Nothing you can
write in the page fixes that -- the check is the browser's, and the header is
the server's. The way out is to stop making it a cross-origin request: serve
the schedule from the same host that serves the page.

    python3 tools/serve.py
    # then open http://localhost:8000
    # and set the relay field to:  /api/solat?zone={zone}&year={year}

Standard library only, same as `python3 -m http.server`.

This is not a general proxy. The zone, year and period are validated against
fixed patterns and the upstream URL is rebuilt from them, so it can only ever
fetch prayer times -- it cannot be pointed elsewhere by a crafted request.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_JAKIM = "https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat"
DEFAULT_SOLATMY = "https://solat.my/api/yearly"

ZONE_RE = re.compile(r"^[A-Z]{3}[0-9]{2}$")
YEAR_RE = re.compile(r"^[0-9]{4}$")
PERIODS = {"today", "week", "month", "year", "duration"}

JAKIM_PATH = "/api/jakim"
SOLATMY_PATH = "/api/solat"
RELAY_PATHS = (SOLATMY_PATH, JAKIM_PATH)
UPSTREAM_TIMEOUT = 30


class Handler(SimpleHTTPRequestHandler):
    jakim = DEFAULT_JAKIM
    solatmy = DEFAULT_SOLATMY

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path in RELAY_PATHS:
            self.relay()
        else:
            super().do_GET()

    def do_OPTIONS(self):
        if urllib.parse.urlparse(self.path).path in RELAY_PATHS:
            self.send_response(204)
            self.cors()
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.end_headers()
        else:
            self.send_error(405)

    # -- relay ---------------------------------------------------------

    def relay(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        zone = (params.get("zone") or [""])[0].strip().upper()

        if not ZONE_RE.match(zone):
            return self.fail(400, "kod zon tidak sah: %r" % zone)

        if parsed.path == SOLATMY_PATH:
            year = (params.get("year") or [str(__import__("datetime").date.today().year)])[0].strip()
            if not YEAR_RE.match(year):
                return self.fail(400, "tahun tidak sah: %r" % year)
            url = "%s/%s/%s" % (
                self.solatmy,
                urllib.parse.quote(zone),
                urllib.parse.quote(year),
            )
        else:
            period = (params.get("period") or ["year"])[0].strip().lower()
            if period not in PERIODS:
                return self.fail(400, "period tidak sah: %r" % period)
            url = "%s&period=%s&zone=%s" % (
                self.jakim,
                urllib.parse.quote(period),
                urllib.parse.quote(zone),
            )

        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            # e-Solat has been known to answer differently without one.
            "User-Agent": "waktu-solat-relay/1.0",
        })

        try:
            with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as res:
                body = res.read()
        except urllib.error.HTTPError as e:
            return self.fail(502, "hulu menjawab HTTP %d" % e.code)
        except Exception as e:  # timeout, DNS, TLS, refused
            return self.fail(504, "tidak dapat menghubungi hulu: %s" % e)

        # Pass the bytes through untouched; the page does its own validation.
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)
        self.log_message('relay %s %s -> %d bytes', parsed.path, zone, len(body))

    def fail(self, code, message):
        body = json.dumps({"status": "Relay error", "error": message}).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.cors()
        self.end_headers()
        self.wfile.write(body)

    def cors(self):
        # Harmless when the page is same-origin, and lets the relay also serve
        # a copy of the site hosted elsewhere.
        self.send_header("Access-Control-Allow-Origin", "*")

    # Prayer times change daily; never let a proxy or the browser pin them.
    def end_headers(self):
        if urllib.parse.urlparse(self.path).path in RELAY_PATHS:
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-p", "--port", type=int, default=8000)
    ap.add_argument("-b", "--bind", default="0.0.0.0",
                    help="default 0.0.0.0, so other machines on the LAN can reach it")
    ap.add_argument("-d", "--directory",
                    default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    help="site root (default: the repository)")
    ap.add_argument("--jakim-base", default=DEFAULT_JAKIM, help=argparse.SUPPRESS)
    ap.add_argument("--solat-base", default=DEFAULT_SOLATMY, help=argparse.SUPPRESS)
    args = ap.parse_args()

    Handler.jakim = args.jakim_base
    Handler.solatmy = args.solat_base
    handler = partial(Handler, directory=args.directory)

    with ThreadingHTTPServer((args.bind, args.port), handler) as httpd:
        print("serving %s on http://%s:%d" % (args.directory, args.bind, args.port))
        print("relay: %s?zone={zone}&year={year}" % SOLATMY_PATH)
        print("relay: %s?zone={zone}&period={period}" % JAKIM_PATH)
        print("set that path in the page's relay field, then leave this running.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")
            return 0


if __name__ == "__main__":
    sys.exit(main())
