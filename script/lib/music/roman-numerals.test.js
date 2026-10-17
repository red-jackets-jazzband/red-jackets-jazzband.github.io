import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import { chordNumerals } from "./roman-numerals.js";

const parse = (body, key = "C") => ABCJS.parseOnly(`X:1\nM:4/4\nL:1/4\nK:${key}\n${body}\n`)[0];
const numerals = (song) => chordNumerals(song).map((c) => `${c.name}=${c.numeral}`);

test("each chord as its numeral in a major key", () => {
  assert.deepEqual(numerals(parse('"C" C | "Dm7" D | "G7" G | "Bb" B | "Bm7b5" B | "A7" A |')),
    ["C=I", "Dm7=ii7", "G7=V7", "B♭=♭VII", "Bm7♭5=viiø7", "A7=VI7"]);
});

test("a minor key counts from its own tonic", () => {
  assert.deepEqual(numerals(parse('"Am" A | "Dm" D | "E7" E | "C" C |', "Am")), ["Am=i", "Dm=iv", "E7=V7", "C=III"]);
});

test("the key signature's accidental is part of the tonic", () => {
  assert.deepEqual(numerals(parse('"Bb" B | "F7" F | "Eb" E |', "Bb")), ["B♭=I", "F7=V7", "E♭=IV"]);
});

test("a key change mid-tune is followed", () => {
  assert.deepEqual(numerals(parse('"F" F |\nK:F\n"F" F |')), ["F=IV", "F=I"]);
});

test("N.C. and annotations aren't chords", () => {
  assert.deepEqual(numerals(parse('"N.C." C | "^intro" D | "G" G |')), ["G=V"]);
});
