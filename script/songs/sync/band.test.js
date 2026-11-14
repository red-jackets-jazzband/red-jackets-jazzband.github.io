import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx, memoryStorage } from "../../../../tests/helpers/ctx.js";
import { fakeServer } from "../../../../tests/helpers/sync-server.js";
import { createBand } from "./band.js";
import { bandSetlistStorage, isShared, listBands, registerBand, setShared } from "../../lib/sync/band-store.js";
import { versionsOf } from "../../lib/sync/band-vault.js";
import { applyLocalSpaces, readLocalSpaces } from "../../lib/sync/band-spaces.js";
import { readMeta } from "../../lib/sync/clock.js";
import { createPersonalSetlist, listPersonalSetlists } from "../../lib/setlists/setlists-store.js";
import { songFormPrefKey } from "../../lib/core/preferences.js";

const FILE = "a.abc";
const FORM = JSON.stringify({ show: "mine", rows: [["1", "A A B A", "", ""]] });

function build(storage) {
  const ctx = makeCtx({ storage: () => storage });
  ctx.songForm = { refresh: () => {} };
  ctx.band = createBand(ctx);
  return ctx;
}

function click(id) {
  document.getElementById(id).click();
}

function setFetch(fn) {
  window.fetch = fn;
}

const tick = () => { return new Promise((resolve) => { setTimeout(resolve, 30); }); };

test("while the band space is off nothing is requested, however much is edited or shown", async () => {
  mountPage();
  const calls = [];
  const realFetch = window.fetch;
  setFetch((...args) => { calls.push(args); return Promise.reject(new Error("no network in test")); });
  try {
    const ctx = build(memoryStorage());
    await ctx.band.init();
    window.dispatchEvent(new window.Event("online"));
    document.dispatchEvent(new window.Event("visibilitychange"));
    await tick();
    assert.deepEqual(calls, []);
    assert.equal(ctx.band.isConnected(), false);
  } finally {
    setFetch(realFetch);
  }
});

test("starting needs a name; then the dialog starts a band space and a second device joins it", async () => {
  mountPage();
  const server = fakeServer();
  const realFetch = window.fetch;
  setFetch(server.fetchFn);
  try {
    const anna = memoryStorage();
    const ctxA = build(anna);
    await ctxA.band.init();
    click("bandConnect");
    await tick();
    assert.equal(ctxA.band.isConnected(), false);
    assert.match(document.getElementById("bandStatus").textContent, /name/i);

    document.getElementById("bandName").value = "Anna";
    click("bandConnect");
    await tick();
    assert.equal(ctxA.band.isConnected(), true);
    assert.equal(document.getElementById("bandBox").hidden, false);
    const code = document.getElementById("bandCode").textContent;
    assert.ok(code.length > 10);
    // Anna shares a form with the band, and the next sync sends it.
    anna.setItem(songFormPrefKey(FILE), FORM);
    setShared(anna, listBands(anna)[0].id, FILE, true);
    click("bandNow");
    await tick();

    const pieter = memoryStorage();
    mountPage();
    setFetch(server.fetchFn);
    const ctxP = build(pieter);
    await ctxP.band.init();
    document.getElementById("bandName").value = "Pieter";
    document.getElementById("bandCodeInput").value = code;
    click("bandJoin");
    await tick();
    assert.equal(ctxP.band.isConnected(), true, document.getElementById("bandStatus").textContent);
    assert.equal(versionsOf(pieter, FILE)[0].name, "Anna");
    assert.equal(isShared(pieter, listBands(pieter)[0].id, FILE), false);

    click("bandLeave");
    assert.equal(ctxP.band.isConnected(), false);
    assert.equal(versionsOf(pieter, FILE).length, 0);
  } finally {
    setFetch(realFetch);
  }
});

test("the dialog's tabs switch between the devices and the band space", async () => {
  mountPage();
  const ctx = build(memoryStorage());
  await ctx.band.init();
  const hidden = (id) => { return document.getElementById(id).hidden; };
  assert.equal(hidden("syncPanelBand"), true);
  click("syncTabBand");
  assert.equal(hidden("syncPanelBand"), false);
  assert.equal(hidden("syncPanelDevices"), true);
  assert.equal(document.getElementById("syncTabBand").getAttribute("aria-pressed"), "true");
  click("syncTabDevices");
  assert.equal(hidden("syncPanelDevices"), false);
  assert.equal(hidden("syncPanelBand"), true);
});

test("a band space shows a QR and shares a #band= link by mail, WhatsApp and copy", async () => {
  mountPage();
  const server = fakeServer();
  const realFetch = window.fetch;
  setFetch(server.fetchFn);
  const opened = [];
  window.open = (url) => { opened.push(url); };
  const drawn = [];
  globalThis.qrcode = () => {
    return { addData: (text) => { drawn.push(text); }, make: () => {}, getModuleCount: () => { return 2; }, isDark: (r, c) => { return r === c; } };
  };
  try {
    const ctx = build(memoryStorage());
    await ctx.band.init();
    document.getElementById("bandName").value = "Anna";
    click("bandConnect");
    await tick();
    await tick();
    assert.match(drawn[0], /#band=[A-Z0-9-]+$/);
    assert.notEqual(document.querySelector("#bandQr path"), null);
    click("bandWhatsapp");
    assert.match(decodeURIComponent(opened[0]), /^https:\/\/wa\.me\/\?text=.*#band=/);
    assert.equal(document.getElementById("bandShare").hidden, true); // jsdom has no navigator.share
  } finally {
    delete globalThis.qrcode;
    setFetch(realFetch);
  }
});

test("opening a #band= link takes the code out of the address bar and fills the join field", async () => {
  mountPage();
  window.history.replaceState(null, "", "/songs/#s=a&band=RJ7K-Q2MD");
  const ctx = build(memoryStorage());
  let opened = 0;
  ctx.sync = { open: () => { opened += 1; } };
  await ctx.band.init();
  assert.equal(document.getElementById("bandCodeInput").value, "RJ7K-Q2MD");
  assert.equal(window.location.hash, "#s=a");
  assert.equal(opened, 1);
  assert.equal(document.getElementById("syncPanelBand").hidden, false);
  assert.match(document.getElementById("bandStatus").textContent, /name/i);
});

// Starts a band space on `server` through the dialog of `ctx`; returns its code.
async function startBand(name) {
  document.getElementById("bandName").value = name;
  click("bandConnect");
  await tick();
  return document.getElementById("bandCode").textContent;
}

test("a second band space: chips switch between them, each keeps its own name and label, and leaving one keeps the other", async () => {
  mountPage();
  const server = fakeServer();
  const realFetch = window.fetch;
  setFetch(server.fetchFn);
  try {
    const storage = memoryStorage();
    const ctx = build(storage);
    await ctx.band.init();
    const first = await startBand("Ben");
    const chips = () => { return [...document.querySelectorAll("#bandTabs .rj-band-chip[data-band]")]; };
    assert.deepEqual(chips().map((c) => { return c.textContent; }), ["My Band"]);
    document.getElementById("bandLabel").value = "Jazz band";
    document.getElementById("bandLabel").dispatchEvent(new window.Event("change"));
    assert.deepEqual(chips().map((c) => { return c.textContent; }), ["Jazz band"]);

    // "+" shows the start / join form again, with nothing of the first band in it.
    click("bandAdd");
    assert.equal(document.getElementById("bandSetup").hidden, false);
    assert.equal(document.getElementById("bandBox").hidden, true);
    assert.equal(document.getElementById("bandName").value, "");
    // Joining a band space already joined just shows it.
    document.getElementById("bandCodeInput").value = first;
    click("bandJoin");
    await tick();
    assert.equal(listBands(storage).length, 1);
    assert.equal(document.getElementById("bandBox").hidden, false);

    click("bandAdd");
    const second = await startBand("Ben B.");
    assert.notEqual(second, first);
    assert.equal(listBands(storage).length, 2);
    assert.deepEqual(chips().map((c) => { return c.textContent; }), ["Jazz band", "My Band 2"]);
    assert.equal(document.getElementById("bandCode").textContent, second);
    assert.equal(document.getElementById("bandName").value, "Ben B.");

    chips()[0].click();
    assert.equal(document.getElementById("bandCode").textContent, first);
    assert.equal(document.getElementById("bandName").value, "Ben");

    click("bandLeave");
    assert.equal(listBands(storage).length, 1);
    assert.equal(document.getElementById("bandCode").textContent, second);
    assert.equal(ctx.band.isConnected(), true);
  } finally {
    setFetch(realFetch);
  }
});

test("a failed join leaves nothing behind", async () => {
  mountPage();
  const server = fakeServer();
  const realFetch = window.fetch;
  setFetch(server.fetchFn);
  try {
    const storage = memoryStorage();
    const ctx = build(storage);
    await ctx.band.init();
    document.getElementById("bandName").value = "Ben";
    document.getElementById("bandCodeInput").value = "AAAA-AAAA-AAAA-AAAA";
    click("bandJoin");
    await tick();
    assert.equal(ctx.band.isConnected(), false);
    assert.deepEqual(listBands(storage), []);
    assert.equal(document.getElementById("bandSetup").hidden, false);
    assert.notEqual(document.getElementById("bandStatus").textContent, "");
  } finally {
    setFetch(realFetch);
  }
});

test("a space left listed without its code (a failed keep) is dropped again on the next start, keeping its setlists", async () => {
  mountPage();
  const storage = memoryStorage();
  registerBand(storage, "b1", "Band"); // no code: the server copy was deleted
  createPersonalSetlist(bandSetlistStorage(storage, "b1"), "Gig");
  const ctx = build(storage);
  await ctx.band.init();
  assert.equal(listBands(storage).length, 0);
  assert.deepEqual(listPersonalSetlists(storage).map((e) => { return e.name; }), ["Gig"]);
});

test("refresh: a space the personal sync brought in is synced (its join) and shown; one taken away goes", async () => {
  mountPage();
  const server = fakeServer();
  const realFetch = window.fetch;
  setFetch(server.fetchFn);
  try {
    const phone = memoryStorage();
    const ctxPhone = build(phone);
    await ctxPhone.band.init();
    document.getElementById("bandName").value = "Anna";
    click("bandConnect");
    await tick();
    const entry = readLocalSpaces(phone, readMeta(phone))[0];

    // What the personal sync does on the laptop when the phone's document arrives.
    mountPage();
    setFetch(server.fetchFn);
    const laptop = memoryStorage();
    const ctxLaptop = build(laptop);
    await ctxLaptop.band.init();
    assert.equal(ctxLaptop.band.isConnected(), false);
    applyLocalSpaces(laptop, [entry], readMeta(laptop));
    ctxLaptop.band.refresh();
    await tick();
    assert.equal(ctxLaptop.band.isConnected(), true);
    assert.equal(document.getElementById("bandBox").hidden, false);
    assert.equal(document.getElementById("bandName").value, "Anna");
    assert.ok(laptop.getItem(`rj.band.${listBands(laptop)[0].id}.doc`), "its first sync ran");

    applyLocalSpaces(laptop, [], readMeta(laptop));
    ctxLaptop.band.refresh();
    assert.equal(ctxLaptop.band.isConnected(), false);
    assert.equal(document.getElementById("bandBox").hidden, true);
  } finally {
    setFetch(realFetch);
  }
});
