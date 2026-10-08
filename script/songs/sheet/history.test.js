import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
import { createSongHistory } from "./history.js";

function setup() {
  const page = mountPage();
  const ctx = makeCtx();
  const history = createSongHistory(ctx);
  history.init();
  const btn = document.getElementById("historyBtn");
  const panel = document.getElementById("songHistory");
  const openSong = (paragraphs) => {
    ctx.store.set("tune", { history: paragraphs, songSerial: ctx.state.songSerial + 1 });
  };
  return { ctx, btn, panel, openSong, cleanup: page.cleanup };
}

test("the button is hidden for a tune without history", () => {
  const { btn, panel, openSong, cleanup } = setup();
  try {
    openSong([]);
    assert.equal(btn.hidden, true);
    assert.equal(panel.hidden, true);
  } finally {
    cleanup();
  }
});

test("clicking the button toggles the panel with the tune's paragraphs", () => {
  const { btn, panel, openSong, cleanup } = setup();
  try {
    openSong(["First.", "Second."]);
    assert.equal(btn.hidden, false);
    assert.equal(panel.hidden, true);

    btn.dispatchEvent(new window.Event("click"));
    assert.equal(panel.hidden, false);
    assert.equal(btn.getAttribute("aria-expanded"), "true");
    assert.equal(btn.classList.contains("active"), true);
    assert.deepEqual([...panel.querySelectorAll("p")].map((p) => p.textContent), ["First.", "Second."]);

    btn.dispatchEvent(new window.Event("click"));
    assert.equal(panel.hidden, true);
    assert.equal(btn.getAttribute("aria-expanded"), "false");
  } finally {
    cleanup();
  }
});

test("opening another song closes the panel", () => {
  const { btn, panel, openSong, cleanup } = setup();
  try {
    openSong(["First."]);
    btn.dispatchEvent(new window.Event("click"));
    assert.equal(panel.hidden, false);

    openSong(["Other."]);
    assert.equal(panel.hidden, true);
    assert.equal(panel.textContent, "Other.");
  } finally {
    cleanup();
  }
});
