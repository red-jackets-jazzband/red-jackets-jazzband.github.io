/*
  Scale degrees on the engraved sheet: the annotation lib/music/scale-degrees.js
  wrote ("●3", "○♭7") loses its marker and is centred under its note, a chord
  tone inside a circle (as in Improvise for Real) and any other note bare,
  all on one row per staff line (svg.js's alignRows).
*/
import { parseDegreeText } from "../../../lib/music/scale-degrees.js";
import { alignRows, bboxOf, noteheadCentre, svgEl } from "./svg.js";

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

// How wide a degree label is drawn: a chord tone's circle (drawDegreeShape)
// is its number's larger side plus padding all round; any other is its text.
function degreeExtent(box, text) {
  if (!text.classList.contains("rj-layer-degree--chord")) return { size: box.width, fixed: 0 };
  return { size: Math.max(box.width, box.height), fixed: 2 * DEGREE_PAD };
}

export function styleDegrees(notationEl) {
  const styled = [];
  notationEl.querySelectorAll(".abcjs-annotation").forEach((text) => {
    const parsed = parseDegreeText(text.textContent.trim());
    if (parsed === null) return;
    text.textContent = parsed.degree;
    text.classList.add("rj-layer-degree", `rj-layer-degree--${parsed.tone}`);
    const centre = typeof text.getBBox === "function" ? noteheadCentre(text) : null;
    if (centre === null) return;
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("x", String(centre));
    styled.push({ text, tone: parsed.tone });
  });
  // Back on one row before the circles are drawn round where they end up,
  // a chord tone fitted by its circle, not just its number.
  alignRows(styled.map((s) => s.text), { extent: degreeExtent });
  styled.forEach(({ text, tone }) => {
    if (tone === "chord") drawDegreeShape(text);
  });
}
