import { test } from "node:test";
import assert from "node:assert/strict";
import {
  instrumentTransposes,
  instrumentLabel,
  exportInstrumentLine,
  resolvedExportSongMeta,
} from "./export-meta.js";

test("instrumentTransposes is true only for a transposing instrument", () => {
  assert.equal(instrumentTransposes("concert_pitch"), false);
  assert.equal(instrumentTransposes("trombone"), false); // bass clef, still concert
  assert.equal(instrumentTransposes("trumpet"), true);
  assert.equal(instrumentTransposes("alto_saxophone"), true);
});

test("instrumentLabel falls back to Concert pitch for an unknown value", () => {
  assert.equal(instrumentLabel("trumpet"), "Trumpet");
  assert.equal(instrumentLabel("nonsense"), "Concert pitch");
});

test("exportInstrumentLine names what the booklet is engraved for", () => {
  assert.equal(exportInstrumentLine("concert_pitch"), "Concert pitch");
  assert.equal(exportInstrumentLine("concert_+_roman"), "Concert pitch");
  assert.equal(exportInstrumentLine("trumpet"), "Transposed for Trumpet");
  assert.equal(exportInstrumentLine("trombone"), "Trombone — concert pitch");
});

const TUNE = "X:1\nT:Basin Street Blues\nM:4/4\nL:1/8\nQ:1/4=120\nK:Bb\n\"Bb\" B8 |";

test("resolvedExportSongMeta resolves concert + instrument key and bpm", () => {
  const meta = resolvedExportSongMeta(TUNE, { key: "" }, "concert_pitch");
  assert.equal(meta.concert, "B♭");
  assert.equal(meta.instrument, "B♭");
  assert.equal(meta.bpm, 120);
});

test("resolvedExportSongMeta folds in the setlist override and the instrument", () => {
  const meta = resolvedExportSongMeta(TUNE, { key: "2" }, "trumpet");
  assert.equal(meta.concert, "C"); // Bb + 2
  assert.equal(meta.instrument, "D"); // Bb + 2 + trumpet's +2
});

test("resolvedExportSongMeta falls back to the raw badge with no readable K:", () => {
  const meta = resolvedExportSongMeta("X:1\nT:No key\n", { key: "-3" }, "trumpet");
  assert.equal(meta.concert, "−3");
  assert.equal(meta.instrument, "−3");
  assert.equal(meta.bpm, null);
});
