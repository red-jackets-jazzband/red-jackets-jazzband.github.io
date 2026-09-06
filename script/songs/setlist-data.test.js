import { test } from "node:test";
import assert from "node:assert/strict";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createSetlistData, countSetlistSongs, songCountLabel } from "./setlist-data.js";

test("songCountLabel / countSetlistSongs count only song items", () => {
  assert.equal(songCountLabel(1), "1 song");
  assert.equal(songCountLabel(3), "3 songs");
  assert.equal(countSetlistSongs([{ file: "a.abc" }, { divider: "Set 2" }, { file: "b.abc" }]), 2);
});

test("ensureSongsLoaded forwards a failed index fetch to onError", () => {
  const ctx = makeCtx({
    state: { allSongsLoaded: false, allSongs: [] },
    readFile: (_path, _onLoad, onError) => onError(503),
  });
  const data = createSetlistData(ctx);
  let loaded = false;
  let errStatus = null;
  data.ensureSongsLoaded(() => { loaded = true; }, (s) => { errStatus = s; });
  assert.equal(loaded, false, "the success callback must not fire on a failed fetch");
  assert.equal(errStatus, 503);
});

test("ensureSongsLoaded runs the callback and marks the index loaded on success", () => {
  const ctx = makeCtx({
    state: { allSongsLoaded: false, allSongs: [] },
    readFile: (_path, onLoad) => onLoad("basin_street\nsister_kate\n"),
  });
  const data = createSetlistData(ctx);
  let loaded = false;
  data.ensureSongsLoaded(() => { loaded = true; });
  assert.equal(loaded, true);
  assert.equal(ctx.state.allSongsLoaded, true);
});
