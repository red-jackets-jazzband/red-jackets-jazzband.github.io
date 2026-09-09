import { el, clear } from "../lib/dom.js";
import { simplifyBlues, simplifySong } from "../lib/chords.js";

// Reading offsetWidth is what forces a layout reflow; returning it (rather
// than discarding it inline with `void` or an unused variable) is what
// keeps the read from looking like a pointless no-op statement.
function forceReflow(element) {
  return element.offsetWidth;
}

/*
  Render the chord grid above the staff from a per-measure chord array (the
  same array shape parseChordScheme produces, optionally already converted to
  Roman numerals).

  A CSS grid, not a <table>: cells are a flat sequence in reading order
  (left-to-right, top-to-bottom), and how many columns they wrap into is a CSS
  variable that can change at narrow widths. The cell order and count must stay
  exactly this sequence — playback highlighting looks cells up by flat index.
*/
export function renderChordTable(chords, container) {
  if (!container) return;
  const measures = simplifySong(simplifyBlues(chords), 8);
  const cols = measures.length > 4 * 4 ? 8 : 4;

  const grid = el("div", { class: "chordGrid", style: { "--chord-cols": String(cols) } });

  for (const measure of measures) {
    const chordDiv = el("div", { class: "chordDiv", html: String(measure.text) });
    const cell = el("div", { class: "chordCell" }, chordDiv);

    if (measure.doubeThinBarLeft !== undefined) cell.classList.add("chordCellDoubleThinBarLeft");
    if (measure.doubeThinBarRight !== undefined) cell.classList.add("chordCellDoubleThinBarRight");

    if (measure.rightRepeat !== undefined) {
      cell.classList.add("chordCellRightRepeat");
      chordDiv.append(el("span", { class: "chordRightRepeatSign", text: ":" }));
    }
    if (measure.leftRepeat !== undefined) {
      cell.classList.add("chordCellLeftRepeat");
      chordDiv.insertBefore(
        el("span", { class: "chordLeftRepeatSign", text: ":" }),
        chordDiv.firstChild,
      );
    }

    grid.append(cell);
  }

  clear(container).append(grid);
}

/*
  Fit the chord grid to its container without dropping columns.

  Desktop keeps its 4 or 8 equal columns at their normal width. On a narrow
  phone those columns would clip their chord text (cells are overflow:hidden)
  or push a horizontal scrollbar. Instead we lay the grid out at its natural
  content width and, when that overflows, `zoom` the whole grid — cells, text
  and all — down by exactly the overflow ratio so it fits. `zoom` (not
  `transform: scale`) because it reflows: the grid's footprint shrinks with it,
  so the sheet's paper/toolbar don't stay stretched to the pre-zoom width.
  Rotating the phone widens the container and a resize re-fit zooms it back up.
  Cell order/count is untouched, so playback highlighting still lines up.
*/
export function fitChordTable(container) {
  const grid = container && container.querySelector(".chordGrid");
  if (!grid) return;

  // Start every fit (first render, resize, rotate) from an un-zoomed grid, and
  // force the reset to settle before measuring — a stale zoom left on the
  // element skews the width read otherwise (a re-fit after a rotation).
  grid.style.zoom = "";
  grid.style.width = "";
  forceReflow(grid);

  const available = container.clientWidth;
  if (!available) return;

  // Natural width: the grid laid out to its widest cell in each column.
  grid.style.width = "max-content";
  const natural = grid.scrollWidth;
  grid.style.width = "";

  if (natural <= available + 1) return;

  // Pin that width, then zoom the whole grid down to the container.
  grid.style.width = `${natural}px`;
  grid.style.zoom = String(available / natural);
}

/*
  Read the repeat-section span from a rendered chord grid: the index of the
  first cell carrying `.chordCellLeftRepeat` and the last carrying
  `.chordCellRightRepeat`. Returns { start, end } (both may be undefined), used
  by playback highlighting to wrap an over-long measure index back into the
  repeated section rather than the whole grid.
*/
export function scanRepeatBoundaries(container) {
  const cells = container ? container.querySelectorAll(".chordCell") : [];
  let start;
  let end;
  cells.forEach((cell, index) => {
    if (start === undefined && cell.classList.contains("chordCellLeftRepeat")) start = index;
    if (cell.classList.contains("chordCellRightRepeat")) end = index;
  });
  const valid = start !== undefined && end !== undefined && start <= end;
  return valid ? { start, end } : { start: undefined, end: undefined };
}
