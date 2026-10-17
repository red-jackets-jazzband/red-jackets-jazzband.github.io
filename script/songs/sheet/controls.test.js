import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND } from "../core/state.js";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
import { initSheetControls, clearBookletPrintState } from "./controls.js";

function setup(overrides = {}) {
  const page = mountPage();
  const calls = {
    rerender: 0, tempo: [], setTempo: [], playPause: 0, mixerToggle: 0, repeatCount: [],
  };
  const ctx = makeCtx({
    sheet: { rerender: () => { calls.rerender += 1; } },
    audio: {
      transposeSemitones: 0,
      chordOffset: 0,
      setRepeatBoundaries: () => {},
      setRepeatCount: (v) => calls.repeatCount.push(v),
      initForTune: () => {},
      setupNotationClickHandler: () => {},
      updateTempoLabel: () => {},
      stepTempo: (d) => calls.tempo.push(d),
      setTempo: (bpm) => calls.setTempo.push(bpm),
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

test("the Key stepper buttons clamp #transpose and write ctx.state.transpose", () => {
  const { ctx, calls, cleanup } = setup();
  try {
    const input = document.getElementById("transpose");
    input.value = "11";
    document.getElementById("keyUpBtn").dispatchEvent(new window.Event("click"));
    assert.equal(input.value, "12");
    assert.equal(ctx.state.transpose, 12);
    document.getElementById("keyUpBtn").dispatchEvent(new window.Event("click"));
    assert.equal(input.value, "12"); // clamped at max
    document.getElementById("keyDownBtn").dispatchEvent(new window.Event("click"));
    assert.equal(input.value, "11");
    assert.equal(ctx.state.transpose, 11);
    // A re-render per actual change; the clamped click changed nothing.
    assert.equal(calls.rerender, 2);
  } finally {
    cleanup();
  }
});

test("a Key press asks for a background re-render", () => {
  const { ctx, cleanup } = setup();
  try {
    const metas = [];
    ctx.store.subscribe("settings", (_s, changed, _name, meta) => {
      if (changed.includes("transpose")) metas.push(meta);
    });
    document.getElementById("keyUpBtn").dispatchEvent(new window.Event("click"));
    assert.deepEqual(metas, [BACKGROUND]);
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

test("the Repeat stepper buttons clamp #repeatCount and call ctx.audio.setRepeatCount", () => {
  const { calls, cleanup } = setup();
  try {
    const input = document.getElementById("repeatCount");
    input.value = "20";
    document.getElementById("repeatUpBtn").dispatchEvent(new window.Event("click"));
    assert.equal(input.value, "20"); // clamped at max
    document.getElementById("repeatDownBtn").dispatchEvent(new window.Event("click"));
    assert.equal(input.value, "19");
    assert.deepEqual(calls.repeatCount, ["20", "19"]);
  } finally {
    cleanup();
  }
});

test("the Repeat stepper's field is seeded from ctx.state.repeatCount on init", () => {
  const page = mountPage();
  const ctx = makeCtx({
    state: { repeatCount: 4 },
    audio: {
      transposeSemitones: 0,
      chordOffset: 0,
      setRepeatBoundaries: () => {},
      setRepeatCount: () => {},
      initForTune: () => {},
      setupNotationClickHandler: () => {},
      updateTempoLabel: () => {},
      stepTempo: () => {},
      playPause: () => {},
      stop: () => {},
    },
    mixer: { init: () => {}, refresh: () => {}, toggle: () => {} },
  });
  try {
    initSheetControls(ctx);
    assert.equal(document.getElementById("repeatCount").value, "4");
  } finally {
    page.cleanup();
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

test("the advanced toggle flips #sheetmenu and persists, without a re-render (playback keeps going)", () => {
  const { calls, cleanup } = setup();
  try {
    const btn = document.getElementById("advancedToggleBtn");
    const menu = document.getElementById("sheetmenu");
    btn.dispatchEvent(new window.Event("click"));
    assert.ok(menu.classList.contains("show-advanced"));
    assert.equal(btn.getAttribute("aria-expanded"), "true");
    assert.equal(window.localStorage.getItem("rj.sheetAdvanced"), "1");
    btn.dispatchEvent(new window.Event("click"));
    assert.ok(!menu.classList.contains("show-advanced"));
    assert.equal(calls.rerender, 0);
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("a closed drawer's toggle counts the extra staves still on; an open one shows none", () => {
  const { ctx, cleanup } = setup();
  try {
    const btn = document.getElementById("advancedToggleBtn");
    const badge = btn.querySelector(".sheet-advanced-badge");
    assert.equal(badge.hidden, true, "nothing on, no badge");
    ctx.store.set("tune", { practiceActive: true });
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, "1");
    assert.equal(btn.title, "More controls (1 on)");
    ctx.store.set("tune", { compingActive: true });
    assert.equal(badge.textContent, "2");
    btn.dispatchEvent(new window.Event("click"));
    assert.equal(badge.hidden, true, "the drawer is open: the pickers are in view");
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

    // ignored when typing in a field
    pressSpace(document.getElementById("songSearch"));
    assert.equal(calls.playPause, 1);

    // a focused button (Mixer, Full screen, ...) doesn't swallow it
    pressSpace(document.getElementById("playPauseBtn"));
    assert.equal(calls.playPause, 2);

    // a focused song-list row still starts playback rather than eating the key
    const row = document.createElement("a");
    row.className = "song-list-item";
    document.getElementById("songList").append(row);
    pressSpace(row);
    assert.equal(calls.playPause, 3);
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

const afterAnnounce = () => new Promise((resolve) => {
  setTimeout(resolve, 80);
});

test("a stepper press reads the new value out through its live region", async () => {
  const { cleanup } = setup();
  try {
    const live = (id) => document.querySelector(`#${id} .sheet-stepper-announce`);
    assert.equal(live("keyStepper").textContent, "", "silent until a press");
    document.getElementById("keyUpBtn").click();
    await afterAnnounce();
    assert.match(live("keyStepper").textContent, /^1 \S/);
    document.getElementById("tempoValueLabel").textContent = "132";
    document.getElementById("tempoUpBtn").click();
    await afterAnnounce();
    assert.match(live("tempoStepper").textContent, /^132 \S/);
    document.getElementById("repeatUpBtn").click();
    await afterAnnounce();
    assert.match(live("repeatStepper").textContent, /^2 \S/);
  } finally {
    cleanup();
  }
});

// Runs `body` on the Tempo stepper's live region with every write to it
// recorded; `press(bpm)` presses + with the readout showing that tempo.
async function withTempoAnnouncer(body) {
  const { cleanup } = setup();
  try {
    const live = document.querySelector("#tempoStepper .sheet-stepper-announce");
    const writes = [];
    new window.MutationObserver(() => writes.push(live.textContent)).observe(live, { childList: true, characterData: true, subtree: true });
    const press = (bpm) => {
      document.getElementById("tempoValueLabel").textContent = bpm;
      document.getElementById("tempoUpBtn").click();
    };
    await body({ live, writes, press });
  } finally {
    cleanup();
  }
}

test("a press that leaves the value unchanged is announced again: cleared, then refilled", () => withTempoAnnouncer(async ({ live, writes, press }) => {
  press("200");
  await afterAnnounce();
  press("200"); // stuck at the limit
  assert.equal(live.textContent, "", "emptied straight away");
  await afterAnnounce();
  assert.match(live.textContent, /^200 \S/);
  assert.equal(writes.filter((w) => w.startsWith("200")).length, 2, "the same readout written twice, with a clear between");
  assert.ok(writes.includes(""));
}));

test("a newer press cancels the pending readout, so only the latest value is spoken", () => withTempoAnnouncer(async ({ live, writes, press }) => {
  press("140");
  press("150");
  await afterAnnounce();
  assert.match(live.textContent, /^150 \S/);
  assert.equal(writes.some((w) => w.startsWith("140")), false, "the first readout never went in");
}));

test("tapping the Tempo value sets the bpm from the last four taps", (t) => {
  const { calls, cleanup } = setup();
  t.after(cleanup);
  let now = 10000;
  t.mock.method(Date, "now", () => now);
  const tap = (at) => {
    now = at;
    document.getElementById("tempoTapBtn").click();
  };
  tap(10000);
  assert.deepEqual(calls.setTempo, []); // one tap is no tempo yet
  tap(10500);
  tap(11000);
  tap(11500);
  tap(11900); // the first tap drops out: 1400 ms over three beats
  assert.deepEqual(calls.setTempo, [120, 120, 120, 129]);
  tap(20000); // after a pause the count starts again
  assert.equal(calls.setTempo.length, 4);
});
