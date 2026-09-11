import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createAbcjsStub, withAbcjs } from "../../../tests/helpers/stubs.js";
import { createSetlistPrint } from "./setlist-print.js";

// Flushes any number of chained microtask hops (font-load promise ->
// Promise.all -> refit -> readSettled is a few) — a macrotask boundary is the
// simplest way to guarantee they've all run, same pattern used elsewhere in
// this suite (audio-player.test.js, wav-export.test.js).
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

const ABC = {
  "a.abc": "X:1\nT:Song A\nQ:1/4=120\nK:Bb\nB2|",
  "b.abc": "X:1\nT:Song B\nQ:1/4=90\nK:F\nF2|",
};

function setup(instrument = "concert_pitch") {
  const page = mountPage();
  const sel = document.createElement("select");
  sel.id = "instrument";
  const o = document.createElement("option");
  o.value = instrument;
  sel.append(o);
  document.getElementById("sheetStatus").append(sel);

  const bookletRenders = [];
  const pending = [];
  const ctx = makeCtx({
    songName: (f) => f.replace(".abc", "").toUpperCase(),
    // async like the real XHR helper — the stage list is appended before these
    // callbacks fire, so per-song meta lands in cells that already exist.
    readFile: (path, onLoad) => {
      const file = path.split("/").pop();
      if (ABC[file]) pending.push(Promise.resolve().then(() => onLoad(ABC[file])));
    },
    sheet: { renderIntoBooklet: (text, targets) => bookletRenders.push(targets) },
  });
  const print = createSetlistPrint(ctx);
  const settle = () => Promise.all(pending);
  return { page, ctx, print, bookletRenders, settle, cleanup: page.cleanup };
}

const SONGS = [
  { file: "a.abc", key: "" },
  { file: "b.abc", key: "2" },
  { divider: "Set 2" },
  { file: "a.abc", key: "" },
];

test("buildBooklet lays out front matter, per-song blocks and the stage list", async () => {
  const { print, bookletRenders, settle, cleanup } = setup();
  try {
    withAbcjs(createAbcjsStub(), () => print.buildBooklet("Gig", SONGS, ""));
    await settle();
    const container = document.getElementById("setlistPrintBooklet");

    assert.equal(container.querySelector(".setlist-booklet-fm-title").textContent, "Gig");
    // one engraved block per song (3), each targeting its own ids
    assert.equal(container.querySelectorAll(".setlist-booklet-song").length, 3);
    assert.equal(bookletRenders.length, 3);
    assert.equal(bookletRenders[0].notationId, "setlistPrintNotation-1");
    assert.equal(bookletRenders[0].titlePrefix, "1. ");

    // stage list: per-set numbering, a "Set 2" row, tempo filled from Q:
    const stageRows = [...container.querySelectorAll(".setlist-stage-table tbody tr")];
    assert.deepEqual(
      stageRows.filter((r) => r.querySelector(".stage-c-num")).map((r) => r.querySelector(".stage-c-num").textContent),
      ["1.", "2.", "1."],
    );
    assert.ok(stageRows.some((r) => r.querySelector("th") && r.querySelector("th").textContent === "Set 2"));
    assert.equal(document.getElementById("setlistStageTempo-1").textContent, "120");
    assert.equal(document.getElementById("setlistStageConcert-2").textContent, "G"); // F + 2
  } finally {
    cleanup();
  }
});

test("a transposing instrument adds its own key column", async () => {
  const { print, settle, cleanup } = setup("trumpet");
  try {
    withAbcjs(createAbcjsStub(), () => print.buildBooklet("Gig", SONGS, ""));
    await settle();
    const heads = [...document.querySelectorAll(".setlist-stage-table thead th")].map((h) => h.textContent);
    assert.ok(heads.includes("Trumpet"));
    assert.equal(document.getElementById("setlistStageInstr-1").textContent, "C"); // Bb + trumpet +2
  } finally {
    cleanup();
  }
});

test("print(mode) stamps the body classes and the front-matter subtitle", async () => {
  const { print, settle, cleanup } = setup();
  try {
    window.print = () => {};
    withAbcjs(createAbcjsStub(), () => print.buildBooklet("Gig", SONGS, ""));
    await settle();
    print.print("chordbook");
    assert.ok(document.body.classList.contains("export-booklet-mode"));
    assert.ok(document.body.classList.contains("export-mode-chordbook"));
    assert.equal(document.getElementById("setlistBookletFmSub").textContent, "Chordbook");
    window.dispatchEvent(new window.Event("afterprint"));
    assert.equal(document.body.classList.contains("export-booklet-mode"), false);
  } finally {
    cleanup();
  }
});

// A setup whose reads are resolved by hand, so a test can interleave them
// with a rebuild or a print() call.
function manualSetup() {
  const page = mountPage();
  const sel = document.createElement("select");
  sel.id = "instrument";
  const o = document.createElement("option");
  o.value = "concert_pitch";
  sel.append(o);
  document.getElementById("sheetStatus").append(sel);

  const bookletRenders = [];
  const reads = [];
  const ctx = makeCtx({
    songName: (f) => f.replace(".abc", "").toUpperCase(),
    readFile: (path, onLoad) => {
      const file = path.split("/").pop();
      reads.push({ file, onLoad });
    },
    sheet: { renderIntoBooklet: (text, targets) => bookletRenders.push(targets) },
  });
  const print = createSetlistPrint(ctx);
  return { print, bookletRenders, reads, cleanup: page.cleanup };
}

test("a stale read from a superseded booklet build is ignored", () => {
  const { print, bookletRenders, reads, cleanup } = manualSetup();
  try {
    withAbcjs(createAbcjsStub(), () => {
      print.buildBooklet("Gig", SONGS, "");
      const stale = reads.shift(); // first song of build 1
      reads.length = 0;
      print.buildBooklet("Gig", SONGS, ""); // build 2 recreates the ids
      const fresh = [...reads];
      stale.onLoad(ABC[stale.file]); // late build-1 callback
      fresh.forEach((r) => r.onLoad(ABC[r.file]));
    });
    // Only build 2's three reads rendered; the stale one was dropped.
    assert.equal(bookletRenders.length, 3);
  } finally {
    cleanup();
  }
});

test("print() waits for the booklet's song reads before opening the dialog", async () => {
  const { print, reads, cleanup } = manualSetup();
  try {
    let printed = 0;
    window.print = () => { printed += 1; };
    withAbcjs(createAbcjsStub(), () => {
      print.buildBooklet("Gig", SONGS, "");
      print.print("songbook");
      assert.equal(printed, 0, "held while reads are outstanding");
      reads.forEach((r) => r.onLoad(ABC[r.file]));
    });
    // The song reads have all landed, but the title page's own font-fit read
    // (see below) settles via a promise microtask, not synchronously.
    assert.equal(printed, 0, "still held on the title page's own pending read");
    await flush();
    assert.equal(printed, 1, "fires once every read has landed");
  } finally {
    cleanup();
  }
});

test("a held print() shows a song-by-song progress line, then clears it", async () => {
  const { print, reads, cleanup } = manualSetup();
  try {
    window.print = () => {};
    const status = document.getElementById("setlistPrintStatus");
    withAbcjs(createAbcjsStub(), () => {
      print.buildBooklet("Gig", SONGS, "");
      print.print("songbook");
      assert.equal(status.hidden, false);
      assert.match(status.textContent, /Preparing the songbook — 0 of 4 songs/);

      reads[0].onLoad(ABC[reads[0].file]);
      assert.match(status.textContent, /1 of 4 songs/);

      reads.slice(1).forEach((r) => r.onLoad(ABC[r.file]));
    });
    assert.equal(status.hidden, false, "still held on the title page's own pending read");
    await flush();
    assert.equal(status.hidden, true);
    assert.equal(status.textContent, "");
  } finally {
    cleanup();
  }
});

test("print() also waits for the title page's font-fit against Saniretro/AkuraPopo", async () => {
  const { print, reads, cleanup } = manualSetup();
  let resolveFonts;
  // Both the Saniretro and AkuraPopo load() calls resolve off this one
  // controllable promise — the point here is just "fonts still loading", not
  // distinguishing the two faces.
  const fontsPromise = new Promise((resolve) => { resolveFonts = resolve; });
  document.fonts = { load: () => fontsPromise };
  try {
    let printed = 0;
    window.print = () => { printed += 1; };
    withAbcjs(createAbcjsStub(), () => {
      print.buildBooklet("Gig", SONGS, "");
      print.print("songbook");
      assert.equal(printed, 0, "held before anything has landed");
      reads.forEach((r) => r.onLoad(ABC[r.file]));
    });
    assert.equal(printed, 0, "song reads alone aren't enough — the fonts are still loading");

    resolveFonts();
    await flush();
    assert.equal(printed, 1, "fires once the fonts have loaded and the title has been refit");
  } finally {
    delete document.fonts;
    cleanup();
  }
});

test("a personal-setlist desc adds a cover page", async () => {
  const { print, settle, cleanup } = setup();
  try {
    withAbcjs(createAbcjsStub(), () => print.buildBooklet("Gig", SONGS, "Our summer set"));
    await settle();
    const cover = document.querySelector("#setlistPrintBooklet .setlist-cover");
    assert.ok(cover);
    assert.equal(cover.querySelector("p").textContent, "Our summer set");
  } finally {
    cleanup();
  }
});

test("buildBooklet adds a generic-branded title page for a non-N.O.A.D.S. setlist", async () => {
  const { ctx, print, settle, cleanup } = setup();
  try {
    ctx.state.currentSetlistId = "setlist_2026";
    withAbcjs(createAbcjsStub(), () => print.buildBooklet("Setlist 2026", SONGS, ""));
    await settle();
    const titlepage = document.querySelector("#setlistPrintBooklet .setlist-titlepage");
    assert.ok(titlepage);
    assert.equal(titlepage.querySelector(".setlist-titlepage-title").textContent, "Red Jackets");
    assert.equal(titlepage.querySelector(".setlist-titlepage-name").textContent, "Setlist 2026");
    assert.equal(titlepage.querySelector(".setlist-titlepage-instrument").textContent, "concert pitch");
  } finally {
    cleanup();
  }
});

test("buildBooklet keeps the original N.O.A.D.S. branding for that band setlist", async () => {
  const { ctx, print, settle, cleanup } = setup();
  try {
    ctx.state.currentSetlistId = "noads_songbook";
    withAbcjs(createAbcjsStub(), () => print.buildBooklet("N.O.A.D.S. Songbook", SONGS, ""));
    await settle();
    const titlepage = document.querySelector("#setlistPrintBooklet .setlist-titlepage");
    assert.equal(titlepage.querySelector(".setlist-titlepage-title").textContent, "N.O.A.D.S.");
    assert.equal(titlepage.querySelector(".setlist-titlepage-name").textContent, "streetclassics");
  } finally {
    cleanup();
  }
});
