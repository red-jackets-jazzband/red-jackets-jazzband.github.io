import { computeChordOffset, BREAK_CHORD } from "./chords.js";
import { nextVoiceId } from "./voice-id.js";
import { execAll } from "../core/regex-exec-all.js";

/*
   Chord-tone comping generator.

   Given a lead sheet's chord scheme, this turns each bar into a rhythmic,
   three-note accompaniment figure (root / third / fifth) using one of a set
   of predefined rhythm patterns, and returns a new ABC tune string that adds
   the comping as a *second staff* below the untouched melody.

   The comping is a single voice of block chords — one stem per hit — with the
   three chord tones drawn as one chord token "[low mid high]". Each chord is
   voice-led from the one before it: of its three stackings (root position and
   both inversions) the one closest to the previous voicing is drawn, in real
   register, so each of the three lines barely moves from chord to chord.

   The three lines are the three colours (black / gold / red, low to high) and
   they never cross, so the colour is just the vertical slot — but the pattern
   builders below tie planed neighbours to the main chord and abcjs can't
   colour a notehead by slot on its own, so `buildCompingTune` still returns a
   `palette` (one slot order per onset) that sheet-decorations.js zips against
   the rendered noteheads and their tie arcs.

   `buildCompingTune` is the entry point. Everything here is pure: it needs
   only the parsed chord scheme + key (from the caller's ABCjs parse) and the
   `Tonal` global for note math, the same way music-theory.js does.
*/

// ---------------------------------------------------------------------------
// Rhythm patterns
// ---------------------------------------------------------------------------
// Each builder returns an ABC bar fragment in eighth-note units (one 4/4 bar =
// 8 slots; `half` = 4 slots, used when two chords share a bar). Builders take
// up to four ABC chord tokens: n (the triad "[ceg]"), nd / nu (the whole
// triad planed one diatonic scale step below / above) and nu2 (two steps
// above). Patterns that don't need the step tokens just ignore the extras.

// Exported (alongside the UI-facing COMPING_PATTERNS metadata above) so each
// pattern's exact rhythm template can be unit-tested directly with plain
// placeholder tokens, instead of only indirectly through buildCompingTune's
// full voice-leading pipeline — see comping.test.js.
export const PATTERNS = {
  on_2_and_4: {
    twobar1: (n) => `z2 ${n}2 z2 ${n}2`,
    twobar2: (n) => `${n} z z ${n}-${n}4`,
    half: (n) => `z2 ${n}2`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `z2 ${n}2`,
    halfOdd: (n) => `${n} z z ${n}`,
    half2Odd: (n) => `${n}4`,
  },
  hold_over: {
    twobar1: (n) => `${n}8-`,
    twobar2: (n) => `${n}6 z2`,
    half: (n) => `${n}4`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `${n}4`,
    halfOdd: (n) => `${n}4`,
    half2Odd: (n) => `${n}2 z2`,
  },
  hit_and_hold: {
    twobar1: (n) => `${n} z z ${n}-${n}4`,
    twobar2: (n) => `${n} z z ${n}-${n}4`,
    half: (n) => `${n} z z ${n}`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `${n}4`,
    halfOdd: (n) => `${n} z z ${n}`,
    half2Odd: (n) => `${n}4`,
  },
  double_hit: {
    twobar1: (n) => `${n} ${n} z2 z4`,
    twobar2: (n) => `${n} ${n} z ${n} z ${n}3`,
    half: (n) => `${n} ${n} z2`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: () => "z4",
    halfOdd: (n) => `${n} ${n} z ${n}`,
    half2Odd: (n) => `z ${n}3`,
  },
  whole_note: {
    twobar1: (n) => `${n}8`,
    twobar2: (n) => `${n}8`,
    half: (n) => `${n}4`,
  },
  walk_down_a: {
    twobar1: (n) => `${n} z z ${n}-${n}2 z2`,
    twobar2: (n, nd) => `${n} ${n} ${nd} ${n} z4`,
    half: (n) => `${n} z z ${n}`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `${n}2 z2`,
    halfOdd: (n, nd) => `${n} ${n} ${nd} ${n}`,
    half2Odd: () => "z4",
  },
  walk_down_b: {
    twobar1: (n, nd) => `z2 ${n} z ${nd} ${n}2 ${nd}`,
    twobar2: (n, nd) => `${n} ${n} ${nd} ${n} z4`,
    half: (n) => `z2 ${n} z`,
    // Two chords in a bar: keep the full bar's rhythm (hits at slots 2, 4,
    // 5-6, 7) instead of repeating the first half's figure.
    half2: (n, nd) => `${nd} ${n}2 ${nd}`,
    // Odd bars carry twobar2's rhythm (eighth-note run, then silence): the
    // first chord gets the run, the second half stays silent like the pattern.
    halfOdd: (n, nd) => `${n} ${n} ${nd} ${n}`,
    half2Odd: () => "z4",
  },
  whole_then_step: {
    twobar1: (n) => `${n}8`,
    twobar2: (n, nd) => `${nd} z z ${nd} z4`,
    half: (n) => `${n}4`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `${n}4`,
    halfOdd: (n, nd) => `${nd} z z ${nd}`,
    half2Odd: () => "z4",
  },
  walk_eighths: {
    twobar1: (n, nd) => `${n} ${n} ${nd} ${nd} ${n} ${n} ${nd} ${nd}`,
    twobar2: (n) => `${n} z z ${n}-${n}4`,
    half: (n, nd) => `${n} ${n} ${nd} ${nd}`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n, nd) => `${n} ${n} ${nd} ${nd}`,
    halfOdd: (n) => `${n} z z ${n}`,
    half2Odd: (n) => `${n}4`,
  },
  cross_step: {
    twobar1: (n) => `z2 ${n} z z ${n} z2`,
    twobar2: (n, nd, nu) => `${n} z z ${n}-${n} ${nu} ${nd} z`,
    half: (n) => `z2 ${n} z`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `z ${n} z2`,
    halfOdd: (n) => `${n} z z ${n}`,
    half2Odd: (n, nd, nu) => `${n} ${nu} ${nd} z`,
  },
  step_approach: {
    twobar1: (n, nd, nu) => `${n} ${nd} z2 ${nu} ${nd} z2`,
    twobar2: (n, nd, nu) => `${nu}3 ${nd} z4`,
    half: (n, nd) => `${n} ${nd} z2`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n, nd, nu) => `${nu} ${nd} z2`,
    halfOdd: (n, nd, nu) => `${nu}3 ${nd}`,
    half2Odd: () => "z4",
  },
  double_then_step: {
    twobar1: (n) => `${n} ${n} z2 ${n} ${n} z2`,
    twobar2: (n, nd, nu) => `${n} z ${nu} ${nd} z4`,
    half: (n) => `${n} ${n} z2`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `${n} ${n} z2`,
    halfOdd: (n, nd, nu) => `${n} z ${nu} ${nd}`,
    half2Odd: () => "z4",
  },
  full_walk: {
    twobar1: (n, nd, nu) => `${n} ${n} ${nd} ${n} ${nu} ${n} ${nd} ${n}`,
    twobar2: (n, nd) => `${nd} z z ${n}-${n}4`,
    half: (n, nd) => `${n} ${n} ${nd} ${n}`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n, nd, nu) => `${nu} ${n} ${nd} ${n}`,
    halfOdd: (n, nd) => `${nd} z z ${n}`,
    half2Odd: (n) => `${n}4`,
  },
  third_approach: {
    twobar1: (n, nd) => `${n} ${nd} z ${nd}-${n}4`,
    twobar2: (n, nd, nu, nu2) => `${nu2} ${nd} z ${nd}-${n}4`,
    half: (n, nd) => `${n} ${nd} z ${nd}`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `${n}4`,
    halfOdd: (n, nd, nu, nu2) => `${nu2} ${nd} z ${nd}`,
    half2Odd: (n) => `${n}4`,
  },
  step_neighbor: {
    twobar1: (n, nd, nu) => `${n} ${nd} z ${nu}-${n}4`,
    twobar2: (n, nd, nu) => `${n} ${nd} z ${nu} z ${n}3`,
    half: (n, nd, nu) => `${n} ${nd} z ${nu}`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `${n}4`,
    halfOdd: (n, nd, nu) => `${n} ${nd} z ${nu}`,
    half2Odd: (n) => `z ${n}3`,
  },
  // Charleston: the classic two-note kick — a held chord on beat 1 (a dotted
  // quarter, 3 slots) answered by a short stab on the "and" of beat 2, then
  // silence through beats 3-4. Same figure every bar.
  charleston: {
    twobar1: (n) => `${n}3 ${n} z4`,
    twobar2: (n) => `${n}3 ${n} z4`,
    half: (n) => `${n}3 ${n}`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: () => "z4",
    halfOdd: (n) => `${n}3 ${n}`,
    half2Odd: () => "z4",
  },
  // Reverse Charleston: the same kick, placed in the back half of the bar
  // instead of the front — silence through beats 1-2, then the held-chord +
  // stab landing on beat 3 and the "and" of beat 4.
  reverse_charleston: {
    twobar1: (n) => `z4 ${n}3 ${n}`,
    twobar2: (n) => `z4 ${n}3 ${n}`,
    half: () => "z4",
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `${n}3 ${n}`,
    halfOdd: () => "z4",
    half2Odd: (n) => `${n}3 ${n}`,
  },
  // Son clave, 3-2: bar 1 is the "three side" (tresillo — hits on beat 1,
  // the "and" of 2, and beat 4), bar 2 the "two side" (hits on beat 2 and
  // the "and" of 3), each a short staccato stab (one eighth, then silence)
  // so the comping doesn't drown out a soloist.
  clave_3_2: {
    twobar1: (n) => `${n} z2 ${n} z2 ${n} z`,
    twobar2: (n) => `z2 ${n} z2 ${n} z2`,
    half: (n) => `${n} z2 ${n}`,
    // Two chords in a bar keep the bar's own clave rhythm: even bars are the
    // three side (halves 1-2), odd bars the two side.
    half2: (n) => `z2 ${n} z`,
    halfOdd: (n) => `z2 ${n} z`,
    half2Odd: (n) => `z ${n} z2`,
  },
  // Son clave, 2-3: the same two bars in the opposite order — the "two
  // side" first, then the "three side".
  clave_2_3: {
    twobar1: (n) => `z2 ${n} z2 ${n} z2`,
    twobar2: (n) => `${n} z2 ${n} z2 ${n} z`,
    half: (n) => `z2 ${n} z`,
    // Two chords in a bar keep the bar's own clave rhythm: even bars are the
    // two side, odd bars the three side.
    half2: (n) => `z ${n} z2`,
    halfOdd: (n) => `${n} z2 ${n}`,
    half2Odd: (n) => `z2 ${n} z`,
  },
  // Three hit: a rhythm-section "kick" figure — three quick stabs on beats
  // 1, the "and" of 1, and 2, then held silence through the rest of the bar.
  three_hit: {
    twobar1: (n) => `${n} ${n} ${n} z z4`,
    twobar2: (n) => `${n} ${n} ${n} z z4`,
    half: (n) => `${n} ${n} ${n} z`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: () => "z4",
    halfOdd: (n) => `${n} ${n} ${n} z`,
    half2Odd: () => "z4",
  },
  // I Got a Woman: the gospel/R&B push figure — three separate quarter-note
  // hits (no ties) on beat 2 and the "and" of beat 3 of bar 1, then landing
  // on beat 1 of bar 2, silent otherwise. The two-bar phrase then repeats.
  i_got_a_woman: {
    twobar1: (n) => `z2 ${n}2 z ${n}2 z`,
    twobar2: (n) => `${n}2 z6`,
    half: (n) => `z2 ${n}2`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `z ${n}2 z`,
    halfOdd: (n) => `${n}2 z2`,
    half2Odd: () => "z4",
  },
  // Honky Tonk Riff: the syncopated left-hand riff figure from "Down in
  // Honky Tonk Town" — four punchy off-beat stabs on the beat in bar 1,
  // answered in bar 2 by the same four stabs shifted a half-beat later. In
  // the source riff that second bar's own second hit is a quick lower
  // neighbor sliding up into the chord (its "G/4B/2" grace note) rather
  // than a flat repeat, so this pattern plays that hit as `nd` — not a
  // single grace note on one voice, but the file's usual whole-triad,
  // planed-one-diatonic-step-down token (see the "Rhythm patterns" doc
  // comment above), resolving up into the next stab's `n`. Concretely: if
  // `n` this beat is Cm in a Bb-major tune, `nd` plays a Bb-shaped voicing
  // (Cm's C-Eb-G planed down one scale step along Bb major's Bb-C-D-Eb-F-
  // G-A gives Bb-D-F) — the same "whole chord, one step away" relationship
  // every other stepwise pattern here uses, just resolving upward instead
  // of down. A two-bar call-and-response rather than one bar repeated, same
  // shape as the walk-down/full-walk patterns above.
  honky_tonk_riff: {
    twobar1: (n) => `${n} z ${n} z ${n} z ${n} z`,
    twobar2: (n, nd) => `z ${n} ${nd} ${n} z ${n} z ${n}`,
    half: (n) => `${n} z ${n} z`,
    // Two chords in a bar: each half carries its slice of the full bar's rhythm.
    half2: (n) => `${n} z ${n} z`,
    halfOdd: (n, nd) => `z ${n} ${nd} ${n}`,
    half2Odd: (n) => `z ${n} z ${n}`,
  },
};

const GROUP_BASE = "Base patterns";
const GROUP_STEP_DOWN = "Step down";
const GROUP_STEP_UP_DOWN = "Step up & down";
const GROUP_TRADITIONAL = "Named grooves";

// Ordered list for the sheet's <select>, grouped like the prototype's optgroups.
// Named grooves leads the list so the clave/Charleston feels are the first
// options a musician sees, ahead of the more generic base/step patterns.
export const COMPING_PATTERNS = [
  { value: "charleston", label: "Charleston", group: GROUP_TRADITIONAL },
  { value: "reverse_charleston", label: "Reverse Charleston", group: GROUP_TRADITIONAL },
  { value: "clave_3_2", label: "3-2 clave", group: GROUP_TRADITIONAL },
  { value: "clave_2_3", label: "2-3 clave", group: GROUP_TRADITIONAL },
  { value: "three_hit", label: "3 hit", group: GROUP_TRADITIONAL },
  { value: "i_got_a_woman", label: "I Got a Woman", group: GROUP_TRADITIONAL },
  { value: "honky_tonk_riff", label: "Honky Tonk Riff", group: GROUP_TRADITIONAL },
  { value: "on_2_and_4", label: "On 2 and 4", group: GROUP_BASE },
  { value: "hold_over", label: "Hold over", group: GROUP_BASE },
  { value: "hit_and_hold", label: "Hit and hold", group: GROUP_BASE },
  { value: "double_hit", label: "Double hit", group: GROUP_BASE },
  { value: "whole_note", label: "Whole note", group: GROUP_BASE },
  { value: "walk_down_a", label: "Walk down A", group: GROUP_STEP_DOWN },
  { value: "walk_down_b", label: "Walk down B", group: GROUP_STEP_DOWN },
  { value: "whole_then_step", label: "Whole then step", group: GROUP_STEP_DOWN },
  { value: "walk_eighths", label: "Walk eighths", group: GROUP_STEP_DOWN },
  { value: "cross_step", label: "Cross step", group: GROUP_STEP_UP_DOWN },
  { value: "step_approach", label: "Step approach", group: GROUP_STEP_UP_DOWN },
  { value: "double_then_step", label: "Double then step", group: GROUP_STEP_UP_DOWN },
  { value: "full_walk", label: "Full walk", group: GROUP_STEP_UP_DOWN },
  { value: "third_approach", label: "Third approach", group: GROUP_STEP_UP_DOWN },
  { value: "step_neighbor", label: "Step neighbor", group: GROUP_STEP_UP_DOWN },
];

const PATTERN_LABEL = COMPING_PATTERNS.reduce((acc, p) => {
  acc[p.value] = p.label;
  return acc;
}, {});

// ---------------------------------------------------------------------------
// Pure ABC / rhythm helpers (no Tonal)
// ---------------------------------------------------------------------------

function gcd(x, y) {
  let a = Math.abs(x);
  let b = Math.abs(y);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

/*
   Format a duration given in eighth-note slots as an ABC length suffix,
   scaled to the tune's own unit note length L:num/den. With L:1/8 a slot is
   "" (dur 1) / "2" / "8" …; with L:1/4 a slot is "/2", two slots "", etc.
*/
export function formatDuration(slots, lnum, lden) {
  let num = slots * lden;
  let den = 8 * lnum;
  const g = gcd(num, den);
  num /= g;
  den /= g;
  if (den === 1) return num === 1 ? "" : String(num);
  if (num === 1) return "/" + den;
  return num + "/" + den;
}

/*
   Sum the played duration of one melody bar segment, in eighth-note slots,
   scaled to the tune's unit note length L:lnum/lden. Chords ([CEG]) count
   once, grace notes / decorations / chord symbols / inline fields are
   ignored, and broken rhythm (`>` `<`) nets to zero across a bar so it's
   dropped. Returns 0 when nothing measurable is found.

   Used to give a pickup/anacrusis its true length in the comping voices: a
   fixed whole-bar rest there pushes the first barline out and the melody and
   comping staves stop lining up.
*/
// Removes every `open...close` run from `str` (replacing it with
// `replacement`), scanning once left to right with plain string search
// instead of a `open...*...close` regex — avoids the quadratic worst case a
// star-quantified regex hits when scanned across a string with no closing
// delimiter.
function stripDelimited(str, open, close, replacement) {
  let result = "";
  let i = 0;
  while (i < str.length) {
    if (str[i] !== open) {
      result += str[i];
      i += 1;
      continue;
    }
    const end = str.indexOf(close, i + 1);
    if (end === -1) {
      result += str.slice(i);
      break;
    }
    result += replacement;
    i = end + 1;
  }
  return result;
}

// Removes every ABC inline field (`[K:C]`, `[Q:1/4=120]`, ...) from `str`:
// a "[", a single letter, ":", then anything up to the next "]".
function stripInlineFields(str) {
  let result = "";
  let i = 0;
  while (i < str.length) {
    const nextChar = str[i + 1] === undefined ? "" : str[i + 1];
    const isField = str[i] === "[" && /[A-Za-z]/.test(nextChar) && str[i + 2] === ":";
    if (!isField) {
      result += str[i];
      i += 1;
      continue;
    }
    const end = str.indexOf("]", i + 3);
    if (end === -1) {
      result += str.slice(i);
      break;
    }
    i = end + 1;
  }
  return result;
}

const CHORD_NOTE_LETTERS = "ABCDEFGabcdefg";
const NOTE_LETTERS = CHORD_NOTE_LETTERS + "xz";
const PITCH_LETTERS = NOTE_LETTERS + "Z";

function scanRun(str, i, isMember) {
  let j = i;
  while (j < str.length && isMember(str[j])) j += 1;
  return j;
}
const isAccidental = (c) => c === "_" || c === "^" || c === "=";
const isOctaveMark = (c) => c === "'" || c === ",";
const isDigit = (c) => c >= "0" && c <= "9";
const isSlash = (c) => c === "/";

// Scans one accidentals*-letter-octaves* note (the letter drawn from
// `letters`), returning the index just past it, or -1 if there's no letter
// from that set once the accidentals are skipped.
function scanNoteLetter(str, i, letters) {
  const afterAccidentals = scanRun(str, i, isAccidental);
  if (afterAccidentals >= str.length || !letters.includes(str[afterAccidentals])) return -1;
  return scanRun(str, afterAccidentals + 1, isOctaveMark);
}

// Scans an optional duration suffix — digits, then an optional run of "/"s
// with their own optional digits (e.g. "2", "/2", "3/2", "/") — returning
// the index just past it, the resulting multiplier, and the exact
// numerator/denominator it spelled out (num/den, before any reduction) so a
// caller that needs to combine two duration suffixes exactly — see
// stripChordBrackets below — can multiply the fractions instead of the
// already-rounded float `mult`.
function scanDurationMultiplier(str, i) {
  const numEnd = scanRun(str, i, isDigit);
  const numerator = str.slice(i, numEnd);
  const num = numerator ? Number.parseInt(numerator, 10) : 1;
  if (str[numEnd] !== "/") return { end: numEnd, mult: num, num, den: 1 };
  const slashEnd = scanRun(str, numEnd, isSlash);
  const denomEnd = scanRun(str, slashEnd, isDigit);
  const denominator = str.slice(slashEnd, denomEnd);
  const den = denominator ? Number.parseInt(denominator, 10) : 2 ** (slashEnd - numEnd);
  return { end: denomEnd, mult: num / den, num, den };
}

// Formats the product of two duration-suffix fractions (see
// scanDurationMultiplier) as the ABC suffix text that would reproduce that
// same combined multiplier if re-scanned — "" for 1, a bare integer when the
// product is whole, otherwise "num/den".
function multiplyDurationSuffixes(a, b) {
  const num = a.num * b.num;
  const den = a.den * b.den;
  const g = gcd(num, den);
  const n = num / g;
  const d = den / g;
  if (n === 1 && d === 1) return "";
  return d === 1 ? String(n) : n + "/" + d;
}

// Like stripDelimited("[", "]", ...) but the replacement carries the
// chord's own duration instead of a fixed placeholder: a bracket that spells
// each tone's length out individually ("[F2_d2]", with no shared duration
// trailing the "]" — the "_Break rhythm" bars in happy_feet_blues' part C)
// must still count as one duration-2 event, not silently default to 1.
// ABCjs itself takes a chord's duration from its first note, so this reads
// the same one. A duration suffix can *also* trail the closing "]" itself
// ("[F2_d2]2" — the whole chord doubled on top of its own first note's
// length); the two multipliers are independent ABC duration modifiers and
// must be multiplied together, not have their digit text concatenated.
function stripChordBrackets(str) {
  let result = "";
  let i = 0;
  while (i < str.length) {
    if (str[i] !== "[") {
      result += str[i];
      i += 1;
      continue;
    }
    const end = str.indexOf("]", i + 1);
    if (end === -1) {
      result += str.slice(i);
      break;
    }
    const inner = str.slice(i + 1, end);
    const noteEnd = scanNoteLetter(inner, 0, CHORD_NOTE_LETTERS);
    const innerDur = noteEnd === -1 ? { num: 1, den: 1 } : scanDurationMultiplier(inner, noteEnd);
    const outerDur = scanDurationMultiplier(str, end + 1);
    result += "Y" + multiplyDurationSuffixes(innerDur, outerDur);
    i = outerDur.end;
  }
  return result;
}

export function measureBarSlots(segment, lnum, lden) {
  const unitSlots = (8 * lnum) / lden;
  let s = String(segment);
  s = stripDelimited(s, '"', '"', "");
  s = stripDelimited(s, "!", "!", "");
  s = stripInlineFields(s);
  s = stripDelimited(s, "{", "}", "");
  s = stripChordBrackets(s);

  let total = 0;
  let matched = false;
  let i = 0;
  while (i < s.length) {
    let end = s[i] === "Y" ? i + 1 : scanNoteLetter(s, i, PITCH_LETTERS);
    if (end === -1) {
      i += 1;
      continue;
    }
    end = scanRun(s, end, isOctaveMark);
    const duration = scanDurationMultiplier(s, end);
    matched = true;
    total += unitSlots * duration.mult;
    i = duration.end;
  }
  return matched ? total : 0;
}

// Returns the run of ASCII digits `str` ends with, or "" if it doesn't end
// in one — a plain scan in place of a `(\d+)$` regex, which a JS engine can
// only reject by retrying every string position when there's no match.
function trailingDigits(str) {
  let i = str.length;
  while (i > 0 && str[i - 1] >= "0" && str[i - 1] <= "9") i -= 1;
  return str.slice(i);
}

// Scans an optional duration suffix, returning just the index past it (see
// scanDurationMultiplier for the numerator/denominator breakdown).
function scanDuration(str, i) {
  return scanDurationMultiplier(str, i).end;
}

// Scans a "[note note ...]" chord bracket, returning the index just past
// the "]", or -1 if `i` isn't the start of a well-formed one.
function scanChordBracket(str, i) {
  let j = i + 1;
  let sawNote = false;
  let noteEnd = scanNoteLetter(str, j, CHORD_NOTE_LETTERS);
  while (noteEnd !== -1) {
    j = noteEnd;
    sawNote = true;
    noteEnd = scanNoteLetter(str, j, CHORD_NOTE_LETTERS);
  }
  return sawNote && str[j] === "]" ? j + 1 : -1;
}

function pushNoteToken(tokens, t) {
  const tie = t.slice(-1) === "-";
  const body = tie ? t.slice(0, -1) : t;
  const digits = trailingDigits(body);
  const dur = digits ? Number.parseInt(digits, 10) : 1;
  const pitch = digits ? body.slice(0, -digits.length) : body;
  const head = pitch[0] === "[" ? "[" : pitch.replace(/^[_^=]+/, "")[0];
  tokens.push({ pitch, dur, tie, rest: head === "z" || head === "x" });
}

// Split an ABC bar fragment into note / chord / rest / annotation tokens.
// A manual scan rather than one combined regex: it's the same "try each
// token kind at this position, else step forward one character" behaviour
// an unanchored `alt1|alt2|alt3` regex would have, without the quadratic
// worst case that kind of pattern can hit when scanned across a long
// non-matching run.
export function tokenizeBar(str) {
  /** @type {Array<{ annotation?: string, pitch?: string, dur?: number, tie?: boolean, rest?: boolean }>} */
  const tokens = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === '"') {
      const end = str.indexOf('"', i + 1);
      if (end === -1) {
        i += 1;
        continue;
      }
      tokens.push({ annotation: str.slice(i, end + 1) });
      i = end + 1;
      continue;
    }

    const tokenStart = i;
    let end = str[i] === "[" ? scanChordBracket(str, i) : -1;
    if (end === -1) end = scanNoteLetter(str, i, NOTE_LETTERS);
    if (end === -1) {
      i += 1;
      continue;
    }
    end = scanDuration(str, end);
    if (str[end] === "-") end += 1;
    pushNoteToken(tokens, str.slice(tokenStart, end));
    i = end;
  }
  return tokens;
}

/*
   Re-emit a bar fragment (authored in eighth slots) with:
     - every duration scaled to the tune's unit note length, and
     - whitespace only at 4-slot boundaries / around long notes, so ABCjs
       beams the eighths in groups of four instead of one long run.
*/
export function rebeamBar(str, lnum, lden) {
  const tokens = tokenizeBar(str);
  let out = "";
  let pos = 0;
  let prevDur = 0;
  let prevRest = false;
  let started = false;
  for (const tok of tokens) {
    if (tok.annotation) {
      out += (out ? " " : "") + tok.annotation;
      continue;
    }
    const needSpace =
      started &&
      (tok.rest || prevRest || pos % 4 === 0 || prevDur > 1 || tok.dur > 1);
    if (needSpace) out += " ";
    out += tok.pitch + formatDuration(tok.dur, lnum, lden) + (tok.tie ? "-" : "");
    pos += tok.dur;
    prevDur = tok.dur;
    prevRest = tok.rest;
    started = true;
  }
  return out;
}

/*
   Rewrite the accidentals in one comping bar fragment so every notehead still
   sounds its intended pitch but carries the *fewest* signs.

   The pattern builders stack chord tokens straight from Tonal, which spells a
   note as bare (natural), `^` (sharp) or `_` (flat) with no regard for the
   key signature — so a diatonic Bb in F major comes out `_B`, a redundant
   flat. That redundancy is invisible until the sheet transposes: ABCjs carries
   the explicit accidental through the transpose and prints it as a courtesy
   natural in the new key.

   So per note we emit an explicit accidental only where the note departs from
   the key signature or from an accidental already set on that pitch earlier in
   the bar, and a natural sign *only* to cancel one of those — never on a note
   the key already renders natural. `keySig` maps a bare letter to its key
   signature accidental ("", "^", "_"). Accidentals propagate per letter+octave
   (ABCjs's default), and a comping fragment is exactly one measure, so nothing
   resets mid-fragment.
*/
// Tonal never writes `=`; treat a bare accidental the same as an explicit
// natural so the two compare equal.
function normAccidental(a) {
  return a === "" ? "nat" : a;
}

// Rebuild one run of notes ("CEG" inside a chord, or a lone "_B,") with the
// fewest accidentals, tracking what's already been set this bar in `barAcc`.
function respellNotes(run, keySig, barAcc) {
  const rebuilt = [];
  for (const [, acc, letterRaw, oct] of execAll(
    /([_^=]{0,2})([A-Ga-g])([,']{0,4})/g,
    run,
  )) {
    const letterOct = letterRaw + oct;
    const letter = letterRaw.toUpperCase();
    // Tonal never writes `=`; a bare note means natural.
    const want = acc.replace(/=/g, "");
    const current = barAcc.has(letterOct)
      ? barAcc.get(letterOct)
      : keySig[letter] || "";
    if (normAccidental(want) === normAccidental(current)) {
      rebuilt.push(letterOct);
      continue;
    }
    barAcc.set(letterOct, want);
    rebuilt.push((want || "=") + letterOct);
  }
  return rebuilt.join("");
}

// Handles chord tokens "[CEG]" and, for the solo voice, single notes.
export function respellBar(fragment, keySig) {
  const barAcc = new Map();
  return String(fragment).replace(/\[[_^=A-Ga-g,']+\]|[_^=]{0,2}[A-Ga-g][,']{0,4}/g, (token) => (
    token.startsWith("[")
      ? "[" + respellNotes(token.slice(1, -1), keySig, barAcc) + "]"
      : respellNotes(token, keySig, barAcc)
  ));
}

// The inverse of respellBar: every note spelled with its full, effective
// accidental (key signature and earlier in-bar accidentals folded in), so a
// bar respelled for one key can be respelled again for another.
export function explicitBar(fragment, keySig) {
  const barAcc = new Map();
  return String(fragment).replace(
    /([_^=]{0,2})([A-Ga-g])([,']{0,4})/g,
    (_all, acc, letterRaw, oct) => {
      const letterOct = letterRaw + oct;
      let eff;
      if (acc === "") {
        eff = barAcc.has(letterOct) ? barAcc.get(letterOct) : keySig[letterRaw.toUpperCase()] || "";
      } else {
        eff = acc.replace(/=/g, "");
        barAcc.set(letterOct, eff);
      }
      return eff + letterOct;
    },
  );
}

// Spread `total` eighth slots across `parts` notes as evenly as possible.
export function distribute(total, parts) {
  const base = Math.floor(total / parts);
  let remainder = total - base * parts;
  const out = [];
  for (let i = 0; i < parts; i++) {
    out.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder--;
  }
  return out;
}

// Accepted meters — the patterns are written for a bar of 8 eighth slots.
const SUPPORTED_METERS = new Set(["4/4", "C", "C|", "2/2"]);

function readMeter(text) {
  const m = text.match(/^M:\s*(\S+)/m);
  if (!m) return "4/4";
  return SUPPORTED_METERS.has(m[1]) ? m[1] : null;
}

function readUnit(text) {
  const m = text.match(/^L:\s*(\d+)\s*\/\s*(\d+)/m);
  if (m) return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10)];
  return [1, 8];
}

// The header's closing K: line. Only the *first* one: a tune that modulates
// (do_you_know_what_it_means.abc) carries later whole-line K: fields in its
// body, and splitting on the last would swallow every section before it into
// the header and leave the comping voice covering only the final section.
function headerKLineIndex(lines) {
  return lines.findIndex((line) => line.startsWith("K:"));
}

/*
   Split an ABC tune string into { header, kLine, body }: header is every line
   before the first K: line, body is everything after it. Returns null when
   there is no K: line to split on.
*/
function splitHeaderBody(text) {
  const lines = text.split("\n");
  const kIdx = headerKLineIndex(lines);
  if (kIdx === -1) return null;
  return {
    header: lines.slice(0, kIdx),
    kLine: lines[kIdx],
    body: lines.slice(kIdx + 1).join("\n"),
  };
}

// Voice ids the tune itself declares, in order of first appearance -- e.g.
// honky_tonk_town_riffs.abc's Root/Third/Fifth, or a Trumpet+Sousaphone
// chart. [] for an ordinary tune with no V: lines of its own.
function findVoiceIds(text) {
  const ids = [];
  const seen = new Set();
  for (const line of text.split("\n")) {
    const m = /^V:\s*(\S+)/.exec(line);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  return ids;
}

// Voice ids that only ever show up as an inline "[V:n]" switch (big_chief.abc's
// kind) and never get their own whole-line "V:" declaration -- e.g. a tune
// that names V:1 in its header but steps into V:2 purely inline, or one that
// never declares any voice at all and interleaves "[V:1] ... [V:2] ..." from
// the very first body line. findVoiceIds alone misses these entirely, which
// left buildCompingTune free to hand the generated Comping voice an id one of
// them already has -- see its own call site below. In order of first
// appearance, like findVoiceIds.
function findInlineVoiceIds(text) {
  const ids = [];
  const seen = new Set();
  for (const line of text.split("\n")) {
    INLINE_VOICE_SWITCH.lastIndex = 0;
    let m;
    while ((m = INLINE_VOICE_SWITCH.exec(line)) !== null) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        ids.push(m[1]);
      }
    }
  }
  return ids;
}

// A voice switch inline in the music itself -- big_chief.abc's
// "[V:1] ... | [V:2] ... |", one per source line -- as opposed to
// honky_tonk_town_riffs.abc's own repeated whole-line "V: 1" / "V: 2"
// switches (matched separately in extractVoiceBody below).
const INLINE_VOICE_SWITCH = /\[V:\s*([^\]\s]+)\]/g;

// Split one body line into the runs it hands to each voice as `[V:n]`
// switches inline through it (there's normally just one, at the very start,
// but the general case can carry several). Returns `content` -- the pieces
// of the line that belong to `startVoice` before the first switch has run,
// then to whichever id `[V:n]` steps into as it does -- narrowed to only
// the runs that end up on `targetId`, and `endVoice`, the id active once the
// line ends (carried into the next line by the caller).
function extractInlineVoiceLine(line, targetId, startVoice) {
  let voice = startVoice;
  let pos = 0;
  let content = "";
  INLINE_VOICE_SWITCH.lastIndex = 0;
  let m;
  while ((m = INLINE_VOICE_SWITCH.exec(line)) !== null) {
    if (voice === targetId) content += line.slice(pos, m.index);
    voice = m[1];
    pos = m.index + m[0].length;
  }
  if (voice === targetId) content += line.slice(pos);
  return { content, endVoice: voice };
}

// Pull just `targetId`'s own music out of a tune whose body interleaves
// several voices' bars, either as repeated whole-line "V: 1" / "V: 2" /
// "V: 3" switches (honky_tonk_town_riffs.abc) or inline "[V:1] ... [V:2] ..."
// markers (big_chief.abc) -- this is what buildVoiceBody uses as the
// template for the comping voice's own bar-for-bar pattern, so it must carry
// only the target voice's barlines, never another voice's.
function extractVoiceBody(text, targetId) {
  const lines = text.split("\n");
  const kIdx = headerKLineIndex(lines);
  let current = null;
  const out = [];
  for (const [i, line] of lines.entries()) {
    const decl = /^V:\s*(\S+)/.exec(line);
    if (decl) {
      current = decl[1];
      continue;
    }
    if (i <= kIdx) continue;
    if (line.includes("[V:")) {
      const { content, endVoice } = extractInlineVoiceLine(line, targetId, current);
      current = endVoice;
      if (content) out.push(content);
    } else if (current === targetId) {
      out.push(line);
    }
  }
  return out.join("\n");
}

// Drop lyric / part / directive / stray-metadata lines so they can't be
// mistaken for note bars. `F:` matters here: a song whose only K: line is
// followed by an `F:` YouTube link (shake_that_thing, shame_shame_shame)
// leaves that URL sitting in the body, and its letters parse as a phantom
// leading bar that shoves the whole comping voice down a system.
const ALWAYS_STRIP = /^\s*(w:|W:|s:|P:|N:|O:|F:|I:|r:|%)/;

// `splitHeaderBody` splits on the K: line, so a tune that orders its
// header `K:` before `L:`/`M:`/`Q:` (all_of_me, isle_of_capri, jada order K:
// before L:) drops that field into the body. It carries no note letters on
// its own, but joined to the pickup segment below it (`L:1/4\nC/F/A/`) its
// newline reads as a mid-measure line break and wraps the comping's first
// bar onto the next system — so it must go. But `L:`/`M:`/`Q:` are also
// legitimate *mid-tune* fields (a real meter or unit-length change): once
// real music has started, the melody voice keeps such a field verbatim, and
// the comping voice must too, or its later bars fall out of step. Only strip
// them from the contiguous run of header leakage right after K:, never once
// music has begun.
const HEADER_LEAK = /^\s*(K:|L:|M:|Q:)/;

function stripNonMusicLines(body) {
  const lines = body.split("\n");
  let leadEnd = 0;
  while (leadEnd < lines.length && (ALWAYS_STRIP.test(lines[leadEnd]) || HEADER_LEAK.test(lines[leadEnd]))) {
    leadEnd++;
  }
  // A whole-line K: after the music has started is a key change: kept as an
  // inline [K:...] field so buildVoiceBody carries it onto the next bar.
  return lines
    .filter((line, i) => i >= leadEnd && !ALWAYS_STRIP.test(line))
    .map((line) => (/^\s*K:/.test(line) ? "[" + line.trim() + "]" : line))
    .join("\n");
}

// Barline tokens, longest match first so "|1", ":|2", "[|:", "[2" stay intact.
// Grouped by leading character (colon / bar / bracket) rather than left flat
// — same 12 forms, same priority within each group, but well under
// SonarCloud's regex-complexity threshold this way. Within the bar group,
// `\|\d+` must come before the optional-colon form: an unqualified `:?`
// would otherwise "succeed" on zero characters and misparse ":|2" as ":|"
// followed by a bare "2".
const COLON_BAR = String.raw`:(?:\|\d+|\|:?|:)`;
const PIPE_BAR = String.raw`\|(?:\|:?|:|\]|\d+)?`;
const BRACKET_BAR = String.raw`\[(?:\|:?|\d+(?:[-,]\d+)*)`;
const BARLINE = new RegExp(`${COLON_BAR}|${PIPE_BAR}|${BRACKET_BAR}`, "g");

/*
   Walk a melody body's barlines and, for every segment that carries notes,
   substitute the matching comping bar string. Barlines, repeats, volta
   brackets, inline [X:...] fields and line breaks are all kept verbatim, so
   the comping voice inherits the melody's exact structure and line wrapping.

   `leadingRestBars` note segments at the start (pickup / intro bars before
   the first chord) get `restToken` (a plain whole-bar rest) instead of
   consuming a pattern; so do any bars left once the patterns run out. When
   `lnum`/`lden` are given, a leading segment shorter than a full bar (a
   pickup) instead gets an invisible rest of its own measured length, so the
   comping voices stay bar-aligned with the melody.
*/
// Split a melody body into alternating note segments and barline tokens.
function splitAtBarlines(body) {
  const parts = [];
  let lastIdx = 0;
  let m;
  BARLINE.lastIndex = 0;
  while ((m = BARLINE.exec(body)) !== null) {
    parts.push({ bar: false, s: body.slice(lastIdx, m.index) }, { bar: true, s: m[0] });
    lastIdx = m.index + m[0].length;
  }
  parts.push({ bar: false, s: body.slice(lastIdx) });
  return parts;
}

// Whether a segment holds any note or rest once chord symbols, decorations
// and inline fields are stripped.
function carriesNotes(segment) {
  const stripped = segment
    .replace(/"[^"]*"/g, "")
    .replace(/![^!]*!/g, "")
    .replace(/\[[A-Za-z]:[^\]]*\]/g, "");
  return /[A-Ga-gxz]/.test(stripped);
}

// An invisible rest of a segment's own length when it is shorter than a full
// bar (a pickup or sub-bar stub), else null.
function subBarRest(segment, lnum, lden) {
  if (!lnum || !lden) return null;
  const slots = measureBarSlots(segment, lnum, lden);
  return slots > 0 && slots < 8 ? "x" + formatDuration(slots, lnum, lden) : null;
}

// What one note segment becomes in the comping voice, advancing the running
// `state` (pattern index, bars seen, the key in effect).
function segmentContent(segment, cfg, state) {
  const { barStrings, leadingRestBars, rest, lnum, lden, respellForKey } = cfg;
  const pastLead = state.seen >= leadingRestBars;
  const stub = pastLead ? subBarRest(segment, lnum, lden) : null;
  if (stub !== null) {
    // A sub-bar measure mid-tune — the `D2` anacrusis at the top of Bei Mir's
    // chorus, or any half-bar lead-in after a `||`. parseChordScheme still
    // emits a (continuation) chord measure for it, so step past that pattern
    // bar, but draw only an invisible rest of the melody's own length here so
    // the following barline stays aligned between the two staves. (A leading
    // pickup, `seen < leadingRestBars`, has no such phantom measure and is
    // handled by the measured rest below.)
    if (state.patternIdx < barStrings.length) state.patternIdx++;
    return { content: stub, isRest: true };
  }
  if (pastLead && state.patternIdx < barStrings.length) {
    const content = barStrings[state.patternIdx++];
    const respelled = state.currentKey && respellForKey ? respellForKey(content, state.currentKey) : content;
    return { content: respelled, isRest: false };
  }
  return { content: subBarRest(segment, lnum, lden) || rest, isRest: true };
}

// The comping text for one note segment: its leading whitespace and inline
// fields kept verbatim, then `content`.
function renderSegment(segment, fieldList, { content, isRest }, lnum, lden) {
  const leadWs = (segment.match(/^\s*/) || [""])[0];
  // A melody measure that straddles a source line break carries the newline
  // *inside* this note segment (e.g. "…| F\nFAB||:" once the P: line between
  // is stripped). Keep it, so the comping voice wraps its lines exactly where
  // the melody does and the two staves stay in step — otherwise the first
  // pattern bar rides up onto the previous system.
  const innerBreak = !leadWs.includes("\n") && segment.includes("\n");
  const inlineFields = fieldList.join(" ");
  const prefix = leadWs + (inlineFields ? inlineFields + " " : "");
  if (innerBreak && isRest && lnum && lden) {
    // The melody splits this measure across the line break; split the comping
    // rest at the same point (its slots before / after the newline) so the
    // barline that follows still lines up between the two staves.
    const nl = segment.indexOf("\n");
    const head = measureBarSlots(segment.slice(0, nl), lnum, lden);
    const tail = measureBarSlots(segment.slice(nl + 1), lnum, lden);
    if (head > 0 && tail > 0) {
      return prefix + "x" + formatDuration(head, lnum, lden) + "\nx" + formatDuration(tail, lnum, lden) + " ";
    }
  }
  return prefix + content + (innerBreak ? "\n" : " ");
}

export function buildVoiceBody(rawBody, barStrings, leadingRestBars, restToken, lnum, lden, respellForKey) {
  const cfg = { barStrings, leadingRestBars, rest: restToken || "x8", lnum, lden, respellForKey };
  const state = { patternIdx: 0, seen: 0, currentKey: null };
  let out = "";
  for (const p of splitAtBarlines(stripNonMusicLines(rawBody))) {
    if (p.bar || !carriesNotes(p.s)) {
      out += p.s;
      continue;
    }
    const fieldList = p.s.match(/\[[A-Za-z]:[^\]]*\]/g) || [];
    for (const f of fieldList) {
      if (f.startsWith("[K:")) state.currentKey = f.slice(3, -1).trim();
    }
    const segment = segmentContent(p.s, cfg, state);
    state.seen++;
    out += renderSegment(p.s, fieldList, segment, lnum, lden);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tonal-backed note math
// ---------------------------------------------------------------------------

// Undo parseChordScheme's cosmetic unicode so Tonal can read the chord. "Ø"
// (what "dim" becomes) is spelled "m7b5" rather than back to "dim": a written
// "AmØ" would otherwise become "Amdim", which Tonal can't read at all, and the
// triad falls back to C-C-C stacked over three octaves.
export function plainChordName(name) {
  return String(name)
    .replace(/♭/g, "b")
    .replace(/♯/g, "#")
    .replace(/Ø7/g, "dim7")
    .replace(/m?Ø/g, "m7b5")
    .trim();
}

const MODE_ALIASES = {
  "": "major", maj: "major", major: "major", m: "minor", min: "minor",
  minor: "minor", dor: "dorian", phr: "phrygian", lyd: "lydian",
  mix: "mixolydian", aeo: "aeolian", loc: "locrian",
};

export function keyScaleNotes(key) {
  const tonic = (key.root || "C") + (key.acc || "");
  const mode = MODE_ALIASES[String(key.mode || "").toLowerCase()] || "major";
  let notes = Tonal.Scale.get(tonic + " " + mode).notes;
  if (!notes.length) notes = Tonal.Scale.get(tonic + " major").notes;
  return notes;
}

/*
   The key signature as { letter: accidental } in ABC signs ("", "^", "_"),
   read straight off the (naturally spelled) scale notes — F major -> { B: "_",
   … }. Feeds respellBar so the comping only prints accidentals the key doesn't
   already imply.
*/
export function keySignature(keyScale) {
  const sig = {};
  for (const pc of keyScale) {
    const m = /^([A-G])([#b]*)$/.exec(String(pc));
    if (m) sig[m[1]] = m[2].replace(/#/g, "^").replace(/b/g, "_");
  }
  return sig;
}

// Pitch class -> chroma 0..11 (Tonal.Note.chroma isn't in the test stub).
export function pcChromaVal(pc) {
  const mid = Tonal.Note.midi(pc + "4");
  return mid == null ? 0 : ((mid % 12) + 12) % 12;
}

/*
   Move a pitch class `steps` diatonic scale steps along `keyScale`. A tone
   that isn't in the key is first snapped to the nearest scale degree (by
   pitch-class distance) so chromatic chord roots still plane sensibly.
*/
function scaleShift(pc, keyScale, steps) {
  if (!steps || !keyScale.length) return pc;
  let idx = keyScale.indexOf(pc);
  if (idx === -1) {
    const target = pcChromaVal(pc);
    let best = 0;
    let bestDist = 99;
    for (const [i, element] of keyScale.entries()) {
      const raw = Math.abs(pcChromaVal(element) - target);
      const dist = Math.min(raw, 12 - raw);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    idx = best;
  }
  const n = keyScale.length;
  return keyScale[(((idx + steps) % n) + n) % n];
}

/*
   Emit an ABC chord token "[low mid high]" from voiced chord tones
   ({ pc, oct }) in bottom-to-top order with the concrete octaves the
   voice-leading chose. Nothing is re-stacked here — the octaves are honoured
   as given, so the printed noteheads sit exactly where the voice-leading put
   them and each moves the shortest way from chord to chord. ABCjs tags the
   noteheads .abcjs-chord-pos-1/2/3 (up from the bottom) and
   sheet-decorations.js colours each by the matching voice's fn.
*/
function stackChord(voices) {
  const notes = voices.map((v) =>
    Tonal.AbcNotation.scientificToAbcNotation(v.pc + v.oct),
  );
  return "[" + notes.join("") + "]";
}

/*
   Lowest-cost octave for pitch class `pc` measured against a reference MIDI
   (the same voice's previous note) — i.e. the octave that moves the voice
   least.
*/
function nearestOctave(pc, refMidi) {
  let bestOct = 4;
  let bestDist = Infinity;
  for (let oct = 1; oct <= 7; oct++) {
    const midi = Tonal.Note.midi(pc + oct);
    if (midi == null) continue;
    const dist = Math.abs(midi - refMidi);
    if (dist < bestDist) {
      bestDist = dist;
      bestOct = oct;
    }
  }
  return bestOct;
}

/*
   Place pitch classes `pcs` (bottom-to-top voice order) into concrete octaves:
   each voice takes the octave nearest its reference MIDI `refMidis[i]`, then
   any voice sitting at or below the one under it is lifted by whole octaves.
   Result stays strictly ascending, so the voices never cross. Returns
   [{ pc, oct, midi }] bottom-to-top.
*/
function voiceNear(pcs, refMidis) {
  const placed = pcs.map((pc, i) => {
    const oct = nearestOctave(pc, refMidis[i]);
    const midi = Tonal.Note.midi(pc + oct);
    return { pc, oct, midi: midi == null ? refMidis[i] : midi };
  });
  for (let i = 1; i < placed.length; i++) {
    while (placed[i].midi <= placed[i - 1].midi) {
      placed[i].oct += 1;
      placed[i].midi += 12;
    }
  }
  return placed;
}

/*
   Stack `pcs` (already in the intended bottom-to-top order) as a *close*
   voicing: bottom note at `bottomOct`, every higher note dropped to its lowest
   octave still above the note below it. The whole chord then fits inside about
   an octave, whatever inversion `pcs` represents. Returns [{ pc, oct, midi }].
*/
function closeStack(pcs, bottomOct) {
  const out = [];
  for (const [i, pc] of pcs.entries()) {
    const prev = out[i - 1];
    let oct = i === 0 ? bottomOct : prev.oct - 1;
    let midi = Tonal.Note.midi(pc + oct);
    // Lift by whole octaves until this note clears the one below it. Bounded by
    // a fixed span so an unparseable pitch class can't spin forever.
    if (prev) {
      for (let lift = 0; lift < 12 && midi != null && midi <= prev.midi; lift++) {
        oct += 1;
        midi = Tonal.Note.midi(pc + oct);
      }
    }
    let resolvedMidi = midi;
    if (resolvedMidi == null) resolvedMidi = prev ? prev.midi + 4 : 60;
    out.push({ pc, oct, midi: resolvedMidi });
  }
  return out;
}

/*
   For a voiced triad ([{pc,fn,oct}] bottom-to-top), return [main, down1, up1,
   up2] as ABC chord tokens: the triad itself plus the whole triad planed
   one/one/two diatonic scale steps below/above, each re-voiced to stay near
   the main triad's register (and non-crossing). Planing keeps the voice
   order, so the colour order (voices.map(fn)) is the same for all four.
*/
function chordArgs(voices, keyScale) {
  const refMidis = voices.map((v) => {
    const m = Tonal.Note.midi(v.pc + v.oct);
    return m == null ? 60 : m;
  });
  const plane = (steps) => {
    if (steps === 0) return stackChord(voices);
    const pcs = voices.map((v) => scaleShift(v.pc, keyScale, steps));
    return stackChord(voiceNear(pcs, refMidis));
  };
  return [plane(0), plane(-1), plane(1), plane(2)];
}

// The three comping voices, low to high — keys into COMPING_FN_FILL
// (sheet-decorations.js), which paints them black / gold / red. They're drawn
// on a root-position chord in root / third / fifth colours, hence the labels,
// but the colour tracks the *voice* (the line), not the chord tone it lands
// on: after voice-leading the black voice may well be sitting on a fifth.
const VOICE_KEYS = ["R", "3", "5"];

/*
   Chord scheme -> per-bar arrays of plain chord names Tonal can read, or
   `null` for a break ("N.C.") slot. "%" / empty holds the previous chord, and
   a slash chord keeps only its upper part. `last` (the "%"-hold memory) is
   left untouched by a break, so a hold *after* one still continues whatever
   chord preceded the break, not "N.C." itself. Shared by the comping voice and
   the solo generator (lib/solo.js).
*/
export function resolveChordNames(chords) {
  let last = "C";
  return chords.map((measure) => measure.text.map((raw) => {
    if (raw === BREAK_CHORD) return null;
    let name = plainChordName(raw);
    if (name === "%" || name === "") name = last;
    name = name.split("/")[0];
    last = name;
    return name;
  }));
}

// Chord scheme -> per-bar arrays of triads, each triad [{pc}] root/3rd/5th
// first, or `null` for a break ("N.C.") slot — a deliberate silence the
// comping voice should rest through rather than hold the previous chord over.
function extractChordNotes(chords) {
  return resolveChordNames(chords).map((row) => row.map((name) => {
    if (name === null) return null;
    const notes = Tonal.Chord.get(name).notes.slice(0, 3);
    while (notes.length < 3) notes.push(notes[0] || "C");
    return notes.map((pc) => ({ pc }));
  }));
}

// The six ways to stack a triad's three tones: root position and its rotations.
const VOICE_PERMS = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2],
  [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

// Extra voice-leading cost charged when a chord change would reuse the previous
// chord's inversion (the same chord tone left in the bass). Planing a whole
// voicing up or down like that — parallel movement — is harmonically dull, so
// this tips the choice toward a different inversion whenever one is nearly as
// close. It's small enough that a genuinely isolated best voicing still wins.
const PARALLEL_INVERSION_PENALTY = 3;

// How far, each chord change, the running voice-leading reference is bled back
// toward the opening voicing (0 = never homes, 1 = snaps home every bar).
// Closest-inversion voice-leading has no memory of register: through a
// circle-of-fifths progression every change is cheapest as the inversion that
// nudges the whole stack one notch the same way, so the comping climbs (or
// sinks) bar after bar until the octave clamp snaps it back in one lurch. By
// scoring each new chord against a reference that itself drifts home, "least
// motion" keeps pulling the comping toward where it started — it wanders a
// little, then eases back, and the octave jump never builds up. Only chord
// changes home; a repeated chord still sits perfectly still.
const REGISTER_HOMING = 0.4;

// First chord: root position with the root at octave 4 (root / third / fifth
// bottom-to-top, roughly mid-staff). It leads off from this rather than being
// snapped to whatever inversion sits nearest an arbitrary seed.
function seedRefs(curr) {
  const m = Tonal.Note.midi(curr[0].pc + "4");
  const base = m == null ? 60 : m;
  return [base, base + 4, base + 7];
}

/*
   Per bar, voice-lead each chord from the previous one. For the incoming chord
   we try all six ways of ordering its three tones (root position + both
   inversions) x a few bottom octaves, build each as a *close* stack (all three
   notes within about an octave, `closeStack`), and keep the one whose shape is
   closest to the previous voicing — least total bottom/middle/top movement. So
   a chord is drawn in whichever tight inversion sits closest under the previous
   one, and because the metric is slot-by-slot the lines don't cross (a choice
   where the top drops while the middle climbs always costs more than the
   sensible one). The first chord leads off from its own root position.

   On a chord change we also charge `PARALLEL_INVERSION_PENALTY` against any
   candidate that keeps the previous chord's bass tone (the same inversion), so
   the generator re-inverts instead of planing the whole triad in parallel
   unless a same-inversion voicing is clearly the only close one. A repeated
   chord is exempt — there the same inversion means no motion at all.

   And on every chord change the reference the candidates are scored against is
   first bled `REGISTER_HOMING` of the way back toward the opening voicing, so
   "least motion" keeps tugging the comping home. Without it a circle-of-fifths
   tune (My Blue Heaven) climbs a step per bar until the octave clamp below
   snaps it back in one lurch; with it the comping drifts a little and eases
   back, staying mid-staff the whole tune. A repeated chord skips the homing
   and sits perfectly still.

   The three voices never cross, so voice = slot: the bottom line is always the
   black voice, the middle gold, the top red (`VOICE_KEYS` by slot index) —
   whatever chord tone each has drifted onto. G(black) B(gold) D(red) -> C7
   keeps black on G, walks gold B->C and red D->E.

   Returns extractChordNotes' shape with each { pc } re-ordered bottom-to-top
   as the chosen inversion placed it, tagged with its voice key and octave.
*/
// The midi target of each voice slot when leading into chord `curr`: seeded
// fresh the first time, pulled back toward home on a chord change, otherwise
// simply where the voices already are.
function leadRefs(curr, state, chordChanged) {
  if (!state.prevMidis) return seedRefs(curr);
  if (chordChanged) {
    return state.prevMidis.map((r, i) => r + REGISTER_HOMING * (state.homeRefs[i] - r));
  }
  return state.prevMidis;
}

// The cheapest inversion + octave placement of `curr` against `refs`;
// `penalisedBass` is the bass chord-tone a repeat of which counts as a
// parallel inversion (null when nothing is penalised).
function bestPlacement(curr, refs, penalisedBass) {
  let best = null;
  for (const perm of VOICE_PERMS) {
    const pcs = perm.map((ci) => curr[ci].pc);
    const baseOct = nearestOctave(pcs[0], refs[0]);
    for (const d of [-1, 0, 1]) {
      const placed = closeStack(pcs, baseOct + d);
      let cost = placed.reduce((sum, p, i) => sum + Math.abs(p.midi - refs[i]), 0);
      if (perm[0] === penalisedBass) cost += PARALLEL_INVERSION_PENALTY;
      if (!best || cost < best.cost) best = { perm, placed, cost };
    }
  }
  return best;
}

// Nudge back by an octave if the stack has drifted off the staff.
function staffShift(placed) {
  const staffCenter = (placed[0].midi + placed[placed.length - 1].midi) / 2;
  if (staffCenter < 55) return 12;
  return staffCenter > 78 ? -12 : 0;
}

// Voice-lead one real chord, updating the running `state` (the previous
// voicing, its bass tone and chord identity, and the home register).
function voiceLeadChord(curr, state) {
  if (!state.homeRefs) state.homeRefs = seedRefs(curr);
  const pcKey = curr.map((t) => t.pc).join(",");
  const chordChanged = state.prevPcKey !== null && pcKey !== state.prevPcKey;
  const refs = leadRefs(curr, state, chordChanged);
  const best = bestPlacement(curr, refs, chordChanged ? state.prevBassIdx : null);
  const shift = staffShift(best.placed);
  state.prevMidis = best.placed.map((p) => p.midi + shift);
  state.prevBassIdx = best.perm[0];
  state.prevPcKey = pcKey;
  return best.perm.map((ci, i) => ({
    pc: curr[ci].pc,
    fn: VOICE_KEYS[i],
    oct: best.placed[i].oct + shift / 12,
  }));
}

function voiceLead(bars) {
  const state = { prevMidis: null, prevBassIdx: null, prevPcKey: null, homeRefs: null };
  // A break ("N.C.") slot passes through untouched and leaves the voice-leading
  // memory alone, so the next real chord still leads on from before the silence.
  return bars.map((bar) => bar.map((curr) => (curr === null ? null : voiceLeadChord(curr, state))));
}

// The [ tokens in an ABC bar fragment == the chord onsets ABCjs will draw.
function countChords(fragment) {
  return (String(fragment).match(/\[/g) || []).length;
}

// A voiced triple's chord identity, order-independent (voice-leading can
// place the same chord in a different inversion than a naive repeat would).
// `null` (a break slot) and "no single chord this bar" both map to `null`,
// so either compares unequal to any real chord below.
function chordKey(triple) {
  return triple ? triple.map((v) => v.pc).sort().join(",") : null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// One comping bar fragment per chord-scheme bar, plus the colour order of each
// chord onset in it (see buildCompingTune's `palette`).
// Replace every "[low mid high]" chord token in a bar fragment with just its
// `part`-th note (0 = root voice, 1 = third voice, 2 = fifth voice — the
// bracket lists them bottom-to-top), keeping the duration and tie that follow
// it. Rests and everything else pass through untouched, so the result is the
// same rhythm played by one chord tone alone.
function pickChordNote(fragment, part) {
  let out = "";
  let i = 0;
  while (i < fragment.length) {
    const end = fragment[i] === "[" ? scanChordBracket(fragment, i) : -1;
    if (end === -1) {
      out += fragment[i];
      i += 1;
      continue;
    }
    const notes = [];
    let j = i + 1;
    let noteEnd = scanNoteLetter(fragment, j, CHORD_NOTE_LETTERS);
    while (noteEnd !== -1) {
      notes.push(fragment.slice(j, noteEnd));
      j = noteEnd;
      noteEnd = scanNoteLetter(fragment, j, CHORD_NOTE_LETTERS);
    }
    out += notes[part] || notes[notes.length - 1];
    i = end;
  }
  return out;
}

// A single chord-tone voice ties a note into the next one only when that next
// note is the same pitch: whole_note ties every chord into whatever follows,
// and once one voice is pulled out of the chord, a tie into a *different*
// pitch is drawn by abcjs as a deep slur while the voices that happen to hold
// their note get a shallow tie -- so the voices look unrelated. Strip the
// dash wherever the next note (in this bar or the next) differs or is a rest.
function dropCrossPitchTies(fragments) {
  const bars = fragments.map(tokenizeBar);
  const notes = bars.flat().filter((t) => !t.annotation);
  notes.forEach((tok, i) => {
    const next = notes[i + 1];
    if (tok.tie && !(next && !next.rest && next.pitch === tok.pitch)) tok.tie = false;
  });
  return bars.map((tokens) => tokens.map(formatSlotToken).join(" "));
}

function formatSlotToken(t) {
  if (t.annotation) return t.annotation;
  const dur = t.dur === 1 ? "" : t.dur;
  return t.pitch + dur + (t.tie ? "-" : "");
}

// A bar with a single chord slot: a plain rest for a break ("N.C."), else the
// pattern's two-bar template chosen by bar parity.
function oneChordBar(cb, bar, voiced, pat, keyScale) {
  if (cb[0] === null) return { fragment: "z8", barPalette: [] };
  const fn = bar % 2 === 0 ? pat.twobar1 : pat.twobar2;
  let fragment = fn(...chordArgs(cb[0], keyScale));
  // Templates that end in a bare tie (hold_over's twobar1) commit to holding the same chord into the next bar's first note.
  // When that bar actually changes chord -- the far more common case,
  // since the two-bar twobar1/twobar2 split is chosen by bar parity,
  // not by where the chord scheme actually repeats -- a literal "-"
  // ties into an unrelated pitch: abcjs still draws the arc, so it
  // reads as a tangle of tie lines running into the wrong chord.
  // Dropping the dash leaves a plain sustained whole bar instead.
  if (fragment.endsWith("-")) {
    const next = voiced[bar + 1];
    // A two-chord next bar still continues when its first half is the
    // same chord (that half is a plain held chord, so the tie lands).
    const continues = next && next[0] !== null && chordKey(next[0]) === chordKey(cb[0]);
    if (!continues) fragment = fragment.slice(0, -1);
  }
  const order = cb[0].map((v) => v.fn);
  return { fragment, barPalette: new Array(countChords(fragment)).fill(order) };
}

// The colour order of each chord tone in a voiced triple (none for a break).
function triplePalette(triple) {
  return triple === null ? [] : triple.map((v) => v.fn);
}

// A bar split in two halves, each its own chord (or a half-bar rest).
function twoChordBar(cb, bar, pat, keyScale) {
  const odd = bar % 2 === 1;
  const halfA = (odd && pat.halfOdd) || pat.half;
  const halfB = (odd && pat.half2Odd) || pat.half2 || pat.half;
  const fragA = cb[0] === null ? "z4" : halfA(...chordArgs(cb[0], keyScale));
  const fragB = cb[1] === null ? "z4" : halfB(...chordArgs(cb[1], keyScale));
  const barPalette = new Array(countChords(fragA)).fill(triplePalette(cb[0]))
    .concat(new Array(countChords(fragB)).fill(triplePalette(cb[1])));
  return { fragment: fragA + " " + fragB, barPalette };
}

// A bar with three or more chords: the bar's eighths shared out evenly, one
// plain chord (or rest) each.
function manyChordBar(cb, keyScale) {
  const durs = distribute(8, cb.length);
  const fragment = cb
    .map((triple, i) => (triple === null ? "z" + durs[i] : chordArgs(triple, keyScale)[0] + durs[i]))
    .join(" ");
  return { fragment, barPalette: cb.map(triplePalette) };
}

// `part` (0-2, or null for the ordinary block-chord voice) narrows every
// chord to that one voice — see pickChordNote — before respelling, so the
// accidental bookkeeping only sees the notes that voice actually plays.
function compingBars(chords, pat, { keyScale, keySig, lnum, lden }, part = null) {
  const voiced = voiceLead(extractChordNotes(chords));

  // One comping voice: each pattern slot is a block chord "[low mid high]".
  // compBars[i] is bar i's ABC fragment; compPalettes[i] is a colour order
  // (["R","3","5"] bottom-to-top) per chord onset in that fragment. A `null`
  // triple is a break ("N.C.") slot: it draws a plain rest and contributes no
  // palette entries (a rest draws no notehead onset for sheet-decorations.js).
  let fragments = [];
  const compPalettes = [];
  voiced.forEach((cb, bar) => {
    let built;
    if (cb.length === 1) built = oneChordBar(cb, bar, voiced, pat, keyScale);
    else if (cb.length === 2) built = twoChordBar(cb, bar, pat, keyScale);
    else built = manyChordBar(cb, keyScale);
    fragments.push(part === null ? built.fragment : pickChordNote(built.fragment, part));
    compPalettes.push(built.barPalette);
  });
  if (part !== null) fragments = dropCrossPitchTies(fragments);
  const compBars = fragments.map((f) => rebeamBar(respellBar(f, keySig), lnum, lden));
  return { compBars, compPalettes };
}

/*
   Append one generated voice to a tune, bar for bar with its melody.

   Parameters:
     text     - the ABC string about to be rendered (already clef-adjusted for
                the instrument), parsed by the caller at visualTranspose 0 so
                the chords/key below are in concert pitch. The single
                visualTranspose the caller passes to ABCjs.renderAbc then
                transposes melody and appended voices together. It may already
                carry an appended voice (Comping, then Solo on top of it).
     song     - the ABCjs parseOnly tune (concert pitch).
     makeBars - ({ keyScale, keySig, lnum, lden }) => string[] | null: one ABC
                fragment per chord-scheme bar (8 eighth slots each), or null
                when the voice can't be built.
     voice    - { name, titleSuffix }: the V: name="..." text as written in
                ABC, and what to append to the T: line ("" for nothing).

   `song` is always read from the tune's first voice (parseChordScheme and the
   key lookup below both key off `staff[0]`), so the generated voice always
   tracks whatever V:1 is doing — the tune's only melody line for an ordinary
   tune, or the first declared voice of a multi-voice chart, whether its
   voices are woven line-by-line via repeated whole-line "V: 1" / "V: 2"
   switches (honky_tonk_town_riffs.abc's Root line) or inline "[V:1] ... |
   [V:2] ... |" markers (big_chief.abc's Trumpet line) — see extractVoiceBody.
   The voice is appended as voice N+1, one past however many voices (N) the
   tune already declares (N=1, with no "V:" of its own, for an ordinary tune)
   — never a hardcoded V:2 — so lib/audio-mix.js's resolveMixerVoices (which
   already models this general N+1 shape) and this generator agree. Its own
   doc comment covers the two different ways the Mixer panel depends on that:
   computeVoicesOff mutes by ABCjs voice index, and injectMixerAudio scopes
   each voice's %%MIDI program (Voice picker) to right after that voice's own
   first declaration line.

   Returns the augmented ABC, or null when the voice can't apply (an
   unsupported meter, no K: line, no bars).
*/
// Every voice id the tune names: whole-line "V:" declarations first, then
// any that are only ever switched into inline.
//
// findVoiceIds alone only sees a whole-line "V:" declaration -- a voice
// that's only ever switched into inline (findInlineVoiceIds) is just as
// real and just as much a collision risk for the id nextVoiceId is about
// to hand the generated Comping voice, so both are merged before that
// allocation runs. Declared ids come first so voiceIds[0] still means "the
// tune's own first/melody voice" even when it's undeclared and only ever
// named inline (a tune with no "V:" line at all, interleaving
// "[V:1] ... [V:2] ..." from its very first body line).
function collectVoiceIds(text) {
  const declared = findVoiceIds(text);
  const inline = findInlineVoiceIds(text).filter((id) => !declared.includes(id));
  return [...declared, ...inline];
}

// A mid-tune K: change re-spells each comping bar for the key in effect.
function makeRespellForKey(keySig) {
  return (bar, keyField) => {
    const m = /^([A-G])([#b]?)\s*([A-Za-z]*)/.exec(keyField);
    if (!m) return bar;
    const sig = keySignature(keyScaleNotes({ root: m[1], acc: m[2], mode: m[3] }));
    return respellBar(explicitBar(bar, keySig), sig);
  };
}

// The tune's header with its own L: dropped (re-added for the comping unit),
// the title tagged, and the %%score / %%staves layout line set aside.
function rewriteHeader(header, lnum, lden, titleSuffix) {
  const headerOut = [];
  let layoutLine = null;
  for (const line of header) {
    if (line.startsWith("L:")) continue;
    if (/^%%(score|staves)\b/.test(line)) {
      layoutLine = line;
      continue;
    }
    headerOut.push(line.startsWith("T:") ? line + titleSuffix : line);
  }
  headerOut.push("L:" + lnum + "/" + lden);
  return { headerOut, layoutLine };
}

// Stitch header, the tune's own body and the generated voice into one tune.
function assembleTune({ headerOut, layoutLine, split, explicitVoices, newVoiceId, voice, compBody, clefSuffix }) {
  // Stacked 5 / 3 / R label at the staff's left, naming the chord tones the
  // three notehead colours pick out (fifth / third / root, top to bottom —
  // the label's own stacking order mirrors the notes' vertical stacking in
  // the chord, root at the bottom).
  const compingVoiceLine = "V:" + newVoiceId + " name=\"" + voice.name + "\"" + clefSuffix;
  const existingBody = split.body.trimEnd();
  if (!explicitVoices) {
    // %%staves (not %%score) so ABCjs draws the barlines connecting the
    // melody staff to the comping staff — they read as one system. The
    // bracket [ ] groups them.
    headerOut.push("%%staves [1 2]", "V:1", compingVoiceLine, split.kLine);
    return headerOut.join("\n") + "\nV:1\n" + existingBody + "\nV:2\n" + compBody + "\n";
  }
  // The tune already declares its own voice(s) — inside the body itself
  // for honky_tonk_town_riffs.abc, which puts them right after K:. Leave
  // all of that untouched and simply append the new voice, declaring it
  // (name="...") the first and only time it's used, same as any of the
  // tune's own voices would.
  // A chart that already lays out its own staves (bracing/grouping a brass
  // section, say) keeps that layout verbatim — the new comping voice is
  // just tacked on the end as its own ungrouped staff, same as it would be
  // appended to the voice declarations themselves, rather than losing the
  // tune's own grouping outright the way stripping-and-not-replacing would.
  // abcjs only draws a multi-staff bracket correctly (it otherwise collapses
  // onto the last staff) when the layout line precedes the "V:" declarations.
  if (layoutLine) {
    const at = headerOut.findIndex((line) => line.startsWith("V:"));
    headerOut.splice(at === -1 ? headerOut.length : at, 0, extendLayout(layoutLine.trimEnd(), newVoiceId, voice.joinBracket));
  }
  headerOut.push(split.kLine);
  return headerOut.join("\n") + "\n" + existingBody + "\n" + compingVoiceLine + "\n" + compBody + "\n";
}

export function appendBarVoice(text, song, makeBars, voice) {
  if (!song || !song.lines || !song.lines[0] || !song.lines[0].staff) return null;

  const meter = readMeter(text);
  if (!meter) return null;

  const split = splitHeaderBody(text);
  if (!split) return null;

  const [lnum, lden] = readUnit(text);
  const key = song.lines[0].staff[0].key || { root: "C", acc: "", mode: "" };
  const keyScale = keyScaleNotes(key);
  const keySig = keySignature(keyScale);

  const voiceIds = collectVoiceIds(text);
  const explicitVoices = voiceIds.length > 0;
  // An ordinary tune has no "V:" of its own, but always ends up as V:1 below
  // (the synthesized "%%staves [1 2]\nV:1\n..." block), so that's the id to
  // avoid colliding with here even though voiceIds found nothing.
  const newVoiceId = nextVoiceId(explicitVoices ? voiceIds : ["1"]);
  // The body a tune with its own voices interleaves per system -- repeated
  // whole-line "V: 1" / "V: 2" / "V: 3" switches (honky_tonk_town_riffs.abc)
  // or inline "[V:1] ... [V:2] ..." markers (big_chief.abc) -- must be
  // narrowed to just V:1's own bars before it can serve as buildVoiceBody's
  // bar-for-bar template below; a tune that only ever declared its one voice
  // once (in the header, before K:) already has a body that's entirely that
  // voice's.
  const bodyHasVoiceSwitches = /^V:\s*\S+/m.test(split.body) || /\[V:/.test(split.body);
  const patternSourceBody = explicitVoices && bodyHasVoiceSwitches
    ? extractVoiceBody(text, voiceIds[0])
    : split.body;

  const compBars = makeBars({ keyScale, keySig, lnum, lden });
  if (!compBars) return null;

  // Invisible rest: keeps the comping voice bar-aligned with the melody
  // through pickup / intro / tail bars without drawing anything.
  const restToken = "x" + formatDuration(8, lnum, lden);
  const compBody = buildVoiceBody(
    patternSourceBody, compBars, computeChordOffset(song) || 0, restToken, lnum, lden, makeRespellForKey(keySig),
  ).trim();
  const { headerOut, layoutLine } = rewriteHeader(split.header, lnum, lden, voice.titleSuffix);
  const clefSuffix = /clef\s*=\s*bass/.test(split.kLine) ? " clef=bass middle=D" : "";
  return assembleTune({ headerOut, layoutLine, split, explicitVoices, newVoiceId, voice, compBody, clefSuffix });
}

// Add `id` to a "%%staves" line: tacked on after it as its own ungrouped
// staff, or (`joinBracket`, for the split comping voices) inside its closing
// bracket so every chord-tone staff sits in the same group as the first.
function extendLayout(line, id, joinBracket) {
  if (joinBracket && line.endsWith("]")) return line.slice(0, -1) + " " + id + "]";
  return line + " " + id;
}

/*
   Build the comping tune.

   `chords` is parseChordScheme(song) output (concert pitch); `pattern` a
   COMPING_PATTERNS value. See appendBarVoice for `text` and `song`.

   Returns { abc, palette }, or null when comping can't apply (no chords, an
   unsupported meter, no K: line):
     abc     - the augmented ABC (all the tune's own voices untouched, plus one
               new block-chord comping voice appended as N+1)
     palette - one entry per chord onset ABCjs will draw in the comping voice,
               in reading order: the voice key (black / gold / red) of each
               notehead bottom-to-top. The voices never cross so every entry is
               ["R","3","5"] as it stands, but it's kept per-onset rather than
               assumed so sheet-decorations.js — which zips it against the
               rendered noteheads and tie arcs — stays correct regardless.
*/
export function buildCompingTune(text, chords, song, pattern, parts = null) {
  const pat = PATTERNS[pattern];
  if (!pat || !chords || !chords.length) return null;
  if (parts && parts.length) return buildSplitCompingTune(text, chords, song, pat, pattern, parts);
  let palettes = [];
  const abc = appendBarVoice(text, song, (layout) => {
    const { compBars, compPalettes } = compingBars(chords, pat, layout);
    // appendBarVoice consumes compBars in order (leading/tail bars use the
    // plain rest), so the drawn chord onsets are compPalettes flattened in
    // bar order.
    palettes = compPalettes.flat();
    return compBars;
  }, {
    // Stacked 5 / 3 / R label at the staff's left, naming the chord tones the
    // three notehead colours pick out (fifth / third / root, top to bottom).
    name: String.raw`5\n3\nR`,
    titleSuffix: "  (comping \u2013 " + (PATTERN_LABEL[pattern] || pattern) + ")",
  });
  return abc === null ? null : { abc, palette: palettes };
}

/*
   The split flavour of the comping tune: instead of one staff of block
   chords, one single-note staff per entry of `parts` (indices into R / 3 / 5,
   ascending), appended one after another like any other generated voice. A
   subset — say just the 3 and the 5 — gives sheet music for only those
   voices. Returns { abc, palette: [], parts: ["3", "5"] }, or null when the
   voice can't apply (see appendBarVoice).
*/
function buildSplitCompingTune(text, chords, song, pat, pattern, parts) {
  const names = parts.map((p) => VOICE_KEYS[p]);
  const suffix = "  (comping \u2013 " + (PATTERN_LABEL[pattern] || pattern) + ": " + names.join(" + ") + ")";
  let abc = text;
  for (let i = 0; i < parts.length && abc !== null; i++) {
    abc = appendBarVoice(abc, song, (layout) => compingBars(chords, pat, layout, parts[i]).compBars, {
      name: names[i],
      titleSuffix: i === 0 ? suffix : "",
      joinBracket: i > 0,
    });
  }
  return abc === null ? null : { abc, palette: [], parts: names };
}
