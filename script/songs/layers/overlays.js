/*
  What the Layers panel's switches add to the engraved sheet beyond the ABC
  annotations lib/music/layers.js already put into the text (ABCjs places
  and spaces those itself):

  - a named progression ("Salty Dog") is marked by its own chords: the
    pattern's chord symbols sit on one continuous highlighter bar per
    printed line, and its name is written in the same bar just before the
    first chord, over two lines ("Salty Dog" / "progression") — each name
    in its own warm shade;
  - scale degrees ("\u25CF3", "\u25CB\u266D7": lib/music/scale-degrees.js) lose their
    marker and sit centred under the note, a chord tone inside a green
    circle (as in Improvise for Real) and any other note bare;
  - fingering numbers get their own class, so split.css sets them upright
    and bold instead of the italic annotation face, and are centred under
    their notehead (ABCjs starts an annotation at the note's left edge).

  Called by sheet.js's paint() right after ABCjs draws, for the live sheet
  and a booklet alike (a booklet's plan simply has no layers on).
*/

import { PROGRESSION_WORD, progressionLabel } from "../../lib/music/progressions.js";
import { parseDegreeText } from "../../lib/music/scale-degrees.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const FINGERING_TEXT = /^(?:[0-7]{1,3}|\u00B7)$/;
const VALVE_UP = "\u00B7";
const VALVE_DIGITS = { 0: "0", 1: "1", 2: "2", 3: "3" };
const BAND_PAD_X = 6;
const BAND_PAD_Y = 2;
// split.css's rj-layer-prog--0 .. --4: amber, apricot, rose, butter, clay.
const BAND_SHADES = 5;

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

function noteGroup(el) {
  return el.abselem && el.abselem.elemset ? el.abselem.elemset[0] : null; // NOSONAR
}

// The progression's label among the annotations drawn with `el`.
function labelText(el, label) {
  const group = noteGroup(el);
  if (!group) return null;
  const texts = [...group.querySelectorAll(".abcjs-annotation")];
  return texts.find((t) => t.textContent.trim() === label) || null;
}

function bboxOf(node) {
  try {
    return node.getBBox();
  } catch {
    return null; // not laid out (jsdom, a hidden container)
  }
}

const BAR_RADIUS = 4;
const LABEL_PAD_X = 6;
const LABEL_GAP = 5;
// The two-line name is small so both lines fit the height of the chord row.
const LABEL_FONT_SIZE = 8;

// The union of `boxes` as { x1, y1, x2, y2 }.
function unionOf(boxes) {
  return {
    x1: Math.min(...boxes.map((box) => box.x)),
    y1: Math.min(...boxes.map((box) => box.y)),
    x2: Math.max(...boxes.map((box) => box.x + box.width)),
    y2: Math.max(...boxes.map((box) => box.y + box.height)),
  };
}

/*
  The outline of a bar from (x1, y1) to (x2, y2), rounded at its corners. A
  side that is `open` (the progression carries on past the line's end, or
  came in from before its start) has square corners and no edge there.
  Returns the closed outline to fill and the visible edge to stroke (several
  subpaths when a side is open), so an open side has colour but no border.
*/
function barPath({ x1, y1, x2, y2 }, open) {
  const r = BAR_RADIUS;
  const rl = open.left ? 0 : r;
  const rr = open.right ? 0 : r;
  // [command, visible]; every command ends at its last pair of numbers.
  const segs = [[`L${x2 - rr} ${y2}`, true]];
  if (rr > 0) segs.push([`Q${x2} ${y2} ${x2} ${y2 - rr}`, true]);
  segs.push([`L${x2} ${y1 + rr}`, !open.right]);
  if (rr > 0) segs.push([`Q${x2} ${y1} ${x2 - rr} ${y1}`, true]);
  segs.push([`L${x1 + rl} ${y1}`, true]);
  if (rl > 0) segs.push([`Q${x1} ${y1} ${x1} ${y1 + rl}`, true]);
  segs.push([`L${x1} ${y2 - rl}`, !open.left]);
  if (rl > 0) segs.push([`Q${x1} ${y2} ${x1 + rl} ${y2}`, true]);
  return outlinePaths(`${x1 + rl} ${y2}`, segs);
}

// The same segments as a closed outline and as a stroke that skips the
// invisible ones (starting a new subpath after each gap).
function outlinePaths(start, segs) {
  const fill = `M${start} ${segs.map(([cmd]) => cmd).join(" ")} Z`;
  const edge = [];
  let from = start;
  let drawing = false;
  segs.forEach(([cmd, visible]) => {
    const to = cmd.slice(1).trim().split(/\s+/).slice(-2).join(" ");
    if (visible && !drawing) edge.push(`M${from}`);
    if (visible) edge.push(cmd);
    drawing = visible;
    from = to;
  });
  return { fill, edge: edge.join(" ") };
}

// The printed line's svg clips whatever sits above its viewBox, and a chord
// row can sit within a few pixels of it: slide the bar's top down to `minY`
// and let the bottom take the height that would otherwise be cut off.
function keepBelow(bar, minY) {
  if (bar.y1 >= minY) return;
  bar.y2 += minY - bar.y1;
  bar.y1 = minY;
}

// Where the svg's visible area starts (-Infinity when it can't be read).
function viewTop(svg) {
  const box = svg.viewBox && svg.viewBox.baseVal; // NOSONAR
  return box ? box.y : -Infinity;
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

/*
  One shade per progression *name*, in order of first appearance — the same
  idea as the form strip's arrows (sheet.js's stepShades): every Salty Dog
  on the page wears the same tone, a Georgia next to it a different one.
  The same progression twice in a row (Honky Tonk Town's two eight-bar
  choruses of Four-Leaf, with no chord between) would read as one long
  band, so every second one of such a run gets the `rj-layer-prog-alt`
  tint — lighter, same hue — to show where one ends and the next begins.
*/
export function progressionShades(progressions) {
  const names = [];
  let previous = null;
  let alt = false;
  return progressions.map((match) => {
    if (!names.includes(match.name)) names.push(match.name);
    const touches = previous !== null && previous.name === match.name && previous.endNote >= match.startNote;
    alt = touches && !alt;
    previous = match;
    const shade = `rj-layer-prog--${names.indexOf(match.name) % BAND_SHADES}`;
    return alt ? `${shade} rj-layer-prog-alt` : shade;
  });
}

// The chord symbols drawn with `el`.
function chordTexts(el) {
  const group = noteGroup(el);
  return group ? [...group.querySelectorAll(".abcjs-chord")] : [];
}

// A progression is shown on each printed line it runs over by its own chords
// on one continuous bar, carrying its name before the first chord on the
// first line.
function drawProgressions(visualObj, progressions) {
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

// The horizontal middle of the noteheads drawn alongside `text`, or null.
function noteheadCentre(text) {
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

function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  Object.keys(attrs).forEach((key) => node.setAttribute(key, String(attrs[key])));
  return node;
}

/*
  One slot of the valve diagram (the annotation lines lib/music/fingerings.js
  writes, top valve first) drawn as a shape rather than the font's glyph,
  which is thin and tiny at annotation size: a pressed valve is a solid
  disc with a bold white number, an open horn a ring with a 0, a valve left
  up a small grey dot. The annotation text stays in place (invisible, via
  split.css) for anything that reads it.
*/
function drawValveSlot(text, glyph, centre) {
  const box = bboxOf(text);
  if (!box || !text.parentNode) return;
  const radius = Math.min(6, Math.max(4.5, box.height / 2));
  const cy = box.y + box.height / 2;
  const digit = VALVE_DIGITS[glyph];
  const group = svgEl("g", { class: "rj-layer-valves" });
  if (digit === undefined) {
    group.append(svgEl("circle", { class: "rj-layer-valve-up", cx: centre, cy, r: 1.6 }));
  } else {
    group.append(svgEl("circle", { class: digit === "0" ? "rj-layer-valve rj-layer-valve--open" : "rj-layer-valve", cx: centre, cy, r: radius }));
    const label = svgEl("text", {
      class: "rj-layer-valve-digit",
      x: centre,
      y: cy,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "font-size": radius * 1.5,
    });
    label.textContent = digit;
    group.append(label);
  }
  text.parentNode.append(group);
  text.classList.add("rj-layer-fingering--drawn");
}

function centreUnderNote(text) {
  if (typeof text.getBBox !== "function") return;
  const centre = noteheadCentre(text);
  if (centre === null) return;
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("x", String(centre));
  const glyph = text.textContent.trim();
  if (glyph === VALVE_UP || VALVE_DIGITS[glyph] !== undefined) drawValveSlot(text, glyph, centre);
}

function styleFingerings(notationEl) {
  notationEl.querySelectorAll(".abcjs-annotation").forEach((text) => {
    if (!FINGERING_TEXT.test(text.textContent.trim())) return;
    text.classList.add("rj-layer-fingering");
    centreUnderNote(text);
  });
}

const DEGREE_PAD = 1.6;

// The circle round a chord tone's number.
function drawDegreeShape(text) {
  const box = bboxOf(text);
  const centre = noteheadCentre(text);
  if (!box || centre === null || !text.parentNode) return;
  const radius = Math.max(box.width, box.height) / 2 + DEGREE_PAD;
  const shape = svgEl("circle", {
    class: "rj-layer-degree-circle",
    cx: centre,
    cy: box.y + box.height / 2,
    r: radius,
  });
  text.parentNode.insertBefore(shape, text);
}

function styleDegrees(notationEl) {
  notationEl.querySelectorAll(".abcjs-annotation").forEach((text) => {
    const parsed = parseDegreeText(text.textContent.trim());
    if (parsed === null) return;
    text.textContent = parsed.degree;
    text.classList.add("rj-layer-degree", `rj-layer-degree--${parsed.tone}`);
    const centre = typeof text.getBBox === "function" ? noteheadCentre(text) : null;
    if (centre === null) return;
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("x", String(centre));
    if (parsed.tone === "chord") drawDegreeShape(text);
  });
}

export function decorateLayers(notationEl, visualObj, plan) {
  if (!notationEl || !visualObj) return;
  if (plan.progressions && plan.progressions.length > 0) drawProgressions(visualObj, plan.progressions);
  if (plan.layersApplied && plan.layersApplied.includes("fingerings")) styleFingerings(notationEl); // NOSONAR
  if (plan.layersApplied && plan.layersApplied.includes("scale-degrees")) styleDegrees(notationEl); // NOSONAR
}
