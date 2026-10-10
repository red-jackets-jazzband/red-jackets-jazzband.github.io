/*
  Reading a tune's first voice as the notes the sheet prints — shared by the
  Fingerings and Scale degrees layers:

    noteMidi(pitch, clef, keyAccidentals, barAccidentals)
                       the printed MIDI note of one abcjs pitch
    topNote(el, state) the top printed note of a note element, or null
    walkMelody(song, visit)
                       visit(el, state) for every element of the first voice,
                       with the key, clef and bar accidentals in force there
*/

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
  by a mid-tune key signature), the clef (likewise) and the accidentals earlier in the bar —
  carried across printed lines, since a bar can run over a line break.
*/
export function walkMelody(song, visit) {
  let barAccidentals = new Map();
  song.lines.forEach((line) => {
    const staff = line.staff && line.staff[0]; // NOSONAR
    if (!staff || !staff.voices) return; // NOSONAR
    const state = {
      key: staff.key,
      clef: staff.clef ? staff.clef.type : "treble",
      keyAccidentals: keyAccidentalMap(staff.key),
      barAccidentals,
    };
    (staff.voices[0] || []).forEach((el) => {
      if (el.el_type === "bar") state.barAccidentals = new Map();
      if (el.el_type === "key") {
        state.key = el;
        state.keyAccidentals = keyAccidentalMap(el);
      }
      if (el.el_type === "clef") state.clef = el.type;
      visit(el, state);
    });
    barAccidentals = state.barAccidentals;
  });
}
