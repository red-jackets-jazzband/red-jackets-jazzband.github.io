import { test } from "node:test";
import assert from "node:assert/strict";
import { walkSetlist } from "./setlist-walk.js";
import { splitIndexIntoColumns } from "./setlist-index-columns.js";

const song = (file) => ({ file, key: "" });
const brk = (label = "") => ({ divider: label });

const groupShape = (columns) =>
  columns.map((col) => col.map((g) => [g.heading, g.entries.map((e) => e.item.file)]));

const columnWeight = (col) => col.reduce((sum, g) => sum + 1 + g.entries.length, 0);

test("undivided list: songs split freely across columns, no headings", () => {
  const { entries, hasDividers } = walkSetlist([song("a"), song("b"), song("c"), song("d")]);
  const columns = splitIndexIntoColumns(entries, hasDividers, 2);
  assert.equal(columns.length, 2);
  assert.deepEqual(groupShape(columns), [
    [[null, ["a", "b"]]],
    [[null, ["c", "d"]]],
  ]);
});

test("undivided list narrower than the column count: trailing columns are empty", () => {
  const { entries, hasDividers } = walkSetlist([song("a")]);
  const columns = splitIndexIntoColumns(entries, hasDividers, 3);
  assert.equal(columns.length, 3);
  assert.deepEqual(groupShape(columns), [[[null, ["a"]]], [], []]);
});

test("divided list: a whole set is one chunk, never split across columns", () => {
  const items = [
    song("a"), song("b"), song("c"), song("d"), song("e"), song("f"), song("g"), song("h"),
    brk("Set 2"),
    song("i"), song("j"), song("k"), song("l"), song("m"), song("n"), song("o"),
    brk("Set 3"),
    song("p"), song("q"), song("r"), song("s"), song("t"), song("u"), song("v"), song("w"),
    brk("Set 4"),
    song("x"), song("y"), song("z"), song("aa"), song("bb"), song("cc"),
  ];
  const { entries, hasDividers } = walkSetlist(items);
  const columns = splitIndexIntoColumns(entries, hasDividers, 2);
  assert.equal(columns.length, 2);

  // Every set lands entirely within one column.
  const setColumnOf = (label) => columns.findIndex((col) => col.some((g) => g.heading === label));
  const allFiles = (label) => columns[setColumnOf(label)]
    .find((g) => g.heading === label).entries.map((e) => e.item.file);
  assert.deepEqual(allFiles("Set 1"), ["a", "b", "c", "d", "e", "f", "g", "h"]);
  assert.deepEqual(allFiles("Set 2"), ["i", "j", "k", "l", "m", "n", "o"]);
  assert.deepEqual(allFiles("Set 3"), ["p", "q", "r", "s", "t", "u", "v", "w"]);
  assert.deepEqual(allFiles("Set 4"), ["x", "y", "z", "aa", "bb", "cc"]);

  // Reading order is preserved: sets never jump backward between columns.
  assert.ok(setColumnOf("Set 1") <= setColumnOf("Set 2"));
  assert.ok(setColumnOf("Set 2") <= setColumnOf("Set 3"));
  assert.ok(setColumnOf("Set 3") <= setColumnOf("Set 4"));

  // Columns come out reasonably balanced (15 vs 14 songs+headings here).
  const weights = columns.map(columnWeight);
  assert.ok(Math.abs(weights[0] - weights[1]) <= 2, `expected balanced columns, got ${weights}`);
});

test("a set taller than a whole column still isn't split — it just makes that column tall", () => {
  const items = [
    song("a"), song("b"), song("c"), song("d"), song("e"),
    song("f"), song("g"), song("h"), song("i"), song("j"),
    brk("Set 2"),
    song("k"),
  ];
  const { entries, hasDividers } = walkSetlist(items);
  const columns = splitIndexIntoColumns(entries, hasDividers, 3);
  assert.equal(columns.length, 3);
  const set1 = columns.flat().find((g) => g.heading === "Set 1");
  assert.equal(set1.entries.length, 10);
});

test("three columns with more sets than columns keeps multiple sets per column", () => {
  const items = [
    song("a"), song("b"),
    brk("Set 2"), song("c"), song("d"),
    brk("Set 3"), song("e"), song("f"),
    brk("Set 4"), song("g"), song("h"),
  ];
  const { entries, hasDividers } = walkSetlist(items);
  const columns = splitIndexIntoColumns(entries, hasDividers, 3);
  assert.equal(columns.length, 3);
  assert.equal(columns.flat().filter((g) => g.heading).length, 4);
});

test("three equal sets distribute one per column across three columns", () => {
  const items = [
    song("a"), song("b"),
    brk("Set 2"), song("c"), song("d"),
    brk("Set 3"), song("e"), song("f"),
  ];
  const { entries, hasDividers } = walkSetlist(items);
  const columns = splitIndexIntoColumns(entries, hasDividers, 3);
  assert.equal(columns.length, 3);
  assert.deepEqual(groupShape(columns), [
    [["Set 1", ["a", "b"]]],
    [["Set 2", ["c", "d"]]],
    [["Set 3", ["e", "f"]]],
  ]);
});

test("a leading divider (no implicit 'Set 1') still keeps its set whole", () => {
  const { entries, hasDividers } = walkSetlist([brk("Opener"), song("a"), song("b")]);
  const columns = splitIndexIntoColumns(entries, hasDividers, 2);
  assert.deepEqual(groupShape(columns), [[["Opener", ["a", "b"]]], []]);
});
