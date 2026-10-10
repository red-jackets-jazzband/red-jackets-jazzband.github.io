/*
  The tune's harmony as a list of segments, for the Named progressions
  layer: one per chord change (merged when the next symbol is the same
  function, B♭ then B♭6), each with its start and end time in whole notes,
  the key's tonic in force and whether it opened a part — plus every note
  onset (time, source offset, printed line, whether it carries a chord) for
  turning times back into positions on the sheet.

    collectHarmony(song) -> { segments, notes, bar, tonic }
      bar    the bar's length in whole notes
      tonic  the tonic at the end (a minor/modal key gives null: the named
             patterns are major-key patterns)
*/
import { chordName, keyRoot, parseChordSymbol } from "./chord-symbol.js";

// abcjs gives a major (or Ionian) key an empty mode, "m" to a minor/Aeolian
// one, and "Dor"/"Phr"/"Lyd"/"Mix"/"Loc" to the church modes — only the
// first is the major key the named patterns are written in.
const MAJOR_MODES = new Set(["", "maj", "major", "ion", "ionian"]);

function keyTonic(key) {
  if (!key || !MAJOR_MODES.has(String(key.mode || "").toLowerCase())) return null;
  return keyRoot(key);
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
export function collectHarmony(song) {
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
  if (el.el_type === "key") state.tonic = keyTonic(el);
  const name = chordName(el);
  const symbol = name === null ? null : parseChordSymbol(name);
  if (symbol) startSegment(el, symbol, lineIndex, state);
  if (el.el_type === "note") {
    state.notes.push({ time: state.time, startChar: el.startChar, line: lineIndex, hasChord: symbol !== null });
    state.time += el.duration || 0;
  }
}
