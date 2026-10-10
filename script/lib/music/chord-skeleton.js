/*
  The "Chord skeleton" layer's music: for every chord symbol on the tune's
  first voice, the chord's own notes as they would sit on the staff — shown
  as faint ghost noteheads (songs/layers/chord-skeleton.js draws them), never
  engraved into the ABC and never played.

    chordSkeletons(song)   [{ el, name, notes: [{ vp, accidental }] }], one
                           per chord symbol that has a bar-mate to cover,
                           in tune order; `el` is the element the symbol is
                           written on, `vp` the abcjs verticalPos to draw at,
                           `accidental` "♯"/"♭"/"♮"/… when the note isn't
                           already in the key (or earlier in the bar), else
                           null

  A chord's span is from its symbol to the next symbol or the bar line,
  whichever comes first. Its notes are stacked in close position — root,
  third, fifth (and the seventh or sixth when the symbol writes one) — in
  whichever inversion and octave sits under the most melody notes of the
  span (each melody note that lands exactly on a skeleton note counts).
  Ties go to the stack nearest the span's own melody, then to the
  lowest inversion. Letters are spelled from the chord's root, so a B♭ chord
  has a D and an F, never an E♯.
*/
import { chordName, parseChordSymbol, splitChordSymbol } from "./chord-symbol.js";
import { noteMidi, walkMelody } from "./melody-walk.js";
import { chordIntervals } from "./scale-degrees.js";

const LETTERS = "CDEFGAB";
const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
// Mirrors fingerings.js's CLEF_STEPS: the clef's shift from a treble staff's
// verticalPos to the letter-and-octave count.
const CLEF_STEPS = { treble: 0, bass: 12 };
const ACCIDENTAL_GLYPH = { "-2": "♭♭", "-1": "♭", 0: "♮", 1: "♯", 2: "x" };
const LOWEST_OCTAVE = -3;
const HIGHEST_OCTAVE = 2;

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

// Root letter index (0-6) of a chord symbol, or -1.
function rootLetter(name) {
  return LETTERS.indexOf(name[0]);
}

/*
  The chord's notes as { letter, alter, semitones }, root first: the letter
  is the root's moved up by the interval's step, the alteration whatever
  makes it the right pitch class.
*/
export function spellChord(name) {
  const split = splitChordSymbol(name);
  const base = rootLetter(name);
  if (split === null || base === -1) return [];
  return chordIntervals(name, false).map(({ semitones, step }) => {
    const letter = (base + step) % 7;
    const pitchClass = (split.root + semitones) % 12;
    const alter = mod12(pitchClass - LETTER_SEMITONES[letter] + 6) - 6;
    return { letter, alter, semitones };
  });
}

// One voicing: `tones` rotated to start at `inversion`, stacked upward from
// `octave` (the first note's octave, C4 = 0). Returns [{ letter, alter,
// octave, midi }].
function stack(tones, inversion, octave) {
  const placed = [];
  const order = tones.slice(inversion).concat(tones.slice(0, inversion));
  let below = null; // the note stacked just before
  order.forEach((tone) => {
    const base = LETTER_SEMITONES[tone.letter] + tone.alter;
    const floor = below === null ? -Infinity : below.midi;
    let oct = below === null ? octave : below.octave;
    while (60 + 12 * oct + base <= floor) oct += 1;
    below = { letter: tone.letter, alter: tone.alter, octave: oct, midi: 60 + 12 * oct + base };
    placed.push(below);
  });
  return placed;
}

function voicingCandidates(tones) {
  const out = [];
  for (let inversion = 0; inversion < tones.length; inversion += 1) {
    for (let octave = LOWEST_OCTAVE; octave <= HIGHEST_OCTAVE; octave += 1) {
      out.push({ inversion, placed: stack(tones, inversion, octave) });
    }
  }
  return out;
}

function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// How many melody notes the voicing sits under, and how far its middle is from the melody's (smaller is better).
function judge(candidate, melody, centre) {
  const midis = new Set(candidate.placed.map((p) => p.midi));
  const covered = melody.filter((m) => midis.has(m)).length;
  const middle = average(candidate.placed.map((p) => p.midi));
  return { covered, distance: Math.abs(middle - centre) };
}

function beats(x, y) {
  if (x.covered !== y.covered) return x.covered > y.covered;
  if (x.distance !== y.distance) return x.distance < y.distance;
  return x.candidate.inversion < y.candidate.inversion;
}

/*
  The best voicing of `tones` (see spellChord) under `melody` (midi of every
  note the chord sounds with), `centre` being where to sit when the span has
  no melody of its own. Returns [{ letter, alter, octave, midi }].
*/
export function bestVoicing(tones, melody, centre) {
  const target = melody.length > 0 ? average(melody) : centre;
  let best = null;
  for (const candidate of voicingCandidates(tones)) {
    const scored = { candidate, ...judge(candidate, melody, target) };
    if (best === null || beats(scored, best)) best = scored;
  }
  return best === null ? [] : best.candidate.placed;
}

// The glyph a skeleton note needs before it, or null when the key signature
// (or an accidental earlier in the bar on that line or space) already
// gives it.
function accidentalFor(note, state) {
  const steps = 7 * note.octave + note.letter;
  const standing = state.barAccidentals.has(steps)
    ? state.barAccidentals.get(steps)
    : state.keyAccidentals.get(LETTERS[note.letter]) || 0;
  return standing === note.alter ? null : ACCIDENTAL_GLYPH[note.alter];
}

// Where one placed note is drawn: abcjs's verticalPos for its letter and octave.
function toDrawn(note, state) {
  const shift = CLEF_STEPS[state.clef];
  return {
    vp: 7 * note.octave + note.letter + shift,
    accidental: accidentalFor(note, state),
  };
}

function chordSymbolOf(el) {
  const name = chordName(el);
  return name !== null && parseChordSymbol(name) !== null ? name : null;
}

// Every note of a note element, as printed midi (rests give none).
function midisOf(el, state) {
  if (el.el_type !== "note" || el.rest || !el.pitches) return [];
  return el.pitches
    .filter((pitch) => !pitch.endTie)
    .map((pitch) => noteMidi(pitch, state.clef, state.keyAccidentals, state.barAccidentals))
    .filter((midi) => midi !== null);
}

// First pass: each chord symbol with the melody that sounds under it.
function collectSpans(song) {
  const spans = [];
  let open = null;
  const close = () => {
    if (open !== null) spans.push(open);
    open = null;
  };
  walkMelody(song, (el, state) => {
    if (el.el_type === "bar") close();
    const name = chordSymbolOf(el);
    if (name !== null) {
      close();
      open = {
        el,
        name,
        melody: [],
        state: {
          clef: state.clef,
          keyAccidentals: state.keyAccidentals,
          barAccidentals: new Map(state.barAccidentals),
        },
      };
    }
    if (open !== null) open.melody.push(...midisOf(el, state));
  });
  close();
  return spans;
}

export function chordSkeletons(song) {
  const spans = collectSpans(song);
  const everything = spans.flatMap((span) => span.melody);
  const centre = everything.length > 0 ? average(everything) : 67;
  const out = [];
  spans.forEach((span) => {
    if (CLEF_STEPS[span.state.clef] === undefined) return;
    const tones = spellChord(span.name);
    if (tones.length === 0) return;
    const placed = bestVoicing(tones, span.melody, centre);
    out.push({ el: span.el, name: span.name, notes: placed.map((note) => toDrawn(note, span.state)) });
  });
  return out;
}
