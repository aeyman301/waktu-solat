# Waktu Solat

A static web page that shows Malaysian prayer times for a chosen JAKIM zone and
plays `azan.mp3` automatically when each prayer time arrives. Times come from
JAKIM's official e-Solat API, a whole year per download.

No build step and no runtime dependencies — the page is plain static files.
The `npm` scripts are tooling only (a server, a probe, tests) and pull nothing
in.

## Intended use

**This is built for automated announcer and PA systems** — factories,
warehouses, plants, offices, surau facilities and similar sites where a machine
drives the loudspeakers on a fixed schedule and nobody is watching a screen.

It is not a personal prayer-times app, and it is not a substitute for a muazzin.
The design follows from that:

- It is meant to run unattended on a dedicated machine, browser tab open, audio
  output wired into the PA amplifier.
- Playback is deliberately blunt: the clip starts at the prayer time, at a fixed
  volume, on a fixed set of prayers. There is no fade, no ducking, and no
  interaction with anything else on the site's audio chain.
- Anyone commissioning it should treat it as plant equipment — check the
  schedule, the volume and the output routing on site before leaving it running.

See **Operating notes** below before deploying it on a real system.

## Adding the azan file

Drop your recording at:

```
audio/azan.mp3
```

That exact path is what `index.html` loads. If the file is absent the page still
works and shows a notice under **Tetapan azan** rather than failing silently.

## Running it

```sh
npm start
# then open http://localhost:8000
```

That serves the page **and** relays the prayer-time APIs from the same origin,
which is what stops the browser blocking them — see **CORS, and how to get past
it**. Open the page, expand **Sumber data & diagnostik**, and put this in the
relay field:

```
/api/solat?zone={zone}&year={year}
```

`npm start` needs Node 18 or newer and installs nothing. If the box has Python
instead, `python3 tools/serve.py` does the same job.

Other commands:

```sh
npm test                          # parser tests, no network
npm run probe -- SGR01 2026       # fetch both upstreams and report what came back
npm run probe -- SGR01 2026 --relay http://localhost:8000
```

`npm run probe` is the thing to reach for when the page will not load. It runs
the response through `js/api.js` — the same parser the page uses — so it
answers "the page can read this", not merely "the server replied". It also
reports whether the upstream sent an `Access-Control-Allow-Origin` header.

For a plain static host with no relay, `python3 -m http.server 8000` still
serves the page; whether it can reach the APIs depends on CORS.

## Features

- Zone picker covering all 60 JAKIM zones (JHR01 … WLY02), remembered between visits.
- **Search by town** — type `Sitiawan` and the zone resolves to PRK05, so nobody
  has to know their zone code to commission the thing.
- Live clock, next-prayer countdown, and a progress bar for the current interval.
- Azan plays automatically at Subuh, Zohor, Asar, Maghrib and Isyak, each of
  which can be switched off individually.
- Volume control and a **Uji azan** button.
- Imsak, Syuruk and Dhuha are displayed for reference but never announced.
- Downloads the **whole year** in one request and keeps it in `localStorage`, so
  the schedule is on screen before the network is touched and a later outage
  changes nothing.
- Deep links carry the zone, with an optional display name:
  `index.html?zone=PRK05&name=Kampung%20Gajah`

### Autoplay

Browsers block audio until the page has seen a click, so the first visit shows an
**Aktifkan azan** button. One press unlocks playback for the rest of the session.
The tab has to stay open for the azan to fire — a closed tab runs no timers.

## The API endpoints

Two upstreams, tried in order. Both serve JAKIM's takwim.

```
https://solat.my/api/yearly/SGR01/2026
https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=year&zone=SGR01
```

solat.my has the tidier route and takes the year directly, so it is tried
first. e-Solat is the official source and the fallback; if its yearly request
fails, `month` and then `today` are tried before giving up. Whichever answers
is named in the badge above the schedule.

`js/api.js` is a port of the client in
[farafarizul/myazan](https://github.com/farafarizul/myazan) v0.2.0
(`src/main/services/prayer-time/`), which drives e-Solat from an Electron main
process. The retry policy and validation rules are kept; the transport is
adapted for a browser page.

### Two shapes, one parser

e-Solat's response is documented by its own client, so it is parsed strictly:

```json
{
  "status": "OK!",
  "zone": "SGR01",
  "prayerTime": [
    { "hijri": "1447-03-29", "date": "01-Jan-2026", "day": "Khamis",
      "imsak": "05:47:00", "fajr": "05:57:00", "syuruk": "07:10:00",
      "dhuha": "07:33:00", "dhuhr": "13:17:00", "asr": "16:40:00",
      "maghrib": "19:19:00", "isha": "20:33:00" }
  ]
}
```

**solat.my's shape is not documented, and could not be reached from where this
was written**, so the parser does not assume one. When the strict read does not
fit, it locates the list of days wherever it sits — the payload itself, or
under `data`, `prayerTime`, `waktuSolat` and similar — and matches each day's
fields by name against both the English spellings JAKIM uses (`fajr`, `dhuhr`,
`asr`, `isha`) and the Malay ones a local API is likely to use (`subuh`,
`zohor`, `asar`, `isyak`). Dates are accepted as `01-Jan-2026`, `2026-01-01`,
`01/01/2026` or a Unix timestamp; times as `05:57:00`, `05:57` or `5:57 pm`.

`npm test` pins the e-Solat shape exactly and covers that range for solat.my.
If the real response is none of them, `npm run probe` will print what arrived
and say the parse failed — that output is what to paste into an issue, and
`tools/parser.test.mjs` is where the fix belongs.

A malformed day is skipped rather than failing the whole download: losing one
day out of a year is better than losing the year.

### One download per year

`period=year` returns all ~365 days at once, and the parsed result is cached in
`localStorage`. That is what makes an unattended installation practical:

- The cache is rendered **before** the network is touched, so a machine that
  reboots without a connection still has the schedule on screen immediately.
- Midnight is handled from the cache — no request, because tomorrow was already
  downloaded.
- A failed refresh is not retried more than once every 15 minutes, so a box that
  is offline for a day does not hammer e-Solat.

If the yearly request fails, `month` and then `today` are tried before giving up.
Transport failures are retried three times with exponential backoff (1s, 2s), as
in myazan; a response that arrives but does not validate is not retried.

A malformed day is skipped rather than failing the whole download — losing one
day out of a year is better than losing the year.

### CORS, and how to get past it

Neither upstream sends an `Access-Control-Allow-Origin` header, so a browser
will refuse to let a page on another origin read the response. The request
itself succeeds — open either URL in a tab and the JSON is there — but a
`fetch` from the page is blocked. You will see **Tiada data** above the
schedule and `Failed to fetch` in **Sumber data & diagnostik**.

Nothing written in the page can fix this. The check is the browser's and the
missing header is the server's, so the only real fix is to stop making it a
cross-origin request: **serve the schedule from the same host that serves the
page.**

#### The short way

```sh
npm start
```

Then put this in the relay field and press **Simpan & muat semula**:

```
/api/solat?zone={zone}&year={year}
```

The badge should turn to **Geganti → solat.my · 365 hari**. For e-Solat
instead, use `/api/jakim?zone={zone}&period={period}`.

`tools/serve.mjs` is a static file server plus two routes that fetch upstream
**server-side** and hand the bytes back from the page's own origin.
Server-to-server requests have no CORS to answer to. Node 18+, no dependencies.
`tools/serve.py` is the same thing for a box with Python but no Node.

Neither is a general proxy: the zone must match `^[A-Z]{3}[0-9]{2}$`, the year
must be four digits and the period must be one JAKIM recognises, and the
upstream URL is rebuilt from those values, so a crafted request cannot point it
anywhere else.

#### Confirming it worked

```sh
npm run probe -- SGR01 2026 --relay http://localhost:8000
```

That prints the HTTP result, whether a CORS header was present, and whether the
page's own parser could read the payload.

#### If you already run a web server

Put the relay on the same hostname as the page and the effect is identical.
These are **sketches — they have not been tested here**, unlike the two servers
above; check them against your own setup.

nginx:

```nginx
location /api/solat {
    resolver 1.1.1.1 ipv6=off;
    set $solat "https://solat.my/api/yearly/$arg_zone/$arg_year";
    proxy_pass $solat;
    proxy_ssl_server_name on;
    proxy_set_header Host solat.my;
}
```

Caddy:

```caddy
handle /api/solat* {
    rewrite * /api/yearly/{query.zone}/{query.year}
    reverse_proxy https://solat.my {
        header_up Host solat.my
    }
}
```

Neither validates `zone` and `year` the way the bundled servers do, so do not
expose either to the open internet without adding that.

#### What not to do

A public CORS proxy will work, and it puts a stranger in the path of what your
site announces over its loudspeakers — they see every request, and a bad day
for them is a silent day for you. The year-long cache means an outage is
survivable, but the schedule is still coming from somebody you have no
agreement with. For a PA installation, run your own relay.

There is no `--disable-web-security` option worth taking here either: it turns
the check off for every site that browser visits, on a machine meant to sit
unattended.

#### A different failure that looks the same

If `npm run probe` says **UNREACHABLE**, or prints an HTTP 403 whose body
mentions an allowlist, that is not CORS — it is the network the machine is on
refusing to route to the host at all. CORS is a browser rule and never affects
a command-line fetch, so a probe that cannot connect is a firewall, proxy or
DNS problem. Fix that before touching the relay.

## Finding a zone

A JAKIM zone code is not something anyone knows offhand, but the town is, so the
top bar takes a place name:

```
Sitiawan          -> PRK05
kota kinabalu     -> SBH07     (case does not matter)
Seremb            -> NGS03     (unambiguous prefixes work)
TRG04             -> TRG04     (a code typed straight in)
```

The list of towns is `js/locations.js`, built from
[`waktu.solat.my/api/locations`](https://waktu.solat.my/api/locations) and
bundled as a static file — it changes about as often as district boundaries do,
and the page should not need a second network dependency to populate a dropdown.

A town that maps to more than one zone is not guessed at. There is a Terusan in
both Sabah (SBH02) and Sarawak (SWK01), so typing `Terusan` alone changes
nothing; pick `Terusan — SWK01` from the suggestions instead. Every suggestion
carries its zone code for that reason.

### A discrepancy worth knowing about

The two sources used here disagree about **Rompin, Pahang**:

| Source | Says |
| --- | --- |
| myazan v0.2.0 (`006_fix_zone_seeder.sql`) | `PHG07` — Rompin, Endau, Pontian |
| `waktu.solat.my/api/locations` | Rompin is in `PHG02`, and no `PHG07` exists |

`PHG07` is currently kept in `js/zones.js` and the town search sends Rompin to
`PHG02`, which is the conservative pairing — nobody lands on a zone that might
not exist unless they pick it deliberately. **This has not been confirmed
against JAKIM.** Opening

```
https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=today&zone=PHG07
```

settles it: prayer times back means `PHG07` is real and Rompin's entry in the
town search should move to it; a non-OK status means `PHG07` should come out of
the zone list. If you run a PA system anywhere near Rompin, check this before
trusting the schedule.

## Operating notes

For an unattended PA installation, the things that actually bite:

- **The tab must stay open.** A closed tab runs no timers, so nothing fires.
  Disable sleep, screen lock and automatic browser updates on the host machine,
  and check the tab is still alive after any reboot.
- **Audio must be unlocked once per session.** Browsers block playback until the
  page has seen a click, so after any restart someone has to press
  **Aktifkan azan** once. Use the **Uji azan** button to confirm the signal
  reaches the speakers before walking away.
- **The 90-second window is intentional.** A prayer whose time passed while the
  machine was down will not play late — it is skipped. This prevents an azan
  going out over the floor at an arbitrary hour after a power cut.
- **System clock matters.** Times are matched against the host's local clock, so
  keep it on NTP and in the correct timezone.
- **Volume is set in the page, not just the amplifier.** The slider persists
  between visits; confirm both it and the amp gain after any maintenance.
- **The relay is part of the installation.** If you fixed CORS with
  `npm start` or a proxy in your web server, that process has to be
  running for the page to refresh — put it behind systemd, or whatever keeps
  services up on that box, rather than a terminal someone can close. The cached
  year means a stopped relay is not noticed for months, which is exactly why it
  should be supervised.
- **The cached year runs out.** The page refreshes itself and will pick up the
  next year on its own while it has a connection. A machine that has been
  offline across 1 January has no times for the new year: the badge above the
  schedule reads **Simpanan (lapuk)**, which is the signal to get it back on the
  network. Check that badge reads **JAKIM** after any long outage.

## Accuracy

Times come from JAKIM's e-Solat API, which is the official source. Confirm
the schedule against the local mosque or the relevant state religious authority
before putting it on a PA system — an automated announcer that is wrong is wrong
in front of the whole site, and the operator is responsible for what it plays.
