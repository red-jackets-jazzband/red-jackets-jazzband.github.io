/*
  A named progression on the engraved sheet: on each printed line it runs
  over, its own chord symbols sit on one continuous highlighter bar, and its
  name is written in the bar just before the first chord over two lines
  ("Salty Dog" / "progression"), each name in its own warm shade. The name
  is the `_` label annotation lib/music/layers.js wrote, moved up out of its
  slot under the staff; it links to the blog post that explains the
  progression.
*/
import { PROGRESSION_WORD, progressionLabel } from "../../../lib/music/progressions.js";
import {
  barPath, keepBelow, progressionShades, unionOf,
} from "../../../lib/music/layer-geometry.js";
import {
  SVG_NS, bboxOf, chordTexts, noteGroup, viewTop,
} from "./svg.js";

const BAND_PAD_X = 6;
const BAND_PAD_Y = 2;
const LABEL_PAD_X = 6;
const LABEL_GAP = 5;
// The two-line name is small so both lines fit the height of the chord row.
const LABEL_FONT_SIZE = 8;

// The tune's first voice, in order, across every line: { el, line }.
function melodyNotes(visualObj) {
  const notes = [];
  (visualObj.lines || []).forEach((line, lineIndex) => {
    const staff = line.staff && line.staff[0]; // NOSONAR
    if (!staff || !staff.voices) return; // NOSONAR
    (staff.voices[0] || []).forEach((el) => {
      if (el.el_type === "note") notes.push({ el, line: lineIndex });
    });
  });
  return notes;
}

// The progression's label among the annotations drawn with `el`.
function labelText(el, label) {
  const group = noteGroup(el);
  if (!group) return null;
  const texts = [...group.querySelectorAll(".abcjs-annotation")];
  return texts.find((t) => t.textContent.trim() === label) || null;
}

/*
  Write the name inside the bar, just left of its first chord, over two lines
  ("Sunshine" / "progression"): the label annotation (moved up out of its slot
  under the staff) keeps the name, a copy carries the word. The bar grows to
  the left to hold them (and in height, if the chord row is shorter than the
  two lines). Returns false when the text can't be measured (jsdom, a hidden
  container), leaving the label where ABCjs put it.
*/
function placeLabel(label, bar, name, minY) {
  label.textContent = name;
  label.setAttribute("font-size", String(LABEL_FONT_SIZE));
  const second = label.cloneNode(false);
  second.textContent = PROGRESSION_WORD;
  label.after(second);
  const first = bboxOf(label);
  const word = bboxOf(second);
  if (!first || !word) {
    second.remove();
    label.textContent = progressionLabel(name);
    return false;
  }
  const lineHeight = first.height;
  const need = 2 * lineHeight + 2;
  const deficit = Math.max(0, need - (bar.y2 - bar.y1));
  bar.y1 -= deficit / 2;
  bar.y2 += deficit / 2;
  keepBelow(bar, minY);
  const top = (bar.y1 + bar.y2) / 2 - lineHeight;
  const left = bar.x1 - LABEL_GAP - Math.max(first.width, word.width) - LABEL_PAD_X;
  bar.x1 = left;
  [label, second].forEach((line, i) => {
    line.setAttribute("text-anchor", "start");
    line.setAttribute("x", String(left + LABEL_PAD_X));
    line.setAttribute("y", String(top + lineHeight * (0.78 + i)));
  });
  return true;
}

// Wrap the label's text line(s) in a link to the progression's blog post.
function linkLabel(lines, url) {
  const link = document.createElementNS(SVG_NS, "a");
  link.setAttribute("class", "rj-layer-prog-link");
  link.setAttribute("href", url);
  link.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", url);
  link.setAttribute("target", "_blank");
  link.setAttribute("rel", "noopener");
  lines[0].before(link);
  link.append(...lines);
}

// The bar's extent behind `chords` (or, with none, behind the label), padded.
function barBehind(chords, label) {
  const boxes = (chords.length > 0 ? chords : [label]).map(bboxOf).filter(Boolean);
  if (boxes.length === 0) return null;
  const { x1, y1, x2, y2 } = unionOf(boxes);
  return { x1: x1 - BAND_PAD_X, y1: y1 - BAND_PAD_Y, x2: x2 + BAND_PAD_X, y2: y2 + BAND_PAD_Y };
}

// The printed line's staff, left to right, as { x1, x2 } (or null).
function staffExtent(svg) {
  const boxes = [...svg.querySelectorAll(".abcjs-staff")].map(bboxOf).filter(Boolean);
  if (boxes.length === 0) return null;
  const { x1, x2 } = unionOf(boxes);
  return { x1, x2 };
}

// Run the bar's open sides out to the staff's edge; returns the sides that
// are open after all (none when the staff can't be measured).
function runOut(svg, bar, open) {
  const staff = open.left || open.right ? staffExtent(svg) : null;
  if (!staff) return { left: false, right: false };
  if (open.left) bar.x1 = staff.x1;
  if (open.right) bar.x2 = staff.x2;
  return open;
}

function pathEl(d, shade, fill) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("class", `rj-layer-prog-band ${shade}`);
  path.setAttribute("d", d);
  // The outline carries the colour, the edge the border (inline wins over
  // the stylesheet's one rule that sets both).
  path.style[fill ? "stroke" : "fill"] = "none";
  return path;
}

/*
  One progression's stretch of one printed line: its chord symbols on a
  single continuous highlighter bar, with the name written in the bar just
  before the first chord (the label annotation, moved up out of its slot under
  the staff). With no chord symbols to sit behind, the label gets a plain
  one-line pill. `open` says the progression carries on past the line's end /
  came in from before its start: that side runs out to the staff's edge with
  no border.
*/
function drawMarking(chords, label, shade, open, match) {
  const { name, url } = match;
  const texts = chords.concat(label ? [label] : []);
  texts.forEach((text) => text.classList.add("rj-layer-prog-text", ...shade.split(" ")));
  const anchor = chords[0] || label;
  const svg = anchor && anchor.ownerSVGElement; // NOSONAR
  if (!svg || typeof anchor.getBBox !== "function") return;
  const bar = barBehind(chords, label);
  if (!bar) return;
  const sides = runOut(svg, bar, open);
  const minY = viewTop(svg);
  keepBelow(bar, minY);
  // The label's copy for the second line inherits its classes.
  const placed = label && chords.length > 0 && placeLabel(label, bar, name, minY);
  if (label && url) linkLabel(placed ? [label, label.nextElementSibling] : [label], url);
  const { fill, edge } = barPath(bar, sides);
  // First in the svg, so the notation draws over them.
  svg.insertBefore(pathEl(edge, shade, false), svg.firstChild);
  svg.insertBefore(pathEl(fill, shade, true), svg.firstChild);
}

// A progression is shown on each printed line it runs over by its own chords
// on one continuous bar, carrying its name before the first chord on the
// first line.
export function drawProgressions(visualObj, progressions) {
  const notes = melodyNotes(visualObj);
  const shades = progressionShades(progressions);
  progressions.forEach((match, k) => {
    const lines = new Map();
    const stretch = (line) => {
      if (!lines.has(line)) lines.set(line, { chords: [], label: null });
      return lines.get(line);
    };
    match.chordNotes.forEach((index) => {
      const note = notes[index];
      if (note) stretch(note.line).chords.push(...chordTexts(note.el));
    });
    // The name is written once, on the progression's first note; a line it
    // runs onto is marked by its open bar alone.
    const first = notes[match.startNote];
    const nameLabel = first ? labelText(first.el, progressionLabel(match.name)) : null;
    if (nameLabel) stretch(first.line).label = nameLabel;
    const order = [...lines.keys()].sort((a, b) => a - b);
    order.forEach((line, i) => {
      const { chords, label } = lines.get(line);
      if (chords.length === 0 && !label) return;
      drawMarking(chords, label, shades[k], { left: i > 0, right: i < order.length - 1 }, match);
    });
  });
}
