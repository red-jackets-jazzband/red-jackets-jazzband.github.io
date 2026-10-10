import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chordName, keyRoot, parseChordSymbol, splitChordSymbol,
} from "./chord-symbol.js";

test("parseChordSymbol: root and function", () => {
  assert.deepEqual(parseChordSymbol("Bb7"), { root: 10, quality: "dom" });
  assert.deepEqual(parseChordSymbol("B♭"), { root: 10, quality: "maj" });
  assert.deepEqual(parseChordSymbol("C#7"), { root: 1, quality: "dom" });
  assert.deepEqual(parseChordSymbol("Bb/D"), { root: 10, quality: "maj" });
  assert.equal(parseChordSymbol("Ebm").quality, "min");
  assert.equal(parseChordSymbol("Ebm6").quality, "min");
  assert.equal(parseChordSymbol("Bbmaj7").quality, "maj");
  assert.equal(parseChordSymbol("Bb6").quality, "maj");
  assert.equal(parseChordSymbol("F+7").quality, "dom");
  assert.equal(parseChordSymbol("Gm7b5").quality, "hdim");
  assert.equal(parseChordSymbol("Edim").quality, "dim");
  assert.equal(parseChordSymbol("N.C."), null);
  assert.equal(parseChordSymbol(""), null);
});

test("parseChordSymbol: sixths, ninths and suspensions keep their function", () => {
  assert.equal(parseChordSymbol("C6").quality, "maj");
  assert.equal(parseChordSymbol("C6/9").quality, "maj");
  assert.equal(parseChordSymbol("C9").quality, "dom");
  assert.equal(parseChordSymbol("C13").quality, "dom");
  assert.equal(parseChordSymbol("Cm7").quality, "min");
  assert.equal(parseChordSymbol("C-7").quality, "min");
  assert.equal(parseChordSymbol("CΔ7").quality, "maj");
  assert.equal(parseChordSymbol("C°7").quality, "dim");
  assert.equal(parseChordSymbol("Cø").quality, "hdim");
  assert.equal(parseChordSymbol("C+").quality, "aug");
  assert.equal(parseChordSymbol("C7sus4").quality, "dom");
});

test("parseChordSymbol: an accidental root, and a flat five is not a flat root", () => {
  assert.equal(parseChordSymbol("Ab7").root, 8);
  assert.equal(parseChordSymbol("F#m").root, 6);
  assert.equal(parseChordSymbol("E♭").root, 3);
  assert.equal(parseChordSymbol("Bb").root, 10);
  assert.deepEqual(splitChordSymbol("Bm7b5"), { root: 11, rest: "m7b5" });
  assert.deepEqual(splitChordSymbol("Bb/D"), { root: 10, rest: "" });
});

test("a symbol that isn't a chord parses to null", () => {
  ["N.C.", "", "x", "^Break", "(tacet)", "H7"].forEach((name) => assert.equal(parseChordSymbol(name), null, name));
  assert.equal(splitChordSymbol(null), null);
  assert.equal(parseChordSymbol(undefined), null);
});

test("chordName reads an element's own chord symbol, not its annotations", () => {
  assert.equal(chordName({}), null);
  assert.equal(chordName({ chord: [{ name: "x", position: "above" }] }), null);
  assert.equal(chordName({ chord: [{ name: "Break", position: "left" }, { name: "G7", position: "default" }] }), "G7");
  assert.equal(chordName({ chord: [{ name: "C" }] }), "C");
});

test("keyRoot is the tonic's pitch class, and null with no key", () => {
  assert.equal(keyRoot({ root: "F", acc: "" }), 5);
  assert.equal(keyRoot({ root: "B", acc: "b" }), 10);
  assert.equal(keyRoot({ root: "F", acc: "#" }), 6);
  assert.equal(keyRoot({ root: "C", acc: "sharp" }), 1);
  assert.equal(keyRoot(undefined), null);
  assert.equal(keyRoot({ root: "H" }), null);
});

test("a half-diminished chord is one however it's spelled, at the start of what follows the root", () => {
  ["Cø", "CØ", "Cm7b5", "Cm7♭5", "CmØ"].forEach((name) => assert.equal(parseChordSymbol(name).quality, "hdim", name));
  assert.equal(parseChordSymbol("CxØ").quality, "maj", "a stray Ø later in the symbol isn't one");
});
