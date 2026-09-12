import { computeChordOffset, BREAK_CHORD } from "./chords.js";
import { nextVoiceId } from "./voice-id.js";

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
  },
  hold_over: {
    twobar1: (n) => `${n}8-`,
    twobar2: (n) => `${n}6 z2`,
    half: (n) => `${n}4`,
  },
  hit_and_hold: {
    twobar1: (n) => `${n} z z ${n}-${n}4`,
    twobar2: (n) => `${n} z z ${n}-${n}4`,
    half: (n) => `${n} z z ${n}`,
  },
  double_hit: {
    twobar1: (n) => `${n} ${n} z2 z4`,
    twobar2: (n) => `${n} ${n} z ${n} z ${n}3`,
    half: (n) => `${n} ${n} z2`,
  },
  whole_note: {
    twobar1: (n) => `${n}8-`,
    twobar2: (n) => `${n}8`,
    half: (n) => `${n}4`,
  },
  walk_down_a: {
    twobar1: (n) => `${n} z z ${n}-${n}2 z2`,
    twobar2: (n, nd) => `${n} ${n} ${nd} ${n} z4`,
    half: (n) => `${n} z z ${n}`,
  },
  walk_down_b: {
    twobar1: (n, nd) => `z2 ${n} z ${nd} ${n}2 ${nd}`,
    twobar2: (n, nd) => `${n} ${n} ${nd} ${n} z4`,
    half: (n) => `z2 ${n} z`,
  },
  whole_then_step: {
    twobar1: (n) => `${n}8`,
    twobar2: (n, nd) => `${nd} z z ${nd} z4`,
    half: (n) => `${n}4`,
  },
  walk_eighths: {
    twobar1: (n, nd) => `${n} ${n} ${nd} ${nd} ${n} ${n} ${nd} ${nd}`,
    twobar2: (n) => `${n} z z ${n}-${n}4`,
    half: (n, nd) => `${n} ${n} ${nd} ${nd}`,
  },
  cross_step: {
    twobar1: (n) => `z2 ${n} z z ${n} z2`,
    twobar2: (n, nd, nu) => `${n} z z ${n}-${n} ${nu} ${nd} z`,
    half: (n) => `z2 ${n} z`,
  },
  step_approach: {
    twobar1: (n, nd, nu) => `${n} ${nd} z2 ${nu} ${nd} z2`,
    twobar2: (n, nd, nu) => `${nu}3 ${nd} z4`,
    half: (n, nd) => `${n} ${nd} z2`,
  },
  double_then_step: {
    twobar1: (n) => `${n} ${n} z2 ${n} ${n} z2`,
    twobar2: (n, nd, nu) => `${n} z ${nu} ${nd} z4`,
    half: (n) => `${n} ${n} z2`,
  },
  full_walk: {
    twobar1: (n, nd, nu) => `${n} ${n} ${nd} ${n} ${nu} ${n} ${nd} ${n}`,
    twobar2: (n, nd) => `${nd} z z ${n}-${n}4`,
    half: (n, nd) => `${n} ${n} ${nd} ${n}`,
  },
  third_approach: {
    twobar1: (n, nd) => `${n} ${nd} z ${nd}-${n}4`,
    twobar2: (n, nd, nu, nu2) => `${nu2} ${nd} z ${nd}-${n}4`,
    half: (n, nd) => `${n} ${nd} z ${nd}`,
  },
  step_neighbor: {
    twobar1: (n, nd, nu) => `${n} ${nd} z ${nu}-${n}4`,
    twobar2: (n, nd, nu) => `${n} ${nd} z ${nu} z ${n}3`,
    half: (n, nd, nu) => `${n} ${nd} z ${nu}`,
  },
};

const GROUP_BASE = "Base patterns";
const GROUP_STEP_DOWN = "Step down";
const GROUP_STEP_UP_DOWN = "Step up & down";

// Ordered list for the sheet's <select>, grouped like the prototype's optgroups.
export const COMPING_PATTERNS = [
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
    const isField = str[i] === "[" && /[A-Za-z]/.test(str[i + 1] ?? "") && str[i + 2] === ":";
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

export function respellBar(fragment, keySig) {
  const barAcc = new Map();
  return String(fragment).replaceAll(/\[[_^=A-Ga-g,']+\]/g, (chord) => {
    const rebuilt = [];
    for (const [, acc, letterRaw, oct] of chord
      .slice(1, -1)
      .matchAll(/([_^=]{0,2})([A-Ga-g])([,']{0,4})/g)) {
      const letterOct = letterRaw + oct;
      const letter = letterRaw.toUpperCase();
      // Tonal never writes `=`; a bare note means natural.
      const want = acc.replaceAll("=", "");
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
    return "[" + rebuilt.join("") + "]";
  });
}

// Spread `total` eighth slots across `parts` notes as evenly as possible.
function distribute(total, parts) {
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

function lastKLineIndex(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("K:")) return i;
  }
  return -1;
}

/*
   Split an ABC tune string into { header, kLine, body }: header is every line
   before the last K: line, body is everything after it. Returns null when
   there is no K: line to split on.
*/
function splitHeaderBody(text) {
  const lines = text.split("\n");
  const kIdx = lastKLineIndex(lines);
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
  const kIdx = lastKLineIndex(lines);
  let current = null;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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

// `splitHeaderBody` splits on the *last* K: line, so a tune that orders its
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
const HEADER_LEAK = /^\s*(L:|M:|Q:)/;

function stripNonMusicLines(body) {
  const lines = body.split("\n");
  let leadEnd = 0;
  while (leadEnd < lines.length && (ALWAYS_STRIP.test(lines[leadEnd]) || HEADER_LEAK.test(lines[leadEnd]))) {
    leadEnd++;
  }
  return lines
    .filter((line, i) => i >= leadEnd && !ALWAYS_STRIP.test(line))
    .join("\n");
}

// Barline tokens, longest match first so "|1", ":|2", "[|:", "[2" stay intact.
// Grouped by leading character (colon / bar / bracket) rather than left flat
// — same 12 forms, same priority within each group, but well under
// SonarCloud's regex-complexity threshold this way. Within the bar group,
// `\|\d+` must come before the optional-colon form: an unqualified `:?`
// would otherwise "succeed" on zero characters and misparse ":|2" as ":|"
// followed by a bare "2".
const BARLINE = /:(?:\|\d+|\|:?|:)|\|(?:\|:?|:|\]|\d+)?|\[(?:\|:?|\d+(?:[-,]\d+)*)/g;

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
export function buildVoiceBody(rawBody, barStrings, leadingRestBars, restToken, lnum, lden) {
  const rest = restToken || "x8";
  const body = stripNonMusicLines(rawBody);
  const parts = [];
  let lastIdx = 0;
  let m;
  BARLINE.lastIndex = 0;
  while ((m = BARLINE.exec(body)) !== null) {
    parts.push({ bar: false, s: body.slice(lastIdx, m.index) });
    parts.push({ bar: true, s: m[0] });
    lastIdx = m.index + m[0].length;
  }
  parts.push({ bar: false, s: body.slice(lastIdx) });

  let patternIdx = 0;
  let seen = 0;
  let out = "";
  for (const p of parts) {
    if (p.bar) {
      out += p.s;
      continue;
    }
    const stripped = p.s
      .replace(/"[^"]*"/g, "")
      .replace(/![^!]*!/g, "")
      .replace(/\[[A-Za-z]:[^\]]*\]/g, "");
    if (!/[A-Ga-gxz]/.test(stripped)) {
      out += p.s;
      continue;
    }
    const inlineFields = (p.s.match(/\[[A-Za-z]:[^\]]*\]/g) || []).join(" ");
    const leadWs = (p.s.match(/^\s*/) || [""])[0];
    // A melody measure that straddles a source line break carries the newline
    // *inside* this note segment (e.g. "…| F\nFAB||:" once the P: line between
    // is stripped). Keep it, so the comping voice wraps its lines exactly where
    // the melody does and the two staves stay in step — otherwise the first
    // pattern bar rides up onto the previous system.
    const innerBreak = !leadWs.includes("\n") && p.s.includes("\n");
    const measuredRest = (segment) => {
      if (lnum && lden) {
        const slots = measureBarSlots(segment, lnum, lden);
        if (slots > 0 && slots < 8) return "x" + formatDuration(slots, lnum, lden);
      }
      return rest;
    };
    let content;
    let contentIsRest = false;
    const stubSlots =
      seen >= leadingRestBars && lnum && lden ? measureBarSlots(p.s, lnum, lden) : 0;
    if (stubSlots > 0 && stubSlots < 8) {
      // A sub-bar measure mid-tune — the `D2` anacrusis at the top of Bei Mir's
      // chorus, or any half-bar lead-in after a `||`. parseChordScheme still
      // emits a (continuation) chord measure for it, so step past that pattern
      // bar, but draw only an invisible rest of the melody's own length here so
      // the following barline stays aligned between the two staves. (A leading
      // pickup, `seen < leadingRestBars`, has no such phantom measure and is
      // handled by measuredRest below.)
      if (patternIdx < barStrings.length) patternIdx++;
      content = "x" + formatDuration(stubSlots, lnum, lden);
      contentIsRest = true;
    } else if (seen >= leadingRestBars && patternIdx < barStrings.length) {
      content = barStrings[patternIdx++];
    } else {
      content = measuredRest(p.s);
      contentIsRest = true;
    }
    seen++;
    const prefix = leadWs + (inlineFields ? inlineFields + " " : "");
    if (innerBreak && contentIsRest && lnum && lden) {
      // The melody splits this measure across the line break; split the comping
      // rest at the same point (its slots before / after the newline) so the
      // barline that follows still lines up between the two staves.
      const nl = p.s.indexOf("\n");
      const head = measureBarSlots(p.s.slice(0, nl), lnum, lden);
      const tail = measureBarSlots(p.s.slice(nl + 1), lnum, lden);
      if (head > 0 && tail > 0) {
        out += prefix +
          "x" + formatDuration(head, lnum, lden) + "\n" +
          "x" + formatDuration(tail, lnum, lden) + " ";
        continue;
      }
    }
    out += prefix + content + (innerBreak ? "\n" : " ");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tonal-backed note math
// ---------------------------------------------------------------------------

// Undo parseChordScheme's cosmetic unicode so Tonal can read the chord.
function plainChordName(name) {
  return String(name)
    .replace(/♭/g, "b")
    .replace(/♯/g, "#")
    .replace(/Ø/g, "dim")
    .trim();
}

const MODE_ALIASES = {
  "": "major", maj: "major", major: "major", m: "minor", min: "minor",
  minor: "minor", dor: "dorian", phr: "phrygian", lyd: "lydian",
  mix: "mixolydian", aeo: "aeolian", loc: "locrian",
};

function keyScaleNotes(key) {
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
function keySignature(keyScale) {
  const sig = {};
  for (const pc of keyScale) {
    const m = /^([A-G])([#b]*)$/.exec(String(pc));
    if (m) sig[m[1]] = m[2].replaceAll("#", "^").replaceAll("b", "_");
  }
  return sig;
}

// Pitch class -> chroma 0..11 (Tonal.Note.chroma isn't in the test stub).
function pcChromaVal(pc) {
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
    for (let i = 0; i < keyScale.length; i++) {
      const raw = Math.abs(pcChromaVal(keyScale[i]) - target);
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
  for (let i = 0; i < pcs.length; i++) {
    const prev = out[i - 1];
    let oct = i === 0 ? bottomOct : prev.oct - 1;
    let midi = Tonal.Note.midi(pcs[i] + oct);
    // Lift by whole octaves until this note clears the one below it. Bounded by
    // a fixed span so an unparseable pitch class can't spin forever.
    if (prev) {
      for (let lift = 0; lift < 12 && midi != null && midi <= prev.midi; lift++) {
        oct += 1;
        midi = Tonal.Note.midi(pcs[i] + oct);
      }
    }
    let resolvedMidi = midi;
    if (resolvedMidi == null) resolvedMidi = prev ? prev.midi + 4 : 60;
    out.push({ pc: pcs[i], oct, midi: resolvedMidi });
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

// Chord scheme -> per-bar arrays of triads, each triad [{pc}] root/3rd/5th
// first, or `null` for a break ("N.C.") slot — a deliberate silence the
// comping voice should rest through rather than hold the previous chord
// over. `last` (the "%"-hold memory) is left untouched by a break, so a
// hold *after* one still continues whatever chord preceded the break, not
// "N.C." itself.
function extractChordNotes(chords) {
  const result = [];
  let last = "C";
  for (const measure of chords) {
    const row = [];
    for (const raw of measure.text) {
      if (raw === BREAK_CHORD) {
        row.push(null);
        continue;
      }
      let name = plainChordName(raw);
      if (name === "%" || name === "") name = last;
      name = name.split("/")[0];
      last = name;
      const notes = Tonal.Chord.get(name).notes.slice(0, 3);
      while (notes.length < 3) notes.push(notes[0] || "C");
      row.push(notes.map((pc) => ({ pc })));
    }
    result.push(row);
  }
  return result;
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
function voiceLead(bars) {
  let prevMidis = null;
  let prevBassIdx = null;
  let prevPcKey = null;
  let homeRefs = null;
  const out = [];
  for (const bar of bars) {
    const voicedBar = [];
    for (const curr of bar) {
      // A break ("N.C.") slot: pass the rest through untouched, and leave
      // the voice-leading memory alone so the next real chord still leads
      // on from whatever came before the silence.
      if (curr === null) {
        voicedBar.push(null);
        continue;
      }
      if (!homeRefs) homeRefs = seedRefs(curr);
      const pcKey = curr.map((t) => t.pc).join(",");
      const chordChanged = prevPcKey !== null && pcKey !== prevPcKey;
      let refs;
      if (!prevMidis) {
        refs = seedRefs(curr);
      } else if (chordChanged) {
        refs = prevMidis.map((r, i) => r + REGISTER_HOMING * (homeRefs[i] - r));
      } else {
        refs = prevMidis;
      }
      let best = null;
      for (const perm of VOICE_PERMS) {
        const pcs = perm.map((ci) => curr[ci].pc);
        const baseOct = nearestOctave(pcs[0], refs[0]);
        for (const d of [-1, 0, 1]) {
          const placed = closeStack(pcs, baseOct + d);
          let cost = placed.reduce(
            (sum, p, i) => sum + Math.abs(p.midi - refs[i]),
            0,
          );
          if (chordChanged && perm[0] === prevBassIdx) {
            cost += PARALLEL_INVERSION_PENALTY;
          }
          if (!best || cost < best.cost) best = { perm, placed, cost };
        }
      }
      // Nudge back by an octave if the stack has drifted off the staff.
      const lo = best.placed[0].midi;
      const hi = best.placed.at(-1).midi;
      const staffCenter = (lo + hi) / 2;
      let shift = 0;
      if (staffCenter < 55) shift = 12;
      else if (staffCenter > 78) shift = -12;
      const pick = best.perm.map((ci, i) => ({
        pc: curr[ci].pc,
        fn: VOICE_KEYS[i],
        oct: best.placed[i].oct + shift / 12,
      }));
      voicedBar.push(pick);
      prevMidis = best.placed.map((p) => p.midi + shift);
      prevBassIdx = best.perm[0];
      prevPcKey = pcKey;
    }
    out.push(voicedBar);
  }
  return out;
}

// The [ tokens in an ABC bar fragment == the chord onsets ABCjs will draw.
function countChords(fragment) {
  return (String(fragment).match(/\[/g) || []).length;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/*
   Build the comping tune.

   Parameters:
     text   - the ABC string about to be rendered (already clef-adjusted for
              the instrument), parsed by the caller at visualTranspose 0 so
              the chords/key below are in concert pitch. The single
              visualTranspose the caller passes to ABCjs.renderAbc then
              transposes melody and comping together.
     chords - parseChordScheme(song) output (concert pitch).
     song   - the ABCjs parseOnly tune (concert pitch).
     pattern- a COMPING_PATTERNS value.

   `chords`/`song` are always read from the tune's first voice (parseChordScheme
   and the key lookup below both key off `staff[0]`), so the generated pattern
   always tracks whatever V:1 is doing — the tune's only melody line for an
   ordinary tune, or the first declared voice of a multi-voice chart, whether
   its voices are woven line-by-line via repeated whole-line "V: 1" / "V: 2"
   switches (honky_tonk_town_riffs.abc's Root line) or inline "[V:1] ... |
   [V:2] ... |" markers (big_chief.abc's Trumpet line) — see extractVoiceBody.
   The comping voice is appended as voice N+1, one past however many voices
   (N) the tune already declares (N=1, with no "V:" of its own, for an
   ordinary tune) — never a hardcoded V:2 — so lib/audio-mix.js's
   resolveMixerVoices (which already models this general N+1 shape) and this
   generator now agree. Its own doc comment covers the two different ways the
   Mixer panel depends on that: computeVoicesOff mutes by ABCjs voice index,
   and injectMixerAudio scopes each voice's %%MIDI program (Voice picker) to
   right after that voice's own first declaration line.

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
export function buildCompingTune(text, chords, song, pattern) {
  const pat = PATTERNS[pattern];
  if (!pat) return null;
  if (!chords || !chords.length) return null;
  if (!song || !song.lines || !song.lines[0] || !song.lines[0].staff) return null;

  const meter = readMeter(text);
  if (!meter) return null;

  const split = splitHeaderBody(text);
  if (!split) return null;

  const [lnum, lden] = readUnit(text);
  const key = song.lines[0].staff[0].key || { root: "C", acc: "", mode: "" };
  const keyScale = keyScaleNotes(key);
  const keySig = keySignature(keyScale);
  const bassClef = /clef\s*=\s*bass/.test(split.kLine);

  // findVoiceIds alone only sees a whole-line "V:" declaration -- a voice
  // that's only ever switched into inline (findInlineVoiceIds) is just as
  // real and just as much a collision risk for the id nextVoiceId is about
  // to hand the generated Comping voice, so both are merged before that
  // allocation runs. Declared ids come first so voiceIds[0] below still
  // means "the tune's own first/melody voice" even when it's undeclared and
  // only ever named inline (a tune with no "V:" line at all, interleaving
  // "[V:1] ... [V:2] ..." from its very first body line).
  const declaredVoiceIds = findVoiceIds(text);
  const inlineVoiceIds = findInlineVoiceIds(text).filter((id) => !declaredVoiceIds.includes(id));
  const voiceIds = [...declaredVoiceIds, ...inlineVoiceIds];
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

  const voiced = voiceLead(extractChordNotes(chords));

  // One comping voice: each pattern slot is a block chord "[low mid high]".
  // compBars[i] is bar i's ABC fragment; compPalettes[i] is a colour order
  // (["R","3","5"] bottom-to-top) per chord onset in that fragment.
  const compBars = [];
  const compPalettes = [];
  for (let bar = 0; bar < voiced.length; bar++) {
    const cb = voiced[bar];
    let fragment;
    let barPalette;
    // A `null` triple is a break ("N.C.") slot: draw a plain rest instead of
    // a chord pattern, and contribute no palette entries (a rest draws no
    // notehead onset for sheet-decorations.js to colour).
    if (cb.length === 1) {
      if (cb[0] === null) {
        fragment = "z8";
        barPalette = [];
      } else {
        const fn = bar % 2 === 0 ? pat.twobar1 : pat.twobar2;
        fragment = fn.apply(null, chordArgs(cb[0], keyScale));
        const order = cb[0].map((v) => v.fn);
        barPalette = new Array(countChords(fragment)).fill(order);
      }
    } else if (cb.length === 2) {
      const fragA = cb[0] === null ? "z4" : pat.half.apply(null, chordArgs(cb[0], keyScale));
      const fragB = cb[1] === null ? "z4" : pat.half.apply(null, chordArgs(cb[1], keyScale));
      fragment = fragA + " " + fragB;
      barPalette = new Array(countChords(fragA))
        .fill(cb[0] === null ? [] : cb[0].map((v) => v.fn))
        .concat(new Array(countChords(fragB)).fill(cb[1] === null ? [] : cb[1].map((v) => v.fn)));
    } else {
      const durs = distribute(8, cb.length);
      fragment = cb
        .map((triple, i) => (triple === null ? "z" + durs[i] : chordArgs(triple, keyScale)[0] + durs[i]))
        .join(" ");
      barPalette = cb.map((triple) => (triple === null ? [] : triple.map((v) => v.fn)));
    }
    compBars.push(rebeamBar(respellBar(fragment, keySig), lnum, lden));
    compPalettes.push(barPalette);
  }

  const leadingRestBars = computeChordOffset(song) || 0;
  // Invisible rest: keeps the comping voice bar-aligned with the melody
  // through pickup / intro / tail bars without drawing anything.
  const restToken = "x" + formatDuration(8, lnum, lden);
  const compBody = buildVoiceBody(
    patternSourceBody, compBars, leadingRestBars, restToken, lnum, lden,
  ).trim();
  // buildVoiceBody consumes compBars in order (leading/tail bars use the plain
  // rest), so the drawn chord onsets are compPalettes flattened in bar order.
  const palette = compPalettes.flat();

  const clefSuffix = bassClef ? " clef=bass middle=D" : "";
  const label = PATTERN_LABEL[pattern] || pattern;

  const headerOut = [];
  let layoutLine = null;
  for (const line of split.header) {
    if (/^L:/.test(line)) continue;
    if (/^%%(score|staves)\b/.test(line)) {
      layoutLine = line;
      continue;
    }
    if (/^T:/.test(line)) {
      headerOut.push(line + "  (comping \u2013 " + label + ")");
      continue;
    }
    headerOut.push(line);
  }
  headerOut.push("L:" + lnum + "/" + lden);
  // Stacked 5 / 3 / R label at the staff's left, naming the chord tones the
  // three notehead colours pick out (fifth / third / root, top to bottom —
  // the label's own stacking order mirrors the notes' vertical stacking in
  // the chord, root at the bottom).
  const compingVoiceLine =
    "V:" + newVoiceId + String.raw` name="5\n3\nR"` + clefSuffix;
  const existingBody = split.body.trimEnd();
  let abc;
  if (explicitVoices) {
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
    if (layoutLine) headerOut.push(layoutLine.trimEnd() + " " + newVoiceId);
    headerOut.push(split.kLine);
    abc =
      headerOut.join("\n") +
      "\n" + existingBody +
      "\n" + compingVoiceLine + "\n" + compBody + "\n";
  } else {
    // %%staves (not %%score) so ABCjs draws the barlines connecting the
    // melody staff to the comping staff — they read as one system. The
    // bracket [ ] groups them.
    headerOut.push("%%staves [1 2]", "V:1", compingVoiceLine, split.kLine);
    abc =
      headerOut.join("\n") +
      "\nV:1\n" + existingBody +
      "\nV:2\n" + compBody + "\n";
  }
  return { abc, palette };
}
