import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BPM,
  clampBpm,
  resolveBpm,
  stepBpm,
  bpmToWarpPercent,
  recordTap,
  tapBpm,
  TAP_COUNT,
  TAP_RESET_MS,
} from "./tempo.js";

test("clampBpm holds the value inside the allowed range", () => {
  assert.equal(clampBpm(200), 200);
  assert.equal(clampBpm(10), 40);
  assert.equal(clampBpm(999), 320);
});

test("resolveBpm follows the tune when there is no override", () => {
  assert.equal(resolveBpm(null, 96), 96);
  assert.equal(resolveBpm(undefined, 0), DEFAULT_BPM);
  assert.equal(resolveBpm(140, 96), 140);
});

test("stepBpm nudges from the resolved bpm and clamps", () => {
  assert.equal(stepBpm(null, 100, 4), 104);
  assert.equal(stepBpm(120, null, -4), 116);
  assert.equal(stepBpm(38, null, -10), 40);
});

test("bpmToWarpPercent converts a real bpm to a warp percentage", () => {
  assert.equal(bpmToWarpPercent(null, 120), 100);
  assert.equal(bpmToWarpPercent(120, 120), 100);
  assert.equal(bpmToWarpPercent(180, 120), 150);
  assert.equal(bpmToWarpPercent(60, 120), 50);
  assert.equal(bpmToWarpPercent(200, null), 167); // native falls back to 120
  assert.equal(bpmToWarpPercent(1, 1000), 1); // floored at 1
});

test("tapBpm averages the taps kept", () => {
  assert.equal(tapBpm([]), null);
  assert.equal(tapBpm([1000]), null);
  assert.equal(tapBpm([0, 500]), 120);
  assert.equal(tapBpm([0, 480, 1020, 1500]), 120); // uneven taps, 1500 ms over 3 beats
  assert.equal(tapBpm([0, 100]), 320); // clamped
});

test("recordTap keeps only the last four taps", () => {
  let taps = [];
  [0, 500, 1000, 1500, 2000, 2400].forEach((t) => { taps = recordTap(taps, t); });
  assert.equal(TAP_COUNT, 4);
  assert.deepEqual(taps, [1000, 1500, 2000, 2400]);
  assert.equal(tapBpm(taps), 129);
});

test("recordTap starts over after a pause", () => {
  assert.deepEqual(recordTap([0, 500], 500 + TAP_RESET_MS + 1), [500 + TAP_RESET_MS + 1]);
  assert.deepEqual(recordTap([0, 500], 500 + TAP_RESET_MS), [0, 500, 500 + TAP_RESET_MS]);
  assert.deepEqual(recordTap([500], 400), [400]); // clock went back
});
