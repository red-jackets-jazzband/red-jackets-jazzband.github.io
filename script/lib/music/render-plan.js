/*
  The sheet's render pipeline, minus the drawing: from a tune's ABC text and
  the listener's settings to everything songs/sheet/sheet.js then engraves
  and publishes. Pure — ABCjs's parser is passed in (`parse(text,
  visualTranspose)`, i.e. ABCJS.parseOnly), nothing here reads the DOM or the
  store — so the live sheet and a print booklet are just two callers with
  different inputs, and every step is unit-testable in Node.

    effectiveSheetSettings  what the settings mean for this render (a booklet
                            or a chordless tune never gets comping, ...)
    buildRenderPlan         transpose + clef, chords, comping staff, tables
    mixerAudioOptions       the Mixer state as injectMixerAudio's options
    mixRenderText           stamp the Mixer's levels/programs into the text

  The Solo line stays in sheet.js: composing one is a background job with a
  cache, i.e. a side effect, so the plan only reports the concert-pitch
  material it needs (`concert`).
*/
import { offsetForInstrument, changeClefForInstrument } from "./instruments.js";
import { parseChordScheme, computeChordOffset } from "./chords.js";
import { convertChordsToRoman } from "./music-theory.js";
import { buildCompingTune } from "./comping.js";
import { extractWordsTables, extractPartOrderRows } from "./words-table.js";
import { injectMixerAudio, resolveGchordPattern } from "../audio/audio-mix.js";
import { annotateLayers } from "./layers.js";
import { defaultVoiceProgram } from "../audio/gm-voices.js";

const ROMAN_INSTRUMENT = "concert_+_roman";

/*
  The settings slice (songs/sheet/state.js) as they apply to one render.
  Comping and Solo live in the More-controls drawer: they only take effect
  while it's open, on the live sheet (a booklet always prints the plain
  chart), and Solo only once its picker exists (`soloEnabled`). Both also
  need chords — buildRenderPlan checks that itself. The Key stepper is a
  live-sheet control too: a booklet's transposition comes only from its
  setlist row's own override. The Layers panel's switches (`layers`, the
  layers slice's activeLayers) are live-sheet only as well: a booklet prints
  the plain chart.
*/
export function effectiveSheetSettings(settings, { booklet = false, layers = {} } = {}) {
  const drawer = !booklet && settings.advancedOpen;
  return {
    layers: booklet ? {} : layers,
    instrument: settings.instrument,
    transpose: booklet ? 0 : settings.transpose,
    comping: drawer ? settings.comping : "off",
    compingParts: settings.compingSplit ? settings.compingParts : null,
    solo: drawer && settings.soloEnabled ? settings.solo : "off",
  };
}

// Voices that carry their own clef/transpose/name are left untouched — the
// instrument's clef and offset must not be applied on top.
export function hasInstrumentVoices(text) {
  return text.split("\n").some((line) => {
    if (!/^V:\d+/.test(line)) return false;
    return line.includes("clef=") || line.includes("transpose=") || line.includes("name=");
  });
}

/*
  The transposition: `audio` (the Key stepper plus any setlist override) is
  what the synth gets as midiTranspose, so every instrument's part still
  sounds at the same concert pitch; `visual` folds the instrument's own
  offset on top for the engraving. A bass-clef instrument also gets its clef
  stamped onto the K: line. A chart whose voices declare their own
  clef/transpose/name is left as written.
*/
export function resolveTranspose(text, instrument, steps) {
  if (hasInstrumentVoices(text)) return { abcText: text, visual: steps, audio: steps };
  return {
    abcText: changeClefForInstrument(instrument, text),
    visual: steps + offsetForInstrument(instrument),
    audio: steps,
  };
}

/*
  The tune in concert pitch with its chord scheme as printed bar by bar —
  including a second ending's own bars, unlike the chord table's scheme, or a
  generated voice runs out of bars (and falls silent) the moment the melody
  reaches such an ending. What the comping and solo generators work from.
*/
export function concertMaterial(abcText, parse) {
  const song = parse(abcText, 0);
  return { song, chords: parseChordScheme(song, { includeAlternateEndings: true }) };
}

/*
  Everything a render of `text` draws, given effectiveSheetSettings():

    abcText         the clef-adjusted tune (what rerender() re-engraves)
    visualTranspose / audioTranspose   see resolveTranspose
    song            the parsed tune at its visual transposition
    chords          its chord scheme; displayChords is what the chord
                    table shows (Roman numerals for "Concert + Roman")
    chordOffset     leading chordless bars, aligning chord cells to bars
    comping         { active, renderText, palette, parts } — renderText is
                    the tune plus the generated comping staff when active
    concert         concertMaterial(), when comping or a solo needs it
    progressions    the named progressions the Layers panel's band marks
                    (lib/music/progressions.js), [] when that layer is off
    layersApplied   ids of the layers drawn on this render (a switched-on
                    layer that doesn't apply, e.g. fingerings for a sax,
                    isn't)
    instrument      the instrument the render is for (the overlays draw a
                    trombone's positions differently from valves)
    wordsTables     the form strip's rows: the W: pipe tables, else the P:
                    part order as one table
*/
export function buildRenderPlan(text, settings, { parse, extraTransposeSteps = 0 }) {
  const { abcText, visual, audio } = resolveTranspose(
    text, settings.instrument, settings.transpose + extraTransposeSteps,
  );
  const song = parse(abcText, visual);
  const chords = parseChordScheme(song);
  const displayChords = settings.instrument === ROMAN_INSTRUMENT ? convertChordsToRoman(chords) : chords;
  const hasChords = chords.length > 0;
  const needsConcert = hasChords && (settings.comping !== "off" || settings.solo !== "off");
  const concert = needsConcert ? concertMaterial(abcText, parse) : null;

  // The active layers' annotations go into the text that gets engraved —
  // never into abcText itself, which rerender() re-reads and the comping /
  // solo generators parse.
  const layered = annotateLayers(abcText, song, {
    active: settings.layers, instrument: settings.instrument, ownVoices: hasInstrumentVoices(text),
  });

  let comping = {
    active: false, renderText: layered.text, palette: null, parts: null,
  };
  if (hasChords && settings.comping !== "off") {
    const built = buildCompingTune(layered.text, concert.chords, concert.song, settings.comping, settings.compingParts);
    if (built) {
      comping = {
        active: true, renderText: built.abc, palette: built.palette, parts: built.parts || null,
      };
    }
  }

  const { tables } = extractWordsTables(abcText);
  const orderRows = extractPartOrderRows(abcText);
  const wordsTables = tables.length === 0 && orderRows ? [{ header: null, rows: orderRows }] : tables;

  return {
    abcText,
    visualTranspose: visual,
    audioTranspose: audio,
    song,
    chords,
    displayChords,
    hasChords,
    chordOffset: computeChordOffset(song),
    comping,
    concert,
    wordsTables,
    progressions: layered.progressions,
    layersApplied: layered.applied,
    instrument: settings.instrument,
  };
}

// A muted Bass/Chords channel is just its fader forced to 0. (Every other
// voice's mute goes through computeVoicesOff in the audio player instead —
// see lib/audio/audio-mix.js's own doc comment for why.)
function channelPercent(mixer, channel) {
  return mixer[`${channel}Muted`] ? 0 : mixer[`${channel}Volume`];
}

// null (the Voice picker left un-overridden) has to become undefined, not
// pass through as null — injectMixerAudio's own default parameters only
// kick in for undefined, so a stored null would otherwise reach ABCjs as a
// literal "%%MIDI program null".
function channelProgram(mixer, channel) {
  const value = mixer[`${channel}Program`];
  return value === null ? undefined : value;
}

/*
  The mixer slice (songs/audio/state.js) as injectMixerAudio's options. A
  voice's null program (its Voice picker left un-overridden) resolves to a
  guess from the voice's own name (lib/audio/gm-voices.js) rather than one
  flat default, since a chart can mix several real instruments on one page.
*/
export function mixerAudioOptions({ mixer, gchordPattern, mixerVoices }, hasChords) {
  const voicePrograms = new Map();
  const voiceVolumes = new Map();
  mixerVoices.forEach((v) => {
    voicePrograms.set(v.id, v.program === null ? defaultVoiceProgram(v) : v.program);
    voiceVolumes.set(v.id, v.volume);
  });
  return {
    hasChords,
    bassPercent: channelPercent(mixer, "bass"),
    bassProgram: channelProgram(mixer, "bass"),
    chordsPercent: channelPercent(mixer, "chords"),
    chordsProgram: channelProgram(mixer, "chords"),
    gchordPattern: resolveGchordPattern(gchordPattern),
    voicePrograms,
    voiceVolumes,
  };
}

// Stamp the Mixer's Bass/Chords levels and every voice's Voice + Volume into
// the ABC text before it's parsed, so the one tune object that gets
// engraved is exactly what plays (lib/audio/audio-mix.js).
export function mixRenderText(renderText, mixerState, hasChords) {
  return injectMixerAudio(renderText, mixerAudioOptions(mixerState, hasChords));
}
