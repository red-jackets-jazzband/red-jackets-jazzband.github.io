import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import { bestVoicing, chordSkeletons, spellChord } from "./chord-skeleton.js";

const parse = (body, key = "C") => ABCJS.parseOnly(`X:1\nM:4/4\nL:1/4\nK:${key}\n${body}\n`)[0];
const LETTERS = "CDEFGAB";
const ALTER = { "-2": "bb", "-1": "b", 0: "", 1: "#" };
const spell = (name) => spellChord(name).map((t) => `${LETTERS[t.letter]}${ALTER[t.alter]}`);

test("spellChord spells from the root's letter", () => {
  assert.deepEqual(spell("C"), ["C", "E", "G"]);
  assert.deepEqual(spell("Bb7"), ["Bb", "D", "F", "Ab"]);
  assert.deepEqual(spell("F#m"), ["F#", "A", "C#"]);
  assert.deepEqual(spell("Gdim7"), ["G", "Bb", "Db", "Fb"]);
});

test("a seventh is there only when the symbol writes one", () => {
  assert.equal(spellChord("C").length, 3);
  assert.equal(spellChord("C7").length, 4);
  assert.equal(spellChord("Cmaj7").length, 4);
  assert.equal(spellChord("C6").length, 4);
});

test("bestVoicing picks the inversion under the most melody notes", () => {
  const tones = spellChord("C");
  // E4 G4 C5 is C's first inversion.
  const placed = bestVoicing(tones, [64, 67, 72, 67], 67);
  assert.deepEqual(placed.map((p) => p.midi), [64, 67, 72]);
});

test("bestVoicing falls back to root position nearest the centre", () => {
  const placed = bestVoicing(spellChord("C"), [], 62);
  assert.deepEqual(placed.map((p) => p.midi), [60, 64, 67]);
});

test("chordSkeletons: one stack per chord symbol, in the bar's own inversion", () => {
  const song = parse('"C" E G c G | "G7" B d f d |');
  const out = chordSkeletons(song);
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "C");
  // E4, G4, C5 are verticalPos 2, 4 and 7.
  assert.deepEqual(out[0].notes.map((n) => n.vp), [2, 4, 7]);
  assert.equal(out[1].name, "G7");
});

test("a chord's span ends at the next chord or the bar line", () => {
  const song = parse('"C" C E "G" D G | c4 |');
  const [first, second] = chordSkeletons(song);
  // C's own melody is C E: the root-position C triad covers both.
  assert.deepEqual(first.notes.map((n) => n.vp), [0, 2, 4]);
  assert.equal(second.name, "G");
});

test("notes outside the key carry an accidental, notes in it don't", () => {
  const song = parse('"Bb7" B,2 D2 |', "C");
  const [skeleton] = chordSkeletons(song);
  const glyphs = skeleton.notes.map((n) => n.accidental);
  assert.ok(glyphs.includes("♭"));
  const plain = chordSkeletons(parse('"C" C E G c |'))[0];
  assert.ok(plain.notes.every((n) => n.accidental === null));
});

test("a bar with no chord, or an unreadable symbol, gets nothing", () => {
  assert.deepEqual(chordSkeletons(parse("C D E F |")), []);
  assert.deepEqual(chordSkeletons(parse('"N.C." C D E F |')), []);
});

test("skeleton notes outside the key's scale are flagged", () => {
  const [diatonic] = chordSkeletons(parse('"G7" B d f d |'));
  assert.ok(diatonic.notes.every((n) => n.outside === false));
  const [a7] = chordSkeletons(parse('"A7" c e g e |'));
  assert.equal(a7.notes.filter((n) => n.outside).length, 1); // C#
});
