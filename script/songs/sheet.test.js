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

const MULTI_VOICE_TUNE = [
  "X:1", "T:Feel like Funkin' it up", "M:4/4", "L:1/8", "K:F",
  'V:1 clef=treble name="Trumpet"',
  'V:2 clef=bass name="Sousaphone"',
  "[V:1] z8 |", "[V:2] z8 |",
].join("\n");

// syncInstrumentVoices/resolveRenderText's own logic (parseVoiceList,
// resolveMixerVoices, injectMixerAudio's voicePrograms branch) is unit-tested
// directly in lib/audio-mix.test.js; this only checks that sheet.js wires
// ctx.mixer into that pipeline correctly. ctx.mixer.syncVoices is a no-op
// stub by default (tests/helpers/ctx.js), so it's overridden here to do what
// the real mixer.js does — materialise ctx.state.mixerVoices — since that's
// what resolveRenderText's voiceProgramMap reads back out.
function withSyncedMixerVoices(ctx) {
  let lastSig = null;
  ctx.mixer.syncVoices = (voices) => {
    const sig = voices.map((v) => `${v.id}:${v.label}`).join("|");
    if (sig === lastSig) return; // same rebuild-skip behaviour as the real mixer.js
    lastSig = sig;
    ctx.state.mixerVoices = voices.map((v) => ({ ...v, muted: false, program: null }));
  };
}

test("engrave hands the tune's own instrument voices to ctx.mixer.syncVoices, and stamps each voice's program into the render text", () => {
  const { ctx, abcjs, sheet, cleanup } = setup();
  try {
    withSyncedMixerVoices(ctx);
    withAbcjs(abcjs, () => sheet.render(MULTI_VOICE_TUNE));
    assert.deepEqual(ctx.state.instrumentVoices.map((v) => v.label), ["Trumpet", "Sousaphone"]);
    const renderedAbc = abcjs.calls.renderAbc.at(-1).abc;
    assert.match(renderedAbc, /name="Trumpet"\n%%MIDI program 56\n/); // guessed from the name
    assert.match(renderedAbc, /name="Sousaphone"\n%%MIDI program 58\n/);
  } finally {
    cleanup();
  }
});

test("a voice's chosen (non-Default) program wins over the name-based guess", () => {
  const { ctx, abcjs, sheet, cleanup } = setup();
  try {
    withSyncedMixerVoices(ctx);
    withAbcjs(abcjs, () => sheet.render(MULTI_VOICE_TUNE));
    ctx.state.mixerVoices[1].program = 0; // Sousaphone -> Piano, overriding the Tuba guess
    withAbcjs(abcjs, () => sheet.rerender());
    assert.match(abcjs.calls.renderAbc.at(-1).abc, /name="Sousaphone"\n%%MIDI program 0\n/);
  } finally {
    cleanup();
  }
});

test("an ordinary single-voice tune resolves to one synthetic 'Melody' voice, not an empty list", () => {
  const { ctx, abcjs, sheet, cleanup } = setup();
  try {
    const synced = [];
    ctx.mixer.syncVoices = (voices) => synced.push(voices);
    withAbcjs(abcjs, () => sheet.render(TUNE));
    assert.deepEqual(ctx.state.instrumentVoices, [{ id: "1", index: 0, label: "Melody" }]);
    assert.deepEqual(synced, [[{ id: "1", index: 0, label: "Melody" }]]);
  } finally {
    cleanup();
  }
});

test("a booklet render never touches ctx.state.instrumentVoices or calls ctx.mixer.syncVoices", () => {
  const { ctx, abcjs, sheet, cleanup } = setup();
  try {
    let calls = 0;
    ctx.mixer.syncVoices = () => { calls += 1; };
    ctx.state.instrumentVoices = ["sentinel"];
    document.getElementById("notation").insertAdjacentHTML(
      "afterend",
      "<div id='bk-n3'></div><div id='bk-c3'></div><div id='bk-t3'></div>",
    );
    withAbcjs(abcjs, () => sheet.renderIntoBooklet(MULTI_VOICE_TUNE, {
      notationId: "bk-n3", chordId: "bk-c3", titleId: "bk-t3",
    }));
    assert.deepEqual(ctx.state.instrumentVoices, ["sentinel"]);
    assert.equal(calls, 0);
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
