/*
 * Prayer-time client.
 *
 * Two upstreams, tried in order:
 *
 *   solat.my      https://solat.my/api/yearly/SGR01/2026
 *   JAKIM e-Solat https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat&period=year&zone=SGR01
 *
 * Both serve JAKIM's data; solat.my has the tidier route and takes the year
 * directly, e-Solat is the primary source and the fallback. The fetch and
 * validation rules are ported from farafarizul/myazan v0.2.0
 * (`src/main/services/prayer-time/`), which drives e-Solat from an Electron
 * main process; the transport is adapted for a browser page.
 *
 * e-Solat's shape is known and is parsed strictly:
 *
 *   { "status": "OK!", "zone": "SGR01",
 *     "prayerTime": [ { "date": "01-Jan-2026", "hijri": "...",
 *                       "imsak": "05:47:00", "fajr": "05:57:00", ... } ] }
 *
 * solat.my's is not documented, so when the strict parse does not fit, the
 * payload is read tolerantly instead: the list of days is located wherever it
 * sits, and each day's fields are matched by name against both the English
 * spellings JAKIM uses (fajr, dhuhr, asr, isha) and the Malay ones a local API
 * is likely to use (subuh, zohor, asar, isyak). That keeps one parser honest
 * about what it knows and still able to read a response nobody has specified.
 */
window.SolatAPI = (function () {
  "use strict";

  var JAKIM_BASE =
    "https://www.e-solat.gov.my/index.php?r=esolatApi/takwimsolat";
  var SOLATMY_BASE = "https://solat.my/api/yearly";

  var CUSTOM_KEY = "waktu-solat.apiUrl";

  var TIMEOUT_MS = 30000;   // myazan uses 30s; a yearly payload is not small.
  var MAX_ATTEMPTS = 3;
  var BASE_DELAY_MS = 1000; // doubled per attempt: 1s, 2s

  /* ------------------------------------------------------------------ *
   * Slots
   * ------------------------------------------------------------------ */

  // `key` is what the rest of the app uses. `aliases` are canonicalised field
  // names (lowercase, letters only) that map onto it.
  var SLOTS = [
    { key: "imsak",   label: "Imsak",
      aliases: ["imsak"] },
    { key: "subuh",   label: "Subuh",
      aliases: ["fajr", "subuh", "subh", "fajar", "shubuh", "suboh"] },
    { key: "syuruk",  label: "Syuruk",
      aliases: ["syuruk", "syuruq", "shuruk", "shuruq", "sunrise", "terbit"] },
    { key: "dhuha",   label: "Dhuha",
      aliases: ["dhuha", "duha"] },
    { key: "zohor",   label: "Zohor",
      aliases: ["dhuhr", "zohor", "zuhr", "zuhur", "dzuhur", "zohar"] },
    { key: "asar",    label: "Asar",
      aliases: ["asr", "asar", "ashar", "ashr"] },
    { key: "maghrib", label: "Maghrib",
      aliases: ["maghrib", "magrib", "maghribi", "sunset"] },
    { key: "isyak",   label: "Isyak",
      aliases: ["isha", "isyak", "isya", "ishak", "ishaa", "eshaa", "isyaa"] }
  ];

  // A day missing any of these is unusable and is dropped.
  var REQUIRED = ["subuh", "zohor", "asar", "maghrib", "isyak"];

  var DATE_ALIASES  = ["date", "tarikh", "gregorian", "masihi", "miladi", "tarikhmasihi"];
  var HIJRI_ALIASES = ["hijri", "hijrah", "tarikhhijri", "islamicdate", "hijridate"];

  // Where a list of days is usually found when it is not the payload itself.
  var LIST_KEYS = ["prayertime", "prayertimes", "waktusolat", "data", "times",
                   "result", "results", "records", "days", "schedule", "items"];

  /* ------------------------------------------------------------------ *
   * Endpoint
   * ------------------------------------------------------------------ */

  /*
   * Neither upstream promises CORS headers, so a page on another origin may be
   * refused the response even though the request succeeds. An operator who
   * needs a relay puts its URL here and it is tried before each direct call.
   * Placeholders: {zone}, {year}, {period}, and {url} for the whole encoded
   * upstream URL, which is what generic relays expect.
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

  function solatMyUrl(zone, year) {
    return SOLATMY_BASE + "/" + encodeURIComponent(zone) + "/" + encodeURIComponent(year);
  }

  function jakimUrl(zone, period) {
    return JAKIM_BASE +
      "&period=" + encodeURIComponent(period) +
      "&zone=" + encodeURIComponent(zone);
  }

  function expand(template, ctx) {
    if (/\{url\}/i.test(template)) {
      return template.replace(/\{url\}/gi, encodeURIComponent(ctx.url));
    }
    return template
      .replace(/\{zone\}/gi, encodeURIComponent(ctx.zone))
      .replace(/\{year\}/gi, encodeURIComponent(ctx.year))
      .replace(/\{period\}/gi, encodeURIComponent(ctx.period));
  }

  /* ------------------------------------------------------------------ *
   * Field matching
   * ------------------------------------------------------------------ */

  function canon(k) {
    return String(k).toLowerCase().replace(/[^a-z]/g, "");
  }

  /* Builds { canonicalKey: value } once per record, so each lookup is cheap. */
  function flatten(obj) {
    var map = {};
    Object.keys(obj).forEach(function (k) {
      var c = canon(k);
      if (!(c in map)) map[c] = obj[k];
    });
    return map;
  }

  function pick(map, aliases) {
    for (var i = 0; i < aliases.length; i++) {
      var v = map[aliases[i]];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  }

  /* ------------------------------------------------------------------ *
   * Value parsing
   * ------------------------------------------------------------------ */

  var MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    // Malay spellings, for an API queried with lang=ms.
    mei: 4, ogo: 7, ogos: 7, okt: 9, dis: 11, julai: 6, jun2: 5
  };

  /* Returns { y, m, d } or null. Handles the formats these APIs actually use. */
  function parseDate(raw) {
    if (raw === null || raw === undefined) return null;

    // Unix timestamp, seconds or milliseconds.
    if (typeof raw === "number" && raw >= 1e9) {
      var e = new Date(raw >= 1e12 ? raw : raw * 1000);
      return isNaN(e.getTime())
        ? null
        : { y: e.getFullYear(), m: e.getMonth(), d: e.getDate() };
    }

    var str = String(raw).trim();
    if (!str) return null;

    // "01-Jan-2026" — e-Solat's own format.
    var named = str.match(/^(\d{1,2})[-\s\/]([A-Za-z]{3,})[-\s\/](\d{4})/);
    if (named) {
      var mo = MONTHS[named[2].slice(0, 3).toLowerCase()];
      if (mo !== undefined) return ymd(Number(named[3]), mo, Number(named[1]));
    }

    // "2026-01-01" or "2026-01-01T00:00:00"
    var iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return ymd(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

    // "01/01/2026" — day first, which is the Malaysian convention.
    var dmy = str.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
    if (dmy) return ymd(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));

    return null;
  }

  function ymd(y, m, d) {
    if (!isFinite(y) || y < 2000 || y > 2999) return null;
    if (!isFinite(m) || m < 0 || m > 11) return null;
    if (!isFinite(d) || d < 1 || d > 31) return null;
    return { y: y, m: m, d: d };
  }

  var TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i;

  /* Returns { h, m, s } or null. Accepts "05:57:00", "5:57", "5:57 pm". */
  function parseTime(raw) {
    if (raw === null || raw === undefined) return null;

    // Some APIs give a full timestamp per prayer rather than a clock time.
    if (typeof raw === "number" && raw >= 1e9) {
      var e = new Date(raw >= 1e12 ? raw : raw * 1000);
      return isNaN(e.getTime())
        ? null
        : { h: e.getHours(), m: e.getMinutes(), s: e.getSeconds() };
    }

    var str = String(raw).trim();
    if (!str) return null;

    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(str)) {
      var d = new Date(str.replace(" ", "T"));
      if (!isNaN(d.getTime())) {
        return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
      }
    }

    var m = TIME_RE.exec(str);
    if (!m) return null;

    var h = Number(m[1]);
    var min = Number(m[2]);
    var s = m[3] ? Number(m[3]) : 0;
    var mer = m[4] ? m[4].toLowerCase().replace(/\./g, "") : "";

    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;

    if (h > 23 || min > 59 || s > 59) return null;
    return { h: h, m: min, s: s };
  }

  /* ------------------------------------------------------------------ *
   * Normalisation
   * ------------------------------------------------------------------ */

  /*
   * Locates the list of day records. Checks the conventional key names first,
   * then walks shallowly for the first array whose entries look like days —
   * bounded, so a large payload cannot turn this into a deep search.
   */
  function findList(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return null;

    var map = flatten(payload);
    for (var i = 0; i < LIST_KEYS.length; i++) {
      var v = map[LIST_KEYS[i]];
      if (Array.isArray(v) && v.length) return v;
    }

    var queue = [payload];
    for (var depth = 0; depth < 3 && queue.length; depth++) {
      var next = [];
      for (var q = 0; q < queue.length; q++) {
        var node = queue[q];
        if (!node || typeof node !== "object") continue;
        var keys = Object.keys(node);
        for (var k = 0; k < keys.length; k++) {
          var val = node[keys[k]];
          if (Array.isArray(val) && val.length && looksLikeDay(val[0])) return val;
          if (val && typeof val === "object") next.push(val);
        }
      }
      queue = next;
    }
    return null;
  }

  /* Three recognisable prayer times is enough to call something a day. */
  function looksLikeDay(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
    var map = flatten(obj);
    var hits = 0;
    for (var i = 0; i < SLOTS.length; i++) {
      if (parseTime(pick(map, SLOTS[i].aliases))) hits++;
      if (hits >= 3) return true;
    }
    return false;
  }

  /* One record -> { date, hijri, day, zone, times }, or null if unusable. */
  function parseEntry(entry, zone) {
    if (!entry || typeof entry !== "object") return null;

    var map = flatten(entry);
    var date = parseDate(pick(map, DATE_ALIASES));
    if (!date) return null;

    var times = {};
    SLOTS.forEach(function (slot) {
      var t = parseTime(pick(map, slot.aliases));
      if (t) times[slot.key] = new Date(date.y, date.m, date.d, t.h, t.m, t.s);
    });

    for (var i = 0; i < REQUIRED.length; i++) {
      if (!times[REQUIRED[i]]) return null;
    }

    var hijri = pick(map, HIJRI_ALIASES);
    var label = map.day;

    return {
      date: new Date(date.y, date.m, date.d),
      hijri: typeof hijri === "string" && hijri.trim() ? hijri.trim() : null,
      day: typeof label === "string" && label.trim() ? label.trim() : null,
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
   * Validate a payload and return sorted, de-duplicated day records.
   * Throws when it holds no usable prayer times.
   */
  function normalise(payload) {
    if (!payload || (typeof payload !== "object")) {
      throw new Error("Respons bukan objek JSON yang sah");
    }

    // e-Solat reports failure in-band with a 200, so trust `status` when the
    // payload carries one. solat.my may not; absence is not an error.
    var status = (payload && typeof payload.status === "string")
      ? payload.status.trim() : "";
    if (status && !/^ok/i.test(status) && !/^(true|success|1)$/i.test(status)) {
      throw new Error("API memulangkan status “" + status + "”");
    }

    var rows = findList(payload);
    if (!rows) throw new Error("Tiada senarai waktu solat dalam respons");

    var zone = (payload && typeof payload.zone === "string") ? payload.zone.trim() : null;

    var days = [];
    var seen = {};
    var skipped = 0;

    for (var i = 0; i < rows.length; i++) {
      var rec = parseEntry(rows[i], zone);
      // A malformed day is dropped, not fatal: losing one day out of a yearly
      // download is better than losing the year.
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
        // Both upstreams serve an HTML error page when they are unhappy.
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
   * does not parse is a real answer and not worth repeating — the same line
   * myazan draws between JakimNetworkError and JakimApiError.
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

  /* The upstreams to try, best first. */
  function plan(zone, year) {
    return [
      { via: "solat.my", label: "yearly", url: solatMyUrl(zone, year), period: "year" },
      { via: "JAKIM",    label: "year",   url: jakimUrl(zone, "year"),  period: "year" },
      { via: "JAKIM",    label: "month",  url: jakimUrl(zone, "month"), period: "month" },
      { via: "JAKIM",    label: "today",  url: jakimUrl(zone, "today"), period: "today" }
    ];
  }

  /**
   * Resolves to { days, raw, url, zone, year, via, label }.
   *
   * `days` is sorted ascending; each entry is { date, hijri, day, zone, times }
   * where `times` maps a slot key to a Date on that day.
   */
  function load(zone, year) {
    year = year || new Date().getFullYear();

    var custom = customTemplate();
    var attempts = [];

    plan(zone, year).forEach(function (src) {
      if (custom) {
        attempts.push({
          url: expand(custom, { zone: zone, year: year, period: src.period, url: src.url }),
          via: "Geganti → " + src.via, label: src.label
        });
      }
      attempts.push({ url: src.url, via: src.via, label: src.label });
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
          days: res.days, raw: res.raw, url: a.url,
          zone: zone, year: year, via: a.via, label: a.label
        };
      }).catch(function (err) {
        errors.push(a.via + " " + a.label + ": " + err.message);
        return next();
      });
    }

    return Promise.resolve().then(next);
  }

  return {
    load: load,
    normalise: normalise,
    parseDate: parseDate,
    parseTime: parseTime,
    customTemplate: customTemplate,
    setCustomTemplate: setCustomTemplate,
    solatMyUrl: solatMyUrl,
    jakimUrl: jakimUrl,
    SLOTS: SLOTS,
    JAKIM_BASE: JAKIM_BASE,
    SOLATMY_BASE: SOLATMY_BASE
  };
})();

/* The app referred to this as JakimAPI while e-Solat was the only source. */
window.JakimAPI = window.SolatAPI;
