import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx, memoryStorage } from "../../../../tests/helpers/ctx.js";
import { createPersonalSetlist } from "../../lib/setlists/setlists-store.js";
import { createNavigation } from "./navigation.js";

function setup({ url, state = {}, storage = memoryStorage() } = {}) {
  const page = mountPage(url ? { url } : {});
  document.title = "Red Jackets Jazzband - Songs";
  const calls = [];
  const ctx = makeCtx({
    state,
    storage: () => storage,
    songName: (file) => (file === "basin_street.abc" ? "Basin Street Blues" : file),
    sheet: { renderFromFile: (file) => calls.push(`render:${file}`) },
  });
  ctx.library = {
    render: () => calls.push("library.render"),
    stepLibrarySong: (dir) => calls.push(`library.step:${dir}`),
    canStepLibrary: () => true,
  };
  ctx.setlistHome = { show: () => calls.push("setlistHome.show") };
  ctx.setlistView = {
    openBand: (file, name, then) => {
      calls.push(`openBand:${file}`);
      if (then) then();
    },
    openPersonal: (id, then) => {
      calls.push(`openPersonal:${id}`);
      if (then) then();
    },
    openSongInOpenSetlist: (slug) => calls.push(`openSong:${slug}`),
    stepSong: (dir) => calls.push(`setlist.step:${dir}`),
    canStep: () => false,
  };
  ctx.inspiration = { applyShareState: (s) => calls.push(`share:${s.a}-${s.b}`) };
  // A fresh service, created after the page's URL is in place (it reads the
  // load-time hash when created, like the app).
  ctx.nav = createNavigation(ctx);
  return { ctx, calls, storage, cleanup: page.cleanup };
}

test("opening a Library song puts it in the hash and the tab title", () => {
  const { ctx, calls, cleanup } = setup();
  try {
    ctx.nav.openLibrarySong({ file: "basin_street.abc" }, { index: 4, name: "Basin Street" });
    assert.equal(window.location.hash, "#s=basin_street");
    assert.equal(document.title, "Red Jackets Jazzband - Songs - Basin Street Blues");
    assert.equal(ctx.state.currentLibraryIndex, 4);
    assert.equal(ctx.state.currentLibrarySongName, "Basin Street");
    assert.equal(document.getElementById("sheetBackLabel").textContent, "Songs");
    assert.deepEqual(calls, ["render:basin_street.abc"]);
  } finally {
    cleanup();
  }
});

test("a setlist and its song both land in the hash; leaving the setlist keeps the song", () => {
  const { ctx, cleanup } = setup();
  try {
    ctx.nav.enterSetlist({ id: "setlist_2026" });
    ctx.nav.showSetlistContents({ songs: [{ file: "basin_street.abc" }], name: "Gig" });
    assert.equal(window.location.hash, "#sl=setlist_2026");
    assert.equal(document.title, "Red Jackets Jazzband - Songs - Gig");
    assert.equal(ctx.state.setlistsView, "open");

    ctx.nav.selectSetlistSong("basin_street.abc", "0");
    assert.equal(ctx.state.currentSetlistSongIndex, 0);
    assert.equal(window.location.hash, "#sl=setlist_2026&s=basin_street");
    assert.equal(document.getElementById("sheetBackLabel").textContent, "Setlist");

    ctx.nav.leaveSetlist();
    assert.equal(ctx.state.setlistsView, "home");
    assert.equal(ctx.state.currentOpenSongs, null);
    assert.equal(window.location.hash, "#s=basin_street");
  } finally {
    cleanup();
  }
});

test("entering a setlist drops the previous song pointer", () => {
  const { ctx, cleanup } = setup({ state: { currentSongFile: "x.abc", currentSetlistSongIndex: 3 } });
  try {
    ctx.nav.enterSetlist({ id: "p1", personalId: "p1" });
    assert.equal(ctx.state.currentSongFile, null);
    assert.equal(ctx.state.currentSetlistSongIndex, null);
    assert.equal(ctx.state.currentPersonalId, "p1");
    ctx.nav.forgetPersonal("other");
    assert.equal(ctx.state.currentPersonalId, "p1");
    ctx.nav.forgetPersonal("p1");
    assert.equal(ctx.state.currentPersonalId, null);
  } finally {
    cleanup();
  }
});

test("switchTab shows the tab's own tools and list", () => {
  const { ctx, calls, cleanup } = setup({ state: { currentSetlistId: "s" } });
  try {
    ctx.nav.switchTab("setlists");
    assert.equal(ctx.state.activeTab, "setlists");
    assert.equal(document.getElementById("librarySearchRow").hidden, true);
    ctx.nav.switchTab("library");
    assert.equal(ctx.state.currentSetlistId, null);
    assert.equal(document.getElementById("librarySearchRow").hidden, false);
    assert.deepEqual(calls, ["setlistHome.show", "library.render"]);
  } finally {
    cleanup();
  }
});

test("step routes to the list the sidebar is showing", () => {
  const { ctx, calls, cleanup } = setup();
  try {
    ctx.nav.step(1);
    ctx.state.activeTab = "setlists";
    ctx.nav.step(1); // setlists home: nothing to step through
    ctx.state.setlistsView = "open";
    ctx.nav.step(-1);
    assert.deepEqual(calls, ["library.step:1", "setlist.step:-1"]);
    assert.equal(ctx.nav.canStep(1), false);
  } finally {
    cleanup();
  }
});

test("a deep link to a band setlist waits for the setlist index, then opens its song", () => {
  const { ctx, calls, cleanup } = setup({ url: "https://example.test/songs/#sl=setlist_2026&s=basin_street" });
  try {
    ctx.nav.start();
    assert.equal(calls.includes("openBand:setlist_2026.txt"), false, "no index yet");
    ctx.store.set("catalog", { setlistIndex: [{ name: "2026", file: "setlist_2026.txt" }] });
    assert.equal(ctx.nav.setlistIndexLoaded(), true);
    assert.ok(calls.includes("openBand:setlist_2026.txt"));
    assert.equal(calls.at(-1), "openSong:basin_street");
    assert.equal(ctx.nav.setlistIndexLoaded(), false, "only once");
  } finally {
    cleanup();
  }
});

test("a deep link to a personal setlist opens it straight away", () => {
  const storage = memoryStorage();
  const entry = createPersonalSetlist(storage, "Mine");
  const { ctx, calls, cleanup } = setup({ url: `https://example.test/songs/#sl=${entry.id}`, storage });
  try {
    ctx.nav.start();
    assert.ok(calls.includes(`openPersonal:${entry.id}`));
  } finally {
    cleanup();
  }
});

test("an unknown setlist id falls back to opening the song from the Library", () => {
  const { ctx, calls, cleanup } = setup({ url: "https://example.test/songs/#sl=gone&s=basin_street" });
  try {
    ctx.store.set("catalog", { setlistIndex: [{ name: "2026", file: "setlist_2026.txt" }] });
    ctx.nav.start();
    assert.equal(ctx.state.activeTab, "library");
    assert.equal(calls.at(-1), "render:basin_street.abc");
  } finally {
    cleanup();
  }
});

test("a shared loop link arms the Inspiration panel; shareUrl builds one", () => {
  const { ctx, calls, cleanup } = setup({ url: "https://example.test/songs/#s=basin_street&a=1.5&b=4&i=1" });
  try {
    ctx.nav.start();
    assert.equal(calls[0], "share:1.5-4");
    assert.equal(
      ctx.nav.shareUrl({ a: 2, b: 3 }),
      "https://example.test/songs/#s=basin_street&a=2&b=3",
    );
    assert.equal(ctx.nav.shareUrl(), "https://example.test/songs/#s=basin_street&i=1");
  } finally {
    cleanup();
  }
});
