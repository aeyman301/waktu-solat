#!/usr/bin/env node
/*
 * Serve the page and relay the prayer-time APIs from one origin.
 *
 *   npm start
 *   # then open http://localhost:8000
 *   # and set the relay field to:  /api/solat?zone={zone}&year={year}
 *
 * Neither solat.my nor e-solat.gov.my sends an Access-Control-Allow-Origin
 * header, so a browser refuses to let a page on another origin read them. The
 * request itself is fine -- open either URL in a tab and the JSON is there --
 * but a fetch from the page is blocked. Nothing written in the page fixes
 * that: the check is the browser's and the header is the server's.
 *
 * So this stops the request being cross-origin. Node fetches upstream
 * server-side, where there is no CORS to answer to, and hands the bytes back
 * from the same origin that served the page.
 *
 * No dependencies -- Node 18+ only, for its built-in fetch.
 *
 * This is not a general proxy. The zone, year and period are validated against
 * fixed patterns and the upstream URL is rebuilt from them, so a crafted
 * request cannot point it anywhere else.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DEFAULT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SOLATMY_BASE = 'https://solat.my/api/yearly';
const JAKIM_BASE = 'https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat';

const ZONE_RE = /^[A-Z]{3}[0-9]{2}$/;
const PERIODS = new Set(['today', 'week', 'month', 'year', 'duration']);
const UPSTREAM_TIMEOUT_MS = 30000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(args.dir ?? ROOT_DEFAULT);
const PORT = Number(args.port ?? 8000);
const HOST = args.host ?? '0.0.0.0';

// Overridable so the relay can be exercised against a stand-in upstream.
const SOLATMY = args['solat-base'] ?? SOLATMY_BASE;
const JAKIM = args['jakim-base'] ?? JAKIM_BASE;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else out[a.slice(2)] = argv[++i];
  }
  if (out.p) out.port = out.p;
  return out;
}

// -- relay ------------------------------------------------------------

function upstreamFor(pathname, params) {
  const zone = (params.get('zone') ?? '').trim().toUpperCase();
  if (!ZONE_RE.test(zone)) {
    return { error: `kod zon tidak sah: ${JSON.stringify(zone)}` };
  }

  if (pathname === '/api/solat') {
    const year = (params.get('year') ?? String(new Date().getFullYear())).trim();
    if (!/^[0-9]{4}$/.test(year)) {
      return { error: `tahun tidak sah: ${JSON.stringify(year)}` };
    }
    return { url: `${SOLATMY}/${encodeURIComponent(zone)}/${encodeURIComponent(year)}` };
  }

  const period = (params.get('period') ?? 'year').trim().toLowerCase();
  if (!PERIODS.has(period)) {
    return { error: `period tidak sah: ${JSON.stringify(period)}` };
  }
  return {
    url: `${JAKIM}&period=${encodeURIComponent(period)}&zone=${encodeURIComponent(zone)}`,
  };
}

async function relay(req, res, pathname, params) {
  const { url, error } = upstreamFor(pathname, params);
  if (error) return sendJSON(res, 400, { status: 'Relay error', error });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      signal: ac.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'waktu-solat-relay/1.0',
      },
    });
    const body = Buffer.from(await upstream.arrayBuffer());

    if (!upstream.ok) {
      return sendJSON(res, 502, {
        status: 'Relay error',
        error: `hulu menjawab HTTP ${upstream.status}`,
        upstream: url,
      });
    }

    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      // Harmless same-origin, and lets the relay serve a copy hosted elsewhere.
      'Access-Control-Allow-Origin': '*',
      // Prayer times change daily; never let anything pin them.
      'Cache-Control': 'no-store',
    });
    res.end(body);
    log(`relay ${pathname} -> ${body.length} bytes`);
  } catch (err) {
    const why = err.name === 'AbortError' ? 'tamat masa' : err.message;
    sendJSON(res, 504, { status: 'Relay error', error: `tidak dapat menghubungi hulu: ${why}`, upstream: url });
  } finally {
    clearTimeout(timer);
  }
}

function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// -- static -----------------------------------------------------------

function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.join(ROOT, rel);

  // path.join collapses "..", so this catches any attempt to climb out.
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': st.size,
    });
    fs.createReadStream(file).pipe(res);
  });
}

// -- server -----------------------------------------------------------

function log(msg) {
  process.stdout.write(`${new Date().toISOString().slice(11, 19)}  ${msg}\n`);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const isRelay = url.pathname === '/api/solat' || url.pathname === '/api/jakim';

  if (req.method === 'OPTIONS' && isRelay) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    }).end();
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }

  if (isRelay) relay(req, res, url.pathname, url.searchParams);
  else serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  log(`serving ${ROOT} on http://${HOST}:${PORT}`);
  log('relay: /api/solat?zone={zone}&year={year}   (solat.my)');
  log('relay: /api/jakim?zone={zone}&period={period}   (JAKIM e-Solat)');
  log('put one of those paths in the page’s relay field, then leave this running.');
});
