import {
  appendBarVoice, distribute, endsTied, keyScaleNotes, pcChromaVal, rebeamBar, resolveChordNames, respellBar,
} from "./comping.js";
import { practiceChord } from "./practice-chords.js";
import { barFragments, createSpeller } from "./solo.js";
import { tl } from "../core/i18n.js";

/*
  Practice material over a tune's changes: not a solo, but an exercise staff
  to play along with — the same shape as lib/music/solo.js's Solo voice (a
  chord scheme in, one more staff appended bar for bar through comping.js's
  appendBarVoice, and solo.js's own bar fragments and speller), but the notes
  come from fixed rules instead of a genetic algorithm, so they're instant
  and the same every time.

  An exercise is two independent choices, the way a method book drills them:
  - a RHYTHM: one-bar rhythm cells (straight eighths, offbeats, a Charleston,
    a dotted-quarter 3-over-4, a note tied over the beat, a last "and"
    anticipating the next bar's chord), each held for CELL_BARS bars so it
    can settle before the next one comes round — or one of them kept the
    whole way through; every fourth bar ends on a breath, at least its last
    beat rested;
  - a PITCH rule for every onset in it: runs through a set of the chord's
    tones or of its scale (Jamey Aebersold's ladder for learning a tune's
    changes: roots, triads, 7th chords, 9th chords, the first 3 or 5 notes
    of the scale, the whole scale to the octave), guide tones (the 3rd
    and 7th set), one note held for the rhythm alone (a set of one), or an
    approach into each chord's 3rd or 7th — a half step from below, a scale
    step from above, or both (an enclosure). A run either voice-leads and
    turns round every chord, or has the same shape over every chord.
  A note that crosses a bar line belongs to the chord it lands on: that is
  what an anticipation is, the new chord played an eighth early.
*/

/*
  What the practice panel offers. PRACTICE_KINDS: what to play. Chord tones
  and Scales take a note set (PRACTICE_NOTE_SETS: the panel's preset cards,
  or any other set of PRACTICE_DEGREES) and a run shape (PRACTICE_SHAPES:
  "alternate" voice-leads from the last note and turns round every chord,
  the others give every chord the same shape from its lowest note —
  `points`: the little contour the panel draws, in a 64×26 box). Approach
  takes a PRACTICE_APPROACHES style. A card's `draw` is what its little
  staff shows, on C: the degrees, or for an approach the notes in order
  ({ degree, sharp, approach }: hollow approach notes, a filled target).
*/
export const PRACTICE_KINDS = [
  { value: "arpeggios", runs: true, label: tl("practice_kind_arpeggios", "Chord tones") },
  { value: "scales", runs: true, label: tl("practice_kind_scales", "Scales") },
  { value: "enclosures", label: tl("practice_kind_enclosures", "Approach") },
];
export const PRACTICE_SHAPES = [
  { value: "alternate", label: tl("practice_shape_alternate", "Voice-led"), points: "4,20 18,8 32,18 46,6 60,16" },
  { value: "up", label: tl("practice_shape_up", "Up"), points: "4,22 18,16 32,10 46,4 50,22 60,16" },
  { value: "down", label: tl("practice_shape_down", "Down"), points: "4,4 18,10 32,16 46,22 50,4 60,10" },
  { value: "updown", label: tl("practice_shape_updown", "Up & down"), points: "4,22 18,13 32,4 46,13 60,20" },
];
// The degrees a set can hold: a chord's own tones (and its 9th), or the
// scale's up to the octave. (A scale's 9th never sounds: a run has one
// chord's worth of notes, and a bar of eighths turns round before the octave.)
export const PRACTICE_DEGREES = {
  arpeggios: [1, 3, 5, 6, 7, 9],
  scales: [1, 2, 3, 4, 5, 6, 7, 8],
};
export const PRACTICE_DEGREE_LABELS = {
  1: tl("practice_degree_1", "Root"),
  2: tl("practice_degree_2", "2nd"),
  3: tl("practice_degree_3", "3rd"),
  4: tl("practice_degree_4", "4th"),
  5: tl("practice_degree_5", "5th"),
  6: tl("practice_degree_6", "6th"),
  7: tl("practice_degree_7", "7th"),
  8: tl("practice_degree_8", "8ve"),
  9: tl("practice_degree_9", "9th"),
};
// `label` the card's, `name` the closed summary's; the first `default` is
// what a kind plays with no set stored — today's 7th chords and full scales.
export const PRACTICE_NOTE_SETS = {
  arpeggios: [
    { value: "root", degrees: [1], label: tl("practice_set_root", "Root"), name: tl("practice_name_root", "Roots") },
    { value: "triad", degrees: [1, 3, 5], label: tl("practice_set_triad", "Triad"), name: tl("practice_name_triad", "Triads") },
    {
      value: "seventh", degrees: [1, 3, 5, 7], default: true,
      label: tl("practice_set_seventh", "7th chord"), name: tl("practice_name_seventh", "7th chords"),
    },
    { value: "ninth", degrees: [1, 3, 5, 7, 9], label: tl("practice_set_ninth", "9th chord"), name: tl("practice_name_ninth", "9th chords") },
    { value: "sixth", degrees: [1, 3, 5, 6], label: tl("practice_set_sixth", "6th chord"), name: tl("practice_name_sixth", "6th chords") },
    { value: "guide", degrees: [3, 7], label: tl("practice_guide", "Guide tones"), name: tl("practice_guide", "Guide tones") },
  ],
  scales: [
    { value: "three", degrees: [1, 2, 3], label: tl("practice_set_three", "First 3"), name: tl("practice_name_three", "Scale, first 3 notes") },
    { value: "five", degrees: [1, 2, 3, 4, 5], label: tl("practice_set_five", "First 5"), name: tl("practice_name_five", "Scale, first 5 notes") },
    {
      value: "octave", degrees: [1, 2, 3, 4, 5, 6, 7, 8], default: true,
      label: tl("practice_set_octave", "Octave"), name: tl("practice_scales", "Scale runs"),
    },
  ],
};
export const PRACTICE_APPROACHES = [
  {
    value: "below", label: tl("practice_approach_below", "From below"), name: tl("practice_name_below", "Approach from below"),
    draw: [{ degree: 2, sharp: true, approach: true }, { degree: 3 }],
  },
  {
    value: "above", label: tl("practice_approach_above", "From above"), name: tl("practice_name_above", "Approach from above"),
    draw: [{ degree: 4, approach: true }, { degree: 3 }],
  },
  {
    value: "enclose", default: true, label: tl("practice_approach_enclose", "Enclosure"), name: tl("practice_enclosures", "Enclosures"),
    draw: [{ degree: 4, approach: true }, { degree: 2, sharp: true, approach: true }, { degree: 3 }],
  },
];
const DEFAULT_APPROACH = "enclose";
const GUIDE_SET = [3, 7];

const sameDegrees = (a, b) => a.length === b.length && a.every((d, i) => d === b[i]);
const defaultDegrees = (kind) => PRACTICE_NOTE_SETS[kind].find((set) => set.default).degrees;

// The preset card a kind's degrees match, if any.
export function practiceNoteSet(kind, degrees) {
  const sets = PRACTICE_NOTE_SETS[kind];
  return sets ? sets.find((set) => sameDegrees(set.degrees, degrees)) : undefined;
}

// The exercise values from before note sets: guide tones are the 3rd-and-7th
// set, rhythm on one note the root alone.
const LEGACY = { guide: "arpeggios@37", rhythm: "arpeggios@1" };

/*
  An exercise value — "kind", "kind-variant", "kind@degrees" or
  "kind-variant@degrees" ("scales-updown", "arpeggios@1357", "enclosures-below")
  — read as { kind, variant, degrees }: the variant is a run kind's shape or
  an approach's style, `degrees` a run kind's note set (ascending; the
  kind's default when none is written). Null for anything else.
*/
export function parseExercise(value) {
  const text = Object.prototype.hasOwnProperty.call(LEGACY, value) ? LEGACY[value] : String(value);
  const [head, digits] = text.split("@");
  const [kind, variant, extra] = head.split("-");
  const found = PRACTICE_KINDS.find((k) => k.value === kind);
  if (!found || extra !== undefined) return null;
  if (!found.runs) {
    const style = variant === undefined ? DEFAULT_APPROACH : variant;
    if (digits !== undefined || !PRACTICE_APPROACHES.some((a) => a.value === style)) return null;
    return { kind, variant: style, degrees: null };
  }
  const shape = variant === undefined ? "alternate" : variant;
  if (!PRACTICE_SHAPES.some((s) => s.value === shape)) return null;
  if (digits === undefined) return { kind, variant: shape, degrees: defaultDegrees(kind) };
  const degrees = PRACTICE_DEGREES[kind].filter((d) => digits.includes(String(d)));
  if (degrees.length === 0 || degrees.length !== digits.length) return null;
  return { kind, degrees, variant: shape };
}

// Whether a parsed exercise is runs with a shape to pick: not one held note, not guide tones.
export function exerciseTakesShape({ kind, degrees }) {
  const found = PRACTICE_KINDS.find((k) => k.value === kind);
  if (!found || !found.runs) return false;
  return degrees.length > 1 && !(kind === "arpeggios" && sameDegrees(degrees, GUIDE_SET));
}

/**
  { kind, variant, degrees } -> the shortest value that reads back the same
  (no `degrees`: the kind's default set).
  @param {{ kind: string, variant?: string, degrees?: number[] | null }} exercise
*/
export function formatExercise({ kind, variant, degrees = null }) {
  const found = PRACTICE_KINDS.find((k) => k.value === kind);
  if (!found) return String(kind);
  if (!found.runs) return variant && variant !== DEFAULT_APPROACH ? `${kind}-${variant}` : kind;
  const set = degrees || defaultDegrees(kind);
  const shape = exerciseTakesShape({ kind, degrees: set }) && variant && variant !== "alternate" ? `-${variant}` : "";
  const notes = sameDegrees(set, defaultDegrees(kind)) ? "" : `@${set.join("")}`;
  return `${kind}${shape}${notes}`;
}

// A practice setting the panel can show: "off" or a readable exercise.
export function isPracticeSetting(value) {
  return value === "off" || parseExercise(value) !== null;
}

// One exercise of each kind of choice — every run kind in every shape, every
// other preset set, every approach — for the tests and the tour.
export const PRACTICE_EXERCISES = [
  ...["arpeggios", "scales"].flatMap((kind) => PRACTICE_SHAPES.map((shape) => formatExercise({ kind, variant: shape.value }))),
  ...["arpeggios", "scales"].flatMap((kind) => PRACTICE_NOTE_SETS[kind]
    .filter((set) => !set.default)
    .map((set) => formatExercise({ kind, variant: "updown", degrees: set.degrees }))),
  ...PRACTICE_APPROACHES.map((a) => formatExercise({ kind: "enclosures", variant: a.value })),
];

// General MIDI trumpet: the Mixer's Practice voice default.
export const PRACTICE_PROGRAM = 56;
const SLOTS_PER_BAR = 8;
const SLOTS_PER_BEAT = 2;
const CELL_BARS = 2;

/*
  The Rhythm dropdown's patterns. `cell` is one bar in eighths: "x" a note
  starts, "-" it holds, "." a rest; a trailing ">" ties the bar's last note
  over the bar line (the next bar's first eighth becomes its continuation).
  The practice panel ticks any number of them (the `practiceRhythms`
  setting): one plays all the way, several take turns every CELL_BARS bars.
  Nothing ticked yet means the exercise's own set (`long` ones for guide
  tones, `run` ones for everything else). `sync` marks a syncopated one: a note on an
  "and" held over the next beat or bar line, or a beat left out for an
  offbeat.
*/
export const PRACTICE_RHYTHMS = [
  { value: "eighths", cell: "xxxxxxxx", run: true, label: tl("practice_rhythm_eighths", "Straight eighths") },
  { value: "offbeats", cell: ".x.x.x.x", run: true, sync: true, label: tl("practice_rhythm_offbeats", "Offbeats") },
  { value: "tied", cell: "xx-xx-xx", run: true, sync: true, label: tl("practice_rhythm_tied", "Tied over the beat") },
  { value: "charleston", cell: "x--x....", run: true, sync: true, label: tl("practice_rhythm_charleston", "Charleston") },
  { value: "anticipate", cell: "xxxxxx.x>", run: true, sync: true, label: tl("practice_rhythm_anticipate", "Anticipate the next bar") },
  // The "and" of 2 pushed over beat 3, the "and" of 4 over the bar line.
  { value: "pushes", cell: "xx.x--.x>", run: true, sync: true, label: tl("practice_rhythm_pushes", "Pushes on the \"and\"") },
  { value: "threefour", cell: "x--x--x-", run: true, label: tl("practice_rhythm_threefour", "Three against four") },
  { value: "and", cell: ".xxx.xxx", run: true, label: tl("practice_rhythm_and", "Start on the \"and\"") },
  { value: "pairs", cell: "xx.xx.xx>", run: true, sync: true, label: tl("practice_rhythm_pairs", "Pairs, last one anticipated") },
  { value: "halves", cell: "x---x---", long: true, label: tl("practice_rhythm_halves", "Half notes") },
  { value: "halfanticipate", cell: "x---...x>", long: true, sync: true, label: tl("practice_rhythm_halfanticipate", "Half note, anticipate") },
  { value: "late", cell: ".x--x---", long: true, sync: true, label: tl("practice_rhythm_late", "Late start") },
  { value: "longcharleston", cell: "x--x---.", long: true, sync: true, label: tl("practice_rhythm_longcharleston", "Long Charleston") },
];
const RUN_CELLS = PRACTICE_RHYTHMS.filter((r) => r.run).map((r) => r.cell);
const LONG_CELLS = PRACTICE_RHYTHMS.filter((r) => r.long).map((r) => r.cell);

/*
  What's set, in two parts — { exercise: "Scale runs, Up & down", rhythm:
  "Charleston" } — or null when practice is off. `rhythms` is the
  practiceRhythms setting: the one pattern's name, "4 rhythms", or "Varied
  rhythm" for the exercise's own set (null). The closed practice
  control shows them side by side, or stacked on a phone.
*/
export function practiceSummaryParts(practice, rhythms) {
  if (practice === "off") return null;
  const parsed = parseExercise(practice);
  if (parsed === null) return null;
  const picked = pickedRhythms(rhythms);
  let rhythmName = tl("practice_rhythm_varied_short", "Varied rhythm");
  if (picked.length === 1) rhythmName = picked[0].label;
  else if (picked.length > 1) rhythmName = tl("practice_rhythm_count", "{count} rhythms", { count: picked.length });
  return { exercise: exerciseName(parsed), rhythm: rhythmName };
}

// "7th chords, Up & down", "Guide tones", "Chord tones: 3rd, 5th, 9th", "Enclosures".
function exerciseName(parsed) {
  if (parsed.degrees === null) return PRACTICE_APPROACHES.find((a) => a.value === parsed.variant).name;
  const set = practiceNoteSet(parsed.kind, parsed.degrees);
  let what = set ? set.name : null;
  if (what === null) {
    const notes = parsed.degrees.map((d) => PRACTICE_DEGREE_LABELS[d]).join(", ");
    what = parsed.kind === "scales"
      ? tl("practice_name_custom_scale", "Scale: {notes}", { notes })
      : tl("practice_name_custom_chord", "Chord tones: {notes}", { notes });
  }
  if (!exerciseTakesShape(parsed)) return what;
  const shape = PRACTICE_SHAPES.find((s) => s.value === parsed.variant);
  return tl("practice_summary_run", "{kind}, {shape}", { kind: what, shape: shape.label });
}

// The same as one line: "Scale runs, Up & down · Charleston", or "Off".
export function practiceSummary(practice, rhythms) {
  const parts = practiceSummaryParts(practice, rhythms);
  if (parts === null) return tl("practice_summary_off", "Off");
  return tl("practice_summary", "{exercise} · {rhythm}", parts);
}

// Range of the line (concert MIDI, C4 to G5) and where it starts.
const LOW = 60;
const HIGH = 79;
const START = 67;
// A fixed-shape run (always up / down, up then down) stays within one
// octave of its root, the root taken from A3 to G#4 (concert) so the octave
// sits on the treble staff (a trumpet's written B3 to A#4 root).
const RUN_ROOTS = { low: 57, high: 68 };

const mod12 = (x) => ((x % 12) + 12) % 12;

function pitchesOf(chord, intervals, range = { low: LOW, high: HIGH }) {
  const set = new Set(intervals);
  const out = [];
  for (let m = range.low; m <= range.high; m++) {
    if (set.has(mod12(m - chord.root))) out.push(m);
  }
  return out;
}

// The chord's notes as practice-chords.js reads them: chord tones, its scale
// (tensions picked from the key), and the guide tones — the 3rd and the 7th or 6th.
const chordTones = (chord) => pitchesOf(chord, chord.tones);
const scaleTones = (chord) => pitchesOf(chord, chord.scale);
const guideTones = (chord) => pitchesOf(chord, chord.guide);
const isChordTone = (chord, midi) => chord.tones.includes(mod12(midi - chord.root));

// A scale note's degree (1-7) over its chord: the chord's own root, 3rd,
// 5th and 7th-or-6th first; any other note by its distance from the root —
// a b9 or 9 (or a #9 over a major 3rd) is the 2nd, an 11 or #11 the 4th, a
// b13 or 13 the 6th. A symmetrical scale can put two notes on one degree.
const DEGREE_BY_SEMITONE = [1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7];
function degreeOf(chord, s) {
  if (s === 0) return 1;
  if (s === chord.third) return 3;
  if (s === chord.fifth) return 5;
  if (s === chord.top) return s >= 10 ? 7 : 6;
  if (s === 3 && chord.third === 4) return 2;
  return DEGREE_BY_SEMITONE[s];
}

/*
  A note set's notes over one chord, as semitones above its root (8: the
  octave, 9: the chord's 9th, the 2nd an octave up), ascending. Chord tones play the chord's
  own: its 3rd (or sus note), 5th, and the 7th or 6th it's written or heard
  with — so "7th chord" over a plain F is F A C D, the way the chord tones
  have always sounded here, and an augmented triad has no 7th; the 6th is
  that 6th, else the scale's. Scale degrees play the chord's scale.
*/
function noteOffsets(chord, kind, degrees) {
  const out = new Set();
  for (const d of degrees) {
    let offsets;
    if (d === 8) offsets = [12];
    else if (d === 9) offsets = scaleDegree(chord, 2).map((s) => s + 12);
    else if (kind === "scales") offsets = scaleDegree(chord, d);
    else offsets = chordToneOffsets(chord, d);
    offsets.forEach((s) => out.add(s));
  }
  // Nothing the chord has (an augmented triad's 7th alone): its root.
  if (out.size === 0) return [0];
  // Sorted in place, on a copy: toSorted() is Safari 16+.
  const offsets = [...out];
  offsets.sort((a, b) => a - b);
  return offsets;
}

const scaleDegree = (chord, d) => chord.scale.filter((s) => degreeOf(chord, s) === d);

// One degree of a chord-tone set: the chord's own note for it.
function chordToneOffsets(chord, d) {
  if (d === 1) return [0];
  if (d === 3) return [chord.third];
  if (d === 5) return [chord.fifth];
  if (d === 7) return chord.top === undefined ? [] : [chord.top];
  // The 6th: the one the chord is heard with, else the scale's.
  return chord.top !== undefined && degreeOf(chord, chord.top) === 6 ? [chord.top] : scaleDegree(chord, 6);
}

// A set's notes over a chord across the whole range: the pool a voice-led
// run and a held note pick from.
const setTones = (chord, set) => pitchesOf(chord, noteOffsets(chord, set.kind, set.degrees).map(mod12));

function nearest(candidates, ref) {
  let best = candidates[0];
  for (const m of candidates) {
    if (Math.abs(m - ref) < Math.abs(best - ref)) best = m;
  }
  return best;
}

// Every fourth bar (counted from the first chord bar) ends on a breath: its
// last beat is a rest, and nothing ties out of it.
const BREATH_EVERY = 4;
const BREATH_SLOTS = SLOTS_PER_BEAT;

/*
  The rhythm as one string of slots over the whole chart: each bar's cell (a
  break bar, all N.C., is silent and takes no anticipation), with a ">"
  carried into the next bar's first slot. With `breathEvery` (bars, 0 for
  never) the last bar of every phrase of that length is a breath: at least
  its last beat rested.
*/
export function rhythmSlots(bars, breaks, cells, breathEvery = 0) {
  let out = "";
  let tieIn = false;
  for (let bar = 0; bar < bars; bar++) {
    if (breaks.has(bar)) {
      out += ".".repeat(SLOTS_PER_BAR);
      tieIn = false;
    } else {
      const breath = breathEvery > 0 && bar % breathEvery === breathEvery - 1;
      const cell = cells[Math.floor(bar / CELL_BARS) % cells.length];
      let body = cell.slice(0, SLOTS_PER_BAR);
      // A tie over the bar line always lands: the next bar's first eighth
      // continues the note, even when its own pattern opens with a rest.
      if (tieIn) body = "-" + body.slice(1);
      if (breath) body = body.slice(0, SLOTS_PER_BAR - BREATH_SLOTS) + ".".repeat(BREATH_SLOTS);
      out += body;
      tieIn = !breath && cell.endsWith(">") && !breaks.has(bar + 1) && bar + 1 < bars;
    }
  }
  return out;
}

// Slots -> [{ slot, len }]: a "-" holds the note before it (a "-" after a
// rest is a rest).
function onsetsOf(slots) {
  const notes = [];
  let sounding = null;
  for (const [s, mark] of [...slots].entries()) {
    if (mark === "x") {
      sounding = { slot: s, len: 1 };
      notes.push(sounding);
    } else if (mark === "-" && sounding !== null) {
      sounding.len += 1;
    } else {
      sounding = null;
    }
  }
  return notes;
}

// Per slot: { chord, id } (id counts chord changes), or null in a break.
// `key`: the tune's key as a Set of chromas (or null), for the chords' scales.
function chordTimeline(names, key) {
  const timeline = [];
  let id = 0;
  for (const row of names) {
    distribute(SLOTS_PER_BAR, row.length).forEach((slots, i) => {
      const chord = row[i] === null ? null : practiceChord(row[i], key);
      id += 1;
      for (let k = 0; k < slots; k++) timeline.push(chord === null ? null : { chord, id });
    });
  }
  return timeline;
}

// The chord a note plays over: the one at its start, or — when it runs over
// a bar line — the one it lands on.
function chordFor(timeline, note) {
  const end = note.slot + note.len - 1;
  const crossing = Math.floor(end / SLOTS_PER_BAR) > Math.floor(note.slot / SLOTS_PER_BAR);
  return timeline[crossing ? Math.floor(end / SLOTS_PER_BAR) * SLOTS_PER_BAR : note.slot] || timeline[note.slot];
}

// Walk `pool` (sorted) from `prev` one step in `dir`. At either end it turns
// round, or — `walk.restart`, a run that only goes one way — jumps back to
// the note it started from (the chord's root) and goes again.
function stepThrough(pool, prev, walk) {
  const i = pool.indexOf(prev);
  if (i === -1) return stepOff(pool, prev, walk);
  let next = i + walk.dir;
  if (next < 0 || next >= pool.length) {
    if (walk.restart !== null) return walk.restart;
    walk.dir = -walk.dir;
    next = i + walk.dir;
  }
  return pool[Math.max(0, Math.min(pool.length - 1, next))];
}

// From a note outside `pool` (a chromatic passing note): the pool's next
// note on in `walk.dir`, turning round at the end of the pool.
function stepOff(pool, prev, walk) {
  const ahead = (dir) => {
    if (dir > 0) return pool.find((m) => m > prev);
    const below = pool.filter((m) => m < prev);
    return below[below.length - 1];
  };
  const next = ahead(walk.dir);
  if (next !== undefined) return next;
  walk.dir = -walk.dir;
  const back = ahead(walk.dir);
  return back === undefined ? nearest(pool, prev) : back;
}

/*
  A scale run keeps the chord's own tones on the beats, the way a bebop scale
  does: a scale note that would fall on a beat without being a chord tone is
  skipped when the note after it is one, and a chord tone that would fall
  on an "and", leaving a non-chord tone for the beat after it, is put off by
  a chromatic passing note in the whole step before it (G G# A over C6, Bb B C
  over C7). `next` is the plain scale step; `following` the note after this
  one within the chord, if any.
*/
function alignToBeat({ chord, pool, walk }, prev, next, note, following) {
  const onBeat = note.slot % SLOTS_PER_BEAT === 0;
  if (onBeat && !isChordTone(chord, next)) {
    const peek = { ...walk };
    const skip = stepThrough(pool, next, peek);
    if (isChordTone(chord, skip) && Math.abs(skip - prev) <= 4) {
      Object.assign(walk, peek);
      return skip;
    }
    return next;
  }
  const beatAfter = following !== undefined && following.slot % SLOTS_PER_BEAT === 0;
  if (onBeat || !beatAfter || !isChordTone(chord, next) || Math.abs(next - prev) !== 2) return next;
  const after = stepThrough(pool, next, { ...walk });
  return isChordTone(chord, after) ? next : prev + Math.sign(next - prev);
}

// How many notes play over each chord slot, by its id.
function segmentSizes(notes) {
  const sizes = new Map();
  for (const note of notes) sizes.set(note.at.id, (sizes.get(note.at.id) || 0) + 1);
  return sizes;
}

// Too few notes over a chord to go up and come back down within it.
const UPDOWN_MIN_NOTES = 4;

// Where a run starts over a new chord, and which way it goes. `size`: how
// many notes play over the chord.
function runStart({ runs, set, align }, chord, prev, walk, size) {
  if (runs === "alternate") {
    // Voice-led from the last note, the other way round from last time,
    // entering on one of the set's chord tones when it has any.
    walk.dir = -walk.dir;
    const pool = setTones(chord, set);
    const tones = pool.filter((m) => isChordTone(chord, m));
    return nearest(tones.length > 0 ? tones : pool, prev);
  }
  // Up then down over one chord; with too few notes for that (a Charleston's
  // two), every other chord goes up and the ones between come down.
  walk.flip = !walk.flip;
  let shape = runs;
  if (runs === "updown" && size < UPDOWN_MIN_NOTES) shape = walk.flip ? "up" : "down";
  // A fixed shape: no voice leading, every chord jumps to its root and the
  // run moves through the set's notes above it (fixedPool).
  const root = pitchesOf(chord, [0], RUN_ROOTS)[0];
  walk.fixed = fixedPool(set, chord, root, runs);
  walk.dir = shape === "down" ? -1 : 1;
  // Coming down, a full scale starts on its highest chord tone, never on a
  // tension: the 9th of "To the 9th" is reached going up.
  const tops = align ? walk.fixed.filter((m) => isChordTone(chord, m)) : walk.fixed;
  const start = shape === "down" ? tops[tops.length - 1] : walk.fixed[0];
  walk.restart = runs === "updown" ? null : start;
  return start;
}

/*
  The notes a fixed-shape run moves through over one chord: the set's notes
  above `root` (a MIDI note). A chord-tone set's root counts at either end:
  going up only it's left at the bottom, so the run repeats root-3-5-7
  instead of doubling the root at the turn; going down only it's taken an
  octave up (octave-7-5-3); up then down has both. A scale set is played as
  it reads: "Octave" holds both ends, "First 5" stops at the 5th.
*/
function fixedPool(set, chord, root, runs) {
  let offsets = noteOffsets(chord, set.kind, set.degrees);
  if (set.kind === "arpeggios" && offsets.includes(0) && !offsets.includes(12)) {
    if (runs === "down") offsets = [...offsets.filter((o) => o !== 0), 12];
    else if (runs === "updown") offsets = [...offsets, 12];
  }
  const unique = [...new Set(offsets)];
  unique.sort((a, b) => a - b);
  return unique.map((o) => root + o);
}

/*
  A run over each chord, walking the note set (`set`: { kind, degrees }) from
  one of its tones. `runs` (a PRACTICE_SHAPES value) sets its shape:
  "alternate" starts on the set's chord tone nearest the last note (so the
  line voice-leads through the changes, its notes in any octave) and goes up
  over one chord, down over the next; the others don't voice-lead but jump
  to the chord's root at every new chord (so every bar starts on its lowest
  note): "up" climbs, "down" falls from the top, and "updown" climbs to the
  note after the middle of the chord's notes and comes back down (or, over
  a chord with fewer than four notes, climbs over one chord and falls over
  the next) — all within the set's notes above that root. A full scale (all
  seven degrees) keeps chord tones on the beats (alignToBeat).
*/
function runPitches(notes, set, runs = "alternate") {
  const align = set.kind === "scales" && [1, 2, 3, 4, 5, 6, 7].every((d) => set.degrees.includes(d));
  // Flipped at the first chord, so an alternating line opens going up.
  const walk = { dir: -1, restart: null, fixed: null, flip: false };
  const poolFor = (chord) => walk.fixed || setTones(chord, set);
  const sizes = segmentSizes(notes);
  let prev = START;
  let segment = null;
  let index = 0;
  // The notes each one's run walks through, for leadIntoChords.
  const pools = [];
  const midis = notes.map((note, i, all) => {
    if (note.at.id === segment) {
      index += 1;
      // Up to the middle note, then back down: 1 2 3 4 5 4 3 2 over eight.
      if (runs === "updown" && index === Math.ceil(sizes.get(segment) / 2) + 1) walk.dir = -1;
      const pool = poolFor(note.at.chord);
      const next = stepThrough(pool, prev, walk);
      const following = all[i + 1] !== undefined && all[i + 1].at.id === segment ? all[i + 1] : undefined;
      prev = align ? alignToBeat({ chord: note.at.chord, pool, walk }, prev, next, note, following) : next;
    } else {
      segment = note.at.id;
      index = 0;
      prev = runStart({ runs, set, align }, note.at.chord, prev, walk, sizes.get(segment));
    }
    pools.push(poolFor(note.at.chord));
    return prev;
  });
  // Only up-then-down turns into the next chord: "always up/down" jump.
  return runs === "updown" ? leadIntoChords(notes, midis, pools) : midis;
}

// Within this many eighths of the next chord's first note, a run's last note leads into it.
const LEAD_GAP = 2;

// The note next to `from` in `pool` (sorted), one step towards `target`.
function stepToward(pool, from, target) {
  if (target > from) return pool.find((m) => m > from);
  const below = pool.filter((m) => m < from);
  return below[below.length - 1];
}

/*
  An up-then-down run jumps to a new root at every chord, so its last note
  before the change turns towards the next chord's first note: instead of
  carrying on away from it, it steps back the other way through the same
  scale (or chord tones) — B-flat C D E-flat F E-flat D E-flat, then F,
  not ... D C, then F. Kept when it's already a step from that note, when
  turning wouldn't bring it any closer, for a chord's only note, and across
  a longer rest.
*/
function leadIntoChords(notes, midis, pools) {
  return midis.map((midi, i) => {
    const note = notes[i];
    const next = notes[i + 1];
    const changes = next !== undefined && next.at.id !== note.at.id;
    const firstOfChord = i === 0 || notes[i - 1].at.id !== note.at.id;
    if (!changes || firstOfChord || next.slot - (note.slot + note.len) > LEAD_GAP) return midi;
    const target = midis[i + 1];
    const prev = midis[i - 1];
    if (Math.abs(midi - target) <= 2 || prev === target) return midi;
    const turn = stepToward(pools[i], prev, target);
    return turn !== undefined && Math.abs(turn - target) < Math.abs(midi - target) ? turn : midi;
  });
}

// The notes, grouped by the chord they sound over: [{ start, end, chord }]
// (end exclusive), in order.
function segmentsOf(notes) {
  const out = [];
  notes.forEach((note, i) => {
    if (i === 0 || notes[i - 1].at.id !== note.at.id) out.push({ start: i, end: i + 1, chord: note.at.chord });
    else out[out.length - 1].end = i + 1;
  });
  return out;
}

const pcDistance = (a, b) => Math.min(mod12(a - b), mod12(b - a));

/*
  The guide tone a chord's last note should be, so it leads into the next
  chord: the one that moves by the smallest step onto one of the next
  chord's guide tones — the 7th falling a half step to the 3rd — with a held
  common tone counted as a step and a half, so the line keeps moving.
*/
function resolvingGuide(pool, next) {
  const score = (m) => Math.min(...guideTones(next).map((n) => {
    const d = pcDistance(m, n);
    return d === 0 ? 1.5 : d;
  }));
  return pool.reduce((best, m) => (score(m) < score(best) ? m : best), pool[0]);
}

/*
  Guide tones: each chord enters on the guide tone nearest the last note (so
  a 7th falls a half step onto the next 3rd on the downbeat) and alternates
  its 3rd and 7th (or 6th) from there; with two notes or more, the entry
  is held for a second note where that makes the chord's last note the one
  that resolves into a different next chord (resolvingGuide). Each note sits in the
  octave nearest the one before.
*/
const MIDDLE = (LOW + HIGH) / 2;
function centred(candidates, ref) {
  const cost = (m) => Math.abs(m - ref) + Math.abs(m - MIDDLE) / 2;
  return candidates.reduce((best, m) => (cost(m) < cost(best) ? m : best), candidates[0]);
}

function guidePattern(pool, entry, end, size) {
  const other = pool.find((m) => mod12(m - entry) !== 0);
  const alt = (j) => (j % 2 === 0 || other === undefined ? mod12(entry) : mod12(other));
  const shift = end !== undefined && size >= 2 && alt(size - 1) !== mod12(end);
  return Array.from({ length: size }, (_, j) => (shift && j > 0 ? alt(j - 1) : alt(j)));
}

function guidePitches(notes) {
  const out = [];
  let prev = START;
  segmentsOf(notes).forEach((seg, k, segs) => {
    const pool = guideTones(seg.chord);
    const entry = nearest(pool, prev);
    // Into a different chord only: over the same chord again the line just alternates.
    const next = segs[k + 1];
    const end = next && next.chord.sym !== seg.chord.sym ? resolvingGuide(pool, next.chord) : undefined;
    guidePattern(pool, entry, end, seg.end - seg.start).forEach((chroma, j) => {
      const choices = pool.filter((m) => mod12(m) === chroma);
      // The leap within a chord leans to the middle of the range, so the line
      // doesn't sink to its floor and lose the half step into the next chord.
      prev = j === 0 ? nearest(choices, prev) : centred(choices, prev);
      out.push(prev);
    });
  });
  return out;
}

/*
  The key's tonic as a note of `chord` (in range), or [] when it isn't one of
  the chord's tones (or there's no key): where a line ending over that chord
  comes home.
*/
function homeNotes(chord, tonic) {
  if (tonic === null || !chord.tones.includes(mod12(tonic - chord.root))) return [];
  return pitchesOf(chord, [mod12(tonic - chord.root)]);
}

// A set of one note: held for the rhythm alone, each chord's in the octave
// nearest the last one — the tonic over the last chord.
function holdPitches(notes, set, tonic) {
  const out = [];
  let prev = START;
  segmentsOf(notes).forEach((seg, k, segs) => {
    const home = k === segs.length - 1 ? homeNotes(seg.chord, tonic) : [];
    prev = nearest(home.length > 0 ? home : setTones(seg.chord, set), prev);
    for (let i = seg.start; i < seg.end; i++) out.push(prev);
  });
  return out;
}

/*
  Approach notes: each chord's target — its 3rd or 7th (or 6th), the one
  nearest the last note; over the tune's last chord, the tonic — is reached
  from the half step below ("below"), the scale step above ("above"), or
  both, above first (an enclosure, "enclose"), and lands on the strongest
  note the rhythm gives it (targetIndex): a long note, on a beat, with room
  for its approach notes before it. The approach notes come from the
  chord's own notes when they can, else from the end of the chord before
  when it runs straight into it (a long target on the downbeat: the notes
  before the bar line lead into it). Notes before the approach walk the
  chord's tones towards it; notes after the target run on through them, up
  over one chord and down over the next.
*/
function approachRoom(notes, seg, prevSeg, locked, count) {
  let room = 0;
  if (prevSeg === undefined) return room;
  for (let i = seg.start - 1; room < count && i >= prevSeg.start && !locked.has(i); i--) {
    if (notes[i + 1].slot - (notes[i].slot + notes[i].len) > LEAD_GAP) break;
    room += 1;
  }
  return room;
}

// Which note of the chord (0-based) the target lands on: the best score.
// `count`: how many approach notes lead into it.
function targetIndex(notes, seg, crossRoom, count) {
  let best = 0;
  let bestScore = -1;
  for (let t = 0; t < seg.end - seg.start; t++) {
    const note = notes[seg.start + t];
    let room = 0.5;
    if (t >= count) room = 1;
    else if (t === 0) room = crossRoom / (2 * count);
    const score = note.len + (note.slot % SLOTS_PER_BEAT === 0 ? 1 : 0) + room;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

// `count` chord tones falling onto the approach from just above it (or,
// with no room up there, rising from just below), never the target itself.
function leadIn(tones, approach, target, count) {
  if (count <= 0) return [];
  const top = Math.max(target, ...approach);
  const bottom = Math.min(target, ...approach);
  const above = tones.filter((m) => m > top).slice(0, count).reverse();
  if (above.length === count) return above;
  return tones.filter((m) => m < bottom).slice(-count);
}

// The approach notes into `target`, in the order they're played.
function approachNotes(chord, target, style) {
  const up = scaleTones(chord).find((m) => m > target);
  const above = up === undefined ? target + 2 : up;
  if (style === "below") return [target - 1];
  if (style === "above") return [above];
  return [above, target - 1];
}

function approachPitches(notes, style, tonic) {
  const out = [];
  const locked = new Set();
  let dir = 1;
  segmentsOf(notes).forEach((seg, k, segs) => {
    const { chord } = seg;
    const before = out.length > 0 ? out[out.length - 1] : START;
    // The last chord's target is the tonic, when it's one of its tones.
    const home = k === segs.length - 1 ? homeNotes(chord, tonic) : [];
    const target = nearest(home.length > 0 ? home : guideTones(chord), before);
    const approach = approachNotes(chord, target, style);
    const count = approach.length;
    const crossRoom = approachRoom(notes, seg, segs[k - 1], locked, count);
    const t = targetIndex(notes, seg, crossRoom, count);
    const at = seg.start + t;
    // Approach notes: as many as fit before the target, in this chord or the last.
    const room = t >= count ? count : Math.max(t, crossRoom);
    const tones = chordTones(chord);
    out.push(...leadIn(tones, approach, target, t - count));
    for (let j = 0; j < Math.min(t, count); j++) out.push(null);
    out.push(target);
    approach.slice(count - room).forEach((m, j) => {
      out[at - room + j] = m;
    });
    locked.add(at);
    const walk = { dir, restart: null };
    let p = target;
    for (let i = at + 1; i < seg.end; i++) {
      p = stepThrough(tones, p, walk);
      out.push(p);
    }
    dir = -dir;
  });
  return out;
}

// How a parsed exercise plays: its own rhythm cells and its pitch rule.
function planFor(parsed) {
  if (parsed.degrees === null) {
    return { cells: RUN_CELLS, pitches: (notes, tonic) => approachPitches(notes, parsed.variant, tonic) };
  }
  if (parsed.kind === "arpeggios" && sameDegrees(parsed.degrees, GUIDE_SET)) return { cells: LONG_CELLS, pitches: guidePitches };
  if (parsed.degrees.length === 1) return { cells: RUN_CELLS, pitches: (notes, tonic) => holdPitches(notes, parsed, tonic) };
  return { cells: RUN_CELLS, pitches: (notes) => runPitches(notes, parsed, parsed.variant) };
}

// The ticked patterns (rhythm values, in any order) in PRACTICE_RHYTHMS order.
function pickedRhythms(rhythms) {
  return rhythms ? PRACTICE_RHYTHMS.filter((r) => rhythms.includes(r.value)) : [];
}

// What an exercise plays with nothing ticked: its own patterns, as values
// (long notes for guide tones, runs for the rest).
export function practiceDefaultRhythms(exercise) {
  const parsed = parseExercise(exercise);
  if (parsed === null) return [];
  const { cells } = planFor(parsed);
  return PRACTICE_RHYTHMS.filter((r) => cells.includes(r.cell)).map((r) => r.value);
}

// The cells an exercise takes turns with: the ticked ones, or its own set.
function cellsFor(spec, rhythms) {
  const picked = pickedRhythms(rhythms);
  return picked.length > 0 ? picked.map((r) => r.cell) : spec.cells;
}

/*
  The exercise's notes over `names` (resolveChordNames' per-bar chord rows),
  as [{ start, duration, midi, leadsUp }] in beats from the first chord bar — the
  shape solo.js's barFragments draws. Empty for an unknown exercise.
  `rhythms` the PRACTICE_RHYTHMS values to take turns with (one: kept all
  the way; null or none: the exercise's own set);
  `breathEvery` how many bars to a breath (0: none, for the tests); `key`
  the tune's key as a Set of pitch-class chromas, which picks each chord's
  scale tensions (null: the default scales); `tonic` its tonic's chroma, the
  note the exercise ends on (and an enclosure's last target) when the last
  chord holds it (null: no such ending).
*/
export function practiceNotes(names, exercise, {
  rhythms = null, breathEvery = BREATH_EVERY, key = null, tonic = null,
} = {}) {
  const parsed = parseExercise(exercise);
  if (parsed === null) return [];
  const spec = planFor(parsed);
  const breaks = new Set();
  names.forEach((row, bar) => {
    if (row.every((name) => name === null)) breaks.add(bar);
  });
  const timeline = chordTimeline(names, key);
  const notes = onsetsOf(rhythmSlots(names.length, breaks, cellsFor(spec, rhythms), breathEvery))
    .map((note) => ({ ...note, at: chordFor(timeline, note) }))
    .filter((note) => note.at);
  const midis = spec.pitches(notes, tonic);
  // Every exercise ends at home: its last note on the tonic, when that's a
  // tone of the last chord, in the octave nearest the note before.
  const last = notes.length - 1;
  const home = last >= 0 ? homeNotes(notes[last].at.chord, tonic) : [];
  if (home.length > 0) midis[last] = nearest(home, last > 0 ? midis[last - 1] : midis[last]);
  return notes.map((note, i) => ({
    start: note.slot / SLOTS_PER_BEAT,
    duration: note.len / SLOTS_PER_BEAT,
    midi: midis[i],
    leadsUp: midis[i + 1] === midis[i] + 1,
  }));
}

/*
  solo.js's speller (the key's own letters, flats elsewhere), except that a
  note outside the key which rises a half step into the next one is a
  leading note and spelled sharp: G#-A, not Ab-A.
*/
function createPracticeSpeller(keyScale) {
  const inKey = createSpeller(keyScale);
  const sharp = createSpeller(["F#"]);
  const keyChromas = new Set(keyScale.map(pcChromaVal));
  return (midi, note) => (note && note.leadsUp && !keyChromas.has(mod12(midi)) ? sharp(midi) : inKey(midi));
}

/*
  Add a Practice staff for `exercise` (any value parseExercise reads) to the
  tune. `text`, `chords` and `song` are as for buildSoloTune; `text` may
  already carry the Comping / Solo voices. Returns { abc, notes }, or null
  when it can't apply (no chords, no such exercise, an unsupported meter, no
  K: line). `options` is practiceNotes' { rhythms }.
*/
export function buildPracticeTune(text, chords, song, exercise, options = {}) {
  if (!chords || chords.length === 0 || parseExercise(exercise) === null) return null;
  const head = song.lines[0] && song.lines[0].staff[0] && song.lines[0].staff[0].key;
  const scale = keyScaleNotes(head || { root: "C", acc: "", mode: "" }).map(pcChromaVal);
  const notes = practiceNotes(resolveChordNames(chords), exercise, { ...options, key: new Set(scale), tonic: scale[0] });
  const abc = appendBarVoice(text, song, ({ keyScale, keySig, lnum, lden }) => (
    barFragments(notes, chords.length, createPracticeSpeller(keyScale))
      .map((fragment, i, all) => rebeamBar(respellBar(fragment, keySig, i > 0 && endsTied(all[i - 1])), lnum, lden))
  ), { name: "Practice", titleSuffix: "" });
  return abc === null ? null : { abc, notes };
}
