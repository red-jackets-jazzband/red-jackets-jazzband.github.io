import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import {
  chordTones, degreeName, degreeText, melodyDegrees, parseDegreeText,
} from "./scale-degrees.js";
import { topNote, walkMelody } from "./melody-walk.js";
import { resolveTranspose } from "./render-plan.js";

const parse = (body, key = "C") => ABCJS.parseOnly(`X:1\nM:4/4\nL:1/4\nK:${key}\n${body}\n`)[0];
const summary = (song) => melodyDegrees(song).map((d) => `${d.degree}:${d.tone}`);
const names = (pitchClasses) => [...pitchClasses].sort((a, b) => a - b);

test("degreeName counts semitones above the tonic", () => {
  assert.deepEqual([0, 3, 7, 10, 11].map(degreeName), ["1", "♭3", "5", "♭7", "7"]);
  assert.equal(degreeName(-1), "7");
  assert.equal(degreeName(14), "2");
});

test("chordTones: triad, plus the sixth or seventh a symbol names", () => {
  assert.deepEqual(names(chordTones("C")), [0, 4, 7, 11]); // the 1 chord: 1 3 5 7
  assert.deepEqual(names(chordTones("Dm")), [0, 2, 5, 9]); // the 2 chord: 2 4 6 1
  assert.deepEqual(names(chordTones("C6")), [0, 4, 7, 9, 11]);
  assert.deepEqual(names(chordTones("C7")), [0, 4, 7, 10]);
  assert.deepEqual(names(chordTones("Cmaj7")), [0, 4, 7, 11]);
  assert.deepEqual(names(chordTones("Cm7")), [0, 3, 7, 10]);
  assert.deepEqual(names(chordTones("Cm6")), [0, 3, 7, 9, 10]);
  assert.deepEqual(names(chordTones("Cdim")), [0, 3, 6, 9]);
  assert.deepEqual(names(chordTones("Cm7b5")), [0, 3, 6, 10]);
  assert.deepEqual(names(chordTones("C7#5")), [0, 4, 8, 10]);
  assert.deepEqual(names(chordTones("Bb7")), [2, 5, 8, 10]);
  assert.deepEqual(names(chordTones("C/E")), [0, 4, 7, 11]);
  assert.deepEqual(names(chordTones("C/D")), [0, 2, 4, 7, 11]);
  assert.equal(chordTones("N.C.").size, 0);
});

test("each note is named by its step in the key, tone against the chord", () => {
  const song = parse('"C" C E G A | "G7" B d f e |');
  assert.deepEqual(summary(song), [
    "1:chord", "3:chord", "5:chord", "6:other",
    "7:chord", "2:chord", "4:chord", "3:other",
  ]);
});

test("notes before the first chord have no tone; a chord stays until the next", () => {
  const song = parse('C "F" F A | G c |');
  assert.deepEqual(summary(song), ["1:none", "4:chord", "6:chord", "5:other", "1:chord"]);
});

test("accidentals and the key signature are honoured; a tie is labelled once", () => {
  const song = parse('"Bb7" B ^F F- | F B', "F");
  assert.deepEqual(summary(song), ["4:chord", "\u266D2:other", "\u266D2:other", "4:chord"]);
});

test("degrees don't change when the instrument transposes the printed part", () => {
  const text = 'X:1\nM:4/4\nL:1/4\nK:C\n"C" C E G c |\n';
  const { abcText, visual } = resolveTranspose(text, "trumpet", 0);
  const song = ABCJS.parseOnly(abcText, { visualTranspose: visual })[0];
  assert.deepEqual(summary(song), ["1:chord", "3:chord", "5:chord", "1:chord"]);
});

test("a minor key counts from its tonic", () => {
  const song = parse('"Am" A c e | "E7" ^G', "Am");
  assert.deepEqual(summary(song), ["1:chord", "♭3:chord", "5:chord", "7:chord"]);
});

test("annotation text round-trips through degreeText / parseDegreeText", () => {
  assert.deepEqual(parseDegreeText(degreeText("♭7", "other")), { tone: "other", degree: "♭7" });
  assert.deepEqual(parseDegreeText(degreeText("3", "chord")), { tone: "chord", degree: "3" });
  assert.deepEqual(parseDegreeText(degreeText("1", "none")), { tone: "none", degree: "1" });
  assert.equal(parseDegreeText("3"), null);
  assert.equal(parseDegreeText("Salty Dog progression"), null);
});

test("chordTones: a maj6 chord's sixth is a chord tone", () => {
  assert.ok(chordTones("Cmaj6").has(9));
  assert.ok(chordTones("Cm6").has(9));
});

test("N.C. clears the chord, so no note under it is a chord tone", () => {
  const song = parse('"C" C "N.C." E "G" G');
  assert.deepEqual(summary(song), ["1:chord", "3:none", "5:chord"]);
});

test("an inline key change moves the tonic from there on", () => {
  const song = parse("C D | [K:G] G A", "C");
  assert.deepEqual(summary(song), ["1:none", "2:none", "1:none", "2:none"]);
});

test("an inline clef change is followed, so the same note keeps its pitch", () => {
  const midis = [];
  walkMelody(parse("C | [K:C clef=bass] C"), (el, state) => {
    const top = topNote(el, state);
    if (top !== null) midis.push(top.midi);
  });
  assert.equal(midis.length, 2);
  assert.equal(midis[0], midis[1], "C is middle C in either clef");
});
