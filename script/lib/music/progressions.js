/*
  Named chord progressions for the "Named progressions" layer — the
  traditional-jazz vocabulary Pops Coffee teaches on his blog "Playing
  Traditional Jazz" (playing-traditional-jazz.blogspot.com). Each entry
  below is what that post says, and where this module goes beyond the post
  (a bar-length threshold the post leaves open) it says so.

    Salty Dog    VI7 | II7 | V7 | I        Post 92. "VI7-II7-V7-I", round the
                                            circle of fifths.
    Four-Leaf    I | II7 | V7 | I          Post 413. "The tune starts on the
                                            Tonic chord and then follows this
                                            with" II-V-I; two bars each in the
                                            post's own example. Variations the
                                            post lists: I | VI7 | II7 | V7 | I
                                            (a bar each on the I and the VI7,
                                            reader Allen Robnett); the same
                                            pattern in half-bars (Lulu's Back
                                            in Town); four bars a chord (Down
                                            in Honky Tonk Town, I'm Looking
                                            Over a Four-Leaf Clover). The II is
                                            D major in its C example, II7 in
                                            its title.
    Georgia      I | III | VI             Post 139. The tonic, the chord of
                                            the third degree, the chord of the
                                            sixth — "sometimes major and
                                            sometimes minor". Often two bars
                                            each (All of Me, Who's Sorry Now).
    Sunshine     IV | IVm | I | VI7 |      Post 565. The last eight bars of so
                 II7 | V7 | I | I           many 32-bar tunes (and the first of
                                            some). Bar 2 is often a #IV dim,
                                            bar 5 may be IIm7, and the last two
                                            beats of bar 7 may take the IV.
                                            Sometimes compressed into half-bars
                                            (At the Jazzband Ball).
    Apple Tree   I | IV | I               Post 77. "The first three chords":
                                            an opening, so only matched where a
                                            part starts.

  findNamedProgressions(song) walks the parsed tune's chord symbols (first
  voice) and returns where each one sits: [{ id, name, url, startNote,
  endNote, chordNotes, lineStarts }] — `startNote`/`endNote` index the first
  voice's notes and rests in order (the match is [startNote, endNote)),
  which stay the same however the text is annotated afterwards;
  `chordNotes` indexes the notes that carry a chord symbol inside the match
  (what the sheet marks — including a chord restated at the start of a
  printed line); `lineStarts` is the source offset of the match's first
  note on every printed line it covers.

  What is this module's own, not the blog's: matching is deliberately
  strict, so a label means what it says — each chord of a pattern must last
  at least a bar (half a bar where the post allows half-bars: Sunshine,
  Four-Leaf; for Apple Tree the post is silent and half a bar is allowed
  for the IV), the closing I may be shorter, and the key must be major. A
  short chromatic approach chord (half a bar or less, like the A♭7 in Basin
  Street's G7 | A♭7 G7 | C7) is stepped over, and Four-Leaf's V7 bars may
  hold a short turnaround back to the V7 (F7 | Gm | C7 | F7 in Four-Leaf
  Clover) — a chart writing out the several chords per bar that the post
  says it leaves out. Two progressions may share a chord — Georgia's VI7 is
  also the first chord of the Salty Dog that follows — and then both bands
  cover it.
*/

import { collectHarmony } from "./harmony.js";

// The chords the patterns are made of: [semitones above the tonic, quality].
const I = [0, "maj"];
const II7 = [2, "dom"];
const II_OR_II7 = [2, "majOrDom"];
const IIm = [2, "min"];
const III_OR_III7 = [4, "majOrDom"];
const IV = [5, "majOrDom"];
const IVm = [5, "min"];
const SHARP_IV_DIM = [6, "dim"];
// Not in the post (bar 2 is IVm or #IV dim there): a dim chord on the IV
// that charts such as I'm Looking Over a Four-Leaf Clover write instead.
const IV_DIM = [5, "dim"];
const V7 = [7, "dom"];
// Four-Leaf's dominant may be a plain triad (Down in Honky Tonk Town's F).
const V_TRIAD_OR_7 = [7, "majOrDom"];
const VI7 = [9, "dom"];
const VIm = [9, "min"];
const VI_ANY = [9, "majOrDom"];

// Each progression links to the blog post that explains it.
const BLOG = "https://playing-traditional-jazz.blogspot.com/";
const SALTY_DOG_URL = BLOG + "2013/06/salty-dog-chord-progression.html";
const FOUR_LEAF_URL = BLOG + "2016/07/a-very-common-pattern.html";
const SUNSHINE_URL = BLOG + "2017/11/post-565-essential-to-master-sunshine.html";
const GEORGIA_URL = BLOG + "2013/01/the-georgia-chord-progression.html";
const APPLE_TREE_URL = BLOG + "2013/06/the-apple-tree-chord-progression.html";

/*
  One pattern per shape a progression is written in — a variation the post
  lists is its own entry under the same id/name. Fields:

    steps       the chords that may stand at each step, [[I], [II7], ...]
    minBars     how long each chord must last, in bars (default 1)
    trimLead    an overlong first chord only lends its last bar (Sunshine)
    leadMaxBars the first chord may last at most this long, else it is only a
                long chord before some other pattern (Four-Leaf's VI7 variant
                is "one bar on the tonic")
    opening     only matched where a part starts
    turnaround  { step, over, maxChords } the step may leave its chord and
                come back after up to maxChords of `over`
    closingBars how many of the previous step's lengths the closing chord
                counts for (default: one bar). Sunshine's last two bars are
                both I, and compressed into half-bars they are one half-bar
                each
*/
const PATTERNS = [
  // Post 565: IV | IVm (or #IV dim) | I | VI7 | II7 (or IIm7) | V7 | I | I.
  // It is eight bars: a IV held longer (Bourbon Street Parade's runs three)
  // only lends its last bar (`trimLead`), the rest is just a long IV. The
  // last two beats of bar 7 may be the IV: a short chord between two of the
  // closing I is stepped over like any approach chord.
  {
    id: "sunshine", name: "Sunshine", url: SUNSHINE_URL, minBars: 0.5, trimLead: true,
    steps: [[IV], [IVm, SHARP_IV_DIM, IV_DIM], [I], [VI7], [II7, IIm], [V7], [I]],
    closingBars: 2,
  },
  { id: "salty-dog", name: "Salty Dog", url: SALTY_DOG_URL, steps: [[VI7], [II7], [V7], [I]] },
  // Post 413, I | II7 | V7 | I — two bars a chord in the post's example, four
  // in Four-Leaf Clover, half-bars in Lulu's Back in Town. The V7 bars may
  // hold a turnaround that comes back to the dominant: F7 | Gm | C7 | F7
  // (Four-Leaf Clover), F | C7 | F7 (Honky Tonk Town).
  {
    id: "four-leaf", name: "Four-Leaf", url: FOUR_LEAF_URL, minBars: 0.5,
    steps: [[I], [II_OR_II7], [V_TRIAD_OR_7], [I]],
    turnaround: { step: 2, over: [VIm, VI7, II7, IIm], maxChords: 2 },
  },
  // Allen Robnett's variation in the same post: a bar on the I, then a bar on
  // the VI7 before the II7 (Button Up Your Overcoat, Peg o' My Heart, ...).
  {
    id: "four-leaf", name: "Four-Leaf", url: FOUR_LEAF_URL,
    steps: [[I], [VI7], [II_OR_II7], [V_TRIAD_OR_7], [I]], leadMaxBars: 1,
    turnaround: { step: 3, over: [VIm, VI7, II7, IIm], maxChords: 2 },
  },
  // Post 139: I | III | VI, the VI major, dominant or minor.
  { id: "georgia", name: "Georgia", url: GEORGIA_URL, steps: [[I], [III_OR_III7], [VI_ANY, VIm]] },
  { id: "apple-tree", name: "Apple Tree", url: APPLE_TREE_URL, steps: [[I], [IV], [I]], minBars: 0.5, opening: true },
];

export const PROGRESSION_NAMES = [...new Set(PATTERNS.map((p) => p.name))];

// The label a progression wears on the sheet: "Sunshine progression".
export const PROGRESSION_WORD = "progression";
export function progressionLabel(name) {
  return `${name} ${PROGRESSION_WORD}`;
}

function qualityFits(wanted, quality) {
  if (wanted === "majOrDom") return quality === "maj" || quality === "dom";
  return wanted === quality;
}

function fitsStep(segment, step) {
  if (segment.tonic === null) return false;
  const degree = (segment.root - segment.tonic + 12) % 12;
  return step.some(([d, quality]) => sameDegree(degree, d, quality) && qualityFits(quality, segment.quality));
}

// A diminished (seventh) chord is symmetrical: F°7 is B°7 respelled, so in
// F major "Fdim" is the #IV dim of the pattern. Any root a minor third
// apart names the same chord.
function sameDegree(degree, wanted, quality) {
  return quality === "dim" ? (degree - wanted + 12) % 3 === 0 : degree === wanted;
}

const isTonicStep = (step) => step.some(([d]) => d === 0);

const EPS = 1e-9;

/*
  Try to match `steps` from segment `i`. A step takes its segment plus any
  short approach chord that returns to it (G7 | A♭7 G7) and must then add up
  to a bar — except a closing I, which may be shorter; between steps one
  short approach chord may be stepped over. Returns the index of the last
  segment used, the first segment of its closing chord, and when the match ends (at most a bar into its last chord),
  or null.
*/
function matchAt(segments, i, progression, bar) {
  const { steps } = progression;
  const minLength = bar * (progression.minBars || 1);
  let at = i;
  const spans = [];
  for (let s = 0; s < steps.length; s++) {
    if (at >= segments.length || !fitsStep(segments[at], steps[s])) return null;
    const stepFirst = at;
    const stepStart = segments[at].start;
    at = lastSegmentOfStep(segments, at, progression, s, bar);
    const stepEnd = segments[at].end;
    spans.push({ start: stepStart, end: stepEnd });
    const closing = s === steps.length - 1;
    if (s === 0 && progression.leadMaxBars && stepEnd - stepStart > bar * progression.leadMaxBars + EPS) return null;
    if (stepEnd - stepStart < minLength - EPS && !(closing && isTonicStep(steps[s]))) return null;
    if (closing) {
      return {
        last: at, closingFirst: stepFirst, start: patternStart(progression, spans[0], bar),
        end: Math.min(stepEnd, stepStart + closingLength(progression, spans, bar)),
      };
    }
    at += 1;
    if (approachChord(segments, at, steps[s + 1], bar)) at += 1;
  }
  return null;
}

// The segment a step ends on: past its short approach chords and, for a
// progression with a `turnaround`, past that too.
function lastSegmentOfStep(segments, from, progression, s, bar) {
  const step = progression.steps[s];
  const next = progression.steps[s + 1];
  let at = from;
  // A short chord that is the next step itself (F | B♭ | F with a half-bar
  // B♭) is that step, not an approach chord to this one.
  const isApproach = (seg) => isPassing(seg, bar) && !(next && fitsStep(seg, next));
  while (at + 2 < segments.length && isApproach(segments[at + 1]) && fitsStep(segments[at + 2], step)) at += 2;
  const turnaround = progression.turnaround;
  return turnaround && turnaround.step === s ? extendOverTurnaround(segments, at, step, turnaround) : at;
}

/*
  A step's chord may be left and come back after up to `maxChords` chords of
  turnaround ("over"): V7 | VIm | II7 | V7 is still the V7 bars. Returns the
  index of the segment the step finally ends on.
*/
function extendOverTurnaround(segments, at, step, turnaround) {
  for (let gap = 1; gap <= turnaround.maxChords; gap++) {
    const back = at + gap + 1;
    if (back >= segments.length) return at;
    const between = segments.slice(at + 1, back);
    if (between.every((seg) => fitsStep(seg, turnaround.over)) && fitsStep(segments[back], step)) {
      return extendOverTurnaround(segments, back, step, turnaround);
    }
  }
  return at;
}

// How far into its closing chord a match runs: a bar, or `closingBars` of
// the length the step before it was given.
function closingLength(progression, spans, bar) {
  if (!progression.closingBars || spans.length < 2) return bar;
  const previous = spans[spans.length - 2];
  return progression.closingBars * (previous.end - previous.start);
}

// Where the match starts: a `trimLead` pattern's lead chord held for longer
// than a bar only lends its last bar.
function patternStart(progression, lead, bar) {
  const overlong = progression.trimLead && lead.end - lead.start > bar + EPS;
  return overlong ? lead.end - bar : lead.start;
}

// Is segment `at` a short approach chord into one that fits `next`? One that
// is chromatic (an A♭7 into G7), the dominant of its target (D7 into G7) or
// only the chord just left altered (F7 then F+ into B♭). Any other short
// chord between two steps is a chord of its own — the vi of a quick
// I vi ii V turnaround — not an approach.
function approachChord(segments, at, next, bar) {
  if (at + 1 >= segments.length || !isPassing(segments[at], bar)) return false;
  if (fitsStep(segments[at], next) || !fitsStep(segments[at + 1], next)) return false;
  const chord = segments[at];
  const distance = (chord.root - segments[at + 1].root + 12) % 12;
  const chromatic = distance === 1 || distance === 11;
  const dominant = distance === 7 && chord.quality === "dom";
  return chromatic || dominant || segments[at - 1].root === chord.root;
}

function isPassing(segment, bar) {
  return segment.end - segment.start <= bar / 2 + EPS;
}

// The index of the first note at or after `time` (notes.length when none).
function noteIndexAt(notes, time) {
  const index = notes.findIndex((n) => n.time >= time - EPS);
  return index === -1 ? notes.length : index;
}

// Every note in [startTime, endTime) that carries a chord symbol — a chord
// restated at the start of a printed line counts, though it isn't a change.
function chordNotesWithin(notes, startTime, endTime) {
  const indexes = [];
  notes.forEach((n, i) => {
    if (n.hasChord && n.time >= startTime - EPS && n.time < endTime - EPS) indexes.push(i);
  });
  return indexes;
}

function lineStartsWithin(notes, startTime, endTime) {
  const starts = [];
  let line = -1;
  notes.forEach((n) => {
    if (n.time < startTime - EPS || n.time >= endTime - EPS) return;
    if (n.line !== line) starts.push(n.startChar);
    line = n.line;
  });
  return starts;
}

// The first pattern (in PATTERNS order) that matches from segment i.
function firstMatchAt(segments, i, bar) {
  for (const p of PATTERNS) {
    const m = p.opening && !segments[i].partStart ? null : matchAt(segments, i, p, bar);
    if (m) return { progression: p, first: i, ...m };
  }
  return null;
}

function findMatches(segments, bar) {
  const found = [];
  let i = 0;
  while (i < segments.length) {
    const best = firstMatchAt(segments, i, bar);
    if (best) {
      found.push(best);
      // The closing chord may open the next progression (Georgia → Salty Dog).
      i = best.closingFirst > best.first ? best.closingFirst : best.last + 1;
    } else {
      i += 1;
    }
  }
  return found;
}

export function findNamedProgressions(song) {
  if (!song || !song.lines) return []; // NOSONAR
  const { segments, notes, bar } = collectHarmony(song);
  const matches = findMatches(segments, bar);
  return matches.map((m, k) => {
    const startTime = m.start;
    const next = matches[k + 1];
    // A progression that hands its closing chord on to a different one
    // (Georgia's VI7 → Salty Dog) keeps that chord: both bands cover it.
    const shared = next && next.progression.id !== m.progression.id;
    const endTime = next && next.start < m.end && !shared ? next.start : m.end;
    return {
      id: m.progression.id,
      name: m.progression.name,
      url: m.progression.url,
      startNote: noteIndexAt(notes, startTime),
      endNote: noteIndexAt(notes, endTime),
      chordNotes: chordNotesWithin(notes, startTime, endTime),
      lineStarts: lineStartsWithin(notes, startTime, endTime),
    };
  });
}
