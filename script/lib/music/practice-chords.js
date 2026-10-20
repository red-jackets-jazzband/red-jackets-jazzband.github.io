/*
  The chord model practice.js plays from: what a chord symbol's chord tones,
  guide tones and scale are, as semitones above its root. Unlike the solo
  generator's six chord types (solo-ga.js's parseChord, which folds Cmaj7
  into C6 and Cm6 into Cm7 for New Orleans playing) it plays what the symbol
  writes:
  - chord tones: root, 3rd (the 4th or 2nd of a sus chord), 5th, and the
    written 7th or 6th. A plain major triad takes the 6th (the traditional
    jazz sound of a major chord), a plain minor triad the minor 7th, a
    diminished triad the diminished 7th; an augmented triad stays a triad.
  - guide tones: the 3rd (or the sus note) and the 7th or 6th.
  - scale: the chord tones plus one note in each gap — the 9th, the 11th and
    the 13th. Where a chord allows two (a dominant's 9 or b9, 11 or #11,
    13 or b13; a minor chord's 9 or b9, 13 or b13; a major chord's 11 or
    #11), the one in the tune's key wins, so the scale follows the harmony
    around it: E7 into Am gets F and C (b9, b13), Em7 in C is Phrygian, Am
    in C Aeolian, F in C Lydian, Bb7 in C Lydian dominant. Outside the key
    (or with no key) a default: Ionian, Mixolydian, Dorian, Locrian. A
    written alteration (7b9, 7#9, 7#11, 7b13, m6, mMaj7) is always kept.
    Diminished and augmented chords take their symmetrical scales.
*/

const mod12 = (x) => ((x % 12) + 12) % 12;

// Semitones of each interval number's major/perfect form, from the unison.
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
const PERFECT = new Set([1, 4, 5]);

// "3M", "7m", "5d", "9A", "13m" -> { degree, semis } (semis mod 12).
function readInterval(name) {
  const m = /^(\d+)([PMmAd])$/.exec(String(name));
  if (!m) return null;
  const degree = Number(m[1]);
  const step = ((degree - 1) % 7) + 1;
  let semis = NATURAL[step - 1];
  if (m[2] === "A") semis += 1;
  if (m[2] === "m") semis -= 1;
  if (m[2] === "d") semis -= PERFECT.has(step) ? 1 : 2;
  return { degree, semis: mod12(semis) };
}

// The chord's 3rd, 5th, 7th-or-6th and alterations from Tonal's intervals.
function chordShape(intervals) {
  const read = intervals.map(readInterval).filter(Boolean);
  const at = (degree) => read.filter((i) => i.degree === degree).map((i) => i.semis);
  let third = at(3)[0];
  const sus = third === undefined ? at(4)[0] : undefined;
  // A sus2 counts its 2nd as the 3rd; a bare power chord (C5) is major.
  if (third === undefined && sus === undefined) third = at(2).length > 0 ? 2 : 4;
  return {
    third,
    sus,
    fifth: at(5)[0] === undefined ? 7 : at(5)[0],
    seventh: at(7)[0] === undefined ? at(6)[0] : at(7)[0],
    ninths: at(9),
    elevenths: at(11),
    thirteenths: at(13),
  };
}

function familyOf(shape) {
  if (shape.third === 3 && shape.fifth === 6) return shape.seventh === 10 ? "hdim" : "dim";
  if (shape.fifth === 8) return "aug";
  if (shape.third === undefined) return shape.seventh === 10 ? "domsus" : "sus";
  if (shape.third === 3) return "min";
  return shape.seventh === 10 ? "dom" : "maj";
}

// The 7th or 6th a chord's arpeggio and guide tones take when none is written.
const IMPLIED_SEVENTH = { maj: 9, min: 10, dim: 9 };

/*
  Per family, the choices for each gap of the scale (the 2nd, 4th, 6th, and
  the 7th of a chord whose top tone is a 6th), the first being the default.
  A gap a chord tone already fills is skipped; a written tension (a #9 too)
  fills its gap by itself.
*/
const GAPS = {
  maj: { 2: [2], 4: [5, 6], 6: [9], 7: [11] },
  dom: { 2: [2, 1], 4: [5, 6], 6: [9, 8] },
  min: { 2: [2, 1], 4: [5], 6: [9, 8], 7: [10] },
  hdim: { 2: [1, 2], 4: [5], 6: [8] },
  sus: { 2: [2], 6: [9], 7: [11] },
  domsus: { 2: [2, 1], 6: [9, 8] },
};
const SYMMETRIC = {
  dim: [0, 2, 3, 5, 6, 8, 9, 11],
  aug: [0, 2, 4, 6, 8, 10],
  augmaj: [0, 2, 4, 6, 8, 9, 11],
};

// One gap's notes: the written tensions, else the choice in the key, else the default.
function gapNotes(choices, written, inKey) {
  if (written.length > 0) return written;
  const keyed = choices.filter(inKey);
  return [keyed.length === 1 ? keyed[0] : choices[0]];
}

function scaleOf(family, shape, tones, inKey) {
  if (family === "dim") return SYMMETRIC.dim;
  if (family === "aug") return shape.seventh === 11 ? SYMMETRIC.augmaj : SYMMETRIC.aug;
  const gaps = GAPS[family];
  const written = { 2: shape.ninths, 4: shape.elevenths, 6: shape.thirteenths, 7: [] };
  const out = new Set(tones);
  for (const gap of Object.keys(gaps)) {
    // The 7th gap is only open under a 6th: a written or implied 7th fills it.
    const filled = gaps[gap].some((s) => tones.includes(s)) || (gap === "7" && (tones.includes(10) || tones.includes(11)));
    if (!filled) for (const s of gapNotes(gaps[gap], written[gap], inKey)) out.add(s);
  }
  return [...out].sort((a, b) => a - b);
}

/*
  `sym` a chord name ("Cmaj7", "E7b9", "Dm6"), `key` the tune's key as a Set
  of pitch-class chromas (or null). Returns { sym, root, tones, guide, scale,
  third, fifth, top } — `root` a chroma, `tones`/`guide`/`scale` arrays of
  semitones above it, and `third` (the sus note of a sus chord), `fifth` and
  `top` (the 7th or 6th, written or implied; undefined for an augmented
  triad) the chord tones' own semitones, for practice.js's note sets. Throws
  on a name Tonal can't read, like solo-ga.js's parseChord.
*/
export function practiceChord(sym, key = null) {
  const info = Tonal.Chord.get(String(sym).trim());
  const rootMidi = info.tonic ? Tonal.Note.midi(`${info.tonic}4`) : null;
  if (!info.intervals || info.intervals.length === 0 || rootMidi === null || rootMidi === undefined) {
    throw new Error(`Unknown chord: ${sym}`);
  }
  const root = mod12(rootMidi);
  const shape = chordShape(info.intervals);
  const family = familyOf(shape);
  const top = shape.seventh === undefined ? IMPLIED_SEVENTH[family] : shape.seventh;
  const third = shape.third === undefined ? shape.sus : shape.third;
  const guide = [third, top].filter((s) => s !== undefined);
  const tones = [0, ...guide, shape.fifth].filter((s, i, all) => all.indexOf(s) === i).sort((a, b) => a - b);
  const inKey = (s) => key !== null && key.has(mod12(root + s));
  return {
    sym, root, tones, guide, third, top, scale: scaleOf(family, shape, tones, inKey), fifth: shape.fifth,
  };
}
