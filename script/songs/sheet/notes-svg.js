/*
  A practice note set drawn on a little treble staff, on C (the practice
  panel's "Which notes" and "How to approach" cards): chord tones stacked as
  one chord, a scale set and an approach as a line of notes left to right.
  `items`: [{ degree, sharp, approach }] — degree 1 is middle C (with its
  ledger line), 9 the D above the octave; an approach note is hollow, its
  target filled; a sharp is drawn before its note. Painted in currentColor;
  split.css picks the colour (gold, or dark on a selected card).
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

// Where each note goes: one column for a chord (a second steps aside, as
// engraved), else evenly across the staff.
function placeNotes(items, stacked) {
  let prev = null;
  return items.map((item, i) => {
    let x;
    if (stacked) {
      const aside = prev !== null && prev.degree === item.degree - 1 && !prev.aside;
      x = aside ? CHORD_X + 7 : CHORD_X;
      prev = { degree: item.degree, aside };
    } else {
      x = items.length === 1 ? CHORD_X : 16 + i * (46 / (items.length - 1));
    }
    return { ...item, x, y: yOf(item.degree) };
  });
}

function sharp(x, y) {
  return node("path", {
    class: "practice-notes-sharp",
    d: `M${x - 1.4} ${y - 5}v10M${x + 1.4} ${y - 5.6}v10M${x - 3} ${y - 0.8}l6 -1.6M${x - 3} ${y + 2.6}l6 -1.6`,
  });
}

export function noteSetSvg(items, { stacked = false } = {}) {
  const svg = node("svg", {
    class: "practice-notes", viewBox: `0 0 ${WIDTH} ${HEIGHT}`, width: WIDTH, height: HEIGHT, "aria-hidden": "true",
  });
  for (const y of LINES) svg.append(node("line", { class: "practice-notes-line", x1: 2, x2: WIDTH - 2, y1: y, y2: y }));
  for (const note of placeNotes(items, stacked)) {
    if (note.degree === 1) {
      svg.append(node("line", { class: "practice-notes-ledger", x1: note.x - 7, x2: note.x + 7, y1: C4_Y, y2: C4_Y }));
    }
    if (note.sharp) svg.append(sharp(note.x - 9, note.y));
    svg.append(node("ellipse", {
      class: note.approach ? "practice-notes-head is-hollow" : "practice-notes-head",
      cx: note.x, cy: note.y, rx: 4.2, ry: 3, transform: `rotate(-20 ${note.x} ${note.y})`,
    }));
  }
  return svg;
}

// A degree list as staff items: [1, 3, 5] -> [{ degree: 1 }, ...].
export const degreeItems = (degrees) => degrees.map((degree) => ({ degree }));
