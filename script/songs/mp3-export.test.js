import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createAbcjsStub, withAbcjs, createLamejsStub } from "../../../tests/helpers/stubs.js";
import { initMp3Export } from "./mp3-export.js";

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const SPINNER_SELECTOR = ".fa-spinner";

// jsdom implements neither URL.createObjectURL/revokeObjectURL nor a real
// anchor click's navigation (see lib/dom.test.js's downloadBlob test) — both
// are stubbed here so the export's download step is observable.
function stubDownload() {
  const created = [];
  const revoked = [];
  const clicked = [];
  URL.createObjectURL = (blob) => { created.push(blob); return "blob:fake-url"; };
  URL.revokeObjectURL = (url) => revoked.push(url);
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function click() {
    clicked.push({ href: this.href, download: this.download });
  };
  return {
    created,
    revoked,
    clicked,
    restore() { HTMLAnchorElement.prototype.click = originalClick; },
  };
}

// Unlike ABCJS (only ever touched synchronously, before exportMp3's first
// await — see clickExport below), encodeMp3 reaches for the global lamejs
// after synth.init()/prime() have resolved, so the stub needs to stay
// installed across the whole test, not just the synchronous click.
function stubLamejs() {
  const stub = createLamejsStub();
  const real = globalThis.lamejs;
  globalThis.lamejs = stub;
  return {
    stub,
    restore() {
      if (real === undefined) delete globalThis.lamejs;
      else globalThis.lamejs = real;
    },
  };
}

function setup(audioOverrides) {
  const page = mountPage();
  const ctx = makeCtx({
    state: { currentSongFile: "basin_street.abc" },
    audio: {
      buildExportOptions: () => ({ visualObj: { metaText: {} }, millisecondsPerMeasure: 500, options: {} }),
      ...audioOverrides,
    },
  });
  return { page, ctx, cleanup: page.cleanup };
}

// Wire the button and click it (inside the given ABCJS stub), returning it
// for the test to inspect — before or after awaiting flush(), as needed. The
// button ships `disabled` (audio-player.js only enables it once a tune's
// synth is ready), so a test simulating that state enables it first — a
// disabled button's click() is a no-op, same as in a real browser.
function clickExport(ctx, abcjs) {
  initMp3Export(ctx);
  const btn = document.getElementById("exportMp3Btn");
  btn.disabled = false;
  withAbcjs(abcjs, () => btn.click());
  return btn;
}

test("clicking Export MP3 renders through a fresh CreateSynth and downloads a .mp3 named for the song file", async () => {
  const { ctx, cleanup } = setup();
  const abcjs = createAbcjsStub();
  const download = stubDownload();
  const lamejs = stubLamejs();
  try {
    clickExport(ctx, abcjs);
    await flush();
    await flush();

    assert.equal(abcjs.calls.createSynths.length, 1);
    assert.deepEqual(abcjs.calls.createSynths[0].init, {
      visualObj: { metaText: {} }, millisecondsPerMeasure: 500, options: {},
    });
    assert.equal(download.clicked.length, 1);
    assert.equal(download.clicked[0].download, "basin_street.mp3");
    assert.equal(download.created[0].type, "audio/mpeg");
    assert.equal(download.revoked.length, 1);
    assert.equal(lamejs.stub.calls.constructed.length, 1);
  } finally {
    download.restore();
    lamejs.restore();
    cleanup();
  }
});

test("Export MP3 shows a busy spinner and stays disabled mid-render, then resets", async () => {
  const { ctx, cleanup } = setup();
  const abcjs = createAbcjsStub();
  const download = stubDownload();
  const lamejs = stubLamejs();
  try {
    const btn = clickExport(ctx, abcjs);
    assert.ok(btn.querySelector(SPINNER_SELECTOR));
    assert.equal(btn.disabled, true);

    await flush();
    await flush();
    assert.equal(btn.querySelector(SPINNER_SELECTOR), null);
    assert.equal(btn.disabled, false);
  } finally {
    download.restore();
    lamejs.restore();
    cleanup();
  }
});

test("Export MP3 is a no-op when there's no tune to render (buildExportOptions returns null)", async () => {
  const { ctx, cleanup } = setup({ buildExportOptions: () => null });
  const abcjs = createAbcjsStub();
  const download = stubDownload();
  const lamejs = stubLamejs();
  try {
    clickExport(ctx, abcjs);
    await flush();

    assert.equal(abcjs.calls.createSynths.length, 0);
    assert.equal(download.clicked.length, 0);
  } finally {
    download.restore();
    lamejs.restore();
    cleanup();
  }
});

test("Export MP3 keeps the initiating song's filename and leaves a superseding render's button alone", async () => {
  const { ctx, cleanup } = setup();
  ctx.audio.renderGeneration = 1;
  const abcjs = createAbcjsStub();
  const download = stubDownload();
  const lamejs = stubLamejs();
  try {
    const btn = clickExport(ctx, abcjs);

    // A newer render supersedes this export while its offline synth is
    // still priming — a song switch, or a same-song Key/Tempo/Comping
    // re-render. audio-player.js's initForTune bumps renderGeneration for
    // both cases; ctx.state.currentSongFile only changes for the former.
    ctx.audio.renderGeneration = 2;
    ctx.state.currentSongFile = "some_other_song.abc";

    await flush();
    await flush();

    // Downloaded under the song that was open when export started, not
    // whichever one is open now.
    assert.equal(download.clicked.length, 1);
    assert.equal(download.clicked[0].download, "basin_street.mp3");
    // The button belongs to the newer render now; the superseded export's
    // finally must not stomp it back to idle.
    assert.equal(btn.disabled, true);
    assert.ok(btn.querySelector(SPINNER_SELECTOR));
  } finally {
    download.restore();
    lamejs.restore();
    cleanup();
  }
});

// Drives one export end-to-end against a fixed 4-sample render ([0, 1, -1,
// 0], converting to the exact PCM values [0, 0x7fff, -0x8000, 0] already
// verified against the real conversion table elsewhere) and returns the
// encoded left channel (every encodeBuffer call's samples, concatenated in
// order — encodeMp3 streams one repeat pass per call rather than
// concatenating them first, see its own doc comment), so the three
// repeat-respecting tests below only need to state their own
// buildExportOptions overrides and expected output.
async function exportedLeftChannel(buildExportOptionsOverrides) {
  const { ctx, cleanup } = setup({
    buildExportOptions: () => ({
      visualObj: { metaText: {} }, millisecondsPerMeasure: 500, options: {}, ...buildExportOptionsOverrides,
    }),
  });
  const exportAudioBuffer = {
    numberOfChannels: 1,
    sampleRate: 44100,
    length: 4,
    getChannelData: () => Float32Array.from([0, 1, -1, 0]),
  };
  const abcjs = createAbcjsStub({ exportAudioBuffer });
  const download = stubDownload();
  const lamejs = stubLamejs();
  try {
    clickExport(ctx, abcjs);
    await flush();
    await flush();
    return {
      left: lamejs.stub.calls.encodeBuffer.flatMap((call) => Array.from(call.left)),
      encodeCalls: lamejs.stub.calls.encodeBuffer.length,
    };
  } finally {
    download.restore();
    lamejs.restore();
    cleanup();
  }
}

test("Export MP3 loops the render per buildExportOptions' repeatCount when it's greater than 1", async () => {
  const onePass = [0, 0x7fff, -0x8000, 0];
  const { left, encodeCalls } = await exportedLeftChannel({ repeatCount: 2, restartFraction: 0 });

  assert.equal(encodeCalls, 2); // one call per playthrough, never concatenated first
  assert.deepEqual(left, [...onePass, ...onePass]);
});

test("Export MP3 skips the pickup on every repeat pass but the first, per buildExportOptions' restartFraction", async () => {
  const { left } = await exportedLeftChannel({ repeatCount: 2, restartFraction: 0.5 });

  // full first pass (4 samples) + the post-pickup tail only (last 2 samples)
  assert.deepEqual(left, [0, 0x7fff, -0x8000, 0, -0x8000, 0]);
});

test("Export MP3 with no repeatCount from buildExportOptions renders a single playthrough (backward compatible)", async () => {
  const { left } = await exportedLeftChannel({});

  assert.deepEqual(left, [0, 0x7fff, -0x8000, 0]);
});

test("Export MP3 recovers (button re-enabled, no download) when the render produces no audio", async () => {
  const { ctx, cleanup } = setup();
  const abcjs = createAbcjsStub({ exportAudioBuffer: null });
  const download = stubDownload();
  const lamejs = stubLamejs();
  try {
    const btn = clickExport(ctx, abcjs);
    await flush();
    await flush();

    assert.equal(download.clicked.length, 0);
    assert.equal(btn.disabled, false);
    assert.equal(btn.querySelector(SPINNER_SELECTOR), null);
  } finally {
    download.restore();
    lamejs.restore();
    cleanup();
  }
});
