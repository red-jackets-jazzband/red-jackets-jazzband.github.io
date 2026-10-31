import { el, clear, qsa } from "../../lib/core/dom.js";
import { simplifyBlues, simplifySong } from "../../lib/music/chords.js";
import { tl } from "../../lib/core/i18n.js";

// At 24 bars or more, a 4-column grid runs too tall for the sheet, so long
// schemes (e.g. The Bare Necessities' 42 bars) always switch to 8 columns.
const LONG_SCHEME_BAR_THRESHOLD = 24;
// Past this many rows a chordbook tile's rows are too short to stack a bar's
// chords on two lines (split.css, .chordGrid--dense).
const DENSE_ROWS = 8;

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

// A marker in the grid's leftmost column has no cell to its own left to
// overlap, so it hangs outside the table instead of inset over the chord
// text — chordPartMarker--outsideLeft, styled in split.css.
// A bar with no chord of its own prints "%" (the chord carries on). A screen
// reader would say "percent", so the sign is hidden from it and a spoken
// "same chord" stands in.
function isContinuationBar(measure) {
  return Array.isArray(measure.text) && measure.text.length === 1 && measure.text[0] === " % ";
}

// A bar with several chords ("C,C#dim7") gets one span per chord, the commas
// in spans of their own: the text reads as before, while the printed
// chordbook, whose large type doesn't fit two chords side by side in a cell,
// can stack them (first chord top left, last bottom right — split.css's
// .chordDiv--multi).
function multiChordDiv(names) {
  const parts = [];
  names.forEach((name, index) => {
    if (index > 0) parts.push(el("span", { class: "chordSep", text: "," }));
    let cls = "chordName";
    if (index === 0) cls += " chordName--first";
    else if (index === names.length - 1) cls += " chordName--last";
    parts.push(el("span", { class: cls, text: name }));
  });
  const cls = names.length > 2 ? "chordDiv chordDiv--multi chordDiv--multi3" : "chordDiv chordDiv--multi";
  return el("div", { class: cls, style: chordCharsStyle(names) }, parts);
}

// The longest chord's length, for the printed chordbook to shrink a chord
// that wouldn't fit its cell's width (split.css, --chord-chars), and the
// length of the whole "C,C#dim7" for a grid too dense to stack them in
// (--chord-chars-inline).
function chordCharsStyle(names) {
  return {
    "--chord-chars": String(Math.max(...names.map((name) => name.length))),
    "--chord-chars-inline": String(names.join(",").length),
  };
}

function chordDivFor(measure) {
  if (Array.isArray(measure.text) && measure.text.length > 1) return multiChordDiv(measure.text);
  if (!isContinuationBar(measure)) {
    const text = String(measure.text);
    return el("div", { class: "chordDiv", text, style: chordCharsStyle([text]) });
  }
  return el("div", { class: "chordDiv" }, [
    el("span", { attrs: { "aria-hidden": "true" }, text: " % " }),
    el("span", { class: "rj-sr-only", text: tl("chords_same", "same chord") }),
  ]);
}

function partMarker(part, outsideLeft) {
  return el("span", {
    class: outsideLeft ? "chordPartMarker chordPartMarker--outsideLeft" : "chordPartMarker",
    text: partBadgeText(part),
  });
}

// Indices of the measures that start the section right after an intro — each
// must begin a new grid row so the intro always sits on a line of its own
// (Bugle Boy's 4-bar intro in an 8-column grid, say).
function introRowBreaks(measures) {
  const breaks = new Set();
  let inIntro = false;
  measures.forEach((measure, index) => {
    if (measure.part === undefined) return;
    const isIntro = /\bintro/i.test(measure.part);
    if (inIntro && !isIntro) breaks.add(index);
    inIntro = isIntro;
  });
  return breaks;
}

// Indices of the measures that start an ending section (Outro, Coda) after
// the main parts. Like the section after an intro, it starts a fresh row set
// off from the rows above by a little extra space (see renderChordTable).
function endingRowStarts(measures) {
  const starts = new Set();
  measures.forEach((measure, index) => {
    if (index > 0 && measure.part !== undefined && /\b(outro|coda)\b/i.test(measure.part)) starts.add(index);
  });
  return starts;
}

// A measure's double bar lines and repeat signs on its cell.
function applyBarLines(cell, chordDiv, measure) {
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

  const grid = el("div", {
    class: "chordGrid",
    style: { "--chord-cols": String(cols) },
    attrs: { role: "group", "aria-label": tl("chords_table", "Chords") },
  });

  const rowStarts = introRowBreaks(measures);
  const endingStarts = endingRowStarts(measures);
  let inGapRow = false;
  // 0-based column the next cell lands in — tracked rather than derived from
  // the index, since a forced row start shifts every cell after it.
  let column = 0;
  let rows = 0;

  measures.forEach((measure, index) => {
    // Column 1 on the first cell after an intro starts a fresh row without
    // adding filler cells (the flat cell order/count must stay intact).
    const startsGap = rowStarts.has(index) || endingStarts.has(index);
    const forceRowStart = startsGap && column !== 0;
    if (forceRowStart) column = 0;
    const chordDiv = chordDivFor(measure);
    const cell = el("div", { class: "chordCell" }, chordDiv);
    if (forceRowStart) cell.style.gridColumnStart = "1";
    // The first row after an intro, and the first row of an outro, sit a
    // little apart from what's above. Every cell of that row carries the gap,
    // so the row grows as a whole and no cell's border stretches into it.
    if (startsGap) inGapRow = true;
    if (inGapRow) cell.classList.add("chordCellSectionGap");

    if (hasMultipleParts && measure.part !== undefined) cell.append(partMarker(measure.part, column === 0));
    applyBarLines(cell, chordDiv, measure);

    grid.append(cell);
    if (column === 0) rows += 1;
    cell.dataset.row = String(rows - 1);
    column = (column + 1) % cols;
    if (column === 0) inGapRow = false;
  });

  // The printed chordbook scales a long chart's type to its row count, and
  // stops stacking a bar's chords once rows get too short for two lines.
  setGridRows(grid, rows);
  clear(container).append(grid);
}

function setGridRows(grid, rows) {
  grid.style.setProperty("--chord-rows", String(rows));
  grid.classList.toggle("chordGrid--dense", rows > DENSE_ROWS);
}

const cellRow = (cell) => Number(cell.dataset.row);

// The row to split a long grid at: the middle, or a part's first row within
// two rows of it (the closest one), so a section isn't cut in two.
function splitRow(cells, rows) {
  const middle = Math.ceil(rows / 2);
  let best = middle;
  let bestDistance = Infinity;
  cells.forEach((cell, index) => {
    const row = cellRow(cell);
    const startsRow = index === 0 || cellRow(cells[index - 1]) !== row;
    if (!startsRow || row === 0 || !cell.querySelector(".chordPartMarker")) return;
    const distance = Math.abs(row - middle);
    if (distance <= 2 && distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  });
  return best;
}

/*
  Split a rendered grid of more than `maxRows` rows in two for the printed
  chordbook, where a long chart (South Rampart Street Parade's 20 rows) would
  otherwise shrink to a few points to fit one tile. Marks the grid's cells
  from the split row on `chordCell--part2`, and returns a copy of the grid
  whose cells before it are marked `chordCell--part1` (split.css hides each
  half's other cells in the chordbook), each half's row count set for its own
  type size. Returns null for a grid that fits.
*/
export function splitChordGrid(grid, maxRows) {
  const cells = qsa(".chordCell", grid);
  const rows = cells.length === 0 ? 0 : cellRow(cells[cells.length - 1]) + 1;
  if (rows <= maxRows) return null;
  const split = splitRow(cells, rows);
  const second = grid.cloneNode(true);
  cells.forEach((cell) => cell.classList.toggle("chordCell--part2", cellRow(cell) >= split));
  qsa(".chordCell", second).forEach((cell) => cell.classList.toggle("chordCell--part1", cellRow(cell) < split));
  setGridRows(grid, split);
  setGridRows(second, rows - split);
  return second;
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

// The smallest the form strip is shrunk to fit its width; past this it wraps.
const MIN_FORM_ZOOM = 0.75;

/*
  Fit the song-form arrow strip(s) under the chord grid the same way: each
  step keeps at least its own min-content width, so on a phone the strip
  overflows. Zoom it down by the overflow ratio so the whole flow stays on
  screen, and re-fit on rotate. The strip's natural width is its min-content
  width, not max-content: a step's text wraps, so a long aside (a riff note)
  laid out on one line would otherwise shrink the whole strip — print included —
  to a fraction of the width it actually needs.
*/
export function fitSongForms(chordEl) {
  const parent = chordEl && chordEl.parentNode; // NOSONAR: `?.` is a SyntaxError on Safari 12 (see Browser support)
  if (!parent) return;
  parent.querySelectorAll(".songForm").forEach((form) => {
    form.classList.remove("songForm--wrap");
    form.style.zoom = "";
    form.style.width = "";
    forceReflow(form);
    const available = form.clientWidth;
    if (!available) return;
    form.style.width = "min-content";
    const natural = form.scrollWidth;
    form.style.width = "";
    if (natural <= available + 1) return;
    const zoom = available / natural;
    // A long form on a phone (Panama's seven rounds) would shrink past reading:
    // it wraps onto a second line at full size instead.
    if (zoom < MIN_FORM_ZOOM) {
      form.classList.add("songForm--wrap");
      return;
    }
    form.style.width = `${natural}px`;
    form.style.zoom = String(zoom);
  });
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
