import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx, memoryStorage } from "../../../tests/helpers/ctx.js";
import {
  createPersonalSetlist, addSongToPersonalSetlist, addDividerToPersonalSetlist,
  updateDividerLabelInPersonalSetlist, getPersonalSetlist,
} from "../lib/setlists-store.js";
import { createSetlistView } from "./setlist-view.js";

function setup({ songs = [], personal = true } = {}) {
  const page = mountPage();
  const storage = memoryStorage();
  const booklets = [];
  const rendered = [];

  let entry = null;
  if (personal) {
    entry = createPersonalSetlist(storage, "My Set");
    songs.forEach((s) => {
      if (s.divider !== undefined) {
        addDividerToPersonalSetlist(storage, entry.id);
        const at = getPersonalSetlist(storage, entry.id).songs.length - 1;
        updateDividerLabelInPersonalSetlist(storage, entry.id, at, s.divider);
      } else {
        addSongToPersonalSetlist(storage, entry.id, { file: s.file, key: s.key || "" });
      }
    });
    entry = getPersonalSetlist(storage, entry.id);
  }

  const ctx = makeCtx({
    storage: () => storage,
    songName: (f) => f.replace(".abc", ""),
    state: { currentPersonalId: entry ? entry.id : null, allSongs: [], allSongsLoaded: true },
    setlistData: { loadBand: () => {}, ensureSongsLoaded: (cb) => cb() },
    setlistHome: { show: () => {}, render: () => {} },
    setlistModal: { init: () => {} },
    setlistPrint: { buildBooklet: (...a) => booklets.push(a), print: () => {} },
    sheet: { render: (...a) => rendered.push(a), renderFromFile: () => {} },
  });

  const view = createSetlistView(ctx);
  return { page, ctx, view, storage, entry, booklets, rendered, cleanup: page.cleanup };
}

const rowNumbers = () => [...document.querySelectorAll(".setlist-song-number")].map((n) => n.textContent);

test("renderOpen numbers a flat personal setlist 1..n with drag handles + remove", () => {
  const { view, entry, cleanup } = setup({
    songs: [{ file: "a.abc" }, { file: "b.abc" }, { file: "c.abc" }],
  });
  try {
    view.renderOpen(entry.name, entry.songs, entry, "");
    assert.deepEqual(rowNumbers(), ["1", "2", "3"]);
    assert.equal(document.querySelectorAll(".setlist-song-row .setlist-drag-handle").length, 3);
    assert.equal(document.querySelectorAll(".setlist-song-remove").length, 3);
    assert.ok(document.getElementById("setlistAddSongSearch"), "add-song tray present");
  } finally {
    cleanup();
  }
});

test("renderOpen restarts numbering per set and shows headings", () => {
  const { view, entry, cleanup } = setup({
    songs: [{ file: "a.abc" }, { file: "b.abc" }, { divider: "Encore" }, { file: "c.abc" }],
  });
  try {
    view.renderOpen(entry.name, entry.songs, entry, "");
    assert.deepEqual(rowNumbers(), ["1", "2", "1"]);
    assert.equal(
      document.querySelector(".setlist-set-heading").textContent, "Set 1",
    );
    assert.equal(
      document.querySelector(".setlist-divider-row .setlist-divider-input").value, "Encore",
    );
  } finally {
    cleanup();
  }
});

test("a band setlist renders read-only rows with key badges, no controls", () => {
  const { view, cleanup } = setup({ personal: false });
  try {
    const songs = [{ file: "a.abc", key: "2" }, { file: "b.abc", key: "" }];
    view.renderOpen("Band Night", songs, null, "");
    assert.equal(document.querySelectorAll(".setlist-drag-handle").length, 0);
    assert.equal(document.querySelector(".setlist-song-key-badge").textContent, "+2");
  } finally {
    cleanup();
  }
});

test("the per-song semitone field writes a signed integer back to storage", () => {
  const { view, entry, storage, cleanup } = setup({ songs: [{ file: "a.abc" }] });
  try {
    view.renderOpen(entry.name, entry.songs, entry, "");
    const field = document.querySelector(".setlist-song-semitones");
    field.value = "-3";
    field.dispatchEvent(new window.Event("change"));
    assert.equal(getPersonalSetlist(storage, entry.id).songs[0].key, "-3");
  } finally {
    cleanup();
  }
});

test("the per-song semitone field rejects fractional and out-of-range input", () => {
  const { view, entry, storage, cleanup } = setup({ songs: [{ file: "a.abc", key: "4" }] });
  try {
    view.renderOpen(entry.name, entry.songs, entry, "");
    const field = document.querySelector(".setlist-song-semitones");

    field.value = "1.5";
    field.dispatchEvent(new window.Event("change"));
    assert.equal(getPersonalSetlist(storage, entry.id).songs[0].key, "");

    view.renderOpen(entry.name, getPersonalSetlist(storage, entry.id).songs, entry, "");
    document.querySelector(".setlist-song-semitones").value = "40";
    document.querySelector(".setlist-song-semitones").dispatchEvent(new window.Event("change"));
    assert.equal(getPersonalSetlist(storage, entry.id).songs[0].key, "");
  } finally {
    cleanup();
  }
});

test("openPersonal still renders the setlist when the song index fails to load", () => {
  const page = mountPage();
  const storage = memoryStorage();
  const entry = createPersonalSetlist(storage, "My Set");
  addSongToPersonalSetlist(storage, entry.id, { file: "a.abc", key: "" });

  const ctx = makeCtx({
    storage: () => storage,
    songName: (f) => f.replace(".abc", ""),
    state: { currentPersonalId: null, allSongs: [], allSongsLoaded: false },
    setlistData: { loadBand: () => {}, ensureSongsLoaded: (_cb, onError) => onError(500) },
    setlistHome: { show: () => {}, render: () => {} },
    setlistModal: { init: () => {} },
    setlistPrint: { buildBooklet: () => {}, print: () => {} },
    sheet: { render: () => {}, renderFromFile: () => {} },
  });
  const view = createSetlistView(ctx);
  try {
    view.openPersonal(entry.id);
    assert.equal(document.querySelectorAll(".setlist-song-row").length, 1);
  } finally {
    page.cleanup();
  }
});

test("keyboard nudge on a drag handle persists the new order", () => {
  const { view, entry, storage, cleanup } = setup({
    songs: [{ file: "a.abc" }, { file: "b.abc" }, { file: "c.abc" }],
  });
  try {
    view.renderOpen(entry.name, entry.songs, entry, "");
    const firstHandle = document.querySelector(".setlist-song-row .setlist-drag-handle");
    firstHandle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.deepEqual(
      getPersonalSetlist(storage, entry.id).songs.map((s) => s.file),
      ["b.abc", "a.abc", "c.abc"],
    );
  } finally {
    cleanup();
  }
});

test("clicking a song title opens it in the sheet with the resolved transpose", () => {
  const { view, entry, ctx, rendered, cleanup } = setup({ songs: [{ file: "a.abc", key: "" }] });
  try {
    ctx.readFile = (path, onLoad) => onLoad("X:1\nK:Bb\nB2|");
    view.renderOpen(entry.name, entry.songs, entry, "");
    document.querySelector(".setlist-song-title").dispatchEvent(new window.Event("click"));
    assert.equal(rendered.length, 1);
    assert.equal(ctx.state.currentSongFile, "a.abc");
    assert.equal(ctx.state.currentSetlistSongIndex, 0);
  } finally {
    cleanup();
  }
});

test("a slow earlier song load can't overwrite the sheet the user moved on to", () => {
  const { view, entry, ctx, rendered, cleanup } = setup({
    songs: [{ file: "a.abc", key: "" }, { file: "b.abc", key: "" }],
  });
  try {
    const calls = [];
    ctx.readFile = (path, onLoad) => calls.push({ path, onLoad });
    view.renderOpen(entry.name, entry.songs, entry, "");

    const [titleA, titleB] = document.querySelectorAll(".setlist-song-title");
    titleA.dispatchEvent(new window.Event("click")); // start loading A
    titleB.dispatchEvent(new window.Event("click")); // switch to B before A lands

    calls[1].onLoad("X:1\nK:F\nF2|"); // B resolves
    calls[0].onLoad("X:1\nK:Bb\nB2|"); // stale A resolves afterwards

    assert.equal(rendered.length, 1, "only the still-current request renders");
    assert.equal(ctx.state.currentSongFile, "b.abc");
  } finally {
    cleanup();
  }
});

test("renderOpen feeds the print booklet builder the same songs", () => {
  const { view, entry, booklets, cleanup } = setup({ songs: [{ file: "a.abc" }] });
  try {
    view.renderOpen(entry.name, entry.songs, entry, "note");
    assert.equal(booklets.length, 1);
    assert.deepEqual(booklets[0][1].map((s) => s.file), ["a.abc"]);
    assert.equal(booklets[0][2], "note");
  } finally {
    cleanup();
  }
});
