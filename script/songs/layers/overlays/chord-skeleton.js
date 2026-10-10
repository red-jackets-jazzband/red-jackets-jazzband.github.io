/*
  Draws the "Chord skeleton" layer (lib/music/chord-skeleton.js) after
  ABCjs has engraved the sheet: each chord's notes as faint grey noteheads on
  the staff, just left of the note the chord symbol sits on, so no melody
  note or stem covers one (when the previous element is too close to leave
  room, the stack slides right until its heads at most touch the note's left
  edge). They are SVG
  shapes only — nothing goes into the ABC, so nothing is played — and each is
  inserted just under its column's own note group, so the staff lines are
  drawn over it.

  Where a note goes is measured, not computed: the vertical step between
  staff positions is read off two engraved noteheads, and every printed line
  is anchored on its own first note (or, with no pitched note, its top staff line).
*/
import { chordSkeletons } from "../../../lib/music/chord-skeleton.js";
import { bboxOf, noteGroup, svgEl } from "./svg.js";

// verticalPos of the bottom and top staff lines (treble and bass alike).
const BOTTOM_LINE = 2;
const TOP_LINE = 10;
// Gap before the note, and the sideways shift of a second, in head radii.
const GAP_RX = 0.6;
const SECOND_SHIFT_RX = 1.9;
// How far the stack's right edge may reach into the note's left edge, in head radii.
const OVERLAP_RX = 0.1;

// The element's noteheads' boxes, top first.
function headBoxes(group) {
  return [...group.querySelectorAll(".abcjs-notehead")]
    .map(bboxOf)
    .filter(Boolean)
    .sort((a, b) => a.y - b.y);
}

// The left edge of what the column's own note draws (noteheads, a rest, its
// accidental), or null.
function columnLeft(group) {
  const shapes = [...group.querySelectorAll(".abcjs-notehead, [data-name^='rests'], [data-name^='accidentals']")]
    .map(bboxOf)
    .filter(Boolean);
  return shapes.length === 0 ? null : Math.min(...shapes.map((b) => b.x));
}

// { vp, y } of a melody note's top notehead (the top pitch's verticalPos), or null.
function headReference(el) {
  const group = noteGroup(el);
  if (!group || el.el_type !== "note" || el.rest || !el.pitches || el.pitches.length === 0) return null;
  const boxes = headBoxes(group);
  if (boxes.length === 0) return null;
  const vp = Math.max(...el.pitches.map((p) => p.verticalPos));
  return { vp, y: boxes[0].y + boxes[0].height / 2 };
}

// { vp, y } of the printed line's top staff line (the first staff's), which
// anchors a line with no pitched note to measure from, or null.
function staffReference(group) {
  const svg = group.ownerSVGElement;
  const line = svg ? svg.querySelector(".abcjs-top-line") : null;
  const box = line ? bboxOf(line) : null;
  return box ? { vp: TOP_LINE, y: box.y + box.height / 2 } : null;
}

// For each printed line, its first melody note that has a measurable head.
function lineReferences(visualObj) {
  const refs = [];
  (visualObj.lines || []).forEach((line) => {
    const staff = line.staff && line.staff[0]; // NOSONAR
    const found = [];
    if (staff && staff.voices) { // NOSONAR
      (staff.voices[0] || []).forEach((el) => {
        const ref = headReference(el);
        if (ref !== null) found.push(ref);
      });
    }
    refs.push(found);
  });
  return refs;
}

// The distance one verticalPos step is drawn as: two heads at different
// positions on the same line.
function stepFrom(references) {
  for (const found of references) {
    const first = found[0];
    const other = first && found.find((ref) => ref.vp !== first.vp); // NOSONAR
    if (other) return Math.abs((other.y - first.y) / (other.vp - first.vp));
  }
  return null;
}

// Where each first-voice element sits: { line, previous } (the element
// before it in the same voice, or null).
function placesOf(visualObj) {
  const map = new Map();
  (visualObj.lines || []).forEach((line, index) => {
    const staff = line.staff && line.staff[0]; // NOSONAR
    if (!staff || !staff.voices) return; // NOSONAR
    const voice = staff.voices[0] || [];
    voice.forEach((el, i) => map.set(el, { line: index, previous: i > 0 ? voice[i - 1] : null }));
  });
  return map;
}

// The right edge of what an element draws (heads, rests, bar lines — not its
// chord symbol, annotations or lyrics, which can reach past it), or null.
function drawnRight(el) {
  const group = el ? noteGroup(el) : null;
  if (!group) return null;
  const boxes = [...group.querySelectorAll("path, rect, line")]
    .filter((node) => !node.closest(".abcjs-chord, .abcjs-annotation, .abcjs-lyric"))
    .map(bboxOf)
    .filter(Boolean);
  return boxes.length === 0 ? null : Math.max(...boxes.map((b) => b.x + b.width));
}

// Does the chord have two notes a step apart (drawn side by side)?
function hasSecond(notes) {
  const positions = notes.map((n) => n.vp).sort((a, b) => a - b);
  return positions.some((vp, i) => i > 0 && vp - positions[i - 1] === 1);
}

// A skeleton note's radii from the staff step: a notehead is about one
// staff space (two steps) tall.
function headSize(step) {
  return { rx: step * 1.35, ry: step * 0.95 };
}

// Ledger lines a note outside the staff needs, as even verticalPos values.
function ledgerPositions(vp) {
  const out = [];
  for (let at = BOTTOM_LINE - 2; at >= vp; at -= 2) out.push(at);
  for (let at = TOP_LINE + 2; at <= vp; at += 2) out.push(at);
  return out;
}

/*
  One chord's notes at column `x`, as a <g>. `yOf(vp)` maps a position to its
  y. A note a second above its neighbour moves to the right of it, as on a
  printed chord.
*/
function buildStack(notes, x, yOf, step, markOutside) {
  const { rx, ry } = headSize(step);
  const group = svgEl("g", { class: "rj-layer-skeleton", "pointer-events": "none" });
  const ordered = notes.slice().sort((a, b) => a.vp - b.vp);
  let previous = null;
  ordered.forEach((note) => {
    const cx = previous !== null && note.vp - previous.vp === 1 && !previous.shifted ? x + rx * SECOND_SHIFT_RX : x;
    note.shifted = cx !== x;
    previous = note;
    const cy = yOf(note.vp);
    ledgerPositions(note.vp).forEach((at) => {
      group.append(svgEl("line", {
        class: "rj-layer-skeleton-ledger",
        x1: cx - rx * 1.5, x2: cx + rx * 1.5, y1: yOf(at), y2: yOf(at),
      }));
    });
    const tint = markOutside && note.outside ? " rj-layer-skeleton--outside" : "";
    group.append(svgEl("ellipse", {
      class: `rj-layer-skeleton-note${tint}`,
      cx, cy, rx, ry, transform: `rotate(-20 ${cx} ${cy})`,
    }));
    if (note.accidental) {
      const sign = svgEl("text", {
        class: `rj-layer-skeleton-accidental${tint}`,
        x: x - rx * 1.5, y: cy, "text-anchor": "end", "dominant-baseline": "central", "font-size": step * 5,
      });
      sign.textContent = note.accidental;
      group.append(sign);
    }
  });
  return group;
}

// `markOutside`: tint the notes that aren't in the key (the Outside chords layer).
export function drawChordSkeleton(visualObj, { markOutside = false } = {}) {
  const skeletons = chordSkeletons(visualObj);
  if (skeletons.length === 0) return;
  const references = lineReferences(visualObj);
  const step = stepFrom(references);
  if (step === null) return;
  const places = placesOf(visualObj);
  skeletons.forEach((skeleton) => {
    const group = noteGroup(skeleton.el);
    if (!group || !group.parentNode) return; // NOSONAR
    const place = places.get(skeleton.el) || { line: -1, previous: null };
    const found = references[place.line];
    const left = columnLeft(group);
    const anchor = found && found.length > 0 ? found[0] : staffReference(group); // NOSONAR
    if (left === null || anchor === null) return;
    const notes = skeleton.notes.map((n) => ({ ...n }));
    const { rx } = headSize(step);
    // The stack sits just left of the note, its right edge a little before the
    // note's left edge (a second in the chord pushes one head right, so it
    // needs the room too).
    const reach = hasSecond(notes) ? SECOND_SHIFT_RX + 1 : 1;
    const hasSign = notes.some((n) => n.accidental);
    const before = drawnRight(place.previous);
    const ideal = left - GAP_RX * rx - reach * rx;
    // With the previous element (a bar line, the clef/key/meter) too close to
    // leave that room, it slides right to clear it - but never past the note:
    // the stack's right edge (its shifted head too, when the chord has a
    // second) at most touches the melody note's left edge, so it still reads
    // as sitting before it, not on it.
    const signRoom = hasSign ? 2.2 : 0;
    const clear = before === null ? ideal : before + (1.8 + signRoom) * rx;
    const x = Math.min(Math.max(ideal, clear), left - (reach - OVERLAP_RX) * rx);
    const stack = buildStack(notes, x, (vp) => anchor.y + (anchor.vp - vp) * step, step, markOutside);
    group.before(stack);
  });
}
