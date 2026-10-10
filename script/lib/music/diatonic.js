/*
  The "Outside chords" layer's music: which chords (and which of their
  notes) fall outside the key the tune is in.

    keyScale(key, keyAccidentals)   the pitch classes of the key's own scale
                                    (its signature, so a modal key counts as
                                    the mode it is; a minor key also takes
                                    its raised seventh, the leading tone), or
                                    null for a tune with no key
    chordPitchClasses(name)         the pitch classes a chord symbol writes
                                    (its triad, a seventh or sixth only when
                                    the symbol has one, and a slash bass)
    outsideChords(song)             [{ el, name, outside: [pitch class] }],
                                    one per chord symbol of the first voice
                                    that has a note outside the key in force
                                    there, in tune order

  A chord is judged by what it writes, not by what a player might add: C7 in
  C major has a B♭ and is outside, G7 is not. N.C. and anything that isn't a
  chord symbol is never marked.
*/
import { chordName, keyRoot, parseChordSymbol, splitChordSymbol } from "./chord-symbol.js";
import { walkMelody } from "./melody-walk.js";
import { chordIntervals } from "./scale-degrees.js";

const LETTER_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MINOR_MODES = new Set(["m", "min", "minor", "aeo", "aeolian"]);

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

export function keyScale(key, keyAccidentals) {
  const tonic = keyRoot(key);
  if (tonic === null) return null;
  const scale = new Set(Object.keys(LETTER_SEMITONES).map((letter) => mod12(LETTER_SEMITONES[letter] + (keyAccidentals.get(letter) || 0))));
  if (MINOR_MODES.has(String(key.mode || "").toLowerCase())) scale.add(mod12(tonic - 1));
  return scale;
}

export function chordPitchClasses(name) {
  const split = splitChordSymbol(name);
  if (split === null || parseChordSymbol(name) === null) return null;
  const classes = new Set(chordIntervals(name, false).map((i) => mod12(split.root + i.semitones)));
  const slash = name.indexOf("/");
  const bass = slash === -1 ? null : parseChordSymbol(name.slice(slash + 1));
  if (bass !== null) classes.add(bass.root);
  return classes;
}

export function outsideChords(song) {
  const out = [];
  walkMelody(song, (el, state) => {
    const name = chordName(el);
    const tones = name === null ? null : chordPitchClasses(name);
    const scale = tones === null ? null : keyScale(state.key, state.keyAccidentals);
    if (scale === null) return;
    const outside = [...tones].filter((pitchClass) => !scale.has(pitchClass));
    if (outside.length > 0) out.push({ el, name, outside });
  });
  return out;
}
