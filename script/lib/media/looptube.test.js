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
  ZOOM_LEVELS,
  computeZoomWindow,
  timeToViewFraction,
  viewFractionToTime,
  stepZoom,
  panZoomWindow,
  nearestZoomLevel,
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

test("computeZoomWindow centers a narrower window on the given time", () => {
  // 200s clip, 4x zoom -> a 50s-wide window centered on 100.
  assert.deepEqual(computeZoomWindow(100, 200, 4), { start: 75, end: 125 });
});

test("computeZoomWindow clamps the window inside [0, duration]", () => {
  assert.deepEqual(computeZoomWindow(10, 200, 4), { start: 0, end: 50 });
  assert.deepEqual(computeZoomWindow(195, 200, 4), { start: 150, end: 200 });
});

test("computeZoomWindow falls back to the full clip at 1x or with no duration", () => {
  assert.deepEqual(computeZoomWindow(100, 200, 1), { start: 0, end: 200 });
  assert.deepEqual(computeZoomWindow(100, 0, 4), { start: 0, end: 0 });
});

test("timeToViewFraction / viewFractionToTime round-trip within a zoomed window", () => {
  assert.equal(timeToViewFraction(100, 75, 125), 0.5);
  assert.equal(timeToViewFraction(75, 75, 125), 0);
  assert.equal(timeToViewFraction(125, 75, 125), 1);
  assert.equal(timeToViewFraction(200, 75, 125), 1); // clamped past the window
  assert.equal(viewFractionToTime(0.5, 75, 125), 100);
  assert.equal(timeToViewFraction(10, 0, 0), 0); // zero-width window
});

test("stepZoom walks ZOOM_LEVELS and clamps at the ends", () => {
  assert.equal(stepZoom(1, 1), 2);
  assert.equal(stepZoom(2, -1), 1);
  assert.equal(stepZoom(1, -1), 1); // already at the widest view
  assert.equal(stepZoom(ZOOM_LEVELS.at(-1), 1), ZOOM_LEVELS.at(-1)); // already at the narrowest
});

test("nearestZoomLevel picks the ZOOM_LEVELS entry whose implied width is closest", () => {
  // 200s clip: level 4 implies a 50s window, level 8 a 25s window.
  assert.equal(nearestZoomLevel(200, 50), 4);
  assert.equal(nearestZoomLevel(200, 45), 4); // closer to 50 than to 25
  assert.equal(nearestZoomLevel(200, 30), 8); // closer to 25 than to 50
  assert.equal(nearestZoomLevel(200, 25), 8);
});

test("nearestZoomLevel clamps to the ends for spans outside ZOOM_LEVELS' range", () => {
  assert.equal(nearestZoomLevel(200, 1000), ZOOM_LEVELS[0]); // wider than the full clip
  assert.equal(nearestZoomLevel(200, 0.001), ZOOM_LEVELS.at(-1)); // far narrower than the narrowest level
});

test("panZoomWindow shifts a zoomed window and clamps at the clip's ends", () => {
  assert.deepEqual(panZoomWindow(75, 125, 200, 1, 0.2), { start: 85, end: 135 });
  assert.deepEqual(panZoomWindow(75, 125, 200, -1, 0.2), { start: 65, end: 115 });
  // Panning off either edge clamps the window without shrinking it.
  assert.deepEqual(panZoomWindow(0, 50, 200, -1, 0.5), { start: 0, end: 50 });
  assert.deepEqual(panZoomWindow(150, 200, 200, 1, 0.5), { start: 150, end: 200 });
});

test("panZoomWindow is a no-op once the window already covers the whole clip", () => {
  assert.deepEqual(panZoomWindow(0, 200, 200, 1, 0.2), { start: 0, end: 200 });
});
