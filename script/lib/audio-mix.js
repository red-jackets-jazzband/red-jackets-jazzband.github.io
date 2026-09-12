import { nextVoiceId } from "./voice-id.js";

// Pure helpers for the sheet's Mixer panel (songs/mixer.js).
//
// ABCjs's live web-audio synth doesn't honor every %%MIDI directive its own
// text parser accepts equally — confirmed empirically in a real browser, not
// just from source-reading, so treat this split as fact, not a guess:
//   - Bass/Chords (ABCjs's own auto-generated accompaniment, abc2midi's
//     classic gchord engine) get real MUTE + VOLUME + VOICE, via
//     %%MIDI gchord/bassprog/chordprog/bassvol/chordvol stamped into the ABC
//     text before ABCjs parses it (there's no live gain node in ABCjs's
//     synth, so a *change* has to be baked into the text).
//   - Every other channel is just an ordinary notated ABC voice — the tune's
//     own melody line, one of a chart's own several named voices (Trumpet +
//     Sousaphone, ...), or the generated Comping voice — and those get real
//     MUTE (through computeVoicesOff — SynthController's own `voicesOff`
//     option, unrelated to any text directive) and real VOICE (a per-voice
//     %%MIDI program line, same text-injection idea as Bass/Chords' program
//     lines) — but NOT working VOLUME: a generic %%MIDI vol on an ordinary
//     voice was tried first, exactly mirroring the proven bassvol/chordvol
//     approach, and does nothing audible — it appears to only feed ABCjs's
//     separate "export as .mid file" path, never the live SynthController
//     buffer. Their volume fader is `disabled` in the UI (songs/mixer.js /
//     content/songs.md) rather than pretending to work. Fixing that for real
//     means either finding a genuine per-voice live-gain hook this file
//     doesn't know about yet, or priming a separate SynthController per
//     channel through its own Web Audio GainNode and mixing them by hand —
//     a real audio-engine change that needs a real browser to verify.
//
// See resolveMixerVoices' own doc comment for how "every other channel"
// above is modelled: one flat list of N voices (however many the tune's own
// ABC declares, or a single implicit one for an ordinary tune with none),
// plus Comping appended as voice N+1 when it's turned on — Melody and
// Comping aren't special-cased channels of their own any more, just voices
// with a resolved name like any other.

// The MIDI channel-volume range abc2midi's `bassvol`/`chordvol` directives
// accept.
export const MIDI_VOLUME_MAX = 127;

// Bass/Chords' GM program (see lib/gm-voices.js) when their Voice picker is
// left on "Default" — Acoustic Bass / Jazz Guitar, a reasonable jazz-combo
// guess, not yet checked by ear in a real browser. Every other voice's own
// "Default" program is resolved per-voice instead, from its own name — see
// lib/gm-voices.js's guessGmProgram.
export const DEFAULT_PROGRAM = {
  bass: 32, chords: 26,
};

/*
  Named %%MIDI gchord patterns for the Mixer's Pattern picker (songs/
  mixer.js, next to the Metronome toggle — both are tune-wide settings, not
  per-channel controls). Each `pattern` string is built from abcjs's own
  synth-side gchord alphabet (its source, not abc2midi's — the two parsers
  accept different letters): "b" plays the chord's root bass note and the
  full chord together, "f" the root alone, "c" the chord alone, "z" a rest.
  One letter is one pulse of the tune's basic note length; abcjs stretches
  or repeats the string to fill each bar. "jazz" is the pattern this file
  hardcoded before the picker existed (ABCjs's own "jazz" example,
  https://examples.abcjs.net/accompaniment) — kept as the default `value` so
  an untouched picker changes nothing audible. `pattern: null` ("Default")
  means "emit no %%MIDI gchord line at all" — hasChords still gets bassprog/
  chordprog/bassvol/chordvol (see accompanimentLines), just whichever
  built-in pattern abc2midi/abcjs falls back to on its own.
  As with the Bass/Chords GM program defaults above, the non-jazz patterns
  here are a reasonable rhythmic guess from reading the gchord alphabet, not
  yet confirmed by ear in a real browser.
*/
export const GCHORD_PATTERNS = [
  { value: "default", label: "Default", pattern: null },
  { value: "jazz", label: "Jazz (root+chord, chord)", pattern: "bzczbzcz" },
  { value: "two-beat", label: "Two-beat (root, chord)", pattern: "fzczfzcz" },
  { value: "four-beat", label: "Four-beat (root+chord each beat)", pattern: "bzbzbzbz" },
  { value: "waltz", label: "Waltz (root, chord, chord)", pattern: "fzczcz" },
  { value: "latin", label: "Latin/Calypso (root, off-beat chords)", pattern: "fczczczc" },
];

export const DEFAULT_GCHORD_PATTERN_VALUE = "jazz";

// The gchord pattern string for a Pattern-picker `value` (falling back to
// the default entry for anything unrecognised — a stale/corrupted
// localStorage value, most likely).
export function resolveGchordPattern(value) {
  const found = GCHORD_PATTERNS.find((p) => p.value === value);
  if (found) return found.pattern;
  return GCHORD_PATTERNS.find((p) => p.value === DEFAULT_GCHORD_PATTERN_VALUE).pattern;
}

// A fader's usable travel should spend most of itself on the quiet-to-
// comfortable range, not spread evenly up to "as loud as it goes" — real
// mixing console faders are tapered the same way. Cubing the 0-1 fraction
// before scaling to MIDI's 0-127 pulls the low half of the slider's travel
// down to a small fraction of the range, leaving far more physical travel
// (and finer control) for quiet/background levels than a straight linear
// mapping would; the top end still reaches 127 at 100%.
const VOLUME_CURVE_EXPONENT = 3;

// Map a 0-100 mixer percentage to the 0-127 MIDI volume value (see
// VOLUME_CURVE_EXPONENT), clamping either end so an out-of-range caller
// value can't emit a directive abc2midi would choke on.
export function percentToMidiVolume(percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  return Math.round(MIDI_VOLUME_MAX * (clamped / 100) ** VOLUME_CURVE_EXPONENT);
}

// Splice `lines` in, each its own line, right before the tune's K: field
// (the header's closing field in every .abc file here), found by a plain
// scan rather than a regex over arbitrary text.
function insertLinesBeforeKeyLine(text, lines) {
  if (!lines.length) return text;
  const split = text.split("\n");
  const kIndex = split.findIndex((l) => l.startsWith("K:"));
  if (kIndex === -1) return text;
  split.splice(kIndex, 0, ...lines);
  return split.join("\n");
}

// The Bass/Chords header block: only worth emitting when the tune actually
// carries chord symbols for ABCjs's gchord engine to read (a tune with none
// would just render an inert directive).
function accompanimentLines(hasChords, {
  bassPercent, chordsPercent, bassProgram, chordsProgram, gchordPattern,
}) {
  if (!hasChords) return [];
  const lines = [];
  if (gchordPattern) lines.push(`%%MIDI gchord ${gchordPattern}`);
  lines.push(
    `%%MIDI bassprog ${bassProgram}`,
    `%%MIDI chordprog ${chordsProgram}`,
    `%%MIDI bassvol ${percentToMidiVolume(bassPercent)}`,
    `%%MIDI chordvol ${percentToMidiVolume(chordsPercent)}`,
  );
  return lines;
}

/*
  Parse the tune's own V: voice declarations — id + optional name="..." — in
  order of first appearance. This reads only the tune's original, un-augmented
  source text (before comping.js or injectMixerAudio ever touch it), so it
  finds genuine multi-staff charts (a Rebirth Brass Band tune's Trumpet +
  Sousaphone, honky_tonk_town_riffs.abc's hand-written Root/Third/Fifth) —
  never the comping-generated V:1/V:2 split, which only exists in the
  *rendered* text buildCompingTune produces, not the file on disk. Returns
  `name: null` (not a fallback label) for a voice with no name="..." of its
  own — resolveMixerVoices below owns turning that into a display name.

  Matches only lines that themselves start with "V:" (optionally with
  leading digits’ worth of whitespace after the colon, e.g. "V: 1") — a
  voice's *declaration*, wherever it falls relative to K: (some tunes declare
  voices before it, honky_tonk_town_riffs.abc after). Inline mid-line voice
  switches some tunes use instead of a repeated header line ("[V:1] ... |")
  never match this regex (the line starts with "[", not "V:"), so they're
  correctly not counted as a second declaration of the same voice. A voice's
  name is read from whichever of its lines carries a `name="..."` attribute
  first — later bare re-declarations (a body voice-switch marker with no
  attributes) don't overwrite an already-found name.
*/
export function parseVoiceList(abcText) {
  const voices = new Map();
  abcText.split("\n").forEach((line) => {
    const m = /^V:\s*(\S+)/.exec(line);
    if (!m) return;
    const id = m[1];
    if (!voices.has(id)) voices.set(id, null);
    if (!voices.get(id)) {
      const nameMatch = /name="([^"]*)"/.exec(line);
      if (nameMatch) voices.set(id, nameMatch[1]);
    }
  });
  return Array.from(voices.entries()).map(([id, name], index) => ({ id, index, name }));
}

/*
  Turn "the tune's own raw voice declarations" (parseVoiceList's result, [] for
  an ordinary tune with none) plus "is Comping turned on" into the Mixer's one
  flat list of voice channels — the single generalisation this file builds
  everything else on: a tune is always N voices (N >= 1; an ordinary tune with
  no V: lines of its own still counts as one implicit voice), plus Comping
  appended as voice N+1 when its pattern picker is on. Melody and Comping
  aren't their own special channels any more — they're just voices, resolved
  to a display name the same way:
    - a voice with its own name="..." keeps it (Trumpet, Sousaphone, ...);
    - an unnamed voice is "Melody" (a plain one-voice tune, or a chart that
      declares its voices without naming them, e.g. honky_tonk_town_riffs.abc
      *would* have been "Voice 1"/"Voice 2" before it got name="..." attrs);
    - two or more unnamed voices in the same tune number as "Melody 1",
      "Melody 2", ... (counting only the unnamed ones) so they stay distinct;
    - Comping, when active, is always literally "Comping" — never folded into
      the Melody-numbering scheme even if every other voice is unnamed.
  The appended Comping voice's `id` is whatever the next free voice slot is
  (`lib/voice-id.js`'s `nextVoiceId`, shared with comping.js's
  buildCompingTune so both always agree — kept in its own module rather than
  one file importing the other, see voice-id.js's own doc comment) —
  matching buildCompingTune, which appends its generated voice the same way:
  V:2 for an ordinary one-voice tune, or one past however many voices a
  chart already declares (see its own doc comment) —
  honky_tonk_town_riffs.abc's Root/Third/Fifth gets Comping as V:4. Sharing
  `nextVoiceId` (rather than each file re-deriving "length + 1" on its own)
  is what keeps the two in agreement even for a chart with sparse or
  non-numeric voice ids, where a plain length-based guess could collide with
  an id the chart already uses.
*/
export function resolveMixerVoices(rawVoices, compingActive) {
  const base = rawVoices.length > 0 ? rawVoices : [{ id: "1", index: 0, name: null }];
  const unnamedTotal = base.filter((v) => !v.name).length;
  let unnamedSeen = 0;
  const labeled = base.map((v) => {
    if (v.name) return { id: v.id, index: v.index, label: v.name };
    unnamedSeen += 1;
    return { id: v.id, index: v.index, label: unnamedTotal > 1 ? `Melody ${unnamedSeen}` : "Melody" };
  });
  if (!compingActive) return labeled;
  const id = nextVoiceId(labeled.map((v) => v.id));
  return [...labeled, { id, index: labeled.length, label: "Comping" }];
}

// Insert `%%MIDI program <n>` right after each voice's own first declaration
// line (matched the same way parseVoiceList finds it), so abc2midi scopes the
// program to that voice from there on. `programsById` only needs entries for
// the voices worth stamping; anything else is left to whatever ABCjs/abc2midi
// falls back to on its own.
function injectVoicePrograms(text, programsById) {
  const seen = new Set();
  const lines = text.split("\n").flatMap((line) => {
    const m = /^V:\s*(\S+)/.exec(line);
    if (!m || seen.has(m[1])) return [line];
    seen.add(m[1]);
    const program = programsById.get(m[1]);
    return program === undefined ? [line] : [line, `%%MIDI program ${program}`];
  });
  return lines.join("\n");
}

// True once `text` declares at least one voice of its own (a real "V:<id>"
// line, wherever it falls relative to K:) — i.e. whether injectVoicePrograms
// above has anything to attach a scoped %%MIDI program line to at all.
const HAS_VOICE_DECLARATION = /^V:\s*\S+/m;

/*
  Stamp Bass/Chords' full accompaniment directives, and every other voice's
  Voice (program only — see the file doc comment for why not volume), into
  the ABC text about to be handed to ABCJS.renderAbc, so whatever gets
  rendered is exactly what plays — there's no separate "audio-only" reparse,
  which would desync the playback cursor from the visible notation (ABCjs
  ties cursor highlighting to the actual rendered visualObj, not a freshly
  parsed twin of it).

  `voicePrograms` (id -> program) comes from resolveMixerVoices' resolved
  list — always at least one entry. Most tunes end up with a real "V:<id>"
  declaration in the text to scope each program to (either the tune's own,
  or the "V:1"/"V:2" pair buildCompingTune always emits once Comping is on —
  see its own doc comment). The one tune shape with no such line at all is an
  ordinary single-voice tune with Comping off and no V: declaration of its
  own (the vast majority of songs here): there's nothing to scope a program
  to, so this falls back to one tune-wide %%MIDI program line before K:,
  exactly as if the whole tune were voice 1.
*/
export function injectMixerAudio(abcText, {
  hasChords,
  bassPercent, bassProgram = DEFAULT_PROGRAM.bass,
  chordsPercent, chordsProgram = DEFAULT_PROGRAM.chords,
  gchordPattern = resolveGchordPattern(DEFAULT_GCHORD_PATTERN_VALUE),
  voicePrograms,
}) {
  const withAccompaniment = insertLinesBeforeKeyLine(
    abcText, accompanimentLines(hasChords, {
      bassPercent, chordsPercent, bassProgram, chordsProgram, gchordPattern,
    }),
  );

  if (HAS_VOICE_DECLARATION.test(withAccompaniment)) {
    return injectVoicePrograms(withAccompaniment, voicePrograms);
  }

  const [[, onlyProgram]] = voicePrograms;
  return insertLinesBeforeKeyLine(withAccompaniment, [`%%MIDI program ${onlyProgram}`]);
}

// ABCjs's live synth reads a tune-wide `swing` init option directly (not a
// %%MIDI text directive — confirmed from its own source: CreateSynth's buffer
// priming shifts each off-beat eighth note's start time by an amount derived
// from this option, applied after the note sequence is built, independent of
// any per-voice/per-channel directive). Its native scale is 50 (disabled —
// anything at or below this is a no-op) to 75 (maximum swing); anything above
// 75 is clamped down to it internally. That range isn't intuitive to expose
// directly on a fader, so the Mixer's Swing control uses the same familiar
// 0-100 scale as every volume fader (0 = off/straight eighths, 100 = maximum
// swing) and this maps it onto ABCjs's native range.
export const ABCJS_SWING_MIN = 50;
export const ABCJS_SWING_MAX = 75;

export function percentToAbcjsSwing(percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  return Math.round(ABCJS_SWING_MIN + (clamped / 100) * (ABCJS_SWING_MAX - ABCJS_SWING_MIN));
}

/*
  Which ABCjs voice indices to exclude from the audio buffer entirely, or
  `true` to render silence outright when there's only one voice to mute (the
  common case: an ordinary tune, Comping off — `[0]` and `true` should be
  equivalent whenever voice 0 is the *only* voice, but `true` is the one
  form already proven in a real browser from before per-voice channels
  existed at all, so it's kept for exactly that case rather than assumed
  equivalent). `voices` is ctx.state.mixerVoices — resolveMixerVoices' list,
  materialised with each voice's own `muted` flag by songs/mixer.js — always
  at least one entry. The `voicesOff` field is undefined when nothing should
  be muted, so callers can leave `voicesOff` off the synth params object
  entirely rather than pass an empty array.

  Always wrapped in a `{ voicesOff }` object (rather than returning the bare
  true/array/undefined value directly) so the function itself has one
  consistent return type — `voicesOff`'s value still varies, but that's a
  field on a plain object, not the function's own return type.
*/
export function computeVoicesOff(voices) {
  if (voices.length === 1) {
    return { voicesOff: voices[0].muted ? true : undefined };
  }
  const off = voices.filter((v) => v.muted).map((v) => v.index);
  return { voicesOff: off.length ? off : undefined };
}
