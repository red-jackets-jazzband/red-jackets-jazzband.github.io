import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createAbcjsStub, withAbcjs } from "../../../tests/helpers/stubs.js";
import { createAudioPlayer } from "./audio-player.js";

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

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

test("initForTune's setTune passes voicesOff computed from the mixer's Melody/Comping mute state", async () => {
  const { ctx, audio, cleanup } = setup({ compingActive: true, mixer: { melodyMuted: true, compingMuted: false } });
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();
    assert.deepEqual(abcjs.calls.setTune.at(-1).params.voicesOff, [0]);

    ctx.state.mixer = { melodyMuted: false, compingMuted: true };
    withAbcjs(abcjs, () => audio.stop()); // re-primes via setTune with fresh synthParams
    await flush();
    assert.deepEqual(abcjs.calls.setTune.at(-1).params.voicesOff, [1]);

    ctx.state.mixer = { melodyMuted: false, compingMuted: false };
    withAbcjs(abcjs, () => audio.stop());
    await flush();
    assert.equal("voicesOff" in abcjs.calls.setTune.at(-1).params, false);
  } finally {
    cleanup();
  }
});

test("initForTune's setTune fully mutes when melody is off and there's no comping voice", async () => {
  const { audio, cleanup } = setup({ compingActive: false, mixer: { melodyMuted: true, compingMuted: false } });
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: {} }));
    await flush();
    assert.equal(abcjs.calls.setTune.at(-1).params.voicesOff, true);
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

test("a Tempo nudge on a never-played sheet doesn't light up a chord cell", async () => {
  const { ctx, audio, cleanup } = setup();
  const abcjs = createAbcjsStub({ audioSupported: true });
  try {
    withAbcjs(abcjs, () => audio.initForTune({ metaText: { tempo: { bpm: 120 } } }));
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

test("setRepeatBoundaries is accepted (shape from scanRepeatBoundaries)", () => {
  const { audio, cleanup } = setup();
  try {
    assert.doesNotThrow(() => audio.setRepeatBoundaries({ start: 1, end: 4 }));
    assert.doesNotThrow(() => audio.setRepeatBoundaries({ start: undefined, end: undefined }));
  } finally {
    cleanup();
  }
});
