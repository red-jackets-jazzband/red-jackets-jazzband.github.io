import { byId, on } from "../lib/dom.js";
import { readPref, writePref, PREF_KEYS } from "../lib/preferences.js";
import { resolveBpm } from "../lib/tempo.js";
import { scheduleClicks } from "../lib/metronome.js";

// The lookahead-scheduler constants (Chris Wilson's "A Tale of Two Clocks"
// pattern): poll often (25ms) and always keep the next 100ms of clicks
// already queued on the audio clock, so a busy main thread can never make a
// click land late or get skipped — only the *scheduling* of a click is
// timer-driven, the click's own start time is sample-accurate AudioContext
// time.
const LOOKAHEAD_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.1;

// A short, percussive click — square wave (more "tick" than a sine's pure
// tone) with a fast linear attack into an exponential decay. The backbeat
// (beats 2 & 4 — see lib/metronome.js's isBackbeat) gets a higher pitch and
// louder peak than the rest, so it reads as heavier without needing a
// second, different sound.
const CLICK_FREQUENCY_HZ = 1000;
const ACCENT_FREQUENCY_HZ = 1500;
const CLICK_GAIN = 0.22;
const ACCENT_GAIN = 0.5;
const CLICK_DECAY_SECONDS = 0.05;

// Returns the oscillator node so the caller can track it and cut it off
// early (stop() below) — its own scheduled .stop() call only silences it at
// the click's natural end, which isn't good enough for stop() to rely on.
function playClick(audioCtx, time, accent) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "square";
  osc.frequency.value = accent ? ACCENT_FREQUENCY_HZ : CLICK_FREQUENCY_HZ;
  const peak = accent ? ACCENT_GAIN : CLICK_GAIN;
  // A zero-value ramp start (rather than a hard jump to `peak`) avoids the
  // audible "pop" a click's own instant on/off would otherwise leave.
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(peak, time + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + CLICK_DECAY_SECONDS);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(time);
  osc.stop(time + CLICK_DECAY_SECONDS + 0.02);
  return osc;
}

/*
  The Mixer panel's Metronome toggle (content/songs.md's #mixerMetronomeToggleBtn):
  a click track, off by default, that only ticks while the sheet is actually
  playing — enabling it arms the click for the next time Play starts (or
  immediately, if the sheet is already playing) rather than clicking on its
  own with nothing else sounding. It runs on its own AudioContext, entirely
  independent of ABCjs's SynthController — see lib/audio-mix.js's doc comment
  for why a generic %%MIDI directive doesn't reliably reach the live synth;
  a self-scheduled click sidesteps that question completely.

  Tempo and time signature are read live off ctx.state / ctx.audio on every
  scheduling tick (never snapshotted), so a Tempo-stepper nudge or a new tune
  takes effect on the very next click with no extra wiring.

  Simplification, called out because it's a real trade-off and not an
  oversight: the click always starts counting from beat 1 of a measure
  whenever it (re)starts, rather than phase-locking to the tune's actual
  current beat (which would mean cross-referencing ABCjs's internal timing
  with the tune's measure/pickup-bar structure). Since Play/Pause already
  restarts the click the same way, this only ever matters for the first
  beat or two after a mid-measure Play — good enough for a click track and
  far simpler than the alternative.
*/
export function createMetronome(ctx) {
  let audioCtx = null;
  let timerId = null;
  let running = false;
  let nextNoteTime = 0;
  let beatIndex = 0;
  // Clicks tick()'s already scheduled up to SCHEDULE_AHEAD_SECONDS into the
  // future — stop()'s clearInterval only stops *future* scheduling ticks,
  // it does nothing about a click that's already been handed to the
  // AudioContext with its own start()/stop() times. Tracked here so stop()
  // can cut those off too; each one prunes itself once it finishes on its
  // own, so this only ever holds the still-pending handful.
  let scheduledOscillators = [];

  function ensureAudioContext() {
    if (audioCtx) return audioCtx;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    audioCtx = new AudioCtor();
    return audioCtx;
  }

  function tick() {
    if (!audioCtx) return;
    const bpm = resolveBpm(ctx.state.tempoOverrideBpm, ctx.audio.nativeQpm);
    const result = scheduleClicks({
      currentTime: audioCtx.currentTime,
      nextNoteTime,
      beatIndex,
      beatsInMeasure: ctx.audio.beatsPerMeasure,
      secondsPerBeat: 60 / bpm,
      scheduleAheadSeconds: SCHEDULE_AHEAD_SECONDS,
    });
    result.clicks.forEach(({ time, accent }) => {
      const osc = playClick(audioCtx, time, accent);
      scheduledOscillators.push(osc);
      osc.onended = () => {
        const idx = scheduledOscillators.indexOf(osc);
        if (idx !== -1) scheduledOscillators.splice(idx, 1);
      };
    });
    nextNoteTime = result.nextNoteTime;
    beatIndex = result.beatIndex;
  }

  function start() {
    const audio = ensureAudioContext();
    if (!audio) return; // no Web Audio support — the toggle just does nothing audible
    if (audio.state === "suspended" && typeof audio.resume === "function") audio.resume();
    beatIndex = 0;
    nextNoteTime = audio.currentTime + 0.05;
    timerId = setInterval(tick, LOOKAHEAD_INTERVAL_MS);
    running = true;
  }

  function stop() {
    if (timerId !== null) clearInterval(timerId);
    timerId = null;
    running = false;
    // Cut off any click already scheduled inside the lookahead window —
    // otherwise pausing (or toggling off) mid-window still lets it sound.
    // .stop() on a node whose own scheduled stop already elapsed throws;
    // that's just it finishing on its own, nothing to do about it.
    scheduledOscillators.forEach((osc) => {
      try {
        osc.stop();
      } catch {
        // already stopped/ended — nothing to do.
      }
    });
    scheduledOscillators = [];
  }

  // The one place that decides whether the click should be running right
  // now: only when the toggle is on AND the sheet is actually playing. Both
  // ctx.audio.isPlaying flips (songs/audio-player.js's setIsPlaying) and the
  // toggle button itself call this, so either one turning on/off while the
  // other already holds its own state starts/stops the click immediately.
  function syncRunning() {
    const shouldRun = ctx.state.metronomeEnabled && ctx.audio.isPlaying;
    if (shouldRun && !running) start();
    else if (!shouldRun && running) stop();
  }

  function updateToggleVisual() {
    const btn = byId("mixerMetronomeToggleBtn");
    if (!btn) return;
    const enabled = ctx.state.metronomeEnabled;
    btn.classList.toggle("is-active", enabled);
    btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    const icon = btn.querySelector(".fa-solid");
    if (icon) {
      icon.classList.toggle("fa-toggle-on", enabled);
      icon.classList.toggle("fa-toggle-off", !enabled);
    }
    const label = `${enabled ? "Disable" : "Enable"} metronome`;
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function init() {
    updateToggleVisual();
    on("mixerMetronomeToggleBtn", "click", () => {
      ctx.state.metronomeEnabled = !ctx.state.metronomeEnabled;
      writePref(PREF_KEYS.metronomeEnabled, ctx.state.metronomeEnabled ? "1" : "0");
      updateToggleVisual();
      syncRunning();
    });
  }

  return {
    init,
    refresh: updateToggleVisual,
    onPlaybackChange: syncRunning,
  };
}

// ctx.state.metronomeEnabled's initial value, seeded from the persisted
// pref (default off) — built here for the same reason loadMixerState lives
// in mixer.js: the persistence/defaulting logic sits next to the module
// that owns the rest of this state.
export function loadMetronomeState() {
  return readPref(PREF_KEYS.metronomeEnabled) === "1";
}
