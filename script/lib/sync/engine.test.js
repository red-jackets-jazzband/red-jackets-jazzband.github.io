import { test } from "node:test";
import assert from "node:assert/strict";
import { createSyncEngine, CODE_KEY } from "./engine.js";
import { createPersonalSetlist, addSongToPersonalSetlist, listPersonalSetlists, renamePersonalSetlist } from "../setlists/setlists-store.js";

function makeStorage() {
  const data = {};
  return {
    get length() { return Object.keys(data).length; },
    key: (i) => { return Object.keys(data)[i] ?? null; },
    getItem: (k) => { return Object.hasOwn(data, k) ? data[k] : null; },
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

// An in-memory vault server speaking the same protocol as workers/sync.
function fakeServer() {
  const vaults = {};
  const gone = {};
  const fetchFn = async (url, init) => {
    const id = url.split("/").pop();
    const json = (body, status) => { return new Response(JSON.stringify(body), { status }); };
    if (gone[id]) return json({}, 410);
    if (init.method === "GET") {
      const v = vaults[id];
      if (!v) return json({}, 404);
      if (init.headers && init.headers["If-None-Match"] === `"${v.version}"`) return new Response(null, { status: 304 });
      return json(v, 200);
    }
    if (init.method === "DELETE") {
      delete vaults[id];
      gone[id] = true;
      return new Response(null, { status: 204 });
    }
    const { expected, blob } = JSON.parse(init.body);
    const v = vaults[id];
    if (!v && expected !== 0) return json({}, 404);
    if (v && v.version !== expected) return json(v, 409);
    vaults[id] = { version: (v ? v.version : 0) + 1, blob };
    return json({ version: vaults[id].version }, 200);
  };
  return { fetchFn, vaults, gone };
}

function device(server, fetchFn) {
  const storage = makeStorage();
  return { storage, engine: createSyncEngine({ storage, fetchFn: fetchFn || server.fetchFn, baseUrl: "https://s.test" }) };
}

test("connect on one device, join on another, edits travel both ways", async () => {
  const server = fakeServer();
  const phone = device(server);
  const laptop = device(server);
  const made = createPersonalSetlist(phone.storage, "Gig");
  addSongToPersonalSetlist(phone.storage, made.id, { file: "a.abc", key: "" });
  const connected = await phone.engine.connect();
  assert.equal(connected.status, "ok");
  assert.equal(Object.keys(server.vaults).length, 1);

  const joined = await laptop.engine.join(connected.code.toLowerCase());
  assert.equal(joined.status, "ok");
  assert.equal(listPersonalSetlists(laptop.storage)[0].songs[0].file, "a.abc");
  assert.equal(laptop.storage.getItem(CODE_KEY), connected.code.replace(/-/g, ""));

  renamePersonalSetlist(laptop.storage, made.id, "Gig 2");
  assert.equal((await laptop.engine.sync()).status, "ok");
  assert.equal((await phone.engine.sync()).status, "ok");
  assert.equal(listPersonalSetlists(phone.storage)[0].name, "Gig 2");
});

test("the server holds ciphertext only", async () => {
  const server = fakeServer();
  const phone = device(server);
  createPersonalSetlist(phone.storage, "Secret name");
  await phone.engine.connect();
  assert.ok(!JSON.stringify(server.vaults).includes("Secret name"));
});

test("join with an unknown or mistyped code creates nothing", async () => {
  const server = fakeServer();
  const other = device(server);
  const code = (await device(server).engine.connect()).code; // a real vault, not ours
  assert.equal((await other.engine.join("AAAA-AAAA")).status, "badCode");
  const unknown = (await (async () => { const d = device(fakeServer()); return d.engine.join(code); })());
  assert.equal(unknown.status, "notFound");
  assert.equal(other.storage.getItem(CODE_KEY), null);
  assert.equal(Object.keys(server.vaults).length, 1);
});

test("offline leaves everything as it was", async () => {
  const server = fakeServer();
  const phone = device(server);
  await phone.engine.connect();
  const offline = createSyncEngine({ storage: phone.storage, fetchFn: async () => { throw new Error("down"); }, baseUrl: "https://s.test" });
  renamePersonalSetlist(phone.storage, createPersonalSetlist(phone.storage, "x").id, "y");
  assert.equal((await offline.sync()).status, "offline");
  assert.ok(phone.engine.code());
});

function names(d) {
  return listPersonalSetlists(d.storage).map((s) => { return s.name; }).sort((a, b) => { return a.localeCompare(b); });
}

test("a conflict is merged and retried", async () => {
  const server = fakeServer();
  const phone = device(server);
  const laptop = device(server);
  const connected = await phone.engine.connect();
  await laptop.engine.join(connected.code);
  createPersonalSetlist(phone.storage, "From phone");
  createPersonalSetlist(laptop.storage, "From laptop");
  assert.equal((await phone.engine.sync()).status, "ok");
  assert.equal((await laptop.engine.sync()).status, "ok"); // laptop's version is stale: 409, merge, retry
  assert.equal((await phone.engine.sync()).status, "ok");
  assert.deepEqual(names(phone), ["From laptop", "From phone"]);
  assert.deepEqual(names(laptop), names(phone));
});

test("an unchanged vault answers 304 and still pushes local edits", async () => {
  const server = fakeServer();
  const phone = device(server);
  await phone.engine.connect();
  await phone.engine.sync();
  createPersonalSetlist(phone.storage, "New");
  assert.equal((await phone.engine.sync()).status, "ok");
  assert.equal(Object.values(server.vaults)[0].version, 2);
});

test("a cycle with nothing to send does not save, so devices cannot answer each other forever", async () => {
  const server = fakeServer();
  const phone = device(server);
  const laptop = device(server);
  createPersonalSetlist(phone.storage, "Gig");
  const connected = await phone.engine.connect();
  await laptop.engine.join(connected.code);
  const version = () => { return Object.values(server.vaults)[0].version; };
  const settled = version();
  for (let i = 0; i < 3; i++) {
    await phone.engine.sync();
    await laptop.engine.sync();
  }
  assert.equal(version(), settled);
  assert.equal(laptop.engine.knownVersion(), settled);
});

test("an upload that failed is retried even though nothing changed since", async () => {
  const server = fakeServer();
  const phone = device(server);
  await phone.engine.connect();
  createPersonalSetlist(phone.storage, "Offline edit");
  let down = true;
  const flaky = createSyncEngine({
    storage: phone.storage,
    fetchFn: async (url, init) => { return init.method === "PUT" && down ? new Response("{}", { status: 500 }) : server.fetchFn(url, init); },
    baseUrl: "https://s.test",
  });
  assert.equal((await flaky.sync()).status, "error");
  down = false;
  assert.equal((await flaky.sync()).status, "ok");
  assert.equal(Object.values(server.vaults)[0].version, 2);
});

test("a deleted vault disconnects the device; delete server copy and new code", async () => {
  const server = fakeServer();
  const phone = device(server);
  const laptop = device(server);
  const connected = await phone.engine.connect();
  await laptop.engine.join(connected.code);
  assert.equal((await phone.engine.newCode()).status, "ok");
  assert.notEqual(phone.engine.code(), laptop.engine.code());
  assert.equal((await laptop.engine.sync()).status, "gone");
  assert.equal(laptop.engine.code(), null);
  assert.equal((await phone.engine.deleteServerCopy()).status, "ok");
  assert.equal(phone.engine.code(), null);
  assert.equal((await phone.engine.sync()).status, "disconnected");
});

test("too much data is reported before any upload", async () => {
  const server = fakeServer();
  const phone = device(server);
  const made = createPersonalSetlist(phone.storage, "Big");
  for (let i = 0; i < 400; i++) addSongToPersonalSetlist(phone.storage, made.id, { file: `song_${i}.abc`, key: "", note: "n".repeat(300) });
  let calls = 0;
  const counting = device(server, async (...args) => { calls++; return server.fetchFn(...args); });
  counting.storage.setItem("rj.setlists.v1", phone.storage.getItem("rj.setlists.v1"));
  assert.equal((await counting.engine.connect()).status, "tooLarge");
  assert.equal(calls, 0);
});

test("liveUrl points at the vault's socket, and is null when not connected", async () => {
  const server = fakeServer();
  const phone = device(server);
  assert.equal(await phone.engine.liveUrl(), null);
  await phone.engine.connect();
  const url = await phone.engine.liveUrl();
  assert.match(url, /^wss:\/\/s\.test\/v1\/vault\/[0-9a-f]{64}\/live$/);
  assert.equal(phone.engine.knownVersion(), 1);
});

test("a new code keeps an edit another device made last, and retries a failed delete", async () => {
  const server = fakeServer();
  let failDelete = true;
  const phone = device(server, async (url, init) => {
    return init.method === "DELETE" && failDelete ? new Response("{}", { status: 500 }) : server.fetchFn(url, init);
  });
  const laptop = device(server);
  const connected = await phone.engine.connect();
  await laptop.engine.join(connected.code);
  createPersonalSetlist(laptop.storage, "Laptop edit");
  await laptop.engine.sync(); // the phone hasn't seen this yet
  const result = await phone.engine.newCode();
  assert.equal(result.status, "oldKept");
  assert.ok(names(phone).includes("Laptop edit"));
  const newCode = phone.engine.code();
  assert.notEqual(newCode, connected.code.replace(/-/g, ""));
  assert.equal(Object.keys(server.vaults).length, 2); // the old one is still there
  failDelete = false;
  assert.equal((await phone.engine.sync()).status, "ok");
  assert.equal(Object.keys(server.vaults).length, 1);
});
