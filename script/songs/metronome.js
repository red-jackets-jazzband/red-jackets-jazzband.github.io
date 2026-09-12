import { byId, on } from "../lib/dom.js";
import { readPref, writePref, PREF_KEYS } from "../lib/preferences.js";
import { resolveBpm } from "../lib/tempo.js";
import {
  hasBackbeat, introDelaySeconds, pickupStartBeatIndex, scheduleClicks,
} from "../lib/metronome.js";

// The lookahead-scheduler constants (Chris Wilson's "A Tale of Two Clocks"
// pattern): poll often (25ms) and always keep the next 100ms of clicks
// already queued on the audio clock, so a busy main thread can never make a
// click land late or get skipped — only the *scheduling* of a click is
// timer-driven, the click's own start time is sample-accurate AudioContext
// time.
const LOOKAHEAD_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.1;

// A fixed forward nudge applied to every scheduled click. This metronome
// runs on its own independent AudioContext with no link at all to ABCjs's
// SynthController clock (see createMetronome's own doc comment below), so
// there's nothing here to measure real playback latency against — it can
// only be tuned by ear. Empirically the click reads as landing slightly
// behind the beat rather than dead on it, so every click is scheduled this
// much earlier than the clock's own reckoning would otherwise put it.
const CLICK_ADVANCE_SECONDS = 0.02;

/*
  A closed hihat tick, not a mechanical click: filtered white noise rather
  than a tuned oscillator, since a real closed hihat is a burst of
  high-frequency noise with no clear pitch, not a tone. A highpass strips the
  low end (the "boom" a click would have), a bandpass on top adds the tight,
  sizzly character around where a real closed hihat's energy sits, and a fast
  attack into a short exponential decay keeps it a tight "tick" rather than
  an open/ringing hihat. Deliberately quiet and uniform — see tick() below,
  it only ever sounds on the backbeat (or every beat, for a meter with no
  backbeat to lean on), so there's no separate downbeat/backbeat volume to
  differentiate any more.
*/
const NOISE_BUFFER_SECONDS = 0.1;
const HIHAT_HIGHPASS_HZ = 7000;
const HIHAT_BANDPASS_HZ = 10000;
const HIHAT_BANDPASS_Q = 1.5;
const HIHAT_GAIN = 0.16;
const HIHAT_DECAY_SECONDS = 0.045;

// A short burst of white noise, generated once per AudioContext and reused
// for every tick — the noise itself doesn't depend on tempo/beat, only the
// filters + envelope wrapped around it each time do.
function createNoiseBuffer(audioCtx) {
  const frameCount = Math.round(audioCtx.sampleRate * NOISE_BUFFER_SECONDS);
  const buffer = audioCtx.createBuffer(1, frameCount, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) {
    // Audio noise synthesis, not a security context — sonarjs flags
    // Math.random() as a pseudo-random-number hotspot regardless of use.
    // eslint-disable-next-line sonarjs/pseudo-random
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

// Returns the buffer source node so the caller can track it and cut it off
// early (stop() below) — its own scheduled .stop() call only silences it at
// the tick's natural end, which isn't good enough for stop() to rely on.
function playClick(audioCtx, noiseBuffer, time) {
  const source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer;

  const highpass = audioCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = HIHAT_HIGHPASS_HZ;

  const bandpass = audioCtx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = HIHAT_BANDPASS_HZ;
  bandpass.Q.value = HIHAT_BANDPASS_Q;

  const gain = audioCtx.createGain();
  // A zero-value ramp start (rather than a hard jump to the peak) avoids the
  // audible "pop" a tick's own instant on/off would otherwise leave.
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(HIHAT_GAIN, time + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + HIHAT_DECAY_SECONDS);

  source.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(gain);
  gain.connect(audioCtx.destination);
  source.start(time);
  source.stop(time + HIHAT_DECAY_SECONDS + 0.02);
  return source;
}

/*
  The Mixer panel's Metronome toggle (content/songs.md's #mixerMetronomeToggleBtn):
  a hihat click track, off by default, that only ticks while the sheet is
  actually playing — enabling it arms the click for the next time Play
  starts (or immediately, if the sheet is already playing) rather than
  clicking on its own with nothing else sounding. It runs on its own
  AudioContext, entirely independent of ABCjs's SynthController — see
  lib/audio-mix.js's doc comment for why a generic %%MIDI directive doesn't
  reliably reach the live synth; a self-scheduled click sidesteps that
  question completely.

  It only ticks on the backbeat (beats 2 & 4 — lib/metronome.js's
  isBackbeat/hasBackbeat), the way a drummer's hihat foot keeps time under a
  swing/New-Orleans groove, rather than clicking every beat; a meter with no
  2-&-4 to lean on (a 3/4 waltz, say) falls back to ticking every beat so the
  click track still means something there.

  Its chordless-intro and pickup handling (ctx.audio.chordOffset /
  pickupBeats, lib/metronome.js's introDelaySeconds / pickupStartBeatIndex —
  holding off until a rubato intro has passed, or phasing the very first
  beat to a pickup/anacrusis) is derived once from the tune's own static
  data, on the assumption that "now" is position 0. That's only true for a
  genuine Play from the top, so start()'s `fromStart` flag (threaded through
  from audio-player.js's setIsPlaying — see its own doc comment) gates it:
  false for a resume from a mid-tune pause, or for the toggle itself being
  flipped on while the sheet is already playing, both of which just tick
  immediately and unphased instead — there's no way to know the real current
  position in either case, so counting from "beat 1 now" is the honest
  fallback rather than reapplying timing that assumes position 0.

  Tempo and time signature are read live off ctx.state / ctx.audio on every
  scheduling tick (never snapshotted), so a Tempo-stepper nudge or a new tune
  takes effect on the very next click with no extra wiring.
*/
export function createMetronome(ctx) {
  let audioCtx = null;
  let noiseBuffer = null;
  let timerId = null;
  let running = false;
  let nextNoteTime = 0;
  let beatIndex = 0;
  // Ticks tick()'s already scheduled up to SCHEDULE_AHEAD_SECONDS into the
  // future — stop()'s clearInterval only stops *future* scheduling ticks,
  // it does nothing about a tick that's already been handed to the
  // AudioContext with its own start()/stop() times. Tracked here so stop()
  // can cut those off too; each one prunes itself once it finishes on its
  // own, so this only ever holds the still-pending handful.
  let scheduledVoices = [];

  function ensureAudioContext() {
    if (audioCtx) return audioCtx;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    audioCtx = new AudioCtor();
    noiseBuffer = createNoiseBuffer(audioCtx);
    return audioCtx;
  }

  function tick() {
    if (!audioCtx) return;
    const bpm = resolveBpm(ctx.state.tempoOverrideBpm, ctx.audio.nativeQpm);
    const beats = ctx.audio.beatsPerMeasure;
    const result = scheduleClicks({
      currentTime: audioCtx.currentTime,
      nextNoteTime,
      beatIndex,
      beatsInMeasure: beats,
      secondsPerBeat: 60 / bpm,
      scheduleAheadSeconds: SCHEDULE_AHEAD_SECONDS,
    });
    result.clicks.forEach(({ time, accent }) => {
      if (hasBackbeat(beats) && !accent) return;
      const source = playClick(audioCtx, noiseBuffer, time);
      scheduledVoices.push(source);
      source.onended = () => {
        const idx = scheduledVoices.indexOf(source);
        if (idx !== -1) scheduledVoices.splice(idx, 1);
      };
    });
    nextNoteTime = result.nextNoteTime;
    beatIndex = result.beatIndex;
  }

  // `fromStart` is true only for a genuine Play from position 0 (see
  // audio-player.js's playPause/setIsPlaying) — the only time the intro/
  // pickup timing below means anything, since it's derived from the tune's
  // own static data assuming playback begins at the top. A resume from a
  // mid-tune pause, or the metronome toggle itself being flipped on while
  // the sheet is already playing, ticks immediately and unphased instead:
  // there's no way to know the real current position, so counting from
  // "beat 1 now" is the same simplification already documented above for a
  // mid-measure resume, just applied a beat sooner.
  function start(fromStart) {
    const audio = ensureAudioContext();
    if (!audio) return; // no Web Audio support — the toggle just does nothing audible
    if (audio.state === "suspended" && typeof audio.resume === "function") audio.resume();
    const beats = ctx.audio.beatsPerMeasure;
    let delay = 0;
    beatIndex = 0;
    if (fromStart) {
      const bpm = resolveBpm(ctx.state.tempoOverrideBpm, ctx.audio.nativeQpm);
      const introBars = ctx.audio.chordOffset || 0;
      const pickupBeats = ctx.audio.pickupBeats || 0;
      delay = introDelaySeconds(introBars, beats, 60 / bpm, pickupBeats);
      // Skipping an intro always lands exactly on a bar line, so the clock
      // resumes at beat 1 either way; with nothing to skip, a pickup phases
      // the clock's very first beat instead (see pickupStartBeatIndex).
      beatIndex = introBars > 0 ? 0 : pickupStartBeatIndex(pickupBeats, beats);
    }
    nextNoteTime = audio.currentTime + 0.05 - CLICK_ADVANCE_SECONDS + delay;
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
    scheduledVoices.forEach((source) => {
      try {
        source.stop();
      } catch {
        // already stopped/ended — nothing to do.
      }
    });
    scheduledVoices = [];
  }

  // The one place that decides whether the click should be running right
  // now: only when the toggle is on AND the sheet is actually playing. Both
  // ctx.audio.isPlaying flips (songs/audio-player.js's setIsPlaying) and the
  // toggle button itself call this, so either one turning on/off while the
  // other already holds its own state starts/stops the click immediately.
  // `fromStart` (see start()'s own doc comment) defaults to false, which is
  // exactly right for the toggle-button call site below: flipping the
  // toggle on never itself means "the tune just started" — either the sheet
  // isn't playing yet (shouldRun is false, so start() never even runs), or
  // it's already mid-playback and the click is only just joining it.
  function syncRunning(fromStart = false) {
    const shouldRun = ctx.state.metronomeEnabled && ctx.audio.isPlaying;
    if (shouldRun && !running) start(fromStart);
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
    // `playing` itself is only read via the live ctx.audio.isPlaying getter
    // inside syncRunning, not this argument — kept here only so the call
    // site (audio-player.js's setIsPlaying) reads naturally either way.
    onPlaybackChange(playing, fromStart) {
      syncRunning(fromStart);
    },
  };
}

// ctx.state.metronomeEnabled's initial value, seeded from the persisted
// pref (default off) — built here for the same reason loadMixerState lives
// in mixer.js: the persistence/defaulting logic sits next to the module
// that owns the rest of this state.
export function loadMetronomeState() {
  return readPref(PREF_KEYS.metronomeEnabled) === "1";
}
