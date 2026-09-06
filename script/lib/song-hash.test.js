import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQueryString, songFileFromHash } from "./song-hash.js";

test("parseQueryString splits key/value pairs", () => {
  assert.deepEqual(parseQueryString("s=basin_street"), { s: "basin_street" });
  assert.deepEqual(parseQueryString("a=1&b=2"), { a: "1", b: "2" });
  assert.deepEqual(parseQueryString("flag"), { flag: "" });
  assert.deepEqual(parseQueryString(""), {});
});

test("songFileFromHash returns the .abc filename for #s=<slug>", () => {
  assert.equal(songFileFromHash("#s=basin_street"), "basin_street.abc");
  assert.equal(songFileFromHash("s=basin_street"), "basin_street.abc");
  assert.equal(songFileFromHash("#s=st_james&x=1"), "st_james.abc");
});

test("songFileFromHash returns null when the hash carries no song", () => {
  assert.equal(songFileFromHash("#about"), null);
  assert.equal(songFileFromHash(""), null);
  assert.equal(songFileFromHash("#"), null);
});
