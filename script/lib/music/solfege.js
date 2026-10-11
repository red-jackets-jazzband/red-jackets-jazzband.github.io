/*
  Movable-do solfège for the "Solfège" layer: every melody note is sung by
  its place in the key, with do on the key's tonic — in a minor or modal key
  too (do-based minor: A minor's C is me, its G te). Chromatic notes get the
  usual raised/lowered syllables (di ri fi si li going up, ra me se le te
  coming down), chosen by how the note is *spelled*: in C, an F♯ is fi and a
  G♭ is se, though both sound the same.

    solfegeSyllable(step, semitones)
                       the syllable for a note `step` letters and `semitones`
                       semitones above the tonic
    melodySolfege(song)
                       [{ startChar, syllable }] for every note onset of the
                       tune's first voice
    solfegeLabel(syllable)
                       how the page's language writes it: English keeps the
                       syllables (and German, whose Tonika-Do shares them);
                       French and Dutch sing the seventh "si", so there a
                       chromatic note is its letter-syllable with ♯/♭ (fa♯,
                       si♭) rather than an English "si" that would clash
    solfegeText(syllable) / parseSolfegeText(text)
                       the annotation text the sheet engraves, and back: the
                       syllable behind an invisible marker, so the overlay
                       (songs/layers/overlays/solfege.js) can tell it from a
                       chart's own annotation

  A spelling with no common syllable of its own (E♯ in C, a double sharp)
  falls back to the one for its sound, flats for the black keys as on a
  blues chart (the same choice the Scale degrees layer makes: ♭5 is se). A
  tied continuation isn't sung again, so it gets no syllable.
*/
import { keyRoot } from "./chord-symbol.js";
import { topNote, walkMelody } from "./melody-walk.js";
import { tl } from "../core/i18n.js";

const LETTERS = "CDEFGAB";
// Semitones above the tonic of each step of the major scale.
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];
// Per step: lowered, natural, raised. null where the spelling has no
// syllable of its own (a lowered do is ti, a raised mi is fa, ...).
const SYLLABLES = [
  [null, "do", "di"],
  ["ra", "re", "ri"],
  ["me", "mi", null],
  [null, "fa", "fi"],
  ["se", "sol", "si"],
  ["le", "la", "li"],
  ["te", "ti", null],
];
// By sound alone, semitones above do.
const CHROMATIC = ["do", "ra", "re", "me", "mi", "fa", "se", "sol", "le", "la", "te", "ti"];

// Every syllable as the page writes it (lib/core/i18n.js; English when
// untranslated). One literal tl() per key so lint:i18n can check them.
const LABELS = {
  do: tl("solfege_do", "do"),
  di: tl("solfege_di", "di"),
  ra: tl("solfege_ra", "ra"),
  re: tl("solfege_re", "re"),
  ri: tl("solfege_ri", "ri"),
  me: tl("solfege_me", "me"),
  mi: tl("solfege_mi", "mi"),
  fa: tl("solfege_fa", "fa"),
  fi: tl("solfege_fi", "fi"),
  se: tl("solfege_se", "se"),
  sol: tl("solfege_sol", "sol"),
  si: tl("solfege_si", "si"),
  le: tl("solfege_le", "le"),
  la: tl("solfege_la", "la"),
  li: tl("solfege_li", "li"),
  te: tl("solfege_te", "te"),
  ti: tl("solfege_ti", "ti"),
};

export function solfegeLabel(syllable) {
  const label = LABELS[syllable];
  return label === undefined ? syllable : label;
}

// U+200B ZERO WIDTH SPACE: invisible if nothing restyles it, and not
// trimmed away by String#trim.
const MARK = "\u200B";

export function solfegeText(label) {
  return MARK + label;
}

// The label behind the marker, or null for any other annotation.
export function parseSolfegeText(text) {
  if (!text.startsWith(MARK)) return null;
  const label = text.slice(MARK.length);
  return label === "" ? null : label;
}

const mod = (n, m) => ((n % m) + m) % m;

export function solfegeSyllable(step, semitones) {
  const s = mod(step, 7);
  const alter = mod(semitones - MAJOR_STEPS[s] + 6, 12) - 6; // -6 .. 5
  const row = SYLLABLES[s];
  const own = alter >= -1 && alter <= 1 ? row[alter + 1] : null;
  return own === null ? CHROMATIC[mod(semitones, 12)] : own;
}

export function melodySolfege(song) {
  const out = [];
  walkMelody(song, (el, state) => {
    const tonic = keyRoot(state.key);
    const tonicLetter = tonic === null ? -1 : LETTERS.indexOf(state.key.root);
    const top = tonicLetter < 0 ? null : topNote(el, state);
    if (top === null || top.pitch.endTie) return;
    out.push({
      startChar: el.startChar,
      syllable: solfegeSyllable(LETTERS.indexOf(top.letter) - tonicLetter, top.midi - tonic),
    });
  });
  return out;
}
