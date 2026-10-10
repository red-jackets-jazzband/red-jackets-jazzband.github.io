/*
  Named chord progressions for the "Named progressions" layer — the
  traditional-jazz vocabulary Pops Coffee teaches on his blog "Playing
  Traditional Jazz" (playing-traditional-jazz.blogspot.com):

    Four-Leaf    I | II7 | V7 | I        Post 41 / Post 413 ("I'm Looking
                                          Over a Four-Leaf Clover")
    Salty Dog    VI7 | II7 | V7 | I      Post 92
    Georgia      I | III7 | VI7          Post 139 (usually carries on into
                                          a Salty Dog: II7 V7 I)
    Sunshine     IV | IVm | I | VI7 |    Post 565 (the last eight bars of
                 II7 | V7 | I | I         so many 32-bar tunes; IVm may be
                                          #IV dim, II7 may be IIm7)
    Apple Tree   I | IV | I              Post 41 — an opening pattern, so
                                          only matched where a part starts

  findNamedProgressions(song) walks the parsed tune's chord symbols (first
  voice) and returns where each one sits: [{ id, name, startNote, endNote,
  lineStarts }] — `startNote`/`endNote` index the first voice's notes and
  rests in order (the match is [startNote, endNote)), which stay the same
  however the text is annotated afterwards; `chordNotes` indexes the notes
  that carry a chord symbol inside the match (what the sheet marks —
  including a chord restated at the start of a printed line); `lineStarts`
  is the source offset of the match's first note on every printed line it
  covers.

  Matching is deliberately strict, so a label means what it says: each
  chord of the pattern must last at least a bar (half a bar for Sunshine;
  the closing I may be shorter), in a major key. A short chromatic approach chord (half a bar or
  less, like the A♭7 in Basin Street's G7 | A♭7 G7 | C7) is stepped over.
  Two progressions may share a chord — Georgia hands its VI7 straight on to
  a Salty Dog — and then the earlier one's band ends where the next starts.
*/

// The chords the patterns are made of: [semitones above the tonic, quality].
const I = [0, "maj"];
const II7 = [2, "dom"];
const IIm = [2, "min"];
const III7 = [4, "dom"];
const IV = [5, "majOrDom"];
const IVm = [5, "min"];
const SHARP_IV_DIM = [6, "dim"];
const IV_DIM = [5, "dim"];
const V7 = [7, "dom"];
const VI7 = [9, "dom"];
const VIm = [9, "min"];
// Four-Leaf's dominant may be a plain triad (Down in Honky Tonk Town's F).
const V_TRIAD_OR_7 = [7, "majOrDom"];

/*
  Each step lists the chords that may stand there. `minBars` is how long
  each chord must last (in bars): Sunshine's seven-chord shape is distinctive
  enough to be recognised even "compressed into half-bars" (Post 565, e.g.
  At the Jazzband Ball), the short patterns are not.
*/
// Each progression links to the blog post that explains it.
const BLOG = "https://playing-traditional-jazz.blogspot.com/";
const PROGRESSIONS = [
  // Post 565: IV | IVm (or #IV dim) | I | VI7 | II7 (or IIm7) | V7 | I | I.
  // A IV dim in bar 2 (I'm Looking Over a Four-Leaf Clover) counts too.
  // It is eight bars: a IV held longer (Bourbon Street Parade's runs three)
  // only lends its last bar (`trimLead`), the rest is just a long IV.
  { id: "sunshine", name: "Sunshine", url: BLOG + "2017/11/post-565-essential-to-master-sunshine.html", steps: [[IV], [IVm, SHARP_IV_DIM, IV_DIM], [I], [VI7], [II7, IIm], [V7], [I]], minBars: 0.5, trimLead: true },
  { id: "salty-dog", name: "Salty Dog", url: BLOG + "2013/06/salty-dog-chord-progression.html", steps: [[VI7], [II7], [V7], [I]] },
  // Post 41 / 413: the V7 bars may hold a turnaround that comes back to the
  // dominant — F7 | Gm | C7 | F7 (Four-Leaf Clover), F | C7 | F7 (Honky Tonk
  // Town) — before the closing I.
  { id: "four-leaf", name: "Four-Leaf", url: BLOG + "2016/07/a-very-common-pattern.html", steps: [[I], [II7], [V_TRIAD_OR_7], [I]], turnaround: { step: 2, over: [VIm, VI7, II7, IIm], maxChords: 2 } },
  { id: "georgia", name: "Georgia", url: BLOG + "2013/01/the-georgia-chord-progression.html", steps: [[I], [III7], [VI7]] },
  { id: "apple-tree", name: "Apple Tree", url: BLOG + "2013/06/the-apple-tree-chord-progression.html", steps: [[I], [IV], [I]], opening: true },
];

export const PROGRESSION_NAMES = PROGRESSIONS.map((p) => p.name);

// The label a progression wears on the sheet: "Sunshine progression".
export const PROGRESSION_WORD = "progression";
export function progressionLabel(name) {
  return `${name} ${PROGRESSION_WORD}`;
}

const NATURALS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTALS = { "#": 1, "♯": 1, b: -1, "♭": -1 };
const KEY_ACC = { sharp: 1, flat: -1, "#": 1, b: -1 };

/*
  A chord symbol as { root: 0-11, quality: "maj" | "min" | "dom" | "dim" |
  "hdim" | "aug" }, or null when it isn't one (N.C., an annotation...). The
  bass note after a slash doesn't change the function (B♭/D is still I).
*/
export function parseChordSymbol(name) {
  if (typeof name !== "string" || name.length === 0) return null;
  const natural = NATURALS[name[0]];
  if (natural === undefined) return null;
  let i = 1;
  let root = natural;
  while (i < name.length && ACCIDENTALS[name[i]] !== undefined && !name.startsWith("b5", i)) {
    root += ACCIDENTALS[name[i]];
    i += 1;
  }
  const slash = name.indexOf("/", i);
  const rest = slash === -1 ? name.slice(i) : name.slice(i, slash);
  return { root: (root + 12) % 12, quality: chordQuality(rest) };
}

function hasSeventhOrMore(rest) {
  return ["7", "9", "11", "13"].some((n) => rest.includes(n));
}

function minorQuality(rest) {
  return rest.includes("7b5") || rest.includes("7♭5") ? "hdim" : "min";
}

const startsWithAny = (rest, prefixes) => prefixes.some((p) => rest.startsWith(p));

// Checked in order: "maj7" must win over "m", "m7b5" over plain minor.
const QUALITY_RULES = [
  [(rest) => startsWithAny(rest, ["maj", "Maj", "M", "Δ"]), () => "maj"],
  [(rest) => rest.includes("ø"), () => "hdim"],
  [(rest) => startsWithAny(rest, ["dim", "°", "o"]), () => "dim"],
  [(rest) => startsWithAny(rest, ["m", "-"]), minorQuality],
  [(rest) => startsWithAny(rest, ["+", "aug"]), (rest) => (hasSeventhOrMore(rest) ? "dom" : "aug")],
];

function chordQuality(rest) {
  const rule = QUALITY_RULES.find(([applies]) => applies(rest));
  if (rule) return rule[1](rest);
  return hasSeventhOrMore(rest) && !rest.startsWith("6") ? "dom" : "maj";
}

function qualityFits(wanted, quality) {
  if (wanted === "majOrDom") return quality === "maj" || quality === "dom";
  return wanted === quality;
}

// The chord symbol an abcjs element carries, if any (annotations have a
// position of their own; a chord symbol's is "default").
function chordName(el) {
  if (!el.chord) return null;
  const symbol = el.chord.find((c) => c.position === "default" || c.position === undefined);
  return symbol ? symbol.name : null;
}

function keyTonic(key) {
  if (!key || NATURALS[key.root] === undefined) return null;
  if (key.mode && key.mode.toLowerCase().startsWith("m")) return null; // minor / modal: not these patterns // NOSONAR
  return (NATURALS[key.root] + (KEY_ACC[key.acc] || 0) + 12) % 12;
}

function meterLength(staff) {
  const meter = staff && staff.meter; // NOSONAR
  if (!meter) return null;
  if (meter.type === "common_time" || meter.type === "cut_time") return 1;
  const v = meter.value && meter.value[0]; // NOSONAR
  return v ? Number(v.num) / Number(v.den) : null;
}

/*
  The tune as a list of harmony segments — one per chord change, merged
  when the next symbol is the same function (B♭ then B♭6) — each with its
  start time and length in bars, plus every note onset (time, offset,
  printed line) for turning times back into source offsets.
*/
function collectHarmony(song) {
  const state = { time: 0, line: -1, segments: [], notes: [], bar: 1, partStart: true, tonic: null };
  song.lines.forEach((line, lineIndex) => {
    const staff = line.staff && line.staff[0]; // NOSONAR
    if (!staff || !staff.voices) return; // NOSONAR
    if (state.tonic === null) state.tonic = keyTonic(staff.key);
    state.bar = meterLength(staff) || state.bar;
    (staff.voices[0] || []).forEach((el) => readElement(el, lineIndex, state));
  });
  closeSegment(state);
  return state;
}

function closeSegment(state) {
  const last = state.segments[state.segments.length - 1];
  if (last && last.end === undefined) last.end = state.time;
}

function startSegment(el, symbol, lineIndex, state) {
  const last = state.segments[state.segments.length - 1];
  const same = last && last.root === symbol.root && last.quality === symbol.quality && last.tonic === state.tonic;
  if (same && !state.partStart) return;
  closeSegment(state);
  state.segments.push({
    root: symbol.root, quality: symbol.quality, tonic: state.tonic,
    start: state.time, line: lineIndex, partStart: state.partStart,
  });
  state.partStart = false;
}

function readElement(el, lineIndex, state) {
  if (el.el_type === "part") state.partStart = true;
  if (el.el_type === "keySignature") state.tonic = keyTonic(el);
  const name = chordName(el);
  const symbol = name === null ? null : parseChordSymbol(name);
  if (symbol) startSegment(el, symbol, lineIndex, state);
  if (el.el_type === "note") {
    state.notes.push({ time: state.time, startChar: el.startChar, line: lineIndex, hasChord: symbol !== null });
    state.time += el.duration || 0;
  }
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
    if (stepEnd - stepStart < minLength - EPS && !(closing && isTonicStep(steps[s]))) return null;
    if (closing) {
      return {
        last: at, closingFirst: stepFirst, start: patternStart(progression, spans[0], bar),
        end: Math.min(stepEnd, stepStart + bar),
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
  let at = from;
  while (at + 2 < segments.length && isPassing(segments[at + 1], bar) && fitsStep(segments[at + 2], step)) at += 2;
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

// Where the match starts: a `trimLead` pattern's lead chord held for longer
// than a bar only lends its last bar.
function patternStart(progression, lead, bar) {
  const overlong = progression.trimLead && lead.end - lead.start > bar + EPS;
  return overlong ? lead.end - bar : lead.start;
}

// Is segment `at` a short approach chord into one that fits `next`?
function approachChord(segments, at, next, bar) {
  return at + 1 < segments.length && isPassing(segments[at], bar)
    && !fitsStep(segments[at], next) && fitsStep(segments[at + 1], next);
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

// The first progression (in PROGRESSIONS order) that matches from segment i.
function firstMatchAt(segments, i, bar) {
  for (const p of PROGRESSIONS) {
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
    const endTime = next && next.start < m.end ? next.start : m.end;
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
