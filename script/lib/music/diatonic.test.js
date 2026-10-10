import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import { chordPitchClasses, outsideChords } from "./diatonic.js";

const parse = (body, key = "C") => ABCJS.parseOnly(`X:1\nM:4/4\nL:1/4\nK:${key}\n${body}\n`)[0];
const names = (song) => outsideChords(song).map((c) => c.name);

test("chordPitchClasses: triad, written seventh or sixth, slash bass", () => {
  assert.deepEqual([...chordPitchClasses("C")].sort((a, b) => a - b), [0, 4, 7]);
  assert.deepEqual([...chordPitchClasses("G7")].sort((a, b) => a - b), [2, 5, 7, 11]);
  assert.ok(chordPitchClasses("C/F#").has(6));
  assert.equal(chordPitchClasses("N.C."), null);
});

test("chords made only of the key's notes are diatonic", () => {
  assert.deepEqual(names(parse('"C" C | "Dm7" D | "G7" G | "Am" A | "Fmaj7" F | "Bm7b5" B |')), []);
});

test("a chord with a note outside the key is reported, with that note", () => {
  const [a7, c7] = outsideChords(parse('"A7" A | "C7" C |'));
  assert.deepEqual(a7.outside, [1]); // C#
  assert.deepEqual(c7.outside, [10]); // Bb
});

test("the key signature decides: Bb is diatonic in F, not in C", () => {
  assert.equal(names(parse('"Bb" B |', "F")).length, 0);
  assert.equal(names(parse('"Bb" B |', "C")).length, 1);
});

test("a minor key takes its leading tone: E7 is fine in Am", () => {
  assert.deepEqual(names(parse('"Am" A | "E7" E |', "Am")), []);
  assert.deepEqual(names(parse('"A7" A |', "Am")), ["A7"]);
});

test("a key change mid-tune is followed", () => {
  assert.equal(names(parse('"Bb" B |\nK:F\n"Bb" B |')).length, 1);
});

test("N.C. and a tune with no chords are never marked", () => {
  assert.deepEqual(names(parse('"N.C." C D |')), []);
  assert.deepEqual(names(parse("C D E F |")), []);
});
