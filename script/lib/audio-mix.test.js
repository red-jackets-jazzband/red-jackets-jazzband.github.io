import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIDI_VOLUME_MAX, DEFAULT_PROGRAM, percentToMidiVolume, injectMixerAudio, computeVoicesOff,
  GCHORD_PATTERNS, DEFAULT_GCHORD_PATTERN_VALUE, resolveGchordPattern,
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

const NO_COMPING_TUNE = ["X:1", "T:Test", "M:4/4", "L:1/8", "K:C", '"C" C8 |'].join("\n");

test("injectMixerAudio (no comping, no chords) stamps only the melody's %%MIDI program", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, { compingActive: false, hasChords: false, bassPercent: 0, chordsPercent: 0 });
  const lines = out.split("\n");
  assert.equal(lines[lines.indexOf("K:C") - 1], `%%MIDI program ${DEFAULT_PROGRAM.melody}`);
  assert.doesNotMatch(out, /%%MIDI (gchord|bassprog|chordprog|bassvol|chordvol|vol)\b/);
  assert.ok(out.includes('"C" C8 |'));
});

test("injectMixerAudio uses a custom melody program when given one", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, {
    compingActive: false, hasChords: false, melodyProgram: 71, bassPercent: 0, chordsPercent: 0,
  });
  assert.match(out, /%%MIDI program 71\nK:C/);
});

test("injectMixerAudio is a no-op when there's no K: line", () => {
  const abc = "X:1\nT:Test\n";
  assert.equal(injectMixerAudio(abc, { compingActive: false, hasChords: false, bassPercent: 0, chordsPercent: 0 }), abc);
});

test("injectMixerAudio stamps Bass/Chords accompaniment directives (default programs) when the tune has chords", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, {
    compingActive: false, hasChords: true, bassPercent: 70, chordsPercent: 20,
  });
  const before = out.slice(0, out.indexOf("K:C"));
  assert.match(before, /%%MIDI gchord bzczbzcz/);
  assert.match(before, new RegExp(`%%MIDI bassprog ${DEFAULT_PROGRAM.bass}`));
  assert.match(before, new RegExp(`%%MIDI chordprog ${DEFAULT_PROGRAM.chords}`));
  assert.match(before, new RegExp(`%%MIDI bassvol ${percentToMidiVolume(70)}`));
  assert.match(before, new RegExp(`%%MIDI chordvol ${percentToMidiVolume(20)}`));
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
    compingActive: false, hasChords: true, bassPercent: 0, chordsPercent: 0, gchordPattern: "fzczfzcz",
  });
  assert.match(out, /%%MIDI gchord fzczfzcz/);
});

test("injectMixerAudio omits the %%MIDI gchord line for a null pattern (Default), keeping the rest of the accompaniment block", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, {
    compingActive: false, hasChords: true, bassPercent: 70, chordsPercent: 20, gchordPattern: null,
  });
  assert.doesNotMatch(out, /%%MIDI gchord/);
  assert.match(out, new RegExp(`%%MIDI bassprog ${DEFAULT_PROGRAM.bass}`));
  assert.match(out, new RegExp(`%%MIDI bassvol ${percentToMidiVolume(70)}`));
});

test("injectMixerAudio uses custom Bass/Chords programs when given one", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, {
    compingActive: false, hasChords: true, bassPercent: 0, bassProgram: 33, chordsPercent: 0, chordsProgram: 0,
  });
  assert.match(out, /%%MIDI bassprog 33/);
  assert.match(out, /%%MIDI chordprog 0/);
});

test("injectMixerAudio omits accompaniment directives entirely when the tune has no chords", () => {
  const out = injectMixerAudio(NO_COMPING_TUNE, {
    compingActive: false, hasChords: false, bassPercent: 70, chordsPercent: 20,
  });
  assert.doesNotMatch(out, /%%MIDI (gchord|bassprog|chordprog|bassvol|chordvol)/);
});

test("injectMixerAudio (comping) stamps melody/comping program after their own body markers", () => {
  const abc = [
    "X:1", "T:Test", "L:1/8", "%%staves [1 2]", "V:1", 'V:2 name="R\\n3\\n5"', "K:C",
    "V:1", '"C" C8 |', "V:2", "[CEG]8 |",
  ].join("\n");
  const out = injectMixerAudio(abc, {
    compingActive: true, hasChords: true, melodyProgram: 56, compingProgram: 0, bassPercent: 0, chordsPercent: 0,
  });

  // The header's own "V:1\nV:2 name=..." declaration line is untouched —
  // only the accompaniment block (hasChords: true) landed before K:, and the
  // body markers further down each got their own line spliced after them.
  assert.match(out, /%%staves \[1 2\]\nV:1\nV:2 name="R\\n3\\n5"\n%%MIDI gchord/);
  assert.match(out, /%%MIDI chordvol 0\nK:C/);
  assert.match(out, /\nV:1\n%%MIDI program 56\n"C" C8 \|/);
  assert.match(out, /\nV:2\n%%MIDI program 0\n\[CEG\]8 \|/);
});

test("injectMixerAudio (comping) defaults melody/comping program when none given", () => {
  const abc = [
    "X:1", "T:Test", "L:1/8", "%%staves [1 2]", "V:1", 'V:2 name="R\\n3\\n5"', "K:C",
    "V:1", '"C" C8 |', "V:2", "[CEG]8 |",
  ].join("\n");
  const out = injectMixerAudio(abc, { compingActive: true, hasChords: false, bassPercent: 0, chordsPercent: 0 });
  assert.match(out, new RegExp(`\\nV:1\\n%%MIDI program ${DEFAULT_PROGRAM.melody}\\n`));
  assert.match(out, new RegExp(`\\nV:2\\n%%MIDI program ${DEFAULT_PROGRAM.comping}\\n`));
  assert.doesNotMatch(out, /%%MIDI (gchord|bassprog|chordprog|bassvol|chordvol)/);
});

test("computeVoicesOff without comping: only melody can be muted, as a full mute", () => {
  assert.equal(computeVoicesOff({ compingActive: false, melodyMuted: false, compingMuted: false }).voicesOff, undefined);
  assert.equal(computeVoicesOff({ compingActive: false, melodyMuted: true, compingMuted: false }).voicesOff, true);
  // compingMuted is meaningless without a comping voice at all
  assert.equal(computeVoicesOff({ compingActive: false, melodyMuted: false, compingMuted: true }).voicesOff, undefined);
});

test("computeVoicesOff with comping: melody and comping mute independently", () => {
  assert.equal(computeVoicesOff({ compingActive: true, melodyMuted: false, compingMuted: false }).voicesOff, undefined);
  assert.deepEqual(computeVoicesOff({ compingActive: true, melodyMuted: true, compingMuted: false }).voicesOff, [0]);
  assert.deepEqual(computeVoicesOff({ compingActive: true, melodyMuted: false, compingMuted: true }).voicesOff, [1]);
  assert.deepEqual(computeVoicesOff({ compingActive: true, melodyMuted: true, compingMuted: true }).voicesOff, [0, 1]);
});
