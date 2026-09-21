/* Wiring: zone picker -> API -> rendering -> azan scheduler. */
(function () {
  "use strict";

  var STORE = {
    zone: "waktu-solat.zone",
    enabled: "waktu-solat.enabled",
    volume: "waktu-solat.volume",
    prayers: "waktu-solat.prayers",
    fired: "waktu-solat.fired",
    cache: "waktu-solat.cache."
  };

  // The five fard prayers: these drive the countdown and may call the azan.
  var AZAN_SLOTS = ["subuh", "zohor", "asar", "maghrib", "isyak"];
  // Shown for reference but never announced.
  var INFO_SLOTS = ["imsak", "syuruk", "dhuha"];

  var LABELS = {};
  window.SolatAPI.SLOTS.forEach(function (s) { LABELS[s.key] = s.label; });

  var TRIGGER_WINDOW_MS = 90 * 1000;
  var REFRESH_MS = 6 * 60 * 60 * 1000;

  var el = {};
  var state = {
    zone: null,
    days: [],
    today: null,
    source: "",
    lastFetch: 0,
    fired: loadFired(),
    prayers: {}
  };

  /* ---------------------------------------------------------------- *
   * Storage helpers
   * ---------------------------------------------------------------- */

  function read(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable (private mode, blocked cookies) */ }
  }

  function dayKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function loadFired() {
    try {
      var parsed = JSON.parse(read(STORE.fired, "null"));
      if (parsed && parsed.date === dayKey(new Date())) return parsed;
    } catch (e) { /* corrupt entry, start fresh */ }
    return { date: dayKey(new Date()), keys: [] };
  }

  function markFired(key) {
    var today = dayKey(new Date());
    if (state.fired.date !== today) state.fired = { date: today, keys: [] };
    if (state.fired.keys.indexOf(key) === -1) state.fired.keys.push(key);
    write(STORE.fired, JSON.stringify(state.fired));
  }

  function hasFired(key) {
    return state.fired.date === dayKey(new Date()) && state.fired.keys.indexOf(key) !== -1;
  }

  /* ---------------------------------------------------------------- *
   * Formatting
   * ---------------------------------------------------------------- */

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function fmtTime(date) {
    var h = date.getHours();
    var suffix = h >= 12 ? "pm" : "am";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + pad(date.getMinutes()) + " " + suffix;
  }

  function fmtClock(date) {
    var h = date.getHours();
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
  }

  function fmtGregorian(date) {
    try {
      return date.toLocaleDateString("ms-MY", {
        weekday: "long", day: "numeric", month: "long", year: "numeric"
      });
    } catch (e) {
      return date.toDateString();
    }
  }

  function fmtDuration(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + "j " + pad(m) + "m " + pad(s) + "s";
    if (m > 0) return m + "m " + pad(s) + "s";
    return s + "s";
  }

  /* ---------------------------------------------------------------- *
   * Setup
   * ---------------------------------------------------------------- */

  function cacheDom() {
    [
      "zoneSelect", "zoneLabel", "refreshBtn", "audioBanner", "enableAudioBtn",
      "errorBox", "errorTitle", "errorMsg", "dismissErrorBtn", "clock", "gregDate",
      "hijriDate", "nextName", "nextTime", "countdown", "progressFill", "timeGrid",
      "sourceBadge", "azanEnabled", "volume", "volumeOut", "prayerToggles",
      "testAzanBtn", "playingBar", "playingText", "stopAzanBtn", "audioHint",
      "rawJson", "debugUrl", "azanAudio", "apiUrl", "saveApiBtn", "resetApiBtn",
      "diagnostics"
    ].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  function buildZoneSelect() {
    var frag = document.createDocumentFragment();
    window.ZONES.forEach(function (group) {
      var og = document.createElement("optgroup");
      og.label = group.state;
      group.zones.forEach(function (pair) {
        var opt = document.createElement("option");
        opt.value = pair[0];
        opt.textContent = pair[0] + " — " + pair[1];
        og.appendChild(opt);
      });
      frag.appendChild(og);
    });
    el.zoneSelect.appendChild(frag);
    el.zoneSelect.value = state.zone;
  }

  function buildPrayerToggles() {
    AZAN_SLOTS.forEach(function (key) {
      var label = document.createElement("label");
      label.className = "chip";

      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = state.prayers[key] !== false;
      input.addEventListener("change", function () {
        state.prayers[key] = input.checked;
        write(STORE.prayers, JSON.stringify(state.prayers));
        render();
      });

      var span = document.createElement("span");
      span.textContent = LABELS[key] || key;

      label.appendChild(input);
      label.appendChild(span);
      el.prayerToggles.appendChild(label);
    });
  }

  // Supports links in the same shape as solat.my, e.g. ?zone=PRK05&name=Kg%20Gajah
  function zoneFromQuery() {
    try {
      var params = new URLSearchParams(window.location.search);
      var z = (params.get("zone") || params.get("zon") || "").toUpperCase().trim();
      return window.ZONE_INDEX[z] ? z : null;
    } catch (e) {
      return null;
    }
  }

  function nameFromQuery() {
    try {
      return new URLSearchParams(window.location.search).get("name");
    } catch (e) {
      return null;
    }
  }

  function loadSettings() {
    state.zone = zoneFromQuery() || read(STORE.zone, "WLY01");
    if (!window.ZONE_INDEX[state.zone]) state.zone = "WLY01";
    write(STORE.zone, state.zone);

    el.apiUrl.value = window.SolatAPI.customTemplate() || "";

    el.azanEnabled.checked = read(STORE.enabled, "1") === "1";

    var vol = Number(read(STORE.volume, "100"));
    if (!isFinite(vol)) vol = 100;
    el.volume.value = String(vol);
    el.volumeOut.textContent = vol + "%";
    window.Azan.setVolume(vol / 100);

    try {
      state.prayers = JSON.parse(read(STORE.prayers, "{}")) || {};
    } catch (e) {
      state.prayers = {};
    }
  }

  function bindEvents() {
    el.zoneSelect.addEventListener("change", function () {
      state.zone = el.zoneSelect.value;
      write(STORE.zone, state.zone);
      // A new zone means a different schedule; let today's azan fire again.
      state.fired = { date: dayKey(new Date()), keys: [] };
      write(STORE.fired, JSON.stringify(state.fired));
      loadData();
    });

    el.refreshBtn.addEventListener("click", function () { loadData(); });

    el.dismissErrorBtn.addEventListener("click", function () { el.errorBox.hidden = true; });

    el.azanEnabled.addEventListener("change", function () {
      write(STORE.enabled, el.azanEnabled.checked ? "1" : "0");
      if (!el.azanEnabled.checked) window.Azan.stop();
      render();
    });

    el.volume.addEventListener("input", function () {
      var v = Number(el.volume.value);
      el.volumeOut.textContent = v + "%";
      window.Azan.setVolume(v / 100);
      write(STORE.volume, String(v));
    });

    el.enableAudioBtn.addEventListener("click", function () {
      window.Azan.unlock().then(function () {
        setHint("Azan diaktifkan. Biarkan tab ini terbuka supaya azan dapat dimainkan.");
      }).catch(function (err) {
        setHint("Gagal mengaktifkan azan: " + describeAudioError(err));
      });
    });

    el.testAzanBtn.addEventListener("click", function () {
      window.Azan.play("Ujian").catch(function (err) {
        setHint("Gagal memainkan azan: " + describeAudioError(err));
      });
    });

    el.stopAzanBtn.addEventListener("click", function () { window.Azan.stop(); });

    el.saveApiBtn.addEventListener("click", function () {
      window.SolatAPI.setCustomTemplate(el.apiUrl.value);
      loadData();
    });

    el.resetApiBtn.addEventListener("click", function () {
      el.apiUrl.value = "";
      window.SolatAPI.setCustomTemplate("");
      loadData();
    });

    // Coming back to the tab is a good moment to check the data is still current.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) maybeRefresh();
    });
  }

  function describeAudioError(err) {
    if (!err) return "ralat tidak diketahui.";
    if (err.name === "NotAllowedError") return "pelayar menyekat main-auto. Tekan butang sekali lagi.";
    if (err.name === "NotSupportedError") return "fail audio/azan.mp3 tidak dijumpai atau formatnya tidak disokong.";
    return err.message || String(err);
  }

  function setHint(text) {
    el.audioHint.textContent = text;
  }

  /* ---------------------------------------------------------------- *
   * Data
   * ---------------------------------------------------------------- */

  function loadData() {
    var zone = state.zone;
    var info = window.ZONE_INDEX[zone];
    var custom = nameFromQuery();
    el.zoneLabel.textContent = custom
      ? custom + " · " + zone
      : (info ? info.area + " · " + info.state : zone);
    el.sourceBadge.textContent = "Memuatkan…";

    return window.SolatAPI.load(zone).then(function (result) {
      applyPayload(result.raw, result.days, "API", result.url);
      write(STORE.cache + zone, JSON.stringify({ savedAt: Date.now(), raw: result.raw }));
      el.errorBox.hidden = true;
    }).catch(function (err) {
      var fallback = readCache(zone);
      if (fallback) {
        applyPayload(fallback.raw, window.SolatAPI.normalise(fallback.raw), "Cache", "—");
        showError("Tidak dapat menghubungi API", err.message + " — memaparkan data tersimpan (" + fmtGregorian(new Date(fallback.savedAt)) + ").");
      } else {
        state.days = [];
        state.today = null;
        el.sourceBadge.textContent = "Tiada data";
        el.timeGrid.innerHTML = "";
        el.rawJson.textContent = "—";
        showError("Tidak dapat memuatkan waktu solat", err.message);
        // Nothing to show, so surface the panel that lets the user set the URL.
        el.diagnostics.open = true;
        render();
      }
    });
  }

  function readCache(zone) {
    try {
      var parsed = JSON.parse(read(STORE.cache + zone, "null"));
      return parsed && parsed.raw ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function applyPayload(raw, days, source, url) {
    state.days = days;
    state.source = source;
    state.lastFetch = Date.now();
    state.today = findToday(days);

    el.sourceBadge.textContent = source + " · " + days.length + " hari";
    el.debugUrl.textContent = url;

    try {
      el.rawJson.textContent = JSON.stringify(raw, null, 2).slice(0, 20000);
    } catch (e) {
      el.rawJson.textContent = String(raw);
    }

    render();
  }

  function findToday(days) {
    var key = dayKey(new Date());
    for (var i = 0; i < days.length; i++) {
      if (dayKey(days[i].date) === key) return days[i];
    }
    return days.length === 1 ? days[0] : null;
  }

  function maybeRefresh() {
    var staleData = Date.now() - state.lastFetch > REFRESH_MS;
    var wrongDay = !state.today || dayKey(state.today.date) !== dayKey(new Date());
    if (staleData || wrongDay) loadData();
  }

  /* ---------------------------------------------------------------- *
   * Schedule helpers
   * ---------------------------------------------------------------- */

  // Flattens the five fard prayers across every loaded day into one timeline.
  function timeline() {
    var out = [];
    state.days.forEach(function (day) {
      AZAN_SLOTS.forEach(function (key) {
        if (day.times[key]) {
          out.push({ key: key, label: LABELS[key] || key, at: day.times[key], date: day.date });
        }
      });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }

  function nextEntry(now) {
    var list = timeline();
    for (var i = 0; i < list.length; i++) {
      if (list[i].at > now) return { entry: list[i], previous: i > 0 ? list[i - 1] : null };
    }
    return { entry: null, previous: list.length ? list[list.length - 1] : null };
  }

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */

  function render() {
    var now = new Date();
    el.clock.textContent = fmtClock(now);
    el.gregDate.textContent = fmtGregorian(now);
    el.hijriDate.textContent = state.today && state.today.hijri ? state.today.hijri : "—";

    renderNext(now);
    renderGrid(now);
    renderAudioState();
  }

  function renderNext(now) {
    var found = nextEntry(now);

    if (!found.entry) {
      el.nextName.textContent = state.days.length ? "—" : "Tiada data";
      el.nextTime.textContent = "—";
      el.countdown.textContent = state.days.length
        ? "Semua waktu hari ini telah berlalu."
        : "Pilih zon atau muat semula.";
      setProgress(0);
      return;
    }

    el.nextName.textContent = found.entry.label;
    el.nextTime.textContent = fmtTime(found.entry.at) + (isToday(found.entry.at) ? "" : " (esok)");
    el.countdown.textContent = "dalam " + fmtDuration(found.entry.at - now);

    if (found.previous) {
      var span = found.entry.at - found.previous.at;
      setProgress(span > 0 ? ((now - found.previous.at) / span) * 100 : 0);
    } else {
      setProgress(0);
    }
  }

  function isToday(date) {
    return dayKey(date) === dayKey(new Date());
  }

  function setProgress(pct) {
    var clamped = Math.min(100, Math.max(0, pct));
    el.progressFill.style.width = clamped.toFixed(1) + "%";
    var bar = el.progressFill.parentElement;
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(clamped)));
  }

  function renderGrid(now) {
    if (!state.today) {
      if (state.days.length) {
        el.timeGrid.innerHTML = "<li class=\"time-card is-info\"><span class=\"name\">Nota</span>" +
          "<span class=\"value\">Tiada rekod hari ini</span>" +
          "<span class=\"meta\">API tidak memulangkan tarikh semasa.</span></li>";
      }
      return;
    }

    var nextKey = nextEntry(now).entry;
    var order = ["imsak", "subuh", "syuruk", "dhuha", "zohor", "asar", "maghrib", "isyak"];

    el.timeGrid.innerHTML = "";
    order.forEach(function (key) {
      var at = state.today.times[key];
      if (!at) return;

      var li = document.createElement("li");
      li.className = "time-card";

      var isInfo = INFO_SLOTS.indexOf(key) !== -1;
      if (isInfo) li.classList.add("is-info");
      if (nextKey && nextKey.key === key && isToday(nextKey.at)) li.classList.add("is-next");
      else if (at < now) li.classList.add("is-past");

      var name = document.createElement("span");
      name.className = "name";
      name.textContent = LABELS[key] || key;

      var value = document.createElement("span");
      value.className = "value";
      value.textContent = fmtTime(at);

      var meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = metaFor(key, isInfo);

      li.appendChild(name);
      li.appendChild(value);
      li.appendChild(meta);
      el.timeGrid.appendChild(li);
    });
  }

  function metaFor(key, isInfo) {
    if (isInfo) return "bukan waktu azan";
    if (!el.azanEnabled.checked) return "azan dimatikan";
    return state.prayers[key] === false ? "azan dimatikan" : "azan aktif";
  }

  function renderAudioState() {
    var s = window.Azan.status();
    var wantsAzan = el.azanEnabled.checked;

    el.audioBanner.hidden = !wantsAzan || s.unlocked;

    el.playingBar.hidden = !s.playing;
    if (s.playing) el.playingText.textContent = "Azan sedang dimainkan — " + s.playing;

    if (s.missing) {
      setHint("Fail audio/azan.mp3 belum ada (atau tidak dapat dibaca). Letakkan fail azan anda di audio/azan.mp3.");
    }
  }

  function showError(title, message) {
    el.errorTitle.textContent = title;
    el.errorMsg.textContent = message;
    el.errorBox.hidden = false;
  }

  /* ---------------------------------------------------------------- *
   * Scheduler
   * ---------------------------------------------------------------- */

  function checkAzan(now) {
    if (!el.azanEnabled.checked || !state.today) return;
    if (window.Azan.status().playing) return;

    AZAN_SLOTS.forEach(function (key) {
      if (state.prayers[key] === false) return;

      var at = state.today.times[key];
      if (!at) return;

      var delta = now - at;
      // Only fire inside a short window so a tab opened hours later stays quiet.
      if (delta < 0 || delta > TRIGGER_WINDOW_MS) return;

      var fireKey = dayKey(at) + ":" + key;
      if (hasFired(fireKey)) return;

      markFired(fireKey);
      window.Azan.play(LABELS[key] || key).catch(function (err) {
        setHint("Azan " + (LABELS[key] || key) + " tidak dapat dimainkan: " + describeAudioError(err));
      });
    });
  }

  function tick() {
    var now = new Date();
    render();
    checkAzan(now);
    if (now.getSeconds() === 0) maybeRefresh();
  }

  /* ---------------------------------------------------------------- *
   * Boot
   * ---------------------------------------------------------------- */

  function start() {
    cacheDom();
    window.Azan.init(el.azanAudio);
    window.Azan.onChange(renderAudioState);

    loadSettings();
    buildZoneSelect();
    buildPrayerToggles();
    bindEvents();

    render();
    loadData();

    setInterval(tick, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
