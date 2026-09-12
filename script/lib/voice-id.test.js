import { test } from "node:test";
import assert from "node:assert/strict";
import { nextVoiceId } from "./voice-id.js";

test("nextVoiceId picks the next id after a contiguous run, same as a length+1 guess would", () => {
  assert.equal(nextVoiceId([]), "1");
  assert.equal(nextVoiceId(["1"]), "2");
  assert.equal(nextVoiceId(["1", "2", "3"]), "4");
});

test("nextVoiceId fills the lowest gap in a sparse voice list, not just past its own highest id", () => {
  // the true smallest unused id is "2" -- a length+1 guess would start at 3,
  // collide with the chart's own V:3, and count up to 4 without ever
  // considering "2" again
  assert.equal(nextVoiceId(["1", "3"]), "2");
});

test("nextVoiceId never collides with a chart's own non-numeric voice ids", () => {
  // "T"/"S" never collide with a numeric guess at all, so the smallest
  // positive integer id, "1", is free regardless of how many voices exist
  assert.equal(nextVoiceId(["T", "S"]), "1");
});
