/*
   The shared spaces a device is in travel in its personal sync document, so
   the device's other devices join them too (lib/sync/band-spaces.js, doc.js).
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSyncEngine, createVaultEngine } from "./engine.js";
import { generateCode, parseCode } from "./crypto.js";
import { fakeServer, makeStorage } from "../../../../tests/helpers/sync-server.js";
import { MAX_BANDS, connectedBands, forgetBand, isShared, readProfile, registerBand, renameBand, setDisplayName, setShared, listSharedSetlists, bandSetlistStorage } from "./band-store.js";
import { bandCodec, versionsOf } from "./band-vault.js";
import { applyDoc, buildLocalDoc } from "./doc.js";
import { readMeta } from "./clock.js";
import { mergeDocs } from "./merge.js";
import { MAX_SPACES, validateDoc } from "./validate.js";
import { createPersonalSetlist, listPersonalSetlists } from "../setlists/setlists-store.js";
import { songFormPrefKey } from "../core/preferences.js";

const FORM = JSON.stringify({ show: "mine", rows: [["1", "A A B A", "", ""]] });

function device(server) {
  const storage = makeStorage();
  const url = "https://s.test";
  return {
    storage,
    personal: createSyncEngine({ storage, fetchFn: server.fetchFn, baseUrl: url }),
    bandEngine: (id) => { return createVaultEngine({ storage, fetchFn: server.fetchFn, baseUrl: url, codec: bandCodec(id) }); },
  };
}

// Starts a space on `who` as the band feature does: name, connect, then list it.
async function startSpace(who, id, name) {
  setDisplayName(who.storage, id, name);
  const result = await who.bandEngine(id).connect();
  registerBand(who.storage, id, "");
  return result.code;
}

async function pairDevices(server) {
  const phone = device(server);
  const laptop = device(server);
  const { code } = await phone.personal.connect();
  await laptop.personal.join(code);
  return { phone, laptop };
}

test("a space started on one device appears on the other, with the same code, name and author", async () => {
  const server = fakeServer();
  const { phone, laptop } = await pairDevices(server);
  const code = await startSpace(phone, "p1", "Anna · clarinet");
  renameBand(phone.storage, "p1", "The Jackets");

  assert.equal((await phone.personal.sync()).status, "ok");
  assert.equal((await laptop.personal.sync()).status, "ok");

  const [band] = connectedBands(laptop.storage);
  assert.equal(band.label, "The Jackets");
  assert.equal(laptop.storage.getItem(`rj.band.${band.id}.code`), code);
  assert.equal(readProfile(laptop.storage, band.id).name, "Anna · clarinet");
  assert.equal(readProfile(laptop.storage, band.id).author, readProfile(phone.storage, "p1").author);
});

test("the new device's own sync of the space is its join, and shared forms stay shared", async () => {
  const server = fakeServer();
  const { phone, laptop } = await pairDevices(server);
  phone.storage.setItem(songFormPrefKey("a.abc"), FORM);
  await startSpace(phone, "p1", "Anna");
  setShared(phone.storage, "p1", "a.abc", true);
  await phone.bandEngine("p1").sync();
  await phone.personal.sync();
  await laptop.personal.sync();

  const [band] = connectedBands(laptop.storage);
  assert.equal(isShared(laptop.storage, band.id, "a.abc"), true);
  assert.equal((await laptop.bandEngine(band.id).sync()).status, "ok");
  // Same author on both: the laptop must not take its own shared form for deleted.
  await laptop.bandEngine(band.id).sync();
  await phone.bandEngine("p1").sync();
  const bandmate = device(server);
  const other = bandmate.bandEngine("x1");
  setDisplayName(bandmate.storage, "x1", "Pieter");
  const joined = await other.join(await codeOf(phone, "p1"));
  assert.equal(joined.status, "ok");
  registerBand(bandmate.storage, "x1", "");
  assert.equal(versionsOf(bandmate.storage, "a.abc").length, 1);
});

async function codeOf(who, id) {
  return who.storage.getItem(`rj.band.${id}.code`);
}

test("leaving a space on one device takes it off the other, keeping its setlists once", async () => {
  const server = fakeServer();
  const { phone, laptop } = await pairDevices(server);
  await startSpace(phone, "p1", "Anna");
  createPersonalSetlist(bandSetlistStorage(phone.storage, "p1"), "Gig");
  await phone.bandEngine("p1").sync();
  await phone.personal.sync();
  await laptop.personal.sync();
  const [band] = connectedBands(laptop.storage);
  await laptop.bandEngine(band.id).sync();
  assert.equal(listSharedSetlists(laptop.storage, band.id).length, 1);

  assert.equal(forgetBand(phone.storage, "p1"), true); // the setlist is kept as a personal one
  await phone.personal.sync();
  await laptop.personal.sync();

  assert.deepEqual(connectedBands(laptop.storage), []);
  assert.deepEqual(connectedBands(phone.storage), []);
  assert.deepEqual(listPersonalSetlists(laptop.storage).map((e) => { return e.name; }), ["Gig"]);
  await phone.personal.sync(); // and a further cycle doesn't bring it back, or copy it twice
  await laptop.personal.sync();
  assert.deepEqual(connectedBands(laptop.storage), []);
  assert.equal(listPersonalSetlists(phone.storage).length, 1);
  assert.equal(listPersonalSetlists(laptop.storage).length, 1);
});

test("a rename and a new display name follow, the newer one winning", async () => {
  const server = fakeServer();
  const { phone, laptop } = await pairDevices(server);
  await startSpace(phone, "p1", "Anna");
  await phone.personal.sync();
  await laptop.personal.sync();
  const [band] = connectedBands(laptop.storage);

  renameBand(laptop.storage, band.id, "Brass");
  setDisplayName(laptop.storage, band.id, "Anna K.");
  await laptop.personal.sync();
  await phone.personal.sync();
  assert.equal(connectedBands(phone.storage)[0].label, "Brass");
  assert.equal(readProfile(phone.storage, "p1").name, "Anna K.");
});

test("joining the same space again after leaving it is newer than the leave", async () => {
  const server = fakeServer();
  const { phone, laptop } = await pairDevices(server);
  const code = await startSpace(phone, "p1", "Anna");
  await phone.personal.sync();
  await laptop.personal.sync();
  forgetBand(phone.storage, "p1");
  await phone.personal.sync();
  await laptop.personal.sync();
  assert.deepEqual(connectedBands(laptop.storage), []);

  phone.storage.setItem("rj.band.p2.code", code);
  setDisplayName(phone.storage, "p2", "Anna");
  registerBand(phone.storage, "p2", "Back");
  await phone.personal.sync();
  await laptop.personal.sync();
  assert.equal(connectedBands(laptop.storage)[0].label, "Back");
});

test("a device in the most spaces it can be skips more, and doesn't take that for a deletion", async () => {
  const server = fakeServer();
  const { phone, laptop } = await pairDevices(server);
  for (let n = 0; n < 8; n++) {
    await startSpace(laptop, `l${n}`, "Ben");
  }
  for (let n = 0; n < 2; n++) await startSpace(phone, `p${n}`, "Ben");
  await phone.personal.sync();
  await laptop.personal.sync();
  await phone.personal.sync();
  await laptop.personal.sync();
  assert.equal(connectedBands(laptop.storage).length, 8);
  assert.equal(connectedBands(phone.storage).length, 8);
});

test("a space entry is validated: a bad code, author or file is dropped, a good one kept as written", () => {
  const code = parseCode(generateCode());
  const good = { code, label: "x", name: "n", author: "ab12", at: 1, labelAt: 1, addedAt: 1, shared: ["a.abc", "../x.abc", "a.abc"], sharedAt: 1 };
  const checked = validateDoc({ format: 1, device: "d", setlists: [], forms: [], tomb: {}, spaces: [good, { ...good, code: "nope" }, { ...good, author: "../x" }, "x"] });
  assert.equal(checked.ok, true);
  assert.equal(checked.doc.spaces.length, 1);
  assert.equal(checked.doc.spaces[0].code, code);
  assert.deepEqual(checked.doc.spaces[0].shared, ["a.abc"]);
});

test("documents from before spaces existed merge as having none", () => {
  const old = { format: 1, device: "a", setlists: [], forms: [], tomb: { setlists: {}, rows: {}, forms: {} } };
  const merged = mergeDocs(old, validateDoc(old).doc);
  assert.deepEqual(merged.spaces, []);
  assert.deepEqual(buildLocalDoc(makeStorage()).spaces, []);
});

test("leaving and joining again before the next sync still beats another device's newer leave", async () => {
  const server = fakeServer();
  const { phone, laptop } = await pairDevices(server);
  const code = await startSpace(phone, "p1", "Anna");
  await phone.personal.sync();
  await laptop.personal.sync();

  forgetBand(laptop.storage, laptop.storage.getItem("rj.band.list") && connectedBands(laptop.storage)[0].id);
  await laptop.personal.sync(); // the leave is uploaded

  // The phone leaves and rejoins before it has seen that leave.
  forgetBand(phone.storage, "p1");
  phone.storage.setItem("rj.band.p2.code", code);
  setDisplayName(phone.storage, "p2", "Anna");
  registerBand(phone.storage, "p2", "Again");
  await phone.personal.sync();
  await laptop.personal.sync();

  assert.equal(connectedBands(phone.storage).length, 1);
  assert.equal(connectedBands(laptop.storage).length, 1);
});

test("received space stamps from a faster clock are observed, so a local edit is stamped above them", () => {
  const storage = makeStorage();
  const future = Date.now() + 10 * 24 * 60 * 60 * 1000;
  const entry = { code: parseCode(generateCode()), label: "x", name: "n", author: "ab12", at: 1, labelAt: future + 5, addedAt: future + 3, shared: [], sharedAt: future + 9 };
  applyDoc(storage, { format: 1, device: "d", setlists: [], forms: [], spaces: [entry], tomb: { setlists: {}, rows: {}, forms: {}, spaces: {} } });
  assert.ok(readMeta(storage).maxStamp >= future + 9);
  renameBand(storage, connectedBands(storage)[0].id, "Renamed");
  const edited = buildLocalDoc(storage, Date.now()).spaces[0];
  assert.ok(edited.labelAt > future + 9, "the rename is stamped above every received stamp");
});

test("validate.js's space cap is the band store's (the lower layer can't import it)", () => {
  assert.equal(MAX_SPACES, MAX_BANDS);
});
