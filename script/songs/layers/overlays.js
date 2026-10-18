/*
  What the Layers panel's switches add to the engraved sheet beyond the ABC
  annotations lib/music/layers.js already put into the text (ABCjs places
  and spaces those itself):

  - a named progression ("Salty Dog") is marked by its own chords: the
    pattern's chord symbols sit on one continuous highlighter bar per
    printed line, and its name is written in the same bar just before the
    first chord, over two lines ("Salty Dog" / "progression") — each name
    in its own warm shade;
  - an outside chord (one with a note outside the key: lib/music/diatonic.js)
    gets a soft magenta shade behind its chord symbol, and, with the Chord
    skeleton on, its out-of-key ghost notes are tinted to match;
  - a key centre (lib/music/key-centers.js: each key signature's stretch)
    gets a dim tint behind its staves, one shade
    per key, with the key's name at its left edge;
  - a chord symbol gets its Roman numeral in the key written just behind
    it (lib/music/roman-numerals.js), smaller, shrunk to fit before the
    next chord;
  - scale degrees ("\u25CF3", "\u25CB\u266D7": lib/music/scale-degrees.js) lose their
    marker and sit centred under the note, a chord tone inside a magenta
    circle (as in Improvise for Real) and any other note bare;
  - solfège syllables (lib/music/solfege.js) lose their invisible marker
    and are centred under their note, in the same face as the degrees;
  - fingering numbers get their own class, so split.css sets them upright
    and bold instead of the italic annotation face, and are centred under
    their notehead (ABCjs starts an annotation at the note's left edge).

  Called by sheet.js's paint() right after ABCjs draws, for the live sheet
  and a booklet alike (a booklet's plan simply has no layers on). One module
  per layer in overlays/ (progression-bands, key-centers, chord-skeleton, outside-chords, roman-numerals, degrees, solfege, fingerings), a
  shared svg.js, and viewbox.js for the chord-letter clipping; the
  arithmetic is in lib/music/layer-geometry.js.
*/

import { drawProgressions } from "./overlays/progression-bands.js";
import { styleDegrees } from "./overlays/degrees.js";
import { styleSolfege } from "./overlays/solfege.js";
import { styleFingerings } from "./overlays/fingerings.js";
import { markOutsideChords } from "./overlays/outside-chords.js";
import { drawChordSkeleton } from "./overlays/chord-skeleton.js";
import { drawKeyCenters } from "./overlays/key-centers.js";
import { drawRomanNumerals } from "./overlays/roman-numerals.js";
import { uncropChords } from "./overlays/viewbox.js";

// Each layer's overlay, in drawing order: the Harmony group's layers first,
// all drawn from the engraved tune — numerals before outside chords, so an
// outside chord's shade takes in its numeral too — then the annotations.
const LAYER_OVERLAYS = [
  ["key-centers", ({ visualObj }) => drawKeyCenters(visualObj)],
  ["chord-skeleton", ({ visualObj, on }) => drawChordSkeleton(visualObj, { markOutside: on("outside-chords") })],
  ["roman-numerals", ({ visualObj }) => drawRomanNumerals(visualObj)],
  ["outside-chords", ({ visualObj }) => markOutsideChords(visualObj)],
  ["progressions", ({ visualObj, plan }) => drawProgressions(visualObj, plan.progressions)],
  ["fingerings", ({ notationEl, plan }) => styleFingerings(notationEl, plan.instrument)],
  ["scale-degrees", ({ notationEl }) => styleDegrees(notationEl)],
  ["solfege", ({ notationEl }) => styleSolfege(notationEl)],
];

/*
  The switched-on layers' overlays as separate steps, in drawing order, so a
  background render (sheet.js) can run each as its own task and the page
  answers taps between them; decorateLayers runs them back to back. Each
  layer measures before it writes, so splitting them adds no layout passes.
*/
export function layerSteps(notationEl, visualObj, plan) {
  if (!notationEl || !visualObj) return [];
  const applied = plan.layersApplied || [];
  const hasProgressions = (plan.progressions || []).length > 0;
  const on = (id) => (id === "progressions" ? hasProgressions : applied.includes(id));
  const args = { notationEl, visualObj, plan, on };
  const steps = LAYER_OVERLAYS
    .filter(([id]) => on(id))
    .map(([, draw]) => () => draw(args));
  if (applied.length > 0 || hasProgressions) steps.unshift(() => uncropChords(notationEl));
  return steps;
}

export function decorateLayers(notationEl, visualObj, plan) {
  layerSteps(notationEl, visualObj, plan).forEach((step) => step());
}
