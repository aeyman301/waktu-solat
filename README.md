# Waktu Solat

A static web page that shows Malaysian prayer times for a chosen JAKIM zone and
plays `azan.mp3` automatically when each prayer time arrives.

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
better: `file://` pages are treated as an opaque origin, so the API request is
more likely to be blocked.

It is plain static files, so GitHub Pages, Netlify, Vercel or any web host will
serve it as-is.

## Features

- Zone picker covering all JAKIM zones (JHR01 … WLY02), remembered between visits.
- Live clock, next-prayer countdown, and a progress bar for the current interval.
- Azan plays automatically at Subuh, Zohor, Asar, Maghrib and Isyak, each of
  which can be switched off individually.
- Volume control and a **Uji azan** button.
- Imsak, Syuruk and Dhuha are displayed for reference but never announced.
- Falls back to the last successful response (cached in `localStorage`) when the
  API cannot be reached.
- Deep links in the same shape as solat.my work:
  `index.html?zone=PRK05&name=Kampung%20Gajah`

### Autoplay

Browsers block audio until the page has seen a click, so the first visit shows an
**Aktifkan azan** button. One press unlocks playback for the rest of the session.
The tab has to stay open for the azan to fire — a closed tab runs no timers.

## The API endpoint

The page reads from solat.my / waktu.solat.my. That endpoint has no published
schema, so rather than hard-coding one shape `js/api.js`:

1. tries a list of candidate URLs, starting with
   `https://solat.my/api/daily/{zone}`, and keeps the first that returns usable
   JSON (remembered in `localStorage` for next time);
2. normalises whatever comes back — it walks the response and picks up any
   object carrying at least three prayer-time fields.

The normaliser recognises both English and Malay field names (`fajr`/`subuh`,
`dhuhr`/`zohor`, `asr`/`asar`, `isha`/`isyak`, …) and accepts `"05:55"`,
`"5:55 am"`, `"2026-09-21T05:55:00"` and Unix timestamps. It handles a single
day or a whole month in one response.

**If the times look wrong or nothing loads**, open **Sumber data & diagnostik**
at the bottom of the page. It shows the URL that answered and the raw JSON, and
lets you paste the correct endpoint directly — use `{zone}` where the zone code
belongs, for example:

```
https://solat.my/api/daily/{zone}
```

A pasted URL is tried before every built-in guess and is saved locally.

### CORS

The API has to send `Access-Control-Allow-Origin` for a browser page to read it.
If the network tab shows a CORS error, the endpoint is reachable but not
configured for cross-origin use — that needs a small proxy of your own, which
you can then paste into the same field.

## Layout

```
index.html        markup
css/styles.css    styling, light and dark
js/zones.js       JAKIM zone codes by state
js/api.js         endpoint probing + response normalisation
js/audio.js       azan playback and autoplay unlocking
js/app.js         rendering, countdown, azan scheduler
audio/azan.mp3    your recording (not included)
```

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

## Accuracy

Times come from the upstream API, which sources JAKIM's e-Solat data. Confirm
the schedule against the local mosque or the relevant state religious authority
before putting it on a PA system — an automated announcer that is wrong is wrong
in front of the whole site, and the operator is responsible for what it plays.
