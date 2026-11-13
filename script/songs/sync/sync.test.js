import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx, memoryStorage } from "../../../../tests/helpers/ctx.js";
import { createSync } from "./sync.js";
import { createPersonalSetlist } from "../../lib/setlists/setlists-store.js";

function setFetch(fn) {
  window.fetch = fn;
}

// A one-vault server speaking the worker's protocol; `gets` records each GET's id.
function fakeVault(gets) {
  const vaults = {};
  return async (url, init) => {
    const id = url.split("/").pop();
    const json = (body, status) => { return new Response(JSON.stringify(body), { status }); };
    if (init.method === "GET") { gets.push(id); return vaults[id] ? json(vaults[id], 200) : json({}, 404); }
    const { blob } = JSON.parse(init.body);
    vaults[id] = { version: (vaults[id] ? vaults[id].version : 0) + 1, blob };
    return json({ version: vaults[id].version }, 200);
  };
}

function build(storage) {
  const ctx = makeCtx({ storage: () => storage });
  ctx.setlistHome = { render: () => {} };
  ctx.setlistView = { refreshOpenPersonal: () => {} };
  ctx.songForm = { refresh: () => {} };
  ctx.sync = createSync(ctx);
  return ctx;
}

test("while sync is off nothing is requested, however much is edited or shown", async () => {
  const page = mountPage();
  const calls = [];
  const realFetch = window.fetch;
  setFetch((...args) => { calls.push(args); return Promise.reject(new Error("no network in test")); });
  try {
    const storage = memoryStorage();
    const ctx = build(storage);
    await ctx.sync.init();
    createPersonalSetlist(storage, "Gig");
    window.dispatchEvent(new window.Event("online"));
    document.dispatchEvent(new window.Event("visibilitychange"));
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    assert.deepEqual(calls, []);
    assert.equal(ctx.sync.isConnected(), false);
  } finally {
    setFetch(realFetch);
    page.cleanup();
  }
});

test("the dialog opens, shows the connect form while off, and a bad code is reported", async () => {
  const page = mountPage();
  try {
    const ctx = build(memoryStorage());
    await ctx.sync.init();
    ctx.sync.open();
    assert.equal(document.getElementById("syncModal").hidden, false);
    assert.equal(document.getElementById("syncSetup").hidden, false);
    assert.equal(document.getElementById("syncCodeBox").hidden, true);
    document.getElementById("syncCodeInput").value = "AAAA-AAAA";
    document.getElementById("syncJoin").click();
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    assert.match(document.getElementById("syncStatus").textContent, /isn't right/);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    assert.equal(document.getElementById("syncModal").hidden, true);
  } finally {
    page.cleanup();
  }
});

test("a connected, visible tab opens the push channel and a newer pushed version triggers a pull", async () => {
  const page = mountPage();
  const realFetch = window.fetch;
  const RealSocket = window.WebSocket;
  const sockets = [];
  const gets = [];
  window.WebSocket = class { constructor(url) { this.url = url; sockets.push(this); } close() { this.closed = true; } };
  try {
    const storage = memoryStorage();
    setFetch(fakeVault(gets));
    const ctx = build(storage);
    await ctx.sync.init();
    document.getElementById("syncConnect").click();
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    assert.equal(ctx.sync.isConnected(), true);
    assert.equal(sockets.length, 1);
    assert.match(sockets[0].url, /^wss:\/\/.*\/live$/);
    sockets[0].onmessage({ data: '{"version":1}' }); // our own save: nothing newer
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    assert.deepEqual(gets, []);
    sockets[0].onmessage({ data: '{"version":9}' });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    assert.equal(gets.length, 1);
    document.getElementById("syncDisconnect").click(); // stops the lease timer and the channel
    assert.equal(sockets[0].closed, true);
  } finally {
    window.WebSocket = RealSocket; // eslint-disable-line require-atomic-updates -- restoring a global after awaits is the point
    setFetch(realFetch);
    page.cleanup();
  }
});

test("a pairing link is taken out of the address bar and joins after confirmation", async () => {
  const page = mountPage();
  const realFetch = window.fetch;
  const realConfirm = window.confirm;
  const asked = [];
  try {
    window.history.replaceState(null, "", "#s=basin_street&sync=AAAA-AAAA");
    window.confirm = (text) => { asked.push(text); return true; };
    setFetch(() => { return Promise.reject(new Error("no network in test")); });
    const ctx = build(memoryStorage());
    await ctx.sync.init();
    assert.equal(window.location.hash, "#s=basin_street");
    assert.equal(asked.length, 1);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    assert.match(document.getElementById("syncStatus").textContent, /isn't right/);
  } finally {
    window.confirm = realConfirm; // eslint-disable-line require-atomic-updates -- restoring a global
    setFetch(realFetch);
    window.history.replaceState(null, "", "#");
    page.cleanup();
  }
});

test("the QR button draws the pairing link as an SVG, and hides it again", async () => {
  const page = mountPage();
  const realFetch = window.fetch;
  const drawn = [];
  globalThis.qrcode = () => {
    return { addData: (text) => { drawn.push(text); }, make: () => {}, getModuleCount: () => { return 2; }, isDark: (r, c) => { return r === c; } };
  };
  try {
    setFetch(fakeVault([]));
    const ctx = build(memoryStorage());
    await ctx.sync.init();
    document.getElementById("syncConnect").click();
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const toggle = document.getElementById("syncQrToggle");
    toggle.click();
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    assert.equal(document.getElementById("syncQrBox").hidden, false);
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.match(drawn[0], /#sync=[A-Z0-9-]+$/);
    assert.equal(document.querySelector("#syncQr path").getAttribute("d"), "M4 4h1v1h-1zM5 5h1v1h-1z");
    toggle.click();
    assert.equal(document.getElementById("syncQrBox").hidden, true);
    document.getElementById("syncDisconnect").click();
  } finally {
    delete globalThis.qrcode;
    setFetch(realFetch);
    page.cleanup();
  }
});
