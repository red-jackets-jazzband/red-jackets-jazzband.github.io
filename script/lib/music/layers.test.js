import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import {
  LAYERS, LAYER_IDS, activeLayers, annotateLayers, insertAnnotations,
} from "./layers.js";
import { PROGRESSION_NAMES } from "./progressions.js";

const TEXT = 'X:1\nM:4/4\nL:1/4\nK:C\n"A7" E4 | "D7" E4 | "G7" E4 | "C" E4 |\n';
const parse = (text) => ABCJS.parseOnly(text)[0];

test("every layer has what the panel and the plan need", () => {
  assert.deepEqual(LAYER_IDS, ["progressions", "scale-degrees", "fingerings"]);
  LAYERS.forEach((layer) => {
    assert.equal(typeof layer.label, "string");
    assert.equal(typeof layer.hint, "string");
    assert.equal(typeof layer.group, "string");
    assert.equal(typeof layer.availableFor, "function");
    assert.equal(typeof layer.annotate, "function");
  });
});

test("activeLayers: switched on and applicable to the instrument", () => {
  const on = { progressions: true, fingerings: true };
  assert.deepEqual(activeLayers(on, "trumpet").map((l) => l.id), ["progressions", "fingerings"]);
  assert.deepEqual(activeLayers(on, "alto_saxophone").map((l) => l.id), ["progressions"]);
  assert.deepEqual(activeLayers({}, "trumpet"), []);
  assert.deepEqual(activeLayers(undefined, "trumpet"), []);
});

test("insertAnnotations works back to front and keeps same-offset order", () => {
  const out = insertAnnotations("ab cd", [{ startChar: 3, text: "_1" }, { startChar: 0, text: "^x" }, { startChar: 3, text: "_y" }]);
  assert.equal(out, '"^x"ab "_1""_y"cd');
});

test("annotateLayers leaves the text alone with nothing on", () => {
  const result = annotateLayers(TEXT, parse(TEXT), { active: {}, instrument: "trumpet" });
  assert.equal(result.text, TEXT);
  assert.deepEqual(result.progressions, []);
  assert.deepEqual(result.applied, []);
});

test("annotateLayers puts fingerings, then the progression label, under the notes", () => {
  const result = annotateLayers(TEXT, parse(TEXT), { active: { progressions: true, fingerings: true }, instrument: "trumpet" });
  assert.deepEqual(result.applied, ["progressions", "fingerings"]);
  assert.deepEqual(result.progressions.map((p) => p.name), ["Salty Dog"]);
  assert.match(result.text, /"_1\\n2\\n\u00B7""_Salty Dog progression""A7" E4/);
  // Still valid ABC, and the chords are untouched.
  const reparsed = parse(result.text);
  assert.equal(reparsed.warnings, undefined);
  /** @type {any[]} */
  const voice = reparsed.lines[0].staff[0].voices[0];
  const chords = voice.filter((el) => el.chord).map((el) => el.chord.find((c) => c.position === "default").name);
  assert.deepEqual(chords, ["A7", "D7", "G7", "C"]);
});

test("a chart with its own instrument voices gets no fingerings", () => {
  const result = annotateLayers(TEXT, parse(TEXT), { active: { fingerings: true }, instrument: "trumpet", ownVoices: true });
  assert.equal(result.text, TEXT);
});

test("every layer declares where its annotations sit and when it applies", () => {
  LAYERS.forEach((layer) => {
    assert.equal(typeof layer.order, "number", layer.id);
    assert.equal(typeof layer.appliesTo, "function", layer.id);
    assert.equal(layer.appliesTo({ ownVoices: false }), true, `${layer.id} applies to an ordinary chart`);
  });
  assert.equal(new Set(LAYERS.map((l) => l.order)).size, LAYERS.length, "no two layers share a slot");
});

test("the progressions hint names every progression the matcher knows", () => {
  const hint = LAYERS.find((l) => l.id === "progressions").hint;
  PROGRESSION_NAMES.forEach((name) => assert.ok(hint.includes(name), name));
});

test("fingerings are for brass and for charts without their own voices", () => {
  const fingerings = LAYERS.find((l) => l.id === "fingerings");
  assert.equal(fingerings.availableFor("trumpet"), true);
  assert.equal(fingerings.availableFor("alto_saxophone"), false);
  assert.equal(fingerings.appliesTo({ ownVoices: true }), false);
});

test("the annotations stack nearest the notes first: fingerings, scale degrees, then the progression", () => {
  const active = { progressions: true, "scale-degrees": true, fingerings: true };
  const { text } = annotateLayers(TEXT, parse(TEXT), { active, instrument: "trumpet" });
  const first = text.slice(text.indexOf('"_'), text.indexOf("E4"));
  const fingering = first.indexOf("\\n");
  const degree = first.indexOf("●") >= 0 ? first.indexOf("●") : first.indexOf("○");
  const label = first.indexOf("Salty Dog progression");
  assert.ok(fingering >= 0 && degree > fingering && label > degree, first);
});

test("scale degrees alone label every note with its step and mark the chord tones", () => {
  const { text, applied } = annotateLayers(TEXT, parse(TEXT), { active: { "scale-degrees": true }, instrument: "alto_saxophone" });
  assert.deepEqual(applied, ["scale-degrees"]);
  // E over A7 (its 5th): a chord tone; the 3rd of C in the last bar: another.
  assert.match(text, /"_●3"A7"|"_●5"|"_●3"/);
  assert.equal((text.match(/"_[●○•]/g) || []).length, 4);
});

test("a progression label is written once, at the progression's first note", () => {
  const { text } = annotateLayers(TEXT, parse(TEXT), { active: { progressions: true }, instrument: "trumpet" });
  assert.equal(text.split("Salty Dog progression").length - 1, 1);
});

test("two layers' annotations on one note both survive, and the chord symbol follows them", () => {
  const { text } = annotateLayers(TEXT, parse(TEXT), { active: { fingerings: true, "scale-degrees": true }, instrument: "trumpet" });
  assert.match(text, /"_[^"]*""_[●○•][^"]*""A7" E4/);
});
