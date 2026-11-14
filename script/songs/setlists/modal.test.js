import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx, memoryStorage } from "../../../../tests/helpers/ctx.js";
import { createPersonalSetlist, listPersonalSetlists } from "../../lib/setlists/setlists-store.js";
import { bandSetlistStorage, listSharedSetlists, registerBand } from "../../lib/sync/band-vault.js";
import { createSetlistModal } from "./modal.js";

const REMIX_BUTTON = '.rj-modal-choice[data-choice="remix"]';
const clickEvent = () => { return new window.Event("click"); };

function setup() {
  const page = mountPage();
  const storage = memoryStorage();
  const opened = [];
  const ctx = makeCtx({
    storage: () => storage,
    state: { setlistIndex: [{ name: "Spring Tour", file: "spring.txt" }] },
    setlistData: {
      loadBand: (file, cb) => cb({ name: "Spring Tour", desc: "", songs: [{ file: "x.abc", key: "" }] }),
      ensureSongsLoaded: (cb) => cb(),
    },
    setlistView: { openPersonal: (id) => opened.push(id), openShared: (band, id) => opened.push(`${band}:${id}`) },
  });
  const modal = createSetlistModal(ctx);
  modal.init();
  return { page, ctx, storage, modal, opened, cleanup: page.cleanup };
}

test("choice buttons toggle the active state and the contextual panels", () => {
  const { modal, cleanup } = setup();
  try {
    modal.open();
    const remixBtn = document.querySelector(REMIX_BUTTON);
    remixBtn.dispatchEvent(clickEvent());
    assert.ok(remixBtn.classList.contains("active"));
    assert.equal(document.getElementById("setlistModalRemix").hidden, false);
    assert.equal(document.getElementById("setlistModalUpload").hidden, true);
  } finally {
    cleanup();
  }
});

test("populated remix sources list the band setlists", () => {
  const { modal, cleanup } = setup();
  try {
    modal.open();
    assert.deepEqual(
      [...document.getElementById("setlistModalSource").options].map((o) => o.value),
      ["band:spring.txt"],
    );
  } finally {
    cleanup();
  }
});

test("Empty create makes a personal setlist and opens it", () => {
  const { modal, storage, opened, cleanup } = setup();
  try {
    modal.open();
    document.getElementById("setlistModalName").value = "Friday Gig";
    document.getElementById("setlistModalCreate").dispatchEvent(clickEvent());
    const mine = listPersonalSetlists(storage);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].name, "Friday Gig");
    assert.equal(opened[0], mine[0].id);
    assert.equal(document.getElementById("setlistModal").hidden, true);
  } finally {
    cleanup();
  }
});

test("Remix from a band setlist clones its songs into a new personal one", () => {
  const { modal, storage, cleanup } = setup();
  try {
    modal.open();
    document.querySelector(REMIX_BUTTON).dispatchEvent(clickEvent());
    document.getElementById("setlistModalName").value = "My Spring";
    document.getElementById("setlistModalCreate").dispatchEvent(clickEvent());
    const mine = listPersonalSetlists(storage);
    assert.equal(mine[0].name, "My Spring");
    assert.deepEqual(mine[0].songs.map((s) => s.file), ["x.abc"]);
  } finally {
    cleanup();
  }
});

test("Escape and backdrop click close the modal", () => {
  const { modal, cleanup } = setup();
  try {
    modal.open();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    assert.equal(document.getElementById("setlistModal").hidden, true);
    modal.open();
    document.getElementById("setlistModal").dispatchEvent(clickEvent());
    // a click whose target is the overlay itself closes it
    const overlay = document.getElementById("setlistModal");
    const evt = new window.Event("click", { bubbles: true });
    Object.defineProperty(evt, "target", { value: overlay });
    overlay.dispatchEvent(evt);
    assert.equal(overlay.hidden, true);
  } finally {
    cleanup();
  }
});

function joinSpace(storage, id, label) {
  registerBand(storage, id, label);
  storage.setItem(`rj.band.${id}.code`, "code");
}

test("opened for a shared space: names it, creates the setlist there and opens it as shared", () => {
  const { modal, storage, opened, cleanup } = setup();
  try {
    joinSpace(storage, "b1", "My Band");
    modal.open("b1");
    const note = document.getElementById("setlistModalTarget");
    assert.equal(note.hidden, false);
    assert.match(note.textContent, /My Band/);
    document.getElementById("setlistModalName").value = "Saturday";
    document.getElementById("setlistModalCreate").dispatchEvent(clickEvent());
    const shared = listSharedSetlists(storage, "b1");
    assert.deepEqual(shared.map((e) => e.name), ["Saturday"]);
    assert.equal(listPersonalSetlists(storage).length, 0);
    assert.equal(opened[0], `b1:${shared[0].id}`);
  } finally {
    cleanup();
  }
});

test("a personal open hides the shared note, and an unknown space falls back to personal", () => {
  const { modal, storage, cleanup } = setup();
  try {
    joinSpace(storage, "b1", "My Band");
    modal.open("gone");
    assert.equal(document.getElementById("setlistModalTarget").hidden, true);
    document.getElementById("setlistModalCreate").dispatchEvent(clickEvent());
    assert.equal(listPersonalSetlists(storage).length, 1);
    assert.equal(listSharedSetlists(storage, "b1").length, 0);
  } finally {
    cleanup();
  }
});

test("remix can start from a shared setlist, into a shared one or a personal one", () => {
  const { modal, storage, cleanup } = setup();
  try {
    joinSpace(storage, "b1", "My Band");
    const source = createPersonalSetlist(bandSetlistStorage(storage, "b1"), "Gig");
    modal.open();
    const select = document.getElementById("setlistModalSource");
    const option = [...select.options].find((o) => o.value === `shared:b1:${source.id}`);
    assert.ok(option);
    assert.equal(option.parentNode.label, "My Band");
    select.value = option.value;
    document.querySelector(REMIX_BUTTON).dispatchEvent(clickEvent());
    document.getElementById("setlistModalName").value = "Mine now";
    document.getElementById("setlistModalCreate").dispatchEvent(clickEvent());
    assert.deepEqual(listPersonalSetlists(storage).map((e) => e.name), ["Mine now"]);
    assert.equal(listSharedSetlists(storage, "b1").length, 1);
  } finally {
    cleanup();
  }
});

test("a remix that finishes after the modal was reopened elsewhere is dropped, not written to the new target", () => {
  const { ctx, modal, storage, opened, cleanup } = setup();
  try {
    joinSpace(storage, "b1", "My Band");
    let finish = null;
    ctx.setlistData.loadBand = (file, cb) => { finish = cb; };
    modal.open(null);
    document.querySelector(REMIX_BUTTON).dispatchEvent(clickEvent());
    document.getElementById("setlistModalSource").value = "band:spring.txt";
    document.getElementById("setlistModalCreate").dispatchEvent(clickEvent());
    modal.open("b1"); // reopened for a shared shelf before the fetch returned
    finish({ name: "Spring Tour", desc: "", songs: [] });
    assert.equal(listPersonalSetlists(storage).length, 0);
    assert.equal(listSharedSetlists(storage, "b1").length, 0);
    assert.deepEqual(opened, []);
  } finally {
    cleanup();
  }
});

test("a second creation still pending when the first one finishes is dropped", () => {
  const { ctx, modal, storage, cleanup } = setup();
  try {
    const pending = [];
    ctx.setlistData.loadBand = (file, cb) => { pending.push(cb); };
    modal.open(null);
    document.querySelector(REMIX_BUTTON).dispatchEvent(clickEvent());
    document.getElementById("setlistModalSource").value = "band:spring.txt";
    document.getElementById("setlistModalCreate").dispatchEvent(clickEvent());
    document.getElementById("setlistModalCreate").dispatchEvent(clickEvent());
    pending[0]({ name: "First", desc: "", songs: [] });
    pending[1]({ name: "Second", desc: "", songs: [] });
    assert.deepEqual(listPersonalSetlists(storage).map((e) => { return e.name; }), ["First"]);
  } finally {
    cleanup();
  }
});
