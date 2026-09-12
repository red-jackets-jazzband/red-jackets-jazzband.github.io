import { test } from "node:test";
import assert from "node:assert/strict";
import { GM_VOICES, guessGmProgram } from "./gm-voices.js";

test("every GM_VOICES entry is a valid, unique 0-indexed GM program number", () => {
  assert.ok(GM_VOICES.length > 0);
  const seen = new Set();
  for (const voice of GM_VOICES) {
    assert.ok(Number.isInteger(voice.value) && voice.value >= 0 && voice.value <= 127, voice.label);
    assert.equal(seen.has(voice.value), false, `duplicate GM program ${voice.value} (${voice.label})`);
    seen.add(voice.value);
    assert.ok(voice.label && voice.label.trim().length > 0);
    assert.ok(voice.group && voice.group.trim().length > 0);
  }
});

test("guessGmProgram maps a tune's own voice name to a sensible GM program", () => {
  assert.equal(guessGmProgram("Trumpet"), 56);
  assert.equal(guessGmProgram("Sousaphone"), 58);
  assert.equal(guessGmProgram("Root"), 56); // no hint matches "Root" — falls back to Trumpet
  assert.equal(guessGmProgram("Baritone Sax"), 67);
  assert.equal(guessGmProgram("Tenor Sax"), 66);
  assert.equal(guessGmProgram("Alto Sax"), 65);
  assert.equal(guessGmProgram("Electric Bass"), 32);
});

test("guessGmProgram falls back to Trumpet (or a given fallback) for an unrecognised/missing name", () => {
  assert.equal(guessGmProgram(""), 56);
  assert.equal(guessGmProgram(undefined), 56);
  assert.equal(guessGmProgram("Kazoo"), 56);
  assert.equal(guessGmProgram("Kazoo", 0), 0);
});
