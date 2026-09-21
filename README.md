# Waktu Solat

A static web page that shows Malaysian prayer times for a chosen JAKIM zone and
plays `azan.mp3` automatically when each prayer time arrives.

No build step, no dependencies — open `index.html` or serve the folder.

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

## Accuracy

Times come from the upstream API, which sources JAKIM's e-Solat data. Confirm
against a local mosque before relying on this for anything important.
