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
//   - Melody/Comping (regular ABC voices, not gchord-generated) get real
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

// The MIDI channel-volume range abc2midi's `bassvol`/`chordvol` directives
// accept.
export const MIDI_VOLUME_MAX = 127;

// Each channel's GM program (see lib/gm-voices.js) when its Voice picker is
// left on "Default" — Trumpet for Melody/Comping (today's one hardcoded
// program before the Mixer existed, kept as-is so an untouched picker
// changes nothing audible), Acoustic Bass / Jazz Guitar for Bass/Chords (a
// reasonable jazz-combo guess, not yet checked by ear in a real browser).
export const DEFAULT_PROGRAM = {
  melody: 56, bass: 32, chords: 26, comping: 56,
};

// ABCjs's own "jazz" example pattern (https://examples.abcjs.net/accompaniment).
const GCHORD_PATTERN = "bzczbzcz";

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

function spliceAfter(text, index, insertion) {
  return text.slice(0, index) + insertion + text.slice(index);
}

// The Bass/Chords header block: only worth emitting when the tune actually
// carries chord symbols for ABCjs's gchord engine to read (a tune with none
// would just render an inert directive).
function accompanimentLines(hasChords, {
  bassPercent, chordsPercent, bassProgram, chordsProgram,
}) {
  if (!hasChords) return [];
  return [
    `%%MIDI gchord ${GCHORD_PATTERN}`,
    `%%MIDI bassprog ${bassProgram}`,
    `%%MIDI chordprog ${chordsProgram}`,
    `%%MIDI bassvol ${percentToMidiVolume(bassPercent)}`,
    `%%MIDI chordvol ${percentToMidiVolume(chordsPercent)}`,
  ];
}

/*
  Stamp Bass/Chords' full accompaniment directives, and Melody/Comping's
  Voice (program only — see the file doc comment for why not volume), into
  the ABC text about to be handed to ABCJS.renderAbc, so whatever gets
  rendered is exactly what plays — there's no separate "audio-only" reparse,
  which would desync the playback cursor from the visible notation (ABCjs
  ties cursor highlighting to the actual rendered visualObj, not a freshly
  parsed twin of it).

  Melody/Comping are per-voice: without comping there's a single implicit
  voice, so one %%MIDI program line in the header sets it. With comping on,
  buildCompingTune's own contract (see its doc comment in lib/comping.js)
  fixes the body's shape as "...\nV:1\n<melody>\nV:2\n<comping>\n" — melody
  voice 1, comping voice 2 — so each gets its own line right after its body
  marker. lastIndexOf targets that body marker rather than the *voice
  declaration* line the same header carries a little earlier
  (%%staves [1 2]\nV:1\nV:2 name="R\n3\n5"...), which repeats the same bare
  "V:1" text once before the bodies start.
*/
export function injectMixerAudio(abcText, {
  compingActive, hasChords,
  melodyProgram = DEFAULT_PROGRAM.melody,
  compingProgram = DEFAULT_PROGRAM.comping,
  bassPercent, bassProgram = DEFAULT_PROGRAM.bass,
  chordsPercent, chordsProgram = DEFAULT_PROGRAM.chords,
}) {
  const withAccompaniment = insertLinesBeforeKeyLine(
    abcText, accompanimentLines(hasChords, {
      bassPercent, chordsPercent, bassProgram, chordsProgram,
    }),
  );

  if (!compingActive) {
    return insertLinesBeforeKeyLine(withAccompaniment, [`%%MIDI program ${melodyProgram}`]);
  }

  const v1 = withAccompaniment.lastIndexOf("\nV:1\n");
  const v2 = withAccompaniment.lastIndexOf("\nV:2\n");
  if (v1 === -1 || v2 === -1) return withAccompaniment;

  // Insert at the later marker first so the earlier one's index stays valid.
  const withComping = spliceAfter(withAccompaniment, v2 + "\nV:2\n".length, `%%MIDI program ${compingProgram}\n`);
  return spliceAfter(withComping, v1 + "\nV:1\n".length, `%%MIDI program ${melodyProgram}\n`);
}

/*
  Which ABCjs voice indices to exclude from the audio buffer entirely, or
  `true` to render silence outright when there's only one voice to mute.
  Melody is always voice 0; comping (when active) is voice 1 (see
  lib/comping.js's buildCompingTune doc comment). The `voicesOff` field is
  undefined when nothing should be muted, so callers can leave `voicesOff`
  off the synth params object entirely rather than pass an empty array.

  Always wrapped in a `{ voicesOff }` object (rather than returning the bare
  true/array/undefined value directly) so the function itself has one
  consistent return type — `voicesOff`'s value still varies, but that's a
  field on a plain object, not the function's own return type.
*/
export function computeVoicesOff({ compingActive, melodyMuted, compingMuted }) {
  if (!compingActive) {
    return { voicesOff: melodyMuted ? true : undefined };
  }
  const off = [];
  if (melodyMuted) off.push(0);
  if (compingMuted) off.push(1);
  return { voicesOff: off.length ? off : undefined };
}
