import { byId } from "../lib/dom.js";
import {
  DEFAULT_BPM, TEMPO_MIN_BPM, TEMPO_MAX_BPM, clampBpm, resolveBpm, bpmToWarpPercent,
} from "../lib/tempo.js";
import { computeVoicesOff, percentToAbcjsSwing } from "../lib/audio-mix.js";
import { beatsPerMeasure } from "../lib/metronome.js";

// Two of the three classic MIDI.js soundfont sets (see lib/gm-voices.js's
// doc comment for the third, MusyngKite's own sibling FluidR3_GM, not
// offered here): FatBoy is the long-standing default — a reasonable
// middle-ground size. MusyngKite's samples are markedly richer/more
// realistic (particularly for acoustic instruments like Bass/Chords' new
// Banjo voice) but roughly 5x bigger per instrument fetched, which matters
// more on mobile at a rehearsal than on a desktop — hence a toggle rather
// than just switching the default outright.
const STANDARD_SOUNDFONT_URL = "https://gleitz.github.io/midi-js-soundfonts/FatBoy/";
const HIGH_QUALITY_SOUNDFONT_URL = "https://gleitz.github.io/midi-js-soundfonts/MusyngKite/";

const SYNTH_PARAMS = {
  program: 56, // Trumpet (GM)
};

const PLAY_ICON = '<span class="fa-solid fa-play" aria-hidden="true"></span>';
const PAUSE_ICON = '<span class="fa-solid fa-pause" aria-hidden="true"></span>';
const LOADING_ICON = '<span class="fa-solid fa-spinner fa-spin" aria-hidden="true"></span>';

function setButtonsDisabled(disabled) {
  ["playPauseBtn", "stopBtn", "mixerBtn"].forEach((id) => {
    const btn = byId(id);
    if (btn) btn.disabled = disabled;
  });
}

function setLoadingVisible(visible) {
  const label = byId("audioLoadingLabel");
  if (label) label.classList.toggle("visible", visible);
}

function tagElements(groups, milliseconds, measureIdx) {
  groups.forEach((group) => group.forEach((node) => {
    node._abcSeekMs = milliseconds;
    node._abcMeasureIdx = measureIdx;
  }));
}

// abcjs's own tune-object shape for the M: field — see lib/irealpro.js for
// the same access pattern. Optional-chained here (unlike irealpro.js) since
// this feeds a background timer (songs/metronome.js's scheduler): a missing
// staff/meter should fall back quietly, not throw out of a setInterval tick.
function meterValueOf(visualObj) {
  return visualObj?.lines?.[0]?.staff?.[0]?.meter?.value;
}

/*
  Owns the sheet's audio: the ABCjs SynthController lifecycle, the transport
  buttons' visual state, note/chord-cell highlighting during playback, the
  click-to-seek timing map, and the Tempo stepper's effect (SynthController
  warp). sheet.js calls initForTune() after each live render; sheet-controls.js
  wires the buttons to playPause / stop / stepTempo. The Mixer panel
  (songs/mixer.js) reaches this file only for Melody/Comping *mute*, through
  computeVoicesOff below — SynthController's own voicesOff option, the one
  mechanism proven to actually reach the live synth for a regular voice (a
  generic %%MIDI vol/program directive doesn't, unlike ABCjs's own gchord/bass
  accompaniment directives — see lib/audio-mix.js's doc comment). Bass/Chords'
  volume and voice, and Melody/Comping's voice, are baked into the ABC text
  instead (sheet.js + lib/audio-mix.js's injectMixerAudio) — this file never
  reads ctx.state.mixer for those. Swing (ctx.state.swing, the Mixer panel's
  bottom-most, tune-wide fader) is a third case: read directly here via
  lib/audio-mix.js's percentToAbcjsSwing into ABCjs's own `swing` synth init
  option, since it's neither a per-voice mute nor a %%MIDI text directive.
*/
export function createAudioPlayer(ctx) {
  const state = {
    synthController: null,
    isPlaying: false,
    isLoadingPlayback: false,
    totalMs: 0,
    currentVisualObj: null,
    nativeQpm: null,
    transposeSemitones: 0,
    chordOffset: 0,
    repeatStart: undefined,
    repeatEnd: undefined,
  };

  let highlighted = [];
  let highlightedChordCell = null;

  function synthParams() {
    const params = {
      ...SYNTH_PARAMS,
      soundFontUrl: ctx.state.highQualityAudio ? HIGH_QUALITY_SOUNDFONT_URL : STANDARD_SOUNDFONT_URL,
      swing: percentToAbcjsSwing(ctx.state.swing),
    };
    const { voicesOff } = computeVoicesOff({
      compingActive: ctx.state.compingActive,
      melodyMuted: ctx.state.mixer.melodyMuted,
      compingMuted: ctx.state.mixer.compingMuted,
    });
    if (voicesOff !== undefined) params.voicesOff = voicesOff;
    if (state.transposeSemitones) params.midiTranspose = state.transposeSemitones;
    return params;
  }

  // ---- transport button state -------------------------------------------

  function updatePlayButton() {
    const btn = byId("playPauseBtn");
    if (!btn) return;
    if (state.isLoadingPlayback) {
      btn.innerHTML = LOADING_ICON;
      btn.title = "Loading…";
      btn.classList.remove("playing");
      return;
    }
    btn.innerHTML = state.isPlaying ? PAUSE_ICON : PLAY_ICON;
    btn.title = state.isPlaying ? "Pause" : "Play";
    btn.classList.toggle("playing", state.isPlaying);
  }

  // Every place playback starts/stops/pauses funnels through here — one spot
  // to keep the play button and the Metronome (songs/metronome.js, which only
  // ticks while the sheet is actually playing) both in step with it, instead
  // of each of the 5 call sites repeating "set the flag, then update the
  // button" and risking a new one that forgets the metronome notification.
  function setIsPlaying(playing) {
    state.isPlaying = playing;
    state.isLoadingPlayback = false;
    updatePlayButton();
    ctx.metronome.onPlaybackChange(playing);
  }

  // ---- highlighting -----------------------------------------------------

  function clearHighlight() {
    highlighted.forEach((node) => node.classList.remove("abcjs-current-note"));
    highlighted = [];
    if (highlightedChordCell) {
      highlightedChordCell.classList.remove("chordCell-playing");
      highlightedChordCell = null;
    }
  }

  function resolveChordCell(measureIdx) {
    const offset = state.chordOffset || 0;
    if (measureIdx < offset) return null;
    const cells = document.querySelectorAll("#chordtable .chordCell");
    if (cells.length === 0) return null;
    let cellIdx = measureIdx - offset;
    if (cellIdx >= cells.length) {
      const { repeatStart: rs, repeatEnd: re } = state;
      cellIdx = rs !== undefined && re !== undefined
        ? rs + ((cellIdx - rs) % (re - rs + 1))
        : cellIdx % cells.length;
    }
    return cellIdx >= 0 && cellIdx < cells.length ? cells[cellIdx] : null;
  }

  function highlightEvent(ev) {
    if (!ev || !ev.elements) return;
    // ABCjs fires an event callback from the internal seek(0) at the tail of
    // every SynthController.setWarp() — so a Tempo nudge on a sheet that was
    // never played would otherwise light up the first chord cell. Only paint
    // the play cursor while the synth is actually running; a seek while paused
    // keeps whatever highlight it already had.
    const ctrl = state.synthController;
    if (!ctrl || !ctrl.isStarted) return;
    clearHighlight();
    const next = [];
    ev.elements.forEach((group) => group.forEach((node) => {
      node.classList.add("abcjs-current-note");
      next.push(node);
    }));
    highlighted = next;
    if (next.length > 0 && next[0]._abcMeasureIdx !== undefined) {
      const cell = resolveChordCell(next[0]._abcMeasureIdx);
      if (cell) {
        cell.classList.add("chordCell-playing");
        highlightedChordCell = cell;
      }
    }
  }

  const cursorControl = {
    onStart: clearHighlight,
    onEvent: highlightEvent,
    onFinished() {
      setIsPlaying(false);
      clearHighlight();
    },
    onBeat() {},
  };

  // ---- timing map (click-to-seek) -------------------------------------

  /*
    Pre-compute the millisecond offset of every note element (el._abcSeekMs)
    and a visual measure index (el._abcMeasureIdx) that lines up 1:1 with the
    chord-table cells. noteTimings walks the tune in playback order, so a
    repeated section is visited twice — keep the first visit's values, and
    when a repeat brings us back to an already-tagged measure, snap the running
    measure counter back to that measure's stored index.
  */
  function buildTimingMap(visualObj) {
    if (typeof ABCJS.TimingCallbacks !== "function") return;
    try {
      const tc = new ABCJS.TimingCallbacks(visualObj, {
        eventCallback: () => true,
        beatCallback: () => true,
      });
      const timings = tc.noteTimings || [];
      let maxMs = 0;
      let measureIdx = 0;
      let seenFirstEvent = false;
      for (const t of timings) {
        if (t.type !== "event" || !t.elements || t.milliseconds === undefined) continue;
        if (t.measureStart && seenFirstEvent) measureIdx += 1;
        seenFirstEvent = true;
        if (t.milliseconds > maxMs) maxMs = t.milliseconds;
        const taggedIdx = firstTaggedMeasure(t.elements);
        if (taggedIdx !== undefined) {
          measureIdx = taggedIdx;
          continue;
        }
        tagElements(t.elements, t.milliseconds, measureIdx);
      }
      state.totalMs = maxMs + 500; // a little slack so the last note isn't at fraction 1
    } catch (err) {
      console.warn("buildTimingMap error:", err);
    }
  }

  function firstTaggedMeasure(groups) {
    for (const group of groups) {
      for (const node of group) {
        if (node._abcMeasureIdx !== undefined) return node._abcMeasureIdx;
      }
    }
    return undefined;
  }

  function seekToMs(ms) {
    const sc = state.synthController;
    if (!sc || state.totalMs <= 0 || typeof sc.seek !== "function") return;
    sc.seek(Math.max(0, Math.min(1, ms / state.totalMs)));
    if (state.isPlaying && typeof sc.play === "function") sc.play();
  }

  function handleNotationClick(e) {
    const notation = byId("notation");
    let node = e.target;
    while (node && node !== notation) {
      if (node._abcSeekMs !== undefined) {
        seekToMs(node._abcSeekMs);
        return;
      }
      node = node.parentElement;
    }
  }

  // ---- tempo -----------------------------------------------------------

  function updateTempoLabel() {
    const label = byId("tempoValueLabel");
    if (label) label.textContent = String(Math.round(resolveBpm(ctx.state.tempoOverrideBpm, state.nativeQpm)));
  }

  /*
    Apply the current tempo through SynthController.setWarp (a percentage of the
    tune's own Q: tempo). setTune's `qpm` option does not drive playback in
    ABCjs 6.6.4 — go() reads millisecondsPerMeasure + warp — so the stepper has
    to go through setWarp, which re-primes the MIDI buffer and resumes playback
    itself if it was running.
  */
  function applyTempo() {
    const ctrl = state.synthController;
    if (!ctrl || typeof ctrl.setWarp !== "function") return;
    Promise.resolve(ctrl.setWarp(bpmToWarpPercent(ctx.state.tempoOverrideBpm, state.nativeQpm)))
      .then(() => {
        if (ctrl !== state.synthController) return;
        setIsPlaying(Boolean(ctrl.isStarted));
      })
      .catch((err) => console.warn("Tempo change failed:", err));
  }

  function stepTempo(delta) {
    const base = ctx.state.tempoOverrideBpm !== null
      ? ctx.state.tempoOverrideBpm
      : (state.nativeQpm || DEFAULT_BPM);
    ctx.state.tempoOverrideBpm = clampBpm(base + delta);
    updateTempoLabel();
    applyTempo();
  }

  // ---- transport ------------------------------------------------------

  /*
    ABCjs's SynthController.play() is itself a toggle keyed on its internal
    `isStarted` flag — calling it resumes if paused and pauses if playing. Its
    pause() does NOT flip that flag, so mixing the two (pause() to pause,
    play() to resume) desyncs the controller and the first play() after a
    pause just toggles the flag back without restarting the audio, needing
    extra presses to recover. So drive both directions through play() and read
    the real state back from `isStarted` once its promise settles.
  */
  function playPause() {
    const sc = state.synthController;
    if (!sc || typeof sc.play !== "function") return;
    const btn = byId("playPauseBtn");
    if (btn && btn.disabled) return; // audio still loading / mid-reset
    if (state.isLoadingPlayback) return; // already starting — ignore a second press

    // Starting from a stop/pause isn't instant — SynthController primes its
    // MIDI buffer before the first sample plays, and that gap is exactly
    // where a press otherwise looks ignored. Swap in a spinner for it;
    // pausing an already-playing tune is effectively instant, so it's left
    // showing the Pause icon throughout.
    const starting = !state.isPlaying;
    if (starting) {
      state.isLoadingPlayback = true;
      updatePlayButton();
    }
    Promise.resolve(sc.play())
      .then(() => {
        if (sc !== state.synthController) return;
        setIsPlaying(Boolean(sc.isStarted));
      })
      .catch((err) => {
        console.warn("Play/pause failed:", err);
        if (sc !== state.synthController) return;
        state.isLoadingPlayback = false;
        updatePlayButton();
      });
  }

  function stop() {
    if (!state.synthController || !state.currentVisualObj) return;
    try {
      state.synthController.pause();
    } catch {
      // pause on an already-stopped controller can throw — nothing to do.
    }
    setIsPlaying(false);
    clearHighlight();
    setButtonsDisabled(true);

    // Re-run setTune on the existing controller to reset its midiBuffer +
    // timingCallbacks back to position 0 (soundfont buffers stay decoded).
    const ctrl = state.synthController;
    const settle = () => {
      if (ctrl !== state.synthController) return;
      clearHighlight();
      setButtonsDisabled(false);
    };
    ctrl.setTune(state.currentVisualObj, false, synthParams())
      .then(settle)
      .catch((err) => {
        console.warn("Stop reset failed:", err);
        settle();
      });
  }

  function initForTune(visualObj) {
    if (!ABCJS.synth || typeof ABCJS.synth.supportsAudio !== "function"
      || !ABCJS.synth.supportsAudio()) {
      return;
    }

    if (state.synthController) {
      try {
        state.synthController.pause();
      } catch {
        // discarding the old controller — a throw here is harmless.
      }
      state.synthController = null;
    }
    setIsPlaying(false);
    state.totalMs = 0;
    state.currentVisualObj = visualObj;
    state.nativeQpm = (visualObj.metaText && visualObj.metaText.tempo && visualObj.metaText.tempo.bpm) || null;
    setButtonsDisabled(true);
    setLoadingVisible(true);

    buildTimingMap(visualObj);

    state.synthController = new ABCJS.synth.SynthController();
    const ctrl = state.synthController;
    // pause() above can't stop a controller whose own setTune/go or a
    // tempo change's setWarp is still mid-flight (e.g. it's between
    // destroying its old timer and priming a new one) — there's nothing
    // running yet to pause. Left unguarded, that stale controller's own
    // onStart/onEvent/onFinished still lands on the shared cursorControl
    // below once its async chain unwinds, and — since highlightEvent's own
    // guard only checks the *current* controller's isStarted, not which
    // controller actually fired — it repaints the cursor at its own stale
    // position on top of (or instead of) wherever the new controller
    // actually is, which is what makes the highlight look like it's
    // jumping between two positions. Tying every callback to the
    // controller that was current when load() was called closes that off.
    ctrl.load("#abc-player-container", {
      onStart() { if (ctrl === state.synthController) cursorControl.onStart(); },
      onEvent(ev) { if (ctrl === state.synthController) cursorControl.onEvent(ev); },
      onFinished() { if (ctrl === state.synthController) cursorControl.onFinished(); },
      onBeat() {},
    }, {
      displayLoop: false,
      displayRestart: false,
      displayPlay: false,
      displayProgress: false,
      // Container is display:none so nothing shows, but this makes
      // SynthController build the .abcjs-midi-tempo element its own setWarp()
      // writes to, so the Tempo stepper can drive it.
      displayWarp: true,
    });

    ctrl.setTune(visualObj, false, synthParams())
      .then(() => {
        if (ctrl !== state.synthController) return;
        setLoadingVisible(false);
        setButtonsDisabled(false);
        if (ctx.state.tempoOverrideBpm !== null) applyTempo();
      })
      .catch((err) => {
        console.warn("Audio could not load:", err);
        if (ctrl !== state.synthController) return;
        setLoadingVisible(false);
      });
  }

  function setupNotationClickHandler() {
    const notation = byId("notation");
    if (!notation || notation._abcClickHandlerSet) return;
    notation._abcClickHandlerSet = true;
    notation.addEventListener("click", handleNotationClick);
  }

  return {
    set transposeSemitones(value) {
      state.transposeSemitones = value;
    },
    set chordOffset(value) {
      state.chordOffset = value;
    },
    get isPlaying() {
      return state.isPlaying;
    },
    // The two things songs/metronome.js needs to keep its click in step with
    // the loaded tune: its own Q: tempo (resolveBpm falls back to this when
    // the Tempo stepper hasn't been touched) and its time signature, read the
    // same way lib/irealpro.js reads it off the same visualObj.
    get nativeQpm() {
      return state.nativeQpm;
    },
    get beatsPerMeasure() {
      return beatsPerMeasure(meterValueOf(state.currentVisualObj));
    },
    setRepeatBoundaries({ start, end }) {
      state.repeatStart = start;
      state.repeatEnd = end;
    },
    initForTune,
    setupNotationClickHandler,
    updateTempoLabel,
    applyTempo,
    stepTempo,
    playPause,
    stop,
    TEMPO_BOUNDS: { min: TEMPO_MIN_BPM, max: TEMPO_MAX_BPM },
  };
}
