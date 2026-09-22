#!/usr/bin/env node
/*
 * Fetch a zone from each upstream and report what came back.
 *
 *   npm run probe -- SGR01 2026
 *   npm run probe -- SGR01 2026 --relay http://localhost:8000
 *
 * Run this when the page will not load, or after changing an endpoint. It
 * prints the HTTP result, the shape of the payload, and -- the useful part --
 * runs the response through js/api.js, the very parser the page uses, so the
 * answer is "the page can read this" rather than "the server replied".
 *
 * No dependencies. Node 18+.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* Load js/api.js the way the browser does: as a script against a window. */
function loadApi() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
  const win = {};
  new Function('window', src)(win);
  return win.SolatAPI;
}

const API = loadApi();

const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
  else positional.push(argv[i]);
}

const zone = (positional[0] ?? 'SGR01').toUpperCase();
const year = positional[1] ?? String(new Date().getFullYear());

if (!/^[A-Z]{3}[0-9]{2}$/.test(zone)) {
  console.error(`not a zone code: ${zone}`);
  process.exit(2);
}

const targets = flags.relay
  ? [
      { name: 'relay -> solat.my', url: `${flags.relay.replace(/\/$/, '')}/api/solat?zone=${zone}&year=${year}` },
      { name: 'relay -> jakim', url: `${flags.relay.replace(/\/$/, '')}/api/jakim?zone=${zone}&period=year` },
    ]
  : [
      { name: 'solat.my yearly', url: API.solatMyUrl(zone, year) },
      { name: 'JAKIM e-Solat', url: API.jakimUrl(zone, 'year') },
    ];

console.log(`probing zone ${zone}, year ${year}\n`);

let anyOk = false;

for (const t of targets) {
  console.log(`── ${t.name}`);
  console.log(`   ${t.url}`);

  const started = Date.now();
  let res, text;
  try {
    res = await fetch(t.url, {
      headers: { Accept: 'application/json', 'User-Agent': 'waktu-solat-probe/1.0' },
      signal: AbortSignal.timeout(30000),
    });
    text = await res.text();
  } catch (err) {
    console.log(`   UNREACHABLE  ${err.name === 'TimeoutError' ? 'timed out' : err.message}`);
    console.log('   (a network block, DNS failure or TLS problem — not a CORS issue;');
    console.log('    CORS only applies to a browser page, never to this script)\n');
    continue;
  }

  const ms = Date.now() - started;
  console.log(`   HTTP ${res.status}  ${text.length} bytes  ${ms}ms  ${res.headers.get('content-type') ?? ''}`);

  const acao = res.headers.get('access-control-allow-origin');
  console.log(`   Access-Control-Allow-Origin: ${acao ?? 'ABSENT — a browser page cannot read this cross-origin'}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.log(`   NOT JSON. First 200 chars:\n   ${text.slice(0, 200).replace(/\n/g, ' ')}\n`);
    continue;
  }

  console.log(`   top-level: ${Array.isArray(json) ? `array(${json.length})` : Object.keys(json).join(', ')}`);

  try {
    const days = API.normalise(json);
    anyOk = true;
    const first = days[0];
    const times = Object.entries(first.times)
      .map(([k, v]) => `${k} ${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`)
      .join('  ');
    console.log(`   PARSED OK: ${days.length} days, ${days.skipped} skipped`);
    console.log(`   first day: ${first.date.toDateString()}${first.hijri ? ` (${first.hijri})` : ''}`);
    console.log(`   ${times}`);
    console.log(`   last day : ${days[days.length - 1].date.toDateString()}`);
  } catch (err) {
    console.log(`   PARSE FAILED: ${err.message}`);
    const sample = Array.isArray(json) ? json[0] : null;
    console.log('   The page cannot read this shape. Paste the next few lines when reporting it:');
    console.log('   ' + JSON.stringify(sample ?? json).slice(0, 400));
  }
  console.log('');
}

process.exit(anyOk ? 0 : 1);
