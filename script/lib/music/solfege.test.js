import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import { melodySolfege, parseSolfegeText, solfegeLabel, solfegeSyllable, solfegeText } from "./solfege.js";
import { resolveTranspose } from "./render-plan.js";

const parse = (body, key = "C") => ABCJS.parseOnly(`X:1\nM:4/4\nL:1/4\nK:${key}\n${body}\n`)[0];
const sung = (body, key) => melodySolfege(parse(body, key)).map((s) => s.syllable);

test("the major scale is do re mi fa sol la ti", () => {
  assert.deepEqual(sung("C D E F | G A B c |"), ["do", "re", "mi", "fa", "sol", "la", "ti", "do"]);
});

test("do moves with the key", () => {
  assert.deepEqual(sung("F G A B | c d e f |", "F"), ["do", "re", "mi", "fa", "sol", "la", "ti", "do"]);
  assert.deepEqual(sung("B c d e |", "Bb"), ["do", "re", "mi", "fa"]);
  assert.deepEqual(sung("D E F G |", "D"), ["do", "re", "mi", "fa"]);
});

test("do is the tonic in minor and modal keys too", () => {
  assert.deepEqual(sung("A B c d | e f g a |", "Am"), ["do", "re", "me", "fa", "sol", "le", "te", "do"]);
  assert.deepEqual(sung("^g a |", "Am"), ["ti", "do"]);
  assert.deepEqual(sung("D E F G |", "Ddor"), ["do", "re", "me", "fa"]);
});

test("chromatic notes are named by their spelling", () => {
  assert.deepEqual(sung("^F _G ^C _D |"), ["fi", "se", "di", "ra"]);
  assert.deepEqual(sung("^G _A ^A _B _E |"), ["si", "le", "li", "te", "me"]);
  assert.deepEqual(sung("^D |"), ["ri"]);
});

test("a spelling with no syllable of its own falls back to its sound", () => {
  assert.equal(solfegeSyllable(2, 5), "fa"); // E# in C
  assert.equal(solfegeSyllable(0, -1), "ti"); // Cb in C
  assert.equal(solfegeSyllable(3, 8), "le"); // F## in C
});

test("bar accidentals carry through the bar; a tie is sung once", () => {
  assert.deepEqual(sung("^F F- | F B", "C"), ["fi", "fi", "ti"]);
});

test("syllables don't change when the instrument transposes the printed part", () => {
  const text = "X:1\nM:4/4\nL:1/4\nK:F\nF A c _e |\n";
  const { abcText, visual } = resolveTranspose(text, "trumpet", 0);
  const song = ABCJS.parseOnly(abcText, { visualTranspose: visual })[0];
  assert.deepEqual(melodySolfege(song).map((s) => s.syllable), ["do", "mi", "sol", "te"]);
});

test("the bass-clef stamp for low brass keeps the syllables", () => {
  assert.deepEqual(sung("C E G c |", "C clef=bass middle=D"), ["do", "mi", "sol", "do"]);
});

test("alto and tenor clef parts are sung too", () => {
  assert.deepEqual(sung("C E G c |", "C clef=alto"), ["do", "mi", "sol", "do"]);
  assert.deepEqual(sung("F A c f |", "F clef=tenor"), ["do", "mi", "sol", "do"]);
});

test("rests and a tune with no key give no syllables", () => {
  assert.deepEqual(sung("C z E z |"), ["do", "mi"]);
  assert.deepEqual(sung("C D |", "none"), []);
});

test("the annotation text carries an invisible marker the overlay reads back", () => {
  assert.equal(parseSolfegeText(solfegeText("sol")), "sol");
  assert.equal(parseSolfegeText(solfegeText("se")), "se");
  assert.equal(parseSolfegeText("sol"), null, "a chart's own annotation is left alone");
  assert.equal(parseSolfegeText(solfegeText("fa♯")), "fa♯", "a translated label comes back as written");
  assert.equal(parseSolfegeText("\u200B"), null);
  assert.equal(solfegeText("do").trim(), solfegeText("do"));
});

test("solfegeLabel is English under plain Node", () => {
  assert.equal(solfegeLabel("ti"), "ti");
  assert.equal(solfegeLabel("fi"), "fi");
});
