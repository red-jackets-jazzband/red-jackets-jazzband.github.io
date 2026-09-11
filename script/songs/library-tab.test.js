import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createLibraryTab } from "./library-tab.js";

const CORRINE_FILE = "corrine.abc";
const SONG_ROW_SELECTOR = "a.song-list-item";

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
    assert.equal(list.querySelectorAll(SONG_ROW_SELECTOR).length, 4);
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
      [...list.querySelectorAll(SONG_ROW_SELECTOR)].map((a) => a.textContent),
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
    const row = document.querySelector(SONG_ROW_SELECTOR);
    const event = new window.Event("click", { cancelable: true, bubbles: true });
    row.dispatchEvent(event);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].file, "all_of_me.abc");
    assert.equal(event.defaultPrevented, true);
  } finally {
    cleanup();
  }
});

test("clicking a row among multiple search results clears the search", () => {
  const { tab, opened, cleanup } = setup();
  try {
    tab.init();
    const search = document.getElementById("songSearch");
    search.value = "b";
    search.dispatchEvent(new window.Event("input"));
    const rows = [...document.querySelectorAll(SONG_ROW_SELECTOR)];
    assert.equal(rows.length, 2);

    rows[0].dispatchEvent(new window.Event("click", { cancelable: true, bubbles: true }));
    assert.equal(opened.at(-1).file, "basin_street.abc");
    assert.equal(search.value, "");
    assert.equal(document.querySelectorAll(SONG_ROW_SELECTOR).length, 4);
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

test("ArrowDown after clicking a row roves from that row, not from the top", () => {
  const { tab, ctx, cleanup } = setup();
  try {
    tab.init();
    tab.render("");
    const rows = [...document.querySelectorAll(SONG_ROW_SELECTOR)];
    // Click "Bill Bailey" (index 2) directly, as a mouse user would — no
    // kbd-active highlight gets set by a click.
    rows[2].dispatchEvent(new window.Event("click", { cancelable: true, bubbles: true }));
    ctx.state.currentSongFile = "bill_bailey.abc";

    document.getElementById("songSearch").dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    assert.equal(
      document.querySelector("a.song-list-item.kbd-active").textContent,
      "Corrine Corrina",
    );
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
    const rows = [...document.querySelectorAll(SONG_ROW_SELECTOR)];
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

test("ArrowDown after picking a search result then clearing search roves from that occurrence", () => {
  // Regression test: clicking a search result clears the search, which
  // re-renders the full grouped list at completely different row positions.
  // The remembered index from the filtered list is stale there, and a
  // file-only fallback isn't enough to recover it when — as here — two
  // aliases share the same file: it must resolve to the occurrence actually
  // picked ("It ain't my fault"), not the file's first occurrence
  // ("Ain't my fault").
  const FAULT_FILE = "aint_my_fault.abc";
  const DUPES = [
    { name: "Ain't my fault", file: FAULT_FILE },
    { name: "All of Me", file: "all_of_me.abc" },
    { name: "Basin Street Blues", file: "basin_street.abc" },
    { name: "It ain't my fault", file: FAULT_FILE },
    { name: "Java Jive", file: "java_jive.abc" },
  ];
  const { tab, ctx, opened, cleanup } = setup({ state: { allSongs: DUPES, activeTab: "library" } });
  try {
    tab.init();
    const search = document.getElementById("songSearch");
    search.value = "fault";
    search.dispatchEvent(new window.Event("input"));
    const results = [...document.querySelectorAll(SONG_ROW_SELECTOR)];
    assert.deepEqual(results.map((r) => r.textContent), ["Ain't my fault", "It ain't my fault"]);

    results[1].dispatchEvent(new window.Event("click", { cancelable: true, bubbles: true }));
    assert.equal(opened.at(-1).name, "It ain't my fault");
    ctx.state.currentSongFile = FAULT_FILE;
    // The full grouped list is back, in a different order than the search
    // results: Ain't my fault, All of Me, Basin Street Blues, It ain't my
    // fault, Java Jive.
    assert.equal(search.value, "");

    search.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(
      document.querySelector("a.song-list-item.kbd-active").textContent,
      "Java Jive",
    );
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
