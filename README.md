# Waktu Solat Malaysia (Azan) — Windows 7+ desktop app

A lightweight Windows desktop app that shows official JAKIM prayer times for all
Malaysian zones and plays the azan at prayer time. Built with plain C#/.NET
Framework 4.x — no Visual Studio, no NuGet, no runtime dependencies beyond the
.NET Framework 4 that Windows 7 SP1 can install.

## Intended use

**This is built for automated announcer and PA systems** — factories,
warehouses, plants, offices, facilities and similar sites where a machine drives
the loudspeakers on a fixed schedule and nobody is watching a screen.

It is meant to run unattended on a dedicated machine: the app starts minimized
to the tray (optionally with Windows), keeps an offline cache of the prayer
schedule, and plays the azan through the machine's audio output at each prayer
time — wire that output into the PA amplifier.

It is not a personal prayer-times app, and it is not a substitute for a
muazzin. Before commissioning it on a real system, treat it as plant equipment:
verify the zone, the azan sound files, the volume and the output routing on
site before leaving it running.

## API used (JAKIM via waktusolat.app)

```
curl https://api.waktusolat.app/zones
curl "https://api.waktusolat.app/v2/solat/SGR01?year=2026&month=10"
```

- `/zones` — list of JAKIM zones (`jakimCode`, `negeri`, `daerah`)
- `/v2/solat/{zone}?year=&month=` — one month of times as Unix seconds in
  Malaysia time (UTC+8): `imsak, fajr, syuruk, dhuha, dhuhr, asr, maghrib, isha`
  plus the Hijri date.

## Build

On any Windows 7+ machine with .NET Framework 4 (preinstalled on Win8+):

```
build.bat
```

This uses the in-box `csc.exe` compiler and produces:

- `out\AzanMalaysia.exe` — the app (portable, single file)
- `out\AzanMalaysia.selftest.exe` — console build for `--selftest`

## Self-test

```
out\AzanMalaysia.selftest.exe --selftest
```

Verifies: live `/zones` call, live month call + parse, prayer-time ordering,
UTC+8 conversion against a known timestamp, next-prayer scheduling logic, URL
builder, and settings parsing.

## Features

- Full month prayer-time grid (Hijri + all 8 daily times), today highlighted
- Zone picker grouped by state/district (from `/zones`)
- Next-prayer countdown in the window, title and tray tooltip
- Azan playback at prayer time + popup notification + tray balloon
- **Two azan sounds**: a general azan file for all prayers and a dedicated
  **azan Subuh** file (Subuh recitation differs) — MP3, WAV, WMA, M4A, MIDI via
  Windows MCI; falls back general → system chime if a file is missing
- 30-second warning beep before each time (optional)
- Works offline: responses are cached in `%LocalAppData%\AzanMalaysia\cache`
- Custom azan sounds: **Pilih azan...** (all prayers) and **Pilih azan Subuh...**
  (Subuh only); the chosen files are referenced by path and stored in
  `%LocalAppData%\AzanMalaysia\settings.txt` — "X" clears the Subuh file
- Start minimized to tray; close (X) hides to tray; real exit from tray menu
- Optional auto-start with Windows (HKCU Run key, no admin needed)
- Single-instance guard

## Notes

- Prayer names follow Malaysian usage: Subuh, Syuruk, Zohor, Asar, Maghrib, Isyak.
- Timestamps are treated as UTC+8 wall-clock values (converted to UTC internally
  by subtracting 8 hours) so they display correctly on any PC time zone.
- Settings are stored in `%LocalAppData%\AzanMalaysia\settings.txt`.
