import { test } from "node:test";
import assert from "node:assert/strict";
import { humanizeSongFile } from "./filename.js";

test("humanizeSongFile turns an ABC filename into a title", () => {
  assert.equal(humanizeSongFile("basin_street.abc"), "Basin Street");
  assert.equal(humanizeSongFile("st-james_infirmary.abc"), "St James Infirmary");
  assert.equal(humanizeSongFile("BASIN_STREET.ABC"), "BASIN STREET");
  assert.equal(humanizeSongFile("sweet_georgia_brown"), "Sweet Georgia Brown");
});

test("humanizeSongFile tolerates empty / nullish input", () => {
  assert.equal(humanizeSongFile(""), "");
  assert.equal(humanizeSongFile(null), "");
  assert.equal(humanizeSongFile(undefined), "");
});
