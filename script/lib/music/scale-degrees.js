/*
  Scale degrees for the "Scale degrees" layer, after David Reed's Improvise
  for Real: every melody note is named by its step in the key (1-7 of the
  major scale; ♭/♯ for a note outside it), and a note that belongs to the
  chord sounding under it is circled. Reed builds every chord the same way
  — the root and every other step of the scale, so the 1 chord is 1-3-5-7
  and the 2 chord is 2-4-6-1 — and so a chord here always counts its
  seventh among its tones, written or not.

    chordTones(name)         pitch classes (0-11) of a chord symbol's own
                             notes: triad, plus the 6th or 7th when written
    degreeName(semitones)    "1" .. "7" with ♭/♯, `semitones` above the tonic
    melodyDegrees(song)      [{ startChar, degree, tone }] for every note
                             onset of the tune's first voice; tone is
                             "chord", "other", or "none" (no chord yet)
    degreeText(degree, tone) the annotation text the sheet engraves

  Degrees are counted from the key's tonic, in minor and modal keys too (A
  minor's C is ♭3). The tritone is always ♭5 and the note above the fifth
  ♭6, as on a blues chart. A tied continuation is not labelled again.

  Chord tones: root, third, fifth and seventh, plus the sixth of a 6 chord
  and the bass note of a slash chord. Extensions (9, 11, 13) aren't chord
  tones. The seventh of a plain triad is the one its key gives it: a
  major chord's major seventh, a minor chord's flat seventh.
*/
import { chordName, keyRoot, parseChordSymbol, splitChordSymbol } from "./chord-symbol.js";
import { topNote, walkMelody } from "./melody-walk.js";

const DEGREES = ["1", "♭2", "2", "♭3", "3", "4", "♭5", "5", "♭6", "6", "♭7", "7"];

// Printed before the degree in the annotation; songs/layers/overlays.js
// reads it back to draw the note's disc (chord tone) or ring (other).
export const TONE_MARK = { chord: "●", other: "○", none: "•" };
const MARK_TONES = Object.keys(TONE_MARK);

export function degreeName(semitones) {
  return DEGREES[((semitones % 12) + 12) % 12];
}

export function degreeText(degree, tone) {
  return TONE_MARK[tone] + degree;
}

// The tone and degree back out of annotation text, or null when it isn't one.
export function parseDegreeText(text) {
  const tone = MARK_TONES.find((t) => text.startsWith(TONE_MARK[t]));
  if (tone === undefined) return null;
  const degree = text.slice(TONE_MARK[tone].length);
  return DEGREES.includes(degree) ? { tone, degree } : null;
}

const hasAny = (rest, parts) => parts.some((p) => rest.includes(p));
const MAJOR_SEVENTH = ["maj7", "Maj7", "M7", "\u0394", "maj9", "j7"];
// The seventh every chord carries in this method (the 1 chord is 1-3-5-7),
// when the symbol doesn't spell one out: a major chord's major seventh, a
// dominant's flat seventh, a diminished chord's diminished seventh.
const SEVENTH_BY_QUALITY = { maj: 11, aug: 11, dom: 10, hdim: 10, dim: 9 };

function seventhOf(quality, rest) {
  if (quality === "min") return hasAny(rest, MAJOR_SEVENTH) ? 11 : 10;
  return SEVENTH_BY_QUALITY[quality];
}

// The triad's intervals, with the fifth moved by an altered-fifth symbol.
function triadOf(quality, rest) {
  const third = ["min", "dim", "hdim"].includes(quality) ? 3 : 4;
  let fifth = 7;
  if (quality === "dim" || quality === "hdim" || hasAny(rest, ["b5", "♭5"])) fifth = 6;
  if (quality === "aug" || hasAny(rest, ["#5", "♯5", "+"])) fifth = 8;
  if (rest.includes("sus")) return [0, rest.includes("sus2") ? 2 : 5, fifth];
  return [0, third, fifth];
}

const SIXTH_PREFIXES = ["6", "m6", "min6", "-6", "maj6", "Maj6", "M6", "Δ6"];

// A 6 chord (C6, Cm6, Cmaj6, C6/9): its sixth is a chord tone.
function hasSixth(rest) {
  return SIXTH_PREFIXES.some((p) => rest.startsWith(p)) || rest.includes("6/9");
}

export function chordTones(name) {
  const split = splitChordSymbol(name);
  const parsed = parseChordSymbol(name);
  if (split === null || parsed === null) return new Set();
  const { root, rest } = split;
  const intervals = triadOf(parsed.quality, rest);
  intervals.push(seventhOf(parsed.quality, rest));
  if (hasSixth(rest)) intervals.push(9);
  const tones = new Set(intervals.map((i) => (root + i) % 12));
  const bass = name.includes("/") ? parseChordSymbol(name.slice(name.indexOf("/") + 1)) : null;
  if (bass !== null) tones.add(bass.root);
  return tones;
}

function toneOf(pitchClass, chord) {
  if (chord === null) return "none";
  return chord.has(pitchClass) ? "chord" : "other";
}

// "N.C." (no chord): nothing sounds under it, so no note is a chord tone.
const NO_CHORD = /^n\.?c\.?$/i;

export function melodyDegrees(song) {
  const out = [];
  let chord = null;
  walkMelody(song, (el, state) => {
    const name = chordName(el);
    if (name !== null && NO_CHORD.test(name)) chord = null;
    else if (name !== null && parseChordSymbol(name) !== null) chord = chordTones(name);
    const tonic = keyRoot(state.key);
    const top = tonic === null ? null : topNote(el, state);
    if (top === null || top.pitch.endTie) return;
    const pitchClass = ((top.midi % 12) + 12) % 12;
    out.push({
      startChar: el.startChar,
      degree: degreeName(pitchClass - tonic),
      tone: toneOf(pitchClass, chord),
    });
  });
  return out;
}
