import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIDI_VOLUME_MAX, DEFAULT_PROGRAM, percentToMidiVolume, injectMixerAudio, computeVoicesOff,
  GCHORD_PATTERNS, DEFAULT_GCHORD_PATTERN_VALUE, resolveGchordPattern,
  ABCJS_SWING_MIN, ABCJS_SWING_MAX, percentToAbcjsSwing,
  parseVoiceList, resolveMixerVoices,
} from "./audio-mix.js";

test("percentToMidiVolume follows a cubic taper: finer resolution low, full range at the top", () => {
  assert.equal(percentToMidiVolume(0), 0);
  assert.equal(percentToMidiVolume(100), MIDI_VOLUME_MAX);
  assert.equal(percentToMidiVolume(50), 16); // round(127 * 0.5^3) = round(15.875)
  assert.equal(percentToMidiVolume(25), 2); // round(127 * 0.25^3) = round(1.98...)
  assert.equal(percentToMidiVolume(75), 54); // round(127 * 0.75^3) = round(53.5...)
  // monotonic — never dips as the fader rises
  const values = [0, 10, 25, 40, 50, 60, 75, 90, 100].map(percentToMidiVolume);
  for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1]);
  assert.equal(percentToMidiVolume(-20), 0);
  assert.equal(percentToMidiVolume(500), MIDI_VOLUME_MAX);
  assert.equal(percentToMidiVolume(undefined), 0);
});

test("DEFAULT_PROGRAM carries the expected hardcoded GM program for Bass/Chords only", () => {
  assert.deepEqual(DEFAULT_PROGRAM, { bass: 32, chords: 26 });
});

const NO_COMPING_TUNE = ["X:1", "T:Test", "M:4/4", "L:1/8", "K:C", '"C" C8 |'].join("\n");
const onlyMelody = (program) => new Map([["1", program]]);

test("injectMixerAudio (ordinary tune, no chords) stamps one tune-wide %%MIDI program (no V: line to scope to)", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, { hasChords: false, bassPercent: 0, chordsPercent: 0, voicePrograms: onlyMelody(56) });
  const lines = out.split("\n");
  assert.equal(lines[lines.indexOf("K:C") - 1], "%%MIDI program 56");
  assert.doesNotMatch(out, /%%MIDI (gchord|bassprog|chordprog|bassvol|chordvol|vol)\b/);
  assert.ok(out.includes('"C" C8 |'));
});

test("injectMixerAudio is a no-op when there's no K: line", () => {
  const abc = "X:1\nT:Test\n";
  assert.equal(injectMixerAudio(abc, { hasChords: false, bassPercent: 0, chordsPercent: 0, voicePrograms: onlyMelody(56) }), abc);
});

test("injectMixerAudio stamps Bass/Chords accompaniment directives (default programs) when the tune has chords", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, {
    hasChords: true, bassPercent: 70, chordsPercent: 20, voicePrograms: onlyMelody(56),
  });
  const before = out.slice(0, out.indexOf("K:C"));
  assert.match(before, /%%MIDI gchord bzczbzcz/);
  assert.match(before, new RegExp(`%%MIDI bassprog ${DEFAULT_PROGRAM.bass}`));
  assert.match(before, new RegExp(`%%MIDI chordprog ${DEFAULT_PROGRAM.chords}`));
  assert.match(before, new RegExp(`%%MIDI bassvol ${percentToMidiVolume(70)}`));
  assert.match(before, new RegExp(`%%MIDI chordvol ${percentToMidiVolume(20)}`));
});

test("GCHORD_PATTERNS carries the expected value/label/pattern for every Pattern-picker entry", () => {
  assert.deepEqual(GCHORD_PATTERNS, [
    { value: "default", label: "Default", pattern: null },
    { value: "jazz", label: "Jazz (root+chord, chord)", pattern: "bzczbzcz" },
    { value: "two-beat", label: "Two-beat (root, chord)", pattern: "fzczfzcz" },
    { value: "four-beat", label: "Four-beat (root+chord each beat)", pattern: "bzbzbzbz" },
    { value: "waltz", label: "Waltz (root, chord, chord)", pattern: "fzczcz" },
    { value: "latin", label: "Latin/Calypso (root, off-beat chords)", pattern: "fczczczc" },
  ]);
});

test("resolveGchordPattern maps a Pattern-picker value to its gchord string, defaulting on the unrecognised", () => {
  assert.equal(resolveGchordPattern("jazz"), "bzczbzcz");
  assert.equal(resolveGchordPattern("two-beat"), "fzczfzcz");
  assert.equal(resolveGchordPattern("latin"), "fczczczc");
  assert.equal(resolveGchordPattern("default"), null);
  const defaultEntry = GCHORD_PATTERNS.find((p) => p.value === DEFAULT_GCHORD_PATTERN_VALUE);
  assert.equal(resolveGchordPattern("not-a-real-pattern"), defaultEntry.pattern);
  assert.equal(resolveGchordPattern(undefined), defaultEntry.pattern);
});

test("injectMixerAudio uses a given gchordPattern instead of the default", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, {
    hasChords: true, bassPercent: 0, chordsPercent: 0, gchordPattern: "fzczfzcz", voicePrograms: onlyMelody(56),
  });
  assert.match(out, /%%MIDI gchord fzczfzcz/);
});

test("injectMixerAudio omits the %%MIDI gchord line for a null pattern (Default), keeping the rest of the accompaniment block", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, {
    hasChords: true, bassPercent: 70, chordsPercent: 20, gchordPattern: null, voicePrograms: onlyMelody(56),
  });
  assert.doesNotMatch(out, /%%MIDI gchord/);
  assert.match(out, new RegExp(`%%MIDI bassprog ${DEFAULT_PROGRAM.bass}`));
  assert.match(out, new RegExp(`%%MIDI bassvol ${percentToMidiVolume(70)}`));
});

test("injectMixerAudio uses custom Bass/Chords programs when given one", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, {
    hasChords: true, bassPercent: 0, bassProgram: 33, chordsPercent: 0, chordsProgram: 0, voicePrograms: onlyMelody(56),
  });
  assert.match(out, /%%MIDI bassprog 33/);
  assert.match(out, /%%MIDI chordprog 0/);
});

test("injectMixerAudio omits accompaniment directives entirely when the tune has no chords", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, {
    hasChords: false, bassPercent: 70, chordsPercent: 20, voicePrograms: onlyMelody(56),
  });
  assert.doesNotMatch(out, /%%MIDI (gchord|bassprog|chordprog|bassvol|chordvol)/);
  // nothing else got spliced in before K: besides the one melody program line
  assert.equal(out, NO_COMPING_TUNE.replace("K:C", "%%MIDI program 56\nK:C"));
});

test("computeVoicesOff for a single voice: mute is a full mute (true), the same as before per-voice channels existed", () => {
  assert.equal(computeVoicesOff([{ index: 0, muted: false }]).voicesOff, undefined);
  assert.equal(computeVoicesOff([{ index: 0, muted: true }]).voicesOff, true);
});

test("percentToAbcjsSwing maps the 0-100 fader onto ABCjs's 50-75 native scale", () => {
  assert.equal(percentToAbcjsSwing(0), ABCJS_SWING_MIN);
  assert.equal(percentToAbcjsSwing(100), ABCJS_SWING_MAX);
  assert.equal(percentToAbcjsSwing(50), 63); // round(50 + 0.5*25) = round(62.5)
  assert.equal(percentToAbcjsSwing(-20), ABCJS_SWING_MIN);
  assert.equal(percentToAbcjsSwing(500), ABCJS_SWING_MAX);
  assert.equal(percentToAbcjsSwing(undefined), ABCJS_SWING_MIN);
  // monotonic — never dips as the fader rises
  const values = [0, 10, 25, 40, 50, 60, 75, 90, 100].map(percentToAbcjsSwing);
  for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1]);
});

test("computeVoicesOff for two voices (melody + comping, or any two-voice chart): each mutes independently by index", () => {
  assert.equal(computeVoicesOff([{ index: 0, muted: false }, { index: 1, muted: false }]).voicesOff, undefined);
  assert.deepEqual(computeVoicesOff([{ index: 0, muted: true }, { index: 1, muted: false }]).voicesOff, [0]);
  assert.deepEqual(computeVoicesOff([{ index: 0, muted: false }, { index: 1, muted: true }]).voicesOff, [1]);
  assert.deepEqual(computeVoicesOff([{ index: 0, muted: true }, { index: 1, muted: true }]).voicesOff, [0, 1]);
});

test("computeVoicesOff generalises to any N voices, muting by index and omitting the empty case", () => {
  const voices = [
    { index: 0, muted: false }, { index: 1, muted: true }, { index: 2, muted: true }, { index: 3, muted: false },
  ];
  assert.deepEqual(computeVoicesOff(voices).voicesOff, [1, 2]);
  assert.equal(computeVoicesOff(voices.map((v) => ({ ...v, muted: false }))).voicesOff, undefined);
});

const FUNKIN_HEADER = [
  "X:1", "T:Feel like Funkin' it up", "M:4/4", "L:1/8", "K:F",
  'V:1 clef=treble transpose=0 name="Trumpet" +12 " ',
  'V:2 clef=bass transpose=-24 name="Sousaphone" middle=d " ',
].join("\n");

test("parseVoiceList reads id + name from each voice's own declaration, in declaration order", () => {
  assert.deepEqual(parseVoiceList(FUNKIN_HEADER), [
    { id: "1", index: 0, name: "Trumpet" },
    { id: "2", index: 1, name: "Sousaphone" },
  ]);
});

test("parseVoiceList reports name: null for a voice with no name=\"...\" attribute", () => {
  const abc = ["X:1", "T:Test", "K:C", "V:1", "V:2"].join("\n");
  assert.deepEqual(parseVoiceList(abc), [
    { id: "1", index: 0, name: null },
    { id: "2", index: 1, name: null },
  ]);
});

test("parseVoiceList is unaffected by declaration order relative to K:, and ignores inline [V:n] body markers", () => {
  const abc = [
    "X:1", "T:Test", "K:Bb", 'V:1 name="Root"', 'V:2 name="Third"',
    "V: 1", '"Bb" B4|', "V: 2", "d4|", "[V:1] more |",
  ].join("\n");
  assert.deepEqual(parseVoiceList(abc), [
    { id: "1", index: 0, name: "Root" },
    { id: "2", index: 1, name: "Third" },
  ]);
});

test("parseVoiceList returns [] for an ordinary tune with no V: declaration, and one entry for an explicit single voice", () => {
  assert.deepEqual(parseVoiceList(NO_COMPING_TUNE), []);
  const oneVoice = ["X:1", "T:Test", "K:C", "V:1", '"C" C8 |'].join("\n");
  assert.deepEqual(parseVoiceList(oneVoice), [{ id: "1", index: 0, name: null }]);
});

test("resolveMixerVoices synthesises a single 'Melody' voice for an ordinary tune with no V: declaration", () => {
  assert.deepEqual(resolveMixerVoices([], false), [{ id: "1", index: 0, label: "Melody" }]);
});

test("resolveMixerVoices names a lone declared-but-unnamed voice 'Melody', not 'Voice 1'", () => {
  const raw = [{ id: "1", index: 0, name: null }];
  assert.deepEqual(resolveMixerVoices(raw, false), [{ id: "1", index: 0, label: "Melody" }]);
});

test("resolveMixerVoices keeps each voice's own name when the ABC declares one", () => {
  const raw = [{ id: "1", index: 0, name: "Trumpet" }, { id: "2", index: 1, name: "Sousaphone" }];
  assert.deepEqual(resolveMixerVoices(raw, false), [
    { id: "1", index: 0, label: "Trumpet" },
    { id: "2", index: 1, label: "Sousaphone" },
  ]);
});

test("resolveMixerVoices numbers two or more unnamed voices as 'Melody 1'/'Melody 2', not the bare fallback each", () => {
  const raw = [{ id: "1", index: 0, name: null }, { id: "2", index: 1, name: null }];
  assert.deepEqual(resolveMixerVoices(raw, false), [
    { id: "1", index: 0, label: "Melody 1" },
    { id: "2", index: 1, label: "Melody 2" },
  ]);
});

test("resolveMixerVoices only numbers the unnamed voices among a mix of named and unnamed", () => {
  const raw = [
    { id: "1", index: 0, name: "Trumpet" },
    { id: "2", index: 1, name: null },
    { id: "3", index: 2, name: null },
  ];
  assert.deepEqual(resolveMixerVoices(raw, false), [
    { id: "1", index: 0, label: "Trumpet" },
    { id: "2", index: 1, label: "Melody 1" },
    { id: "3", index: 2, label: "Melody 2" },
  ]);
});

test("resolveMixerVoices appends Comping as voice N+1 when it's active, on top of an ordinary one-voice tune", () => {
  assert.deepEqual(resolveMixerVoices([], true), [
    { id: "1", index: 0, label: "Melody" },
    { id: "2", index: 1, label: "Comping" },
  ]);
});

test("resolveMixerVoices appends Comping after a chart's own named voices too — comping is just voice N+1", () => {
  const raw = [{ id: "1", index: 0, name: "Trumpet" }, { id: "2", index: 1, name: "Sousaphone" }];
  assert.deepEqual(resolveMixerVoices(raw, true), [
    { id: "1", index: 0, label: "Trumpet" },
    { id: "2", index: 1, label: "Sousaphone" },
    { id: "3", index: 2, label: "Comping" },
  ]);
});

test("resolveMixerVoices never folds Comping into the Melody-numbering scheme, even when every other voice is unnamed", () => {
  const raw = [{ id: "1", index: 0, name: null }, { id: "2", index: 1, name: null }];
  const out = resolveMixerVoices(raw, true);
  assert.deepEqual(out.map((v) => v.label), ["Melody 1", "Melody 2", "Comping"]);
});

test("injectMixerAudio (multi-voice) stamps each voice's own program right after its first declaration", () => {
  const programs = new Map([["1", 56], ["2", 58]]);
  const out = injectMixerAudio(FUNKIN_HEADER, { hasChords: false, bassPercent: 0, chordsPercent: 0, voicePrograms: programs });
  assert.match(out, /name="Trumpet" \+12 " \n%%MIDI program 56\n/);
  assert.match(out, /name="Sousaphone" middle=d " \n%%MIDI program 58$/);
});

test("injectMixerAudio (multi-voice) only stamps a voice present in the map, and only at its first declaration", () => {
  const abc = ["X:1", "T:Test", "K:C", 'V:1 name="Root"', "V: 1", "C4|", "V: 1", "C4|"].join("\n");
  const out = injectMixerAudio(abc, { hasChords: false, bassPercent: 0, chordsPercent: 0, voicePrograms: new Map([["1", 0]]) });
  assert.equal((out.match(/%%MIDI program 0/g) || []).length, 1);
});

test("injectMixerAudio (comping) stamps melody + comping right after their own *body* declarations, not buildCompingTune's header ones", () => {
  const abc = [
    "X:1", "T:Test", "L:1/8", "%%staves [1 2]", "V:1", 'V:2 name="5\\n3\\nR"', "K:C",
    "V:1", '"C" C8 |', "V:2", "[CEG]8 |",
  ].join("\n");
  const out = injectMixerAudio(abc, {
    hasChords: true, bassPercent: 0, chordsPercent: 0, voicePrograms: new Map([["1", 56], ["2", 0]]),
  });
  // the header declarations are left bare — a %%MIDI program trailing a V:
  // line still in the header lands in ABCjs's one shared, tune-wide program
  // slot rather than a per-voice one, so two different header-trailing
  // lines here would silently collide (the second overwriting the first for
  // the whole tune, melody included) instead of giving each voice its own.
  assert.match(out, /%%staves \[1 2\]\nV:1\nV:2 name="5\\n3\\nR"\n%%MIDI gchord/);
  assert.match(out, /%%MIDI chordvol 0\nK:C/);
  // each program is stamped right after that voice's own *body* switch instead
  assert.match(out, /\nV:1\n%%MIDI program 56\n"C" C8 \|/);
  assert.match(out, /\nV:2\n%%MIDI program 0\n\[CEG\]8 \|/);
});

test("a native multi-voice chart with a real V: declaration always finds a scoping point (never falls back to the tune-wide line)", () => {
  const abc = ["X:1", "T:Test", "K:C", "V:1", '"C" C8 |'].join("\n");
  const out = injectMixerAudio(abc, { hasChords: false, bassPercent: 0, chordsPercent: 0, voicePrograms: new Map([["1", 56]]) });
  assert.match(out, /\nV:1\n%%MIDI program 56\n"C" C8 \|/);
  assert.doesNotMatch(out, /%%MIDI program 56\nK:/);
});
