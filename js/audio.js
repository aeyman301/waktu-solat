/*
 * Azan playback.
 *
 * Browsers refuse to start audio until the page has seen a user gesture, so the
 * clip is "unlocked" once on the first click and the unlocked state is what the
 * scheduler relies on later when nobody is touching the page.
 */
window.Azan = (function () {
  "use strict";

  var el = null;
  var unlocked = false;
  var missing = false;
  var current = null;
  var listeners = [];

  function init(audioElement) {
    el = audioElement;

    el.addEventListener("ended", function () {
      current = null;
      emit();
    });

    el.addEventListener("error", function () {
      // Most commonly: audio/azan.mp3 has not been added to the repo yet.
      missing = true;
      current = null;
      emit();
    });

    el.addEventListener("canplaythrough", function () {
      missing = false;
      emit();
    });
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function emit() {
    var snapshot = status();
    listeners.forEach(function (fn) { fn(snapshot); });
  }

  function status() {
    return { unlocked: unlocked, missing: missing, playing: current };
  }

  function setVolume(fraction) {
    if (el) el.volume = Math.min(1, Math.max(0, fraction));
  }

  /* Called from a click handler: play a moment of silence to satisfy the
   * autoplay policy, then rewind so the real azan starts from the beginning. */
  function unlock() {
    if (!el) return Promise.reject(new Error("Audio belum dimulakan"));

    var restore = el.volume;
    el.volume = 0;

    return Promise.resolve(el.play()).then(function () {
      el.pause();
      el.currentTime = 0;
      el.volume = restore;
      unlocked = true;
      missing = false;
      emit();
    }).catch(function (err) {
      el.volume = restore;
      if (err && err.name === "NotSupportedError") missing = true;
      emit();
      throw err;
    });
  }

  function play(label) {
    if (!el) return Promise.reject(new Error("Audio belum dimulakan"));

    el.currentTime = 0;
    return Promise.resolve(el.play()).then(function () {
      current = label || "Azan";
      unlocked = true;
      emit();
    }).catch(function (err) {
      current = null;
      // A blocked play means the gesture has expired or never happened.
      if (err && err.name === "NotAllowedError") unlocked = false;
      if (err && err.name === "NotSupportedError") missing = true;
      emit();
      throw err;
    });
  }

  function stop() {
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    current = null;
    emit();
  }

  return {
    init: init,
    onChange: onChange,
    status: status,
    setVolume: setVolume,
    unlock: unlock,
    play: play,
    stop: stop
  };
})();
