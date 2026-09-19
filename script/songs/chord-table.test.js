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
const PART_MARKER_SELECTOR = ".chordPartMarker";
const CELL_SELECTOR = ".chordCell";

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

test("renderChordTable boxes a part's first chord with its letter, top-left corner", () => {
  inDom((container) => {
    renderChordTable([bar(["C"], { part: "A" }), bar(["F"]), bar(["G"], { part: "B" })], container);
    const cells = [...container.querySelectorAll(CELL_SELECTOR)];
    assert.deepEqual(
      cells.map((cell) => cell.querySelector(PART_MARKER_SELECTOR)?.textContent),
      ["A", undefined, "B"],
    );
  });
});

test("renderChordTable hangs a leftmost-column part marker outside the cell instead of inset", () => {
  inDom((container) => {
    renderChordTable(
      [
        bar(["C"], { part: "A" }), // column 1, row 1: outside-left
        bar(["F"]),
        bar(["G"]),
        bar(["C"], { part: "B" }), // column 4, row 1: inset as normal
        bar(["D"], { part: "C" }), // column 1, row 2: outside-left again
      ],
      container,
    );
    const markers = [...container.querySelectorAll(PART_MARKER_SELECTOR)];
    assert.deepEqual(
      markers.map((m) => m.classList.contains("chordPartMarker--outsideLeft")),
      [true, false, true],
    );
  });
});

test("renderChordTable shrinks a word-length part title to its first letter, but keeps a short code as-is", () => {
  inDom((container) => {
    renderChordTable([
      bar(["Bb"], { part: "Chorus" }),
      bar(["F7"], { part: "A2" }),
      bar(["C7"], { part: "B" }),
    ], container);
    assert.deepEqual(
      [...container.querySelectorAll(PART_MARKER_SELECTOR)].map((m) => m.textContent),
      ["C", "A2", "B"],
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

test("renderChordTable gives an intro its own row, even in the 8-column layout (Bugle Boy)", () => {
  inDom((container) => {
    const intro = [bar(["F"], { part: "Intro" }), bar(["%"]), bar(["%"]), bar(["%"])];
    const body = Array.from({ length: 24 }, (_, i) => bar([`C${i}`], i === 0 ? { part: "A" } : {}));
    renderChordTable([...intro, ...body], container);
    const cells = [...container.querySelectorAll(CELL_SELECTOR)];
    assert.equal(cells.length, 28);
    assert.equal(cells[4].style.gridColumnStart, "1");
    assert.equal(cells[3].style.gridColumnStart, "");
    assert.equal(
      cells[4].querySelector(PART_MARKER_SELECTOR).classList.contains("chordPartMarker--outsideLeft"),
      true,
    );
  });
});

test("renderChordTable starts a new row after a short intro, and leaves an intro that already fills its row alone", () => {
  inDom((container) => {
    renderChordTable(
      [bar(["F"], { part: "Intro" }), bar(["C"]), bar(["G"], { part: "A" }), bar(["D"])],
      container,
    );
    const cells = [...container.querySelectorAll(CELL_SELECTOR)];
    assert.equal(cells[2].style.gridColumnStart, "1");
  });
  inDom((container) => {
    renderChordTable(
      [bar(["F"], { part: "Intro" }), bar(["C"]), bar(["G"]), bar(["D"]), bar(["E"], { part: "A" })],
      container,
    );
    assert.equal(container.querySelectorAll(CELL_SELECTOR)[4].style.gridColumnStart, "");
  });
});

test("renderChordTable marks repeats and double bars", () => {
  inDom((container) => {
    renderChordTable([
      bar(["C"], { leftRepeat: true }),
      bar(["F"], { doubeThinBarRight: true }),
      bar(["G"], { rightRepeat: true }),
    ], container);
    const cells = container.querySelectorAll(CELL_SELECTOR);
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
    assert.equal(container.querySelectorAll(CELL_SELECTOR).length, 8);
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
    assert.equal(container.querySelectorAll(CELL_SELECTOR).length, 16);
  });
});

test("renderChordTable drops the part marker when a fold collapses different-named parts together", () => {
  inDom((container) => {
    // Just a Closer Walk With Thee: Verse and Chorus have identical chords,
    // so the 16-bar scheme collapses to 8 — but the surviving "Verse"
    // marker shouldn't be shown, since it no longer just labels the Verse.
    const verse = Array.from({ length: 8 }, (_, i) => bar([`C${i}`]));
    verse[0] = bar(verse[0].text, { part: "Verse" });
    const chorus = verse.map((m) => bar(m.text.slice(), m.part ? { part: "Chorus" } : {}));
    renderChordTable(verse.concat(chorus), container);
    assert.deepEqual(
      [...container.querySelectorAll(".chordDiv")].map((d) => d.textContent),
      verse.map((m) => String(m.text)),
    );
    assert.deepEqual(
      [...container.querySelectorAll(PART_MARKER_SELECTOR)].map((m) => m.textContent),
      [],
    );
  });
});

test("renderChordTable suppresses a part marker when it's the only part in the table (e.g. Bill Bailey)", () => {
  inDom((container) => {
    // Bill Bailey's chordless intro never makes it into the chords array
    // (parseChordScheme only starts keeping measures once a chord shows up),
    // so "verse" ends up as the only part on the whole table — nothing left
    // for it to distinguish itself from.
    renderChordTable([bar(["C"], { part: "verse" }), bar(["F"]), bar(["G"])], container);
    assert.deepEqual(
      [...container.querySelectorAll(PART_MARKER_SELECTOR)].map((m) => m.textContent),
      [],
    );
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
