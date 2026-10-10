/*
  Draws the "Outside chords" layer (lib/music/diatonic.js) after ABCjs has
  engraved the sheet: each chord symbol that has a note outside the key gets
  a soft magenta shade behind it, as if ghosted, and its text turns magenta.
  The shade is an SVG rect inserted just before the symbol, so nothing goes
  into the ABC and nothing is played. (The tinted ghost notes of the Chord
  skeleton are that overlay's own business.)
*/
import { outsideChords } from "../../../lib/music/diatonic.js";
import { bboxOf, chordTexts, svgEl } from "./svg.js";

const PAD_X = 3;
const PAD_Y = 1.5;

export function markOutsideChords(visualObj) {
  outsideChords(visualObj).forEach(({ el }) => {
    chordTexts(el).forEach((text) => {
      text.classList.add("rj-layer-outside-text");
      const box = bboxOf(text);
      if (!box) return;
      text.before(svgEl("rect", {
        class: "rj-layer-outside-chord",
        x: box.x - PAD_X, y: box.y - PAD_Y,
        width: box.width + 2 * PAD_X, height: box.height + 2 * PAD_Y,
        rx: 3, "pointer-events": "none",
      }));
    });
  });
}
