import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRng, generateSolo, parseChord, STYLES } from "./solo-ga.js";
import { tonalStub } from "../../../tests/helpers/stubs.js";

// parseChord reads chords through the Tonal global, as in the page.
before(() => {
  globalThis.Tonal = tonalStub;
});
after(() => {
  delete globalThis.Tonal;
});

// Smaller GA runs than the defaults keep the suite fast; the rules still converge.
const FAST = { popSize: 40, generations: 90 };

const SAINTS = ["F", "F", "F", "F", "F", "F", "C7", "C7", "F", "F7", "Bb", "Bb", "F", "C7", "F", "F"];
const BLUES = ["Bb7", "Eb7", "Bb7", "Bb7", "Eb7", "Eb7", "Bb7", "Bb7", "F7", "Eb7", "Bb7", "F7"];
const tuneNote = (bar, beat, duration, midi) => ({ start: bar * 4 + beat, duration, midi });
const SAINTS_TUNE = [
  tuneNote(0, 1, 1, 65), tuneNote(0, 2, 1, 69), tuneNote(0, 3, 1, 70), tuneNote(1, 0, 4, 72),
  tuneNote(2, 1, 1, 65), tuneNote(2, 2, 1, 69), tuneNote(2, 3, 1, 70), tuneNote(3, 0, 4, 72),
  tuneNote(4, 1, 1, 65), tuneNote(4, 2, 1, 69), tuneNote(4, 3, 1, 70), tuneNote(5, 0, 2, 72),
  tuneNote(5, 2, 2, 69), tuneNote(6, 0, 2, 65), tuneNote(6, 2, 2, 69), tuneNote(7, 0, 4, 67),
];

function chordAtBeat(progression, beat) {
  return parseChord(progression[Math.floor(beat / 4)]);
}

function relToChord(progression, note) {
  const chord = chordAtBeat(progression, note.start);
  return (((note.midi - chord.root) % 12) + 12) % 12;
}

function soundingAt(notes, beat) {
  return notes.find((n) => n.start <= beat && n.start + n.duration > beat);
}

test("parseChord recognises the chord qualities the site's charts use", () => {
  assert.equal(parseChord("F").type, "maj");
  assert.equal(parseChord("F6").type, "maj");
  assert.equal(parseChord("Fmaj7").type, "maj");
  assert.equal(parseChord("C7").type, "dom");
  assert.equal(parseChord("Gm7").type, "min");
  assert.equal(parseChord("Bdim").type, "dim");
  assert.equal(parseChord("Em7b5").type, "hdim");
  assert.equal(parseChord("C7#5").type, "aug");
});

test("parseChord folds roots into -5..6 so degrees move smoothly across changes", () => {
  assert.equal(parseChord("C").root, 0);
  assert.equal(parseChord("F#").root, 6);
  assert.equal(parseChord("G").root, -5);
  assert.equal(parseChord("Bb7").root, -2);
});

test("parseChord rejects something that isn't a chord symbol", () => {
  assert.throws(() => parseChord("H7"), /Unknown chord/);
});

test("createRng is deterministic per seed and stays in [0, 1)", () => {
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test("generateSolo reproduces the same take from the same seed", () => {
  const first = generateSolo(BLUES, { ...FAST, seed: 5 });
  const second = generateSolo(BLUES, { ...FAST, seed: 5 });
  assert.deepEqual(first.notes, second.notes);
  assert.equal(first.seed, 5);
});

test("generateSolo returns ordered, non-overlapping notes inside the style's range", () => {
  const { notes } = generateSolo(BLUES, { ...FAST, style: "solo", seed: 1 });
  assert.ok(notes.length > 20);
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    assert.ok(n.midi >= STYLES.solo.low && n.midi <= STYLES.solo.high, `note ${n.midi} out of range`);
    assert.ok(n.duration > 0);
    if (i > 0) {
      assert.ok(n.start >= notes[i - 1].start + notes[i - 1].duration - 1e-9, "notes overlap");
    }
  }
});

test("beats 1 and 3 land on chord tones (or an upper structure in Armstrong style)", () => {
  for (const style of ["solo", "armstrong"]) {
    const { notes } = generateSolo(BLUES, { ...FAST, style, seed: 3 });
    const strong = notes.filter((n) => n.start % 2 === 0 && !n.approach);
    const fitting = strong.filter((n) => {
      const chord = chordAtBeat(BLUES, n.start);
      const rel = relToChord(BLUES, n);
      return chord.tones.has(rel) || (style === "armstrong" && chord.ext.has(rel));
    });
    assert.ok(fitting.length / strong.length >= 0.9, `${style}: ${fitting.length}/${strong.length}`);
  }
});

test("approach notes lead by step into their target (enclosures: above, below, target)", () => {
  const { notes } = generateSolo(BLUES, { ...FAST, style: "armstrong", seed: 4 });
  const approaches = notes.filter((n) => n.approach);
  assert.ok(approaches.length > 0);
  assert.ok(approaches.length <= notes.length * 0.25, "approaches should stay ornaments");
  for (const a of approaches) {
    const target = notes.slice(notes.indexOf(a) + 1).find((n) => !n.approach);
    assert.ok(target, "an approach note needs a target");
    assert.ok(Math.abs(target.midi - a.midi) <= 2, `approach ${a.midi} -> ${target.midi}`);
  }
});

test("a trumpet lead given the tune plays a recognisable variation of it", () => {
  const { notes } = generateSolo(SAINTS.slice(0, 8), { ...FAST, style: "trumpet", melody: SAINTS_TUNE, seed: 1 });
  const kept = SAINTS_TUNE.filter((m) => {
    const n = soundingAt(notes, m.start);
    return n && n.midi % 12 === m.midi % 12;
  });
  assert.ok(kept.length / SAINTS_TUNE.length >= 0.4, `kept ${kept.length}/${SAINTS_TUNE.length}`);
});

test("tailgate trombone sits below the lead with roots on beat 1 and glisses into changes", () => {
  const lead = generateSolo(SAINTS, { ...FAST, style: "trumpet", seed: 1 }).notes;
  const { notes } = generateSolo(SAINTS, { ...FAST, style: "trombone", against: lead, seed: 2 });
  const overlapping = notes.filter((n) => soundingAt(lead, n.start));
  const below = overlapping.filter((n) => n.midi < soundingAt(lead, n.start).midi);
  assert.ok(below.length / overlapping.length >= 0.9, `below the lead: ${below.length}/${overlapping.length}`);
  const downbeats = notes.filter((n) => n.start % 4 === 0);
  const roots = downbeats.filter((n) => relToChord(SAINTS, n) === 0);
  assert.ok(roots.length / downbeats.length >= 0.6, `roots on 1: ${roots.length}/${downbeats.length}`);
  assert.ok(notes.some((n) => n.artic.includes("gliss")));
});

test("the clarinet weaves above the lead", () => {
  const lead = generateSolo(SAINTS, { ...FAST, style: "trumpet", seed: 1 }).notes;
  const { notes } = generateSolo(SAINTS, { ...FAST, style: "clarinet", against: lead, seed: 3 });
  const overlapping = notes.filter((n) => soundingAt(lead, n.start));
  const above = overlapping.filter((n) => n.midi > soundingAt(lead, n.start).midi);
  assert.ok(above.length / overlapping.length >= 0.9, `${above.length}/${overlapping.length}`);
});

test("Armstrong style builds to a late climax", () => {
  const total = BLUES.length * 4;
  for (const seed of [21, 22]) {
    const { notes } = generateSolo(BLUES, { ...FAST, style: "armstrong", seed });
    const top = notes.reduce((best, n) => (n.midi > best.midi ? n : best), notes[0]);
    const at = top.start / total;
    assert.ok(at >= 0.5 && at <= 0.92, `seed ${seed}: climax at ${Math.round(at * 100)}%`);
  }
});

test("a break is played through and lands on the next downbeat", () => {
  const { notes } = generateSolo(SAINTS, { ...FAST, style: "armstrong", breaks: [6, 7], seed: 11 });
  const inBreak = notes.filter((n) => n.start >= 24 && n.start < 32);
  assert.ok(inBreak.length >= 8, `${inBreak.length} notes in the break`);
  assert.ok(notes.some((n) => n.start === 32), "no note on the downbeat after the break");
});

test("an N.C. slot borrows the neighbouring harmony so the line plays through it", () => {
  const progression = [{ chord: "F", beats: 4 }, { chord: null, beats: 4 }, { chord: "C7", beats: 4 }, { chord: "F", beats: 4 }];
  const { notes } = generateSolo(progression, { ...FAST, style: "solo", breaks: [1], seed: 7 });
  const inBreak = notes.filter((n) => n.start >= 4 && n.start < 8);
  assert.ok(inBreak.length >= 3, `${inBreak.length} notes in the N.C. bar`);
});
