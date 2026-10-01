import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  buildSoloTune, cancelSolo, composeSolo, hasSoloTake, melodyNotes, SOLO_PROGRAMS, SOLO_STYLES,
} from "./solo.js";
import { generateSolo, startSolo } from "./solo-ga.js";
import { buildCompingTune, COMPING_PATTERNS } from "./comping.js";
import { BREAK_CHORD } from "./chords.js";
import { tonalStub } from "../../../tests/helpers/stubs.js";

before(() => {
  globalThis.Tonal = tonalStub;
});
after(() => {
  delete globalThis.Tonal;
});

const FAST = { popSize: 30, generations: 40 };
const ABC = [
  "X:1", "T:Test", "M:4/4", "L:1/8", "K:F",
  "\"F\"FGAB c2 c2|\"C7\"cBAG F4|\"F\"A2 c2 f4|\"F\"c8|]", "",
].join("\n");
const SONG = {
  lines: [{
    staff: [{
      key: { root: "F", acc: "", mode: "", accidentals: [{ acc: "flat", note: "B" }] },
      voices: [[{ el_type: "note", duration: [0.25], pitches: [{ pitch: 3 }] }, { el_type: "note", duration: [0.5], pitches: [{ pitch: 7 }] }]],
    }],
  }],
};
const chordsOf = (...bars) => bars.map((text) => ({ text }));
const CHORDS = chordsOf(["F"], ["C7"], ["F", "F7"], [BREAK_CHORD]);

// The solo staff's bars: everything after the "V:2" body line.
function soloBars(abc) {
  return abc.split("\nV:2\n")[1].trim().replace(/\|\]$/, "").split("|");
}

// Length of a bar in eighth slots, read back from the ABC (L:1/8).
function barSlots(bar) {
  let total = 0;
  for (const token of bar.match(/[_^=]?[A-Ga-gz][,']?\d?/g)) {
    const digits = token.replace(/\D/g, "");
    total += digits ? Number(digits) : 1;
  }
  return total;
}

test("every style the dropdown offers has an instrument", () => {
  for (const { value } of SOLO_STYLES) assert.ok(Number.isInteger(SOLO_PROGRAMS[value]), value);
});

test("buildSoloTune appends a named Solo staff, one full bar per chart bar", () => {
  const { abc } = buildSoloTune(ABC, CHORDS, SONG, "trumpet", FAST);
  assert.match(abc, /^V:2 name="Solo"$/m);
  assert.match(abc, /^%%staves \[1 2\]$/m);
  const bars = soloBars(abc);
  assert.equal(bars.length, 4);
  for (const bar of bars) assert.equal(barSlots(bar), 8, bar);
});

test("the same chart and style give the same take", () => {
  const a = buildSoloTune(ABC, CHORDS, SONG, "armstrong", FAST).abc;
  const b = buildSoloTune(ABC, CHORDS, SONG, "armstrong", FAST).abc;
  assert.equal(a, b);
});

test("Solo goes on top of Comping as the next voice", () => {
  const comping = buildCompingTune(ABC, CHORDS, SONG, COMPING_PATTERNS[0].value);
  const { abc } = buildSoloTune(comping.abc, CHORDS, SONG, "clarinet", FAST);
  assert.match(abc, /^V:3 name="Solo"$/m);
  assert.match(abc, /^%%staves \[1 2\] 3$/m);
  assert.equal(abc.split("\nV:2\n").length, 2, "the comping staff is kept once");
});

test("buildSoloTune declines what it can't do", () => {
  assert.equal(buildSoloTune(ABC, [], SONG, "trumpet"), null);
  assert.equal(buildSoloTune(ABC, CHORDS, SONG, "kazoo"), null);
  assert.equal(buildSoloTune(ABC.replace("M:4/4", "M:3/4"), CHORDS, SONG, "trumpet", FAST), null);
});

// A parsed note the way ABCjs reports it: diatonic step (0 = C4), length as a
// fraction of a whole note.
const note = (pitch, duration, accidental) => ({
  el_type: "note", duration: [duration], pitches: [accidental ? { pitch, accidental } : { pitch }],
});
const bar = { el_type: "bar" };
const tuneOf = (voice, accidentals = []) => ({
  lines: [{ staff: [{ key: { accidentals }, voices: [voice] }] }],
});

test("melodyNotes reads the lead as MIDI beats from the first chord bar, honouring key and bar accidentals", () => {
  const song = tuneOf([
    note(0, 0.25), bar, // pickup bar (skipped)
    note(3, 0.25), note(6, 0.25, "flat"), note(6, 0.25), { el_type: "note", duration: [0.25], rest: { type: "rest" } }, bar,
    note(7, 0.5), note(6, 0.5), bar,
  ], [{ acc: "flat", note: "B" }]);
  const notes = melodyNotes(song, 1);
  // F4, B♭4 (written flat), B♭4 again (bar accidental persists), rest, then C5 and B♭4 (key signature).
  assert.deepEqual(notes.map((n) => n.midi), [65, 70, 70, 72, 70]);
  assert.deepEqual(notes.map((n) => n.start), [0, 1, 2, 4, 6]);
  assert.deepEqual(notes.map((n) => n.duration), [1, 1, 1, 2, 2]);
});

test("the lead shapes the take: a trumpet solo differs from one without a tune", () => {
  const withLead = buildSoloTune(ABC, CHORDS, SONG, "trumpet", FAST).abc;
  const noLead = buildSoloTune(ABC, CHORDS, { lines: [{ staff: [{ key: { root: "F", acc: "", mode: "" }, voices: [[]] }] }] }, "trumpet", FAST).abc;
  assert.notEqual(withLead, noLead);
});

test("a take evolved in slices equals the one evolved in a single go", () => {
  const progression = ["F", "C7", "F", "F"];
  const job = startSolo(progression, { ...FAST, style: "armstrong", seed: 4 });
  let slices = 0;
  while (!job.step(1)) slices++;
  assert.ok(slices > 1, "it should have taken several slices");
  assert.equal(job.progress, 1);
  assert.deepEqual(job.result().notes, generateSolo(progression, { ...FAST, style: "armstrong", seed: 4 }).notes);
});

test("composeSolo evolves in the background, reports progress and leaves the take ready", async () => {
  const gaOptions = { popSize: 30, generations: 60 };
  assert.equal(hasSoloTake(CHORDS, SONG, "clarinet", gaOptions), false);
  const progress = [];
  await new Promise((resolve) => {
    composeSolo(CHORDS, SONG, "clarinet", { gaOptions, onProgress: (f) => progress.push(f), onDone: resolve });
  });
  assert.equal(progress[0], 0);
  assert.ok(progress.every((f, i) => i === 0 || f >= progress[i - 1]));
  assert.equal(hasSoloTake(CHORDS, SONG, "clarinet", gaOptions), true);
  assert.equal(composeSolo(CHORDS, SONG, "clarinet", { gaOptions, onProgress: () => {}, onDone: () => {} }), false);
});

test("asking for another take cancels the one running", async () => {
  const gaOptions = { popSize: 30, generations: 400 };
  let doneFirst = false;
  composeSolo(CHORDS, SONG, "trombone", { gaOptions, onProgress: () => {}, onDone: () => { doneFirst = true; } });
  composeSolo(CHORDS, SONG, "solo", { gaOptions: { popSize: 20, generations: 20 }, onProgress: () => {}, onDone: () => {} });
  await new Promise((resolve) => { setTimeout(resolve, 150); });
  cancelSolo();
  assert.equal(doneFirst, false);
});
