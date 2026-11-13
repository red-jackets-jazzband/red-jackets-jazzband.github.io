import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeDocs } from "./merge.js";

const NOW = 1_000_000;

function doc(device, setlists = [], forms = [], tomb = {}) {
  return {
    format: 1,
    device,
    setlists,
    forms,
    tomb: { setlists: {}, rows: {}, forms: {}, ...tomb },
  };
}

function list(id, songs, extra = {}) {
  return { id, name: "Gig", desc: "", metaAt: 1, orderAt: 1, updatedAt: 1, songs, ...extra };
}

function row(id, at = 1, extra = {}) {
  return { id, updatedAt: at, file: `${id}.abc`, key: "", ...extra };
}

const ids = (merged, listId = "L") => {
  return merged.setlists.find((s) => { return s.id === listId; }).songs.map((r) => { return r.id; });
};

test("rows added on both sides are all kept, each after the row it followed", () => {
  const base = [row("a"), row("b")];
  const phone = doc("p", [list("L", [row("a"), row("x", 5), row("b")], { orderAt: 5, updatedAt: 5 })]);
  const laptop = doc("l", [list("L", [...base, row("y", 6)], { orderAt: 6, updatedAt: 6 })]);
  assert.deepEqual(ids(mergeDocs(phone, laptop, NOW)), ["a", "x", "b", "y"]);
  assert.deepEqual(ids(mergeDocs(laptop, phone, NOW)), ["a", "x", "b", "y"]);
});

test("the side edited last decides the order", () => {
  const a = doc("a", [list("L", [row("1"), row("2"), row("3")], { orderAt: 2 })]);
  const b = doc("b", [list("L", [row("3"), row("1"), row("2")], { orderAt: 9 })]);
  assert.deepEqual(ids(mergeDocs(a, b, NOW)), ["3", "1", "2"]);
  assert.deepEqual(ids(mergeDocs(b, a, NOW)), ["3", "1", "2"]);
});

test("a row tombstone removes the row; a newer edit beats it", () => {
  const withRow = doc("a", [list("L", [row("1"), row("2", 3)])]);
  const removed = doc("b", [list("L", [row("1")], { orderAt: 4 })], [], { rows: { "L/2": 4, "L/1": 0 } });
  assert.deepEqual(ids(mergeDocs(withRow, removed, NOW)), ["1"]);
  const edited = doc("a", [list("L", [row("1"), row("2", 8)])]);
  assert.deepEqual(ids(mergeDocs(edited, removed, NOW)), ["1", "2"]);
});

test("a row's own fields are newest-wins, independent of the order", () => {
  const a = doc("a", [list("L", [row("1", 5, { key: "Bb" })])]);
  const b = doc("b", [list("L", [row("1", 7, { key: "C", note: "solo" })])]);
  const merged = mergeDocs(a, b, NOW).setlists[0].songs[0];
  assert.equal(merged.key, "C");
  assert.equal(merged.note, "solo");
});

test("a rename and an added song on different devices both survive", () => {
  const a = doc("a", [list("L", [row("1")], { name: "Renamed", metaAt: 9, updatedAt: 9 })]);
  const b = doc("b", [list("L", [row("1"), row("2", 5)], { orderAt: 5, updatedAt: 5 })]);
  const merged = mergeDocs(a, b, NOW).setlists[0];
  assert.equal(merged.name, "Renamed");
  assert.deepEqual(merged.songs.map((r) => r.id), ["1", "2"]);
});

test("deleting a setlist wins over an older copy, loses to a newer edit", () => {
  const deleted = doc("a", [], [], { setlists: { L: 10 } });
  assert.deepEqual(mergeDocs(deleted, doc("b", [list("L", [row("1")], { updatedAt: 4 })]), NOW).setlists, []);
  assert.equal(mergeDocs(deleted, doc("b", [list("L", [row("1")], { updatedAt: 12 })]), NOW).setlists.length, 1);
});

function f(raw, at) {
  return { file: "a.abc", raw, at };
}

test("song forms: newest wins, tombstones delete", () => {
  const one = '{"show":"mine","rows":[["A"]]}';
  const two = '{"show":"mine","rows":[["B"]]}';
  assert.equal(mergeDocs(doc("a", [], [f(one, 3)]), doc("b", [], [f(two, 5)]), NOW).forms[0].raw, two);
  assert.equal(mergeDocs(doc("a", [], [f(one, 3)]), doc("b", [], [], { forms: { "a.abc": 6 } }), NOW).forms.length, 0);
});

test("equal stamps break the tie by device id, the same either way round", () => {
  const a = doc("a", [list("L", [], { name: "from a" })]);
  const b = doc("b", [list("L", [], { name: "from b" })]);
  assert.equal(mergeDocs(a, b, NOW).setlists[0].name, mergeDocs(b, a, NOW).setlists[0].name);
});

test("merge is order-independent and repeatable", () => {
  const a = doc("a", [list("L", [row("1"), row("x", 5)], { orderAt: 5 })], [], { rows: { "L/9": 3 } });
  const b = doc("b", [list("L", [row("1"), row("y", 6), row("2")], { orderAt: 6 })]);
  const ab = mergeDocs(a, b, NOW);
  const ba = mergeDocs(b, a, NOW);
  assert.deepEqual(ids(ab), ids(ba));
  assert.deepEqual(ids(mergeDocs(ab, b, NOW)), ids(ab));
  assert.deepEqual(ids(mergeDocs(ab, a, NOW)), ids(ab));
});

test("tombstones older than 180 days are dropped", () => {
  const old = 1_000;
  const now = old + 181 * 24 * 60 * 60 * 1000;
  const merged = mergeDocs(doc("a", [], [], { setlists: { gone: old } }), doc("b"), now);
  assert.deepEqual(merged.tomb.setlists, {});
});

test("fields this version doesn't know are kept", () => {
  const a = doc("a", [list("L", [row("1", 5, { future: { x: 1 } })], { extra: true })]);
  const merged = mergeDocs(a, doc("b", [list("L", [row("1")])]), NOW).setlists[0];
  assert.equal(merged.extra, true);
  assert.deepEqual(merged.songs[0].future, { x: 1 });
});

test("row tombstones also apply when only one device has the setlist", () => {
  const a = doc("a", [], [], { setlists: { L: 5 }, rows: { "L/r": 4 } });
  const b = doc("b", [list("L", [row("r", 1), row("keep", 1)], { metaAt: 6, updatedAt: 6 })]);
  assert.deepEqual(ids(mergeDocs(a, b, NOW)), ["keep"]);
  assert.deepEqual(ids(mergeDocs(b, a, NOW)), ["keep"]);
});

test("a row keeps fields only its losing copy has", () => {
  const a = doc("a", [list("L", [row("r", 9)])]);
  const b = doc("b", [list("L", [row("r", 2, { future: "x" })])]);
  assert.equal(mergeDocs(a, b, NOW).setlists[0].songs[0].future, "x");
  assert.equal(mergeDocs(b, a, NOW).setlists[0].songs[0].future, "x");
});
