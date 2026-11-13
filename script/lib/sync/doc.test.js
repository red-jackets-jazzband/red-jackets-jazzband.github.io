import { test } from "node:test";
import assert from "node:assert/strict";
import { createPersonalSetlist, addSongToPersonalSetlist, listPersonalSetlists, deletePersonalSetlist, renamePersonalSetlist } from "../setlists/setlists-store.js";
import { buildLocalDoc, applyDoc } from "./doc.js";
import { mergeDocs } from "./merge.js";
import { validateDoc } from "./validate.js";
import { readMeta } from "./clock.js";

function makeStorage() {
  const data = {};
  return {
    get length() { return Object.keys(data).length; },
    key: (i) => { return Object.keys(data)[i] === undefined ? null : Object.keys(data)[i]; },
    getItem: (k) => { return Object.hasOwn(data, k) ? data[k] : null; },
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

const FORM = '{"show":"mine","rows":[["A","B"]]}';

function sync(from, to) {
  const remote = roundTrip(buildLocalDoc(from)).doc;
  applyDoc(to, mergeDocs(buildLocalDoc(to), remote));
}

function row(extra) {
  return { id: "r1", updatedAt: 1, file: "a.abc", ...extra };
}

function roundTrip(doc) {
  return validateDoc(JSON.parse(JSON.stringify(doc)));
}

test("two devices sync a setlist both ways; a delete and a song form follow", () => {
  const phone = makeStorage();
  const laptop = makeStorage();
  const made = createPersonalSetlist(phone, "Gig");
  addSongToPersonalSetlist(phone, made.id, { file: "a.abc", key: "" });
  phone.setItem("rj.songForm.a.abc", FORM);

  sync(phone, laptop);
  assert.equal(listPersonalSetlists(laptop)[0].name, "Gig");
  assert.equal(laptop.getItem("rj.songForm.a.abc"), FORM);

  renamePersonalSetlist(laptop, made.id, "Gig 2");
  sync(laptop, phone);
  assert.equal(listPersonalSetlists(phone)[0].name, "Gig 2");

  deletePersonalSetlist(phone, made.id);
  sync(phone, laptop);
  assert.deepEqual(listPersonalSetlists(laptop), []);
});

test("an edit by an older app copy (no stamp) is found against the snapshot", () => {
  const storage = makeStorage();
  const made = createPersonalSetlist(storage, "Gig");
  applyDoc(storage, buildLocalDoc(storage)); // snapshot saved
  const list = listPersonalSetlists(storage);
  list[0].name = "Edited by old app";
  storage.setItem("rj.setlists.v1", JSON.stringify(list));
  storage.setItem("rj.songForm.b.abc", FORM);
  const doc = buildLocalDoc(storage, Date.now() + 10);
  assert.ok(doc.setlists[0].metaAt > made.metaAt);
  assert.equal(doc.forms[0].file, "b.abc");
  // …and an old-app delete becomes a tombstone
  storage.setItem("rj.setlists.v1", "[]");
  assert.ok(buildLocalDoc(storage, Date.now() + 20).tomb.setlists[made.id] > 0);
});

test("the tour's demo setlist is neither uploaded nor lost", () => {
  const storage = makeStorage();
  storage.setItem("rj.setlists.v1", JSON.stringify([
    { id: "demo", name: "Demo", desc: "\u0001tour", songs: [] },
    { id: "real", name: "Real", desc: "", songs: [] },
  ]));
  const doc = buildLocalDoc(storage);
  assert.deepEqual(doc.setlists.map((s) => s.id), ["real"]);
  applyDoc(storage, doc);
  assert.deepEqual(listPersonalSetlists(storage).map((s) => s.id).sort(), ["demo", "real"]);
});

test("applying a document raises the clock past every stamp in it", () => {
  const storage = makeStorage();
  const doc = { format: 1, device: "x", setlists: [], forms: [], tomb: { setlists: { z: 9e15 }, rows: {}, forms: {} } };
  applyDoc(storage, doc);
  assert.equal(readMeta(storage).maxStamp, 9e15);
});

test("validation drops bad items, keeps unknown fields, flags a newer format", () => {
  const good = { id: "L", name: "Gig", desc: "", metaAt: 1, orderAt: 1, updatedAt: 1, songs: [row({ future: 1 })] };
  const result = validateDoc({
    format: 1,
    device: "d",
    setlists: [
      good,
      { ...good, id: "bad id!" },
      { ...good, id: "M", songs: [row({ file: "../../evil" })] },
      { ...good, id: "N", desc: "\u0001marker" },
      { ...good, id: "O", name: "x".repeat(500) },
    ],
    forms: [{ file: "a.abc", raw: FORM, at: 1 }, { file: "a.abc", raw: "nope", at: 1 }, { file: "../x.abc", raw: FORM, at: 1 }],
    tomb: { setlists: { gone: 5, bad: "x" } },
  });
  assert.ok(result.ok);
  assert.deepEqual(result.doc.setlists.map((s) => [s.id, s.songs.length]), [["L", 1], ["M", 0], ["N", 1]]);
  assert.equal(result.doc.setlists[0].songs[0].future, 1);
  assert.equal(result.doc.setlists[2].desc, "");
  assert.equal(result.doc.forms.length, 1);
  assert.deepEqual(result.doc.tomb.setlists, { gone: 5 });
  assert.deepEqual(validateDoc({ format: 2 }), { ok: false, newer: true });
  assert.deepEqual(validateDoc("junk"), { ok: false, newer: false });
});

test("an id that isn't a string is dropped, so a merge can't throw on it", () => {
  const row = { updatedAt: 1, file: "a.abc" };
  const result = validateDoc({
    format: 1,
    setlists: [
      { id: 5, name: "number", desc: "", songs: [] },
      { id: ["x"], name: "array", desc: "", songs: [] },
      { id: "ok", name: "fine", desc: "", songs: [{ ...row, id: 7 }, { ...row, id: "r1" }] },
    ],
  });
  assert.deepEqual(result.doc.setlists.map((s) => { return s.id; }), ["ok"]);
  assert.deepEqual(result.doc.setlists[0].songs.map((r) => { return r.id; }), ["r1"]);
});

test("deleting again after a newer edit restored an item records a new tombstone", () => {
  const storage = makeStorage();
  const made = createPersonalSetlist(storage, "Gig");
  applyDoc(storage, buildLocalDoc(storage, 100));
  const meta = readMeta(storage);
  meta.tomb.setlists[made.id] = 10; // an old deletion a later edit has outlived
  meta.snapshot.setlists[0].updatedAt = 50;
  storage.setItem("rj.sync.meta", JSON.stringify(meta));
  deletePersonalSetlist(storage, made.id);
  const doc = buildLocalDoc(storage, 200);
  assert.ok(doc.tomb.setlists[made.id] > 50);
});

test("a form recreated after its deletion synced gets a newer stamp than the tombstone", () => {
  const storage = makeStorage();
  const key = "rj.songForm.a.abc";
  storage.setItem(key, FORM);
  applyDoc(storage, buildLocalDoc(storage, 100));
  storage.removeItem(key);
  applyDoc(storage, buildLocalDoc(storage, 200));
  storage.setItem(key, FORM);
  const doc = buildLocalDoc(storage, 300);
  assert.equal(doc.forms.length, 1);
  assert.ok(doc.forms[0].at > doc.tomb.forms["a.abc"]);
});
