import { test } from "node:test";
import assert from "node:assert/strict";
import {
  barPath, growViewBox, keepBelow, progressionShades, unionOf,
} from "./layer-geometry.js";

const match = (name) => ({ name });
const at = (name, startNote, endNote) => ({ name, startNote, endNote });
const SHADE_0 = "rj-layer-prog--0";

test("each progression name gets its own shade, in order of first appearance", () => {
  const shades = progressionShades([match("Georgia"), match("Salty Dog"), match("Georgia"), match("Sunshine"), match("Salty Dog")]);
  assert.deepEqual(shades, [
    SHADE_0, "rj-layer-prog--1", SHADE_0, "rj-layer-prog--2", "rj-layer-prog--1",
  ]);
});

test("the shades cycle after five names", () => {
  const shades = progressionShades(["A", "B", "C", "D", "E", "F"].map(match));
  assert.equal(shades[5], SHADE_0);
  assert.deepEqual(progressionShades([]), []);
});

test("the same progression straight after itself alternates a lighter tint", () => {
  const shades = progressionShades([
    at("Four-Leaf", 0, 10), at("Four-Leaf", 10, 20), at("Four-Leaf", 20, 30), at("Georgia", 30, 35), at("Four-Leaf", 40, 50),
  ]);
  assert.deepEqual(shades, [
    SHADE_0, `${SHADE_0} rj-layer-prog-alt`, SHADE_0,
    "rj-layer-prog--1", SHADE_0,
  ]);
});

test("unionOf is the box round several boxes", () => {
  assert.deepEqual(unionOf([{ x: 10, y: 5, width: 4, height: 2 }, { x: 20, y: 1, width: 3, height: 3 }]), {
    x1: 10, y1: 1, x2: 23, y2: 7,
  });
});

test("barPath: a closed bar is rounded on every corner and stroked all round", () => {
  const { fill, edge } = barPath({ x1: 0, y1: 0, x2: 100, y2: 20 }, { left: false, right: false });
  assert.match(fill, /^M4 20 L96 20 Q100 20 100 16 L100 4 Q100 0 96 0 L4 0 Q0 0 0 4 L0 16 Q0 20 4 20 Z$/);
  assert.equal(edge.split("M").length - 1, 1, "one continuous edge");
});

test("barPath: an open side has square corners and no edge there", () => {
  const { fill, edge } = barPath({ x1: 0, y1: 0, x2: 100, y2: 20 }, { left: true, right: false });
  assert.doesNotMatch(fill, /Q0 /, "no rounding at the open left");
  assert.match(fill, /L0 0/);
  assert.equal(edge.includes("L0 16"), false, "the open left side isn't stroked");
  assert.ok(edge.includes("L100 4"), "the closed right side is");
});

test("barPath: both sides open leaves only the top and bottom edges", () => {
  const { edge } = barPath({ x1: 0, y1: 0, x2: 100, y2: 20 }, { left: true, right: true });
  assert.equal(edge.includes("L100 0"), false);
  assert.equal(edge.includes("L0 20"), false);
  assert.ok(edge.includes("L0 0") && edge.includes("L100 20"));
});

test("keepBelow moves a bar's top down to the limit and lets the bottom take the height", () => {
  const bar = { y1: 2, y2: 20 };
  keepBelow(bar, 6);
  assert.deepEqual(bar, { y1: 6, y2: 24 });
  const fine = { y1: 8, y2: 20 };
  keepBelow(fine, 6);
  assert.deepEqual(fine, { y1: 8, y2: 20 });
});

test("growViewBox takes in letters sticking out above, keeping the width", () => {
  const view = { x: 0, y: 40, width: 1000, height: 120 };
  assert.deepEqual(growViewBox(view, [36, 44], 1), { x: 0, y: 35, width: 1000, height: 125 });
  assert.equal(growViewBox(view, [60], 1), null, "everything already inside");
  assert.deepEqual(growViewBox(view, [40], 1), { x: 0, y: 39, width: 1000, height: 121 }, "a letter right at the edge gets its headroom");
  assert.equal(growViewBox(view, [], 1), null, "no chords");
  assert.equal(growViewBox(null, [1], 1), null);
  assert.equal(growViewBox({ x: 0, y: 0, width: 0, height: 0 }, [-5], 1), null, "an empty view is left to ABCjs");
});
