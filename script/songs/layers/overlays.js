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
    marker and sit centred under the note, a chord tone inside a magenta
    circle (as in Improvise for Real) and any other note bare;
  - fingering numbers get their own class, so split.css sets them upright
    and bold instead of the italic annotation face, and are centred under
    their notehead (ABCjs starts an annotation at the note's left edge).

  Called by sheet.js's paint() right after ABCjs draws, for the live sheet
  and a booklet alike (a booklet's plan simply has no layers on). One module
  per layer in overlays/ (progression-bands, chord-skeleton, degrees, fingerings), a
  shared svg.js, and viewbox.js for the chord-letter clipping; the
  arithmetic is in lib/music/layer-geometry.js.
*/

import { drawProgressions } from "./overlays/progression-bands.js";
import { styleDegrees } from "./overlays/degrees.js";
import { styleFingerings } from "./overlays/fingerings.js";
import { drawChordSkeleton } from "./overlays/chord-skeleton.js";
import { uncropChords } from "./overlays/viewbox.js";

export function decorateLayers(notationEl, visualObj, plan) {
  if (!notationEl || !visualObj) return;
  const applied = plan.layersApplied || [];
  const progressions = plan.progressions || [];
  if (applied.length > 0 || progressions.length > 0) uncropChords(notationEl);
  if (applied.includes("chord-skeleton")) drawChordSkeleton(visualObj);
  if (progressions.length > 0) drawProgressions(visualObj, progressions);
  if (applied.includes("fingerings")) styleFingerings(notationEl, plan.instrument);
  if (applied.includes("scale-degrees")) styleDegrees(notationEl);
}
