/*
  Brass fingerings for the "Fingerings" layer: valve combinations for
  trumpet and sousaphone, slide positions for trombone, read off the notes
  exactly as the sheet prints them for that instrument (its transposition
  and clef already applied).

    instrumentHasFingerings(instrument)   is there a chart for it at all
    fingeringFor(instrument, midi)        "12" / "0" / "4", or null when out
                                          of range (midi = the printed note)
    noteMidi(pitch, clef, keyAccidentals, barAccidentals)
                                          the printed note of one abcjs pitch
    melodyFingerings(song, instrument)    [{ startChar, text }] for every note
                                          onset of the tune's first voice
    fingeringGlyphs(instrument, text)     the valve diagram to print (three
                                          lines); trombone stays a digit

  The charts are the standard first-choice fingerings a teacher writes in:
  the alternatives (1-3 for a low D, 4th position for a high D...) are left
  to the player.
*/

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

export function fingeringGlyphs(instrument, text) {
  if (instrument === "trombone") return text;
  if (text === "0") return [VALVE_UP, VALVE_OPEN, VALVE_UP].join(ABC_NEWLINE);
  return [1, 2, 3].map((valve) => (text.includes(String(valve)) ? String(valve) : VALVE_UP)).join(ABC_NEWLINE);
}

const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const LETTERS = "CDEFGAB";
const ALTER = { sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2 };
// How far below its staff position each clef's notes sound: abcjs puts the
// treble staff's bottom line (E4) at verticalPos 2, and bass-clef notes are
// drawn twelve steps (an octave and a fifth) higher than the treble note of
// the same name.
const CLEF_STEPS = { treble: 0, bass: 12 };

/*
  The printed MIDI note of one abcjs pitch, using where it's drawn
  (verticalPos), not its letter name — this sheet stamps `clef=bass
  middle=D` onto treble-written tunes for the low brass, which moves the
  notes an octave down without renaming them. Accidentals: the note's own,
  else one earlier in the bar on the same line or space, else the key
  signature. Returns null for a clef with no chart here.
*/
export function noteMidi(pitch, clef, keyAccidentals, barAccidentals) {
  const shift = CLEF_STEPS[clef];
  if (shift === undefined) return null;
  const steps = pitch.verticalPos - shift;
  const octave = Math.floor(steps / 7);
  const degree = steps - octave * 7;
  let alter;
  if (pitch.accidental !== undefined && ALTER[pitch.accidental] !== undefined) {
    alter = ALTER[pitch.accidental];
    barAccidentals.set(steps, alter);
  } else if (barAccidentals.has(steps)) {
    alter = barAccidentals.get(steps);
  } else {
    alter = keyAccidentals.get(LETTERS[degree]) || 0;
  }
  return 60 + 12 * octave + LETTER_SEMITONES[degree] + alter;
}

// The key signature as letter → alteration ("B" → -1 in F major).
function keyAccidentalMap(key) {
  const map = new Map();
  ((key && key.accidentals) || []).forEach((acc) => { // NOSONAR
    if (ALTER[acc.acc] !== undefined) map.set(acc.note.toUpperCase(), ALTER[acc.acc]);
  });
  return map;
}

/*
  The top printed note of a note element — a chord takes its top note (the
  melody) — as { midi, pitch }, or null for a rest, a non-note or a note
  outside the clefs we know. `state` is walkMelody's. Always reads every
  pitch of the element, so the bar's accidentals stay current.
*/
export function topNote(el, state) {
  if (el.el_type !== "note" || el.rest || !el.pitches || el.pitches.length === 0) return null;
  let top = null;
  for (const pitch of el.pitches) {
    const midi = noteMidi(pitch, state.clef, state.keyAccidentals, state.barAccidentals);
    if (midi !== null && (top === null || midi > top.midi)) top = { midi, pitch };
  }
  return top;
}

/*
  Call visit(el, state) for every element of the tune's first voice, in
  order, across every printed line. `state` is { key, clef, keyAccidentals,
  barAccidentals } as it stands at that element: the staff's key (changed
  by a mid-tune key signature) and the accidentals earlier in the bar.
*/
export function walkMelody(song, visit) {
  song.lines.forEach((line) => {
    const staff = line.staff && line.staff[0]; // NOSONAR
    if (!staff || !staff.voices) return; // NOSONAR
    const state = {
      key: staff.key,
      clef: staff.clef ? staff.clef.type : "treble",
      keyAccidentals: keyAccidentalMap(staff.key),
      barAccidentals: new Map(),
    };
    (staff.voices[0] || []).forEach((el) => {
      if (el.el_type === "bar") state.barAccidentals = new Map();
      if (el.el_type === "keySignature") {
        state.key = el;
        state.keyAccidentals = keyAccidentalMap(el);
      }
      visit(el, state);
    });
  });
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
