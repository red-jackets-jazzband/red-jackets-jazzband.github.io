/*
  Fingerings on the engraved sheet: the annotation lines
  lib/music/fingerings.js wrote ("1", "·", "0" — one per valve) get their
  own class, are centred under their notehead, and each slot of a valve
  diagram is drawn as a shape — a pressed valve a solid disc with a bold
  number, an open horn a ring, a valve left up a small dot.
*/
import { VALVE_UP, usesValveDiagram } from "../../../lib/music/fingerings.js";
import { bboxOf, noteheadCentre, svgEl } from "./svg.js";

const FINGERING_TEXT = /^(?:[0-7]{1,3}|\u00B7)$/;
const VALVE_DIGITS = { 0: "0", 1: "1", 2: "2", 3: "3" };

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

function centreUnderNote(text, drawValves) {
  if (typeof text.getBBox !== "function") return;
  const centre = noteheadCentre(text);
  if (centre === null) return;
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("x", String(centre));
  const glyph = text.textContent.trim();
  if (drawValves && (glyph === VALVE_UP || VALVE_DIGITS[glyph] !== undefined)) drawValveSlot(text, glyph, centre);
}

// `instrument` decides the look: valves are drawn as a diagram of discs, a
// trombone's positions stay a plain bold digit (position 1-3 would
// otherwise be mistaken for valves).
export function styleFingerings(notationEl, instrument) {
  const drawValves = usesValveDiagram(instrument);
  notationEl.querySelectorAll(".abcjs-annotation").forEach((text) => {
    if (!FINGERING_TEXT.test(text.textContent.trim()) || text.classList.contains("rj-layer-degree")) return;
    text.classList.add("rj-layer-fingering");
    centreUnderNote(text, drawValves);
  });
}
