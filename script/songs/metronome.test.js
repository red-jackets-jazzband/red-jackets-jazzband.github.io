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
      assert.equal(instance.oscillators.length, 0);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("enabling the toggle while the sheet is already playing starts clicking immediately", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { ctx, cleanup } = setup({ isPlaying: true });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      assert.equal(ctx.state.metronomeEnabled, true);
      t.mock.timers.tick(25);
      assert.ok(instance.oscillators.length >= 1, "expected at least one scheduled click");
      // The very first click of a (re)start is always beat 1 — unaccented.
      assert.equal(instance.oscillators[0].frequency.value, 1000);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("playClick shapes a square-wave click: fast linear attack from near-zero, exponential decay, and a stop just past the decay", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { cleanup } = setup({ isPlaying: true });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      t.mock.timers.tick(25);
      assert.ok(instance.oscillators.length >= 1);
      const [osc] = instance.oscillators;
      const [gain] = instance.gains;
      assert.equal(osc.type, "square");
      const startTime = osc.startedAt;
      assert.deepEqual(gain.events, [
        ["set", 0.0001, startTime],
        ["linear", 1000 === osc.frequency.value ? 0.22 : 0.5, startTime + 0.001],
        ["exp", 0.0001, startTime + 0.05],
      ]);
      assert.equal(osc.stoppedAt, startTime + 0.05 + 0.02);
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
  const { ctx, metronome, cleanup } = setup({ isPlaying: true });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      t.mock.timers.tick(25);
      const [osc] = instance.oscillators;
      assert.equal(typeof osc.onended, "function");
      let stopCalls = 0;
      const originalStop = osc.stop.bind(osc);
      osc.stop = (...args) => { stopCalls += 1; originalStop(...args); };
      osc.onended(); // the click finished naturally, as a real AudioContext would fire it

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
  const { ctx, metronome, cleanup } = setup({ isPlaying: false });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click(); // enabled, but not yet playing
      t.mock.timers.tick(25);
      assert.equal(instance.oscillators.length, 0);

      ctx.audio.isPlaying = true;
      metronome.onPlaybackChange(true);
      t.mock.timers.tick(25);
      const afterStart = instance.oscillators.length;
      assert.ok(afterStart >= 1);

      ctx.audio.isPlaying = false;
      metronome.onPlaybackChange(false);
      t.mock.timers.tick(200); // well past another click if it were still running
      assert.equal(instance.oscillators.length, afterStart);

      // stop() must actually flip `running` back to false — otherwise a
      // later restart's "shouldRun && !running" gate never re-opens.
      ctx.audio.isPlaying = true;
      metronome.onPlaybackChange(true);
      t.mock.timers.tick(25);
      assert.ok(instance.oscillators.length > afterStart, "expected clicking to resume after a stop");
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("syncRunning is a no-op while already running in the same direction — a redundant onPlaybackChange(true) doesn't stop the click", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { metronome, cleanup } = setup({ isPlaying: true });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      t.mock.timers.tick(25);
      const afterStart = instance.oscillators.length;
      assert.ok(afterStart >= 1);

      metronome.onPlaybackChange(true); // redundant — already running
      // Jump the fake audio clock well past the next due beat — otherwise
      // the lookahead window hasn't moved and no further click would be due
      // regardless of running state.
      instance.currentTime = 2;
      t.mock.timers.tick(25);
      assert.ok(instance.oscillators.length > afterStart, "expected clicking to continue, not stop");
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("stopping cuts off a click already scheduled inside the lookahead window, not just future ticks", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { ctx, metronome, cleanup } = setup({ isPlaying: true });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      t.mock.timers.tick(25);
      assert.ok(instance.oscillators.length >= 1);
      const [firstClick] = instance.oscillators;
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

test("accents land on beats 2 & 4 for a 4/4 tune, read live off ctx.audio", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { cleanup } = setup({ isPlaying: true, nativeQpm: 240, beatsPerMeasure: 4 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      tickThroughBeats(t, instance, 0.25, 4); // 240 bpm -> 0.25s/beat
      const frequencies = instance.oscillators.map((o) => o.frequency.value);
      assert.ok(frequencies.length >= 4, `expected at least 4 clicks, got ${frequencies.length}`);
      assert.deepEqual(frequencies.slice(0, 4), [1000, 1500, 1000, 1500]);
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("a 3/4 tune never accents (no beat 4 to lean on)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { cleanup } = setup({ isPlaying: true, nativeQpm: 240, beatsPerMeasure: 3 });
  const { Ctor, instance } = createAudioContextStub();
  try {
    withAudioContext(Ctor, () => {
      document.getElementById("mixerMetronomeToggleBtn").click();
      tickThroughBeats(t, instance, 0.25, 4);
      assert.ok(instance.oscillators.length >= 3);
      assert.ok(instance.oscillators.every((o) => o.frequency.value === 1000));
    });
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});
