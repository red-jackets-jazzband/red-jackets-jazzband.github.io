/*
  Solfège on the engraved sheet: the syllables lib/music/solfege.js wrote
  lose their invisible marker, get their own class and are centred under
  their note (ABCjs starts an annotation at the note's left edge), so they
  line up with the scale degrees and fingerings above them.
*/
import { parseSolfegeText } from "../../../lib/music/solfege.js";
import { noteheadCentre } from "./svg.js";

export function styleSolfege(notationEl) {
  notationEl.querySelectorAll(".abcjs-annotation").forEach((text) => {
    const syllable = parseSolfegeText(text.textContent.trim());
    if (syllable === null) return;
    text.textContent = syllable;
    text.classList.add("rj-layer-solfege");
    const centre = typeof text.getBBox === "function" ? noteheadCentre(text) : null;
    if (centre === null) return;
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("x", String(centre));
  });
}
