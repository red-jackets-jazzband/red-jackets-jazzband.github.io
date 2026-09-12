import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createAudioContextStub, withAudioContext } from "../../../tests/helpers/stubs.js";
import { createMetronome, loadMetronomeState } from "./metronome.js";

function setup(audioOverrides = {}) {
  const page = mountPage();
  const ctx = makeCtx({
    audio: {
      isPlaying: false,
      nativeQpm: 120,
      beatsPerMeasure: 4,
      ...audioOverrides,
    },
  });
  const metronome = createMetronome(ctx);
  metronome.init();
  return { page, ctx, metronome, cleanup: page.cleanup };
}

test("loadMetronomeState defaults to off, and reflects a persisted '1'", () => {
  const page = mountPage();
  try {
    assert.equal(loadMetronomeState(), false);
    window.localStorage.setItem("rj.metronomeEnabled", "1");
    assert.equal(loadMetronomeState(), true);
  } finally {
    window.localStorage.clear();
    page.cleanup();
  }
});

test("init renders the toggle off by default", () => {
  const { cleanup } = setup();
  try {
    const btn = document.getElementById("mixerMetronomeToggleBtn");
    assert.equal(btn.classList.contains("is-active"), false);
    assert.equal(btn.getAttribute("aria-pressed"), "false");
    assert.equal(btn.querySelector(".fa-solid").classList.contains("fa-toggle-off"), true);
    assert.equal(btn.title, "Enable metronome");
  } finally {
    cleanup();
  }
});

test("clicking the toggle flips ctx.state.metronomeEnabled, persists it, and updates the button", () => {
  const { ctx, cleanup } = setup();
  try {
    const btn = document.getElementById("mixerMetronomeToggleBtn");
    btn.click();
    assert.equal(ctx.state.metronomeEnabled, true);
    assert.equal(window.localStorage.getItem("rj.metronomeEnabled"), "1");
    assert.equal(btn.classList.contains("is-active"), true);
    assert.equal(btn.getAttribute("aria-pressed"), "true");
    assert.equal(btn.querySelector(".fa-solid").classList.contains("fa-toggle-on"), true);
    assert.equal(btn.title, "Disable metronome");

    btn.click();
    assert.equal(ctx.state.metronomeEnabled, false);
    assert.equal(window.localStorage.getItem("rj.metronomeEnabled"), "0");
    assert.equal(btn.classList.contains("is-active"), false);
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("enabling the toggle while the sheet isn't playing schedules no clicks", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { ctx, cleanup } = setup({ isPlaying: false });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      assert.equal(ctx.state.metronomeEnabled, true);
      t.mock.timers.tick(1000);
      assert.equal(instance.bufferSources.length, 0);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("enabling the toggle while the sheet is already playing starts clicking once the backbeat arrives", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { ctx, cleanup } = setup({ isPlaying: true });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      assert.equal(ctx.state.metronomeEnabled, true);
      t.mock.timers.tick(25);
      // The very first beat of a (re)start is the downbeat — a 4/4 tune's
      // backbeat-only hihat doesn't sound on it.
      assert.equal(instance.bufferSources.length, 0);

      // Still inside the lookahead window for the first backbeat (beat 2, due
      // at t=0.53) rather than past it — jumping past nextNoteTime would trip
      // scheduleClicks's own catch-up path (see lib/metronome.test.js) and
      // skip straight over the click this test wants to observe.
      instance.currentTime = 0.5;
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 1);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("playClick shapes a closed-hihat tick: noise through a highpass+bandpass filter, fast attack, short exponential decay", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  // beatsPerMeasure: 3 has no backbeat to gate on (see lib/metronome.js's
  // hasBackbeat), so every beat ticks — this test is about the click's own
  // sound shape, not about which beats get gated.
  const { cleanup } = setup({ isPlaying: true, beatsPerMeasure: 3 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 1);
      const [source] = instance.bufferSources;
      const [highpass, bandpass] = instance.biquadFilters;
      const [gain] = instance.gains;

      assert.equal(source.buffer, instance.buffers[0]);
      assert.equal(highpass.type, "highpass");
      assert.equal(highpass.frequency.value, 7000);
      assert.equal(bandpass.type, "bandpass");
      assert.equal(bandpass.frequency.value, 10000);
      assert.equal(bandpass.Q.value, 1.5);

      const startTime = source.startedAt;
      assert.deepEqual(gain.events, [
        ["set", 0.0001, startTime],
        ["linear", 0.16, startTime + 0.001],
        ["exp", 0.0001, startTime + 0.045],
      ]);
      assert.equal(source.stoppedAt, startTime + 0.045 + 0.02);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("starting the metronome resumes a suspended AudioContext (autoplay-policy browsers); a running one is left alone", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { cleanup } = setup({ isPlaying: true });
  const { Ctor, instance } = createAudioContextStub();
  instance.state = "suspended";
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      assert.equal(instance.resumeCalls, 1);
      assert.equal(instance.state, "running"); // the stub's resume() flips it back
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("starting the metronome doesn't resume an already-running AudioContext", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { cleanup } = setup({ isPlaying: true });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      assert.equal(instance.resumeCalls, 0);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("the AudioContext is created once and reused across stop/start cycles, not rebuilt every time", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { ctx, metronome, cleanup } = setup({ isPlaying: true });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click(); // start
      assert.equal(instance.constructorCalls, 1);

      ctx.audio.isPlaying = false;
      metronome.onPlaybackChange(false); // stop

      ctx.audio.isPlaying = true;
      metronome.onPlaybackChange(true); // start again
      assert.equal(instance.constructorCalls, 1);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("init reflects an already-enabled ctx.state.metronomeEnabled on the button without waiting for a click", () => {
  const page = mountPage();
  const ctx = makeCtx({
    state: { metronomeEnabled: true },
    audio: { isPlaying: false, nativeQpm: 120, beatsPerMeasure: 4 },
  });
  try {
    createMetronome(ctx).init();
    const btn = document.getElementById("mixerMetronomeToggleBtn");
    assert.equal(btn.classList.contains("is-active"), true);
    assert.equal(btn.getAttribute("aria-pressed"), "true");
    assert.equal(btn.querySelector(".fa-solid").classList.contains("fa-toggle-on"), true);
    assert.equal(btn.title, "Disable metronome");
  } finally {
    page.cleanup();
  }
});

test("a click's own onended handler removes it from the tracked list, so stop() doesn't try to stop it again", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { ctx, metronome, cleanup } = setup({ isPlaying: true, beatsPerMeasure: 3 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      t.mock.timers.tick(25);
      const [source] = instance.bufferSources;
      assert.equal(typeof source.onended, "function");
      let stopCalls = 0;
      const originalStop = source.stop.bind(source);
      source.stop = (...args) => { stopCalls += 1; originalStop(...args); };
      source.onended(); // the click finished naturally, as a real AudioContext would fire it

      ctx.audio.isPlaying = false;
      metronome.onPlaybackChange(false); // stop() must not still be holding a reference to it
      assert.equal(stopCalls, 0);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("without Web Audio support (no window.AudioContext), enabling the toggle degrades to a no-op instead of throwing", () => {
  const { ctx, metronome, cleanup } = setup({ isPlaying: true });
  try {
    assert.doesNotThrow(() => {
      document.getElementById("mixerMetronomeToggleBtn").click();
    });
    assert.equal(ctx.state.metronomeEnabled, true);
    assert.doesNotThrow(() => metronome.onPlaybackChange(true));
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("onPlaybackChange starts the click when enabled and stops it when playback stops", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  // beatsPerMeasure: 3 has no backbeat to gate on, so every beat ticks —
  // this test is about the start/stop lifecycle, not accent placement.
  const { ctx, metronome, cleanup } = setup({ isPlaying: false, beatsPerMeasure: 3 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click(); // enabled, but not yet playing
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 0);

      ctx.audio.isPlaying = true;
      metronome.onPlaybackChange(true);
      t.mock.timers.tick(25);
      const afterStart = instance.bufferSources.length;
      assert.ok(afterStart >= 1);

      ctx.audio.isPlaying = false;
      metronome.onPlaybackChange(false);
      t.mock.timers.tick(200); // well past another click if it were still running
      assert.equal(instance.bufferSources.length, afterStart);

      // stop() must actually flip `running` back to false — otherwise a
      // later restart's "shouldRun && !running" gate never re-opens.
      ctx.audio.isPlaying = true;
      metronome.onPlaybackChange(true);
      t.mock.timers.tick(25);
      assert.ok(instance.bufferSources.length > afterStart, "expected clicking to resume after a stop");
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("syncRunning is a no-op while already running in the same direction — a redundant onPlaybackChange(true) doesn't stop the click", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { metronome, cleanup } = setup({ isPlaying: true, beatsPerMeasure: 3 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      t.mock.timers.tick(25);
      const afterStart = instance.bufferSources.length;
      assert.ok(afterStart >= 1);

      metronome.onPlaybackChange(true); // redundant — already running
      // Jump the fake audio clock well past the next due beat — otherwise
      // the lookahead window hasn't moved and no further click would be due
      // regardless of running state.
      instance.currentTime = 2;
      t.mock.timers.tick(25);
      assert.ok(instance.bufferSources.length > afterStart, "expected clicking to continue, not stop");
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("stopping cuts off a click already scheduled inside the lookahead window, not just future ticks", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { ctx, metronome, cleanup } = setup({ isPlaying: true, beatsPerMeasure: 3 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      t.mock.timers.tick(25);
      assert.ok(instance.bufferSources.length >= 1);
      const [firstClick] = instance.bufferSources;
      const scheduledStop = firstClick.stoppedAt;
      assert.notEqual(scheduledStop, undefined); // playClick already gave it a natural stop time

      ctx.audio.isPlaying = false;
      metronome.onPlaybackChange(false);

      // stop() re-calls .stop() with no argument — the fake records that as
      // stoppedAt becoming undefined, proving it was cut off immediately
      // rather than left to finish on its own original schedule.
      assert.equal(firstClick.stoppedAt, undefined);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

// Advances the fake audio clock one beat at a time (in step with a tick),
// rather than one big jump — a jump far enough behind nextNoteTime would
// trip scheduleClicks's own catch-up path (see lib/metronome.test.js),
// which is exactly what's already covered there; this only wants to prove
// songs/metronome.js wires ctx.audio's live bpm/beatsPerMeasure through to
// real scheduled clicks under ordinary, non-degenerate pacing.
function tickThroughBeats(t, instance, secondsPerBeat, count) {
  for (let i = 0; i < count; i += 1) {
    instance.currentTime = i * secondsPerBeat;
    t.mock.timers.tick(25);
  }
}

test("ticks land only on the backbeat (beats 2 & 4) for a 4/4 tune, read live off ctx.audio", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { cleanup } = setup({ isPlaying: true, nativeQpm: 240, beatsPerMeasure: 4 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      tickThroughBeats(t, instance, 0.25, 8); // 240 bpm -> 0.25s/beat, 2 measures
      const times = instance.bufferSources.map((s) => s.startedAt);
      // Only every other beat (the backbeat) ticks, so consecutive hits are
      // a full beat apart from each other, not half a measure.
      assert.equal(times.length, 4);
      for (let i = 1; i < times.length; i += 1) {
        assert.ok(Math.abs((times[i] - times[i - 1]) - 0.5) < 1e-9);
      }
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

// The intro/pickup timing below only ever applies to a genuine Play from
// position 0 (start()'s `fromStart` flag — see its own doc comment), so
// these tests arm the toggle while the sheet isn't playing yet (a plain
// click wouldn't reach start() at all) and then simulate audio-player.js's
// own fresh-start signal directly, the same way playPause()/setIsPlaying
// would for a Play with nothing paused mid-tune since the last Stop/load.
function startFresh(ctx, metronome) {
  ctx.audio.isPlaying = true;
  metronome.onPlaybackChange(true, true);
}

test("holds off ticking during a rubato/chordless intro (ctx.audio.chordOffset), then starts on schedule", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  // beatsPerMeasure: 3 has no backbeat to gate on, so this is purely about
  // the intro delay, not accent placement. 2 intro bars * 3 beats * 0.5s = 3s.
  const { ctx, metronome, cleanup } = setup({ isPlaying: false, beatsPerMeasure: 3, chordOffset: 2 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      startFresh(ctx, metronome);
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 0, "no click during the intro");

      // Still inside the lookahead window for the first post-intro click
      // (due at t=3.03) rather than past it, for the same reason as the
      // "starts clicking once the backbeat arrives" test above.
      instance.currentTime = 3;
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 1);
      assert.equal(instance.bufferSources[0].startedAt, 3.03);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("a tune with no intro (chordOffset 0, the default) ticks immediately, unaffected by the intro delay", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { ctx, metronome, cleanup } = setup({ isPlaying: false, beatsPerMeasure: 3, chordOffset: 0 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      startFresh(ctx, metronome);
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 1);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("a pickup phases the clock so its own beat lands correctly in the backbeat pattern", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  // A 1-beat pickup into a 4/4 tune with no chordless intro: the pickup note
  // itself is beat 4 of a phantom measure, so it's a backbeat and clicks
  // immediately instead of being (wrongly) treated as an unaccented beat 1.
  const { ctx, metronome, cleanup } = setup({ isPlaying: false, chordOffset: 0, pickupBeats: 1 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      startFresh(ctx, metronome);
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 1);
      assert.ok(Math.abs(instance.bufferSources[0].startedAt - 0.03) < 1e-9);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("a pickup that's a whole number of measures doesn't shift the clock's phase", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { ctx, metronome, cleanup } = setup({ isPlaying: false, chordOffset: 0, pickupBeats: 4 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      startFresh(ctx, metronome);
      t.mock.timers.tick(25);
      // beat index 0 (the downbeat) — no click, same as the no-pickup case.
      assert.equal(instance.bufferSources.length, 0);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("an intro to skip always resumes the clock at beat 1, regardless of any pickup", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  // 1 pickup beat + 1 full 4-beat bar = 5 beats * 0.5s/beat = 2.5s delay,
  // landing exactly on a bar line at t=2.53 (beat 1) — not phased by the
  // pickup the way the no-intro tests above are.
  const { ctx, metronome, cleanup } = setup({ isPlaying: false, chordOffset: 2, pickupBeats: 1 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      startFresh(ctx, metronome);
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 0, "still inside the intro delay");

      instance.currentTime = 2.5; // inside the window for the bar line at t=2.53
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 0, "beat 1 itself doesn't click");

      instance.currentTime = 3.0; // inside the window for the backbeat at t=3.03
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 1);
      assert.equal(instance.bufferSources[0].startedAt, 3.03);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("a 3/4 tune ticks every beat (no backbeat to lean on)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { cleanup } = setup({ isPlaying: true, nativeQpm: 240, beatsPerMeasure: 3 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      tickThroughBeats(t, instance, 0.25, 4);
      assert.ok(instance.bufferSources.length >= 4);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("resuming from a mid-tune pause ticks immediately, without reapplying the intro delay", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  // beatsPerMeasure: 3 has no backbeat to gate on, so every scheduled click
  // sounds -- this is purely about whether the intro delay reapplies.
  const { ctx, metronome, cleanup } = setup({ isPlaying: false, beatsPerMeasure: 3, chordOffset: 2 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      startFresh(ctx, metronome); // a genuine fresh start -- the 3s intro delay applies
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 0, "still inside the intro delay");

      // Pause mid-intro, then resume -- this mirrors audio-player.js's
      // playPause(), which marks a pause as pausedMidway so the following
      // resume is passed fromStart: false, not true.
      ctx.audio.isPlaying = false;
      metronome.onPlaybackChange(false);
      ctx.audio.isPlaying = true;
      metronome.onPlaybackChange(true, false);
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 1, "resume ticks immediately, not after another 3s delay");
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("enabling the metronome mid-playback ticks immediately, without applying the intro delay", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  // The sheet is already playing (from some earlier, untracked point) when
  // the toggle itself is what starts the click -- never a "from the top" Play.
  const { cleanup } = setup({
    isPlaying: true, beatsPerMeasure: 3, chordOffset: 2, pickupBeats: 1,
  });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      t.mock.timers.tick(25);
      assert.equal(instance.bufferSources.length, 1, "ticks immediately, not after the 3s intro delay");
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});
