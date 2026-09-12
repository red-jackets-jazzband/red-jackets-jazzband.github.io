import { test } from "node:test";
import assert from "node:assert/strict";
import { nextVoiceId } from "./voice-id.js";

test("nextVoiceId picks the next id after a contiguous run, matching the old length+1 guess", () => {
  assert.equal(nextVoiceId([]), "1");
  assert.equal(nextVoiceId(["1"]), "2");
  assert.equal(nextVoiceId(["1", "2", "3"]), "4");
});

test("nextVoiceId skips past a collision instead of reusing an id a sparse voice list already has", () => {
  // a length+1 guess ("3") would collide with the chart's own V:3
  assert.equal(nextVoiceId(["1", "3"]), "4");
});

test("nextVoiceId never collides with a chart's own non-numeric voice ids", () => {
  assert.equal(nextVoiceId(["T", "S"]), "3");
});
