/*
 * Client for https://waktu.solat.my/api
 *
 * The public schema for this endpoint is not formally documented, so instead of
 * hard-coding one shape we probe a handful of conventional URL patterns and then
 * normalise whatever JSON comes back. The normaliser walks the response and
 * recognises any object that carries at least three prayer-time-looking keys,
 * which covers the JAKIM e-Solat shape (`{ prayerTime: [{ fajr, dhuhr, ... }] }`)
 * as well as the flatter `{ data: { subuh, zohor, ... } }` variants.
 */
window.SolatAPI = (function () {
  "use strict";

  var BASE = "https://waktu.solat.my/api";
  var TIMEOUT_MS = 12000;
  var ENDPOINT_CACHE_KEY = "waktu-solat.endpoint";
  var CUSTOM_KEY = "waktu-solat.apiUrl";

  // Ordered so the most conventional patterns are tried first. The list mixes
  // waktu.solat.my and solat.my because the exact route is not documented; the
  // one that answers with usable JSON is remembered for subsequent loads.
  var TEMPLATES = [
    "https://solat.my/api/daily/{zone}",
    "https://solat.my/api/monthly/{zone}",
    BASE + "/daily/{zone}",
    BASE + "?zon={zone}",
    BASE + "?zone={zone}",
    BASE + "/{zone}",
    BASE + "/zone/{zone}",
    BASE + "/zon/{zone}",
    BASE + "/solat/{zone}",
    BASE + "/waktusolat/{zone}",
    BASE + "/v1/zone/{zone}",
    "https://solat.my/api?zone={zone}",
    "https://solat.my/api/{zone}",
    "https://solat.my/api/zone/{zone}",
    "https://solat.my/api/solat/{zone}",
    "https://solat.my/?zone={zone}&format=json",
    BASE
  ];

  function expand(template, zone) {
    return template.replace(/\{zone\}/gi, encodeURIComponent(zone));
  }

  /* A URL the user pasted in the UI takes priority over every guess. */
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
      localStorage.removeItem(ENDPOINT_CACHE_KEY);
    } catch (e) { /* storage unavailable */ }
  }

  /* ------------------------------------------------------------------ *
   * Key matching
   * ------------------------------------------------------------------ */

  // Listed in display order; the first alias that yields a valid time wins.
  var SLOTS = [
    { key: "imsak",   label: "Imsak",   aliases: ["imsak"] },
    { key: "subuh",   label: "Subuh",   aliases: ["subuh", "fajr", "fajar", "subh", "shubuh", "dawn"] },
    { key: "syuruk",  label: "Syuruk",  aliases: ["syuruk", "syuruq", "shuruk", "shuruq", "terbit", "sunrise"] },
    { key: "dhuha",   label: "Dhuha",   aliases: ["dhuha", "duha"] },
    { key: "zohor",   label: "Zohor",   aliases: ["zohor", "zuhr", "dhuhr", "zuhur", "dzuhur", "zohar", "noon"] },
    { key: "asar",    label: "Asar",    aliases: ["asar", "asr", "ashar", "ashr"] },
    { key: "maghrib", label: "Maghrib", aliases: ["maghrib", "magrib", "maghribi", "sunset"] },
    { key: "isyak",   label: "Isyak",   aliases: ["isyak", "isyaa", "isya", "ishak", "isha", "ishaa", "eshaa"] }
  ];

  var DATE_ALIASES = ["date", "tarikh", "gregorian", "masihi", "miladi", "tarikhmasihi"];
  var HIJRI_ALIASES = ["hijri", "hijrah", "tarikhhijri", "islamicdate"];
  var ZONE_ALIASES = ["zone", "zon", "zonecode", "kodzon", "code"];

  function canon(k) {
    return String(k).toLowerCase().replace(/[^a-z]/g, "");
  }

  function pick(obj, aliases) {
    var map = {};
    Object.keys(obj).forEach(function (k) {
      var c = canon(k);
      if (!(c in map)) map[c] = obj[k];
    });
    for (var i = 0; i < aliases.length; i++) {
      if (map[aliases[i]] !== undefined && map[aliases[i]] !== null && map[aliases[i]] !== "") {
        return map[aliases[i]];
      }
    }
    return undefined;
  }

  /* ------------------------------------------------------------------ *
   * Value parsing
   * ------------------------------------------------------------------ */

  var MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, mei: 4, jun: 5, jul: 6, julai: 6,
    aug: 7, ogo: 7, ogos: 7, sep: 8, sept: 8, oct: 9, okt: 9, nov: 10, dec: 11, dis: 11
  };

  // Returns { h, m, s } in local wall-clock terms, or null.
  function parseTime(value) {
    if (value === null || value === undefined) return null;

    if (typeof value === "number" && isFinite(value)) {
      return fromEpoch(value);
    }

    var str = String(value).trim();
    if (!str) return null;

    // Unix timestamp, seconds or milliseconds.
    if (/^\d{9,13}$/.test(str)) return fromEpoch(Number(str));

    // Full ISO / RFC date-time.
    if (/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(str)) {
      var d = new Date(str.replace(" ", "T"));
      if (!isNaN(d.getTime())) return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
    }

    // "5:47", "05:47:00", "5.47 pm", "05:47 PM"
    var m = str.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?m\.?)?/i);
    if (m) {
      var h = Number(m[1]);
      var min = Number(m[2]);
      var sec = m[3] ? Number(m[3]) : 0;
      var mer = m[4] ? m[4].toLowerCase().replace(/\./g, "") : "";
      if (mer === "pm" && h < 12) h += 12;
      if (mer === "am" && h === 12) h = 0;
      if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return { h: h, m: min, s: sec };
    }

    return null;
  }

  function fromEpoch(n) {
    var ms = n >= 1e12 ? n : (n >= 1e9 ? n * 1000 : null);
    if (ms === null) return null;
    var d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
  }

  // Returns a local Date at midnight, or null.
  function parseDate(value) {
    if (value === null || value === undefined) return null;

    if (typeof value === "number" && value >= 1e9) {
      var e = new Date(value >= 1e12 ? value : value * 1000);
      return isNaN(e.getTime()) ? null : startOfDay(e);
    }

    var str = String(value).trim();
    if (!str) return null;

    var iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

    // 01-Jun-2026 / 1 Jun 2026 / 01 Jun 26
    var named = str.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,})[-\s/](\d{2,4})/);
    if (named) {
      var mo = MONTHS[named[2].slice(0, 3).toLowerCase()];
      if (mo !== undefined) return new Date(expandYear(named[3]), mo, Number(named[1]));
    }

    // 01/06/2026 — day first, which is the Malaysian convention.
    var dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (dmy) return new Date(expandYear(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));

    var loose = new Date(str);
    return isNaN(loose.getTime()) ? null : startOfDay(loose);
  }

  function expandYear(y) {
    var n = Number(y);
    return n < 100 ? 2000 + n : n;
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /* ------------------------------------------------------------------ *
   * Normalisation
   * ------------------------------------------------------------------ */

  function readRecord(obj) {
    var times = {};
    var hits = 0;

    SLOTS.forEach(function (slot) {
      var raw = pick(obj, slot.aliases);
      var parsed = parseTime(raw);
      if (parsed) {
        times[slot.key] = parsed;
        hits++;
      }
    });

    // Three is enough to be confident this is a day of prayer times and not,
    // say, a metadata object that happens to hold one timestamp.
    if (hits < 3) return null;

    return {
      times: times,
      date: parseDate(pick(obj, DATE_ALIASES)),
      hijri: firstString(pick(obj, HIJRI_ALIASES)),
      zone: firstString(pick(obj, ZONE_ALIASES))
    };
  }

  function firstString(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "object") return null;
    var s = String(v).trim();
    return s || null;
  }

  function collectRecords(node, out, depth) {
    if (!node || typeof node !== "object" || depth > 6 || out.length > 400) return;

    if (Array.isArray(node)) {
      node.forEach(function (item) { collectRecords(item, out, depth + 1); });
      return;
    }

    var record = readRecord(node);
    if (record) {
      out.push(record);
      return; // A day record has no nested day records inside it.
    }

    Object.keys(node).forEach(function (k) {
      collectRecords(node[k], out, depth + 1);
    });
  }

  // Fills in missing dates: anchors the run on any record that does have one,
  // otherwise assumes a single record is today and a longer run starts on the
  // 1st of the current month (how e-Solat serves a monthly period).
  function assignDates(records) {
    if (!records.length) return records;

    var anchorIndex = -1;
    for (var i = 0; i < records.length; i++) {
      if (records[i].date) { anchorIndex = i; break; }
    }

    var today = startOfDay(new Date());
    var anchorDate;
    if (anchorIndex >= 0) {
      anchorDate = records[anchorIndex].date;
    } else {
      anchorIndex = 0;
      anchorDate = records.length === 1
        ? today
        : new Date(today.getFullYear(), today.getMonth(), 1);
    }

    records.forEach(function (rec, idx) {
      if (!rec.date) {
        rec.date = new Date(
          anchorDate.getFullYear(),
          anchorDate.getMonth(),
          anchorDate.getDate() + (idx - anchorIndex)
        );
      }
      rec.times = materialise(rec.date, rec.times);
    });

    records.sort(function (a, b) { return a.date - b.date; });
    return records;
  }

  // Turns { h, m, s } into real Date objects pinned to the record's day.
  function materialise(date, times) {
    var out = {};
    Object.keys(times).forEach(function (key) {
      var t = times[key];
      out[key] = new Date(date.getFullYear(), date.getMonth(), date.getDate(), t.h, t.m, t.s || 0);
    });
    return out;
  }

  function normalise(payload) {
    var records = [];
    collectRecords(payload, records, 0);
    return assignDates(records);
  }

  /* ------------------------------------------------------------------ *
   * Fetching
   * ------------------------------------------------------------------ */

  function getJSON(url) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;

    return fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller ? controller.signal : undefined,
      cache: "no-store"
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    }).then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error("Bukan JSON");
      }
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  /**
   * Resolves to { days, raw, url, zone }.
   * `days` is sorted ascending; each entry is { date, hijri, zone, times }
   * where `times` maps a slot key to a Date.
   */
  function load(zone) {
    var custom = customTemplate();
    var order;

    if (custom) {
      // Honour the pasted URL first, then still fall back to the guesses so a
      // typo does not leave the page with nothing at all.
      order = [custom].concat(TEMPLATES);
    } else {
      order = TEMPLATES.slice();
      var remembered = null;
      try {
        remembered = localStorage.getItem(ENDPOINT_CACHE_KEY);
      } catch (e) { /* storage unavailable */ }
      if (remembered && order.indexOf(remembered) > 0) {
        order.splice(order.indexOf(remembered), 1);
        order.unshift(remembered);
      }
    }

    var errors = [];
    var step = 0;

    function attempt() {
      if (step >= order.length) {
        var e = new Error(errors.join(" · ") || "Tiada respons");
        e.attempts = errors;
        throw e;
      }

      var template = order[step++];
      var url = expand(template, zone);

      return getJSON(url).then(function (payload) {
        var days = normalise(payload);
        if (!days.length) throw new Error("Tiada waktu solat dikenal pasti");

        try {
          localStorage.setItem(ENDPOINT_CACHE_KEY, template);
        } catch (e) { /* storage unavailable */ }

        return { days: days, raw: payload, url: url, zone: zone };
      }).catch(function (err) {
        errors.push(shorten(url) + ": " + err.message);
        return attempt();
      });
    }

    return Promise.resolve().then(attempt);
  }

  function shorten(url) {
    return url.replace(BASE, "…");
  }

  return {
    load: load,
    normalise: normalise,
    parseTime: parseTime,
    parseDate: parseDate,
    customTemplate: customTemplate,
    setCustomTemplate: setCustomTemplate,
    SLOTS: SLOTS,
    BASE: BASE
  };
})();
