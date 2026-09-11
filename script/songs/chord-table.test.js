import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { renderChordTable, scanRepeatBoundaries, fitChordTable } from "./chord-table.js";

function inDom(fn) {
  const page = mountPage({ html: "<div id='chordtable'></div>" });
  try {
    return fn(page.document.getElementById("chordtable"));
  } finally {
    page.cleanup();
  }
}

const bar = (text, extra = {}) => ({ text, ...extra });

const CHORD_GRID_SELECTOR = ".chordGrid";

test("renderChordTable lays cells out in reading order with 4 columns", () => {
  inDom((container) => {
    renderChordTable([bar(["C"]), bar(["F"]), bar(["G"]), bar(["C"])], container);
    const grid = container.querySelector(CHORD_GRID_SELECTOR);
    assert.equal(grid.style.getPropertyValue("--chord-cols"), "4");
    assert.deepEqual(
      [...grid.querySelectorAll(".chordDiv")].map((d) => d.textContent),
      ["C", "F", "G", "C"],
    );
  });
});

test("renderChordTable shows a break (\"N.C.\") marker as plain text, alone or alongside a real chord", () => {
  inDom((container) => {
    renderChordTable([bar(["C"]), bar(["N.C."]), bar(["F7", "N.C."])], container);
    assert.deepEqual(
      [...container.querySelectorAll(".chordDiv")].map((d) => d.textContent),
      ["C", "N.C.", "F7,N.C."],
    );
  });
});

test("renderChordTable switches to 8 columns past 24 measures", () => {
  inDom((container) => {
    // 42 bars, e.g. The Bare Necessities.
    renderChordTable(Array.from({ length: 42 }, (_, i) => bar([`C${i}`])), container);
    assert.equal(
      container.querySelector(CHORD_GRID_SELECTOR).style.getPropertyValue("--chord-cols"),
      "8",
    );
  });
});

test("renderChordTable uses 8 columns at exactly 24 measures", () => {
  inDom((container) => {
    renderChordTable(Array.from({ length: 24 }, (_, i) => bar([`C${i}`])), container);
    assert.equal(
      container.querySelector(CHORD_GRID_SELECTOR).style.getPropertyValue("--chord-cols"),
      "8",
    );
  });
});

test("renderChordTable keeps 4 columns below 24 measures (e.g. Sister Kate's 18 bars)", () => {
  inDom((container) => {
    renderChordTable(Array.from({ length: 18 }, (_, i) => bar([`C${i}`])), container);
    assert.equal(
      container.querySelector(CHORD_GRID_SELECTOR).style.getPropertyValue("--chord-cols"),
      "4",
    );
  });
});

test("renderChordTable marks repeats and double bars", () => {
  inDom((container) => {
    renderChordTable([
      bar(["C"], { leftRepeat: true }),
      bar(["F"], { doubeThinBarRight: true }),
      bar(["G"], { rightRepeat: true }),
    ], container);
    const cells = container.querySelectorAll(".chordCell");
    assert.ok(cells[0].classList.contains("chordCellLeftRepeat"));
    assert.ok(cells[0].querySelector(".chordLeftRepeatSign"));
    assert.ok(cells[1].classList.contains("chordCellDoubleThinBarRight"));
    assert.ok(cells[2].classList.contains("chordCellRightRepeat"));
    assert.ok(cells[2].querySelector(".chordRightRepeatSign"));
  });
});

test("renderChordTable collapses an exactly-repeating 8-bar scheme", () => {
  inDom((container) => {
    const eight = Array.from({ length: 8 }, (_, i) => bar([`C${i}`]));
    renderChordTable(eight.concat(eight.map((m) => bar(m.text.slice()))), container);
    assert.equal(container.querySelectorAll(".chordCell").length, 8);
  });
});

test("renderChordTable collapses an exactly-repeating 16-bar scheme", () => {
  inDom((container) => {
    const sixteen = Array.from({ length: 16 }, (_, i) => bar([`C${i}`]));
    const song = sixteen.concat(
      sixteen.map((m) => bar(m.text.slice())),
      sixteen.map((m) => bar(m.text.slice())),
    );
    renderChordTable(song, container);
    assert.equal(container.querySelectorAll(".chordCell").length, 16);
  });
});

test("scanRepeatBoundaries reads the first/last repeat cell indices", () => {
  inDom((container) => {
    renderChordTable([
      bar(["C"]),
      bar(["F"], { leftRepeat: true }),
      bar(["G"]),
      bar(["C"], { rightRepeat: true }),
      bar(["A"]),
    ], container);
    assert.deepEqual(scanRepeatBoundaries(container), { start: 1, end: 3 });
  });
});

test("scanRepeatBoundaries returns undefineds when there is no repeat span", () => {
  inDom((container) => {
    renderChordTable([bar(["C"]), bar(["F"])], container);
    assert.deepEqual(scanRepeatBoundaries(container), { start: undefined, end: undefined });
  });
});

test("fitChordTable clears a stale zoom and no-ops without layout", () => {
  inDom((container) => {
    renderChordTable([bar(["C"]), bar(["F"]), bar(["G"]), bar(["C"])], container);
    const grid = container.querySelector(CHORD_GRID_SELECTOR);
    grid.style.zoom = "0.5";
    grid.style.width = "999px";
    fitChordTable(container);
    // jsdom reports no width, so the fit resets the grid and bails.
    assert.equal(grid.style.zoom, "");
    assert.equal(grid.style.width, "");
  });
});

test("fitChordTable tolerates a missing container or grid", () => {
  assert.doesNotThrow(() => fitChordTable(null));
  inDom((container) => {
    assert.doesNotThrow(() => fitChordTable(container));
  });
});
