import { byId } from "../lib/dom.js";
import {
  DEFAULT_BPM, TEMPO_MIN_BPM, TEMPO_MAX_BPM, clampBpm, resolveBpm, bpmToWarpPercent,
} from "../lib/tempo.js";
import { computeVoicesOff, percentToAbcjsSwing } from "../lib/audio-mix.js";
import { beatsPerMeasure } from "../lib/metronome.js";
import { readPref, writePref, PREF_KEYS } from "../lib/preferences.js";

// The Repeat stepper's bounds: at least one playthrough (no repeat), capped
// at 20 — enough for real practice loops without a runaway value ticking
// away in the background if someone mistypes into the number field.
export const REPEAT_COUNT_MIN = 1;
export const REPEAT_COUNT_MAX = 20;
const REPEAT_COUNT_DEFAULT = 1;

// Two of the three classic MIDI.js soundfont sets (see lib/gm-voices.js's
// doc comment for the third, MusyngKite's own sibling FluidR3_GM, not
// offered here): FatBoy is the long-standing default — a reasonable
// middle-ground size. MusyngKite's samples are markedly richer/more
// realistic (particularly for acoustic instruments like Bass/Chords' new
// Banjo voice) but roughly 5x bigger per instrument fetched, which matters
// more on mobile at a rehearsal than on a desktop — hence a toggle rather
// than just switching the default outright.
// Exported for songs/offline.js's "Download for offline" warm-up, which
// needs to point ABCJS.synth.CreateSynth at the same soundfont set live
// playback is currently using.
export const STANDARD_SOUNDFONT_URL = "https://gleitz.github.io/midi-js-soundfonts/FatBoy/";
export const HIGH_QUALITY_SOUNDFONT_URL = "https://gleitz.github.io/midi-js-soundfonts/MusyngKite/";

const SYNTH_PARAMS = {
  program: 56, // Trumpet (GM)
};

const PLAY_ICON = '<span class="fa-solid fa-play" aria-hidden="true"></span>';
const PAUSE_ICON = '<span class="fa-solid fa-pause" aria-hidden="true"></span>';
const LOADING_ICON = '<span class="fa-solid fa-spinner fa-spin" aria-hidden="true"></span>';
// Mirrors mp3-export.js's own IDLE_ICON: a render superseding an in-flight
// export leaves that export's button stuck on its spinner (its own finally
// block's generation guard skips the reset since it's no longer current), so
// the new render's enable path below must restore it itself.
const EXPORT_MP3_IDLE_ICON = '<span class="fa-solid fa-file-audio" aria-hidden="true"></span>';

function setButtonsDisabled(disabled) {
  ["playPauseBtn", "stopBtn", "mixerBtn", "exportMp3Btn"].forEach((id) => {
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
// the same access pattern. Guarded step by step here (unlike irealpro.js)
// since this feeds a background timer (songs/metronome.js's scheduler): a
// missing staff/meter should fall back quietly, not throw out of a
// setInterval tick.
function meterValueOf(visualObj) {
  const line = visualObj && visualObj.lines && visualObj.lines[0];
  const staff = line && line.staff && line.staff[0];
  const meter = staff && staff.meter;
  return meter && meter.value;
}

// A pickup/anacrusis's length, in beats — both abcjs methods return a
// fraction of a whole note (e.g. 0.25 = a quarter note), the same unit, so
// dividing gives a beat count directly. Guarded the same way as
// meterValueOf: this also feeds songs/metronome.js's scheduler, and a tune
// with no pickup (the common case) reports a getPickupLength() of 0.
function pickupBeatsOf(visualObj) {
  if (!visualObj || typeof visualObj.getPickupLength !== "function"
    || typeof visualObj.getBeatLength !== "function") return 0;
  const beatLength = visualObj.getBeatLength();
  if (!beatLength) return 0;
  return visualObj.getPickupLength() / beatLength;
}

// Calls fn() and reports {ok: false} if it throws synchronously, instead of
// letting that throw propagate — shared by tryRepeat()'s own seek() and
// play() calls, since both need the same "warn and back out" recovery.
function tryCall(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    console.warn("Repeat restart failed:", err);
    return { ok: false };
  }
}

/*
  Owns the sheet's audio: the ABCjs SynthController lifecycle, the transport
  buttons' visual state, note/chord-cell highlighting during playback, the
  click-to-seek timing map, and the Tempo stepper's effect (SynthController
  warp). sheet.js calls initForTune() after each live render; sheet-controls.js
  wires the buttons to playPause / stop / stepTempo. The Mixer panel
  (songs/mixer.js) reaches this file only for *mute*: ctx.state.mixerVoices
  (the tune's resolved voice list — lib/audio-mix.js's resolveMixerVoices,
  always at least one entry: an ordinary tune's own Melody, a chart's own
  named voices, plus Comping when it's on) feeds computeVoicesOff, which sets
  SynthController's own voicesOff option — the one mechanism proven to
  actually reach the live synth for a regular voice (a generic %%MIDI vol/
  program directive doesn't, unlike ABCjs's own gchord/bass accompaniment
  directives — see lib/audio-mix.js's doc comment). Bass/Chords' volume and
  voice, and every resolved voice's own Voice, are baked into the ABC text
  instead (sheet.js + lib/audio-mix.js's injectMixerAudio) — this file never
  reads ctx.state.mixer(Voices) for those. Swing (ctx.state.swing, the Mixer
  panel's bottom-most, tune-wide fader) is a third case: read directly here
  via lib/audio-mix.js's percentToAbcjsSwing into ABCjs's own `swing` synth
  init option, since it's neither a per-voice mute nor a %%MIDI text directive.
*/
export function createAudioPlayer(ctx) {
  const state = {
    synthController: null,
    isPlaying: false,
    isLoadingPlayback: false,
    // True once playback has been paused (not stopped) at least once since
    // the tune loaded or was last Stopped — see playPause()'s own doc
    // comment for why this, and not just "isPlaying flipped to true", is
    // what tells songs/metronome.js's start() whether a Play is resuming
    // mid-tune or genuinely beginning from position 0.
    pausedMidway: false,
    // Playthroughs completed since the current Play sequence's fresh start —
    // reset to 0 on a genuine fresh Play, a Stop, or loading a new tune; see
    // tryRepeat()'s own doc comment for how this drives the Repeat stepper.
    repeatsPlayed: 0,
    totalMs: 0,
    // Set by buildTimingMap — see its own doc comment. undefined for a tune
    // with no pickup (or before any tune has loaded).
    firstBarMs: undefined,
    currentVisualObj: null,
    nativeQpm: null,
    transposeSemitones: 0,
    chordOffset: 0,
    repeatStart: undefined,
    repeatEnd: undefined,
    // Bumped on every initForTune() call (a new song, or a same-song
    // re-render from a Key/Tempo/Comping change) so an in-flight Export MP3
    // (songs/mp3-export.js) can tell whether the sheet it started rendering
    // is still the one on screen once its offline synth finally resolves.
    renderGeneration: 0,
    // Bumped on every explicit stop() — see tryRepeat()'s own doc comment for
    // why this exists: an onFinished-triggered repeat restart is deferred a
    // macrotask, and a Stop pressed in that window reuses the *same*
    // SynthController (just reset via setTune), so the restart's own
    // `sc !== state.synthController` guard can't tell a Stop happened.
    stopToken: 0,
  };

  let highlighted = [];
  let highlightedChordCell = null;

  // The options for a fresh, offline ABCJS.synth.CreateSynth() render of the
  // current tune (songs/mp3-export.js) — everything synthParams() also feeds
  // the live SynthController, plus a tempo. CreateSynth has no setWarp; its
  // only tempo knob is millisecondsPerMeasure, so the Tempo stepper's warp
  // percentage (100% = the tune's own Q:) is applied the same way setWarp
  // applies it internally: scale the tune's native ms/measure by 100/warp%.
  // Also hands over the Repeat stepper's own count and repeatRestartFraction
  // (see its own doc comment) so mp3-export.js's repeatAudioBuffer can render
  // the same practice loop — pickup skipped on every pass but the first —
  // into the exported file, rather than the export always being a single
  // playthrough regardless of what the sheet is set to loop.
  function exportSynthOptions() {
    const visualObj = state.currentVisualObj;
    if (!visualObj || typeof visualObj.millisecondsPerMeasure !== "function") return null;
    const warpPercent = bpmToWarpPercent(ctx.state.tempoOverrideBpm, state.nativeQpm);
    return {
      visualObj,
      millisecondsPerMeasure: (visualObj.millisecondsPerMeasure() * 100) / warpPercent,
      options: synthParams(),
      repeatCount: ctx.state.repeatCount,
      restartFraction: repeatRestartFraction(),
    };
  }

  function synthParams() {
    const params = {
      ...SYNTH_PARAMS,
      soundFontUrl: ctx.state.highQualityAudio ? HIGH_QUALITY_SOUNDFONT_URL : STANDARD_SOUNDFONT_URL,
      swing: percentToAbcjsSwing(ctx.state.swing),
    };
    const { voicesOff } = computeVoicesOff(ctx.state.mixerVoices);
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

  // Swaps the Repeat stepper's caption between its resting "repeats" label
  // and live progress ("2 of 4") while a multi-repeat playthrough is
  // actually running, so practicing on a loop shows where you are in it.
  function updateRepeatLabel() {
    const label = byId("repeatCountLabel");
    if (!label) return;
    const total = ctx.state.repeatCount;
    label.textContent = state.isPlaying && total > 1
      ? `${state.repeatsPlayed + 1} of ${total}`
      : "repeats";
  }

  // Every place playback starts/stops/pauses funnels through here — one spot
  // to keep the play button and the Metronome (songs/metronome.js, which only
  // ticks while the sheet is actually playing) both in step with it, instead
  // of each of the 5 call sites repeating "set the flag, then update the
  // button" and risking a new one that forgets the metronome notification.
  // `fromStart` is only meaningful when `playing` is true — it tells the
  // metronome whether this is a genuine start from position 0 (its own
  // chordless-intro/pickup timing applies) or a resume/mid-playback toggle
  // (it should tick immediately, unphased — see playPause()'s doc comment).
  function setIsPlaying(playing, fromStart = false) {
    state.isPlaying = playing;
    state.isLoadingPlayback = false;
    updatePlayButton();
    updateRepeatLabel();
    ctx.metronome.onPlaybackChange(playing, fromStart);
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

  // Tells the Metronome (songs/metronome.js) whenever real playback crosses
  // into a new measure — the one honest phase reference its own independent
  // click clock ever gets, used to correct a guessed phase (a toggle enabled
  // mid-playback, or a resume from a pause) and to realign after a tempo
  // change reprimes ABCjs's MIDI buffer. Guarded the same way highlightEvent
  // is just below: ABCjs also fires this callback from setWarp()'s own
  // internal seek even on a sheet that's paused, which isn't a real bar
  // line actually passing. Also passes along the measure index (the same
  // tagging highlightEvent reads via _abcMeasureIdx) so the metronome can
  // tell a chordless-intro bar apart from a real one and not resync itself
  // straight through the delay start() already applied for that intro.
  function notifyMetronomeBarStart(ev) {
    if (!ev || !ev.measureStart) return;
    const ctrl = state.synthController;
    if (!ctrl || !ctrl.isStarted) return;
    ctx.metronome.onBarStart(ev.elements ? firstTaggedMeasure(ev.elements) : undefined);
  }

  // Shared by every way a repeat restart can fail to actually get audio
  // going again — falls back to the same clean stop onFinished uses when
  // repeats are exhausted, rather than leaving state.isPlaying stuck true
  // with nothing actually playing.
  function stopAfterFailedRepeat() {
    setIsPlaying(false);
    state.pausedMidway = false;
    clearHighlight();
  }

  /*
    Practicing on a loop: a tune that finishes naturally restarts from the
    top instead of stopping, as long as fewer playthroughs have completed
    than the Repeat stepper's count (ctx.state.repeatCount, always >= 1 —
    see setRepeatCount). Only a *natural* finish loops this way — an
    explicit Stop, or loading a new tune, always resets repeatsPlayed to 0,
    so the next Play starts a fresh count.
    sc.seek(...) + sc.play() mirrors what a fresh Play already does on a
    stopped controller (isStarted is false once a tune finishes — see
    playPause()'s own doc comment on that toggle) rather than reaching for
    ABCjs's own isLooping/toggleLoop: that loops forever and skips the
    onFinished callback entirely (confirmed by reading the vendored
    SynthController source), leaving nothing here to count playthroughs from.

    The seek+play is deferred a macrotask (setTimeout 0) rather than run
    synchronously from onFinished — confirmed empirically (instrumenting the
    real vendored SynthController in a browser) that calling sc.play() inline
    here races the *same* Timer's own cleanup for the playthrough that just
    ended: ABCJS's Timer.doTiming() detects "reached the end" and calls this
    onFinished synchronously, but only *after* onFinished returns does it
    queue `shouldStop(...).then(() => timer.stop())` for that finished
    playthrough. That queued stop() still resets the Timer's isRunning flag
    to false once it runs — and since it's the same Timer instance a
    synchronous restart here just re-armed (via the repeat's own
    timer.start()), that reset can land *after* the repeat's restart and
    silently kill its own "reached the end" detection: the repeat's audio
    genuinely keeps playing, but ABCJS never calls onFinished again, so the
    UI (and this loop) gets stuck showing that playthrough forever. A
    setTimeout(0) reliably runs after that pending microtask has settled, so
    the repeat's timer.start() is the last thing to touch isRunning.

    An explicit Stop pressed in that same deferred window is a second race
    this guards against, separately from the `sc !== state.synthController`
    check above: stop() resets and reuses the *same* SynthController (via
    setTune) rather than swapping in a new one, so that identity check alone
    can't tell a Stop happened — without state.stopToken, this callback would
    still seek+play right after a Stop, silently resuming audio the user just
    told to stop. stopTokenAtSchedule is captured before the setTimeout, and
    stop() bumps state.stopToken, so a Stop in between makes the two disagree.
  */
  function tryRepeat() {
    if (state.repeatsPlayed + 1 >= ctx.state.repeatCount) return false;
    const sc = state.synthController;
    if (!sc || typeof sc.seek !== "function" || typeof sc.play !== "function") return false;
    clearHighlight();

    const stopTokenAtSchedule = state.stopToken;
    setTimeout(() => {
      if (sc !== state.synthController) return;
      if (state.stopToken !== stopTokenAtSchedule) return;
      if (!tryCall(() => sc.seek(repeatRestartFraction())).ok) {
        stopAfterFailedRepeat();
        return;
      }

      // sc.play() can throw synchronously (before returning any promise to
      // resolve/catch) as well as reject asynchronously, the same as in
      // playPause() — guard both so a failed restart falls back to a clean
      // stop instead of leaving state.isPlaying stuck true with nothing
      // actually playing. Only commit repeatsPlayed/the label once play()
      // is confirmed not to have thrown synchronously.
      const played = tryCall(() => sc.play());
      if (!played.ok) {
        stopAfterFailedRepeat();
        return;
      }

      state.repeatsPlayed += 1;
      updateRepeatLabel();
      Promise.resolve(played.value).catch((err) => {
        console.warn("Repeat restart failed:", err);
        // Same two-part guard as above, not just the controller identity
        // check: this rejection can land well after it was attached (a real
        // async failure), by which time a Stop + fresh Play may have already
        // reused this exact controller for a genuinely new playthrough — the
        // stopToken check is what tells a stale rejection from *this*
        // failed restart apart from that new one.
        if (sc !== state.synthController) return;
        if (state.stopToken !== stopTokenAtSchedule) return;
        stopAfterFailedRepeat();
      });
    }, 0);
    return true;
  }

  // Where a repeat restarts: the true top (fraction 0) for an ordinary tune,
  // but a tune with a pickup/anacrusis instead restarts at the first double
  // bar — state.firstBarMs, the offset of measureIdx 1 (the pickup itself is
  // always measureIdx 0) — so the lead-in note(s) aren't replayed every time
  // round the loop. This also keeps the chord-table cursor aligned with the
  // chord schema on the restart: resolveChordCell maps straight off the same
  // measureIdx the audio is actually at, pickup skipped or not, so it always
  // lands on the same cell real (non-repeat) playback would.
  function repeatRestartFraction() {
    if (pickupBeatsOf(state.currentVisualObj) > 0
      && state.firstBarMs !== undefined && state.totalMs > 0) {
      return Math.max(0, Math.min(1, state.firstBarMs / state.totalMs));
    }
    return 0;
  }

  const cursorControl = {
    onStart: clearHighlight,
    onEvent(ev) {
      notifyMetronomeBarStart(ev);
      highlightEvent(ev);
    },
    onFinished() {
      if (tryRepeat()) return;
      setIsPlaying(false);
      // A tune that played to the end restarts from position 0 next time,
      // same as an explicit Stop — the next Play is a fresh start again.
      state.pausedMidway = false;
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

    Also records state.firstBarMs — the ms offset where measureIdx first
    reaches 1, i.e. the tune's first full bar after a pickup/anacrusis (the
    partial first measure is always measureIdx 0). tryRepeat()'s own doc
    comment explains what this feeds: restarting a practice loop at this
    offset instead of 0 for a tune with a pickup, so the loop doesn't replay
    the lead-in note(s) every time round.
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
      let firstBarMs;
      for (const t of timings) {
        if (t.type !== "event" || !t.elements || t.milliseconds === undefined) continue;
        if (t.measureStart && seenFirstEvent) measureIdx += 1;
        seenFirstEvent = true;
        if (measureIdx === 1 && firstBarMs === undefined) firstBarMs = t.milliseconds;
        if (t.milliseconds > maxMs) maxMs = t.milliseconds;
        const taggedIdx = firstTaggedMeasure(t.elements);
        if (taggedIdx !== undefined) {
          measureIdx = taggedIdx;
          continue;
        }
        tagElements(t.elements, t.milliseconds, measureIdx);
      }
      state.totalMs = maxMs + 500; // a little slack so the last note isn't at fraction 1
      state.firstBarMs = firstBarMs;
    } catch (err) {
      console.warn("buildTimingMap error:", err);
    }
  }

  function firstTaggedMeasure(groups) {
    if (!groups) return undefined;
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
    ABCjs 6.7.0 — go() reads millisecondsPerMeasure + warp — so the stepper has
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
    // Read state.pausedMidway *before* this pause (if that's what this call
    // is) flips it below — a Play is only ever "from the start" when nothing
    // has paused it mid-tune since the tune loaded or was last Stopped (both
    // reset pausedMidway to false; onFinished does too, since a tune that
    // played to the end also restarts from position 0 next time).
    const fromStart = starting && !state.pausedMidway;
    // A fresh Play starts a new repeat count from 0 playthroughs completed —
    // a resume/pause mid-loop must not reset progress through it.
    if (fromStart) state.repeatsPlayed = 0;
    // A pause is "effectively instant" (see above), so mark it synchronously
    // rather than waiting on sc.play()'s own promise below — the *next*
    // play, whenever it comes, needs to already know it's resuming mid-tune,
    // not starting fresh. A resume itself doesn't reset this back to false:
    // any later pause/resume in the same session is still a resume.
    if (!starting) state.pausedMidway = true;
    if (starting) {
      state.isLoadingPlayback = true;
      updatePlayButton();
    }

    // sc.play() can throw synchronously (before returning any promise to
    // resolve/catch) as well as reject asynchronously — route both through
    // the same recovery so a synchronous failure doesn't leave
    // isLoadingPlayback stuck and the button unresponsive to retries.
    const recover = (err) => {
      console.warn("Play/pause failed:", err);
      if (sc !== state.synthController) return;
      state.isLoadingPlayback = false;
      updatePlayButton();
    };

    let playResult;
    try {
      playResult = sc.play();
    } catch (err) {
      recover(err);
      return;
    }
    Promise.resolve(playResult)
      .then(() => {
        if (sc !== state.synthController) return;
        setIsPlaying(Boolean(sc.isStarted), fromStart);
      })
      .catch(recover);
  }

  function stop() {
    if (!state.synthController || !state.currentVisualObj) return;
    // Invalidates a repeat restart that's mid-flight in tryRepeat()'s own
    // deferred setTimeout — see its doc comment for why a plain
    // `sc !== state.synthController` check can't catch a Stop on its own.
    state.stopToken += 1;
    try {
      state.synthController.pause();
    } catch {
      // pause on an already-stopped controller can throw — nothing to do.
    }
    setIsPlaying(false);
    state.pausedMidway = false; // resetting to position 0 below — next Play is a fresh start
    state.repeatsPlayed = 0;
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
    state.renderGeneration += 1;
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
    state.pausedMidway = false; // a freshly (re)loaded tune's next Play is a fresh start
    state.repeatsPlayed = 0;
    state.totalMs = 0;
    state.firstBarMs = undefined;
    state.currentVisualObj = visualObj;
    // ABCjs's own getBpm(), not a raw read of metaText.tempo.bpm: a tune with
    // no Q: field at all has metaText.tempo undefined, but ABCjs's synth
    // still plays it at its own default tempo (180qpm, or 120 for a compound
    // meter whose numerator isn't itself 3 — see getBpm's own fallback) —
    // reading metaText.tempo.bpm directly left nativeQpm null for every such
    // tune, so resolveBpm fell back to this codebase's own DEFAULT_BPM (120)
    // instead, mismatching the audio's actual tempo and dragging the
    // metronome (and the Tempo stepper's displayed native bpm) out of sync
    // with real playback.
    state.nativeQpm = typeof visualObj.getBpm === "function" ? visualObj.getBpm() : null;
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
        const exportBtn = byId("exportMp3Btn");
        if (exportBtn) exportBtn.innerHTML = EXPORT_MP3_IDLE_ICON;
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

  // Called from the Repeat stepper (sheet-controls.js): clamps and persists
  // the chosen playthrough count, and syncs the field back to the clamped
  // value (a manually typed out-of-range number is otherwise left showing
  // whatever was typed, not what actually took effect).
  function setRepeatCount(value) {
    const parsed = Number(value);
    const count = Number.isFinite(parsed)
      ? Math.min(REPEAT_COUNT_MAX, Math.max(REPEAT_COUNT_MIN, Math.round(parsed)))
      : REPEAT_COUNT_DEFAULT;
    ctx.state.repeatCount = count;
    writePref(PREF_KEYS.repeatCount, String(count));
    const input = byId("repeatCount");
    if (input) input.value = String(count);
    updateRepeatLabel();
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
    // The things songs/metronome.js needs to keep its click in step with the
    // loaded tune: its own Q: tempo (resolveBpm falls back to this when the
    // Tempo stepper hasn't been touched), its time signature (read the same
    // way lib/irealpro.js reads it off the same visualObj), how many leading
    // chordless bars it has (so the click can skip a rubato/no-chord intro
    // instead of ticking through it — see resolveChordCell above for the
    // same offset used to align the chord table), and its pickup length (so
    // a tune that starts on a partial measure doesn't throw off which beat
    // is the backbeat from the very first tick).
    get nativeQpm() {
      return state.nativeQpm;
    },
    get beatsPerMeasure() {
      return beatsPerMeasure(meterValueOf(state.currentVisualObj));
    },
    get chordOffset() {
      return state.chordOffset;
    },
    get pickupBeats() {
      return pickupBeatsOf(state.currentVisualObj);
    },
    // songs/mp3-export.js reads this before its offline synth's await chain
    // and again after, to tell whether a newer render (a song switch, or a
    // same-song Key/Tempo/Comping re-render) has since superseded the export
    // it started.
    get renderGeneration() {
      return state.renderGeneration;
    },
    setRepeatBoundaries({ start, end }) {
      state.repeatStart = start;
      state.repeatEnd = end;
    },
    buildExportOptions: exportSynthOptions,
    setRepeatCount,
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

// ctx.state.repeatCount's initial value, seeded from the persisted pref
// (default 1 — no repeat) — built here for the same reason loadMetronomeState
// lives in metronome.js: the persistence/defaulting logic sits next to the
// module that owns the rest of this state.
export function loadRepeatCountState() {
  const raw = Number(readPref(PREF_KEYS.repeatCount));
  return Number.isInteger(raw) && raw >= REPEAT_COUNT_MIN && raw <= REPEAT_COUNT_MAX
    ? raw
    : REPEAT_COUNT_DEFAULT;
}
