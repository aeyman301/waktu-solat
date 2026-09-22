/*
 * Client for JAKIM's official e-Solat API.
 *
 *   https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=year&zone=WLY01
 *
 * Ported from farafarizul/myazan v0.2.0 (`src/main/services/prayer-time/`),
 * which drives the same endpoint from an Electron main process. The request and
 * validation rules are kept; the transport is adapted for a browser page.
 *
 * Response shape:
 *
 *   {
 *     "status": "OK!",
 *     "zone": "WLY01",
 *     "bearing": "292&deg; 31&acute;",
 *     "prayerTime": [
 *       { "hijri": "1447-03-29", "date": "01-Jan-2026", "day": "Khamis",
 *         "imsak": "05:47:00", "fajr": "05:57:00", "syuruk": "07:10:00",
 *         "dhuha": "07:33:00", "dhuhr": "13:17:00", "asr": "16:40:00",
 *         "maghrib": "19:19:00", "isha": "20:33:00" },
 *       ...
 *     ]
 *   }
 *
 * `period=year` returns the whole year in one response, which is what makes an
 * unattended installation practical: one successful fetch covers twelve months,
 * and the parsed result is cached so a later network outage changes nothing.
 */
window.JakimAPI = (function () {
  "use strict";

  var JAKIM_BASE =
    "https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat";

  var CUSTOM_KEY = "waktu-solat.apiUrl";

  var TIMEOUT_MS = 30000;   // myazan uses 30s; the yearly payload is not small.
  var MAX_ATTEMPTS = 3;
  var BASE_DELAY_MS = 1000; // doubled per attempt: 1s, 2s

  // Tried in order. A whole year is preferred; the shorter periods exist so a
  // relay that truncates or rejects the large response still yields something.
  var PERIODS = ["year", "month", "today"];

  /* ------------------------------------------------------------------ *
   * Slots
   * ------------------------------------------------------------------ */

  // `key` is what the rest of the app uses; `field` is JAKIM's own name.
  var SLOTS = [
    { key: "imsak",   field: "imsak",   label: "Imsak"   },
    { key: "subuh",   field: "fajr",    label: "Subuh"   },
    { key: "syuruk",  field: "syuruk",  label: "Syuruk"  },
    { key: "dhuha",   field: "dhuha",   label: "Dhuha"   },
    { key: "zohor",   field: "dhuhr",   label: "Zohor"   },
    { key: "asar",    field: "asr",     label: "Asar"    },
    { key: "maghrib", field: "maghrib", label: "Maghrib" },
    { key: "isyak",   field: "isha",    label: "Isyak"   }
  ];

  // A row missing any of these is unusable and is dropped.
  var REQUIRED = ["subuh", "zohor", "asar", "maghrib", "isyak"];

  /* ------------------------------------------------------------------ *
   * Endpoint
   * ------------------------------------------------------------------ */

  /*
   * e-Solat is a government host and does not promise CORS headers, so a page
   * on another origin may not be allowed to read the response even though the
   * request succeeds. An operator who needs a relay puts its URL here; it is
   * tried before the direct call. Placeholders: {zone}, {period}, and {url}
   * for the whole encoded JAKIM URL (what generic CORS relays expect).
   */
  function customTemplate() {
    try {
      var v = localStorage.getItem(CUSTOM_KEY);
      return v && v.trim() ? v.trim() : null;
    } catch (e) {
      return null;
    }
  }

  function setCustomTemplate(url) {
    try {
      if (url && url.trim()) localStorage.setItem(CUSTOM_KEY, url.trim());
      else localStorage.removeItem(CUSTOM_KEY);
    } catch (e) { /* storage unavailable */ }
  }

  function directUrl(zone, period) {
    return JAKIM_BASE +
      "&period=" + encodeURIComponent(period) +
      "&zone=" + encodeURIComponent(zone);
  }

  function expand(template, zone, period) {
    var direct = directUrl(zone, period);
    if (/\{url\}/i.test(template)) {
      return template.replace(/\{url\}/gi, encodeURIComponent(direct));
    }
    return template
      .replace(/\{zone\}/gi, encodeURIComponent(zone))
      .replace(/\{period\}/gi, encodeURIComponent(period));
  }

  /* ------------------------------------------------------------------ *
   * Value parsing
   * ------------------------------------------------------------------ */

  var MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    // Malay spellings, in case the API is queried with lang=ms.
    mei: 4, ogo: 7, ogos: 7, okt: 9, dis: 11
  };

  // "01-Jan-2026" -> { y, m, d }. Returns null when unrecognised.
  function parseJakimDate(raw) {
    if (typeof raw !== "string") return null;
    var parts = raw.trim().split("-");
    if (parts.length !== 3) return null;

    var day = Number(parts[0]);
    var month = MONTHS[parts[1].slice(0, 3).toLowerCase()];
    var year = Number(parts[2]);

    if (!isFinite(day) || day < 1 || day > 31) return null;
    if (month === undefined) return null;
    if (!isFinite(year) || year < 2000 || year > 2999) return null;

    return { y: year, m: month, d: day };
  }

  // "05:57:00" or "05:57" -> { h, m, s }. Returns null when unrecognised.
  var TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

  function parseJakimTime(raw) {
    if (typeof raw !== "string") return null;
    var m = TIME_RE.exec(raw.trim());
    if (!m) return null;

    var h = Number(m[1]);
    var min = Number(m[2]);
    var s = m[3] ? Number(m[3]) : 0;

    if (h > 23 || min > 59 || s > 59) return null;
    return { h: h, m: min, s: s };
  }

  /* ------------------------------------------------------------------ *
   * Normalisation
   * ------------------------------------------------------------------ */

  /*
   * Turns one API row into { date, hijri, day, zone, times } with real Date
   * objects pinned to that row's day, or null when the row is unusable.
   *
   * myazan aborts the whole parse on a bad row. Here a bad row is skipped
   * instead: on an unattended machine, losing one day of a yearly download is
   * far better than losing the download.
   */
  function parseEntry(entry, zone) {
    if (!entry || typeof entry !== "object") return null;

    var ymd = parseJakimDate(entry.date);
    if (!ymd) return null;

    var times = {};
    SLOTS.forEach(function (slot) {
      var t = parseJakimTime(entry[slot.field]);
      if (t) {
        times[slot.key] = new Date(ymd.y, ymd.m, ymd.d, t.h, t.m, t.s);
      }
    });

    for (var i = 0; i < REQUIRED.length; i++) {
      if (!times[REQUIRED[i]]) return null;
    }

    return {
      date: new Date(ymd.y, ymd.m, ymd.d),
      hijri: typeof entry.hijri === "string" && entry.hijri.trim() ? entry.hijri.trim() : null,
      day: typeof entry.day === "string" && entry.day.trim() ? entry.day.trim() : null,
      zone: zone || null,
      times: times
    };
  }

  function dayKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /**
   * Validate an e-Solat payload and return sorted, de-duplicated day records.
   * Throws when the payload is not a usable e-Solat response.
   */
  function normalise(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("Respons bukan objek JSON yang sah");
    }

    // JAKIM answers "OK!" on success and e.g. "Failed!" on a bad zone.
    var status = typeof payload.status === "string" ? payload.status.trim() : "";
    if (status && !/^ok/i.test(status)) {
      throw new Error("API JAKIM memulangkan status “" + status + "”");
    }

    var rows = payload.prayerTime;
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error("Respons tiada senarai “prayerTime”");
    }

    var zone = typeof payload.zone === "string" ? payload.zone.trim() : null;

    var days = [];
    var seen = {};
    var skipped = 0;

    for (var i = 0; i < rows.length; i++) {
      var rec = parseEntry(rows[i], zone);
      if (!rec) { skipped++; continue; }

      var k = dayKey(rec.date);
      if (seen[k]) continue;
      seen[k] = true;
      days.push(rec);
    }

    if (!days.length) {
      throw new Error("Tiada rekod waktu solat yang sah dalam respons");
    }

    days.sort(function (a, b) { return a.date - b.date; });
    days.skipped = skipped;
    return days;
  }

  /* ------------------------------------------------------------------ *
   * Fetching
   * ------------------------------------------------------------------ */

  function getJSON(url) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS)
      : null;

    return fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller ? controller.signal : undefined,
      cache: "no-store",
      redirect: "follow"
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    }).then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        // e-Solat serves an HTML error page when it is unhappy with a request.
        throw new Error("Respons bukan JSON");
      }
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /*
   * One URL, retried on transport failures only. A response that arrives but
   * does not parse is a real answer and is not worth repeating (myazan draws
   * the same line between JakimNetworkError and JakimApiError).
   */
  function fetchWithRetry(url) {
    var attempt = 0;

    function go() {
      attempt++;
      return getJSON(url).then(function (payload) {
        return { days: normalise(payload), raw: payload };
      }).catch(function (err) {
        var transport = err instanceof TypeError ||
          err.name === "AbortError" ||
          /^HTTP 5/.test(err.message);

        if (transport && attempt < MAX_ATTEMPTS) {
          return sleep(BASE_DELAY_MS * Math.pow(2, attempt - 1)).then(go);
        }
        throw err;
      });
    }

    return go();
  }

  /**
   * Resolves to { days, raw, url, zone, period, via }.
   *
   * `days` is sorted ascending; each entry is { date, hijri, day, zone, times }
   * where `times` maps a slot key to a Date on that day.
   */
  function load(zone) {
    var custom = customTemplate();
    var attempts = [];

    PERIODS.forEach(function (period) {
      if (custom) attempts.push({ url: expand(custom, zone, period), period: period, via: "custom" });
      attempts.push({ url: directUrl(zone, period), period: period, via: "jakim" });
    });

    var errors = [];
    var step = 0;

    function next() {
      if (step >= attempts.length) {
        var e = new Error(errors.join(" · ") || "Tiada respons");
        e.attempts = errors;
        throw e;
      }

      var a = attempts[step++];

      return fetchWithRetry(a.url).then(function (res) {
        return {
          days: res.days, raw: res.raw,
          url: a.url, zone: zone, period: a.period, via: a.via
        };
      }).catch(function (err) {
        errors.push(a.period + " (" + a.via + "): " + err.message);
        return next();
      });
    }

    return Promise.resolve().then(next);
  }

  return {
    load: load,
    normalise: normalise,
    parseJakimDate: parseJakimDate,
    parseJakimTime: parseJakimTime,
    customTemplate: customTemplate,
    setCustomTemplate: setCustomTemplate,
    directUrl: directUrl,
    SLOTS: SLOTS,
    BASE: JAKIM_BASE
  };
})();
