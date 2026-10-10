import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import {
  effectiveSheetSettings, hasInstrumentVoices, resolveTranspose, buildRenderPlan,
  mixerAudioOptions, mixRenderText,
} from "./render-plan.js";
import { withTonal } from "../../../../tests/helpers/stubs.js";

// The real ABCjs parser, headless — the same one the browser bundle wraps.
const parse = (text, visualTranspose) => ABCJS.parseOnly(text, { visualTranspose })[0];

const CHORD_TUNE = 'X:1\nT:Test\nM:4/4\nL:1/8\nK:C\n"C" C8 | "G7" G8 |';
const NO_CHORDS = "X:1\nT:Bare\nM:4/4\nL:1/8\nK:C\nC8 |";
const TWO_VOICES = [
  "X:1", "T:Two", "M:4/4", "L:1/8", "K:F",
  'V:1 clef=treble name="Trumpet"',
  'V:2 clef=bass name="Sousaphone"',
  '[V:1] "F" z8 |', "[V:2] z8 |",
].join("\n");

const SETTINGS = {
  instrument: "concert_pitch",
  transpose: 0,
  advancedOpen: false,
  comping: "charleston",
  compingSplit: false,
  compingParts: [0, 1, 2],
  solo: "trumpet",
  soloEnabled: false,
};

test("effectiveSheetSettings: comping and solo only count while the drawer is open", () => {
  assert.equal(effectiveSheetSettings(SETTINGS).comping, "off");
  const open = effectiveSheetSettings({ ...SETTINGS, advancedOpen: true });
  assert.equal(open.comping, "charleston");
  assert.equal(open.solo, "off", "solo also needs its picker switched on");
  assert.equal(effectiveSheetSettings({ ...SETTINGS, advancedOpen: true, soloEnabled: true }).solo, "trumpet");
});

test("effectiveSheetSettings: a booklet ignores the Key stepper and the drawer", () => {
  const booklet = effectiveSheetSettings({ ...SETTINGS, advancedOpen: true, transpose: 5 }, { booklet: true });
  assert.equal(booklet.transpose, 0);
  assert.equal(booklet.comping, "off");
});

test("effectiveSheetSettings: layers are live-sheet only", () => {
  const layers = { fingerings: true };
  assert.deepEqual(effectiveSheetSettings(SETTINGS, { layers }).layers, layers);
  assert.deepEqual(effectiveSheetSettings(SETTINGS, { booklet: true, layers }).layers, {});
  assert.deepEqual(effectiveSheetSettings(SETTINGS).layers, {});
});

test("buildRenderPlan: layer annotations reach the engraved text, never abcText", () => {
  const tune = 'X:1\nT:Salty\nM:4/4\nL:1/4\nK:C\n"A7" E4 | "D7" E4 | "G7" E4 | "C" E4 |';
  const settings = {
    ...effectiveSheetSettings({ ...SETTINGS, instrument: "trumpet" }, { layers: { fingerings: true, progressions: true } }),
  };
  const plan = buildRenderPlan(tune, settings, { parse });
  assert.equal(plan.abcText.includes('"_'), false, "rerender() re-reads the plain text");
  assert.match(plan.comping.renderText, /"_\u00B7\\n2\\n\u00B7""_Salty Dog progression"/, "F#4 written: valve 2, then the label");
  assert.deepEqual(plan.progressions.map((p) => p.name), ["Salty Dog"]);
  assert.deepEqual(plan.layersApplied, ["progressions", "fingerings"]);
  const plain = buildRenderPlan(tune, effectiveSheetSettings(SETTINGS), { parse });
  assert.equal(plain.comping.renderText, plain.abcText);
  assert.deepEqual(plain.layersApplied, []);
  assert.equal(plan.instrument, "trumpet", "the overlays draw a trombone's positions differently from valves");
});

test("effectiveSheetSettings: split parts only apply while Split is on", () => {
  assert.equal(effectiveSheetSettings(SETTINGS).compingParts, null);
  assert.deepEqual(effectiveSheetSettings({ ...SETTINGS, compingSplit: true, compingParts: [1] }).compingParts, [1]);
});

test("hasInstrumentVoices spots voices that carry their own clef/name", () => {
  assert.equal(hasInstrumentVoices(TWO_VOICES), true);
  assert.equal(hasInstrumentVoices(CHORD_TUNE), false);
});

test("resolveTranspose folds the instrument's offset into the notation only", () => {
  const t = resolveTranspose(CHORD_TUNE, "trumpet", 1);
  assert.equal(t.audio, 1);
  assert.equal(t.visual, 3);
});

test("resolveTranspose stamps a bass clef for a bass-clef instrument", () => {
  assert.match(resolveTranspose(CHORD_TUNE, "trombone", 0).abcText, /K:C.*clef=bass/);
});

test("resolveTranspose leaves a chart with its own voice clefs alone", () => {
  const t = resolveTranspose(TWO_VOICES, "trumpet", 2);
  assert.equal(t.abcText, TWO_VOICES);
  assert.equal(t.visual, 2);
});

test("buildRenderPlan: chords, chord table and no comping by default", () => {
  const plan = buildRenderPlan(CHORD_TUNE, effectiveSheetSettings(SETTINGS), { parse });
  assert.equal(plan.hasChords, true);
  assert.equal(plan.chords.length, 2);
  assert.equal(plan.comping.active, false);
  assert.equal(plan.comping.renderText, plan.abcText);
  assert.equal(plan.concert, null);
  assert.equal(plan.song.metaText.title, "Test");
});

test("buildRenderPlan: an open drawer with a pattern adds the comping staff", () => {
  const plan = withTonal(() => buildRenderPlan(
    CHORD_TUNE, effectiveSheetSettings({ ...SETTINGS, advancedOpen: true }), { parse },
  ));
  assert.equal(plan.comping.active, true);
  assert.notEqual(plan.comping.renderText, plan.abcText);
  assert.ok(plan.comping.palette);
  assert.ok(plan.concert.chords.length > 0);
});

test("buildRenderPlan: a chordless tune never gets comping", () => {
  const plan = buildRenderPlan(NO_CHORDS, effectiveSheetSettings({ ...SETTINGS, advancedOpen: true }), { parse });
  assert.equal(plan.hasChords, false);
  assert.equal(plan.comping.active, false);
});

test("buildRenderPlan: Concert + Roman shows Roman numerals in the chord table", () => {
  const plan = buildRenderPlan(
    CHORD_TUNE, effectiveSheetSettings({ ...SETTINGS, instrument: "concert_+_roman" }), { parse },
  );
  assert.notDeepEqual(plan.displayChords, plan.chords);
});

test("buildRenderPlan: a setlist's extra steps add to the Key stepper", () => {
  const plan = buildRenderPlan(
    CHORD_TUNE, effectiveSheetSettings({ ...SETTINGS, transpose: 1 }), { parse, extraTransposeSteps: 2 },
  );
  assert.equal(plan.audioTranspose, 3);
});

test("buildRenderPlan: the P: order becomes the form strip when there's no W: table", () => {
  const text = 'X:1\nT:Form\nM:4/4\nL:1/8\nP:Intro A B\nK:C\nP:A\n"C" C8 |]\nP:B\n"G" G8 |]';
  const plan = buildRenderPlan(text, effectiveSheetSettings(SETTINGS), { parse });
  assert.equal(plan.wordsTables.length, 1);
  assert.equal(plan.wordsTables[0].header, null);
  assert.equal(plan.wordsTables[0].rows.length, 3);
});

const MIXER = {
  mixer: {
    bassVolume: 80, bassMuted: true, bassProgram: null, chordsVolume: 60, chordsMuted: false, chordsProgram: 25,
  },
  gchordPattern: "jazz",
  mixerVoices: [
    { id: "1", label: "Trumpet", program: null, volume: 100 },
    { id: "2", label: "Sousaphone", program: 0, volume: 50 },
  ],
};

test("mixerAudioOptions: a muted channel is silent, a null program left to the default", () => {
  const opts = mixerAudioOptions(MIXER, true);
  assert.equal(opts.bassPercent, 0);
  assert.equal(opts.bassProgram, undefined);
  assert.equal(opts.chordsPercent, 60);
  assert.equal(opts.chordsProgram, 25);
  assert.equal(opts.voiceVolumes.get("2"), 50);
  assert.equal(opts.voicePrograms.get("2"), 0, "an explicit pick wins");
  assert.equal(opts.voicePrograms.get("1"), 56, "a null program is guessed from the voice's name");
});

test("mixRenderText stamps each voice's program into its declaration", () => {
  const text = mixRenderText(TWO_VOICES, MIXER, true);
  assert.match(text, /name="Trumpet"\n%%MIDI program 56\n/);
  assert.match(text, /name="Sousaphone"\n%%MIDI program 0\n/);
  assert.match(text, /%%MIDI chordprog 25/);
});
