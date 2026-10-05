import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySwipe } from "./swipe.js";

const at = (x, y, t) => ({ x, y, t });

test("a quick horizontal flick classifies by direction", () => {
  assert.equal(classifySwipe(at(200, 100, 0), at(120, 110, 150)), "left");
  assert.equal(classifySwipe(at(120, 100, 0), at(220, 90, 150)), "right");
});

test("a short drag is not a swipe", () => {
  assert.equal(classifySwipe(at(200, 100, 0), at(170, 100, 150)), null);
});

test("a mostly-vertical drag is a scroll, not a swipe", () => {
  assert.equal(classifySwipe(at(200, 100, 0), at(120, 220, 150)), null);
});

test("a slow drag across the axis is not a flick", () => {
  assert.equal(classifySwipe(at(200, 100, 0), at(80, 100, 1200)), null);
});

test("missing endpoints yield null", () => {
  assert.equal(classifySwipe(null, at(1, 2, 3)), null);
  assert.equal(classifySwipe(at(1, 2, 3), null), null);
});

test("thresholds are overridable", () => {
  assert.equal(classifySwipe(at(0, 0, 0), at(30, 0, 100)), null);
  assert.equal(classifySwipe(at(0, 0, 0), at(30, 0, 100), { minDistance: 20 }), "right");
});
