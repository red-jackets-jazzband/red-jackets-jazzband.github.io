import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { initSheetControls, clearBookletPrintState } from "./sheet-controls.js";

function setup(overrides = {}) {
  const page = mountPage();
  const calls = { rerender: 0, tempo: [], playPause: 0, mixerToggle: 0 };
  const ctx = makeCtx({
    sheet: { rerender: () => { calls.rerender += 1; } },
    audio: {
      transposeSemitones: 0,
      chordOffset: 0,
      setRepeatBoundaries: () => {},
      initForTune: () => {},
      setupNotationClickHandler: () => {},
      updateTempoLabel: () => {},
      stepTempo: (d) => calls.tempo.push(d),
      playPause: () => { calls.playPause += 1; },
      stop: () => {},
    },
    mixer: { init: () => {}, refresh: () => {}, toggle: () => { calls.mixerToggle += 1; } },
    ...overrides,
  });
  initSheetControls(ctx);
  return { page, ctx, calls, cleanup: page.cleanup };
}

function pressSpace(target) {
  (target || document.body).dispatchEvent(
    new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
  );
}

test("the Key stepper buttons clamp #transpose and fire an input event", () => {
  const { calls, cleanup } = setup();
  try {
    const input = document.getElementById("transpose");
    input.value = "11";
    document.getElementById("keyUpBtn").dispatchEvent(new window.Event("click"));
    assert.equal(input.value, "12");
    document.getElementById("keyUpBtn").dispatchEvent(new window.Event("click"));
    assert.equal(input.value, "12"); // clamped at max
    document.getElementById("keyDownBtn").dispatchEvent(new window.Event("click"));
    assert.equal(input.value, "11");
    assert.ok(calls.rerender >= 3); // the "input" listener re-renders each time
  } finally {
    cleanup();
  }
});

test("the Tempo buttons step the audio player by ±TEMPO_STEP", () => {
  const { calls, cleanup } = setup();
  try {
    document.getElementById("tempoUpBtn").dispatchEvent(new window.Event("click"));
    document.getElementById("tempoDownBtn").dispatchEvent(new window.Event("click"));
    assert.deepEqual(calls.tempo, [4, -4]);
  } finally {
    cleanup();
  }
});

test("the Mixer button toggles the mixer panel", () => {
  const { calls, cleanup } = setup();
  try {
    document.getElementById("mixerBtn").dispatchEvent(new window.Event("click"));
    assert.equal(calls.mixerToggle, 1);
  } finally {
    cleanup();
  }
});

test("the advanced toggle flips #sheetmenu, persists and re-renders", () => {
  const { calls, cleanup } = setup();
  try {
    const btn = document.getElementById("advancedToggleBtn");
    const menu = document.getElementById("sheetmenu");
    btn.dispatchEvent(new window.Event("click"));
    assert.ok(menu.classList.contains("show-advanced"));
    assert.equal(btn.getAttribute("aria-expanded"), "true");
    assert.equal(window.localStorage.getItem("rj.sheetAdvanced"), "1");
    assert.ok(calls.rerender >= 1);
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("the back button leaves the sheet view", () => {
  const { cleanup } = setup();
  try {
    document.body.classList.add("rj-sheet-active");
    document.getElementById("sheetBackBtn").dispatchEvent(new window.Event("click"));
    assert.equal(document.body.classList.contains("rj-sheet-active"), false);
  } finally {
    cleanup();
  }
});

test("Spacebar toggles play/pause while the sheet is open", () => {
  const { calls, cleanup } = setup();
  try {
    pressSpace();
    assert.equal(calls.playPause, 0); // no sheet open yet

    document.body.classList.add("rj-sheet-active");
    pressSpace();
    assert.equal(calls.playPause, 1);

    // ignored when typing in a field or focused on a button
    pressSpace(document.getElementById("songSearch"));
    pressSpace(document.getElementById("playPauseBtn"));
    assert.equal(calls.playPause, 1);
  } finally {
    cleanup();
  }
});

test("clearBookletPrintState strips every export-* body class", () => {
  inDom((doc) => {
    doc.body.classList.add("export-booklet-mode", "export-mode-chordbook", "keep-me");
    clearBookletPrintState();
    assert.deepEqual([...doc.body.classList], ["keep-me"]);
  });
});

function inDom(fn) {
  const page = mountPage();
  try {
    return fn(page.document);
  } finally {
    page.cleanup();
  }
}
