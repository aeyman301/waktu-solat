#!/usr/bin/env node
/*
 * Tests for the response parser in js/api.js.
 *
 *   npm test
 *
 * e-Solat's shape is known and pinned here exactly. solat.my's is not -- it
 * could not be reached from where this was written -- so it is covered by the
 * range of shapes a JAKIM-derived Malaysian API plausibly returns: Malay field
 * names, ISO dates, a bare array, a wrapped list, 12-hour clock times. If the
 * real response is none of these, `npm run probe` will say so and this file is
 * where the fix belongs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(ROOT, 'js', 'api.js'), 'utf8');
const win = {};
new Function('window', src)(win);
const API = win.SolatAPI;

let pass = 0, fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    fail++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what ?? 'value'}: expected ${e}, got ${a}`);
}

function throws(fn, match, what) {
  try {
    fn();
  } catch (err) {
    if (match && !match.test(err.message)) {
      throw new Error(`${what}: message ${JSON.stringify(err.message)} did not match ${match}`);
    }
    return;
  }
  throw new Error(`${what}: expected a throw, got none`);
}

const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

console.log('\nesolat shape (pinned — this is documented)');

test('parses a real e-Solat payload', () => {
  const days = API.normalise({
    status: 'OK!', zone: 'SGR01', bearing: '292',
    prayerTime: [
      { hijri: '1447-03-29', date: '01-Jan-2026', day: 'Khamis',
        imsak: '05:47:00', fajr: '05:57:00', syuruk: '07:10:00', dhuha: '07:33:00',
        dhuhr: '13:17:00', asr: '16:40:00', maghrib: '19:19:00', isha: '20:33:00' },
    ],
  });
  eq(days.length, 1, 'day count');
  eq(hm(days[0].times.subuh), '05:57', 'subuh');
  eq(hm(days[0].times.zohor), '13:17', 'zohor');
  eq(hm(days[0].times.isyak), '20:33', 'isyak');
  eq(days[0].hijri, '1447-03-29', 'hijri');
  eq(days[0].date.getFullYear(), 2026, 'year');
});

test('rejects a non-OK status', () => {
  throws(() => API.normalise({ status: 'Failed!', prayerTime: [] }),
    /status/i, 'failed status');
});

console.log('\nshapes solat.my might return (unverified — see the file header)');

test('bare array with Malay field names', () => {
  const days = API.normalise([
    { tarikh: '2026-01-01', imsak: '05:47', subuh: '05:57', syuruk: '07:10',
      zohor: '13:17', asar: '16:40', maghrib: '19:19', isyak: '20:33' },
    { tarikh: '2026-01-02', subuh: '05:58', zohor: '13:18', asar: '16:41',
      maghrib: '19:20', isyak: '20:34' },
  ]);
  eq(days.length, 2, 'day count');
  eq(hm(days[0].times.subuh), '05:57', 'subuh from "subuh"');
  eq(hm(days[1].times.asar), '16:41', 'asar from "asar"');
});

test('list wrapped in {data:[...]}', () => {
  const days = API.normalise({ zone: 'SGR01', data: [
    { date: '2026-03-05', fajr: '06:01', dhuhr: '13:20', asr: '16:35',
      maghrib: '19:25', isha: '20:35' },
  ]});
  eq(days.length, 1, 'day count');
  eq(days[0].date.getMonth(), 2, 'March');
});

test('list nested two levels down', () => {
  const days = API.normalise({ result: { zone: 'SGR01', waktuSolat: [
    { date: '2026-06-01', subuh: '05:45', zohor: '13:15', asar: '16:39',
      maghrib: '19:24', isyak: '20:38' },
  ]}});
  eq(days.length, 1, 'day count');
});

test('12-hour clock times', () => {
  const days = API.normalise([
    { date: '01/01/2026', subuh: '5:57 am', zohor: '1:17 pm', asar: '4:40 pm',
      maghrib: '7:19 pm', isyak: '8:33 pm' },
  ]);
  eq(hm(days[0].times.zohor), '13:17', 'pm converted');
  eq(hm(days[0].times.subuh), '05:57', 'am kept');
  eq(days[0].date.getDate(), 1, 'day-first date');
});

console.log('\nrobustness');

test('a malformed day is skipped, not fatal', () => {
  const days = API.normalise({ prayerTime: [
    { date: '01-Jan-2026', fajr: '05:57', dhuhr: '13:17', asr: '16:40', maghrib: '19:19', isha: '20:33' },
    { date: '02-Jan-2026', fajr: '05:58', dhuhr: '13:18', asr: '', maghrib: '19:20', isha: '20:34' },
    { date: 'rubbish',     fajr: '05:59', dhuhr: '13:19', asr: '16:42', maghrib: '19:21', isha: '20:35' },
    { date: '04-Jan-2026', fajr: '06:00', dhuhr: '13:20', asr: '16:43', maghrib: '19:22', isha: '20:36' },
  ]});
  eq(days.length, 2, 'usable days');
  eq(days.skipped, 2, 'skipped');
});

test('duplicate dates keep the first', () => {
  const days = API.normalise({ prayerTime: [
    { date: '01-Jan-2026', fajr: '05:57', dhuhr: '13:17', asr: '16:40', maghrib: '19:19', isha: '20:33' },
    { date: '01-Jan-2026', fajr: '01:00', dhuhr: '01:00', asr: '01:00', maghrib: '01:00', isha: '01:00' },
  ]});
  eq(days.length, 1, 'deduped');
  eq(hm(days[0].times.subuh), '05:57', 'first kept');
});

test('days come back sorted', () => {
  const days = API.normalise({ prayerTime: [
    { date: '05-Jan-2026', fajr: '05:59', dhuhr: '13:19', asr: '16:42', maghrib: '19:21', isha: '20:35' },
    { date: '01-Jan-2026', fajr: '05:57', dhuhr: '13:17', asr: '16:40', maghrib: '19:19', isha: '20:33' },
    { date: '03-Jan-2026', fajr: '05:58', dhuhr: '13:18', asr: '16:41', maghrib: '19:20', isha: '20:34' },
  ]});
  eq(days.map(d => d.date.getDate()), [1, 3, 5], 'ascending');
});

test('a day missing a fard prayer is not accepted', () => {
  throws(() => API.normalise([
    { date: '2026-01-01', subuh: '05:57', zohor: '13:17', asar: '16:40', maghrib: '19:19' },
  ]), /tiada rekod/i, 'missing isyak');
});

test('rejects payloads with no prayer times at all', () => {
  throws(() => API.normalise({ message: 'hello' }), /tiada senarai/i, 'no list');
  throws(() => API.normalise('nope'), /bukan objek/i, 'string');
  throws(() => API.normalise({ prayerTime: [{ date: 'x' }] }), /tiada rekod/i, 'junk rows');
});

test('metadata holding one timestamp is not mistaken for a day', () => {
  throws(() => API.normalise({ serverTime: '2026-01-01T05:57:00', zone: 'SGR01' }),
    /tiada senarai/i, 'metadata only');
});

console.log('\nURL building');

test('builds both upstream URLs', () => {
  eq(API.solatMyUrl('SGR01', 2026), 'https://solat.my/api/yearly/SGR01/2026');
  eq(API.jakimUrl('SGR01', 'year'),
    'https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=year&zone=SGR01');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
