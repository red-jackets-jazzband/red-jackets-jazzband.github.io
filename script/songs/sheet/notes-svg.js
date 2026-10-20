/*
  A practice note set drawn on a little treble staff, on C (the practice
  panel's "Which notes" and "How to approach" cards): chord tones stacked as
  one chord, a scale set and an approach as a line of notes left to right.
  `items`: [{ degree, sharp, flat, approach }] — degree 1 is middle C (with
  its ledger line), 9 the D above the octave; an approach note is hollow,
  its target filled; a sharp or flat is drawn before its note. Painted in
  currentColor; split.css picks the colour (gold, or dark on a selected
  card).
*/

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 72;
const HEIGHT = 46;
// The bottom line (E4) at y 34, a line every 6px: a diatonic step is 3px.
const LINES = [10, 16, 22, 28, 34];
const STEP = 3;
const C4_Y = 40;
const CHORD_X = 36;

function node(name, attrs) {
  const element = document.createElementNS(SVG_NS, name);
  for (const key of Object.keys(attrs)) element.setAttribute(key, String(attrs[key]));
  return element;
}

const yOf = (degree) => C4_Y - (degree - 1) * STEP;

const hasAccidental = (item) => Boolean(item.sharp || item.flat);
// A note with an accidental takes this much more room before it, as a share
// of the plain step between two notes.
const ACCIDENTAL_ROOM = 1;
// A line this long or longer draws smaller noteheads, so neighbours don't run together.
const LONG_LINE = 6;

// A line of notes across the staff, left to right: evenly, except that a
// note with an accidental gets room in front of it for the sign.
function lineXs(items) {
  if (items.length === 1) return [CHORD_X];
  const start = hasAccidental(items[0]) ? 16 : 8;
  const steps = items.slice(1).map((item) => 1 + (hasAccidental(item) ? ACCIDENTAL_ROOM : 0));
  const unit = (66 - start) / steps.reduce((a, b) => a + b, 0);
  const xs = [start];
  for (const step of steps) xs.push(xs[xs.length - 1] + step * unit);
  return xs;
}

// Where each note goes: one column for a chord (a second steps aside, as
// engraved), else along the staff (lineXs).
function placeNotes(items, stacked) {
  if (!stacked) {
    const xs = lineXs(items);
    return items.map((item, i) => ({ ...item, x: xs[i], y: yOf(item.degree) }));
  }
  let prev = null;
  return items.map((item) => {
    const aside = prev !== null && prev.degree === item.degree - 1 && !prev.aside;
    prev = { degree: item.degree, aside };
    return { ...item, x: aside ? CHORD_X + 7 : CHORD_X, y: yOf(item.degree) };
  });
}

function flat(x, y) {
  return node("path", {
    class: "practice-notes-accidental",
    d: `M${x - 1.6} ${y - 7}V${y + 2.6}Q${x + 2.8} ${y + 0.6} ${x + 2} ${y - 1.2}Q${x + 1} ${y - 2.6} ${x - 1.6} ${y - 0.4}`,
  });
}

function sharp(x, y) {
  return node("path", {
    class: "practice-notes-accidental",
    d: `M${x - 1.1} ${y - 5}v10M${x + 1.1} ${y - 5.5}v10M${x - 2.4} ${y - 0.8}l4.8 -1.4M${x - 2.4} ${y + 2.6}l4.8 -1.4`,
  });
}

export function noteSetSvg(items, { stacked = false } = {}) {
  const svg = node("svg", {
    class: "practice-notes", viewBox: `0 0 ${WIDTH} ${HEIGHT}`, width: WIDTH, height: HEIGHT, "aria-hidden": "true",
  });
  for (const y of LINES) svg.append(node("line", { class: "practice-notes-line", x1: 2, x2: WIDTH - 2, y1: y, y2: y }));
  const small = !stacked && items.length >= LONG_LINE;
  for (const note of placeNotes(items, stacked)) {
    if (note.degree === 1) {
      svg.append(node("line", { class: "practice-notes-ledger", x1: note.x - 7, x2: note.x + 7, y1: C4_Y, y2: C4_Y }));
    }
    if (note.sharp) svg.append(sharp(note.x - 8, note.y));
    if (note.flat) svg.append(flat(note.x - 7.5, note.y));
    svg.append(node("ellipse", {
      class: note.approach ? "practice-notes-head is-hollow" : "practice-notes-head",
      cx: note.x, cy: note.y, rx: small ? 3.6 : 4.2, ry: small ? 2.6 : 3, transform: `rotate(-20 ${note.x} ${note.y})`,
    }));
  }
  return svg;
}

// A degree list as staff items: [1, 3, 5] -> [{ degree: 1 }, ...].
export const degreeItems = (degrees) => degrees.map((degree) => ({ degree }));
