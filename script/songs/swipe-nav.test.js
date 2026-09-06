import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createLibraryTab } from "./library-tab.js";
import { createSwipeNav } from "./swipe-nav.js";

const SONGS = [
  { name: "All of Me", file: "all_of_me.abc" },
  { name: "Basin Street Blues", file: "basin_street.abc" },
  { name: "Bill Bailey", file: "bill_bailey.abc" },
];

function fireTouch(target, type, point) {
  const evt = new window.Event(type, { bubbles: true });
  const touches = point ? [{ clientX: point.x, clientY: point.y }] : [];
  Object.defineProperty(evt, type === "touchend" ? "changedTouches" : "touches", { value: touches });
  Object.defineProperty(evt, type === "touchend" ? "touches" : "changedTouches", { value: [] });
  target.dispatchEvent(evt);
}

function swipe(target, from, to) {
  fireTouch(target, "touchstart", from);
  fireTouch(target, "touchend", to);
}

function setup(overrides = {}) {
  const page = mountPage();
  const stepped = [];
  const ctx = makeCtx({
    state: { allSongs: SONGS, activeTab: "library" },
    setlistView: { stepSong: (dir) => stepped.push(dir) },
    ...overrides,
  });
  ctx.library = createLibraryTab(ctx);
  createSwipeNav(ctx).init();
  return { page, ctx, stepped, cleanup: page.cleanup };
}

test("swipe left opens the next library song, right the previous", () => {
  const { ctx, cleanup } = setup();
  try {
    const opened = [];
    ctx.openLibrarySong = (song) => { opened.push(song.file); };
    ctx.library.render("");
    ctx.state.currentSongFile = "basin_street.abc";
    const sheet = document.getElementById("notation");

    swipe(sheet, { x: 240, y: 100 }, { x: 120, y: 108 });
    assert.equal(opened.at(-1), "bill_bailey.abc");

    ctx.state.currentSongFile = "basin_street.abc";
    swipe(sheet, { x: 120, y: 100 }, { x: 240, y: 108 });
    assert.equal(opened.at(-1), "all_of_me.abc");
  } finally {
    cleanup();
  }
});

test("swipe clamps at the ends of the library list", () => {
  const { ctx, cleanup } = setup();
  try {
    const opened = [];
    ctx.openLibrarySong = (song) => { opened.push(song.file); };
    ctx.library.render("");
    ctx.state.currentSongFile = "all_of_me.abc";
    swipe(document.getElementById("notation"), { x: 120, y: 100 }, { x: 240, y: 108 });
    assert.equal(opened.length, 0);
  } finally {
    cleanup();
  }
});

test("in an open setlist a swipe steps the setlist song", () => {
  const { stepped, cleanup } = setup({
    state: { activeTab: "setlists", setlistsView: "open" },
  });
  try {
    const sheet = document.getElementById("notation");
    swipe(sheet, { x: 240, y: 100 }, { x: 120, y: 108 });
    swipe(sheet, { x: 120, y: 100 }, { x: 240, y: 108 });
    assert.deepEqual(stepped, [1, -1]);
  } finally {
    cleanup();
  }
});

test("a swipe that begins on the control bar is left to the controls", () => {
  const { stepped, cleanup } = setup({
    state: { activeTab: "setlists", setlistsView: "open" },
  });
  try {
    swipe(document.getElementById("sheetmenu"), { x: 240, y: 100 }, { x: 120, y: 108 });
    assert.deepEqual(stepped, []);
  } finally {
    cleanup();
  }
});

test("a mostly-vertical drag scrolls instead of navigating", () => {
  const { stepped, cleanup } = setup({
    state: { activeTab: "setlists", setlistsView: "open" },
  });
  try {
    swipe(document.getElementById("notation"), { x: 200, y: 80 }, { x: 180, y: 260 });
    assert.deepEqual(stepped, []);
  } finally {
    cleanup();
  }
});
