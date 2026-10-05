import { test } from "node:test";
import assert from "node:assert/strict";
import { walkSetlist } from "./setlist-walk.js";

const song = (file) => ({ file, key: "" });
const brk = (label = "") => ({ divider: label });

test("no dividers: a flat 1..n numbering, no headings", () => {
  const { hasDividers, entries } = walkSetlist([song("a"), song("b"), song("c")]);
  assert.equal(hasDividers, false);
  assert.deepEqual(entries.map((e) => e.kind), ["song", "song", "song"]);
  assert.deepEqual(entries.map((e) => e.displayNumber), [1, 2, 3]);
  assert.deepEqual(entries.map((e) => e.songCount), [1, 2, 3]);
  assert.deepEqual(entries.map((e) => e.setNumber), [1, 1, 1]);
});

test("a mid-list divider splits into sets, numbers restart, headings appear", () => {
  const { hasDividers, entries } = walkSetlist([
    song("a"), song("b"), brk("Second set"), song("c"),
  ]);
  assert.equal(hasDividers, true);
  assert.deepEqual(entries.map((e) => e.kind), [
    "set-heading", "song", "song", "set-heading", "song",
  ]);
  assert.deepEqual(entries.map((e) => e.label ?? e.displayNumber), [
    "Set 1", 1, 2, "Second set", 1,
  ]);
  // songCount stays unique across the whole list (drives element ids)
  assert.deepEqual(
    entries.filter((e) => e.kind === "song").map((e) => e.songCount),
    [1, 2, 3],
  );
  assert.deepEqual(
    entries.filter((e) => e.kind === "song").map((e) => e.setNumber),
    [1, 1, 2],
  );
});

test("an unlabelled divider falls back to 'Set N'", () => {
  const { entries } = walkSetlist([song("a"), brk(), song("b")]);
  assert.deepEqual(entries.map((e) => e.label).filter(Boolean), ["Set 1", "Set 2"]);
});

test("a leading divider is not preceded by an implicit 'Set 1'", () => {
  const { entries } = walkSetlist([brk("Opener"), song("a")]);
  assert.deepEqual(entries.map((e) => e.kind), ["set-heading", "song"]);
  assert.equal(entries[0].label, "Opener");
  assert.equal(entries[0].setNumber, 2);
});

test("followsHeading marks the song directly under each heading", () => {
  const { entries } = walkSetlist([song("a"), song("b"), brk("Two"), song("c")]);
  const songs = entries.filter((e) => e.kind === "song");
  assert.deepEqual(songs.map((e) => e.followsHeading), [true, false, true]);
});

test("original array indices are preserved on every entry", () => {
  const items = [song("a"), brk("Two"), song("c")];
  const { entries } = walkSetlist(items);
  assert.equal(entries[0].kind, "set-heading"); // implicit Set 1, no index
  assert.equal(entries[1].index, 0);
  assert.equal(entries[2].index, 1); // the divider
  assert.equal(entries[3].index, 2);
});

test("empty / nullish input yields nothing", () => {
  assert.deepEqual(walkSetlist([]), { hasDividers: false, entries: [] });
  assert.deepEqual(walkSetlist(null), { hasDividers: false, entries: [] });
});
