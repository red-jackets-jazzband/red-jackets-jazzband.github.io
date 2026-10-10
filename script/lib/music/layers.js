/*
  The sheet's optional "layers": extra information a player can switch on
  over the lead sheet without it being part of the chart itself. Each layer
  is one entry in LAYERS — the panel (songs/layers/panel.js) lists them, the
  render plan asks each active one what to add to the tune — so a new layer
  is one more entry here (plus its overlay under songs/layers/overlays/ if
  it draws anything ABC annotations can't), not a new control.

    id            stable key (persisted: rj.layer.<id>)
    group         the panel heading it sits under
    label / hint  the panel row's text
    credit        optional { prefix, text, href }: a link shown after the hint
    order         where its annotations are written among the below-the-
                  staff ones: lower sits closer to the notes
    availableFor(instrument)
                  false greys the row out (fingerings are brass-only)
    appliesTo(chart)
                  false drops the layer for this chart without greying the
                  row ({ ownVoices } — fingerings need the instrument picker's
                  transposition, which a chart with its own voices skips)
    annotate(song, context)
                  [{ startChar, text }] — ABC annotations ("^…" above the
                  staff, "_…" below) to insert before the note at that
                  source offset of the parsed tune

  annotateLayers() does the inserting. Annotations are plain ABC, so ABCjs
  lays them out (making room above/below the staff) exactly as it would a
  hand-written one, and a printed sheet carries them too.
*/
import { fingeringGlyphs, instrumentHasFingerings, melodyFingerings } from "./fingerings.js";
import { PROGRESSION_NAMES, findNamedProgressions, progressionLabel } from "./progressions.js";
import { degreeText, melodyDegrees } from "./scale-degrees.js";
import { listOf, tl } from "../core/i18n.js";

function nameList(names) {
  return listOf(names, "and");
}

export const LAYERS = [
  {
    id: "progressions",
    group: tl("layers_group_harmony", "Harmony"),
    label: tl("layer_progressions_label", "Named progressions"),
    hint: tl("layer_progressions_hint", "Labels the stock trad-jazz chord patterns ({names}) and highlights the chords that make them up in one bar.", { names: nameList(PROGRESSION_NAMES) }),
    credit: { prefix: tl("layer_progressions_credit", "Names from Pops Coffee's blog "), text: "Playing Traditional Jazz", href: "https://playing-traditional-jazz.blogspot.com/" },
    order: 3,
    availableFor: () => true,
    appliesTo: () => true,
    annotate(song, context) {
      // One label, where the progression starts; a line it runs onto is
      // marked by the open bar alone (overlays/progression-bands.js).
      return context.progressions
        .filter((match) => match.lineStarts.length > 0)
        .map((match) => ({ startChar: match.lineStarts[0], text: `_${progressionLabel(match.name)}` }));
    },
  },
  {
    id: "chord-skeleton",
    group: tl("layers_group_harmony", "Harmony"),
    label: tl("layer_chord_skeleton_label", "Chord skeleton"),
    hint: tl("layer_chord_skeleton_hint", "Each chord's notes as faint ghost notes on the staff, in the inversion that sits under most of the bar's melody. Only a visual reminder: they are not played."),
    order: 4, // unused: it writes no annotation
    availableFor: () => true,
    appliesTo: () => true,
    // Drawn as SVG after ABCjs engraves (songs/layers/chord-skeleton.js), so
    // nothing is written into the tune text.
    annotate: () => [],
  },
  {
    id: "outside-chords",
    group: tl("layers_group_harmony", "Harmony"),
    label: tl("layer_outside_chords_label", "Outside chords"),
    hint: tl("layer_outside_chords_hint", "Shades in magenta each chord that has a note outside the key. With Chord skeleton on, the ghost notes that aren't in the key are tinted too."),
    order: 5, // unused: it writes no annotation
    availableFor: () => true,
    appliesTo: () => true,
    // Drawn as SVG after ABCjs engraves (songs/layers/overlays/outside-chords.js).
    annotate: () => [],
  },
  {
    id: "scale-degrees",
    group: tl("layers_group_melody", "Melody"),
    label: tl("layer_scale_degrees_label", "Scale degrees"),
    hint: tl("layer_scale_degrees_hint", "Each note's number in the key (1-7), with the notes of the chord under it circled."),
    credit: { prefix: tl("layer_scale_degrees_credit", "Method from David Reed's "), text: "Improvise for Real", href: "https://www.improviseforreal.com/" },
    order: 2,
    availableFor: () => true,
    appliesTo: () => true,
    annotate: (song) => melodyDegrees(song).map((d) => ({ startChar: d.startChar, text: `_${degreeText(d.degree, d.tone)}` })),
  },
  {
    id: "fingerings",
    group: tl("layers_group_performance", "Performance"),
    label: tl("layer_fingerings_label", "Fingerings"),
    hint: tl("layer_fingerings_hint", "Valves for trumpet and sousaphone, slide positions for trombone"),
    order: 1,
    availableFor: instrumentHasFingerings,
    appliesTo: (chart) => !chart.ownVoices,
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
  sheet needs to draw afterwards: `progressions` (the matches the bands are
  drawn from) and `applied`, the ids of the layers that actually took.
  `song` must be the parse of `text` itself, so its offsets line up.
  `ownVoices`: the chart's voices carry their own instruments, so the
  instrument picker doesn't transpose it (see each layer's `appliesTo`).
*/
export function annotateLayers(text, song, { active, instrument, ownVoices = false }) {
  const chart = { ownVoices };
  const layers = activeLayers(active, instrument).filter((layer) => layer.appliesTo(chart));
  const applied = layers.map((layer) => layer.id);
  const progressions = applied.includes("progressions") ? findNamedProgressions(song) : [];
  if (layers.length === 0) return { text, progressions, applied };
  const context = { instrument, progressions };
  // Below-the-staff annotations stack in the order they're written, so the
  // layers' own `order` decides which sits nearest the notes.
  const annotations = layers
    .slice()
    .sort((a, b) => a.order - b.order)
    .flatMap((layer) => layer.annotate(song, context));
  return { text: insertAnnotations(text, annotations), progressions, applied };
}
