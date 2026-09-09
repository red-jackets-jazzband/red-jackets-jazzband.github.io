import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx, memoryStorage } from "../../../tests/helpers/ctx.js";
import {
  createPersonalSetlist, addSongToPersonalSetlist, addDividerToPersonalSetlist,
  updateDividerLabelInPersonalSetlist, getPersonalSetlist,
} from "../lib/setlists-store.js";
import { createSetlistView } from "./setlist-view.js";

const DRAG_HANDLE_SELECTOR = ".setlist-song-row .setlist-drag-handle";
const BASIN_STREET_FILE = "basin_street.abc";
const BASIN_STREET_NAME = "Basin Street Blues";

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
    assert.equal(document.querySelectorAll(DRAG_HANDLE_SELECTOR).length, 3);
    assert.equal(document.querySelectorAll(".setlist-song-remove").length, 3);
    assert.ok(document.getElementById("setlistAddSongSearch"), "add-song tray present");
  } finally {
    cleanup();
  }
});

// Type `query` into the add-song search and press Enter; returns the open
// setlist's song files afterward plus the (always cleared) field value.
function enterAddSong(allSongs, query) {
  const { view, ctx, entry, storage, cleanup } = setup({ songs: [{ file: "a.abc" }] });
  try {
    ctx.state.allSongs = allSongs;
    view.renderOpen(entry.name, entry.songs, entry, "");
    const search = document.getElementById("setlistAddSongSearch");
    search.value = query;
    search.dispatchEvent(new window.Event("input"));
    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return {
      files: getPersonalSetlist(storage, entry.id).songs.map((s) => s.file),
      value: document.getElementById("setlistAddSongSearch").value,
    };
  } finally {
    cleanup();
  }
}

test("Enter in the add-song search adds a lone match and clears the field", () => {
  const result = enterAddSong([
    { file: BASIN_STREET_FILE, name: BASIN_STREET_NAME },
    { file: "muskrat.abc", name: "Muskrat Ramble" },
  ], "basin");
  assert.deepEqual(result.files, ["a.abc", BASIN_STREET_FILE]);
  assert.equal(result.value, "");
});

test("Enter with no single match just clears the add-song field", () => {
  const result = enterAddSong([
    { file: BASIN_STREET_FILE, name: BASIN_STREET_NAME },
    { file: "basin_two.abc", name: "Basin Two" },
  ], "basin");
  assert.deepEqual(result.files, ["a.abc"]);
  assert.equal(result.value, "");
});

// Open a personal setlist (one song, "a.abc") with the add-song search
// pre-filled with `query` against a library of `allSongs`. Shared by the
// result-click/arrow-key/highlight tests below.
function openAddSongSearch(allSongs, query) {
  const result = setup({ songs: [{ file: "a.abc" }] });
  const { view, ctx, entry } = result;
  ctx.state.allSongs = allSongs;
  view.renderOpen(entry.name, entry.songs, entry, "");
  const search = document.getElementById("setlistAddSongSearch");
  search.value = query;
  search.dispatchEvent(new window.Event("input"));
  return { ...result, search };
}

test("clicking an add-song result adds the song and clears the search field", () => {
  const { entry, storage, cleanup } = openAddSongSearch([
    { file: BASIN_STREET_FILE, name: BASIN_STREET_NAME },
    { file: "muskrat.abc", name: "Muskrat Ramble" },
  ], "basin");
  try {
    document.querySelector(".rj-library-add-song-result").dispatchEvent(new window.Event("click"));

    assert.deepEqual(
      getPersonalSetlist(storage, entry.id).songs.map((s) => s.file),
      ["a.abc", BASIN_STREET_FILE],
    );
    assert.equal(document.getElementById("setlistAddSongSearch").value, "");
    assert.equal(document.querySelectorAll(".rj-library-add-song-result").length, 0);
  } finally {
    cleanup();
  }
});

test("Arrow keys move the add-song highlight and Enter adds the highlighted result", () => {
  const { entry, storage, search, cleanup } = openAddSongSearch([
    { file: BASIN_STREET_FILE, name: BASIN_STREET_NAME },
    { file: "basin_two.abc", name: "Basin Two" },
    { file: "basin_three.abc", name: "Basin Three" },
  ], "basin");
  try {
    const arrow = (key) => search.dispatchEvent(
      new window.KeyboardEvent("keydown", { key, bubbles: true }),
    );
    arrow("ArrowDown"); // -> first
    arrow("ArrowDown"); // -> second
    assert.equal(
      document.querySelectorAll(".rj-library-add-song-result")[1].classList.contains("is-active"),
      true,
    );
    arrow("ArrowUp"); // -> first
    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    assert.deepEqual(
      getPersonalSetlist(storage, entry.id).songs.map((s) => s.file),
      ["a.abc", BASIN_STREET_FILE],
    );
    assert.equal(search.value, "");
  } finally {
    cleanup();
  }
});

test("ArrowUp from no selection highlights the last add-song result and wraps", () => {
  const { search, cleanup } = openAddSongSearch([
    { file: BASIN_STREET_FILE, name: BASIN_STREET_NAME },
    { file: "basin_two.abc", name: "Basin Two" },
  ], "basin");
  try {
    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));

    const results = document.querySelectorAll(".rj-library-add-song-result");
    assert.equal(results[results.length - 1].classList.contains("is-active"), true);

    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(results[0].classList.contains("is-active"), true);
  } finally {
    cleanup();
  }
});

test("with the add-song field empty, ArrowUp jumps to the setlist and ArrowDown to the break button", () => {
  const { view, ctx, entry, cleanup } = setup({ songs: [{ file: "a.abc" }, { file: "b.abc" }] });
  try {
    ctx.state.allSongs = [{ file: "a.abc", name: "A" }, { file: "b.abc", name: "B" }];
    view.renderOpen(entry.name, entry.songs, entry, "");
    const search = document.getElementById("setlistAddSongSearch");

    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    const handles = document.querySelectorAll(DRAG_HANDLE_SELECTOR);
    assert.equal(document.activeElement, handles[handles.length - 1]);

    search.focus();
    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(document.activeElement, document.querySelector(".rj-library-add-break"));
  } finally {
    cleanup();
  }
});

test("typing again resets the add-song highlight", () => {
  const { search, cleanup } = openAddSongSearch([
    { file: BASIN_STREET_FILE, name: BASIN_STREET_NAME },
    { file: "basin_two.abc", name: "Basin Two" },
  ], "basin");
  try {
    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    search.value = "basin ";
    search.dispatchEvent(new window.Event("input"));

    assert.equal(document.querySelectorAll(".rj-library-add-song-result.is-active").length, 0);
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
    const firstHandle = document.querySelector(DRAG_HANDLE_SELECTOR);
    firstHandle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.deepEqual(
      getPersonalSetlist(storage, entry.id).songs.map((s) => s.file),
      ["b.abc", "a.abc", "c.abc"],
    );
  } finally {
    cleanup();
  }
});

// Open a personal setlist of three songs (a/b/c), already rendered.
function openThreeSongSetlist() {
  const result = setup({
    songs: [{ file: "a.abc" }, { file: "b.abc" }, { file: "c.abc" }],
  });
  const { view, entry } = result;
  view.renderOpen(entry.name, entry.songs, entry, "");
  return result;
}

// Open a three-song personal setlist, run `trigger` against it, and assert
// the surviving song files. Shared by the remove-row tests below.
function assertRemoval(trigger, expectedFiles) {
  const { entry, storage, cleanup } = openThreeSongSetlist();
  try {
    trigger();
    assert.deepEqual(
      getPersonalSetlist(storage, entry.id).songs.map((s) => s.file),
      expectedFiles,
    );
  } finally {
    cleanup();
  }
}

test("the remove button drops the song from the personal setlist", () => {
  assertRemoval(
    () => document.querySelectorAll(".setlist-song-remove")[1]
      .dispatchEvent(new window.Event("click")),
    ["a.abc", "c.abc"],
  );
});

test("Delete on a focused drag handle removes that row", () => {
  assertRemoval(
    () => document.querySelectorAll(DRAG_HANDLE_SELECTOR)[0]
      .dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true })),
    ["b.abc", "c.abc"],
  );
});

test("Delete on the only row's drag handle moves focus to the add-song field", () => {
  const { view, entry, cleanup } = setup({ songs: [{ file: "a.abc" }] });
  try {
    view.renderOpen(entry.name, entry.songs, entry, "");
    document.querySelector(DRAG_HANDLE_SELECTOR)
      .dispatchEvent(new window.KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    assert.equal(document.activeElement, document.getElementById("setlistAddSongSearch"));
  } finally {
    cleanup();
  }
});

test("remove reads the row's live position so it survives a reorder", () => {
  assertRemoval(() => {
    // Nudge the first song down, then remove what is now the first row (b.abc).
    document.querySelector(DRAG_HANDLE_SELECTOR)
      .dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    document.querySelector(".setlist-song-remove").dispatchEvent(new window.Event("click"));
  }, ["a.abc", "c.abc"]);
});

test("clicking a song title opens it in the sheet with the resolved transpose", () => {
  const { view, entry, ctx, rendered, cleanup } = setup({ songs: [{ file: "a.abc", key: "" }] });
  try {
    const backLabels = [];
    ctx.setSheetBackLabel = (label) => backLabels.push(label);
    ctx.readFile = (path, onLoad) => onLoad("X:1\nK:Bb\nB2|");
    view.renderOpen(entry.name, entry.songs, entry, "");
    document.querySelector(".setlist-song-title").dispatchEvent(new window.Event("click"));
    assert.equal(rendered.length, 1);
    assert.equal(ctx.state.currentSongFile, "a.abc");
    assert.equal(ctx.state.currentSetlistSongIndex, 0);
    assert.deepEqual(backLabels, ["Setlist"], "mobile back button points at the setlist");
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

test("openSongInOpenSetlist opens the matching song at its list position", () => {
  const { view, ctx, entry, cleanup } = setup({
    songs: [{ file: "a.abc" }, { divider: "Set 2" }, { file: "b.abc" }, { file: "c.abc" }],
  });
  try {
    const loads = [];
    ctx.readFile = (path, onLoad) => loads.push({ path, onLoad });
    view.renderOpen(entry.name, entry.songs, entry, "");
    ctx.state.currentOpenSongs = entry.songs;

    assert.equal(view.openSongInOpenSetlist("b"), true);
    assert.equal(ctx.state.currentSongFile, "b.abc");
    assert.equal(ctx.state.currentSetlistSongIndex, 2);
    assert.equal(loads[0].path, "/songs/b.abc");
    assert.ok(
      document.querySelector('.setlist-song-row[data-setlist-index="2"]').classList.contains("is-current-song"),
    );

    assert.equal(view.openSongInOpenSetlist("nope"), false);
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
