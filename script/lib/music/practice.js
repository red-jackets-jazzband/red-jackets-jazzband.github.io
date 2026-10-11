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
    whole way through (the Rhythm dropdown); every fourth bar ends on a
    breath, at least its last beat rested;
  - a PITCH rule for every onset in it: chord-tone runs, scale runs, guide
    tones (3rds and 7ths), enclosures into each new chord, or one note per
    chord (rhythm alone); a run either voice-leads and turns round every
    chord, or has the same shape over every chord — picked together with
    the run itself in the Practice dropdown ("Scale runs: always up").
  A note that crosses a bar line belongs to the chord it lands on: that is
  what an anticipation is, the new chord played an eighth early.
*/

/*
  What the practice panel offers. PRACTICE_KINDS: what to play, each with a
  one-line hint; `runs` kinds also take a PRACTICE_SHAPES shape — "alternate"
  voice-leads from the last note and turns round every chord, the others give
  every chord the same shape starting on its root (`points`: the little
  contour the panel draws, in a 64×26 box).
*/
export const PRACTICE_KINDS = [
  {
    value: "arpeggios", runs: true, name: tl("practice_arpeggios", "Chord-tone runs"),
    label: tl("practice_kind_arpeggios", "Chord tones"), hint: tl("practice_kind_arpeggios_hint", "root, 3rd, 5th, 7th"),
  },
  {
    value: "scales", runs: true, name: tl("practice_scales", "Scale runs"),
    label: tl("practice_kind_scales", "Scales"), hint: tl("practice_kind_scales_hint", "step through the scale"),
  },
  {
    value: "guide", name: tl("practice_guide", "Guide tones"),
    label: tl("practice_guide", "Guide tones"), hint: tl("practice_kind_guide_hint", "3rds and 7ths"),
  },
  {
    value: "enclosures", name: tl("practice_enclosures", "Enclosures"),
    label: tl("practice_enclosures", "Enclosures"), hint: tl("practice_kind_enclosures_hint", "surround the target"),
  },
  {
    value: "rhythm", name: tl("practice_rhythm", "Rhythm on one note"),
    label: tl("practice_kind_rhythm", "One note"), hint: tl("practice_kind_rhythm_hint", "rhythm only"),
  },
];
export const PRACTICE_SHAPES = [
  { value: "alternate", label: tl("practice_shape_alternate", "Voice-led"), points: "4,20 18,8 32,18 46,6 60,16" },
  { value: "up", label: tl("practice_shape_up", "Up"), points: "4,22 18,16 32,10 46,4 50,22 60,16" },
  { value: "down", label: tl("practice_shape_down", "Down"), points: "4,4 18,10 32,16 46,22 50,4 60,10" },
  { value: "updown", label: tl("practice_shape_updown", "Up & down"), points: "4,22 18,13 32,4 46,13 60,20" },
];

// An exercise value ("scales", "scales-up", "guide", ...) <-> its kind and shape.
export function splitExercise(exercise) {
  const [kind, runs] = String(exercise).split("-");
  return { kind, runs: runs === undefined ? "alternate" : runs };
}
export function joinExercise(kind, shape) {
  const found = PRACTICE_KINDS.find((k) => k.value === kind);
  return found && found.runs && shape !== "alternate" ? `${kind}-${shape}` : kind;
}

// Every exercise value the settings accept: each run kind in each shape, then the rest.
export const PRACTICE_EXERCISES = PRACTICE_KINDS.flatMap((kind) => (kind.runs
  ? PRACTICE_SHAPES.map((shape) => joinExercise(kind.value, shape.value))
  : [kind.value]));

// General MIDI trumpet: the Mixer's Practice voice default.
export const PRACTICE_PROGRAM = 56;

const SLOTS_PER_BAR = 8;
const SLOTS_PER_BEAT = 2;
const CELL_BARS = 2;

/*
  The Rhythm dropdown's patterns. `cell` is one bar in eighths: "x" a note
  starts, "-" it holds, "." a rest; a trailing ">" ties the bar's last note
  over the bar line (the next bar's first eighth becomes its continuation).
  The mixes (PRACTICE_RHYTHM_MIXES) cycle through the exercise's own set
  (`run` ones for the runs, `long` ones for guide tones) — all of it, or
  only the `sync` ones: a note on an "and" held over the next beat or bar
  line, or a beat left out for an offbeat; picking a pattern plays it all
  the way.
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
const SYNC_CELLS = new Set(PRACTICE_RHYTHMS.filter((r) => r.sync).map((r) => r.cell));

// The Rhythm choices that cycle (every CELL_BARS bars) rather than keep one pattern.
export const PRACTICE_RHYTHM_MIXES = [
  {
    value: "varied",
    choice: tl("practice_mix_varied", "Varied"),
    short: tl("practice_rhythm_varied_short", "Varied rhythm"),
  },
  {
    value: "syncopated",
    choice: tl("practice_mix_syncopated", "Syncopated"),
    short: tl("practice_rhythm_syncopated_short", "Syncopated rhythm"),
  },
];

/*
  What's set, in two parts — { exercise: "Scale runs, Up & down", rhythm:
  "Syncopated rhythm" } — or null when practice is off. The closed practice
  control shows them side by side, or stacked on a phone.
*/
export function practiceSummaryParts(practice, rhythm) {
  if (practice === "off") return null;
  const { kind, runs } = splitExercise(practice);
  const found = PRACTICE_KINDS.find((k) => k.value === kind);
  if (!found) return null;
  const shape = PRACTICE_SHAPES.find((s) => s.value === runs);
  const what = found.runs && shape
    ? tl("practice_summary_run", "{kind}, {shape}", { kind: found.name, shape: shape.label })
    : found.name;
  const mix = PRACTICE_RHYTHM_MIXES.find((m) => m.value === rhythm);
  const pattern = PRACTICE_RHYTHMS.find((r) => r.value === rhythm);
  let rhythmName = PRACTICE_RHYTHM_MIXES[0].short;
  if (mix) rhythmName = mix.short;
  else if (pattern) rhythmName = pattern.label;
  return { exercise: what, rhythm: rhythmName };
}

// The same as one line: "Scale runs, Up & down · Syncopated rhythm", or "Off".
export function practiceSummary(practice, rhythm) {
  const parts = practiceSummaryParts(practice, rhythm);
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
const chordTones = (chord, range) => pitchesOf(chord, chord.tones, range);
const scaleTones = (chord, range) => pitchesOf(chord, chord.scale, range);
const guideTones = (chord) => pitchesOf(chord, chord.guide);
const isChordTone = (chord, midi) => chord.tones.includes(mod12(midi - chord.root));

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
      if (tieIn && body[0] === "x") body = "-" + body.slice(1);
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
function runStart(runs, chord, prev, walk, size) {
  if (runs === "alternate") {
    // Voice-led from the last note, the other way round from last time.
    walk.dir = -walk.dir;
    return nearest(chordTones(chord), prev);
  }
  // Up then down over one chord; with too few notes for that (a Charleston's
  // two), every other chord goes up and the ones between come down.
  walk.flip = !walk.flip;
  let shape = runs;
  if (runs === "updown" && size < UPDOWN_MIN_NOTES) shape = walk.flip ? "up" : "down";
  // A fixed shape: no voice leading, every chord jumps to its root and the
  // run stays in that root's octave (octaveRange).
  const root = pitchesOf(chord, [0], RUN_ROOTS)[0];
  walk.range = octaveRange(runs, root, walk.withOctave);
  walk.dir = shape === "down" ? -1 : 1;
  const start = shape === "down" ? root + 12 : root;
  walk.restart = runs === "updown" ? null : start;
  return start;
}

/*
  The one octave a fixed-shape run moves in. A scale run (`withOctave`) and
  an up-then-down run take root to octave, both ends; an arpeggio that only
  goes one way leaves out the far root, so it repeats root-3-5-7 going up
  (octave-7-5-3 going down) instead of doubling the root at the turn.
*/
function octaveRange(runs, root, withOctave) {
  if (withOctave || runs === "updown") return { low: root, high: root + 12 };
  return runs === "down" ? { low: root + 1, high: root + 12 } : { low: root, high: root + 11 };
}

/*
  A run over each chord, walking `pool` from a chord tone. `runs` (a
  RUN_SHAPES value) sets its shape: "alternate" starts on the chord tone
  nearest the last note (so the line voice-leads through the changes) and
  goes up over one chord, down over the next; the others don't voice-lead
  but jump to the chord's root at every new chord (so every bar starts on
  one): "up" climbs from the root, "down" falls from its octave, and
  "updown" climbs from the root to the note after the middle of the chord's
  notes and comes back down (or, over a chord with fewer than four notes,
  climbs over one chord and falls over the next) — all within one octave of
  the root. `withOctave`:
  the pool is a scale, whose run spans root to octave.
*/
function runPitches(notes, pool, runs = "alternate", withOctave = false) {
  // Flipped at the first chord, so an alternating line opens going up.
  const walk = { dir: -1, restart: null, range: undefined, withOctave, flip: false };
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
      const scale = pool(note.at.chord, walk.range);
      const next = stepThrough(scale, prev, walk);
      const following = all[i + 1] !== undefined && all[i + 1].at.id === segment ? all[i + 1] : undefined;
      prev = withOctave ? alignToBeat({ chord: note.at.chord, pool: scale, walk }, prev, next, note, following) : next;
    } else {
      segment = note.at.id;
      index = 0;
      prev = runStart(runs, note.at.chord, prev, walk, sizes.get(segment));
    }
    pools.push(pool(note.at.chord, walk.range));
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

// One note per chord: rhythm alone, on the guide tone nearest the last one —
// the tonic over the last chord.
function rhythmPitches(notes, runs, tonic) {
  const out = [];
  let prev = START;
  segmentsOf(notes).forEach((seg, k, segs) => {
    const home = k === segs.length - 1 ? homeNotes(seg.chord, tonic) : [];
    prev = nearest(home.length > 0 ? home : guideTones(seg.chord), prev);
    for (let i = seg.start; i < seg.end; i++) out.push(prev);
  });
  return out;
}

/*
  Enclosures: each chord's target — its 3rd or 7th (or 6th), the one nearest
  the last note; over the tune's last chord, the tonic — is enclosed by the scale step above and the half step
  below, and lands on the strongest note the rhythm gives it (targetIndex):
  a long note, on a beat, with room for both approach notes before it. The
  approach notes come from the chord's own notes when they can, else from
  the end of the chord before when it runs straight into it (a long target
  on the downbeat: the two notes before the bar line enclose it). Notes
  before the enclosure walk the chord's tones towards it; notes after the
  target run on through them, up over one chord and down over the next.
*/
function approachRoom(notes, seg, prevSeg, locked) {
  let room = 0;
  if (prevSeg === undefined) return room;
  for (let i = seg.start - 1; room < 2 && i >= prevSeg.start && !locked.has(i); i--) {
    if (notes[i + 1].slot - (notes[i].slot + notes[i].len) > LEAD_GAP) break;
    room += 1;
  }
  return room;
}

// Which note of the chord (0-based) the target lands on: the best score.
function targetIndex(notes, seg, crossRoom) {
  let best = 0;
  let bestScore = -1;
  for (let t = 0; t < seg.end - seg.start; t++) {
    const note = notes[seg.start + t];
    const room = [crossRoom / 4, 0.5, 1][Math.min(t, 2)];
    const score = note.len + (note.slot % SLOTS_PER_BEAT === 0 ? 1 : 0) + room;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

// `count` chord tones falling onto the enclosure from just above it (or,
// with no room up there, rising from just below), never the target itself.
function leadIn(tones, approach, count) {
  if (count <= 0) return [];
  const above = tones.filter((m) => m > approach[0]).slice(0, count).reverse();
  if (above.length === count) return above;
  return tones.filter((m) => m < approach[1]).slice(-count);
}

function enclosurePitches(notes, runs, tonic) {
  const out = [];
  const locked = new Set();
  let dir = 1;
  segmentsOf(notes).forEach((seg, k, segs) => {
    const { chord } = seg;
    const before = out.length > 0 ? out[out.length - 1] : START;
    // The last chord's target is the tonic, when it's one of its tones.
    const home = k === segs.length - 1 ? homeNotes(chord, tonic) : [];
    const target = nearest(home.length > 0 ? home : guideTones(chord), before);
    const up = scaleTones(chord).find((m) => m > target);
    const approach = [up === undefined ? target + 2 : up, target - 1];
    const t = targetIndex(notes, seg, approachRoom(notes, seg, segs[k - 1], locked));
    const at = seg.start + t;
    // Approach notes: as many of the two as fit before the target, in this chord or the last.
    const room = t >= 2 ? 2 : Math.max(t, approachRoom(notes, seg, segs[k - 1], locked));
    const tones = chordTones(chord);
    out.push(...leadIn(tones, approach, at - 2 - seg.start));
    for (let j = 0; j < Math.min(t, 2); j++) out.push(null);
    out.push(target);
    approach.slice(2 - room).forEach((m, j) => {
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

const EXERCISES = {
  arpeggios: { cells: RUN_CELLS, pitches: (notes, runs) => runPitches(notes, chordTones, runs) },
  scales: { cells: RUN_CELLS, pitches: (notes, runs) => runPitches(notes, scaleTones, runs, true) },
  guide: { cells: LONG_CELLS, pitches: guidePitches },
  enclosures: { cells: RUN_CELLS, pitches: enclosurePitches },
  rhythm: { cells: RUN_CELLS, pitches: rhythmPitches },
};

// The cells an exercise cycles through: its own set, or the one picked.
function cellsFor(spec, rhythm) {
  if (rhythm === "syncopated") return spec.cells.filter((cell) => SYNC_CELLS.has(cell));
  const picked = PRACTICE_RHYTHMS.find((r) => r.value === rhythm);
  return picked ? [picked.cell] : spec.cells;
}

/*
  The exercise's notes over `names` (resolveChordNames' per-bar chord rows),
  as [{ start, duration, midi, leadsUp }] in beats from the first chord bar — the
  shape solo.js's barFragments draws. Empty for an unknown exercise.
  `rhythm` is a PRACTICE_RHYTHM_MIXES value ("varied", "syncopated") or a
  PRACTICE_RHYTHMS one to keep all the way;
  `breathEvery` how many bars to a breath (0: none, for the tests); `key`
  the tune's key as a Set of pitch-class chromas, which picks each chord's
  scale tensions (null: the default scales); `tonic` its tonic's chroma, the
  note the exercise ends on (and an enclosure's last target) when the last
  chord holds it (null: no such ending).
*/
export function practiceNotes(names, exercise, {
  rhythm = "varied", breathEvery = BREATH_EVERY, key = null, tonic = null,
} = {}) {
  const { kind, runs } = splitExercise(exercise);
  const spec = EXERCISES[kind];
  if (!spec) return [];
  const breaks = new Set();
  names.forEach((row, bar) => {
    if (row.every((name) => name === null)) breaks.add(bar);
  });
  const timeline = chordTimeline(names, key);
  const notes = onsetsOf(rhythmSlots(names.length, breaks, cellsFor(spec, rhythm), breathEvery))
    .map((note) => ({ ...note, at: chordFor(timeline, note) }))
    .filter((note) => note.at);
  const midis = spec.pitches(notes, runs, tonic);
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
  Add a Practice staff for `exercise` (a PRACTICE_EXERCISES value) to the
  tune. `text`, `chords` and `song` are as for buildSoloTune; `text` may
  already carry the Comping / Solo voices. Returns { abc, notes }, or null
  when it can't apply (no chords, no such exercise, an unsupported meter, no
  K: line). `options` is practiceNotes' { rhythm }.
*/
export function buildPracticeTune(text, chords, song, exercise, options = {}) {
  if (!chords || chords.length === 0 || !EXERCISES[splitExercise(exercise).kind]) return null;
  const head = song.lines[0] && song.lines[0].staff[0] && song.lines[0].staff[0].key;
  const scale = keyScaleNotes(head || { root: "C", acc: "", mode: "" }).map(pcChromaVal);
  const notes = practiceNotes(resolveChordNames(chords), exercise, { ...options, key: new Set(scale), tonic: scale[0] });
  const abc = appendBarVoice(text, song, ({ keyScale, keySig, lnum, lden }) => (
    barFragments(notes, chords.length, createPracticeSpeller(keyScale))
      .map((fragment, i, all) => rebeamBar(respellBar(fragment, keySig, i > 0 && endsTied(all[i - 1])), lnum, lden))
  ), { name: "Practice", titleSuffix: "" });
  return abc === null ? null : { abc, notes };
}
