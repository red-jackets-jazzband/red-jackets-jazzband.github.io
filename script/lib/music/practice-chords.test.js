import { test } from "node:test";
import assert from "node:assert/strict";
import { practiceChord } from "./practice-chords.js";
import { withRealTonal } from "../../../../tests/helpers/bar-voice.js";

const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const C_MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);
const A_MINOR = C_MAJOR;

// A chord's tones / guide tones / scale as note names, root first.
function names(sym, part, key = null) {
  return withRealTonal(() => {
    const chord = practiceChord(sym, key);
    return chord[part].map((s) => NAMES[(chord.root + s) % 12]).join(" ");
  });
}

test("chord tones are what the symbol writes", () => {
  assert.equal(names("Cmaj7", "tones"), "C E G B");
  assert.equal(names("C6", "tones"), "C E G A");
  assert.equal(names("Cm6", "tones"), "C Eb G A");
  assert.equal(names("CmMaj7", "tones"), "C Eb G B");
  assert.equal(names("Csus4", "tones"), "C F G");
  assert.equal(names("C7sus4", "tones"), "C F G Bb");
  assert.equal(names("C+", "tones"), "C E Ab", "an augmented triad gets no 7th");
  assert.equal(names("Cm7b5", "tones"), "C Eb F# Bb");
});

test("an unwritten 7th: a major triad takes the 6th, a minor one the minor 7th, a diminished one the diminished 7th", () => {
  assert.equal(names("C", "tones"), "C E G A");
  assert.equal(names("Cm", "tones"), "C Eb G Bb");
  assert.equal(names("Cdim", "tones"), "C Eb F# A");
});

test("guide tones are the 3rd (or the sus note) and the 7th or 6th", () => {
  assert.equal(names("Cmaj7", "guide"), "E B");
  assert.equal(names("Cm6", "guide"), "Eb A");
  assert.equal(names("C7sus4", "guide"), "F Bb");
});

test("without a key: Ionian, Mixolydian, Dorian, Locrian, and written tensions kept", () => {
  assert.equal(names("C", "scale"), "C D E F G A B");
  assert.equal(names("C7", "scale"), "C D E F G A Bb");
  assert.equal(names("Cm7", "scale"), "C D Eb F G A Bb");
  assert.equal(names("Cm7b5", "scale"), "C C# Eb F F# Ab Bb");
  assert.equal(names("C7b9", "scale"), "C C# E F G A Bb");
  assert.equal(names("C7#9", "scale"), "C Eb E F G A Bb");
  assert.equal(names("Cm6", "scale"), "C D Eb F G A Bb", "never a b6 against the written 6th");
  assert.equal(names("Csus4", "scale"), "C D F G A B", "no 3rd against the 4th");
});

test("the key picks the tensions: the chords around a key get its notes", () => {
  assert.equal(names("Em7", "scale", C_MAJOR), "E F G A B C D", "iii: Phrygian");
  assert.equal(names("Am", "scale", C_MAJOR), "A B C D E F G", "vi: Aeolian");
  assert.equal(names("F", "scale", C_MAJOR), "F G A B C D E", "IV: Lydian");
  assert.equal(names("Bb7", "scale", C_MAJOR), "Bb C D E F G Ab", "bVII7: Lydian dominant");
  assert.equal(names("A7", "scale", C_MAJOR), "A B C# D E F G", "V of ii: b13");
  assert.equal(names("E7", "scale", A_MINOR), "E F Ab A B C D", "V in minor: b9, b13");
  assert.equal(names("G7", "scale", C_MAJOR), "G A B C D E F");
});

test("an unknown chord throws", () => {
  assert.throws(() => withRealTonal(() => practiceChord("H7")));
});
