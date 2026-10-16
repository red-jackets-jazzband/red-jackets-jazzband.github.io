/*
  Solfège on the engraved sheet: the syllables lib/music/solfege.js wrote
  lose their invisible marker, get their own class and are centred under
  their note (ABCjs starts an annotation at the note's left edge), so they
  line up with the scale degrees and fingerings above them — all on one
  row per staff line (svg.js's alignRows).
*/
import { parseSolfegeText } from "../../../lib/music/solfege.js";
import { alignRows, noteheadCentre } from "./svg.js";

export function styleSolfege(notationEl) {
  // Measure every note first, then restyle: a getBBox after a write lays the
  // whole sheet out again, once per syllable.
  const found = [];
  notationEl.querySelectorAll(".abcjs-annotation").forEach((text) => {
    const syllable = parseSolfegeText(text.textContent.trim());
    if (syllable === null) return;
    found.push({ text, syllable, centre: typeof text.getBBox === "function" ? noteheadCentre(text) : null });
  });
  const centred = [];
  found.forEach(({ text, syllable, centre }) => {
    text.textContent = syllable;
    text.classList.add("rj-layer-solfege");
    if (centre === null) return;
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("x", String(centre));
    centred.push(text);
  });
  alignRows(centred);
}
