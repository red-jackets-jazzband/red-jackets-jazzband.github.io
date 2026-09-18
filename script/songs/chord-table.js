import { el, clear } from "../lib/dom.js";
import { simplifyBlues, simplifySong } from "../lib/chords.js";

// At 24 bars or more, a 4-column grid runs too tall for the sheet, so long
// schemes (e.g. The Bare Necessities' 42 bars) always switch to 8 columns.
const LONG_SCHEME_BAR_THRESHOLD = 24;

// Reading offsetWidth is what forces a layout reflow; returning it (rather
// than discarding it inline with `void` or an unused variable) is what
// keeps the read from looking like a pointless no-op statement.
function forceReflow(element) {
  return element.offsetWidth;
}

// A part title longer than a short code (e.g. "Chorus", "Sous Intro") is cut
// down to its first letter for the badge — see renderChordTable's doc
// comment for why. "A", "B2", "Bridge" -> "A", "B2", "B".
function partBadgeText(title) {
  return title.length > 2 ? title.slice(0, 1) : title;
}

/*
  Render the chord grid above the staff from a per-measure chord array (the
  same array shape parseChordScheme produces, optionally already converted to
  Roman numerals).

  A CSS grid, not a <table>: cells are a flat sequence in reading order
  (left-to-right, top-to-bottom), and how many columns they wrap into is a CSS
  variable that can change at narrow widths. The cell order and count must stay
  exactly this sequence — playback highlighting looks cells up by flat index.

  A measure carrying `part` (an ABC `P:` field's title, from parseChordScheme)
  is the first measure of that section — it gets a small black-square
  `.chordPartMarker` badge in the cell's top-left corner, the chord-table
  equivalent of stylePartMarkers' boxed letter above the staff. Unlike that
  notation-view box, this one is a pure overlay on top of the chord grid: the
  chord text itself is never resized, shifted or padded to make room for it
  (a real song's cells are already tight — an 8-column layout's narrower
  cells, or a two-chord measure like "F7,N.C.", have no spare margin to give
  up). That's also why the badge shows at most one letter (partBadgeText): the
  tune's own `P:` title can be a whole word ("Chorus", "Sous Intro"), and a
  word-length badge did visibly overlap a real first chord (Bill Bailey's
  "verse"/"F") once actually rendered — confirmed by rendering several real
  songs' own ABC files, not just guessed. A short code ("A", "B2", ...) is
  already small enough and is kept as-is.

  A marker whose measure falls in the grid's leftmost column sits right on
  the table's own outer edge if inset the normal way, so it gets
  `chordPartMarker--outsideLeft` instead, which split.css hangs outside the
  cell to its left rather than inset inside it.

  A part marker exists to distinguish one section of the table from
  another, so it's suppressed when the table only ever has one (e.g. Bill
  Bailey's chordless "intro" never reaches this array at all — parseChordScheme
  only tags/keeps a measure once a chord shows up — leaving "verse" as the
  only section on the whole table): a lone marker doesn't label anything a
  reader couldn't already tell from there being nothing else. Same reasoning
  simplifySong already applies to a marker that survives a repeat collapse.
*/
export function renderChordTable(chords, container) {
  if (!container) return;
  // Try each common form in turn; simplifySong is a no-op when the count
  // doesn't evenly divide the scheme or the repeats aren't identical, so
  // chaining is safe (e.g. an 8-bar collapse leaves nothing left for the
  // 16-bar check to match against).
  const measures = simplifySong(simplifySong(simplifyBlues(chords), 8), 16);
  const cols = measures.length >= LONG_SCHEME_BAR_THRESHOLD ? 8 : 4;
  const hasMultipleParts = measures.filter((measure) => measure.part !== undefined).length > 1;

  const grid = el("div", { class: "chordGrid", style: { "--chord-cols": String(cols) } });

  measures.forEach((measure, index) => {
    const chordDiv = el("div", { class: "chordDiv", html: String(measure.text) });
    const cell = el("div", { class: "chordCell" }, chordDiv);

    if (hasMultipleParts && measure.part !== undefined) {
      // A marker in the grid's leftmost column has no cell to its own left to
      // overlap, so it hangs outside the table instead of inset over the
      // chord text — chordPartMarker--outsideLeft, styled in split.css.
      const outsideLeft = index % cols === 0;
      cell.append(
        el("span", {
          class: outsideLeft ? "chordPartMarker chordPartMarker--outsideLeft" : "chordPartMarker",
          text: partBadgeText(measure.part),
        }),
      );
    }
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
  });

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
