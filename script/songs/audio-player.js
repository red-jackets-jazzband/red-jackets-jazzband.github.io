import { byId } from "../lib/dom.js";
import {
  DEFAULT_BPM, TEMPO_MIN_BPM, TEMPO_MAX_BPM, clampBpm, resolveBpm, bpmToWarpPercent,
} from "../lib/tempo.js";

const SYNTH_PARAMS = {
  soundFontUrl: "https://gleitz.github.io/midi-js-soundfonts/FatBoy/",
  program: 56, // Trumpet (GM)
};

const PLAY_ICON = '<span class="fa-solid fa-play" aria-hidden="true"></span>';
const PAUSE_ICON = '<span class="fa-solid fa-pause" aria-hidden="true"></span>';
const MELODY_ON_ICON = '<span class="fa-solid fa-microphone-lines" aria-hidden="true"></span>';
const MELODY_OFF_ICON = '<span class="fa-solid fa-microphone-lines-slash" aria-hidden="true"></span>';

/*
  Owns the sheet's audio: the ABCjs SynthController lifecycle, the transport
  buttons' visual state, note/chord-cell highlighting during playback, the
  click-to-seek timing map, and the Tempo stepper's effect (SynthController
  warp). sheet.js calls initForTune() after each live render; sheet-controls.js
  wires the buttons to playPause / stop / toggleMelody / stepTempo.
*/
export function createAudioPlayer(ctx) {
  const state = {
    synthController: null,
    isPlaying: false,
    totalMs: 0,
    currentVisualObj: null,
    nativeQpm: null,
    melodOff: false,
    transposeSemitones: 0,
    chordOffset: 0,
    repeatStart: undefined,
    repeatEnd: undefined,
  };

  let highlighted = [];
  let highlightedChordCell = null;

  function synthParams() {
    const params = { ...SYNTH_PARAMS };
    if (state.melodOff) params.voicesOff = ctx.state.compingActive ? [0] : true;
    if (state.transposeSemitones) params.midiTranspose = state.transposeSemitones;
    return params;
  }

  // ---- transport button state -------------------------------------------

  function updatePlayButton() {
    const btn = byId("playPauseBtn");
    if (!btn) return;
    btn.innerHTML = state.isPlaying ? PAUSE_ICON : PLAY_ICON;
    btn.title = state.isPlaying ? "Pause" : "Play";
    btn.classList.toggle("playing", state.isPlaying);
  }

  function updateMelodyButton() {
    const btn = byId("melodyOffBtn");
    if (!btn) return;
    btn.classList.toggle("active", state.melodOff);
    btn.innerHTML = state.melodOff ? MELODY_OFF_ICON : MELODY_ON_ICON;
    const label = state.melodOff ? "Unmute melody" : "Mute melody";
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  function setButtonsDisabled(disabled) {
    ["playPauseBtn", "stopBtn", "melodyOffBtn"].forEach((id) => {
      const btn = byId(id);
      if (btn) btn.disabled = disabled;
    });
  }

  function setLoadingVisible(visible) {
    const label = byId("audioLoadingLabel");
    if (label) label.classList.toggle("visible", visible);
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
      state.isPlaying = false;
      updatePlayButton();
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

  function tagElements(groups, milliseconds, measureIdx) {
    groups.forEach((group) => group.forEach((node) => {
      node._abcSeekMs = milliseconds;
      node._abcMeasureIdx = measureIdx;
    }));
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
        state.isPlaying = Boolean(ctrl.isStarted);
        updatePlayButton();
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
    Promise.resolve(sc.play())
      .then(() => {
        if (sc !== state.synthController) return;
        state.isPlaying = Boolean(sc.isStarted);
        updatePlayButton();
      })
      .catch((err) => console.warn("Play/pause failed:", err));
  }

  function stop() {
    if (!state.synthController || !state.currentVisualObj) return;
    try {
      state.synthController.pause();
    } catch {
      // pause on an already-stopped controller can throw — nothing to do.
    }
    state.isPlaying = false;
    updatePlayButton();
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

  function toggleMelody() {
    state.melodOff = !state.melodOff;
    updateMelodyButton();
    ctx.sheet.rerender();
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
    state.isPlaying = false;
    state.totalMs = 0;
    state.currentVisualObj = visualObj;
    state.nativeQpm = (visualObj.metaText && visualObj.metaText.tempo && visualObj.metaText.tempo.bpm) || null;
    updatePlayButton();
    updateMelodyButton();
    setButtonsDisabled(true);
    setLoadingVisible(true);

    buildTimingMap(visualObj);

    state.synthController = new ABCJS.synth.SynthController();
    state.synthController.load("#abc-player-container", cursorControl, {
      displayLoop: false,
      displayRestart: false,
      displayPlay: false,
      displayProgress: false,
      // Container is display:none so nothing shows, but this makes
      // SynthController build the .abcjs-midi-tempo element its own setWarp()
      // writes to, so the Tempo stepper can drive it.
      displayWarp: true,
    });

    const ctrl = state.synthController;
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
    get melodOff() {
      return state.melodOff;
    },
    set melodOff(value) {
      state.melodOff = value;
    },
    set transposeSemitones(value) {
      state.transposeSemitones = value;
    },
    set chordOffset(value) {
      state.chordOffset = value;
    },
    get isPlaying() {
      return state.isPlaying;
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
    toggleMelody,
    TEMPO_BOUNDS: { min: TEMPO_MIN_BPM, max: TEMPO_MAX_BPM },
  };
}
