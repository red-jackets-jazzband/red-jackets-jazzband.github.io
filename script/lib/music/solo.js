import {
  appendBarVoice, distribute, pcChromaVal, rebeamBar, resolveChordNames, respellBar,
} from "./comping.js";
import { computeChordOffset } from "./chords.js";
import { generateSolo, startSolo } from "./solo-ga.js";
import { tl } from "../core/i18n.js";

/*
  Solo voice for the sheet: the same shape as lib/comping.js's Comping voice
  (a chord scheme in, one extra staff appended as voice N+1, bar for bar with
  the melody) but the notes come from lib/solo-ga.js's genetic algorithm
  instead of a rhythm pattern. Everything shared with comping goes through
  comping.js: the chord-name resolution (N.C. / "%" / slash chords), the key
  scale and signature, the bar fragments' beaming and accidentals, and
  appendBarVoice's header / pickup / voice-id handling.
*/

// The Solo dropdown's entries (value = a lib/solo-ga.js STYLES key).
export const SOLO_STYLES = [
  { value: "trumpet", label: tl("solo_trumpet", "Trumpet") },
  { value: "armstrong", label: tl("solo_armstrong", "Armstrong") },
  { value: "clarinet", label: tl("solo_clarinet", "Clarinet") },
  { value: "trombone", label: tl("solo_trombone_tailgate", "Trombone (tailgate)") },
  { value: "solo", label: tl("solo_free_solo", "Free solo") },
];

// General MIDI instrument for each style (the Mixer's Solo voice default).
export const SOLO_PROGRAMS = {
  trumpet: 56, armstrong: 56, clarinet: 71, trombone: 57, solo: 56,
};

const SLOTS_PER_BAR = 8;
const SLOTS_PER_BEAT = 2;
// Plain ABC lengths in eighth slots; anything longer is split with a tie.
const LENGTHS = [8, 6, 4, 3, 2, 1];

// What a style does with the lead: the front-line styles play the tune with
// variation, the others weave around it (above / below) as another horn.
const MELODY_STYLES = new Set(["trumpet", "armstrong"]);
const AGAINST_STYLES = new Set(["clarinet", "trombone"]);

const STEP_SEMITONES = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTAL_SHIFT = {
  sharp: 1, flat: -1, natural: 0, dblsharp: 2, dblflat: -2,
};

// The key signature as { LETTER: semitone shift } from the parsed key.
function keyShifts(song) {
  const shifts = {};
  const key = song.lines[0].staff[0].key;
  for (const acc of (key && key.accidentals) || []) {
    shifts[acc.note.toUpperCase()] = ACCIDENTAL_SHIFT[acc.acc] || 0;
  }
  return shifts;
}

// MIDI number of the top pitch of a parsed note element. `barShifts` carries
// the accidentals set earlier in the bar (they persist per letter + octave).
function topMidi(element, keySig, barShifts) {
  let top = -Infinity;
  for (const p of element.pitches) {
    const index = ((p.pitch % 7) + 7) % 7;
    const octave = 4 + Math.floor(p.pitch / 7);
    const id = `${"CDEFGAB"[index]}${octave}`;
    if (p.accidental !== undefined) barShifts.set(id, ACCIDENTAL_SHIFT[p.accidental] || 0);
    const shift = barShifts.has(id) ? barShifts.get(id) : keySig["CDEFGAB"[index]] || 0;
    const midi = 12 * (octave + 1) + STEP_SEMITONES[index] + shift;
    top = Math.max(top, midi);
  }
  return top;
}

/*
  The tune's first voice as GA input: [{ start, duration, midi }] in beats from
  the first chord bar (the chart's pickup / intro bars, `leadingBars`, are left
  out so it lines up with the chord scheme). Read straight from the ABCjs parse
  `song` (concert pitch): its diatonic steps, key signature and in-bar
  accidentals become MIDI notes; rests are skipped and a chord keeps its top
  note.
*/
export function melodyNotes(song, leadingBars) {
  const keySig = keyShifts(song);
  const notes = [];
  const at = { measure: 0, pos: 0, hasNotes: false, barShifts: new Map() };
  for (const element of firstVoiceElements(song)) {
    if (element.el_type === "bar") {
      at.measure += at.hasNotes ? 1 : 0;
      Object.assign(at, { pos: 0, hasNotes: false, barShifts: new Map() });
    } else if (element.el_type === "note" && element.duration) {
      at.hasNotes = true;
      const duration = element.duration[0] * 4;
      const sounding = element.pitches && element.pitches.length > 0;
      if (sounding && at.measure >= leadingBars) {
        notes.push({
          start: (at.measure - leadingBars) * 4 + at.pos, duration, midi: topMidi(element, keySig, at.barShifts),
        });
      }
      at.pos += duration;
    }
  }
  return notes;
}

function firstVoiceElements(song) {
  return song.lines.flatMap((line) => (line.staff && line.staff[0] && line.staff[0].voices
    ? line.staff[0].voices[0] || []
    : []));
}

// A stable seed per chart + style, so the same song always gets the same take
// (and a Key / Tempo / Mixer re-render doesn't reshuffle it).
function seedOf(names, style) {
  let hash = 5381;
  for (const ch of `${style}|${names}`) {
    hash = ((hash * 33) ^ ch.codePointAt(0)) >>> 0;
  }
  return hash;
}

// The GA's progression: one {chord, beats} per chord slot, a bar's 8 eighth
// slots shared out the way comping shares them. A bar that is all N.C. is a
// band break the soloist plays through.
function toProgression(names) {
  const progression = [];
  const breaks = [];
  names.forEach((row, bar) => {
    if (row.every((name) => name === null)) breaks.push(bar);
    distribute(SLOTS_PER_BAR, row.length).forEach((slots, i) => {
      progression.push({ chord: row[i], beats: slots / SLOTS_PER_BEAT });
    });
  });
  return { progression, breaks };
}

// MIDI note -> ABC note, spelled from the key's own scale where it can be and
// with flats elsewhere (sharps only in a sharp key).
function createSpeller(keyScale) {
  const byChroma = new Map(keyScale.map((pc) => [pcChromaVal(pc), pc]));
  const sharpKey = keyScale.some((pc) => pc.includes("#"));
  const chromatic = sharpKey
    ? ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    : ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  return (midi) => {
    const chroma = ((midi % 12) + 12) % 12;
    const pc = byChroma.get(chroma) || chromatic[chroma];
    const base = Tonal.Note.midi(`${pc}4`);
    const octave = 4 + Math.round((midi - base) / 12);
    return Tonal.AbcNotation.scientificToAbcNotation(`${pc}${octave}`);
  };
}

// One note of `slots` eighths as ABC tokens, tied when it has to be split.
function noteTokens(abcNote, slots, tiedOut) {
  const tokens = [];
  let left = slots;
  while (left > 0) {
    const part = LENGTHS.find((n) => n <= left);
    left -= part;
    tokens.push(`${abcNote}${part}${left > 0 || tiedOut ? "-" : ""}`);
  }
  return tokens;
}

function restTokens(slots) {
  return slots > 0 ? [`z${slots}`] : [];
}

// GA notes (beats, straight grid) -> one bar fragment per bar, in eighth
// slots. A note running over a barline is cut and tied.
function barFragments(notes, bars, spell) {
  const cells = Array.from({ length: bars }, () => []);
  for (const note of notes) {
    const start = Math.round(note.start * SLOTS_PER_BEAT);
    const end = Math.round((note.start + note.duration) * SLOTS_PER_BEAT);
    const abcNote = spell(note.midi);
    for (let bar = Math.floor(start / SLOTS_PER_BAR); bar * SLOTS_PER_BAR < end && bar < bars; bar++) {
      const from = Math.max(start, bar * SLOTS_PER_BAR) - bar * SLOTS_PER_BAR;
      const to = Math.min(end, (bar + 1) * SLOTS_PER_BAR) - bar * SLOTS_PER_BAR;
      cells[bar].push({ from, to, abcNote, tiedOut: end > (bar + 1) * SLOTS_PER_BAR });
    }
  }
  return cells.map((bar) => {
    const tokens = [];
    let pos = 0;
    for (const cell of bar) {
      tokens.push(...restTokens(cell.from - pos), ...noteTokens(cell.abcNote, cell.to - cell.from, cell.tiedOut));
      pos = cell.to;
    }
    tokens.push(...restTokens(SLOTS_PER_BAR - pos));
    return tokens.join(" ");
  });
}

// Takes already evolved, by chart + style + lead, so switching style or song
// back and forth doesn't re-run the GA. Small: the oldest entry is dropped.
const TAKE_CACHE_SIZE = 8;
const takes = new Map();

// More than the GA's own defaults (60 x 160): the fitness keeps climbing well
// past that, and the page evolves the take in the background with a progress
// readout (composeSolo), so a longer wait buys a noticeably better solo.
const LIVE_GA = { popSize: 100, generations: 500 };
// Each background slice; the UI gets a turn between slices.
const SLICE_MS = 25;

function leadOptions(style, lead) {
  if (MELODY_STYLES.has(style)) return { melody: lead };
  return AGAINST_STYLES.has(style) ? { against: lead } : {};
}

// What it takes to evolve (and to recognise) the take for this chart + style +
// lead, or null when there is nothing to solo over.
function takeRequest(chords, song, style, gaOptions) {
  if (!chords || chords.length === 0 || !SOLO_STYLES.some((s) => s.value === style)) return null;
  const names = resolveChordNames(chords);
  const lead = melodyNotes(song, computeChordOffset(song) || 0);
  const leadKey = lead.map((n) => `${n.start}:${n.midi}`).join(",");
  const key = `${style}|${names.map((row) => row.join(",")).join(";")}|${leadKey}|${JSON.stringify(gaOptions)}`;
  const { progression, breaks } = toProgression(names);
  return {
    key,
    progression,
    options: {
      style, breaks, seed: seedOf(key, style), ...LIVE_GA, ...leadOptions(style, lead), ...gaOptions,
    },
  };
}

function remember(key, notes) {
  takes.set(key, notes);
  if (takes.size > TAKE_CACHE_SIZE) takes.delete(takes.keys().next().value);
}

/** Whether this chart + style already has its take, so a render can use it now. */
export function hasSoloTake(chords, song, style, gaOptions = {}) {
  const request = takeRequest(chords, song, style, gaOptions);
  return request !== null && takes.has(request.key);
}

// The background job in flight, if any: { key, timer }.
let running = null;

/** Stop the background evolution, if one is running. */
export function cancelSolo() {
  if (running !== null) clearTimeout(running.timer);
  running = null;
}

/*
  Evolve the take for this chart + style in the background, in short slices so
  the page stays responsive. onProgress(0..1) is called as it goes, onDone()
  once the take is ready (then buildSoloTune uses it instantly). Asking for the
  take that is already running changes nothing; asking for another one drops
  the old job. Returns false when there is nothing to do (no such style / no
  chords, or the take already exists).
*/
export function composeSolo(chords, song, style, { onProgress, onDone, gaOptions = {} }) {
  const request = takeRequest(chords, song, style, gaOptions);
  if (request === null || takes.has(request.key)) return false;
  if (running !== null && running.key === request.key) return true;
  cancelSolo();
  const job = startSolo(request.progression, request.options);
  const state = { key: request.key, timer: null };
  running = state;
  const tick = () => {
    if (job.step(SLICE_MS)) {
      remember(request.key, job.result().notes);
      running = null;
      onDone();
      return;
    }
    onProgress(job.progress);
    state.timer = setTimeout(tick, 0);
  };
  onProgress(0);
  state.timer = setTimeout(tick, 0);
  return true;
}

/*
  Add a Solo staff for `style` (a SOLO_STYLES value) to the tune. `text`, `chords`
  and `song` are as for buildCompingTune; `text` may already carry the Comping
  voice. Returns { abc, notes } or null when a solo can't apply (no chords, no
  such style, an unsupported meter, no K: line). A take that isn't ready yet is
  evolved on the spot (the page calls composeSolo first, so it always is);
  `gaOptions` overrides the GA's own options (the tests use a small population).
*/
export function buildSoloTune(text, chords, song, style, gaOptions = {}) {
  const request = takeRequest(chords, song, style, gaOptions);
  if (request === null) return null;
  if (!takes.has(request.key)) remember(request.key, generateSolo(request.progression, request.options).notes);
  const notes = takes.get(request.key);
  const abc = appendBarVoice(text, song, ({ keyScale, keySig, lnum, lden }) => (
    barFragments(notes, chords.length, createSpeller(keyScale))
      .map((fragment) => rebeamBar(respellBar(fragment, keySig), lnum, lden))
  ), { name: "Solo", titleSuffix: "" });
  return abc === null ? null : { abc, notes };
}
