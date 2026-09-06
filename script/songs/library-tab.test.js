import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createLibraryTab } from "./library-tab.js";

const SONGS = [
  { name: "All of Me", file: "all_of_me.abc" },
  { name: "Basin Street Blues", file: "basin_street.abc" },
  { name: "Bill Bailey", file: "bill_bailey.abc" },
  { name: "Corrine Corrina", file: "corrine.abc" },
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
    assert.equal(opened.at(-1).file, "corrine.abc");
    assert.equal(search.value, "");
    // Focus leaves the field so Spacebar plays the song immediately.
    assert.notEqual(document.activeElement, search);
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
