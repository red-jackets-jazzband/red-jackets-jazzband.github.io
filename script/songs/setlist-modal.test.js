import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx, memoryStorage } from "../../../tests/helpers/ctx.js";
import { listPersonalSetlists } from "../lib/setlists-store.js";
import { createSetlistModal } from "./setlist-modal.js";

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
    setlistView: { openPersonal: (id) => opened.push(id) },
  });
  const modal = createSetlistModal(ctx);
  modal.init();
  return { page, ctx, storage, modal, opened, cleanup: page.cleanup };
}

test("choice buttons toggle the active state and the contextual panels", () => {
  const { modal, cleanup } = setup();
  try {
    modal.open();
    const remixBtn = document.querySelector('.rj-modal-choice[data-choice="remix"]');
    remixBtn.dispatchEvent(new window.Event("click"));
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
    document.getElementById("setlistModalCreate").dispatchEvent(new window.Event("click"));
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
    document.querySelector('.rj-modal-choice[data-choice="remix"]').dispatchEvent(new window.Event("click"));
    document.getElementById("setlistModalName").value = "My Spring";
    document.getElementById("setlistModalCreate").dispatchEvent(new window.Event("click"));
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
    document.getElementById("setlistModal").dispatchEvent(new window.Event("click"));
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
