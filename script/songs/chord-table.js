import { el, clear } from "../lib/dom.js";
import { simplifyBlues, simplifySong } from "../lib/chords.js";

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
