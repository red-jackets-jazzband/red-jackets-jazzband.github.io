import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseQueryString, songFileFromHash, parseSongsParams, buildSongsHash,
} from "./song-hash.js";

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

test("parseSongsParams reads song, setlist and loop markers", () => {
  assert.deepEqual(parseSongsParams("#s=basin_street"), {
    song: "basin_street", setlist: null, a: null, b: null, inspiration: false,
  });
  assert.deepEqual(parseSongsParams("#sl=setlist_2026&s=basin_street"), {
    song: "basin_street", setlist: "setlist_2026", a: null, b: null, inspiration: false,
  });
  assert.deepEqual(parseSongsParams("#s=basin_street&a=12&b=30.5"), {
    song: "basin_street", setlist: null, a: 12, b: 30.5, inspiration: true,
  });
  assert.deepEqual(parseSongsParams("s=basin_street&i=1"), {
    song: "basin_street", setlist: null, a: null, b: null, inspiration: true,
  });
});

test("parseSongsParams drops junk markers and decodes slugs", () => {
  const p = parseSongsParams("#s=st%20james&a=-3&b=notanumber");
  assert.equal(p.song, "st james");
  assert.equal(p.a, null);
  assert.equal(p.b, null);
  assert.equal(p.inspiration, false);
});

test("buildSongsHash round-trips a shared inspiration loop", () => {
  const hash = buildSongsHash({
    song: "basin_street", setlist: "setlist_2026", a: 12, b: 30.53, inspiration: true,
  });
  assert.equal(hash, "sl=setlist_2026&s=basin_street&a=12&b=30.5");
  assert.deepEqual(parseSongsParams(`#${hash}`), {
    song: "basin_street", setlist: "setlist_2026", a: 12, b: 30.5, inspiration: true,
  });
});

test("buildSongsHash omits empty parts and adds i=1 only without markers", () => {
  assert.equal(buildSongsHash({ song: "x" }), "s=x");
  assert.equal(buildSongsHash({ song: "x", inspiration: true }), "s=x&i=1");
  assert.equal(buildSongsHash({}), "");
  assert.equal(buildSongsHash({ setlist: "s", song: "x", b: 4, inspiration: true }), "sl=s&s=x&b=4");
});
