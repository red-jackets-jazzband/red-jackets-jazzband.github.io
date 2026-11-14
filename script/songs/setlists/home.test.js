import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx, memoryStorage } from "../../../../tests/helpers/ctx.js";
import { createPersonalSetlist, addSongToPersonalSetlist, listPersonalSetlists } from "../../lib/setlists/setlists-store.js";
import { createSetlistHome } from "./home.js";
import { bandSetlistStorage, registerBand } from "../../lib/sync/band-store.js";

function setup() {
  const page = mountPage();
  const storage = memoryStorage();
  const bandParsed = { "spring.txt": { name: "Spring", desc: "", songs: [{ file: "a.abc" }, { file: "b.abc" }] } };
  const openedBand = [];
  const openedPersonal = [];
  const ctx = makeCtx({
    storage: () => storage,
    state: { setlistIndex: [{ name: "Spring Tour", file: "spring.txt" }] },
    setlistData: { loadBand: (file, cb) => cb(bandParsed[file]), ensureSongsLoaded: (cb) => cb() },
    setlistModal: { open: () => {} },
    setlistView: {
      openBand: (f, n) => openedBand.push([f, n]),
      openPersonal: (id) => openedPersonal.push(id),
    },
  });
  const home = createSetlistHome(ctx);
  return { page, ctx, storage, home, openedBand, openedPersonal, cleanup: page.cleanup };
}

test("render shows both shelves, the band song counts and the New button", () => {
  const { storage, home, cleanup } = setup();
  try {
    const p = createPersonalSetlist(storage, "My Set");
    addSongToPersonalSetlist(storage, p.id, { file: "c.abc", key: "" });
    home.render();
    const headings = [...document.querySelectorAll("#songList .song-list-letter")].map((h) => h.textContent);
    assert.deepEqual(headings, ["From the band", "Yours"]);
    assert.equal(document.querySelector(".setlist-row .setlist-row-meta").textContent, "2 songs");
    assert.ok([...document.querySelectorAll(".setlist-row-main")].some((b) => b.textContent === "My Set"));
    assert.ok(document.querySelector(".rj-library-new-setlist-btn"));
  } finally {
    cleanup();
  }
});

test("opening rows routes to the right view", () => {
  const { storage, home, openedBand, openedPersonal, cleanup } = setup();
  try {
    const p = createPersonalSetlist(storage, "Mine");
    home.render();
    document.querySelector(".setlist-row .setlist-row-main").dispatchEvent(new window.Event("click"));
    assert.deepEqual(openedBand[0], ["spring.txt", "Spring Tour"]);
    [...document.querySelectorAll(".setlist-row-main")].find((b) => b.textContent === "Mine")
      .dispatchEvent(new window.Event("click"));
    assert.equal(openedPersonal[0], p.id);
  } finally {
    cleanup();
  }
});

test("the trash icon deletes a personal setlist after confirmation", () => {
  const { storage, home, cleanup } = setup();
  try {
    createPersonalSetlist(storage, "Doomed");
    home.render();
    window.confirm = () => true;
    document.querySelector(".setlist-row-delete").dispatchEvent(new window.Event("click"));
    assert.equal(listPersonalSetlists(storage).length, 0);
  } finally {
    cleanup();
  }
});

test("each shared space gets its own shelf, named after the space, with its own New button", () => {
  const { storage, home, ctx, cleanup } = setup();
  try {
    const opened = [];
    ctx.setlistModal.open = (bandId) => opened.push(bandId);
    registerBand(storage, "b1", "My Band");
    registerBand(storage, "b2", "Brass Crew");
    storage.setItem("rj.band.b1.code", "x");
    storage.setItem("rj.band.b2.code", "y");
    createPersonalSetlist(bandSetlistStorage(storage, "b1"), "Gig");
    home.render();
    const headings = [...document.querySelectorAll("#songList .song-list-letter")].map((h) => h.textContent);
    assert.deepEqual(headings, ["From the band", "Yours", "My Band", "Brass Crew"]);
    assert.ok([...document.querySelectorAll(".setlist-row-main")].some((b) => b.textContent === "Gig"));
    const buttons = [...document.querySelectorAll(".rj-library-new-setlist-btn")];
    assert.equal(buttons.length, 3);
    buttons[1].dispatchEvent(new window.Event("click"));
    buttons[2].dispatchEvent(new window.Event("click"));
    assert.deepEqual(opened, ["b1", "b2"]);
    assert.equal(listPersonalSetlists(storage).length, 0);
  } finally {
    cleanup();
  }
});
