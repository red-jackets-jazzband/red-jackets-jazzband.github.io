import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import {
  fingeringFor, fingeringGlyphs, instrumentHasFingerings, melodyFingerings, noteMidi,
} from "./fingerings.js";
import { resolveTranspose } from "./render-plan.js";

// The tune as the sheet engraves it for `instrument`: clef stamped, transposed.
function engraved(body, instrument, key = "C") {
  const text = `X:1\nM:4/4\nL:1/4\nK:${key}\n${body}\n`;
  const { abcText, visual } = resolveTranspose(text, instrument, 0);
  return ABCJS.parseOnly(abcText, { visualTranspose: visual })[0];
}

const texts = (song, instrument) => melodyFingerings(song, instrument).map((f) => f.text);

test("only the brass have a chart", () => {
  assert.equal(instrumentHasFingerings("trumpet"), true);
  assert.equal(instrumentHasFingerings("trombone"), true);
  assert.equal(instrumentHasFingerings("sousaphone"), true);
  assert.equal(instrumentHasFingerings("alto_saxophone"), false);
  assert.equal(instrumentHasFingerings("concert_pitch"), false);
  assert.equal(fingeringFor("clarinet_bb", 60), null);
});

test("trumpet valves follow the written pitch", () => {
  assert.equal(fingeringFor("trumpet", 60), "0"); // C4
  assert.equal(fingeringFor("trumpet", 64), "12"); // E4
  assert.equal(fingeringFor("trumpet", 61), "123"); // C#4
  assert.equal(fingeringFor("trumpet", 74), "1"); // D5
  assert.equal(fingeringFor("trumpet", 54), "123"); // F#3, the bottom of the range
  assert.equal(fingeringFor("trumpet", 53), null);
  assert.equal(fingeringFor("trumpet", 92), null);
});

test("trombone slide positions follow concert pitch", () => {
  assert.equal(fingeringFor("trombone", 46), "1"); // Bb2
  assert.equal(fingeringFor("trombone", 40), "7"); // E2
  assert.equal(fingeringFor("trombone", 50), "4"); // D3
  assert.equal(fingeringFor("trombone", 62), "1"); // D4
  assert.equal(fingeringFor("trombone", 70), "1"); // Bb4
});

test("a sousaphone reads the trumpet's pattern an octave up from its Bb bass-clef part", () => {
  assert.equal(fingeringFor("sousaphone", 48), "0"); // written C3: concert Bb1, open
  assert.equal(fingeringFor("sousaphone", 52), "12"); // written E3: concert D2
});

test("noteMidi reads where the note is drawn, with key, bar and own accidentals", () => {
  const key = new Map([["B", -1]]);
  assert.equal(noteMidi({ verticalPos: 6 }, "treble", key, new Map()), 70); // B in F major = Bb4
  const bar = new Map();
  assert.equal(noteMidi({ verticalPos: 3, accidental: "sharp" }, "treble", new Map(), bar), 66);
  assert.equal(noteMidi({ verticalPos: 3 }, "treble", new Map(), bar), 66, "the sharp holds for the rest of the bar");
  assert.equal(noteMidi({ verticalPos: 7 }, "bass", new Map(), new Map()), 52, "bass clef: E3 on the 4th space");
  assert.equal(noteMidi({ verticalPos: 0 }, "alto", new Map(), new Map()), null);
});

test("trumpet: Basin Street's concert D reads as a written E, valves 1+2", () => {
  // Concert Bb, as written in the repo; the trumpet part is a tone up.
  const song = engraved("D D E =E | F2 z2 |", "trumpet", "Bb");
  assert.deepEqual(texts(song, "trumpet"), ["12", "12", "1", "2", "0"]);
});

test("ties, rests and accidentals within the bar", () => {
  const song = engraved("^F F- F z | F G A B |", "trumpet");
  // Written a tone up: G#4 G#4 (tied on) | G4 A4 B4 C#5.
  assert.deepEqual(texts(song, "trumpet"), ["23", "23", "0", "12", "2", "12"]);
});

test("trombone: the treble chart is drawn an octave down in bass clef", () => {
  const song = engraved("D F A c |", "trombone");
  // D3 F3 A3 C4.
  assert.deepEqual(texts(song, "trombone"), ["4", "1", "2", "3"]);
});

test("a chord gets the fingering of its top note; source offsets point at the note", () => {
  const text = "X:1\nL:1/4\nK:C\n[CE] G |\n";
  const song = ABCJS.parseOnly(text)[0];
  const found = melodyFingerings(song, "trumpet");
  assert.deepEqual(found.map((f) => f.text), ["12", "0"]);
  assert.equal(text.slice(found[0].startChar, found[0].startChar + 4), "[CE]");
});

test("no fingerings for a non-brass instrument", () => {
  assert.deepEqual(melodyFingerings(engraved("C D E F |", "alto_saxophone"), "alto_saxophone"), []);
});

test("valves print as a three-line diagram, trombone positions stay digits", () => {
  assert.equal(fingeringGlyphs("trumpet", "13"), "1\\n\u00B7\\n3");
  assert.equal(fingeringGlyphs("sousaphone", "0"), "\u00B7\\n0\\n\u00B7");
  assert.equal(fingeringGlyphs("trombone", "12"), "12");
});
