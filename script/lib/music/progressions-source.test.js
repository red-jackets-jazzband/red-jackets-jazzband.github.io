/*
  Each test here is a claim from Pops Coffee's "Playing Traditional Jazz"
  post that defines the progression (post numbers in the names; the posts
  themselves are linked from lib/music/progressions.js). The unit tests in
  progressions.test.js cover how the matcher steps through a chart; these
  pin what each named progression *is*, so a change to the matcher can't
  quietly stray from the source.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import { findNamedProgressions, PROGRESSION_NAMES } from "./progressions.js";

const C_MAJOR = "M:4/4\nL:1/4\nK:C";
const parse = (body, header = C_MAJOR) => ABCJS.parseOnly(`X:1\n${header}\n${body}\n`)[0];
const found = (body, header) => findNamedProgressions(parse(body, header));
const names = (body, header) => found(body, header).map((m) => m.name);
// A bar of one chord: `bars("C", "E7", "A7")` -> "C" c4 | "E7" ...
const bars = (...chords) => chords.map((c) => (c ? `"${c}" c4` : "c4")).join(" | ") + " |";
// The same chords as half-bar pairs: ("C", "Dm") -> one bar.
const halves = (...chords) => {
  const out = [];
  for (let i = 0; i < chords.length; i += 2) out.push(`"${chords[i]}" c2 "${chords[i + 1]}" c2`);
  return `${out.join(" | ")} |`;
};

test("the vocabulary is the five progressions the blog names", () => {
  assert.deepEqual([...PROGRESSION_NAMES].sort(), ["Apple Tree", "Four-Leaf", "Georgia", "Salty Dog", "Sunshine"]);
});

const link = (body) => found(body)[0].url;

test("every match links to the post that defines it", () => {
  assert.match(link(bars("A7", "D7", "G7", "C")), /2013\/06\/salty-dog-chord-progression/);
  assert.match(link(bars("C", "D7", "G7", "C")), /2016\/07\/a-very-common-pattern/);
  assert.match(link(bars("C", "E7", "A7")), /2013\/01\/the-georgia-chord-progression/);
  assert.match(link(bars("F", "Fm", "C", "A7", "D7", "G7", "C", "C")), /2017\/11\/post-565/);
  assert.match(link(bars("C", "F", "C")), /2013\/06\/the-apple-tree-chord-progression/);
});

// --- Post 92: Salty Dog = VI7-II7-V7-I ---------------------------------

test("Post 92 — Salty Dog is VI7-II7-V7-I; in C that is A7 D7 G7 C", () => {
  assert.deepEqual(names(bars("A7", "D7", "G7", "C")), ["Salty Dog"]);
});

test("Post 92 — it works in every key (the post shows Bb: G7 C7 F7 Bb)", () => {
  assert.deepEqual(names(bars("G7", "C7", "F7", "Bb"), "M:4/4\nL:1/4\nK:Bb"), ["Salty Dog"]);
  assert.deepEqual(names(bars("D7", "G7", "C7", "F"), "M:4/4\nL:1/4\nK:F"), ["Salty Dog"]);
});

test("Post 92 — the VI has to be a seventh and the II and V dominant, or it is another pattern", () => {
  assert.deepEqual(names(bars("Am", "D7", "G7", "C")), []);
  assert.deepEqual(names(bars("A7", "Dm", "G7", "C")), []);
});

// --- Post 413: Four-Leaf = I-II7-V7-I ----------------------------------

test("Post 413 — Four-Leaf is I-II(7)-V7-I, two bars each (C, D, G7, C)", () => {
  assert.deepEqual(names("\"C\" c4 | c4 | \"D7\" c4 | c4 | \"G7\" c4 | c4 | \"C\" c4 | c4 |"), ["Four-Leaf"]);
});

test("Post 413 — the II is D major in the post's own example, so a plain II counts", () => {
  assert.deepEqual(names(bars("C", "D", "G7", "C")), ["Four-Leaf"]);
});

const four = (chord) => `"${chord}" c4 | c4 | c4 | c4 |`;

test("Post 413 — four bars a chord (Down in Honky Tonk Town) is the same pattern", () => {
  assert.deepEqual(names([four("C"), four("D7"), four("G7"), four("C")].join(" ")), ["Four-Leaf"]);
});

test("Post 413 — half-bars (Lulu's Back in Town) are the same pattern", () => {
  assert.deepEqual(names(halves("C", "D7", "G7", "C")), ["Four-Leaf"]);
});

test("Post 413 — Allen Robnett's I-VI7-II7-V7-I: a bar on the I, then a bar on the VI7", () => {
  const [match] = found(bars("C", "A7", "D7", "G7", "C"));
  assert.equal(match.name, "Four-Leaf");
  assert.equal(match.startNote, 0, "the match starts on the tonic bar");
  assert.equal(match.chordNotes.length, 5);
});

test("Post 413 — … but a tonic held for longer first is only a long I before a Salty Dog", () => {
  assert.deepEqual(names("\"C\" c4 | c4 | \"A7\" c4 | \"D7\" c4 | \"G7\" c4 | \"C\" c4 |"), ["Salty Dog"]);
});

test("a quick I vi ii V turnaround is not the Four-Leaf pattern", () => {
  assert.deepEqual(names(halves("C", "Am", "Dm", "G7") + " " + bars("C")), []);
});

// --- Post 139: Georgia = I-III-VI ---------------------------------------

test("Post 139 — Georgia is I, III, VI; in C that is C E7 A7, two bars each", () => {
  assert.deepEqual(names("\"C\" c4 | c4 | \"E7\" c4 | c4 | \"A7\" c4 | c4 |"), ["Georgia"]);
});

test("Post 139 — the chord of the sixth is \"sometimes major and sometimes minor\"", () => {
  assert.deepEqual(names(bars("C", "E7", "A")), ["Georgia"], "major");
  assert.deepEqual(names(bars("C", "E7", "A7")), ["Georgia"], "dominant");
  assert.deepEqual(names(bars("C", "E7", "Am")), ["Georgia"], "minor");
  assert.deepEqual(names(bars("C", "E7", "Am7")), ["Georgia"], "minor seventh");
});

test("Post 139 — the third-degree chord is a major or dominant one (C, E, A in the post's key of C)", () => {
  assert.deepEqual(names(bars("C", "E", "A7")), ["Georgia"]);
  assert.deepEqual(names(bars("C", "Em", "A7")), [], "the diatonic Em is not the Georgia chord");
});

test("Post 139 — Georgia's last chord is where a Salty Dog can start, and both bands cover it", () => {
  const out = found(bars("C", "E7", "A7", "D7", "G7", "C"));
  assert.deepEqual(out.map((m) => m.name), ["Georgia", "Salty Dog"]);
  assert.deepEqual(out[0].chordNotes, [0, 1, 2], "Georgia: C, E7 and the A7");
  assert.deepEqual(out[1].chordNotes, [2, 3, 4, 5], "Salty Dog: from that same A7");
});

// --- Post 565: Sunshine = IV | IVm | I | VI7 | II7 | V7 | I | I ----------

test("Post 565 — Sunshine in C: F | Fm | C | A7 | D7 | G7 | C | C", () => {
  const out = found(bars("F", "Fm", "C", "A7", "D7", "G7", "C", "C"));
  assert.deepEqual(out.map((m) => m.name), ["Sunshine"]);
  assert.deepEqual(out[0].chordNotes, [0, 1, 2, 3, 4, 5, 6, 7], "all eight bars, the closing I's second bar too");
  assert.equal(out[0].endNote, 8);
});

test("Post 565 — and in G: C | Cm | G | E7 | A7 | D7 | G | G", () => {
  const names = found(bars("C", "Cm", "G", "E7", "A7", "D7", "G", "G"), "M:4/4\nL:1/4\nK:G").map((m) => m.name);
  assert.deepEqual(names, ["Sunshine"]);
});

test("Post 565 — bar 2 is often a #IV diminished chord (C♯ dim in G)", () => {
  const body = bars("C", "C#dim", "G", "E7", "A7", "D7", "G", "G");
  assert.deepEqual(names(body, "M:4/4\nL:1/4\nK:G"), ["Sunshine"]);
});

test("Post 565 — bar 5 may be a minor seventh on the second degree", () => {
  assert.deepEqual(names(bars("F", "Fm", "C", "A7", "Dm7", "G7", "C", "C")), ["Sunshine"]);
});

test("Post 565 — the last two beats of bar 7 may take the IV before the I returns", () => {
  const body = `${bars("F", "Fm", "C", "A7", "D7", "G7").slice(0, -1)} "C" c2 "F" c2 | "C" c4 |`;
  const [match] = found(body);
  assert.equal(match.name, "Sunshine");
  // The chord symbols of bar 7's C and F and bar 8's C are inside the band.
  assert.deepEqual(match.chordNotes, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("Post 565 — compressed into half-bars (At the Jazzband Ball)", () => {
  assert.deepEqual(names(halves("F", "Fm", "C", "A7", "D7", "G7", "C", "C")), ["Sunshine"]);
});

test("Post 565 — IV, IVm, I alone is not Sunshine", () => {
  assert.deepEqual(names(bars("F", "Fm", "C", "C")), []);
});

// --- Post 77: Apple Tree = I-IV-I --------------------------------------

test("Post 77 — Apple Tree: \"the first three chords would be C - F - C\"", () => {
  assert.deepEqual(names(bars("C", "F", "C")), ["Apple Tree"]);
});

test("Post 77 — it is how a tune opens: the same chords mid-part are no Apple Tree", () => {
  assert.deepEqual(names("\"C\" c4 | \"G7\" c4 | \"C\" c4 | \"F\" c4 | \"C\" c4 |"), []);
});

// --- all of them: major keys only --------------------------------------

test("the patterns are major-key patterns: the same shapes in a minor key are not labelled", () => {
  assert.deepEqual(names(bars("F", "Fm", "C", "A7", "D7", "G7", "C", "C"), "M:4/4\nL:1/4\nK:Cm"), []);
  assert.deepEqual(names(bars("A7", "D7", "G7", "C"), "M:4/4\nL:1/4\nK:Cm"), []);
});
