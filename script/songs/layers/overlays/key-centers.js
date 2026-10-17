/*
  Draws the "Key centres" layer (lib/music/key-centers.js) after ABCjs has
  engraved the sheet: each stretch of the tune in one key gets a dim tint
  behind its staves, one shade per key, and the key's name (the `_` label
  annotation the layer wrote at the stretch's first note) loses its marker
  and moves to the tint's left edge, in the tint's colour. A tint starts and
  ends at the bar line where the key signature changes (else halfway
  between the two notes), and runs out to the
  staff's edge where the stretch carries on to the next printed line.
*/
import { keyCenterShades, keyCenters, parseKeyCenterText } from "../../../lib/music/key-centers.js";
import { unionOf } from "../../../lib/music/layer-geometry.js";
import { bboxOf, noteGroup, svgEl } from "./svg.js";

const PAD_Y = 3;
const LABEL_PAD_X = 3;

// The first voice line by line: its notes (with their tune-wide index) and
// bar lines, in order.
function voiceLines(visualObj) {
  const lines = [];
  let index = 0;
  (visualObj.lines || []).forEach((line) => {
    const staff = line.staff && line.staff[0]; // NOSONAR
    if (!staff || !staff.voices) return; // NOSONAR
    const items = [];
    (staff.voices[0] || []).forEach((el) => {
      if (el.el_type === "note") {
        items.push({ el, note: index });
        index += 1;
      } else if (el.el_type === "bar") {
        items.push({ el, note: null });
      }
    });
    if (items.some((item) => item.note !== null)) lines.push(items);
  });
  return lines;
}

function boxOf(el) {
  const group = noteGroup(el);
  return group ? bboxOf(group) : null;
}

// Where the tint meets its neighbour beside items[i] (the item before it,
// step -1, or after it, step 1): on that item if it's a bar line, else
// halfway between the two notes.
function boundary(items, i, step) {
  const next = items[i + step];
  const here = boxOf(items[i].el);
  const box = next ? boxOf(next.el) : null;
  if (!box || !here) return null;
  if (next.note === null) return box.x + box.width / 2;
  return step > 0 ? (here.x + here.width + box.x) / 2 : (box.x + box.width + here.x) / 2;
}

function staffBox(svg) {
  const boxes = [...svg.querySelectorAll(".abcjs-staff")].map(bboxOf).filter(Boolean);
  return boxes.length === 0 ? null : unionOf(boxes);
}

// Where one stretch's tint goes on one printed line (its items from
// `first` to `last`): { svg, x, y, width, height }, or null.
function measureTint(items, first, last) {
  const group = noteGroup(items[first].el);
  const svg = group && group.ownerSVGElement; // NOSONAR
  const staff = svg ? staffBox(svg) : null;
  if (!staff) return null;
  const notes = items.filter((item) => item.note !== null);
  const x1 = items[first] === notes[0] ? staff.x1 : boundary(items, first, -1);
  const x2 = items[last] === notes[notes.length - 1] ? staff.x2 : boundary(items, last, 1);
  if (x1 === null || x2 === null || x2 <= x1) return null;
  return { svg, x: x1, y: staff.y1 - PAD_Y, width: x2 - x1, height: staff.y2 - staff.y1 + 2 * PAD_Y };
}

function drawTint({ svg, x, y, width, height }, shade) {
  // First in the svg, so the notation draws over it.
  svg.insertBefore(svgEl("rect", {
    class: `rj-layer-key-band rj-layer-key--${shade}`,
    x, y, width, height, "pointer-events": "none",
  }), svg.firstChild);
}

// The stretch's name: the marked annotation drawn with its first note.
function nameLabel(el) {
  const group = noteGroup(el);
  if (!group) return null;
  return [...group.querySelectorAll(".abcjs-annotation")]
    .find((text) => parseKeyCenterText(text.textContent.trim()) !== null) || null;
}

function styleLabel(label, shade, x) {
  label.textContent = parseKeyCenterText(label.textContent.trim());
  label.classList.add("rj-layer-key-label", `rj-layer-key--${shade}`);
  if (x === null) return;
  label.setAttribute("text-anchor", "start");
  label.setAttribute("x", String(x + LABEL_PAD_X));
}

export function drawKeyCenters(visualObj) {
  const stretches = keyCenters(visualObj);
  const shades = keyCenterShades(stretches);
  const lines = voiceLines(visualObj);
  // Measure every line first, then write: a getBBox after a DOM write lays
  // the whole sheet out again.
  const plans = [];
  stretches.forEach((stretch, k) => {
    lines.forEach((items) => {
      const inside = (item) => item.note !== null && item.note >= stretch.startNote && item.note <= stretch.endNote;
      const first = items.findIndex(inside);
      if (first === -1) return;
      let last = first;
      items.forEach((item, i) => { if (inside(item)) last = i; });
      const label = items[first].note === stretch.startNote ? nameLabel(items[first].el) : null;
      plans.push({ items, first, last, shade: shades[k], label });
    });
  });
  plans.map((plan) => ({ ...plan, box: measureTint(plan.items, plan.first, plan.last) }))
    .forEach(({ box, shade, label }) => {
      if (box) drawTint(box, shade);
      if (label) styleLabel(label, shade, box ? box.x : null);
    });
}
