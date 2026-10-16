/*
  Small SVG helpers the layer overlays share: measuring (a node that can't
  be laid out — jsdom, a hidden container — measures as null, never throws)
  and building elements.
*/

export const SVG_NS = "http://www.w3.org/2000/svg";

export function bboxOf(node) {
  try {
    return node.getBBox();
  } catch {
    return null; // not laid out (jsdom, a hidden container)
  }
}

export function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  Object.keys(attrs).forEach((key) => node.setAttribute(key, String(attrs[key])));
  return node;
}

export function noteGroup(el) {
  return el.abselem && el.abselem.elemset ? el.abselem.elemset[0] : null; // NOSONAR
}

// The chord symbols drawn with `el`.
export function chordTexts(el) {
  const group = noteGroup(el);
  return group ? [...group.querySelectorAll(".abcjs-chord")] : [];
}

// The horizontal middle of the noteheads drawn alongside `text`, or null.
export function noteheadCentre(text) {
  const group = text.parentNode;
  if (!group || typeof group.querySelectorAll !== "function") return null;
  let left = Infinity;
  let right = -Infinity;
  group.querySelectorAll(".abcjs-notehead").forEach((head) => {
    const box = bboxOf(head);
    if (!box) return;
    left = Math.min(left, box.x);
    right = Math.max(right, box.x + box.width);
  });
  return left <= right ? (left + right) / 2 : null;
}

// Where the svg's visible area starts (-Infinity when it can't be read).
export function viewTop(svg) {
  const box = svg.viewBox && svg.viewBox.baseVal; // NOSONAR
  return box ? box.y : -Infinity;
}

// The staff line and voice an ABCjs element was drawn for ("abcjs-l2 abcjs-v0").
function staffKey(node) {
  return [...node.classList].filter((name) => /^abcjs-[lv]\d+$/.test(name)).join(" ");
}

/*
  ABCjs lays annotations out left-aligned at their note and, where a run of
  short notes makes two neighbours overlap, pushes every other one a row
  down. Once centred under their notes they mostly fit side by side, so
  this puts every one of `texts` (one layer's annotations) back on the row
  that layer usually takes on its staff line, instead of a jumble of
  half-rows — unless another annotation of the same note is already there
  (a note with no fingering has its degree a row higher, say). Where the
  notes are so close that neighbours would still touch, a label shrinks
  just enough to fit between them, down to MIN_FIT of its size (`fit`).
  `slot(text)` splits a layer that writes several rows per note (a valve
  diagram's three) so each row is aligned on its own; `extent(box, text)`
  says how wide a label is really drawn ({ size, fixed }: a chord tone's
  circle is its text's larger side plus padding), so that is what fits.
*/
export function alignRows(texts, { slot = () => "", fit = true, extent = textWidth } = {}) {
  const keyOf = (text) => `${staffKey(text)}|${slot(text)}`;
  alignToUsualRow(texts, keyOf);
  // Neighbours are labels on the same final row: one left a row lower by
  // rowTaken doesn't crowd the row above it.
  if (fit) fitBetweenNeighbours(texts, (text) => `${keyOf(text)}|${text.getAttribute("y")}`, extent);
}

// How wide a label is drawn: by default just its text. `size` scales with
// the font, `fixed` doesn't (a circle's padding).
function textWidth(box) {
  return { size: box.width, fixed: 0 };
}

const yOf = (node) => Number(node.getAttribute("y"));

// texts grouped by `keyOf` (staff line and voice), each with its numeric `attr`.
function byStaff(texts, attr, keyOf) {
  const groups = new Map();
  texts.forEach((text) => {
    const value = Number(text.getAttribute(attr));
    if (!Number.isFinite(value)) return;
    const key = keyOf(text);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ text, value });
  });
  return groups;
}

// The y most of a group's labels sit at (the higher one on a tie).
function usualRow(group) {
  const counts = new Map();
  group.forEach(({ value }) => counts.set(value, (counts.get(value) || 0) + 1));
  let best = null;
  counts.forEach((count, y) => {
    if (best === null || count > best.count || (count === best.count && y < best.y)) best = { y, count };
  });
  return best.y;
}

// Another annotation drawn with the same note already sits at `y`.
function rowTaken(text, y) {
  const group = text.parentNode;
  if (!group || typeof group.querySelectorAll !== "function") return false;
  return [...group.querySelectorAll(".abcjs-annotation")].some((other) => other !== text && Math.abs(yOf(other) - y) < 1);
}

function alignToUsualRow(texts, keyOf) {
  byStaff(texts, "y", keyOf).forEach((group) => {
    const row = usualRow(group);
    group.forEach(({ text, value }) => {
      if (value !== row && !rowTaken(text, row)) text.setAttribute("y", String(row));
    });
  });
}

// Labels shrink to fit between their neighbours, but not below this share
// of their size, so a tight run stays readable and even.
const MIN_FIT = 0.75;
// Room kept clear between two neighbouring labels, in svg units.
const FIT_GAP = 2;

function shrinkToFit(text, box, room, extent) {
  const size = Number(text.getAttribute("font-size"));
  if (!box || box.width <= 0 || !Number.isFinite(size) || size <= 0) return;
  const drawn = extent(box, text);
  if (drawn.size + drawn.fixed <= room) return;
  const scale = Math.max(MIN_FIT, (room - drawn.fixed) / drawn.size);
  text.setAttribute("font-size", String(Math.round(size * scale * 10) / 10));
}

// Each label (centred on its x) gets the width up to its nearer neighbour
// on the same staff line, less a small gap. Every label is measured before
// any is shrunk, so the sheet is laid out once, not once per label.
function fitBetweenNeighbours(texts, keyOf, extent) {
  const fits = [];
  byStaff(texts, "x", keyOf).forEach((row) => {
    row.sort((a, b) => a.value - b.value);
    row.forEach(({ text, value }, i) => {
      const left = i > 0 ? value - row[i - 1].value : Infinity;
      const right = i < row.length - 1 ? row[i + 1].value - value : Infinity;
      const room = Math.min(left, right) - FIT_GAP;
      if (Number.isFinite(room)) fits.push({ text, room });
    });
  });
  fits.map((fit) => ({ ...fit, box: bboxOf(fit.text) }))
    .forEach(({ text, box, room }) => shrinkToFit(text, box, room, extent));
}
