/*
  Brass fingerings for the "Fingerings" layer: valve combinations for
  trumpet and sousaphone, slide positions for trombone, read off the notes
  exactly as the sheet prints them for that instrument (its transposition
  and clef already applied).

    instrumentHasFingerings(instrument)   is there a chart for it at all
    fingeringFor(instrument, midi)        "12" / "0" / "4", or null when out
                                          of range (midi = the printed note)
    melodyFingerings(song, instrument)    [{ startChar, text }] for every note
                                          onset of the tune's first voice
    fingeringGlyphs(instrument, text)     the valve diagram to print (three
                                          lines); trombone stays a digit
    usesValveDiagram(instrument)          false for the trombone

  The charts are the standard first-choice fingerings a teacher writes in:
  the alternatives (1-3 for a low D, 4th position for a high D...) are left
  to the player.
*/
import { topNote, walkMelody } from "./melody-walk.js";

// Trumpet, by written pitch: F#3 (54) up to G6 (91). "0" is open.
const TRUMPET_VALVES = [
  "123", "13", "23", "12", "1", "2", // F#3 .. B3
  "0", "123", "13", "23", "12", "1", "2", // C4 .. F#4
  "0", "23", "12", "1", "2", // G4 .. B4
  "0", "12", "1", "2", "0", "1", "2", // C5 .. F#5
  "0", "23", "12", "1", "2", // G5 .. B5
  "0", "12", "1", "2", "0", "1", "2", "0", // C6 .. G6
];
const TRUMPET_LOWEST = 54;

// Trombone slide positions, by concert pitch: E2 (40) up to Bb4 (70).
const TROMBONE_POSITIONS = [
  "7", "6", "5", "4", "3", "2", "1", // E2 .. Bb2
  "7", "6", "5", "4", "3", "2", "1", // B2 .. F3
  "5", "4", "3", "2", "1", // F#3 .. Bb3
  "4", "3", "2", "1", // B3 .. D4
  "3", "2", "1", // Eb4 .. F4
  "3", "2", "3", "2", "1", // F#4 .. Bb4
];
const TROMBONE_LOWEST = 40;

function lookup(chart, lowest, midi) {
  const index = midi - lowest;
  return index >= 0 && index < chart.length ? chart[index] : null;
}

/*
  How each instrument maps its printed note onto a chart. A sousaphone
  (BB♭) reads a B♭ bass-clef part: it sounds a ninth below what's printed,
  and its valves follow the trumpet's pattern two octaves down — so its
  fingering is the trumpet's for the printed note an octave up.
*/
const FINGERING_CHARTS = {
  trumpet: (midi) => lookup(TRUMPET_VALVES, TRUMPET_LOWEST, midi),
  sousaphone: (midi) => lookup(TRUMPET_VALVES, TRUMPET_LOWEST, midi + 12),
  trombone: (midi) => lookup(TROMBONE_POSITIONS, TROMBONE_LOWEST, midi),
};

export const FINGERING_INSTRUMENTS = Object.keys(FINGERING_CHARTS);

export function instrumentHasFingerings(instrument) {
  return FINGERING_INSTRUMENTS.includes(instrument);
}

export function fingeringFor(instrument, midi) {
  return instrumentHasFingerings(instrument) ? FINGERING_CHARTS[instrument](midi) : null;
}

// A valve combination as the three lines of a little valve diagram, top
// valve first: the pressed valves' numbers (set as filled discs by
// songs/layers/overlays.js), a "·" for each valve left up, and ⓪ in the
// middle when nothing is pressed. Printed one column wide so neighbouring
// notes never run into each other. Trombone positions stay a plain digit.
// ABC's own line break inside an annotation: a backslash and an n.
const ABC_NEWLINE = String.raw`\n`;
export const VALVE_UP = "\u00B7";
export const VALVE_OPEN = "0";

// Valve instruments print a three-line valve diagram; the trombone a digit.
export function usesValveDiagram(instrument) {
  return instrument !== "trombone";
}

export function fingeringGlyphs(instrument, text) {
  if (!usesValveDiagram(instrument)) return text;
  if (text === "0") return [VALVE_UP, VALVE_OPEN, VALVE_UP].join(ABC_NEWLINE);
  return [1, 2, 3].map((valve) => (text.includes(String(valve)) ? String(valve) : VALVE_UP)).join(ABC_NEWLINE);
}

/*
  One fingering per note onset of the tune's first voice: a tied
  continuation keeps the fingering already printed, and a rest or a note
  outside the chart gets nothing.
*/
export function melodyFingerings(song, instrument) {
  const out = [];
  if (!instrumentHasFingerings(instrument)) return out;
  walkMelody(song, (el, state) => {
    const top = topNote(el, state);
    if (top === null || top.pitch.endTie) return;
    const text = fingeringFor(instrument, top.midi);
    if (text !== null) out.push({ startChar: el.startChar, text });
  });
  return out;
}
