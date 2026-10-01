// Genetic-algorithm solo / counter-line generator in New Orleans style: given
// a chord progression it evolves a line for one front-line voice (trumpet
// lead, clarinet above, tailgate trombone below, or a free solo), the same
// way lib/comping.js generates the Comping voice from the chord symbols.
// Pure: no DOM, no timers, no globals — a seeded RNG makes every take
// reproducible, so it's plain unit-testable.
//
// Engine after Papadopoulos & Wiggins (1998), "A Genetic Algorithm for the
// Generation of Jazz Melodies": pitches are stored as SCALE DEGREES of the
// chord sounding at that moment (so every genome is in key by construction),
// genomes evolve with musically meaningful mutations (transpose, invert,
// retrograde, sort, repeat a lick, perturb, approach/enclosure), and fitness
// is an automatic weighted sum of melodic rules — one small scorer per rule
// below, each named after the stylistic finding it encodes.
//
// Sources for the rules:
//  [D]  Dicpetris (2016), "Performance Aspects of the New Orleans Jazz Style:
//       A Guide for Jazz Musicians", Univ. of Miami, ch. 4-5.
//  [I]  Ingham, "Improvisation in Early Jazz" (PhD thesis on Kid Ory).
//  [CC] Collier & Collier (2002), "A Study of Timing in Two Louis Armstrong
//       Solos", Music Perception — Armstrong plays fairly close to the beat,
//       swing ratio about 1.6:1.
//  [N]  Nelias et al. (2022), "Downbeat delays are a key component of swing
//       in jazz", Communications Physics — soloists delay downbeats ~30 ms
//       (at ~150 bpm) while their offbeats stay with the rhythm section.
//  [S]  Schuller, "Early Jazz" (1968), ch. on Armstrong — a solo is a few
//       ideas that return with "diversity combined with identity and
//       repetition": the "triple call" (Big Butter and Egg Man: one figure
//       stated three times, each slightly altered), the repeated-note
//       figure, sequence and near repetition (West End Blues), a build to
//       a high point; blue notes belong to the blues choruses.
//       Also from Schuller: phrases that restart on the same high note and
//       fall (the five descending phrases of West End Blues), a long high
//       note released into a repeated phrase in the last chorus, and the
//       bridge as the imaginative climax of a 32-bar chorus.
//  [H]  Harker, "'Telling a Story': Louis Armstrong and Coherence in Early
//       Jazz", Current Musicology 63 (1997) — a solo built as a story with a
//       climax; triadic extensions, blue notes, high-register brilliance.
//
// Output notes sit on a straight eighth-note grid (start/duration in beats).
// The swing itself is the page's tune-wide Mixer Swing (ABCjs's own option),
// and chord parsing goes through Tonal like lib/comping.js does.

// scale = degrees the GA may pick; tones = chord tones; blue = blue notes
// (♭3/♭5 over major & dominant [D4], must resolve by step); ext = upper
// structures welcome on strong beats in Armstrong style [H].
const CHORDS = {
  maj: { scale: [0, 2, 3, 4, 5, 7, 9], tones: [0, 4, 7, 9], blue: [3], ext: [2, 11] },
  dom: { scale: [0, 2, 3, 4, 5, 6, 7, 9, 10], tones: [0, 4, 7, 10], blue: [3, 6], ext: [2, 9] },
  min: { scale: [0, 2, 3, 5, 6, 7, 9, 10], tones: [0, 3, 7, 10], blue: [6], ext: [2, 5] },
  hdim: { scale: [0, 1, 3, 5, 6, 8, 10], tones: [0, 3, 6, 10], blue: [], ext: [] },
  dim: { scale: [0, 2, 3, 5, 6, 8, 9, 11], tones: [0, 3, 6, 9], blue: [], ext: [] },
  aug: { scale: [0, 2, 4, 6, 8, 10], tones: [0, 4, 8, 10], blue: [], ext: [] },
};
// maj7 is rare in New Orleans playing generally [D4]; only Armstrong style gets it.
const MAJOR_WITH_SEVENTH = [0, 2, 3, 4, 5, 7, 9, 11];

/*
  Per-role defaults [D5]. low/high = MIDI range; base = MIDI octave of scale
  degree 0 (a multiple of 12); density = target onsets per bar; phraseWeight
  scales the phrase rules; falls/rips = chance of tagging that articulation;
  approach = weight for chromatic approach notes and enclosures; crossRhythm =
  weight for dotted-quarter (3-against-4) groupings; figures = Armstrong's
  trademark repeated-note figure and "triple call" [S]; arpeggios = descending
  chord-tone arpeggios, ideally landing on the seventh [S]; arc = build the solo to a
  late climax [H]; extensions = upper structures and maj7 [H]; climb =
  clarinet's ascending runs and long high notes; tailgate = roots on 1, fifths
  on 3, gliss into chord changes; below = stay under the voice passed as
  `against`.
*/
export const STYLES = {
  trumpet: {
    low: 58, high: 82, base: 60, density: 4, phraseWeight: 1, falls: 0.35, rips: 0.4, approach: 0.5, crossRhythm: 0.8, arpeggios: true,
  },
  armstrong: {
    low: 58, high: 86, base: 60, density: 5, phraseWeight: 1, falls: 0.3, rips: 0.7,
    approach: 1.5, approachMax: 0.15, crossRhythm: 1.5, arc: true, extensions: true, figures: true, arpeggios: true,
  },
  clarinet: { low: 62, high: 89, base: 72, density: 7, phraseWeight: 0.8, falls: 0, rips: 0, approach: 0.8, crossRhythm: 1, climb: true },
  trombone: { low: 40, high: 67, base: 48, density: 3, phraseWeight: 0.3, falls: 0.3, rips: 0, approach: 0, crossRhythm: 0, tailgate: true },
  tromboneFree: { low: 40, high: 69, base: 48, density: 4, phraseWeight: 1, falls: 0.3, rips: 0, approach: 0.5, crossRhythm: 0.8, below: true },
  solo: { low: 58, high: 84, base: 60, density: 5, phraseWeight: 1, falls: 0.3, rips: 0.3, approach: 0.8, crossRhythm: 1, arc: true },
};

const DEFAULTS = {
  style: "solo", beatsPerBar: 4, melodyWeight: 1, popSize: 60, generations: 160,
  breaks: [], stopTime: [], approachMax: 0.1, melody: null, against: null,
};

// Genome values: a scale degree (>= MIN_DEG), or one of these markers.
const REST = -100;
const HOLD = -99;
const APPROACH_BELOW = -98; // chromatic half step below the next note
const APPROACH_ABOVE = -97; // scale step above the next note
const SUB = 2; // slots per beat: a straight eighth-note grid
const MIN_DEG = -9;
const MAX_DEG = 18;

const isDegree = (v) => v > -50;
const isOnset = (v) => isDegree(v) || v === APPROACH_BELOW || v === APPROACH_ABOVE;
const clampDegree = (d) => Math.max(MIN_DEG, Math.min(MAX_DEG, d));
const mod12 = (x) => ((x % 12) + 12) % 12;

// Chord quality from Tonal's own interval analysis, not from parsing the
// symbol text: the third, fifth and seventh decide which scale/tone set applies.
function chordType(intervals) {
  const has = (interval) => intervals.includes(interval);
  if (has("3m") && has("5d")) {
    return has("7m") ? "hdim" : "dim";
  }
  if (has("5A")) {
    return "aug";
  }
  if (has("3m")) {
    return "min";
  }
  return has("7m") ? "dom" : "maj";
}

/*
  Parse a chord symbol ("F", "C7", "Gm7", "Bdim", "Em7b5", "C7#5") with
  Tonal.Chord.get into its root and the scale/chord-tone sets the GA works
  with. Roots are folded into -5..6 so scale degrees move smoothly across
  chord changes.
*/
export function parseChord(sym) {
  const info = Tonal.Chord.get(sym.trim());
  const rootMidi = info.tonic ? Tonal.Note.midi(`${info.tonic}4`) : null;
  if (!info.intervals || info.intervals.length === 0 || rootMidi === null || rootMidi === undefined) {
    throw new Error(`Unknown chord: ${sym}`);
  }
  const type = chordType(info.intervals);
  const chroma = mod12(rootMidi);
  const root = chroma > 6 ? chroma - 12 : chroma;
  const c = CHORDS[type];
  return { sym, root, type, scale: c.scale, tones: new Set(c.tones), blue: new Set(c.blue), ext: new Set(c.ext) };
}

// mulberry32 — tiny seeded PRNG, so a "take" can be reproduced from its seed.
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Context: everything derived once from the progression + options.

function applyExtensions(chord, enabled) {
  if (!enabled) {
    chord.ext = new Set();
  } else if (chord.type === "maj") {
    chord.scale = MAJOR_WITH_SEVENTH;
  }
}

// A null chord (N.C.) borrows the previous chord's harmony, or the next one's
// at the very start.
function resolveGaps(progression) {
  const names = progression.map((p) => (typeof p === "string" ? p : p.chord));
  const firstNamed = names.find((n) => n !== null);
  let last = firstNamed === undefined ? "C" : firstNamed;
  return names.map((n) => {
    last = n === null ? last : n;
    return last;
  });
}

function buildChordTimeline(progression, o, sub) {
  const names = resolveGaps(progression);
  const chordAt = [];
  progression.forEach((p, k) => {
    const chord = parseChord(names[k]);
    applyExtensions(chord, o.extensions);
    const beats = typeof p === "string" ? o.beatsPerBar : p.beats;
    for (let i = 0; i < beats * sub; i++) {
      chordAt.push(chord);
    }
  });
  return chordAt;
}

// Another voice's notes sampled per slot: sounding pitch + onset flags.
function sampleVoice(notes, sub, total) {
  const pitch = Array.from({ length: total }, () => null);
  const onset = new Uint8Array(total);
  for (const note of notes) {
    const a = Math.round(note.start * sub);
    const b = Math.min(total, Math.round((note.start + note.duration) * sub));
    if (a < total) {
      onset[a] = 1;
      for (let s = a; s < Math.max(b, a + 1); s++) {
        pitch[s] = note.midi;
      }
    }
  }
  return { pitch, onset };
}

function onsetsPerBar(onset, spb, bars) {
  return Array.from({ length: bars }, (_, b) => {
    let k = 0;
    for (let s = b * spb; s < Math.min(onset.length, (b + 1) * spb); s++) {
      k += onset[s];
    }
    return k;
  });
}

function createContext(progression, opts) {
  const merged = { ...DEFAULTS, ...opts };
  const o = { ...DEFAULTS, ...STYLES[merged.style], ...opts, seed: opts.seed === undefined ? Date.now() : opts.seed };
  const sub = SUB;
  const spb = o.beatsPerBar * sub;
  const chordAt = buildChordTimeline(progression, o, sub);
  const total = chordAt.length;
  const bars = Math.ceil(total / spb);
  const ctx = {
    o, sub, spb, total, bars, chordAt,
    rand: createRng(o.seed),
    beatSlots: o.beatsPerBar % 2 === 0 ? [0, spb / 2] : [0],
    breakBar: new Set(o.breaks),
    stopBar: new Set(o.stopTime),
    highQuarter: o.high - (o.high - o.low) / 4,
    mel: null, ag: null, agBar: null,
  };
  if (o.melody) {
    ctx.mel = sampleVoice(o.melody, sub, total);
  }
  if (o.against) {
    ctx.ag = sampleVoice(o.against, sub, total);
    ctx.agBar = onsetsPerBar(ctx.ag.onset, spb, bars);
  }
  return ctx;
}

const randInt = (ctx, a, b) => a + Math.floor(ctx.rand() * (b - a + 1));
const onBeat = (ctx, s) => s % ctx.sub === 0;
const offBeat = (ctx, s) => s % ctx.sub === ctx.sub - 1; // the (swung) "and"
const barOf = (ctx, s) => Math.floor(s / ctx.spb);

function densityOf(ctx, bar) {
  if (ctx.breakBar.has(bar)) {
    return Math.max(ctx.o.density + 2, 6);
  }
  if (ctx.stopBar.has(bar)) {
    return ctx.o.density + 1;
  }
  return ctx.o.density;
}

function midiOf(ctx, deg, s) {
  const chord = ctx.chordAt[s];
  const n = chord.scale.length;
  const octave = Math.floor(deg / n);
  return ctx.o.base + chord.root + 12 * octave + chord.scale[deg - octave * n];
}

const relToRoot = (ctx, midi, s) => mod12(midi - ctx.chordAt[s].root - ctx.o.base);
const isChordTone = (ctx, midi, s) => ctx.chordAt[s].tones.has(relToRoot(ctx, midi, s));
const isBlueNote = (ctx, midi, s) => ctx.chordAt[s].blue.has(relToRoot(ctx, midi, s));

function degreeOf(ctx, midi, s) {
  let best = 0;
  let bestDist = Infinity;
  for (let d = MIN_DEG; d <= MAX_DEG; d++) {
    const dist = Math.abs(midiOf(ctx, d, s) - midi);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Decoding a genome into note events.

function readEvents(ctx, g) {
  const ev = [];
  let cur = null;
  for (let s = 0; s < ctx.total; s++) {
    const v = g[s];
    if (isOnset(v)) {
      const deg = isDegree(v) ? v : null;
      cur = { slot: s, len: 1, deg, app: deg === null ? v : 0, midi: deg === null ? 0 : midiOf(ctx, v, s), ok: true };
      ev.push(cur);
    } else if (v === HOLD && cur) {
      cur.len++;
    } else {
      cur = null;
    }
  }
  return ev;
}

// An approach note takes its pitch from the next real note it leads into.
function resolveApproach(ctx, ev, i) {
  const e = ev[i];
  let j = i + 1;
  while (j < ev.length && ev[j].app) {
    j++;
  }
  const target = ev[j];
  if (target && target.slot - e.slot <= 2 * ctx.sub) {
    e.midi = e.app === APPROACH_BELOW ? target.midi - 1 : midiOf(ctx, target.deg + 1, target.slot);
    e.ok = e.slot + e.len === ev[i + 1].slot && onBeat(ctx, target.slot);
  } else {
    e.ok = false;
    e.midi = midiOf(ctx, 4, e.slot);
  }
}

function decode(ctx, g) {
  const ev = readEvents(ctx, g);
  for (let i = ev.length - 1; i >= 0; i--) {
    if (ev[i].app) {
      resolveApproach(ctx, ev, i);
    }
  }
  return ev;
}

// Phrases = groups of notes separated by at least a quarter rest.
function phrasesOf(ctx, ev) {
  const phrases = [];
  let cur = [];
  for (let i = 0; i < ev.length; i++) {
    const prev = ev[i - 1];
    if (prev && ev[i].slot - (prev.slot + prev.len) >= ctx.sub) {
      phrases.push(cur);
      cur = [];
    }
    cur.push(ev[i]);
  }
  if (cur.length) {
    phrases.push(cur);
  }
  return phrases;
}

function coverage(ctx, ev) {
  const covered = new Uint8Array(ctx.total);
  for (const e of ev) {
    covered.fill(1, e.slot, e.slot + e.len);
  }
  return covered;
}

// Tailgate slide: from beat 2 or later of a bar, tied into the new chord's root.
function isGliss(ctx, e, next) {
  if (!next || e.app || e.slot + e.len !== next.slot) {
    return false;
  }
  if (next.slot % ctx.spb !== 0 || e.slot % ctx.spb < ctx.sub) {
    return false;
  }
  if (ctx.chordAt[e.slot].sym === ctx.chordAt[next.slot].sym || relToRoot(ctx, next.midi, next.slot) !== 0) {
    return false;
  }
  const leap = Math.abs(next.midi - e.midi);
  return leap >= 2 && leap <= 9;
}

const isSyncopated = (ctx, e) => offBeat(ctx, e.slot) && e.len >= 2;

// ---------------------------------------------------------------------------
// Fitness: one scorer per stylistic rule.

function strongBeatScore(ctx, e) {
  if (isChordTone(ctx, e.midi, e.slot)) {
    return 3;
  }
  return ctx.chordAt[e.slot].ext.has(relToRoot(ctx, e.midi, e.slot)) ? 1 : -2.5;
}

// A blue note is spice, not staple: it must resolve by step [D4].
function blueNoteScore(e, next) {
  const resolves = Boolean(next) && Math.abs(next.midi - e.midi) <= 2 && next.slot === e.slot + e.len;
  return resolves ? 0.1 : -4;
}

// Arpeggio tones on beats 1 & 3 [D4]; approach notes must lead somewhere [H].
function harmonyScore(ctx, ev, i) {
  const e = ev[i];
  if (e.app) {
    return e.ok ? 1.5 * ctx.o.approach - 0.5 : -3;
  }
  let f = 0;
  if (ctx.beatSlots.includes(e.slot % ctx.spb)) {
    f += strongBeatScore(ctx, e);
  } else if (onBeat(ctx, e.slot) && isChordTone(ctx, e.midi, e.slot)) {
    f += 0.7;
  }
  if (isBlueNote(ctx, e.midi, e.slot)) {
    f += blueNoteScore(e, ev[i + 1]);
  }
  return f;
}

// Range, ragtime syncopation [D4], clarinet's high notes [D5].
function placementScore(ctx, e) {
  let f = 0;
  if (e.midi < ctx.o.low || e.midi > ctx.o.high) {
    f -= 6;
  }
  if (isSyncopated(ctx, e)) {
    f += ctx.stopBar.has(barOf(ctx, e.slot)) ? 1.6 : 0.8;
  }
  if (ctx.o.climb && e.len >= 2 * ctx.sub && e.midi >= ctx.highQuarter) {
    f += 1.5;
  }
  return f;
}

function tailgateBeatScore(rel, wanted, chordTone, bonus) {
  if (rel === wanted) {
    return bonus;
  }
  return chordTone ? 0.5 : -1;
}

// Tailgate trombone [D5]: root on 1, fifth on 3, rests on 2 & 4, gliss into changes.
function tailgateScore(ctx, e, next) {
  const posInBar = e.slot % ctx.spb;
  const rel = relToRoot(ctx, e.midi, e.slot);
  const chordTone = isChordTone(ctx, e.midi, e.slot);
  const gliss = isGliss(ctx, e, next);
  let f = 0;
  if (gliss) {
    f += rel === 0 ? 4 : 3;
  }
  if (posInBar === 0) {
    f += tailgateBeatScore(rel, 0, chordTone, 2.5);
  } else if (posInBar === ctx.spb / 2) {
    f += tailgateBeatScore(rel, 7, chordTone, 1.5);
  } else if (!gliss) {
    f -= onBeat(ctx, e.slot) ? 0.6 : 1.2;
  }
  return f;
}

function isSixFlatThree(ctx, p, e) {
  const from = relToRoot(ctx, p.midi, p.slot);
  const to = relToRoot(ctx, e.midi, e.slot);
  return (from === 9 && to === 3) || (from === 3 && to === 9);
}

// Arpeggiated rather than linear [D4]; the 6-to-♭3 tritone is a favourite.
function intervalScore(ctx, p, e, size) {
  const bothChordTones = isChordTone(ctx, e.midi, e.slot) && isChordTone(ctx, p.midi, p.slot);
  if (size <= 2) {
    return 1.2;
  }
  if (size <= 5) {
    return bothChordTones ? 2.5 : 0.3;
  }
  if (size === 6) {
    return isSixFlatThree(ctx, p, e) ? 2.5 : -1;
  }
  if (size === 7) {
    return bothChordTones ? 1 : -1;
  }
  if (size <= 12) {
    return bothChordTones ? -0.5 : -2;
  }
  return -6;
}

const leapRecovered = (prevIv, iv) => Math.abs(prevIv) > 5 && Math.abs(iv) <= 2 && Math.sign(iv) === -Math.sign(prevIv);

function resolvesEmbellishment(ctx, p, e) {
  return !p.app && !isChordTone(ctx, p.midi, p.slot) && isChordTone(ctx, e.midi, e.slot) && Math.abs(e.midi - p.midi) <= 2;
}

// No long scalar runs [D4]; the clarinet may climb a little further [D5].
function runPenalty(ctx, iv, st) {
  const size = Math.abs(iv);
  const sameDir = Math.sign(iv) === Math.sign(st.prevIv);
  const climbing = Boolean(ctx.o.climb) && iv > 0;
  st.stepRun = size > 0 && size <= 2 && sameDir ? st.stepRun + 1 : 0;
  st.dirRun = iv !== 0 && sameDir ? st.dirRun + 1 : 0;
  let f = 0;
  if (st.stepRun > 3 && !climbing) {
    f -= 2;
  }
  if (st.dirRun > (climbing ? 7 : 5)) {
    f -= 1.5;
  }
  return f;
}

function motionScore(ctx, ev, i, st) {
  const p = ev[i - 1];
  const e = ev[i];
  const iv = e.midi - p.midi;
  let f = 0;
  if (iv === 0) {
    st.repeats++;
    f += st.repeats <= 2 ? 0.3 : -1.5; // a few repeats = resolution [D4]
  } else {
    st.repeats = 0;
    f += intervalScore(ctx, p, e, Math.abs(iv));
  }
  if (leapRecovered(st.prevIv, iv)) {
    f += 1.5;
  }
  if (resolvesEmbellishment(ctx, p, e)) {
    f += 1;
  }
  f += runPenalty(ctx, iv, st);
  if (iv !== 0) {
    st.prevIv = iv;
  }
  return f;
}

function notesScore(ctx, ev) {
  const st = { prevIv: 0, stepRun: 0, dirRun: 0, repeats: 0 };
  let f = 0;
  for (let i = 0; i < ev.length; i++) {
    f += harmonyScore(ctx, ev, i) + placementScore(ctx, ev[i]);
    if (ctx.o.tailgate) {
      f += tailgateScore(ctx, ev[i], ev[i + 1]);
    }
    if (i > 0) {
      f += motionScore(ctx, ev, i, st);
    }
  }
  return f;
}

function barStats(ctx, g, bar) {
  let onsets = 0;
  let mask = "";
  for (let s = bar * ctx.spb; s < Math.min(ctx.total, (bar + 1) * ctx.spb); s++) {
    const on = isOnset(g[s]);
    if (on) {
      onsets++;
    }
    if (on) {
      mask += "x";
    } else {
      mask += g[s] === REST ? "." : "-";
    }
  }
  return { onsets, mask };
}

function barContour(ctx, ev, bar) {
  const lo = bar * ctx.spb;
  const inBar = ev.filter((e) => e.slot >= lo && e.slot < lo + ctx.spb);
  return inBar.slice(1).map((e, k) => Math.sign(e.midi - inBar[k].midi)).join("");
}

function countUncovered(covered, from, to) {
  let k = 0;
  for (let s = from; s < Math.min(covered.length, to); s++) {
    k += covered[s] ? 0 : 1;
  }
  return k;
}

// Target density; a break is played through.
function barDensityScore(ctx, bar, stats, covered) {
  let f = -1.2 * Math.abs(stats.onsets - densityOf(ctx, bar));
  if (ctx.breakBar.has(bar)) {
    f -= 0.5 * countUncovered(covered, bar * ctx.spb, (bar + 1) * ctx.spb);
  }
  return f;
}

// Riffs and reused licks [D4][I]: a rhythm or contour echoed 1-2 bars later.
function repetitionScore(history, bar, stats, contour) {
  let f = 0;
  for (const back of [1, 2]) {
    if (bar >= back) {
      if (stats.mask === history.masks[bar - back] && stats.onsets > 1) {
        f += 1.5;
      }
      if (contour.length > 1 && contour === history.contours[bar - back]) {
        f += 1;
      }
    }
  }
  return f;
}

// Polyphony [D5]: two voices busy while the third is sparse; busy lines take turns.
function polyphonyScore(ctx, bar, onsets) {
  if (!ctx.ag) {
    return 0;
  }
  const theirsBusy = ctx.agBar[bar] >= 5;
  const mineBusy = onsets >= 5;
  if (theirsBusy && mineBusy) {
    return -3;
  }
  return theirsBusy === mineBusy ? 0 : 1;
}

// Two bars are the same idea when every slot matches: the same rests/holds,
// and the same scale degrees up to one constant shift (a sequence).
function sameIdea(ctx, g, a, b) {
  let shift = null;
  let degrees = 0;
  for (let i = 0; i < ctx.spb; i++) {
    const x = g[a * ctx.spb + i];
    const y = g[b * ctx.spb + i];
    if (isDegree(x) !== isDegree(y) || (!isDegree(x) && x !== y)) {
      return false;
    }
    if (isDegree(x)) {
      degrees++;
      shift = shift === null ? y - x : shift;
      if (y - x !== shift) {
        return false;
      }
    }
  }
  return degrees >= 3;
}

// A solo is built from a few ideas that come back (answered, repeated, moved
// up or down), not a new thought every bar: reward an idea returning one, two
// or four bars later (the phrase length), and penalise too many distinct ones.
const IDEA_LAGS = [[1, 0.8], [2, 1.2], [4, 1.5]];

function ideaScore(ctx, g) {
  if (ctx.o.tailgate || ctx.ag) {
    return 0; // a part that follows the lead and the changes repeats nothing of its own
  }
  let f = 0;
  for (let bar = 1; bar < ctx.bars; bar++) {
    for (const [lag, reward] of IDEA_LAGS) {
      if (bar >= lag && sameIdea(ctx, g, bar - lag, bar)) {
        f += reward;
        break;
      }
    }
    if (bar >= 2 && sameIdea(ctx, g, bar - 1, bar) && sameIdea(ctx, g, bar - 2, bar - 1)) {
      f += 0.6; // the triple call [S]
    }
  }
  return f;
}

function barsScore(ctx, g, ev, covered) {
  const history = { masks: [], contours: [] };
  let f = 0;
  for (let bar = 0; bar < ctx.bars; bar++) {
    const stats = barStats(ctx, g, bar);
    const contour = barContour(ctx, ev, bar);
    f += barDensityScore(ctx, bar, stats, covered);
    f += repetitionScore(history, bar, stats, contour);
    f += polyphonyScore(ctx, bar, stats.onsets);
    history.masks.push(stats.mask);
    history.contours.push(contour);
  }
  // Ideas return, but the rhythm still has to move: a handful of distinct bars at least.
  const distinct = new Set(history.masks).size;
  return f - 2 * Math.max(0, Math.floor(ctx.bars / 4) + 1 - distinct);
}

// A break lands on the downbeat after it.
function breakLandingScore(ctx, g) {
  let f = 0;
  for (const bar of ctx.breakBar) {
    const landing = (bar + 1) * ctx.spb;
    if (!ctx.breakBar.has(bar + 1) && landing < ctx.total) {
      f += isOnset(g[landing]) ? 2.5 : -1.5;
    }
  }
  return f;
}

// Approach notes are ornaments, not the line.
// Armstrong's repeated-note figure [S]: three or more equal notes in a row,
// one or two per solo.
function repeatedNoteScore(ctx, ev) {
  if (!ctx.o.figures) {
    return 0;
  }
  let figures = 0;
  for (let i = 0; i + 2 < ev.length; i++) {
    const [a, b, c] = [ev[i], ev[i + 1], ev[i + 2]];
    const joined = !a.app && a.midi === b.midi && b.midi === c.midi && a.slot + a.len === b.slot && b.slot + b.len === c.slot;
    figures += joined && a.len <= 2 ? 1 : 0;
  }
  return 2 * Math.min(figures, Math.max(1, Math.round(ctx.bars / 6))) - 1.5 * Math.max(0, figures - Math.ceil(ctx.bars / 4));
}

// A descending arpeggio [S]: three or more notes in a row, each a chord tone a
// third or more below the last. Landing on the seventh earns a little extra.
function arpeggioScore(ctx, ev) {
  if (!ctx.o.arpeggios) {
    return 0;
  }
  let runs = 0;
  let sevenths = 0;
  let len = 1;
  for (let i = 1; i <= ev.length; i++) {
    const a = ev[i - 1];
    const b = ev[i];
    const steps = b && !a.app && !b.app && a.slot + a.len === b.slot && a.midi - b.midi >= 3 && a.midi - b.midi <= 7;
    if (steps && isChordTone(ctx, a.midi, a.slot) && isChordTone(ctx, b.midi, b.slot)) {
      len++;
    } else {
      const seventh = [10, 11].includes(relToRoot(ctx, a.midi, a.slot));
      runs += len >= 3 ? 1 : 0;
      sevenths += len >= 3 && seventh ? 1 : 0;
      len = 1;
    }
  }
  const wanted = Math.max(1, Math.round(ctx.bars / 4));
  return 2.5 * Math.min(runs, wanted) + Math.min(sevenths, wanted) - 2 * Math.max(0, runs - wanted - 1);
}

// Phrases restarting on the same high note and falling away [S]: each pair of
// neighbouring phrases that begin on one high pitch and end lower counts.
function phraseRecallScore(ctx, ev) {
  if (!ctx.o.figures) {
    return 0;
  }
  const high = ctx.o.low + 0.6 * (ctx.o.high - ctx.o.low);
  const phrases = phrasesOf(ctx, ev);
  let pairs = 0;
  for (let i = 1; i < phrases.length; i++) {
    const [prev, cur] = [phrases[i - 1], phrases[i]];
    const same = cur[0].midi === prev[0].midi && cur[0].midi >= high;
    const falls = cur[cur.length - 1].midi < cur[0].midi - 2 && prev[prev.length - 1].midi < prev[0].midi - 2;
    pairs += same && falls ? 1 : 0;
  }
  return 1.2 * Math.min(pairs, 4);
}

// The last chorus [S]: a long high note held, then released into a repeated
// phrase. Counts a note of two beats or more in the top quarter of the range
// in the final third, plus a repeated-note figure after it.
function finaleScore(ctx, ev) {
  if (!ctx.o.figures) {
    return 0;
  }
  const from = Math.floor(ctx.total * 0.62);
  const heldIndex = ev.findIndex((e) => e.slot >= from && !e.app && e.len >= 2 * ctx.sub && e.midi >= ctx.highQuarter);
  if (heldIndex === -1) {
    return 0;
  }
  const after = ev.slice(heldIndex + 1, heldIndex + 7);
  const repeated = after.some((e, k) => k >= 2 && e.midi === after[k - 1].midi && e.midi === after[k - 2].midi);
  return 9 + (repeated ? 3 : 0); // outweighs the bar-density target a long note gives up
}

// The bridge of an AABA chorus is its imaginative climax [S]: sit higher there.
function bridgeScore(ctx, ev) {
  if (!ctx.o.figures || ctx.bars < 24 || ctx.bars % 8 !== 0) {
    return 0;
  }
  const [from, to] = [ctx.bars / 2 * ctx.spb, ctx.bars * 3 / 4 * ctx.spb];
  const inside = meanPitch(ev, from, to);
  const outside = (meanPitch(ev, 0, from) + meanPitch(ev, to, ctx.total)) / 2;
  return inside && outside ? 1.2 * Math.max(0, Math.min(4, inside - outside)) : 0;
}

// Blue notes are sparse: about one per six bars at most.
function blueCapScore(ctx, ev) {
  const blues = ev.filter((e) => !e.app && isBlueNote(ctx, e.midi, e.slot)).length;
  return -3 * Math.max(0, blues - Math.ceil(ctx.bars / 6));
}

function ornamentCapScore(ctx, ev) {
  const approaches = ev.filter((e) => e.app).length;
  return -2.5 * Math.max(0, approaches - ctx.o.approachMax * ev.length);
}

// Dotted-quarter groupings: secondary rag (3+3+2) and Armstrong's 3-against-4.
function crossRhythmScore(ctx, ev) {
  if (!ctx.o.crossRhythm) {
    return 0;
  }
  let runs = 0;
  for (let i = 0; i + 2 < ev.length; i++) {
    if (ev[i + 1].slot - ev[i].slot === 3 && ev[i + 2].slot - ev[i + 1].slot === 3) {
      runs++;
      i++;
    }
  }
  return ctx.o.crossRhythm * 1.5 * Math.min(runs, Math.max(1, ctx.bars / 4));
}

// 1-2 bar phrases [D4]; a longer one only inside a break.
function phraseLengthScore(ctx, phrase, len) {
  const spb = ctx.spb;
  if (len >= spb - 1 && len <= 2 * spb + 2) {
    return 3;
  }
  if (len >= spb / 2 && len < spb - 1) {
    return 0.5;
  }
  if (len < spb / 2) {
    return -1;
  }
  const inBreak = phrase.some((e) => ctx.breakBar.has(barOf(ctx, e.slot)));
  return inBreak ? 0 : -2 * (len / spb - 2);
}

// Ends simple: on a held chord tone, on a beat [D4].
function phraseEndScore(ctx, last) {
  let f = 0;
  if (last.len >= ctx.sub) {
    f += 2;
  }
  if (!last.app && isChordTone(ctx, last.midi, last.slot)) {
    f += 1.5;
  }
  if (onBeat(ctx, last.slot)) {
    f += 0.5;
  }
  return f;
}

// Busy start, simple end [D4]; ascending opening, descending resolution [I].
function phraseShapeScore(phrase, len) {
  const first = phrase[0];
  const last = phrase[phrase.length - 1];
  const mid = first.slot + len / 2;
  const early = phrase.filter((e) => e.slot < mid).length;
  let f = early >= phrase.length - early ? 1 : 0;
  const peak = Math.max(...phrase.map((e) => e.midi));
  if (phrase.length >= 4 && last.midi <= peak - 3 && first.midi < peak) {
    f += 1;
  }
  return f;
}

function phraseScore(ctx, phrase) {
  if (phrase.length === 1) {
    return -1;
  }
  const last = phrase[phrase.length - 1];
  const len = last.slot + last.len - phrase[0].slot;
  return phraseLengthScore(ctx, phrase, len) + phraseEndScore(ctx, last) + phraseShapeScore(phrase, len);
}

function phrasesScore(ctx, ev) {
  const total = phrasesOf(ctx, ev).reduce((sum, phrase) => sum + phraseScore(ctx, phrase), 0);
  return total * ctx.o.phraseWeight;
}

function longestRest(covered, from, to) {
  let best = 0;
  let run = 0;
  for (let s = from; s < Math.min(covered.length, to); s++) {
    run = covered[s] ? 0 : run + 1;
    best = Math.max(best, run);
  }
  return best;
}

function involvesBandStop(ctx, fromBar, toBar) {
  for (let bar = fromBar; bar < toBar; bar++) {
    if (ctx.breakBar.has(bar) || ctx.stopBar.has(bar)) {
      return true;
    }
  }
  return false;
}

// Breathe at least every 2-3 bars; a longer breath closing each 4-bar group [I].
function breathsScore(ctx, covered) {
  if (ctx.o.tailgate) {
    return 0;
  }
  const { spb, sub } = ctx;
  let f = 0;
  for (let bar = 0; bar + 3 <= ctx.bars; bar++) {
    if (!involvesBandStop(ctx, bar, bar + 3) && longestRest(covered, bar * spb, (bar + 3) * spb) < sub) {
      f -= 3;
    }
  }
  for (let bar = 3; bar < ctx.bars - 1; bar += 4) {
    if (!involvesBandStop(ctx, bar, bar + 1) && longestRest(covered, bar * spb + spb / 2, (bar + 1) * spb + sub) >= sub) {
      f += 1.5;
    }
  }
  return f;
}

function climaxOf(ev) {
  return ev.reduce((top, e) => (e.midi > top.midi ? e : top), ev[0]);
}

function meanPitch(ev, from, to) {
  const inRange = ev.filter((e) => e.slot >= from && e.slot < to);
  return inRange.length ? inRange.reduce((sum, e) => sum + e.midi, 0) / inRange.length : 0;
}

function climaxScore(ctx, ev, climax) {
  const at = climax.slot / ctx.total;
  let f = at >= 0.55 && at <= 0.9 ? 6 : -5;
  if (climax.len >= ctx.sub) {
    f += 1.5;
  }
  if (climax.len >= 2 * ctx.sub) {
    f += 1.5;
  }
  if (ev.filter((e) => e.midi === climax.midi).length > 2) {
    f -= 2; // one real peak, not a plateau
  }
  return f;
}

// Calmer, lower opening; busier, higher second half.
function buildUpScore(ctx, ev) {
  const quarter = ctx.total / 4;
  const half = ctx.total / 2;
  const openingDensity = ev.filter((e) => e.slot < quarter).length / quarter;
  const closingDensity = ev.filter((e) => e.slot >= half).length / half;
  let f = openingDensity < closingDensity ? 2 : 0;
  if (meanPitch(ev, 0, quarter) < meanPitch(ev, half, ctx.total)) {
    f += 1.5;
  }
  return f;
}

// The solo as a story [H].
function arcScore(ctx, ev) {
  if (!ctx.o.arc) {
    return 0;
  }
  return climaxScore(ctx, ev, climaxOf(ev)) + buildUpScore(ctx, ev);
}

function soundingDegreeAt(g, s) {
  let k = s;
  while (k > 0 && g[k] === HOLD) {
    k--;
  }
  return { slot: k, value: g[k] };
}

// Melody with variation [I 5.8]: recognisably the tune, not a copy of it.
function melodyScore(ctx, g) {
  if (!ctx.mel) {
    return 0;
  }
  let hit = 0;
  let count = 0;
  for (let s = 0; s < ctx.total; s++) {
    if (ctx.mel.onset[s] && ctx.mel.pitch[s] !== null) {
      count++;
      const sounding = soundingDegreeAt(g, s);
      if (isDegree(sounding.value) && mod12(midiOf(ctx, sounding.value, sounding.slot)) === mod12(ctx.mel.pitch[s])) {
        hit += sounding.slot === s ? 1.5 : 1;
      }
    }
  }
  return count ? ctx.o.melodyWeight * 45 * (hit / count) : 0;
}

// Trombone below the lead, clarinet above it, nobody doubling it [D5].
function registerPenalty(ctx, e) {
  const theirs = ctx.ag.pitch[e.slot];
  if (theirs === null) {
    return 0;
  }
  let f = 0;
  if ((ctx.o.tailgate || ctx.o.below) && e.midi > theirs - 2) {
    f -= 1.5;
  }
  if (ctx.o.climb && e.midi < theirs + 2) {
    f -= 1.5;
  }
  if (e.midi === theirs && ctx.ag.onset[e.slot]) {
    f -= 1;
  }
  return f;
}

function registerScore(ctx, ev) {
  if (!ctx.ag) {
    return 0;
  }
  return ev.reduce((sum, e) => sum + registerPenalty(ctx, e), 0);
}

// End on the root or third, held, at the end.
function endingScore(ctx, ev) {
  const last = ev[ev.length - 1];
  const rel = relToRoot(ctx, last.midi, last.slot);
  let f = 0;
  if (!last.app && (rel === 0 || rel === 3 || rel === 4)) {
    f += 5;
  }
  if (last.len >= 3) {
    f += 2;
  }
  if (last.slot + last.len < ctx.total - ctx.spb) {
    f -= 4;
  }
  return f;
}

function fitness(ctx, g) {
  const ev = decode(ctx, g);
  if (ev.length < 2) {
    return -1e9;
  }
  const covered = coverage(ctx, ev);
  return notesScore(ctx, ev) + barsScore(ctx, g, ev, covered) + breakLandingScore(ctx, g)
    + ornamentCapScore(ctx, ev) + blueCapScore(ctx, ev) + ideaScore(ctx, g) + repeatedNoteScore(ctx, ev) + arpeggioScore(ctx, ev) + phraseRecallScore(ctx, ev) + finaleScore(ctx, ev) + bridgeScore(ctx, ev) + crossRhythmScore(ctx, ev) + phrasesScore(ctx, ev)
    + breathsScore(ctx, covered) + arcScore(ctx, ev) + melodyScore(ctx, g)
    + registerScore(ctx, ev) + endingScore(ctx, ev);
}

// ---------------------------------------------------------------------------
// Genomes and genetic operators.

function melodyGenome(ctx) {
  const g = Array.from({ length: ctx.total }, () => REST);
  for (const note of ctx.o.melody) {
    const a = Math.round(note.start * ctx.sub);
    if (a < ctx.total) {
      g[a] = degreeOf(ctx, note.midi, a);
      const end = Math.min(ctx.total, Math.round((note.start + note.duration) * ctx.sub));
      for (let s = a + 1; s < end; s++) {
        g[s] = HOLD;
      }
    }
  }
  return g;
}

function startDegree(ctx) {
  const perOctave = CHORDS.maj.scale.length;
  const lo = Math.ceil(((ctx.o.low - ctx.o.base) / 12) * perOctave) + 2;
  const hi = Math.floor(((ctx.o.high - ctx.o.base) / 12) * perOctave) - 2;
  return randInt(ctx, lo, hi);
}

function tailgateGene(ctx, s, deg) {
  const posInBar = s % ctx.spb;
  if (posInBar === 0 || posInBar === ctx.spb / 2) {
    return clampDegree(deg + randInt(ctx, -2, 2));
  }
  return ctx.rand() < 0.6 ? HOLD : REST;
}

// A random walk: mostly notes and holds, the odd rest.
function freeGene(ctx, s, walk) {
  const r = ctx.rand();
  if (r < walk.pNote) {
    walk.deg = clampDegree(walk.deg + randInt(ctx, -3, 3));
    return walk.deg;
  }
  return r < 0.88 ? HOLD : REST;
}

function randomGenome(ctx) {
  const walk = { deg: startDegree(ctx), pNote: Math.min(0.85, ctx.o.density / (ctx.o.beatsPerBar * 2) + 0.05) };
  return Array.from({ length: ctx.total }, (_, s) => (ctx.o.tailgate ? tailgateGene(ctx, s, walk.deg) : freeGene(ctx, s, walk)));
}

function degreeSlots(g, from, to) {
  const slots = [];
  for (let s = Math.max(0, from); s < Math.min(g.length, to); s++) {
    if (isDegree(g[s])) {
      slots.push(s);
    }
  }
  return slots;
}

function segment(ctx) {
  const a = randInt(ctx, 0, ctx.total - 2);
  return [a, Math.min(ctx.total, a + randInt(ctx, 4, ctx.spb))];
}

function perturbOp(ctx, g) {
  const slots = degreeSlots(g, 0, ctx.total);
  if (slots.length) {
    const s = slots[randInt(ctx, 0, slots.length - 1)];
    g[s] = clampDegree(g[s] + randInt(ctx, -2, 2));
  }
}

function previousDegree(g, s) {
  for (let p = s - 1; p >= 0; p--) {
    if (isDegree(g[p])) {
      return g[p];
    }
  }
  return 4;
}

function splitMergeOp(ctx, g) {
  const s = randInt(ctx, 1, ctx.total - 1);
  if (isOnset(g[s])) {
    g[s] = ctx.rand() < 0.7 ? HOLD : REST;
  } else {
    g[s] = clampDegree(previousDegree(g, s) + randInt(ctx, -2, 2));
  }
}

function transposeOp(ctx, g) {
  const [a, b] = segment(ctx);
  const k = randInt(ctx, -3, 3);
  for (const s of degreeSlots(g, a, b)) {
    g[s] = clampDegree(g[s] + k);
  }
}

function invertOp(ctx, g) {
  const [a, b] = segment(ctx);
  const slots = degreeSlots(g, a, b);
  if (slots.length) {
    const pivot = g[slots[0]];
    for (const s of slots) {
      g[s] = clampDegree(2 * pivot - g[s]);
    }
  }
}

function writeValues(g, slots, values) {
  slots.forEach((s, i) => {
    g[s] = values[i];
  });
}

function retrogradeOp(ctx, g) {
  const [a, b] = segment(ctx);
  const slots = degreeSlots(g, a, b);
  writeValues(g, slots, slots.map((s) => g[s]).reverse());
}

function sortOp(ctx, g) {
  const [a, b] = segment(ctx);
  const slots = degreeSlots(g, a, b);
  const up = ctx.rand() < 0.5;
  writeValues(g, slots, slots.map((s) => g[s]).sort((x, y) => (up ? x - y : y - x)));
}

function repeatLickOp(ctx, g) {
  if (ctx.bars < 2) {
    return;
  }
  const src = randInt(ctx, 0, ctx.bars - 2);
  const lags = [1, 2, 4].filter((lag) => src + lag < ctx.bars);
  const dst = src + lags[randInt(ctx, 0, lags.length - 1)];
  const shift = ctx.rand() < 0.5 ? 0 : randInt(ctx, -2, 2);
  for (let i = 0; i < ctx.spb && dst * ctx.spb + i < ctx.total; i++) {
    const v = g[src * ctx.spb + i];
    g[dst * ctx.spb + i] = isDegree(v) ? clampDegree(v + shift) : v;
  }
}

function breathOp(ctx, g) {
  const bar = randInt(ctx, 0, ctx.bars - 1);
  const s = bar * ctx.spb + randInt(ctx, ctx.spb / 2, ctx.spb - 1);
  for (let k = s; k < Math.min(ctx.total, s + ctx.sub); k++) {
    g[k] = REST;
  }
}

function approachOp(ctx, g) {
  const slots = degreeSlots(g, 2, ctx.total);
  if (!slots.length) {
    return;
  }
  const t = slots[randInt(ctx, 0, slots.length - 1)];
  if (ctx.rand() < 0.3) {
    g[t - 2] = APPROACH_ABOVE; // enclosure: above, below, target
    g[t - 1] = APPROACH_BELOW;
  } else {
    g[t - 1] = ctx.rand() < 0.6 ? APPROACH_BELOW : APPROACH_ABOVE;
  }
}

// Raise a note late in the solo above everything else and hold it.
function climaxOp(ctx, g) {
  const slots = degreeSlots(g, Math.floor(ctx.total * 0.6), Math.floor(ctx.total * 0.88));
  if (!slots.length) {
    return;
  }
  const t = slots[randInt(ctx, 0, slots.length - 1)];
  const highest = Math.max(...degreeSlots(g, 0, ctx.total).map((s) => midiOf(ctx, g[s], s)));
  let deg = g[t];
  while (deg < MAX_DEG && midiOf(ctx, deg, t) <= highest) {
    deg++;
  }
  g[t] = deg;
  for (let k = 1; k < 2 * ctx.sub && t + k < ctx.total; k++) {
    g[t + k] = HOLD;
  }
}

// A descending chord-tone arpeggio [S]: four eighths from a chord tone down
// through the chord's own tones.
function arpeggioOp(ctx, g) {
  const t = randInt(ctx, 0, ctx.bars - 1) * ctx.spb + ctx.beatSlots[randInt(ctx, 0, ctx.beatSlots.length - 1)];
  if (t + 4 > ctx.total) {
    return;
  }
  let deg = randInt(ctx, 3, 12);
  for (let k = 0; k < 4; k++) {
    while (deg > MIN_DEG && !isChordTone(ctx, midiOf(ctx, deg, t + k), t + k)) {
      deg--;
    }
    g[t + k] = deg;
    deg--;
  }
}

// A phrase restarting on the pitch an earlier phrase began on [S].
function recallOp(ctx, g) {
  const first = randInt(ctx, 0, ctx.bars - 2);
  const later = randInt(ctx, first + 1, ctx.bars - 1);
  const [a, b] = [first * ctx.spb, later * ctx.spb];
  if (isDegree(g[a])) {
    g[b] = degreeOf(ctx, midiOf(ctx, g[a], a), b);
  }
}

// A long high note in the last chorus [S].
function heldHighOp(ctx, g) {
  const bar = randInt(ctx, Math.floor(ctx.bars * 0.62), ctx.bars - 1);
  const t = bar * ctx.spb;
  let deg = MAX_DEG;
  while (deg > MIN_DEG && (midiOf(ctx, deg, t) > ctx.o.high - 2 || !isChordTone(ctx, midiOf(ctx, deg, t), t))) {
    deg--;
  }
  g[t] = deg;
  for (let k = 1; k < 6 && t + k < ctx.total; k++) {
    g[t + k] = HOLD;
  }
}

// Three equal notes in a row on one scale degree [S].
function repeatNoteOp(ctx, g) {
  const s = randInt(ctx, 0, ctx.total - 3);
  const before = degreeSlots(g, Math.max(0, s - ctx.spb), s + 1);
  const deg = before.length ? g[before[before.length - 1]] : startDegree(ctx);
  for (let k = 0; k < 3; k++) {
    g[s + k] = deg;
  }
}

// The triple call [S]: bar `src` stated again in the next two bars, each time
// moved a step or so.
function tripleCallOp(ctx, g) {
  if (ctx.bars < 3) {
    return;
  }
  const src = randInt(ctx, 0, ctx.bars - 3);
  for (const back of [1, 2]) {
    const shift = ctx.rand() < 0.4 ? 0 : randInt(ctx, -1, 1);
    for (let i = 0; i < ctx.spb; i++) {
      const v = g[src * ctx.spb + i];
      g[(src + back) * ctx.spb + i] = isDegree(v) ? clampDegree(v + shift) : v;
    }
  }
}

function operatorsFor(ctx) {
  const ops = [perturbOp, splitMergeOp, transposeOp, invertOp, retrogradeOp, sortOp, repeatLickOp, breathOp, approachOp];
  if (!ctx.o.tailgate && !ctx.ag) {
    ops.push(repeatLickOp); // ideas that come back: twice the weight for a lead
  }
  if (ctx.o.figures) {
    ops.push(repeatNoteOp, tripleCallOp, recallOp, heldHighOp);
  }
  if (ctx.o.arpeggios) {
    ops.push(arpeggioOp);
  }
  if (ctx.o.arc) {
    ops.push(climaxOp);
  }
  return ops;
}

function mutate(ctx, ops, g, times) {
  for (let i = 0; i < times; i++) {
    ops[randInt(ctx, 0, ops.length - 1)](ctx, g);
  }
}

// Bar-aligned one-point crossover.
function crossover(ctx, a, b) {
  const cut = randInt(ctx, 1, Math.max(1, ctx.bars - 1)) * ctx.spb;
  return a.slice(0, cut).concat(b.slice(cut));
}

function tournamentPick(ctx, pop) {
  let best = pop[randInt(ctx, 0, pop.length - 1)];
  for (let i = 0; i < 2; i++) {
    const challenger = pop[randInt(ctx, 0, pop.length - 1)];
    if (challenger.f > best.f) {
      best = challenger;
    }
  }
  return best.g;
}

function initialPopulation(ctx, ops) {
  const seedMelody = ctx.o.melody ? melodyGenome(ctx) : null;
  return Array.from({ length: ctx.o.popSize }, (_, i) => {
    let g;
    if (seedMelody && i < ctx.o.popSize / 3) {
      g = seedMelody.slice();
      mutate(ctx, ops, g, randInt(ctx, 0, 4));
    } else {
      g = randomGenome(ctx);
    }
    return { g, f: fitness(ctx, g) };
  });
}

function nextGeneration(ctx, ops, pop) {
  const sorted = pop.slice().sort((x, y) => y.f - x.f);
  const next = sorted.slice(0, 2); // elitism
  while (next.length < ctx.o.popSize) {
    const child = ctx.rand() < 0.7 ? crossover(ctx, tournamentPick(ctx, sorted), tournamentPick(ctx, sorted)) : tournamentPick(ctx, sorted).slice();
    mutate(ctx, ops, child, randInt(ctx, 1, 2));
    next.push({ g: child, f: fitness(ctx, child) });
  }
  return next;
}

function bestOf(pop) {
  return pop.reduce((best, x) => (x.f > best.f ? x : best), pop[0]);
}

// ---------------------------------------------------------------------------
// Output.

function isRip(ctx, e, around) {
  if (!around.prev || e.midi !== around.peak || e.midi - around.prev.midi < 5) {
    return false;
  }
  return e === around.climax || ctx.rand() < ctx.o.rips;
}

function articulationsOf(ctx, e, around) {
  const artic = [];
  const held = e.len >= 1.5 * ctx.sub;
  if (!e.app && isBlueNote(ctx, e.midi, e.slot)) {
    artic.push("bend");
  }
  if (ctx.o.tailgate && isGliss(ctx, e, around.next)) {
    artic.push("gliss");
  }
  if (around.isLast && held && ctx.rand() < ctx.o.falls) {
    artic.push("fall");
  }
  if (isRip(ctx, e, around)) {
    artic.push("rip");
  }
  if (held && !artic.includes("fall")) {
    artic.push("vibrato");
  }
  if (isSyncopated(ctx, e)) {
    artic.push("accent");
  }
  return artic;
}

function velocityOf(ctx, e, around) {
  if (e.app) {
    return 0.68;
  }
  if (isSyncopated(ctx, e)) {
    return 0.92;
  }
  if (e === around.climax) {
    return 0.95;
  }
  if (e.slot % ctx.spb === 0) {
    return 0.82;
  }
  return around.isLast ? 0.7 : 0.76;
}

function buildNotes(ctx, ev) {
  const climax = ctx.o.arc ? climaxOf(ev) : null;
  const notes = [];
  phrasesOf(ctx, ev).forEach((phrase, phraseIndex) => {
    const peak = Math.max(...phrase.map((e) => e.midi));
    phrase.forEach((e, k) => {
      const around = { prev: phrase[k - 1], next: ev[ev.indexOf(e) + 1], isLast: k === phrase.length - 1, peak, climax };
      notes.push({
        start: e.slot / ctx.sub,
        duration: e.len / ctx.sub,
        midi: e.midi,
        velocity: velocityOf(ctx, e, around),
        phrase: phraseIndex,
        approach: Boolean(e.app),
        artic: articulationsOf(ctx, e, around),
      });
    });
  });
  return notes;
}

/*
  Evolve one line over `progression` — chord symbols, one bar each, or
  {chord, beats} objects (a null `chord` is an N.C. gap: the line carries on
  over the neighbouring harmony — pair it with `breaks` so it plays as a
  break). Options (all optional): style (a STYLES key) plus any STYLES field to
  override it; beatsPerBar; melody (the tune, [{start, duration, midi}] in
  beats -> melody with variation) and melodyWeight; against (another voice's
  notes, for polyphony and register); breaks / stopTime (bar indices where the
  band stops / plays stop-time); popSize; generations; seed.
  Returns { fitness, seed, style, notes } — notes are
  { start, duration, midi, velocity, phrase, approach, artic } with
  start/duration in beats on a straight eighth grid, artic a subset of
  "bend" | "gliss" | "fall" | "rip" | "vibrato" | "accent".
*/
export function generateSolo(progression, opts = {}) {
  const job = startSolo(progression, opts);
  job.step(Infinity);
  return job.result();
}

/*
  The same evolution as generateSolo, but in slices, so a page can run it in
  the background and show progress. step(ms) evolves for about `ms`
  milliseconds and returns true once every generation is done; progress is
  0..1; result() is generateSolo's return value (the best so far, so it is
  usable at any point). The slicing never changes the outcome: a seed gives
  the same take however it is stepped.
*/
export function startSolo(progression, opts = {}) {
  const ctx = createContext(progression, opts);
  const ops = operatorsFor(ctx);
  let pop = initialPopulation(ctx, ops);
  let generation = 0;
  return {
    get progress() {
      return generation / ctx.o.generations;
    },
    step(ms) {
      const until = Date.now() + ms;
      while (generation < ctx.o.generations && Date.now() < until) {
        pop = nextGeneration(ctx, ops, pop);
        generation++;
      }
      return generation >= ctx.o.generations;
    },
    result() {
      const best = bestOf(pop);
      return { fitness: best.f, seed: ctx.o.seed, style: ctx.o.style, notes: buildNotes(ctx, decode(ctx, best.g)) };
    },
  };
}
