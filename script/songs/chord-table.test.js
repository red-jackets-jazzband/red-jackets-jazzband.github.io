import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { renderChordTable, scanRepeatBoundaries } from "./chord-table.js";

function inDom(fn) {
  const page = mountPage({ html: "<div id='chordtable'></div>" });
  try {
    return fn(page.document.getElementById("chordtable"));
  } finally {
    page.cleanup();
  }
}

const bar = (text, extra = {}) => ({ text, ...extra });

test("renderChordTable lays cells out in reading order with 4 columns", () => {
  inDom((container) => {
    renderChordTable([bar(["C"]), bar(["F"]), bar(["G"]), bar(["C"])], container);
    const grid = container.querySelector(".chordGrid");
    assert.equal(grid.style.getPropertyValue("--chord-cols"), "4");
    assert.deepEqual(
      [...grid.querySelectorAll(".chordDiv")].map((d) => d.textContent),
      ["C", "F", "G", "C"],
    );
  });
});

test("renderChordTable switches to 8 columns past 16 measures", () => {
  inDom((container) => {
    renderChordTable(Array.from({ length: 17 }, (_, i) => bar([`C${i}`])), container);
    assert.equal(
      container.querySelector(".chordGrid").style.getPropertyValue("--chord-cols"),
      "8",
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
