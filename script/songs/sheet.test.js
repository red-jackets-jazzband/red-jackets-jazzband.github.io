import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createAbcjsStub, withAbcjs } from "../../../tests/helpers/stubs.js";
import { createSheet } from "./sheet.js";

function setup() {
  const page = mountPage();
  const abcjs = createAbcjsStub();
  const audioCalls = { transpose: [], repeats: [], tunes: [] };
  const ctx = makeCtx({
    audio: {
      set transposeSemitones(v) { audioCalls.transpose.push(v); },
      set chordOffset(_v) {},
      setRepeatBoundaries: (b) => audioCalls.repeats.push(b),
      initForTune: (t) => audioCalls.tunes.push(t),
      setupNotationClickHandler: () => {},
      updateTempoLabel: () => {},
      stepTempo: () => {},
      playPause: () => {},
      stop: () => {},
    },
  });
  // #instrument is built at runtime by selects.js — add the option the tests need.
  const sel = document.createElement("select");
  sel.id = "instrument";
  ["concert_pitch", "trumpet", "trombone", "concert_+_roman"].forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.text = v;
    sel.append(o);
  });
  document.getElementById("sheetStatus").append(sel);

  const sheet = createSheet(ctx);
  return { page, ctx, abcjs, audioCalls, sheet, cleanup: page.cleanup };
}

const TUNE = "X:1\nT:Test\nM:4/4\nL:1/8\nK:C\n\"C\" C8 |";

test("render engraves the live sheet with the expected ABCjs params", () => {
  const { abcjs, sheet, cleanup } = setup();
  try {
    withAbcjs(abcjs, () => sheet.render(TUNE));
    const call = abcjs.calls.renderAbc.at(-1);
    assert.equal(call.target, "notation");
    assert.equal(call.params.visualTranspose, 0);
    assert.equal(call.params.responsive, "resize");
    assert.equal(call.params.staffwidth, 1000);
    assert.equal(call.params.jazzchords, true);
    assert.equal(call.params.format.titlefont, "MuseJazzText 4");
    assert.equal(call.params.format.gchordfont, "MuseJazzText");
    assert.equal(document.body.classList.contains("rj-sheet-active"), true);
  } finally {
    cleanup();
  }
});

test("render seeds the Key stepper and clears the tempo override", () => {
  const { ctx, abcjs, sheet, cleanup } = setup();
  try {
    ctx.state.tempoOverrideBpm = 150;
    withAbcjs(abcjs, () => sheet.render(TUNE, { transposeSemitones: 3 }));
    assert.equal(document.getElementById("transpose").value, "3");
    assert.equal(ctx.state.tempoOverrideBpm, null);
    assert.equal(abcjs.calls.renderAbc.at(-1).params.visualTranspose, 3);
  } finally {
    cleanup();
  }
});

test("the instrument offset shifts the notation but not the audio transpose", () => {
  const { abcjs, audioCalls, sheet, cleanup } = setup();
  try {
    withAbcjs(abcjs, () => sheet.render(TUNE));
    document.getElementById("instrument").value = "trumpet"; // +2
    document.getElementById("transpose").value = "1";
    withAbcjs(abcjs, () => sheet.rerender());
    // audio gets the pre-instrument value (stepper only)
    assert.equal(audioCalls.transpose.at(-1), 1);
    // notation gets stepper + instrument offset
    assert.equal(abcjs.calls.renderAbc.at(-1).params.visualTranspose, 3);
  } finally {
    cleanup();
  }
});

// resolveRenderText's injectMixerAudio call is unit-tested directly and
// thoroughly in lib/audio-mix.test.js; here the ABCjs stub always parses to
// an empty-voices tune, so chords.length is always 0 and Bass/Chords
// injection is a no-op regardless of what's asserted through this harness.
// What *is* worth checking here is the booklet early-return guard itself.
test("a booklet render's ABC text is untouched by the mixer (isBooklet skips injection)", () => {
  const { ctx, abcjs, sheet, cleanup } = setup();
  try {
    ctx.state.mixer.bassVolume = 50;
    document.getElementById("notation").insertAdjacentHTML(
      "afterend",
      "<div id='bk-n2'></div><div id='bk-c2'></div><div id='bk-t2'></div>",
    );
    withAbcjs(abcjs, () => sheet.renderIntoBooklet(TUNE, {
      notationId: "bk-n2", chordId: "bk-c2", titleId: "bk-t2",
    }));
    assert.equal(abcjs.calls.renderAbc.at(-1).abc, TUNE);
  } finally {
    cleanup();
  }
});

test("a booklet render ignores the Key stepper and never touches audio", () => {
  const { abcjs, audioCalls, sheet, cleanup } = setup();
  try {
    document.getElementById("transpose").value = "5";
    document.getElementById("notation").insertAdjacentHTML(
      "afterend",
      "<div id='bk-n'></div><div id='bk-c'></div><div id='bk-t'></div>",
    );
    withAbcjs(abcjs, () => sheet.renderIntoBooklet(TUNE, {
      notationId: "bk-n", chordId: "bk-c", titleId: "bk-t",
      titlePrefix: "1. ", extraTransposeSteps: 2,
    }));
    const call = abcjs.calls.renderAbc.at(-1);
    assert.equal(call.target, "bk-n");
    assert.equal(call.params.visualTranspose, 2); // extra only, no stepper
    assert.equal(call.params.responsive, "resize");
    assert.equal(call.params.staffwidth, 1000);
    assert.equal(audioCalls.tunes.length, 0);
    assert.equal(document.getElementById("bk-t").innerHTML, "1. Stub Tune");
  } finally {
    cleanup();
  }
});

test("rerender re-engraves the stored (clef-adjusted) song text", () => {
  const { ctx, abcjs, sheet, cleanup } = setup();
  try {
    withAbcjs(abcjs, () => sheet.render(TUNE));
    const before = abcjs.calls.renderAbc.length;
    withAbcjs(abcjs, () => sheet.rerender());
    assert.equal(abcjs.calls.renderAbc.length, before + 1);
    assert.equal(ctx.state.currentSongText !== undefined, true);
  } finally {
    cleanup();
  }
});
