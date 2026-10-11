/*
  Reading a tune's first voice as the notes the sheet prints — shared by the
  Fingerings and Scale degrees layers:

    noteMidi(pitch, clef, keyAccidentals, barAccidentals)
                       the printed MIDI note of one abcjs pitch
    clefName(clef)     an abcjs clef's CLEF_STEPS name ("tenor", "bass3", ...)
    noteLetter(pitch, clef)
                       the letter ("C".."B") a pitch is printed as, or null
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
// the same name. The C clefs sit between: alto (middle C on the middle line)
// six steps, tenor (on the fourth line) eight; the rarer lines follow.
export const CLEF_STEPS = {
  treble: 0, treble1: -2,
  alto: 6, tenor: 8, alto1: 2, alto2: 4,
  bass: 12, bass3: 10,
};

// abcjs's line for each clef family where nothing moves it: a clef on
// another line is drawn that many steps up or down.
const CLEF_HOME = { treble: 4, alto: 6, bass: 8 };
const CLEF_LINE_NAMES = { treble: { 2: "treble1" }, alto: { 2: "alto1", 4: "alto2", 8: "tenor" }, bass: { 6: "bass3" } };

/*
  The CLEF_STEPS name of an abcjs clef ({ type, clefPos }, from a staff or a
  mid-line clef change): the family without its octave mark (a treble-8
  part is printed like any treble part), and the line it sits on (abcjs
  calls a tenor clef "alto" on line 8). A clef with no pitches (perc, none)
  keeps its own name, which CLEF_STEPS doesn't know.
*/
export function clefName(clef) {
  if (!clef || typeof clef.type !== "string") return "treble";
  const family = clef.type.replace(/[+-]8$/, "");
  const home = CLEF_HOME[family];
  if (home === undefined || clef.clefPos === undefined || clef.clefPos === home) return family;
  const named = CLEF_LINE_NAMES[family][clef.clefPos];
  return named === undefined ? `${family}@${clef.clefPos}` : named;
}

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

// The letter an abcjs pitch is printed as (the line or space it sits on,
// read the same way noteMidi reads it), or null for a clef we don't know.
export function noteLetter(pitch, clef) {
  const shift = CLEF_STEPS[clef];
  if (shift === undefined) return null;
  const steps = pitch.verticalPos - shift;
  return LETTERS[steps - Math.floor(steps / 7) * 7];
}

// The key signature as letter → alteration ("B" → -1 in F major). A
// natural in a signature only cancels the previous key's accidental (abcjs
// writes ♮B ♮E ♮A into a G signature that follows E♭), so it's skipped:
// once transposed, those naturals aren't moved with the key and would
// otherwise wipe out real sharps or flats (F♯ major's A♯).
function keyAccidentalMap(key) {
  const map = new Map();
  ((key && key.accidentals) || []).forEach((acc) => { // NOSONAR
    if (ALTER[acc.acc] !== undefined && acc.acc !== "natural") map.set(acc.note.toUpperCase(), ALTER[acc.acc]);
  });
  return map;
}

/*
  The top printed note of a note element — a chord takes its top note (the
  melody) — as { midi, pitch, letter }, or null for a rest, a non-note or a note
  outside the clefs we know. `state` is walkMelody's. Always reads every
  pitch of the element, so the bar's accidentals stay current.
*/
export function topNote(el, state) {
  if (el.el_type !== "note" || el.rest || !el.pitches || el.pitches.length === 0) return null;
  let top = null;
  for (const pitch of el.pitches) {
    const midi = noteMidi(pitch, state.clef, state.keyAccidentals, state.barAccidentals);
    if (midi !== null && (top === null || midi > top.midi)) top = { midi, pitch, letter: noteLetter(pitch, state.clef) };
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
      clef: clefName(staff.clef),
      keyAccidentals: keyAccidentalMap(staff.key),
      barAccidentals,
    };
    (staff.voices[0] || []).forEach((el) => {
      if (el.el_type === "bar") state.barAccidentals = new Map();
      if (el.el_type === "key") {
        state.key = el;
        state.keyAccidentals = keyAccidentalMap(el);
      }
      if (el.el_type === "clef") state.clef = clefName(el);
      visit(el, state);
    });
    barAccidentals = state.barAccidentals;
  });
}
