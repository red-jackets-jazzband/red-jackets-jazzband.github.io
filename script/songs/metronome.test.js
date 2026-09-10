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
