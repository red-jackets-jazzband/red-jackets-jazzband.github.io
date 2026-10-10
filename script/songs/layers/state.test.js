import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYER_IDS } from "../../lib/music/layers.js";
import { LAYERS_SLICE } from "./state.js";

const codec = LAYERS_SLICE.prefs.activeLayers;

test("every layer is off, and the panel closed, until the visitor says otherwise", () => {
  assert.deepEqual(codec.load(() => null), Object.fromEntries(LAYER_IDS.map((id) => [id, false])));
  assert.equal(LAYERS_SLICE.initial.layersOpen, false);
});

test("each layer's switch is stored under its own rj.layer.<id> key", () => {
  const stored = {};
  codec.save(Object.fromEntries(LAYER_IDS.map((id, i) => [id, i === 0])), (key, value) => {
    stored[key] = value;
  });
  assert.deepEqual(Object.keys(stored).sort(), LAYER_IDS.map((id) => `rj.layer.${id}`).sort());
  assert.equal(stored[`rj.layer.${LAYER_IDS[0]}`], "1");
  assert.equal(stored[`rj.layer.${LAYER_IDS[1]}`], "0");
});

test("a stored switch is read back, key for key", () => {
  const read = (key) => (key === `rj.layer.${LAYER_IDS[1]}` ? "1" : null);
  const loaded = codec.load(read);
  assert.equal(loaded[LAYER_IDS[1]], true);
  assert.equal(loaded[LAYER_IDS[0]], false);
});

test("only the switches persist: whether the panel is open does not", () => {
  assert.deepEqual(Object.keys(LAYERS_SLICE.prefs), ["activeLayers"]);
});
