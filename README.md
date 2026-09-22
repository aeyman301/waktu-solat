# Waktu Solat

A static web page that shows Malaysian prayer times for a chosen JAKIM zone and
plays `azan.mp3` automatically when each prayer time arrives. Times come from
JAKIM's official e-Solat API, a whole year per download.

No build step, no dependencies — open `index.html` or serve the folder.

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
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight off disk mostly works, but a local server is
better: `file://` pages are treated as an opaque origin, so the request to
e-Solat is more likely to be blocked. See **CORS** below.

It is plain static files, so GitHub Pages, Netlify, Vercel or any web host will
serve it as-is.

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

## The API endpoint

The page reads JAKIM's official e-Solat API directly:

```
https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=year&zone=WLY01
```

`js/api.js` is a port of the client in
[farafarizul/myazan](https://github.com/farafarizul/myazan) v0.2.0
(`src/main/services/prayer-time/`), which drives the same endpoint from an
Electron main process. The request shape, the retry policy and the validation
rules are kept; the transport is adapted for a browser page.

The response looks like this:

```json
{
  "status": "OK!",
  "zone": "WLY01",
  "prayerTime": [
    { "hijri": "1447-03-29", "date": "01-Jan-2026", "day": "Khamis",
      "imsak": "05:47:00", "fajr": "05:57:00", "syuruk": "07:10:00",
      "dhuha": "07:33:00", "dhuhr": "13:17:00", "asr": "16:40:00",
      "maghrib": "19:19:00", "isha": "20:33:00" }
  ]
}
```

JAKIM's field names are English (`fajr`, `dhuhr`, `asr`, `isha`); the page
displays the Malay ones (Subuh, Zohor, Asar, Isyak).

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

### CORS

This is the one thing to check before deploying. e-Solat is a government host
and makes no promise about `Access-Control-Allow-Origin`, so a browser on
another origin may be refused the response even though the request itself
succeeds. Open **Sumber data & diagnostik** at the bottom of the page: it shows
which URL answered and the raw JSON.

If the browser blocks the direct call, put your own relay in the field there. It
is tried **before** the direct call, and is saved locally. Placeholders:

| Placeholder | Becomes |
| --- | --- |
| `{url}` | the whole JAKIM URL, percent-encoded |
| `{zone}` | the zone code, e.g. `WLY01` |
| `{period}` | `year`, `month` or `today` |

```
https://your-relay.example/fetch?url={url}
```

A relay is a few lines in front of your own web server — it just has to forward
the request and add the CORS header. Serving the page and the relay from the
same origin avoids the problem entirely. Think twice before pointing this at a
public CORS proxy: it puts a third party in the path of what your site
announces over its speakers.

## Layout

```
index.html        markup
css/styles.css    styling, light and dark
js/zones.js       JAKIM zone codes by state (all 60)
js/locations.js   town -> zone, for the search box
js/api.js         JAKIM e-Solat client: fetch, retry, validate, normalise
js/audio.js       azan playback and autoplay unlocking
js/app.js         rendering, countdown, azan scheduler
audio/azan.mp3    your recording (not included)
```

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
