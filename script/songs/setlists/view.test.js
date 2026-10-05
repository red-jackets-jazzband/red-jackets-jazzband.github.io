import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { RENDER } from "../core/state.js";
import { makeCtx, memoryStorage } from "../../../../tests/helpers/ctx.js";
import {
  createPersonalSetlist, addSongToPersonalSetlist, addDividerToPersonalSetlist,
  updateDividerLabelInPersonalSetlist, updateSongNoteInPersonalSetlist,
  getPersonalSetlist, setPersonalSetlistOrder,
} from "../../lib/setlists/setlists-store.js";
import { createSetlistView } from "./view.js";

const DRAG_HANDLE_SELECTOR = ".setlist-song-row .setlist-drag-handle";
const REMOVE_SELECTOR = ".setlist-song-remove";
const NOTE_INPUT_SELECTOR = ".setlist-song-note-input";
const NOTE_ADD_SELECTOR = ".setlist-song-note-add";
const SONG_TITLE_SELECTOR = ".setlist-song-title";
const KEY_SELECT_SELECTOR = ".setlist-song-key-select";
const KEY_BADGE_SELECTOR = ".setlist-song-key-badge";
const IS_TRANSPOSED_CLASS = "is-transposed";
function altArrow(handleIndex, key) {
  document.querySelectorAll(DRAG_HANDLE_SELECTOR)[handleIndex].dispatchEvent(
    new window.KeyboardEvent("keydown", { key, altKey: true, bubbles: true }),
  );
}

test("Alt+ArrowDown on a set's last song moves it into the next set, then past that set's first song", () => {
  const { view, entry, storage, cleanup } = setup({
    songs: [{ file: "a.abc" }, { file: "b.abc" }, { divider: "Two" }, { file: "c.abc" }],
  });
  try {
    view.initControls();
    view.renderOpen(entry.name, entry.songs, entry, "");
    altArrow(1, "ArrowDown"); // b: last of set 1 -> top of set 2
    const files = () => getPersonalSetlist(storage, entry.id).songs
      .map((s) => s.file || `[${s.divider}]`);
    assert.deepEqual(files(), ["a.abc", "[Two]", "b.abc", "c.abc"]);
    assert.deepEqual(rowNumbers(), ["1", "1", "2"]);
    altArrow(1, "ArrowDown"); // b again: past c, still in set 2
    assert.deepEqual(files(), ["a.abc", "[Two]", "c.abc", "b.abc"]);
    altArrow(0, "ArrowDown"); // a: only song of set 1 -> top of set 2
    assert.deepEqual(files(), ["[Two]", "a.abc", "c.abc", "b.abc"]);
  } finally {
    cleanup();
  }
});

const BASIN_STREET_FILE = "basin_street.abc";
const BASIN_STREET_NAME = "Basin Street Blues";
const ADD_SONG_SEARCH_ID = "setlistAddSongSearch";
const addSongSearch = () => document.getElementById(ADD_SONG_SEARCH_ID);
const MINIMAL_ABC = "X:1\nK:C\nC2|";
const NOTE_TEXT = "Ben solos.";

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
    assert.equal(document.querySelectorAll(REMOVE_SELECTOR).length, 3);
    assert.ok(addSongSearch(), "add-song tray present");
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
    const search = addSongSearch();
    search.value = query;
    search.dispatchEvent(new window.Event("input"));
    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return {
      files: getPersonalSetlist(storage, entry.id).songs.map((s) => s.file),
      value: addSongSearch().value,
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

test("Enter with several matches and none highlighted adds the top one", () => {
  const result = enterAddSong([
    { file: BASIN_STREET_FILE, name: BASIN_STREET_NAME },
    { file: "basin_two.abc", name: "Basin Two" },
  ], "basin");
  assert.deepEqual(result.files, ["a.abc", BASIN_STREET_FILE]);
});

test("Enter with no matches just clears the add-song field", () => {
  const result = enterAddSong([{ file: BASIN_STREET_FILE, name: BASIN_STREET_NAME }], "zzz");
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
  const search = addSongSearch();
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
    assert.equal(addSongSearch().value, "");
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

    const results = [...document.querySelectorAll(".rj-library-add-song-result")];
    assert.equal(results.at(-1).classList.contains("is-active"), true);

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
    const search = addSongSearch();

    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    const titles = [...document.querySelectorAll(SONG_TITLE_SELECTOR)];
    assert.equal(document.activeElement, titles.at(-1), "lands on the row, not its drag handle");

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
    const headings = Array.from(document.querySelectorAll(".setlist-set > .setlist-divider-row"));
    assert.deepEqual(
      headings.map((h) => {
        const input = h.querySelector(".setlist-divider-input");
        return input.value || input.placeholder;
      }),
      ["Set 1", "Encore"],
      "every set box opens with the same kind of heading row",
    );
  } finally {
    cleanup();
  }
});

// setup() defaults ctx.readFile to a no-op, so a test that needs a song's own
// key resolved (the badge / picker both fetch the .abc to read its K: field)
// passes its own stub that calls back synchronously with the given text.
function stubAbc(ctx, abcByFile) {
  ctx.readFile = (path, onLoad, onError) => {
    const file = path.replace(/^\/songs\//, "");
    const text = abcByFile[file];
    if (text === undefined) {
      if (onError) onError(404);
    } else {
      onLoad(text);
    }
  };
}

test("a band setlist renders read-only rows with key badges, no controls", () => {
  const { view, ctx, cleanup } = setup({ personal: false });
  try {
    stubAbc(ctx, { "a.abc": "X:1\nK:F\nF2|", "b.abc": "X:1\nK:F\nF2|" });
    const songs = [{ file: "a.abc", key: "2" }, { file: "b.abc", key: "" }];
    view.renderOpen("Band Night", songs, null, "");
    assert.equal(document.querySelectorAll(".setlist-drag-handle").length, 0);

    const [badgeA, badgeB] = document.querySelectorAll(KEY_BADGE_SELECTOR);
    assert.equal(badgeA.textContent, "G", "F transposed +2 resolves to the real key, not \"+2\"");
    assert.equal(badgeA.classList.contains(IS_TRANSPOSED_CLASS), true);
    assert.equal(badgeB.textContent, "F", "no override — shows the tune's own key");
    assert.equal(badgeB.classList.contains(IS_TRANSPOSED_CLASS), false);
  } finally {
    cleanup();
  }
});

test("a key badge shows the tune's own bpm underneath, and hides it when the tune has none", () => {
  const { view, ctx, cleanup } = setup({ personal: false });
  try {
    stubAbc(ctx, { "a.abc": "X:1\nK:F\nQ:1/4=132\nF2|", "b.abc": MINIMAL_ABC });
    const songs = [{ file: "a.abc", key: "" }, { file: "b.abc", key: "" }];
    view.renderOpen("Tempo Test Night", songs, null, "");

    const [badgeA, badgeB] = document.querySelectorAll(KEY_BADGE_SELECTOR);
    const bpmA = badgeA.querySelector(".setlist-song-key-badge-bpm");
    const bpmB = badgeB.querySelector(".setlist-song-key-badge-bpm");
    assert.equal(bpmA.textContent, "132");
    assert.equal(bpmA.hidden, false);
    assert.equal(bpmB.textContent, "", "no Q: field — nothing to show");
    assert.equal(bpmB.hidden, true);
  } finally {
    cleanup();
  }
});

test("a personal setlist also shows a read-only key badge, not a picker", () => {
  const { view, ctx, entry, cleanup } = setup({ songs: [{ file: "a.abc", key: "2" }] });
  try {
    stubAbc(ctx, { "a.abc": "X:1\nK:C\nC2|" });
    view.renderOpen(entry.name, entry.songs, entry, "");
    assert.equal(document.querySelector(KEY_SELECT_SELECTOR), null, "no editable picker");
    const badge = document.querySelector(KEY_BADGE_SELECTOR);
    assert.equal(badge.textContent, "D", "C + 2 semitones resolves to D");
    assert.equal(badge.classList.contains(IS_TRANSPOSED_CLASS), true);
    // The row still has its drag handle / remove button — only the key
    // control itself dropped its editing affordance.
    assert.equal(document.querySelectorAll(".setlist-drag-handle").length, 1);
  } finally {
    cleanup();
  }
});

test("a personal setlist's key badge falls back to a semitone label when the tune's key can't be read", () => {
  const { view, ctx, entry, cleanup } = setup({ songs: [{ file: "a.abc", key: "2" }] });
  try {
    // 404: the tune's own key never resolves, so the badge falls back to
    // formatSetlistKeyLabel's raw offset text instead of a resolved key name.
    stubAbc(ctx, {});
    view.renderOpen(entry.name, entry.songs, entry, "");
    const badge = document.querySelector(KEY_BADGE_SELECTOR);
    assert.equal(badge.textContent, "+2");
    assert.equal(badge.classList.contains(IS_TRANSPOSED_CLASS), true);
  } finally {
    cleanup();
  }
});

test("the Key stepper writes a per-song key override back to the open personal setlist", () => {
  const { view, ctx, entry, storage, cleanup } = setup({ songs: [{ file: "a.abc" }] });
  try {
    stubAbc(ctx, { "a.abc": "X:1\nK:C\nC2|" });
    view.initControls();
    view.renderOpen(entry.name, entry.songs, entry, "");
    ctx.state.currentSongFile = "a.abc";
    ctx.state.currentSetlistSongIndex = 0;

    // A render seeding the stepper for the newly opened song isn't the
    // listener's own change, so it's never written back.
    ctx.store.set("settings", { transpose: 5 }, RENDER);
    assert.equal(getPersonalSetlist(storage, entry.id).songs[0].key, "");

    // The listener nudging the Key stepper (controls.js writes the store).
    ctx.state.transpose = 2;

    assert.equal(getPersonalSetlist(storage, entry.id).songs[0].key, "2");
    const badge = document.querySelector(KEY_BADGE_SELECTOR);
    assert.equal(badge.textContent, "D", "the badge reflects the stepper's new override");
    assert.equal(badge.classList.contains(IS_TRANSPOSED_CLASS), true);
  } finally {
    cleanup();
  }
});

test("clicking the '+ note' button reveals an editable field; blur saves the trimmed text", () => {
  const { view, entry, storage, cleanup } = setup({ songs: [{ file: "a.abc" }] });
  try {
    view.renderOpen(entry.name, entry.songs, entry, "");
    document.querySelector(NOTE_ADD_SELECTOR).dispatchEvent(new window.Event("click"));
    const input = document.querySelector(NOTE_INPUT_SELECTOR);
    assert.equal(input.hidden, false);
    input.value = "  Ben solos 2nd chorus.  ";
    input.dispatchEvent(new window.Event("blur"));
    assert.equal(getPersonalSetlist(storage, entry.id).songs[0].note, "Ben solos 2nd chorus.");
  } finally {
    cleanup();
  }
});

test("clicking an existing note reveals it prefilled, and Escape cancels without saving", () => {
  const { view, entry, storage, cleanup } = setup({ songs: [{ file: "a.abc" }] });
  try {
    updateSongNoteInPersonalSetlist(storage, entry.id, 0, "Original note.");
    const seeded = getPersonalSetlist(storage, entry.id);
    view.renderOpen(seeded.name, seeded.songs, seeded, "");

    const textEl = document.querySelector(".setlist-song-note-text");
    assert.equal(textEl.hidden, false);
    assert.equal(textEl.textContent, "Original note.");
    textEl.dispatchEvent(new window.Event("click"));

    const input = document.querySelector(NOTE_INPUT_SELECTOR);
    assert.equal(input.hidden, false);
    assert.equal(input.value, "Original note.");
    input.value = "Changed but cancelled.";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    input.dispatchEvent(new window.Event("blur"));

    assert.equal(getPersonalSetlist(storage, entry.id).songs[0].note, "Original note.");
    assert.equal(document.activeElement, document.querySelector(".setlist-song-note-text"),
      "Escape hands focus back to the note text, not <body>");
  } finally {
    cleanup();
  }
});

test("Ctrl+Enter in the note field commits and blurs it, same as a plain blur", () => {
  const { view, entry, storage, cleanup } = setup({ songs: [{ file: "a.abc" }] });
  try {
    view.renderOpen(entry.name, entry.songs, entry, "");
    document.querySelector(NOTE_ADD_SELECTOR).dispatchEvent(new window.Event("click"));
    const input = document.querySelector(NOTE_INPUT_SELECTOR);
    input.value = "Ben solos 2nd chorus.";
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    input.dispatchEvent(new window.Event("blur"));

    assert.equal(getPersonalSetlist(storage, entry.id).songs[0].note, "Ben solos 2nd chorus.");
    assert.equal(document.querySelector(NOTE_INPUT_SELECTOR).hidden, true);
  } finally {
    cleanup();
  }
});

test("blurring a note field with an unchanged value doesn't write back or lose the escape hatch", () => {
  const { view, entry, storage, cleanup } = setup({ songs: [{ file: "a.abc" }] });
  try {
    view.renderOpen(entry.name, entry.songs, entry, "");
    document.querySelector(NOTE_ADD_SELECTOR).dispatchEvent(new window.Event("click"));
    document.querySelector(NOTE_INPUT_SELECTOR).dispatchEvent(new window.Event("blur"));
    assert.equal(getPersonalSetlist(storage, entry.id).songs[0].note, undefined);
  } finally {
    cleanup();
  }
});

test("a band setlist shows a read-only note with no edit controls", () => {
  const { view, cleanup } = setup({ personal: false });
  try {
    view.renderOpen("Band Night", [{ file: "a.abc", key: "", note: NOTE_TEXT }], null, "");
    const textEl = document.querySelector(".setlist-song-note-text");
    assert.equal(textEl.textContent, NOTE_TEXT);
    assert.equal(document.querySelector(NOTE_INPUT_SELECTOR), null);
    assert.equal(document.querySelector(NOTE_ADD_SELECTOR), null);
  } finally {
    cleanup();
  }
});

test("a band setlist song with no note renders no note row", () => {
  const { view, cleanup } = setup({ personal: false });
  try {
    view.renderOpen("Band Night", [{ file: "a.abc", key: "" }], null, "");
    assert.equal(document.querySelector(".setlist-song-note-row"), null);
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

// Open a personal setlist of three songs (a/b/c), already rendered.
function openThreeSongSetlist() {
  const result = setup({
    songs: [{ file: "a.abc" }, { file: "b.abc" }, { file: "c.abc" }],
  });
  const { view, entry } = result;
  view.initControls();
  view.renderOpen(entry.name, entry.songs, entry, "");
  return result;
}

// Open a three-song personal setlist and start editing its first song's
// note, with NOTE_TEXT typed in but not yet committed (blur is left to the
// caller, since that's the part the two note-commit-focus tests differ on).
function openNoteEditorWithChange() {
  const result = openThreeSongSetlist();
  document.querySelectorAll(NOTE_ADD_SELECTOR)[0].dispatchEvent(new window.Event("click"));
  const input = document.querySelectorAll(NOTE_INPUT_SELECTOR)[0];
  input.value = NOTE_TEXT;
  return { ...result, input };
}

test("committing a note (Ctrl+Enter) refocuses the row so Alt+Up/Down reorder still works", () => {
  const { entry, storage, input, cleanup } = openNoteEditorWithChange();
  try {
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    input.dispatchEvent(new window.Event("blur"));

    // Committing re-renders the row from scratch; without an explicit
    // refocus, focus falls through to <body> and the very next Alt+Down
    // silently does nothing, since moveRowByKeyboard's row lookup
    // (e.target.closest(".setlist-song-row")) finds nothing to act on.
    assert.ok(document.activeElement.closest(".setlist-song-row"), "focus stayed inside a row after commit");

    document.activeElement.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
    );
    assert.deepEqual(
      getPersonalSetlist(storage, entry.id).songs.map((s) => s.file),
      ["b.abc", "a.abc", "c.abc"],
    );
  } finally {
    cleanup();
  }
});

test("committing a note by clicking another row's drag handle relocates focus there, not back to the edited row", () => {
  const { entry, storage, input, cleanup } = openNoteEditorWithChange();
  try {
    const destination = document.querySelectorAll(DRAG_HANDLE_SELECTOR)[2];
    input.dispatchEvent(new window.FocusEvent("blur", { relatedTarget: destination, bubbles: true }));

    assert.equal(getPersonalSetlist(storage, entry.id).songs[0].note, NOTE_TEXT);
    // The row list is fully rebuilt by the commit, so the original
    // `destination` node is gone — focus should land on ITS rebuilt
    // equivalent (song c's drag handle), not get pulled back onto row 0
    // just because that's the row whose note was being edited.
    assert.equal(
      document.activeElement.closest(".setlist-song-row").dataset.songFile,
      "c.abc",
    );
  } finally {
    cleanup();
  }
});

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
    () => document.querySelectorAll(REMOVE_SELECTOR)[1]
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
    assert.equal(document.activeElement, addSongSearch());
  } finally {
    cleanup();
  }
});

test("remove reads the row's live position so it survives a reorder", () => {
  const { view, entry, storage, cleanup } = openThreeSongSetlist();
  try {
    // Swap the first two songs (as a drag would), then remove what is now
    // the first row (b.abc) — removeRow must read the row's live DOM
    // position, not a stale index captured when the row was built.
    setPersonalSetlistOrder(storage, entry.id, [1, 0, 2]);
    view.renderOpen(entry.name, getPersonalSetlist(storage, entry.id).songs, entry, "");
    document.querySelector(REMOVE_SELECTOR).dispatchEvent(new window.Event("click"));
    assert.deepEqual(
      getPersonalSetlist(storage, entry.id).songs.map((s) => s.file),
      ["a.abc", "c.abc"],
    );
  } finally {
    cleanup();
  }
});

// Dispatch an Alt+Up/Alt+Down keydown on the element at `index` of `selector`
// (drag handle or song title — both live inside the row and should trigger
// the same reorder) and assert the surviving song order. Shared by the
// reorder tests below.
function assertAltArrowReorder(selector, index, key, expectedFiles) {
  const { entry, storage, cleanup } = openThreeSongSetlist();
  try {
    document.querySelectorAll(selector)[index].dispatchEvent(
      new window.KeyboardEvent("keydown", { key, altKey: true, bubbles: true }),
    );
    assert.deepEqual(
      getPersonalSetlist(storage, entry.id).songs.map((s) => s.file),
      expectedFiles,
    );
  } finally {
    cleanup();
  }
}

test("Alt+ArrowDown on a focused drag handle moves that row down and persists the order", () => {
  assertAltArrowReorder(DRAG_HANDLE_SELECTOR, 0, "ArrowDown", ["b.abc", "a.abc", "c.abc"]);
});

test("Alt+ArrowUp on a focused drag handle moves that row up and persists the order", () => {
  assertAltArrowReorder(DRAG_HANDLE_SELECTOR, 2, "ArrowUp", ["a.abc", "c.abc", "b.abc"]);
});

test("Alt+ArrowUp on the first row's drag handle is a no-op (clamped at the top)", () => {
  assertAltArrowReorder(DRAG_HANDLE_SELECTOR, 0, "ArrowUp", ["a.abc", "b.abc", "c.abc"]);
});

test("Alt+ArrowDown on the focused song title (not the drag handle) also reorders", () => {
  assertAltArrowReorder(SONG_TITLE_SELECTOR, 0, "ArrowDown", ["b.abc", "a.abc", "c.abc"]);
});

test("Alt+ArrowDown doesn't leave focus on a drag handle after re-render", () => {
  const { cleanup } = openThreeSongSetlist();
  try {
    document.querySelectorAll(DRAG_HANDLE_SELECTOR)[0].dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
    );
    assert.equal(document.activeElement.closest(".setlist-drag-handle"), null);
  } finally {
    cleanup();
  }
});

test("a plain arrow key still steps the open sheet's song, not a reorder, off a focused title", () => {
  const { view, ctx, entry, rendered, cleanup } = openThreeSongSetlist();
  try {
    ctx.readFile = (path, onLoad) => onLoad(MINIMAL_ABC);
    view.openSongInOpenSetlist("a");
    document.querySelectorAll(SONG_TITLE_SELECTOR)[0].dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    assert.equal(ctx.state.currentSetlistSongIndex, 1, "stepped to the next song");
    assert.deepEqual(
      getPersonalSetlist(ctx.storage(), entry.id).songs.map((s) => s.file),
      ["a.abc", "b.abc", "c.abc"],
      "no reorder happened without Alt",
    );
    assert.equal(rendered.length, 2);
  } finally {
    cleanup();
  }
});

test("stepping without Alt continues from the last moved item, not a stale index", () => {
  const { view, ctx, cleanup } = openThreeSongSetlist();
  try {
    ctx.readFile = (path, onLoad) => onLoad(MINIMAL_ABC);
    // Open "a" (index 0), then move it down past "b" with Alt+ArrowDown —
    // it now sits at index 1, and its pointer should move with it.
    view.openSongInOpenSetlist("a");
    document.querySelectorAll(DRAG_HANDLE_SELECTOR)[0].dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
    );
    assert.equal(ctx.state.currentSetlistSongIndex, 1, "index pointer followed the moved song");

    // A plain ArrowDown now should step to whatever follows "a" at its new
    // spot ("c"), not re-derive from the old pre-move index (which would
    // also land on "c" here, so use the file to prove it's the *new* slot).
    document.querySelectorAll(DRAG_HANDLE_SELECTOR)[1].dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    assert.equal(ctx.state.currentSongFile, "c.abc");
    assert.equal(ctx.state.currentSetlistSongIndex, 2);
  } finally {
    cleanup();
  }
});

test("arrow keys step to the next song even while a drag handle has focus", () => {
  const { view, entry, ctx, rendered, cleanup } = setup({
    songs: [{ file: "a.abc", key: "" }, { file: "b.abc", key: "" }],
  });
  try {
    ctx.readFile = (path, onLoad) => onLoad(MINIMAL_ABC);
    view.initControls();
    view.renderOpen(entry.name, entry.songs, entry, "");
    document.querySelector(SONG_TITLE_SELECTOR).dispatchEvent(new window.Event("click"));
    assert.equal(ctx.state.currentSetlistSongIndex, 0);

    document.querySelector(DRAG_HANDLE_SELECTOR)
      .dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    assert.equal(ctx.state.currentSetlistSongIndex, 1, "arrow key opened the next song");
    assert.deepEqual(
      getPersonalSetlist(ctx.storage(), entry.id).songs.map((s) => s.file),
      ["a.abc", "b.abc"],
      "the drag handle did not reorder the setlist",
    );
    assert.equal(rendered.length, 2);
  } finally {
    cleanup();
  }
});

test("arrow-down on the last song of a personal setlist hands off to the add-song search", () => {
  const { view, entry, ctx, cleanup } = setup({
    songs: [{ file: "a.abc", key: "" }, { file: "b.abc", key: "" }],
  });
  try {
    ctx.readFile = (path, onLoad) => onLoad(MINIMAL_ABC);
    view.initControls();
    view.renderOpen(entry.name, entry.songs, entry, "");
    const titles = [...document.querySelectorAll(SONG_TITLE_SELECTOR)];
    titles.at(-1).dispatchEvent(new window.Event("click")); // open the last song
    assert.equal(ctx.state.currentSetlistSongIndex, 1);

    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    assert.equal(ctx.state.currentSetlistSongIndex, 1, "clamped, didn't step past the end");
    assert.equal(document.activeElement, addSongSearch());
  } finally {
    cleanup();
  }
});

test("arrow-down on the last song of a read-only band setlist is a no-op (no add-song tray)", () => {
  const { view, ctx, cleanup } = setup({ personal: false });
  try {
    ctx.readFile = (path, onLoad) => onLoad(MINIMAL_ABC);
    view.initControls();
    view.renderOpen("Band Night", [{ file: "a.abc", key: "" }, { file: "b.abc", key: "" }], null, "");
    document.querySelectorAll(SONG_TITLE_SELECTOR)[1].dispatchEvent(new window.Event("click"));
    assert.equal(ctx.state.currentSetlistSongIndex, 1);

    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    assert.equal(ctx.state.currentSetlistSongIndex, 1);
    assert.equal(addSongSearch(), null);
  } finally {
    cleanup();
  }
});

test("clicking a song title opens it in the sheet with the resolved transpose", () => {
  const { view, entry, ctx, rendered, cleanup } = setup({ songs: [{ file: "a.abc", key: "" }] });
  try {
    ctx.readFile = (path, onLoad) => onLoad("X:1\nK:Bb\nB2|");
    view.renderOpen(entry.name, entry.songs, entry, "");
    document.querySelector(SONG_TITLE_SELECTOR).dispatchEvent(new window.Event("click"));
    assert.equal(rendered.length, 1);
    assert.equal(ctx.state.currentSongFile, "a.abc");
    assert.equal(ctx.state.currentSetlistSongIndex, 0);
    assert.equal(
      document.getElementById("sheetBackLabel").textContent, "Setlist", "mobile back button points at the setlist",
    );
  } finally {
    cleanup();
  }
});

test("a slow earlier song load can't overwrite the sheet the user moved on to", () => {
  const { view, entry, ctx, rendered, cleanup } = setup({
    songs: [{ file: "a.abc", key: "" }, { file: "b.abc", key: "" }],
  });
  try {
    // Rendering itself also fires a read per row (each row's own key picker
    // resolves the tune's native key) — the two title clicks below are what
    // this test cares about, so it grabs the *latest* call after each one
    // rather than assuming fixed indices.
    const calls = [];
    ctx.readFile = (path, onLoad) => calls.push({ path, onLoad });
    view.renderOpen(entry.name, entry.songs, entry, "");

    const [titleA, titleB] = document.querySelectorAll(SONG_TITLE_SELECTOR);
    titleA.dispatchEvent(new window.Event("click")); // start loading A
    const loadA = calls[calls.length - 1];
    titleB.dispatchEvent(new window.Event("click")); // switch to B before A lands
    const loadB = calls[calls.length - 1];

    loadB.onLoad("X:1\nK:F\nF2|"); // B resolves
    loadA.onLoad("X:1\nK:Bb\nB2|"); // stale A resolves afterwards

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
    // The most recent read is this open, not one of the rows' own native-key
    // prefetches fired earlier by renderOpen.
    assert.equal(loads[loads.length - 1].path, "/songs/b.abc");
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

// The "Listen" button under the Print row: initControls() registers a
// listen-change handler with ctx.setlistPrint (the real setlist-print.js
// calls it once its per-song reads settle) that keeps the button's enabled
// state and title in step, and a click opens whatever URL getListenUrl()
// currently reports.
test("the Listen button tracks setlistPrint's listen-change callback and opens its URL", () => {
  let listenChanged = null;
  let currentUrl = null;
  const opened = [];
  const page = mountPage();
  const originalOpen = window.open;
  try {
    const ctx = makeCtx({
      setlistModal: { init: () => {} },
      setlistPrint: {
        buildBooklet: () => {},
        print: () => {},
        setListenChangeHandler: (fn) => { listenChanged = fn; },
        getListenUrl: () => currentUrl,
      },
    });
    const view = createSetlistView(ctx);
    view.initControls();

    const btn = document.getElementById("listenYoutubeBtn");
    assert.equal(typeof listenChanged, "function");

    window.open = (...args) => opened.push(args);
    btn.click();
    assert.equal(opened.length, 0, "disabled with no URL yet — nothing opened");

    currentUrl = "https://www.youtube.com/watch_videos?video_ids=aaaaaaaaaaa";
    listenChanged(currentUrl);
    assert.equal(btn.disabled, false);
    assert.match(btn.title, /Open/);

    btn.click();
    assert.deepEqual(opened, [[currentUrl, "_blank", "noopener"]]);

    listenChanged(null);
    assert.equal(btn.disabled, true);
    assert.match(btn.title, /No YouTube links/);
  } finally {
    window.open = originalOpen;
    page.cleanup();
  }
});

// ---- the open song's index pointer survives structural edits ------------
// Splitting, merging, removing and adding all shift the item indices that
// follow the edit; the pointer to the open song (highlight, Up/Down stepping,
// the Key stepper's write-back) must be carried along with its song.

function openSongAt(ctx, view, file, index) {
  ctx.readFile = (path, onLoad) => onLoad(MINIMAL_ABC);
  assert.ok(view.openSongAtIndex(index), `opened ${file}`);
  assert.equal(ctx.state.currentSongFile, file);
}

const currentRowFile = () => {
  const row = document.querySelector(".setlist-song-row.is-current-song");
  return row ? row.dataset.songFile : null;
};

test("splitting a set above the open song keeps its pointer and highlight", () => {
  const { view, ctx, entry, cleanup } = setup({
    songs: [{ file: "a.abc" }, { file: "b.abc" }, { file: "c.abc" }],
  });
  try {
    view.initControls();
    view.renderOpen(entry.name, entry.songs, entry, "");
    openSongAt(ctx, view, "c.abc", 2);
    document.querySelectorAll(".setlist-split-btn")[0].click(); // new set before b
    assert.equal(ctx.state.currentSetlistSongIndex, 3, "c moved from item 2 to item 3");
    assert.equal(currentRowFile(), "c.abc");
  } finally {
    cleanup();
  }
});

test("merging a set (removing its heading) keeps the open song's pointer", () => {
  const { view, ctx, entry, cleanup } = setup({
    songs: [{ file: "a.abc" }, { divider: "Two" }, { file: "b.abc" }, { file: "c.abc" }],
  });
  try {
    view.initControls();
    view.renderOpen(entry.name, entry.songs, entry, "");
    openSongAt(ctx, view, "c.abc", 3);
    document.querySelector(".setlist-set-merge").click();
    assert.equal(ctx.state.currentSetlistSongIndex, 2);
    assert.equal(currentRowFile(), "c.abc");
  } finally {
    cleanup();
  }
});

test("removing a song above the open one keeps its pointer; removing the open one drops it", () => {
  const { view, ctx, entry, cleanup } = setup({
    songs: [{ file: "a.abc" }, { file: "b.abc" }, { file: "c.abc" }],
  });
  try {
    view.initControls();
    view.renderOpen(entry.name, entry.songs, entry, "");
    openSongAt(ctx, view, "c.abc", 2);
    document.querySelectorAll(REMOVE_SELECTOR)[0].click();
    assert.equal(ctx.state.currentSetlistSongIndex, 1);
    assert.equal(currentRowFile(), "c.abc");
    document.querySelectorAll(REMOVE_SELECTOR)[1].click(); // the open one
    assert.equal(ctx.state.currentSetlistSongIndex, null);
  } finally {
    cleanup();
  }
});

test("adding a song into an earlier set keeps the open song's pointer", () => {
  const { view, ctx, entry, cleanup } = setup({
    songs: [{ file: "a.abc" }, { divider: "Two" }, { file: "c.abc" }],
  });
  try {
    view.initControls();
    view.renderOpen(entry.name, entry.songs, entry, "");
    openSongAt(ctx, view, "c.abc", 2);
    document.querySelector(".setlist-set-add").click(); // aim at the end of set 1
    view.addSongByFile("x.abc");
    assert.equal(ctx.state.currentSetlistSongIndex, 3);
    assert.equal(currentRowFile(), "c.abc");
  } finally {
    cleanup();
  }
});

test("naming set 1 (inserting a leading heading) keeps the open song's pointer", () => {
  const { view, ctx, entry, cleanup } = setup({
    songs: [{ file: "a.abc" }, { divider: "Two" }, { file: "c.abc" }],
  });
  try {
    view.initControls();
    view.renderOpen(entry.name, entry.songs, entry, "");
    openSongAt(ctx, view, "c.abc", 2);
    const input = document.querySelector(".setlist-set .setlist-divider-input");
    input.value = "Opener";
    input.dispatchEvent(new window.Event("change"));
    assert.equal(ctx.state.currentSetlistSongIndex, 3);
    assert.equal(currentRowFile(), "c.abc");
  } finally {
    cleanup();
  }
});
