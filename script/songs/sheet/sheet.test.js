import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
import { createAbcjsStub, withAbcjs } from "../../../../tests/helpers/stubs.js";
import { createSheet } from "./sheet.js";
import { RENDER } from "../core/state.js";

function setup() {
  const page = mountPage();
  const abcjs = createAbcjsStub();
  const ctx = makeCtx();
  // What the sheet publishes for the player (the `tune` slice).
  const audioCalls = { transpose: [], tunes: [] };
  ctx.store.subscribe("tune", (tune, changed) => {
    if (!changed.includes("visualObj")) return;
    audioCalls.tunes.push(tune.visualObj);
    audioCalls.transpose.push(tune.audioTranspose);
  });
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

test("render seeds the Key stepper and marks a newly opened song; rerender doesn't", () => {
  const { ctx, abcjs, sheet, cleanup } = setup();
  try {
    const renders = () => abcjs.calls.renderAbc.length;
    withAbcjs(abcjs, () => sheet.render(TUNE, { transposeSemitones: 3 }));
    assert.equal(ctx.state.transpose, 3);
    assert.equal(renders(), 1, "seeding the Key stepper doesn't trigger a second render");
    assert.equal(abcjs.calls.renderAbc.at(-1).params.visualTranspose, 3);
    // The player resets the Tempo stepper whenever songSerial moves.
    const serial = ctx.state.songSerial;
    withAbcjs(abcjs, () => sheet.rerender());
    assert.equal(ctx.state.songSerial, serial);
    withAbcjs(abcjs, () => sheet.render(TUNE));
    assert.equal(ctx.state.songSerial, serial + 1);
  } finally {
    cleanup();
  }
});

test("the instrument offset shifts the notation but not the audio transpose", () => {
  const {
    ctx, abcjs, audioCalls, sheet, cleanup,
  } = setup();
  try {
    withAbcjs(abcjs, () => {
      sheet.render(TUNE);
      // One store write, one re-render (the sheet follows the settings).
      ctx.store.set("settings", { instrument: "trumpet", transpose: 1 }); // trumpet: +2
    });
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
    ctx.state.mixer = { ...ctx.state.mixer, bassVolume: 50 };
    document.getElementById("notation").insertAdjacentHTML(
      "afterend",
      "<div id='bk-n2'></div><div id='bk-c2'></div><div id='bk-t2'></div>",
    );
    withAbcjs(abcjs, () => sheet.renderIntoBooklet(TUNE, {
      notationId: "bk-n2", chordId: "bk-c2", titleId: "bk-t2",
    }));
    assert.ok(abcjs.calls.renderAbc.at(-1).abc.endsWith(TUNE));
  } finally {
    cleanup();
  }
});

test("a booklet render leaves the live sheet's state alone, so rerender() keeps the open song", () => {
  const { ctx, abcjs, sheet, cleanup } = setup();
  try {
    document.getElementById("notation").insertAdjacentHTML(
      "afterend",
      "<div id='bk-n3'></div><div id='bk-c3'></div><div id='bk-t3'></div>",
    );
    const OTHER_TUNE = TUNE.replace("T:Test", "T:Booklet song");
    withAbcjs(abcjs, () => {
      sheet.render(TUNE);
      ctx.state.compingActive = true;
      sheet.renderIntoBooklet(OTHER_TUNE, { notationId: "bk-n3", chordId: "bk-c3", titleId: "bk-t3" });
      assert.equal(ctx.state.currentSongText, TUNE);
      assert.equal(ctx.state.compingActive, true, "a booklet song's comping state doesn't leak");
      sheet.rerender();
    });
    assert.equal(abcjs.calls.renderAbc.at(-1).target, "notation");
    const last = abcjs.calls.renderAbc.at(-1).abc;
    assert.match(last, /T:Test\n/, "the live sheet re-engraves its own song");
    assert.doesNotMatch(last, /Booklet song/);
  } finally {
    cleanup();
  }
});

test("a booklet render ignores the Key stepper and never touches audio", () => {
  const {
    ctx, abcjs, audioCalls, sheet, cleanup,
  } = setup();
  try {
    ctx.state.transpose = 5;
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
    ctx.store.set("mixer", {
      mixerVoices: voices.map((v) => ({
        ...v, slug: v.label.toLowerCase(), muted: false, program: null, volume: 100,
      })),
    }, RENDER);
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
    // Sousaphone -> Piano, overriding the Tuba guess; the sheet re-engraves
    // by itself on the Mixer change.
    withAbcjs(abcjs, () => {
      ctx.state.mixerVoices = ctx.state.mixerVoices.map((v, i) => (i === 1 ? { ...v, program: 0 } : v));
    });
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

test("two W: tables render below the chord table in their source order", () => {
  const { abcjs, sheet, cleanup } = setup();
  try {
    const text = "X:1\nT:Test\nM:4/4\nL:1/8\nW:| 1 | Intro |\nW:\nW:| 2 | Solo |\nK:C\n\"C\" C8 |";
    withAbcjs(abcjs, () => sheet.render(text));
    const forms = [...document.querySelectorAll(".songForm")];
    assert.equal(forms.length, 2);
    assert.match(forms[0].textContent, /Intro/);
    assert.match(forms[1].textContent, /Solo/);
  } finally {
    cleanup();
  }
});

test("an audio failure while loading a new tune doesn't stop the Mixer and Inspiration following it", () => {
  const page = mountPage();
  try {
    const abcjs = createAbcjsStub();
    const ctx = makeCtx();
    // The player subscribes first (it's created before the Mixer and
    // Inspiration) — make its tune handler fail, as a synth that can't start
    // on some browser would.
    ctx.store.subscribe("tune", () => {
      throw new Error("synth failed");
    });
    const followed = [];
    ctx.store.subscribe("tune", (tune) => followed.push(tune.title));
    const sheet = createSheet(ctx);
    assert.throws(() => withAbcjs(abcjs, () => sheet.render(TUNE)), /synth failed/);
    assert.deepEqual(followed, ["Stub Tune"], "later subscribers still hear about the new tune");
  } finally {
    page.cleanup();
  }
});

// Like ABCjs: a tune's free-standing W: words are drawn as their own SVG
// (.abcjs-unaligned-words) inside the target element.
function withLyricsSvgs(abcjs) {
  const renderAbc = abcjs.renderAbc.bind(abcjs);
  abcjs.renderAbc = (target, abc, params) => {
    const result = renderAbc(target, abc, params);
    const words = abc.split("\n").filter((l) => l.startsWith("W:") && !l.startsWith("W:|"));
    if (words.length > 0) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("class", "abcjs-unaligned-words");
      text.textContent = words.map((l) => l.slice(2)).join(" ");
      svg.append(text);
      document.getElementById(target).append(svg);
    }
    return result;
  };
  return abcjs;
}

test("building a booklet song keeps the live sheet's lyrics, and the booklet keeps its own", () => {
  const { abcjs, sheet, cleanup } = setup();
  try {
    withLyricsSvgs(abcjs);
    document.getElementById("notation").insertAdjacentHTML(
      "afterend",
      "<div id='bk-nl'></div><div id='bk-cl'></div><div id='bk-tl'></div>",
    );
    const live = TUNE.replace("K:C", "W:Live words\nK:C");
    const booklet = TUNE.replace("K:C", "W:Booklet words\nK:C");
    withAbcjs(abcjs, () => sheet.render(live));
    const lyricsText = () => document.getElementById("lyrics").textContent;
    assert.match(lyricsText(), /Live words/);

    withAbcjs(abcjs, () => sheet.renderIntoBooklet(booklet, {
      notationId: "bk-nl", chordId: "bk-cl", titleId: "bk-tl",
    }));
    assert.match(lyricsText(), /Live words/, "the live sheet's lyrics are untouched");
    assert.doesNotMatch(lyricsText(), /Booklet words/);
    assert.match(
      document.getElementById("bk-nl").textContent, /Booklet words/, "the booklet song prints its own lyrics",
    );
  } finally {
    cleanup();
  }
});
