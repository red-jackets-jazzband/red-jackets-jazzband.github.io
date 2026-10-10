import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import { findNamedProgressions } from "./progressions.js";

const parse = (body, header = "M:4/4\nL:1/4\nK:Bb") => ABCJS.parseOnly(`X:1\n${header}\n${body}\n`)[0];
const names = (song) => findNamedProgressions(song).map((m) => m.name);

test("Salty Dog: VI7 II7 V7 I, a bar each", () => {
  assert.deepEqual(names(parse('"G7" D4 | "C7" D4 | "F7" D4 | "Bb" B4 |')), ["Salty Dog"]);
});

test("Four-Leaf: I II7 V7 I, two bars each", () => {
  const song = parse('"Bb" B4 | B4 | "C7" c4 | c4 | "F7" F4 | F4 | "Bb" B4 | B4 |');
  assert.deepEqual(names(song), ["Four-Leaf"]);
});

test("Four-Leaf: the V7 bars may hold a turnaround back to V7 (Four-Leaf Clover)", () => {
  const song = parse('"Bb" B4 | B4 | "C7" c4 | c4 | "F7" F4 | "Gm" G4 | "C7" c4 | "F7" F4 | "Bb" B4 |');
  assert.deepEqual(names(song), ["Four-Leaf"]);
});

test("Four-Leaf: a plain V triad with a C7 turnaround (Honky Tonk Town)", () => {
  const song = parse('"Bb" B4 | B4 | "C7" c4 | c4 | "F" F4 | F4 | F4 | "C7" c4 | "F7" F4 | "Bb" B4 |');
  assert.deepEqual(names(song), ["Four-Leaf"]);
});

test("Four-Leaf: a V7 that never returns to the I is no Four-Leaf", () => {
  const song = parse('"Bb" B4 | B4 | "C7" c4 | c4 | "F7" F4 | "Gm" G4 | "Eb" E4 | "Bb" B4 |');
  assert.deepEqual(names(song), []);
});

test("Georgia hands its VI7 on to a Salty Dog, and both bands cover it", () => {
  // Basin Street's B section, approach chord (Ab7) and all.
  const song = parse('"Bb" D4 | "D7" D4 | "G7" D4 | "Ab7" E2 "G7" D2 | "C7" D4 | "F7" D4 | "Bb/D" c2 "C#7" A2 | "C7" B2 "F7" F2 |');
  const found = findNamedProgressions(song);
  assert.deepEqual(found.map((m) => m.name), ["Georgia", "Salty Dog"]);
  assert.deepEqual([found[0].startNote, found[0].endNote], [0, 3], "Georgia: Bb, D7 and the G7 it shares");
  assert.deepEqual([found[1].startNote, found[1].endNote], [2, 8], "Salty Dog: G7 to the Bb/D");
});

test("Sunshine: the eight bars of Post 565, IV IVm I VI7 II7 V7 I I", () => {
  const song = parse('"Eb" G4 | "Ebm" G4 | "Bb" F4 | "G7" G4 | "C7" G4 | "F7" A4 | "Bb" B4 | B4 |');
  const found = findNamedProgressions(song);
  assert.deepEqual(found.map((m) => m.name), ["Sunshine"], "not a Salty Dog inside it");
  assert.deepEqual([found[0].startNote, found[0].endNote], [0, 8], "all eight bars, the closing I's second one too");
});

test("Sunshine's variations: #IV dim (any spelling) or IV dim in bar 2, IIm7 in bar 5", () => {
  // Bill Bailey in F: Fdim is B°7 respelled, the #IV dim.
  assert.deepEqual(names(parse('"Bb" A4 | "Fdim" A4 | "F" A4 | "D7" A4 | "G7" A4 | "C7" A4 | "F" F4 |', "M:4/4\nL:1/4\nK:F")), ["Sunshine"]);
  // Four-Leaf Clover in Bb: Ebdim, the IV dim.
  assert.deepEqual(names(parse('"Eb" G4 | "Ebdim" G4 | "Bb" F4 | "G7" G4 | "Cm7" G4 | "F7" A4 | "Bb" B4 |')), ["Sunshine"]);
});

test("Sunshine compressed into half-bars still counts; IV IVm I alone does not", () => {
  assert.deepEqual(names(parse('"Eb" G2 "Ebm" G2 | "Bb" F2 "G7" G2 | "C7" G2 "F7" A2 | "Bb" B4 |')), ["Sunshine"]);
  assert.deepEqual(names(parse('"Eb" G4 | "Ebm" G4 | "Bb" F4 | F4 |')), []);
});

test("Apple Tree only counts as an opening", () => {
  assert.deepEqual(names(parse('P:A\n"Bb" B4 | "Eb" G4 | "Bb" F4 | F4 |')), ["Apple Tree"]);
  assert.deepEqual(names(parse('"F7" A4 | "Bb" B4 | "Eb" G4 | "Bb" F4 |')), []);
});

test("Apple Tree is just I IV I, not the V that follows (Just a Little While)", () => {
  const song = parse('P:A\n"F" A4 | A2 "Bb" B2 | "F" A4 | A4 | A4 | A2 "C7" G2 | "F" F4 |', "M:4/4\nL:1/4\nK:F");
  const found = findNamedProgressions(song);
  assert.deepEqual(found.map((m) => m.name), ["Apple Tree"]);
  assert.deepEqual([found[0].startNote, found[0].endNote], [0, 4]);
  assert.deepEqual(found[0].chordNotes, [0, 2, 3]);
});

test("a chord change faster than a bar isn't a named progression", () => {
  assert.deepEqual(names(parse('"G7" D2 "C7" D2 | "F7" D2 "Bb" D2 |')), []);
});

test("minor keys and chordless tunes give nothing", () => {
  assert.deepEqual(names(parse('"Eb" G4 | "Ebm" G4 | "Bb" F4 |', "M:4/4\nL:1/4\nK:Gm")), []);
  assert.deepEqual(names(parse("B4 | c4 |")), []);
});

test("a progression running onto the next line gets a label offset per line", () => {
  const text = 'X:1\nM:4/4\nL:1/4\nK:Bb\n"G7" D4 | "C7" D4 |\n"F7" E4 | "Bb" F4 |\n';
  const [match] = findNamedProgressions(ABCJS.parseOnly(text)[0]);
  assert.equal(match.lineStarts.length, 2);
  assert.equal(text.slice(match.lineStarts[0], match.lineStarts[0] + 4), '"G7"');
  assert.equal(text.slice(match.lineStarts[1], match.lineStarts[1] + 4), '"F7"');
});

test("chordNotes mark every chord symbol of the pattern's eight bars, a restated one included (Bourbon Street Parade's B♭ runs three bars)", () => {
  const song = parse('"F" A4 | A4 | "Bb" B4 | B4 |\n"Bb" B4 | "Fdim" A4 | "F" A4 | "D7" A4 | "G7" G4 | "C7" G4 | "F" F4 | F4 |', "M:4/4\nL:1/4\nK:F");
  const found = findNamedProgressions(song);
  assert.deepEqual(found.map((m) => m.name), ["Sunshine"]);
  assert.deepEqual(found[0].chordNotes, [4, 5, 6, 7, 8, 9, 10], "eight bars: the first B♭ bars are only a long IV");
  assert.equal(found[0].startNote, 4);
});

test("a match carries the blog post that explains the progression", () => {
  const [match] = findNamedProgressions(parse('"G7" D4 | "C7" D4 | "F7" D4 | "Bb" B4 |'));
  assert.equal(match.url, "https://playing-traditional-jazz.blogspot.com/2013/06/salty-dog-chord-progression.html");
});
