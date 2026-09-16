import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createAbcjsStub, withAbcjs } from "../../../tests/helpers/stubs.js";
import { createAudioPlayer, loadRepeatCountState } from "./audio-player.js";

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const SPINNER_SELECTOR = ".fa-spinner";

function setup(stateOverrides = {}) {
  const page = mountPage();
  const rerenders = [];
  const ctx = makeCtx({
    state: { tempoOverrideBpm: null, compingActive: false, ...stateOverrides },
    sheet: { rerender: () => rerenders.push(1) },
  });
  const audio = createAudioPlayer(ctx);
  return { page, ctx, audio, rerenders, cleanup: page.cleanup };
}

// A pickup note (measureIdx 0) followed by the first full bar (measureIdx 1)
// at 500ms, then one more note at 1000ms — shared by every pickup-aware
// repeat-restart test below; only the visualObj's own getPickupLength/
// getBeatLength decide whether tryRepeat treats it as having a pickup to skip.
const PICKUP_SHAPED_TIMINGS = [
  { type: "event", elements: [[{}]], milliseconds: 0 }, // the pickup note
  { type: "event", elements: [[{}]], milliseconds: 500, measureStart: true }, // first full bar
  { type: "event", elements: [[{}]], milliseconds: 1000 },
];

// Boots a tune under stub audio for the repeat-loop tests below: init+flush
// happens immediately, but the "Play" step is deferred to the returned
// play() so a test needing to assert something in between (e.g. the Repeat
// label's resting state before Play) still can. play() returns the current
// SynthController stub each time it's called, since a Stop + fresh Play
// swaps in a new one.
async function setupPlayingTune(stateOverrides = {}, { visualObj = { metaText: {} }, noteTimings } = {}) {
  const { audio, cleanup } = setup(stateOverrides);
  const abcjs = createAbcjsStub({ audioSupported: true });
  if (noteTimings) abcjs._noteTimings = noteTimings;
  withAbcjs(abcjs, () => audio.initForTune(visualObj));
  await flush();
  async function play() {
    withAbcjs(abcjs, () => audio.playPause());
    await flush();
    return abcjs.calls.synthControllers.at(-1);
  }
  return {
    audio, abcjs, cleanup, play,
  };
}

// Boots a tune already sitting at the moment a repeat restart just fired —
// shared by the pickup/no-pickup restart-fraction tests below.
async function setupAtRepeatRestart(visualObj) {
  const {
    audio, abcjs, cleanup, play,
  } = await setupPlayingTune({ repeatCount: 2 }, { visualObj, noteTimings: PICKUP_SHAPED_TIMINGS });
  const sc = await play();
  withAbcjs(abcjs, () => sc._cursorControl.onFinished());
  return { audio, abcjs, cleanup };
}

test("updateTempoLabel shows the override, else the tune's native tempo", () => {
  const { ctx, audio, cleanup } = setup();
  try {
    audio.updateTempoLabel();
    assert.equal(document.getElementById("tempoValueLabel").textContent, "120"); // DEFAULT_BPM
    ctx.state.tempoOverrideBpm = 168;
    audio.updateTempoLabel();
    assert.equal(document.getElementById("tempoValueLabel").textContent, "168");
  } finally {
    cleanup();
  }
});

test("stepTempo seeds from the tune's native tempo, then steps and clamps", async () => {
  const { ctx, audio, cleanup } = setup();
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: { tempo: { bpm: 100 } }, getBpm: () => 100 }));
    await flush();
    withAbcjs(abcjs, () => audio.stepTempo(4));
    assert.equal(ctx.state.tempoOverrideBpm, 104); // 100 (native) + 4
    withAbcjs(abcjs, () => audio.stepTempo(-400));
    assert.equal(ctx.state.tempoOverrideBpm, 40); // clamped at TEMPO_MIN_BPM
    assert.equal(document.getElementById("tempoValueLabel").textContent, "40");
    await flush();
  } finally {
    cleanup();
  }
});

test("stepTempo with no native tempo steps from the default bpm", () => {
  const { ctx, audio, cleanup } = setup();
  try {
    audio.stepTempo(4);
    assert.equal(ctx.state.tempoOverrideBpm, 124); // DEFAULT_BPM + 4
  } finally {
    cleanup();
  }
});

// audio-player.js's cursorControl.onEvent is where ABCjs reports real
// playback crossing into a new measure (ev.measureStart) — the one honest
// phase reference the Metronome's own independent clock ever gets.
test("a measureStart event tells the Metronome a real bar line just passed, but only while actually playing", async () => {
  const page = mountPage();
  const barStarts = [];
  const ctx = makeCtx({
    state: { tempoOverrideBpm: null, compingActive: false },
    metronome: {
      init: () => {}, refresh: () => {}, onPlaybackChange: () => {},
      onBarStart: () => barStarts.push(1),
    },
  });
  const audio = createAudioPlayer(ctx);
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();

    // Not playing yet (e.g. setWarp's own internal seek on a never-played
    // sheet) — a measureStart here isn't real playback crossing a bar.
    withAbcjs(abcjs, () => abcjs.calls.synthControllers.at(-1)._cursorControl.onEvent({ measureStart: true }));
    assert.equal(barStarts.length, 0, "not forwarded while paused/never played");

    audio.playPause();
    await flush();
    assert.equal(audio.isPlaying, true);

    withAbcjs(abcjs, () => abcjs.calls.synthControllers.at(-1)._cursorControl.onEvent({ measureStart: true }));
    assert.equal(barStarts.length, 1, "forwarded once real playback is running");

    // An ordinary event with no measureStart flag is just a note, not a bar
    // line — shouldn't trigger a resync check at all.
    withAbcjs(abcjs, () => abcjs.calls.synthControllers.at(-1)._cursorControl.onEvent({ elements: [] }));
    assert.equal(barStarts.length, 1, "non-bar events don't forward");
  } finally {
    page.cleanup();
  }
});

test("initForTune's setTune passes voicesOff computed from ctx.state.mixerVoices (melody + comping)", async () => {
  const { ctx, audio, cleanup } = setup({
    mixerVoices: [
      { id: "1", index: 0, label: "Melody", muted: true },
      { id: "2", index: 1, label: "Comping", muted: false },
    ],
  });
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();
    assert.deepEqual(abcjs.calls.setTune.at(-1).params.voicesOff, [0]);

    ctx.state.mixerVoices = [
      { id: "1", index: 0, label: "Melody", muted: false },
      { id: "2", index: 1, label: "Comping", muted: true },
    ];
    withAbcjs(abcjs, () => audio.stop()); // re-primes via setTune with fresh synthParams
    await flush();
    assert.deepEqual(abcjs.calls.setTune.at(-1).params.voicesOff, [1]);

    ctx.state.mixerVoices = [
      { id: "1", index: 0, label: "Melody", muted: false },
      { id: "2", index: 1, label: "Comping", muted: false },
    ];
    withAbcjs(abcjs, () => audio.stop());
    await flush();
    assert.equal("voicesOff" in abcjs.calls.setTune.at(-1).params, false);
  } finally {
    cleanup();
  }
});

test("initForTune's setTune mutes by index for a chart with more than two of its own voices", async () => {
  const { ctx, audio, cleanup } = setup({
    mixerVoices: [
      { id: "1", index: 0, label: "Trumpet", muted: false },
      { id: "2", index: 1, label: "Sousaphone", muted: true },
    ],
  });
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();
    assert.deepEqual(abcjs.calls.setTune.at(-1).params.voicesOff, [1]);

    ctx.state.mixerVoices[0].muted = true;
    withAbcjs(abcjs, () => audio.stop());
    await flush();
    assert.deepEqual(abcjs.calls.setTune.at(-1).params.voicesOff, [0, 1]);

    ctx.state.mixerVoices[0].muted = false;
    ctx.state.mixerVoices[1].muted = false;
    withAbcjs(abcjs, () => audio.stop());
    await flush();
    assert.equal("voicesOff" in abcjs.calls.setTune.at(-1).params, false);
  } finally {
    cleanup();
  }
});

test("a single-entry mixerVoices (an ordinary one-voice tune) mutes as a full mute (true), same as before per-voice channels existed", async () => {
  const { audio, cleanup } = setup({
    mixerVoices: [{ id: "1", index: 0, label: "Melody", muted: true }],
  });
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();
    assert.equal(abcjs.calls.setTune.at(-1).params.voicesOff, true);
  } finally {
    cleanup();
  }
});

test("initForTune's setTune picks the soundfont from ctx.state.highQualityAudio", async () => {
  const { ctx, audio, cleanup } = setup({ highQualityAudio: false });
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();
    assert.equal(
      abcjs.calls.setTune.at(-1).params.soundFontUrl,
      "https://gleitz.github.io/midi-js-soundfonts/FatBoy/",
    );

    ctx.state.highQualityAudio = true;
    withAbcjs(abcjs, () => audio.stop()); // re-primes via setTune with fresh synthParams
    await flush();
    assert.equal(
      abcjs.calls.setTune.at(-1).params.soundFontUrl,
      "https://gleitz.github.io/midi-js-soundfonts/MusyngKite/",
    );
  } finally {
    cleanup();
  }
});

test("initForTune's setTune passes swing mapped from ctx.state.swing onto ABCjs's native 50-75 scale", async () => {
  const { ctx, audio, cleanup } = setup({ swing: 0 });
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();
    assert.equal(abcjs.calls.setTune.at(-1).params.swing, 50); // off

    ctx.state.swing = 100;
    withAbcjs(abcjs, () => audio.stop()); // re-primes via setTune with fresh synthParams
    await flush();
    assert.equal(abcjs.calls.setTune.at(-1).params.swing, 75); // maximum
  } finally {
    cleanup();
  }
});

test("playPause resumes on the first press after pausing (ABCjs play() is a toggle)", async () => {
  const { audio, cleanup } = setup();
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush(); // setTune resolves -> transport buttons enabled

    audio.playPause();
    await flush();
    assert.equal(audio.isPlaying, true);

    audio.playPause(); // pause
    await flush();
    assert.equal(audio.isPlaying, false);

    audio.playPause(); // resume — a single press must restart playback
    await flush();
    assert.equal(audio.isPlaying, true);
  } finally {
    cleanup();
  }
});

// songs/metronome.js's start() only applies its chordless-intro/pickup
// timing for a genuine Play from position 0 -- setIsPlaying's `fromStart`
// argument (threaded through to ctx.metronome.onPlaybackChange) is how it
// knows the difference. These spy on that argument directly rather than on
// any audible effect, since audio-player.js is what computes it.
function setupWithMetronomeSpy(stateOverrides = {}) {
  const page = mountPage();
  const calls = [];
  const barStarts = [];
  const ctx = makeCtx({
    state: { tempoOverrideBpm: null, compingActive: false, ...stateOverrides },
    metronome: {
      init: () => {},
      refresh: () => {},
      onPlaybackChange: (playing, fromStart) => calls.push([playing, fromStart]),
      onBarStart: (measureIdx) => barStarts.push(measureIdx),
    },
  });
  const audio = createAudioPlayer(ctx);
  return {
    page, audio, calls, barStarts, cleanup: page.cleanup,
  };
}

test("playPause reports fromStart:true only for a genuine first Play, never a pause or resume", async () => {
  const { audio, calls, cleanup } = setupWithMetronomeSpy();
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();
    calls.length = 0; // drop initForTune's own setIsPlaying(false)

    audio.playPause(); // first Play, from position 0
    await flush();
    assert.deepEqual(calls.pop(), [true, true]);

    audio.playPause(); // pause
    await flush();
    assert.deepEqual(calls.pop(), [false, false]);

    audio.playPause(); // resume — mid-tune, not from the top
    await flush();
    assert.deepEqual(calls.pop(), [true, false]);
  } finally {
    cleanup();
  }
});

test("playPause reports fromStart:true again after an explicit Stop resets the tune to position 0", async () => {
  const { audio, calls, cleanup } = setupWithMetronomeSpy();
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();

    audio.playPause(); // first Play
    await flush();
    audio.playPause(); // pause mid-tune
    await flush();

    withAbcjs(abcjs, () => audio.stop()); // resets position back to 0
    await flush();
    calls.length = 0;

    audio.playPause(); // Play again — this is a fresh start, not a resume
    await flush();
    assert.deepEqual(calls.pop(), [true, true]);
  } finally {
    cleanup();
  }
});

test("playPause shows a loading spinner while starting, not while pausing", async () => {
  const { audio, cleanup } = setup();
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();

    const btn = document.getElementById("playPauseBtn");
    assert.equal(btn.querySelector(SPINNER_SELECTOR), null);

    audio.playPause(); // starting — sc.play()'s promise hasn't settled yet
    assert.ok(btn.querySelector(SPINNER_SELECTOR));
    assert.equal(btn.classList.contains("playing"), false);
    await flush();
    assert.equal(btn.querySelector(SPINNER_SELECTOR), null);
    assert.equal(btn.classList.contains("playing"), true);

    audio.playPause(); // pausing — no gap to cover, no spinner
    assert.equal(btn.querySelector(SPINNER_SELECTOR), null);
    await flush();
  } finally {
    cleanup();
  }
});

test("a second press while starting is ignored (no double sc.play())", async () => {
  const { audio, cleanup } = setup();
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();

    // The stub's play() toggles isStarted and resolves immediately, so a
    // second, un-ignored call here would flip it right back to false —
    // exactly what the isLoadingPlayback guard exists to prevent.
    audio.playPause();
    audio.playPause(); // still loading from the first press — must be ignored
    await flush();
    assert.equal(audio.isPlaying, true);
  } finally {
    cleanup();
  }
});

test("playPause recovers when sc.play() throws synchronously, and a retry works", async () => {
  const { audio, cleanup } = setup();
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();

    const sc = abcjs.calls.synthControllers.at(-1);
    sc.play = () => { throw new Error("boom"); };
    const btn = document.getElementById("playPauseBtn");

    audio.playPause();
    await flush();
    assert.equal(audio.isPlaying, false);
    assert.equal(btn.querySelector(SPINNER_SELECTOR), null); // isLoadingPlayback cleared
    assert.equal(btn.disabled, false); // not left stuck mid-loading

    sc.play = () => { sc.isStarted = !sc.isStarted; return Promise.resolve(); };
    audio.playPause(); // a retry after the synchronous failure must work normally
    await flush();
    assert.equal(audio.isPlaying, true);
  } finally {
    cleanup();
  }
});

test("playPause is a no-op while the transport buttons are disabled", async () => {
  const { audio, cleanup } = setup();
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    // still loading: setTune hasn't resolved, buttons disabled
    audio.playPause();
    assert.equal(audio.isPlaying, false);
    await flush();
  } finally {
    cleanup();
  }
});

test("initForTune is inert when the browser can't play audio (stub: false)", () => {
  const { audio, cleanup } = setup();
  const abcjs = createAbcjsStub(); // supportsAudio -> false
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    // buttons stay as the page shipped them — no synth controller created
    assert.equal(document.getElementById("playPauseBtn").disabled, true);
  } finally {
    cleanup();
  }
});

test("a Tempo nudge on a never-played sheet doesn't light up a chord cell", async () => {
  const { ctx, audio, cleanup } = setup();
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: { tempo: { bpm: 120 } }, getBpm: () => 120 }));
    await flush();

    // Stand in for the DOM ABCjs would report back through its seek(0) event.
    document.getElementById("chordtable").innerHTML = '<span class="chordCell">C</span>';
    const note = document.createElement("span");
    note._abcMeasureIdx = 0;
    abcjs._warpEventElements = [[note]];

    withAbcjs(abcjs, () => audio.stepTempo(4));
    await flush();

    assert.equal(note.classList.contains("abcjs-current-note"), false);
    assert.equal(
      document.querySelector("#chordtable .chordCell").classList.contains("chordCell-playing"),
      false,
    );

    // While it's actually playing, the same event still moves the cursor.
    withAbcjs(abcjs, () => audio.playPause());
    await flush();
    withAbcjs(abcjs, () => audio.stepTempo(4));
    await flush();
    assert.equal(note.classList.contains("abcjs-current-note"), true);
    assert.ok(document.querySelector("#chordtable .chordCell").classList.contains("chordCell-playing"));
    assert.equal(ctx.state.tempoOverrideBpm, 128);
  } finally {
    cleanup();
  }
});

test("buildExportOptions is null before any tune has loaded", () => {
  const { audio, cleanup } = setup();
  try {
    assert.equal(audio.buildExportOptions(), null);
  } finally {
    cleanup();
  }
});

test("buildExportOptions carries the current visualObj, synth params, and the native tempo at 100% warp", async () => {
  const { audio, cleanup } = setup();
  const abcjs = createAbcjsStub({ audioSupported: true });
  const visualObj = {
    metaText: { tempo: { bpm: 100 } },
    getBpm: () => 100,
    millisecondsPerMeasure: () => 500,
  };
  try {
    withAbcjs(abcjs, () => audio.initForTune(visualObj));
    await flush();

    const built = audio.buildExportOptions();
    assert.equal(built.visualObj, visualObj);
    assert.equal(built.millisecondsPerMeasure, 500); // no override -> 100% warp
    assert.equal(built.options.soundFontUrl, "https://gleitz.github.io/midi-js-soundfonts/FatBoy/");
  } finally {
    cleanup();
  }
});

test("buildExportOptions scales millisecondsPerMeasure by the Tempo stepper's warp, same as setWarp", async () => {
  const { ctx, audio, cleanup } = setup();
  const abcjs = createAbcjsStub({ audioSupported: true });
  const visualObj = {
    metaText: { tempo: { bpm: 100 } },
    getBpm: () => 100,
    millisecondsPerMeasure: () => 500,
  };
  try {
    withAbcjs(abcjs, () => audio.initForTune(visualObj));
    await flush();

    ctx.state.tempoOverrideBpm = 150; // 150% of the native 100 bpm
    assert.equal(audio.buildExportOptions().millisecondsPerMeasure, 500 * 100 / 150);
  } finally {
    cleanup();
  }
});

test("buildExportOptions carries the Repeat stepper's count and its own pickup-aware restart fraction", async () => {
  const { audio, cleanup } = setup({ repeatCount: 4 });
  const abcjs = createAbcjsStub({ audioSupported: true });
  abcjs._noteTimings = PICKUP_SHAPED_TIMINGS;
  try {
    withAbcjs(abcjs, () => audio.initForTune({
      metaText: {},
      millisecondsPerMeasure: () => 500,
      getPickupLength: () => 0.25, // a quarter-note pickup
      getBeatLength: () => 0.25,
    }));
    await flush();

    const built = audio.buildExportOptions();
    assert.equal(built.repeatCount, 4);
    // same fraction the live repeat restart seeks to: firstBarMs(500) / totalMs(1500)
    assert.equal(built.restartFraction, 500 / 1500);
  } finally {
    cleanup();
  }
});

test("buildExportOptions's restartFraction is 0 for a tune with no pickup", async () => {
  const { audio, cleanup } = setup({ repeatCount: 3 });
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {}, millisecondsPerMeasure: () => 500 }));
    await flush();

    const built = audio.buildExportOptions();
    assert.equal(built.repeatCount, 3);
    assert.equal(built.restartFraction, 0);
  } finally {
    cleanup();
  }
});

test("a torn-down controller's belated callback doesn't move the cursor once a newer one has taken over", async () => {
  const { audio, cleanup } = setup();
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();
    const staleCursorControl = abcjs.calls.synthControllers[0]._cursorControl;

    // A second render (e.g. a mixer change, or picking the song again)
    // swaps in a fresh controller while the first is still reachable —
    // pause() can't stop async work the first controller hadn't finished.
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();
    withAbcjs(abcjs, () => audio.playPause());
    await flush();
    assert.equal(audio.isPlaying, true);

    // The stale controller's own setWarp/go from a tempo change made just
    // before the rerender finally unwinds and fires onEvent. It must not
    // repaint the cursor now that it's retired.
    document.getElementById("chordtable").innerHTML = '<span class="chordCell">C</span>';
    const staleNote = document.createElement("span");
    staleNote._abcMeasureIdx = 0;
    staleCursorControl.onEvent({ elements: [[staleNote]] });

    assert.equal(staleNote.classList.contains("abcjs-current-note"), false);
    assert.equal(
      document.querySelector("#chordtable .chordCell").classList.contains("chordCell-playing"),
      false,
    );

    // A belated onFinished from the same stale controller must not stop
    // playback or clear the current highlight either.
    staleCursorControl.onFinished();
    assert.equal(audio.isPlaying, true);
  } finally {
    cleanup();
  }
});

test("loadRepeatCountState defaults to 1, reflects a persisted value, and rejects out-of-range/corrupt values", () => {
  const page = mountPage();
  try {
    assert.equal(loadRepeatCountState(), 1);
    window.localStorage.setItem("rj.repeatCount", "5");
    assert.equal(loadRepeatCountState(), 5);
    window.localStorage.setItem("rj.repeatCount", "999");
    assert.equal(loadRepeatCountState(), 1); // out of range -> default
    window.localStorage.setItem("rj.repeatCount", "banana");
    assert.equal(loadRepeatCountState(), 1);
  } finally {
    window.localStorage.clear();
    page.cleanup();
  }
});

test("onFinished doesn't loop when repeatCount is 1 (the default)", async () => {
  const {
    audio, abcjs, cleanup, play,
  } = await setupPlayingTune({ repeatCount: 1 });
  try {
    const sc = await play();
    assert.equal(audio.isPlaying, true);

    withAbcjs(abcjs, () => sc._cursorControl.onFinished());
    assert.equal(audio.isPlaying, false);
    assert.deepEqual(abcjs.calls.seek, []); // never restarted
  } finally {
    cleanup();
  }
});

test("onFinished replays from the top while fewer playthroughs have completed than repeatCount, then stops", async () => {
  const {
    audio, abcjs, cleanup, play,
  } = await setupPlayingTune({ repeatCount: 3 });
  try {
    const sc = await play();

    withAbcjs(abcjs, () => sc._cursorControl.onFinished()); // 1st playthrough done
    assert.equal(audio.isPlaying, true, "loops instead of stopping");
    assert.deepEqual(abcjs.calls.seek, [0]);

    withAbcjs(abcjs, () => sc._cursorControl.onFinished()); // 2nd playthrough done
    assert.equal(audio.isPlaying, true, "loops again");
    assert.deepEqual(abcjs.calls.seek, [0, 0]);

    withAbcjs(abcjs, () => sc._cursorControl.onFinished()); // 3rd (final) playthrough done
    assert.equal(audio.isPlaying, false, "stops after the requested count");
    assert.deepEqual(abcjs.calls.seek, [0, 0]); // no further restart
  } finally {
    cleanup();
  }
});

test("onFinished recovers when the repeat restart's sc.play() throws synchronously", async () => {
  const {
    audio, abcjs, cleanup, play,
  } = await setupPlayingTune({ repeatCount: 3 });
  try {
    const sc = await play();
    sc.play = () => { throw new Error("boom"); };

    withAbcjs(abcjs, () => sc._cursorControl.onFinished());
    // The seek already happened, but the synchronous throw from play() must
    // fall back to the same clean stop onFinished uses when repeats are
    // exhausted, rather than leaving isPlaying stuck true.
    assert.deepEqual(abcjs.calls.seek, [0]);
    assert.equal(audio.isPlaying, false);
    assert.equal(document.getElementById("repeatCountLabel").textContent, "repeats");
  } finally {
    cleanup();
  }
});

test("onFinished restarts after the pickup (first double bar), not at the very top", async () => {
  const { audio, abcjs, cleanup } = await setupAtRepeatRestart({
    metaText: {},
    getPickupLength: () => 0.25, // a quarter-note pickup
    getBeatLength: () => 0.25, // quarter-note beat -> 1 beat of pickup
  });
  try {
    assert.equal(audio.isPlaying, true);
    // totalMs = maxMs(1000) + 500 slack = 1500; firstBarMs = 500 -> 500/1500
    assert.equal(abcjs.calls.seek.at(-1), 500 / 1500);
  } finally {
    cleanup();
  }
});

test("onFinished restarts at the very top for a tune with no pickup, even with the same noteTimings shape", async () => {
  // No getPickupLength -> pickupBeatsOf is 0.
  const { audio, abcjs, cleanup } = await setupAtRepeatRestart({ metaText: {} });
  try {
    assert.equal(audio.isPlaying, true);
    assert.equal(abcjs.calls.seek.at(-1), 0);
  } finally {
    cleanup();
  }
});

test("Stop resets the repeat count so the next Play starts a fresh loop", async () => {
  const {
    audio, abcjs, cleanup, play,
  } = await setupPlayingTune({ repeatCount: 2 });
  try {
    let sc = await play();
    withAbcjs(abcjs, () => sc._cursorControl.onFinished()); // loops once (1 of 2 done)
    assert.equal(audio.isPlaying, true);

    withAbcjs(abcjs, () => audio.stop());
    await flush();

    sc = await play(); // fresh Play after Stop

    withAbcjs(abcjs, () => sc._cursorControl.onFinished());
    assert.equal(audio.isPlaying, true, "the reset count loops again rather than stopping early");
  } finally {
    cleanup();
  }
});

test("updateRepeatLabel shows live progress while playing a multi-repeat loop", async () => {
  const { abcjs, cleanup, play } = await setupPlayingTune({ repeatCount: 3 });
  try {
    assert.equal(document.getElementById("repeatCountLabel").textContent, "repeats");

    const sc = await play();
    assert.equal(document.getElementById("repeatCountLabel").textContent, "1 of 3");

    withAbcjs(abcjs, () => sc._cursorControl.onFinished());
    assert.equal(document.getElementById("repeatCountLabel").textContent, "2 of 3");

    withAbcjs(abcjs, () => sc._cursorControl.onFinished());
    withAbcjs(abcjs, () => sc._cursorControl.onFinished());
    assert.equal(document.getElementById("repeatCountLabel").textContent, "repeats"); // done
  } finally {
    cleanup();
  }
});

// The metronome (songs/metronome.js) only starts/stops off setIsPlaying's
// own onPlaybackChange notification (see its doc comment) and only resyncs
// its click off a real measureStart event (notifyMetronomeBarStart). A
// repeat restart (tryRepeat) deliberately never calls setIsPlaying — the
// tune never really "stopped" from the metronome's perspective, so its click
// should tick straight through the loop boundary uninterrupted — but real
// playback does still need to keep reporting bar lines afterwards so the
// click stays in phase. These two things are what this test checks.
test("a repeat restart doesn't interrupt the metronome, and it still resyncs on the next real bar line", async () => {
  const { audio, calls, barStarts, cleanup } = setupWithMetronomeSpy({ repeatCount: 2 });
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();
    calls.length = 0; // drop initForTune's own setIsPlaying(false)

    audio.playPause(); // first Play, from position 0
    await flush();
    assert.deepEqual(calls, [[true, true]]);

    const sc = abcjs.calls.synthControllers.at(-1);
    // Mirrors real ABCjs: a natural finish sets isStarted false internally
    // before invoking cursorControl.onFinished (see tryRepeat's own doc
    // comment) — the stub doesn't simulate that step itself, so it's set
    // here to match what notifyMetronomeBarStart's isStarted guard sees for
    // real once tryRepeat's own sc.play() resumes it.
    sc.isStarted = false;
    withAbcjs(abcjs, () => sc._cursorControl.onFinished()); // loops (1 of 2 done)
    assert.equal(audio.isPlaying, true);

    // The loop restart itself must not look like a stop/start cycle to the
    // metronome — no extra onPlaybackChange entry beyond the original Play.
    assert.deepEqual(calls, [[true, true]]);
    // tryRepeat's own sc.play() already resumed the controller synchronously.
    assert.equal(sc.isStarted, true);

    // Real playback crossing the next bar line after the restart must still
    // reach the metronome so its click stays in phase with the loop.
    withAbcjs(abcjs, () => sc._cursorControl.onEvent({ measureStart: true, elements: [] }));
    assert.deepEqual(barStarts, [undefined]); // no tagged measure on this bare event, but it fired
  } finally {
    cleanup();
  }
});

test("setRepeatCount clamps to [1, 20], persists, and syncs the field", async () => {
  const { ctx, audio, cleanup } = setup();
  try {
    audio.setRepeatCount(999);
    assert.equal(ctx.state.repeatCount, 20);
    assert.equal(document.getElementById("repeatCount").value, "20");
    assert.equal(window.localStorage.getItem("rj.repeatCount"), "20");

    audio.setRepeatCount(-5);
    assert.equal(ctx.state.repeatCount, 1);

    audio.setRepeatCount("not a number");
    assert.equal(ctx.state.repeatCount, 1);

    audio.setRepeatCount(4.6);
    assert.equal(ctx.state.repeatCount, 5); // rounded
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("setRepeatBoundaries is accepted (shape from scanRepeatBoundaries)", () => {
  const { audio, cleanup } = setup();
  try {
    assert.doesNotThrow(() => audio.setRepeatBoundaries({ start: 1, end: 4 }));
    assert.doesNotThrow(() => audio.setRepeatBoundaries({ start: undefined, end: undefined }));
  } finally {
    cleanup();
  }
});
