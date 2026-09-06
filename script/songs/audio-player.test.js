import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createAbcjsStub, withAbcjs } from "../../../tests/helpers/stubs.js";
import { createAudioPlayer } from "./audio-player.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    withAbcjs(abcjs, () => audio.initForTune({ metaText: { tempo: { bpm: 100 } } }));
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

test("toggleMelody flips the flag, updates the button and re-renders", () => {
  const { audio, rerenders, cleanup } = setup();
  try {
    assert.equal(audio.melodOff, false);
    audio.toggleMelody();
    assert.equal(audio.melodOff, true);
    const btn = document.getElementById("melodyOffBtn");
    assert.ok(btn.classList.contains("active"));
    assert.match(btn.innerHTML, /microphone-lines-slash/);
    assert.equal(btn.getAttribute("aria-label"), "Unmute melody");
    assert.equal(rerenders.length, 1);
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

test("setRepeatBoundaries is accepted (shape from scanRepeatBoundaries)", () => {
  const { audio, cleanup } = setup();
  try {
    assert.doesNotThrow(() => audio.setRepeatBoundaries({ start: 1, end: 4 }));
    assert.doesNotThrow(() => audio.setRepeatBoundaries({ start: undefined, end: undefined }));
  } finally {
    cleanup();
  }
});
