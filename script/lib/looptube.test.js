import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatClock,
  timeToFraction,
  fractionToTime,
  normalizeLoop,
  clampHandleDrag,
  stepPlaybackRate,
  loopLeadSeconds,
  shouldLoopSeek,
} from "./looptube.js";

test("formatClock renders m:ss under an hour", () => {
  assert.equal(formatClock(5), "0:05");
  assert.equal(formatClock(83), "1:23");
});

test("formatClock renders h:mm:ss past an hour", () => {
  assert.equal(formatClock(3723), "1:02:03");
});

test("formatClock floors and clamps junk input", () => {
  assert.equal(formatClock(-4), "0:00");
  assert.equal(formatClock(NaN), "0:00");
  assert.equal(formatClock(12.9), "0:12");
});

test("timeToFraction / fractionToTime round-trip and clamp", () => {
  assert.equal(timeToFraction(30, 120), 0.25);
  assert.equal(timeToFraction(500, 120), 1);
  assert.equal(timeToFraction(30, 0), 0);
  assert.equal(fractionToTime(0.25, 120), 30);
  assert.equal(fractionToTime(2, 120), 120);
});

test("normalizeLoop orders markers and enforces a minimum gap", () => {
  assert.deepEqual(normalizeLoop(40, 12, 1), { a: 12, b: 40 });
  assert.equal(normalizeLoop(10, null, 1), null);
  assert.equal(normalizeLoop(10, 10.5, 1), null);
});

test("clampHandleDrag keeps A left of B and B right of A", () => {
  assert.equal(clampHandleDrag(0.8, 0.5, "a", 0.05), 0.45);
  assert.equal(clampHandleDrag(0.2, 0.5, "b", 0.05), 0.55);
  assert.equal(clampHandleDrag(0.3, 0.9, "a", 0.05), 0.3);
});

test("stepPlaybackRate walks the available rates and clamps", () => {
  const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  assert.equal(stepPlaybackRate(1, -1, rates), 0.75);
  assert.equal(stepPlaybackRate(1, 1, rates), 1.25);
  assert.equal(stepPlaybackRate(0.25, -1, rates), 0.25);
  assert.equal(stepPlaybackRate(2, 1, rates), 2);
});

test("stepPlaybackRate falls back to a default rate set", () => {
  assert.equal(stepPlaybackRate(1, -1, undefined), 0.75);
  assert.equal(stepPlaybackRate(1, -1, []), 0.75);
});

test("loopLeadSeconds grows with playback rate and has a floor", () => {
  assert.equal(loopLeadSeconds(1, 0), 0.12);
  assert.ok(loopLeadSeconds(2, 80) > loopLeadSeconds(1, 80));
});

test("shouldLoopSeek fires near B and when the head runs before A", () => {
  assert.equal(shouldLoopSeek(39.9, 10, 40, 0.2), true);
  assert.equal(shouldLoopSeek(25, 10, 40, 0.2), false);
  assert.equal(shouldLoopSeek(2, 10, 40, 0.2), true);
  assert.equal(shouldLoopSeek(NaN, 10, 40, 0.2), false);
});
