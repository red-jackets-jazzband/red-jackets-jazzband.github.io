import { test } from "node:test";
import assert from "node:assert/strict";
import { PRACTICE_RHYTHMS } from "../../lib/music/practice.js";
import { SETTINGS_SLICE } from "./state.js";

const codec = SETTINGS_SLICE.prefs.practiceRhythms;
const reader = (stored) => (key) => (key in stored ? stored[key] : null);

test("practiceRhythms: ticked values round-trip, none stored means null", () => {
  const written = {};
  codec.save(["pushes", "charleston"], (key, value) => { written[key] = value; });
  assert.deepEqual(written, { "rj.practiceRhythms": "pushes,charleston" });
  assert.deepEqual(codec.load(reader(written)), ["charleston", "pushes"]);
  codec.save(null, (key, value) => { written[key] = value; });
  assert.equal(codec.load(reader(written)), null);
  assert.equal(codec.load(reader({ "rj.practiceRhythms": "gone,also-gone" })), null);
});

test("practiceRhythms: the old single choice carries over", () => {
  const old = (value) => codec.load(reader({ "rj.practiceRhythm": value }));
  assert.deepEqual(old("charleston"), ["charleston"]);
  assert.deepEqual(old("syncopated"), PRACTICE_RHYTHMS.filter((r) => r.sync && r.run).map((r) => r.value));
  assert.equal(old("varied"), null);
  assert.equal(codec.load(reader({})), null);
  // Once the new key is written, the old one is ignored.
  assert.equal(codec.load(reader({ "rj.practiceRhythm": "charleston", "rj.practiceRhythms": "" })), null);
});
