/*
  The sheet's optional "layers": extra information a player can switch on
  over the lead sheet without it being part of the chart itself. Each layer
  is one entry in LAYERS — the panel (songs/layers/panel.js) lists them, the
  render plan asks each active one what to add to the tune — so a new layer
  is one more entry here, not a new control.

    id            stable key (persisted: rj.layer.<id>)
    group         the panel heading it sits under
    label / hint  the panel row's text
    credit        optional { prefix, text, href }: a link shown after the hint
    availableFor(instrument)
                  false greys the row out (fingerings are brass-only)
    annotate(song, context)
                  [{ startChar, text }] — ABC annotations ("^…" above the
                  staff, "_…" below) to insert before the note at that
                  source offset of the parsed tune

  annotateLayers() does the inserting. Annotations are plain ABC, so ABCjs
  lays them out (making room above/below the staff) exactly as it would a
  hand-written one, and a printed sheet carries them too.
*/
import { fingeringGlyphs, instrumentHasFingerings, melodyFingerings } from "./fingerings.js";
import { findNamedProgressions, progressionLabel } from "./progressions.js";
import { degreeText, melodyDegrees } from "./scale-degrees.js";

export const LAYERS = [
  {
    id: "progressions",
    group: "Harmony",
    label: "Named progressions",
    hint: "Labels the stock trad-jazz chord patterns (Salty Dog, Four-Leaf, Georgia, Sunshine, Apple Tree) and highlights the chords that make them up in one bar.",
    credit: { prefix: "Names from Pops Coffee's blog ", text: "Playing Traditional Jazz", href: "https://playing-traditional-jazz.blogspot.com/" },
    availableFor: () => true,
    annotate(song, context) {
      // One label, where the progression starts; a line it runs onto is
      // marked by the open bar alone (overlays.js).
      return context.progressions
        .filter((match) => match.lineStarts.length > 0)
        .map((match) => ({ startChar: match.lineStarts[0], text: `_${progressionLabel(match.name)}` }));
    },
  },
  {
    id: "scale-degrees",
    group: "Melody",
    label: "Scale degrees",
    hint: "Each note's number in the key (1-7), with the notes of the chord under it circled.",
    credit: { prefix: "Method from David Reed's ", text: "Improvise for Real", href: "https://www.improviseforreal.com/" },
    availableFor: () => true,
    annotate: (song) => melodyDegrees(song).map((d) => ({ startChar: d.startChar, text: `_${degreeText(d.degree, d.tone)}` })),
  },
  {
    id: "fingerings",
    group: "Performance",
    label: "Fingerings",
    hint: "Valves for trumpet and sousaphone, slide positions for trombone",
    availableFor: instrumentHasFingerings,
    annotate: (song, context) => melodyFingerings(song, context.instrument).map((f) => ({ startChar: f.startChar, text: `_${fingeringGlyphs(context.instrument, f.text)}` })),
  },
];

export const LAYER_IDS = LAYERS.map((layer) => layer.id);

export function findLayer(id) {
  return LAYERS.find((layer) => layer.id === id);
}

// The layers switched on (in `active`, { id: bool }) that apply to `instrument`.
export function activeLayers(active, instrument) {
  return LAYERS.filter((layer) => active && active[layer.id] && layer.availableFor(instrument)); // NOSONAR
}

// Insert `"text"` before each annotation's offset, back to front so earlier
// offsets stay valid. Several at one offset keep their list order.
export function insertAnnotations(text, annotations) {
  const sorted = annotations
    .map((a, order) => ({ ...a, order }))
    .sort((a, b) => b.startChar - a.startChar || b.order - a.order);
  let result = text;
  sorted.forEach((a) => {
    result = `${result.slice(0, a.startChar)}"${a.text}"${result.slice(a.startChar)}`;
  });
  return result;
}

/*
  The tune text with every active layer's annotations in, plus what the
  sheet needs to draw afterwards: the progression bands, and `applied`, the
  ids of the layers that actually took. `song` must be
  the parse of `text` itself, so its offsets line up. A chart whose voices
  carry their own instruments (`ownVoices`) isn't transposed for the
  instrument picker, so it gets no fingerings.
*/
export function annotateLayers(text, song, { active, instrument, ownVoices = false }) {
  const layers = activeLayers(active, instrument)
    .filter((layer) => !(ownVoices && layer.id === "fingerings"));
  const applied = layers.map((layer) => layer.id);
  const progressions = applied.includes("progressions") ? findNamedProgressions(song) : [];
  if (layers.length === 0) return { text, progressions, applied };
  const context = { instrument, progressions };
  const annotations = [];
  // Below-the-staff annotations stack in the order they're written: the
  // fingerings first (closest to the notes), then the scale degrees, then the
  // progression band.
  const writeOrder = ["fingerings", "scale-degrees", "progressions"];
  layers
    .slice()
    .sort((a, b) => writeOrder.indexOf(a.id) - writeOrder.indexOf(b.id))
    .forEach((layer) => annotations.push(...layer.annotate(song, context)));
  return { text: insertAnnotations(text, annotations), progressions, applied };
}
