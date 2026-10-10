import { test } from "node:test";
import assert from "node:assert/strict";
import { progressionShades } from "./overlays.js";

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
