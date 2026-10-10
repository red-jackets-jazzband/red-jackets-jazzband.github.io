import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import { collectHarmony } from "./harmony.js";

const parse = (body, header = "M:4/4\nL:1/4\nK:Bb") => ABCJS.parseOnly(`X:1\n${header}\n${body}\n`)[0];

test("one segment per chord change, with start/end in whole notes and the tonic", () => {
  const { segments, tonic, bar } = collectHarmony(parse('"Bb" B4 | "F7" F4 | F4 |'));
  assert.equal(tonic, 10);
  assert.equal(bar, 1);
  assert.deepEqual(segments.map((s) => [s.root, s.quality, s.start, s.end]), [
    [10, "maj", 0, 1],
    [5, "dom", 1, 3],
  ]);
});

test("the same function again is not a new segment (B♭ then B♭6)", () => {
  const { segments } = collectHarmony(parse('"Bb" B4 | "Bb6" B4 | "F7" F4 |'));
  assert.equal(segments.length, 2);
  assert.equal(segments[0].end, 2);
});

test("a restated chord at the start of a part begins a new segment", () => {
  const { segments } = collectHarmony(parse('"Bb" B4 |]\nP:B\n"Bb" B4 | "F7" F4 |'));
  assert.deepEqual(segments.map((s) => s.partStart), [true, true, false]);
});

test("the bar length follows the meter", () => {
  assert.equal(collectHarmony(parse('"C" c3 |', "M:3/4\nL:1/4\nK:C")).bar, 0.75);
  assert.equal(collectHarmony(parse('"C" c4 |', "M:C|\nL:1/4\nK:C")).bar, 1);
  assert.equal(collectHarmony(parse('"C" c6 |', "M:6/8\nL:1/8\nK:C")).bar, 0.75);
});

test("a minor or modal key has no tonic, so no named pattern can match in it", () => {
  assert.equal(collectHarmony(parse('"Gm" G4 |', "M:4/4\nL:1/4\nK:Gm")).tonic, null);
  assert.equal(collectHarmony(parse('"G" G4 |', "M:4/4\nL:1/4\nK:GDor")).tonic, null);
});

test("every note onset is recorded with its time, line and whether it carries a chord", () => {
  const text = 'X:1\nM:4/4\nL:1/4\nK:Bb\n"Bb" B2 c2 |\n"F7" F4 |\n';
  const { notes } = collectHarmony(ABCJS.parseOnly(text)[0]);
  assert.deepEqual(notes.map((n) => [n.time, n.line, n.hasChord]), [
    [0, 0, true], [0.5, 0, false], [1, 1, true],
  ]);
  assert.equal(text.slice(notes[2].startChar, notes[2].startChar + 4), '"F7"'.slice(0, 4).replace('"F7"', '"F7"'));
});

test("chord symbols that are not chords (N.C., annotations) make no segment", () => {
  const { segments } = collectHarmony(parse('"N.C." z4 | "^Break" B4 | "Bb" B4 |'));
  assert.deepEqual(segments.map((s) => s.root), [10]);
});

test("a key change mid-tune changes the tonic the next segments are read in", () => {
  const { segments } = collectHarmony(parse('"Bb" B4 | "F7" F4 |\nK:C\n"C" c4 |'));
  assert.deepEqual(segments.map((s) => s.tonic), [10, 10, 0]);
});
