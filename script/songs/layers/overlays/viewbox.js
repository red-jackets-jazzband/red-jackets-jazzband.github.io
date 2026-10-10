/*
  Keeps a printed line's chord letters inside its svg — see growViewBox in
  lib/music/layer-geometry.js for what goes wrong and why. The chord font may
  still be loading when a sheet is drawn, and the letters measure
  differently once it is in, so the check is repeated then.
*/
import { growViewBox } from "../../../lib/music/layer-geometry.js";
import { bboxOf } from "./svg.js";

// Room kept above the chord letters when a line's viewBox is grown to them.
const CHORD_HEADROOM = 1;

function growToChords(notationEl) {
  notationEl.querySelectorAll("svg").forEach((svg) => {
    const view = svg.viewBox && svg.viewBox.baseVal; // NOSONAR
    if (!view) return;
    const tops = [...svg.querySelectorAll(".abcjs-chord")].map(bboxOf).filter(Boolean).map((box) => box.y);
    const grown = growViewBox(view, tops, CHORD_HEADROOM);
    if (grown) svg.setAttribute("viewBox", `${grown.x} ${grown.y} ${grown.width} ${grown.height}`);
  });
}

export function uncropChords(notationEl) {
  growToChords(notationEl);
  const fonts = document.fonts; // NOSONAR
  if (fonts && fonts.status !== "loaded") {
    fonts.ready.then(() => growToChords(notationEl)).catch(() => {}); // NOSONAR
  }
}
