import { test } from "node:test";
import assert from "node:assert/strict";
import { createVaultEngine } from "./engine.js";
import { fakeServer, makeStorage } from "../../../../tests/helpers/sync-server.js";
import { connectedBands, forgetBand, isShared, listBands, readProfile, registerBand, renameBand, setDisplayName, setShared, unshareEverywhere, cleanName, bandSetlistStorage, listSharedSetlists, findSharedSetlistBand } from "./band-store.js";
import { bandCodec, mergeBandDocs, validateBandDoc, versionsOf, emptyBandDoc } from "./band-vault.js";
import {
  addSongToPersonalSetlist, createPersonalSetlist, deletePersonalSetlist, listPersonalSetlists, removeSongFromPersonalSetlist,
  renamePersonalSetlist,
} from "../setlists/setlists-store.js";
import { songFormPrefKey } from "../core/preferences.js";

const FILE = "a.abc";
const PANAMA = "panama.abc";
const FORM = JSON.stringify({ show: "mine", rows: [["1", "A A B A", "", ""]] });
const FORM_B = JSON.stringify({ show: "mine", rows: [["1", "A B", "", ""]] });

function form(at, raw) {
  return { file: FILE, author: "aa", raw, at };
}

// A device in the band space it knows locally as `id` (a device may know several).
function member(server, name, storage = makeStorage(), id = "b1") {
  const engine = createVaultEngine({ storage, fetchFn: server.fetchFn, baseUrl: "https://s.test", codec: bandCodec(id) });
  registerBand(storage, id, `Shared ${id}`);
  setDisplayName(storage, id, name);
  return { storage, engine, id };
}

function share(who, file, raw) {
  who.storage.setItem(songFormPrefKey(file), raw);
  setShared(who.storage, who.id, file, true);
}

test("a shared version reaches a bandmate, with its author's name", async () => {
  const server = fakeServer();
  const anna = member(server, "Anna · clarinet");
  const pieter = member(server, "Pieter");
  share(anna, PANAMA, FORM);
  const made = await anna.engine.connect();
  assert.equal(made.status, "ok");
  assert.equal((await pieter.engine.join(made.code)).status, "ok");
  const seen = versionsOf(pieter.storage, PANAMA);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "Anna · clarinet");
  assert.equal(seen[0].raw, FORM);
  // Pieter's own versions are not listed as someone else's.
  share(pieter, PANAMA, FORM_B);
  await pieter.engine.sync();
  await anna.engine.sync();
  assert.deepEqual(versionsOf(anna.storage, PANAMA).map((v) => { return v.name; }), ["Pieter"]);
  assert.equal(versionsOf(pieter.storage, PANAMA).length, 1);
});

test("editing a shared version updates it for the band; unsharing removes it", async () => {
  const server = fakeServer();
  const anna = member(server, "Anna");
  const pieter = member(server, "Pieter");
  share(anna, FILE, FORM);
  const { code } = await anna.engine.connect();
  await pieter.engine.join(code);
  anna.storage.setItem(songFormPrefKey(FILE), FORM_B);
  await anna.engine.sync();
  await pieter.engine.sync();
  assert.equal(versionsOf(pieter.storage, FILE)[0].raw, FORM_B);
  setShared(anna.storage, anna.id, FILE, false);
  await anna.engine.sync();
  await pieter.engine.sync();
  assert.equal(versionsOf(pieter.storage, FILE).length, 0);
  // A later share beats the old tombstone.
  setShared(anna.storage, anna.id, FILE, true);
  await anna.engine.sync();
  await pieter.engine.sync();
  assert.equal(versionsOf(pieter.storage, FILE).length, 1);
});

test("renaming shows everywhere; the same name on two members stays two authors", async () => {
  const server = fakeServer();
  const a = member(server, "Ben");
  const b = member(server, "Ben");
  const { code } = await a.engine.connect();
  await b.engine.join(code);
  await a.engine.sync();
  assert.notEqual(readProfile(a.storage, a.id).author, readProfile(b.storage, b.id).author);
  setDisplayName(b.storage, b.id, "Ben S.");
  await b.engine.sync();
  await a.engine.sync();
  share(b, "x.abc", FORM);
  await b.engine.sync();
  await a.engine.sync();
  assert.equal(versionsOf(a.storage, "x.abc")[0].name, "Ben S.");
});

test("a device can be in two band spaces: versions are listed from both, shared and forgotten one by one", async () => {
  const server = fakeServer();
  const jazz = member(server, "Anna");
  const swing = member(server, "Pieter");
  share(jazz, FILE, FORM);
  share(swing, FILE, FORM_B);
  const jazzCode = (await jazz.engine.connect()).code;
  const swingCode = (await swing.engine.connect()).code;
  // Ben joins both, under a different name in each.
  const ben = makeStorage();
  const inJazz = member(server, "Ben", ben, "j1");
  const inSwing = member(server, "Ben B.", ben, "s1");
  renameBand(ben, "j1", "Jazz band");
  renameBand(ben, "s1", "Swing band");
  assert.equal((await inJazz.engine.join(jazzCode)).status, "ok");
  assert.equal((await inSwing.engine.join(swingCode)).status, "ok");
  assert.notEqual(readProfile(ben, "j1").author, readProfile(ben, "s1").author);
  assert.deepEqual(connectedBands(ben).map((b) => { return b.label; }), ["Jazz band", "Swing band"]);
  const seen = versionsOf(ben, FILE);
  assert.deepEqual(seen.map((v) => { return `${v.name}@${v.bandLabel}`; }).sort(), ["Anna@Jazz band", "Pieter@Swing band"]);
  // Sharing goes to one band only.
  share(inJazz, PANAMA, FORM);
  assert.equal(isShared(ben, "j1", PANAMA), true);
  assert.equal(isShared(ben, "s1", PANAMA), false);
  await inJazz.engine.sync();
  await inSwing.engine.sync();
  await jazz.engine.sync();
  await swing.engine.sync();
  assert.equal(versionsOf(jazz.storage, PANAMA).length, 1);
  assert.equal(versionsOf(swing.storage, PANAMA).length, 0);
  // Removing a form unshares it everywhere; leaving one band keeps the other.
  unshareEverywhere(ben, PANAMA);
  assert.equal(isShared(ben, "j1", PANAMA), false);
  inJazz.engine.disconnect();
  forgetBand(ben, "j1");
  assert.deepEqual(listBands(ben).map((b) => { return b.id; }), ["s1"]);
  assert.deepEqual(versionsOf(ben, FILE).map((v) => { return v.name; }), ["Pieter"]);
});

test("the single band space an earlier build kept moves under an id", () => {
  const storage = makeStorage();
  storage.setItem("rj.band.code", "ABCD");
  storage.setItem("rj.band.profile", JSON.stringify({ author: "aa", name: "Anna", at: 1 }));
  storage.setItem("rj.band.shared", JSON.stringify({ "a.abc": true }));
  const [band] = listBands(storage);
  assert.equal(band.label, "My Band");
  assert.equal(storage.getItem("rj.band.code"), null);
  assert.equal(storage.getItem(`rj.band.${band.id}.code`), "ABCD");
  assert.equal(readProfile(storage, band.id).name, "Anna");
  assert.equal(isShared(storage, band.id, "a.abc"), true);
  assert.equal(listBands(storage).length, 1); // only once
  assert.deepEqual(listBands(makeStorage()), []);
});

test("the merge is symmetric and repeatable", () => {
  const a = { ...emptyBandDoc(), device: "d1", versions: [form(5, FORM)], members: [{ author: "aa", name: "A", at: 1 }] };
  const b = { ...emptyBandDoc(), device: "d2", versions: [form(9, FORM_B)], tomb: { versions: {} } };
  const ab = mergeBandDocs(a, b, 10);
  const ba = mergeBandDocs(b, a, 10);
  assert.deepEqual(ab.versions, ba.versions);
  assert.deepEqual(ab.members, ba.members);
  assert.equal(ab.versions[0].raw, FORM_B);
  assert.deepEqual(mergeBandDocs(ab, ab, 10).versions, ab.versions);
  const gone = { ...emptyBandDoc(), device: "d3", tomb: { versions: { "a.abc/aa": 20 } } };
  assert.equal(mergeBandDocs(ab, gone, 25).versions.length, 0);
});

test("a downloaded document is validated: bad versions, files and names are dropped", () => {
  const checked = validateBandDoc({
    format: 1,
    device: "d",
    members: [{ author: "ok", name: "A\u0000\n  B" }, { author: "bad id!", name: "x" }, "junk"],
    versions: [
      { file: "../evil.abc", author: "ok", raw: FORM, at: 1 },
      { file: FILE, author: "ok", raw: "not json", at: 1 },
      { file: FILE, author: "ok", raw: FORM, at: 1 },
      { file: FILE, author: "ok", raw: FORM_B, at: 2 },
    ],
    tomb: { versions: { "b.abc/ok": 3, "no-slash": 4, "../x.abc/ok": 5 } },
    future: "kept",
  });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.doc.members.map((m) => { return m.name; }), ["A B"]);
  assert.equal(checked.doc.versions.length, 1);
  assert.deepEqual(Object.keys(checked.doc.tomb.versions), ["b.abc/ok"]);
  assert.equal(checked.doc.future, "kept");
  assert.deepEqual(validateBandDoc({ format: 3 }), { ok: false, newer: true });
  assert.deepEqual(validateBandDoc("x"), { ok: false, newer: false });
  assert.equal(cleanName(" a ".repeat(40)).length <= 40, true);
});

// ---- shared setlists -------------------------------------------------------

const shared = (who) => { return bandSetlistStorage(who.storage, who.id); };
const names = (who) => { return listSharedSetlists(who.storage, who.id).map((e) => { return e.name; }); };

test("a shared setlist is created in the space, reaches a bandmate and stays out of the personal list", async () => {
  const server = fakeServer();
  const anna = member(server, "Anna");
  const pieter = member(server, "Pieter");
  const list = createPersonalSetlist(shared(anna), "Gig");
  addSongToPersonalSetlist(shared(anna), list.id, { file: "a.abc" });
  const { code } = await anna.engine.connect();
  assert.equal((await pieter.engine.join(code)).status, "ok");
  assert.deepEqual(names(pieter), ["Gig"]);
  assert.equal(listSharedSetlists(pieter.storage, pieter.id)[0].songs[0].file, "a.abc");
  assert.equal(listPersonalSetlists(pieter.storage).length, 0);
  assert.equal(findSharedSetlistBand(pieter.storage, list.id), pieter.id);
  assert.equal(findSharedSetlistBand(pieter.storage, "nope"), null);
});

test("two members edit a shared setlist: rows added on both sides, a rename and a delete all merge", async () => {
  const server = fakeServer();
  const anna = member(server, "Anna");
  const pieter = member(server, "Pieter");
  const list = createPersonalSetlist(shared(anna), "Gig");
  const { code } = await anna.engine.connect();
  await pieter.engine.join(code);
  addSongToPersonalSetlist(shared(anna), list.id, { file: "a.abc" });
  addSongToPersonalSetlist(shared(pieter), list.id, { file: "b.abc" });
  await anna.engine.sync();
  await pieter.engine.sync();
  await anna.engine.sync();
  const files = (who) => { return listSharedSetlists(who.storage, who.id)[0].songs.map((r) => { return r.file; }).sort(); };
  assert.deepEqual(files(anna), ["a.abc", "b.abc"]);
  assert.deepEqual(files(pieter), ["a.abc", "b.abc"]);
  renamePersonalSetlist(shared(pieter), list.id, "Saturday");
  removeSongFromPersonalSetlist(shared(anna), list.id, 0);
  await pieter.engine.sync();
  await anna.engine.sync();
  await pieter.engine.sync();
  assert.deepEqual(names(anna), ["Saturday"]);
  assert.equal(listSharedSetlists(pieter.storage, pieter.id)[0].songs.length, 1);
  deletePersonalSetlist(shared(anna), list.id);
  await anna.engine.sync();
  await pieter.engine.sync();
  assert.deepEqual(names(pieter), []);
});

test("shared setlists are kept per space", async () => {
  const server = fakeServer();
  const anna = member(server, "Anna", makeStorage(), "b1");
  createPersonalSetlist(shared(anna), "One");
  const second = member(server, "Anna", anna.storage, "b2");
  createPersonalSetlist(shared(second), "Two");
  assert.deepEqual(names(anna), ["One"]);
  assert.deepEqual(names(second), ["Two"]);
});

test("leaving a space keeps its setlists as personal ones", () => {
  const server = fakeServer();
  const anna = member(server, "Anna");
  createPersonalSetlist(shared(anna), "Gig");
  forgetBand(anna.storage, anna.id);
  assert.deepEqual(listSharedSetlists(anna.storage, anna.id), []);
  assert.deepEqual(listPersonalSetlists(anna.storage).map((e) => { return e.name; }), ["Gig"]);
});

test("a downloaded document's setlists are validated like the personal vault's", () => {
  const good = { id: "s1", name: "Gig", desc: "", songs: [{ id: "r1", file: "a.abc", updatedAt: 1 }], metaAt: 1, orderAt: 1, updatedAt: 1 };
  const bad = { id: "s2", name: "Bad", desc: "", songs: [{ id: "r1", file: "../x.abc", updatedAt: 1 }] };
  const checked = validateBandDoc({
    format: 2, device: "d", members: [], versions: [], setlists: [good, bad, "x"], tomb: { setlists: { s9: 5 }, rows: { "s1/r9": 6 } },
  });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.doc.setlists.map((e) => { return [e.id, e.songs.length]; }), [["s1", 1], ["s2", 0]]);
  assert.deepEqual(checked.doc.tomb.setlists, { s9: 5 });
  assert.deepEqual(checked.doc.tomb.rows, { "s1/r9": 6 });
  // A format-1 document (before shared setlists) still reads.
  assert.deepEqual(validateBandDoc({ format: 1, members: [], versions: [] }).doc.setlists, []);
});

test("a personal vault's document isn't accepted as a band's", () => {
  assert.equal(validateBandDoc({ format: 1, setlists: [], forms: {} }).ok, false);
  assert.equal(validateBandDoc({ format: 1, members: [], versions: [] }).ok, true);
});

test("leaving keeps everything when a setlist can't be copied, and a failed join drops its data", () => {
  const storage = makeStorage();
  registerBand(storage, "b1", "Band");
  const shared = bandSetlistStorage(storage, "b1");
  createPersonalSetlist(shared, "Gig");
  const realSet = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === "rj.setlists.v1") throw new Error("full");
    realSet.call(storage, key, value);
  };
  assert.equal(forgetBand(storage, "b1"), false);
  assert.equal(listBands(storage).length, 1);
  assert.equal(listSharedSetlists(storage, "b1").length, 1);
  storage.setItem = realSet;
  assert.equal(forgetBand(storage, "b1", { keepSetlists: false }), true);
  assert.equal(listPersonalSetlists(storage).length, 0);
  assert.equal(listBands(storage).length, 0);
});

test("a leave that fails after one copy succeeded doesn't duplicate it on retry", () => {
  const storage = makeStorage();
  registerBand(storage, "b1", "Band");
  const shared = bandSetlistStorage(storage, "b1");
  createPersonalSetlist(shared, "One");
  createPersonalSetlist(shared, "Two");
  const realSet = storage.setItem;
  let personalWrites = 0;
  storage.setItem = (key, value) => {
    if (key === "rj.setlists.v1") {
      personalWrites += 1;
      if (personalWrites === 2) throw new Error("full"); // the second copy fails
    }
    realSet.call(storage, key, value);
  };
  assert.equal(forgetBand(storage, "b1"), false);
  storage.setItem = realSet;
  assert.equal(forgetBand(storage, "b1"), true);
  assert.deepEqual(listPersonalSetlists(storage).map((e) => { return e.name; }).sort(), ["One", "Two"]);
});
