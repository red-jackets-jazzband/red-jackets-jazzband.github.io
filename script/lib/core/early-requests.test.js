import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EARLY_REQUESTS_KEY, earlyRequestPaths, startEarlyRequests, takeEarlyRequest,
} from "./early-requests.js";

const INDEXES = ["/songs/index_of_songs.txt", "/setlists/index_of_setlists.txt"];
const PANAMA = "/songs/panama.abc";

test("the catalog indexes are always started early", () => {
  assert.deepEqual(earlyRequestPaths(""), INDEXES);
});

test("a song link starts its .abc too, in or out of a setlist", () => {
  assert.deepEqual(earlyRequestPaths("#s=bill_bailey"), [...INDEXES, "/songs/bill_bailey.abc"]);
  assert.deepEqual(earlyRequestPaths("#sl=setlist_2026&s=panama"), [...INDEXES, PANAMA]);
});

test("a setlist link alone starts no setlist file (a personal one has none)", () => {
  assert.deepEqual(earlyRequestPaths("#sl=setlist_2026"), INDEXES);
});

test("a started request is handed out once, then reads go to the network again", () => {
  const win = { location: { hash: "#s=panama" } };
  startEarlyRequests(win, (path) => ({ path }));
  assert.deepEqual(Object.keys(win[EARLY_REQUESTS_KEY]), [...INDEXES, PANAMA]);
  assert.deepEqual(takeEarlyRequest(win, PANAMA), { path: PANAMA });
  assert.equal(takeEarlyRequest(win, PANAMA), null);
  assert.equal(takeEarlyRequest(win, "/songs/other.abc"), null);
});

test("nothing was started early: no request to take", () => {
  assert.equal(takeEarlyRequest({}, "/songs/index_of_songs.txt"), null);
});
