import { test } from "node:test";
import assert from "node:assert/strict";
import { INSTRUMENTS, offsetForInstrument, changeClefForInstrument } from "./instruments.js";

test("INSTRUMENTS has the 8 known options with unique values", () => {
  assert.equal(INSTRUMENTS.length, 8);
  const values = INSTRUMENTS.map((i) => i.value);
  assert.equal(new Set(values).size, values.length);
});

test("offsetForInstrument matches the documented per-instrument transposition", () => {
  assert.equal(offsetForInstrument("concert_pitch"), 0);
  assert.equal(offsetForInstrument("concert_+_roman"), 0);
  assert.equal(offsetForInstrument("alto_saxophone"), 9);
  assert.equal(offsetForInstrument("clarinet_bb"), 2);
  assert.equal(offsetForInstrument("sousaphone"), 2);
  assert.equal(offsetForInstrument("tenor_saxophone"), 2);
  assert.equal(offsetForInstrument("trombone"), 0);
  assert.equal(offsetForInstrument("trumpet"), 2);
});

test("offsetForInstrument defaults unknown instruments to 0", () => {
  assert.equal(offsetForInstrument("kazoo"), 0);
  assert.equal(offsetForInstrument(undefined), 0);
});

test("changeClefForInstrument adds a bass clef only for sousaphone/trombone", () => {
  const input = "K:Bb\nC D E F|";
  assert.match(changeClefForInstrument("sousaphone", input), /K:Bb clef=bass middle=D/);
  assert.match(changeClefForInstrument("trombone", input), /K:Bb clef=bass middle=D/);
  assert.doesNotMatch(changeClefForInstrument("trumpet", input), /clef=bass/);
  assert.doesNotMatch(changeClefForInstrument("concert_pitch", input), /clef=bass/);
});

test("changeClefForInstrument strips an existing bass clef marker for treble instruments", () => {
  const input = "K:Bb clef=bass middle=D\nC D E F|";
  assert.equal(changeClefForInstrument("trumpet", input), "K:Bb\nC D E F|");
});

test("changeClefForInstrument is idempotent across repeated conversions", () => {
  const treble = "K:Bb\nC D E F|";
  const bass = changeClefForInstrument("sousaphone", treble);
  assert.equal(changeClefForInstrument("sousaphone", bass), bass);
  assert.equal(changeClefForInstrument("trumpet", bass), treble);
});

test("changeClefForInstrument leaves inline [K:...] key changes untouched", () => {
  const input = "K:C\nC D|[K:G]G A|";
  assert.equal(
    changeClefForInstrument("trombone", input),
    "K:C clef=bass middle=D\nC D|[K:G]G A|",
  );
});
