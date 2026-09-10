import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createLibraryTab } from "./library-tab.js";

const CORRINE_FILE = "corrine.abc";

const SONGS = [
  { name: "All of Me", file: "all_of_me.abc" },
  { name: "Basin Street Blues", file: "basin_street.abc" },
  { name: "Bill Bailey", file: "bill_bailey.abc" },
  { name: "Corrine Corrina", file: CORRINE_FILE },
];

function setup(overrides = {}) {
  const page = mountPage();
  const opened = [];
  const ctx = makeCtx({
    state: { allSongs: SONGS, activeTab: "library" },
    openLibrarySong: (song) => opened.push(song),
    ...overrides,
  });
  const tab = createLibraryTab(ctx);
  return { page, ctx, tab, opened, cleanup: page.cleanup };
}

test("render groups songs by letter and builds the A-Z rail", () => {
  const { tab, cleanup } = setup();
  try {
    tab.render("");
    const list = document.getElementById("songList");
    assert.deepEqual(
      [...list.querySelectorAll(".song-list-letter")].map((h) => h.textContent),
      ["A", "B", "C"],
    );
    assert.equal(list.querySelectorAll("a.song-list-item").length, 4);
    assert.deepEqual(
      [...document.getElementById("songRail").querySelectorAll("button")].map((b) => b.textContent),
      ["A", "B", "C"],
    );
  } finally {
    cleanup();
  }
});

test("render filters on a query and clears the rail", () => {
  const { tab, cleanup } = setup();
  try {
    tab.render("bi");
    const list = document.getElementById("songList");
    assert.deepEqual(
      [...list.querySelectorAll("a.song-list-item")].map((a) => a.textContent),
      ["Bill Bailey"],
    );
    assert.equal(list.querySelectorAll(".song-list-letter").length, 0);
    assert.equal(document.getElementById("songRail").childElementCount, 0);
  } finally {
    cleanup();
  }
});

test("render shows an empty state for a query with no matches", () => {
  const { tab, cleanup } = setup();
  try {
    tab.render("zzz");
    assert.equal(
      document.querySelector("#songList .song-list-empty").textContent,
      "No songs match your search.",
    );
  } finally {
    cleanup();
  }
});

test("clicking a row opens the song and suppresses navigation", () => {
  const { tab, opened, cleanup } = setup();
  try {
    tab.render("");
    const row = document.querySelector("a.song-list-item");
    const event = new window.Event("click", { cancelable: true, bubbles: true });
    row.dispatchEvent(event);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].file, "all_of_me.abc");
    assert.equal(event.defaultPrevented, true);
  } finally {
    cleanup();
  }
});

test("ArrowDown roves a highlight through the results; Enter opens it", () => {
  const { tab, opened, cleanup } = setup();
  try {
    tab.init();
    tab.render("");
    const search = document.getElementById("songSearch");
    search.focus();
    const arrowDown = () => search.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    arrowDown();
    assert.equal(document.querySelector("a.song-list-item.kbd-active").textContent, "All of Me");
    arrowDown();
    assert.equal(
      document.querySelector("a.song-list-item.kbd-active").textContent,
      "Basin Street Blues",
    );

    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(opened.at(-1).file, "basin_street.abc");
  } finally {
    cleanup();
  }
});

test("Enter opens the sole search result and clears the query", () => {
  const { tab, opened, cleanup } = setup();
  try {
    tab.init();
    const search = document.getElementById("songSearch");
    search.value = "corrine";
    search.dispatchEvent(new window.Event("input"));
    search.focus();
    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(opened.at(-1).file, CORRINE_FILE);
    assert.equal(search.value, "");
    // Focus leaves the field so Spacebar plays the song immediately.
    assert.notEqual(document.activeElement, search);
  } finally {
    cleanup();
  }
});

test("stepLibrarySong advances past a song file that appears twice in the index", () => {
  // "Corrine Corrina" is aliased twice under the same file, as several real
  // songs in index_of_songs.txt are (an alternate title pointing at the same
  // .abc). Swiping forward from the second occurrence must land on the next
  // row in the rendered list, not resolve back to the first occurrence's
  // neighbor.
  const DUPES = [
    { name: "All of Me", file: "all_of_me.abc" },
    { name: "Corrine Corrina", file: CORRINE_FILE },
    { name: "Corrine (alt title)", file: CORRINE_FILE },
    { name: "Deep River Blues", file: "deep_river.abc" },
  ];
  const { tab, ctx, opened, cleanup } = setup({ state: { allSongs: DUPES, activeTab: "library" } });
  try {
    tab.render("");
    const rows = [...document.querySelectorAll("a.song-list-item")];
    // Rows render alphabetically: All of Me, Corrine Corrina, Corrine (alt
    // title), Deep River Blues. Click the *second* row for CORRINE_FILE
    // directly, as a user would.
    rows[2].dispatchEvent(new window.Event("click", { cancelable: true, bubbles: true }));
    assert.equal(ctx.state.currentLibraryIndex, 2);

    ctx.state.currentSongFile = CORRINE_FILE;
    tab.stepLibrarySong(1);
    assert.equal(opened.at(-1).file, "deep_river.abc");
  } finally {
    cleanup();
  }
});

test("'/' focuses the search box unless already typing", () => {
  const { tab, cleanup } = setup();
  try {
    tab.init();
    document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "/", bubbles: true }));
    assert.equal(document.activeElement, document.getElementById("songSearch"));
  } finally {
    cleanup();
  }
});
