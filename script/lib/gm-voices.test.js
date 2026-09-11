import { test } from "node:test";
import assert from "node:assert/strict";
import { GM_VOICES } from "./gm-voices.js";

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
