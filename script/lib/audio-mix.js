import { nextVoiceId } from "./voice-id.js";
import { execAll } from "./regex-exec-all.js";

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
//     option, unrelated to any text directive), real VOICE (a per-voice
//     %%MIDI program line, same text-injection idea as Bass/Chords' program
//     lines), and — now — real VOLUME too, via a per-voice %%MIDI beat line
//     rather than %%MIDI vol. A generic %%MIDI vol on an ordinary voice was
//     tried first, exactly mirroring the proven bassvol/chordvol approach,
//     and does nothing audible worth building on: reading abcjs's own
//     flattener (synth/abc_midi_flattener.js) shows why — a "vol"/"volinc"
//     directive only overrides the *single next note* (`nextVolume` is
//     consumed and reset to `undefined` the moment one note reads it), so a
//     one-off %%MIDI vol line at the top of a voice audibly touches one note
//     and then reverts. %%MIDI beat ⟨b1⟩ ⟨b2⟩ ⟨b3⟩ ⟨mod⟩ is different: abc2midi
//     defines it as the volumes abcjs assigns to a bar's first/other-strong/
//     weak notes, but the same flattener stores those three numbers in
//     module state (`stressBeat1`/`stressBeatDown`/`stressBeatUp`) that stays
//     in effect for every subsequent note until changed again — i.e. a real,
//     persistent, per-voice gain, not a one-shot. Setting all three numbers
//     equal turns it into a flat volume for that voice. Confirmed empirically
//     (this project's own standard — see the rest of this file): rendering
//     the same voice offline via ABCJS.synth.CreateSynth (the exact engine
//     SynthController also primes for live playback) with only the %%MIDI
//     beat value changed produces an RMS/peak amplitude that scales linearly
//     with it, and scoping it per voice via a real body "V:<id>" declaration
//     (the same insertion point injectPerVoiceLines already uses for
//     %%MIDI program) gives each voice an independent level.
//     One real gotcha the same test surfaced: `stressBeat1`/`stressBeatDown`/
//     `stressBeatUp` are shared, tune-wide closure state in abcjs's
//     flattener, reset once per flatten() call but *not* between voices — a
//     voice with no %%MIDI beat line of its own silently inherits whatever
//     level the previous voice's stream last set, rather than falling back to
//     abcjs's own default (105/95/85). So every resolved voice must get an
//     explicit %%MIDI beat line, including one left at "100%" — never only
//     the ones a user actually moved off default — or an untouched voice can
//     end up as loud (or as quiet) as whichever voice happens to render
//     immediately before it. percentToBeatStress handles this by always
//     returning three numbers, scaling abcjs's own defaults down towards
//     silence rather than inventing a different baseline, so 100% reproduces
//     today's untouched sound exactly.
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
  full chord together, "f" the root alone, "c" the chord alone, "z" a rest,
  and "g"/"h"/"i"/"j" pluck a single chord tone each — root/3rd/5th/7th, in
  that order ("do"/"mi"/"sol"/"ti" in abcjs's own source, see chord-track.js's
  parseGChord) — rather than the whole chord at once, for a broken-chord/
  arpeggiated texture the block-chord letters above can't produce. One letter
  is one pulse of the tune's basic note length; abcjs stretches or repeats
  the string to fill each bar. "jazz" is the pattern this file hardcoded
  before the picker existed (ABCjs's own "jazz" example,
  https://examples.abcjs.net/accompaniment) — kept as the default `value` so
  an untouched picker changes nothing audible. `pattern: null` ("Default")
  means "emit no %%MIDI gchord line at all" — hasChords still gets bassprog/
  chordprog/bassvol/chordvol (see accompanimentLines), just whichever
  built-in pattern abc2midi/abcjs falls back to on its own.
  As with the Bass/Chords GM program defaults above, every non-jazz pattern
  here is a reasonable rhythmic guess from reading the gchord alphabet, not
  yet confirmed by ear in a real browser. Picked to match this band's own
  repertoire rather than a generic rhythm-section grab-bag: New Orleans
  trad jazz/dixieland (two-beat, Charleston, banjo roll), brass band
  (second line), and calypso, the one non-jazz genre this band's book
  actually draws on — no bossa nova or reggae, which don't fit either.
    - "second-line" is the tresillo (3+3+2 eighth-notes) under nearly every
      New Orleans brass-band street beat — root+chord on beat 1, a chord
      stab on the "and" of 2, root again on beat 4, silence elsewhere.
    - "calypso" leads with a full root+chord downbeat (unlike reggae's own
      "one drop", which skips beat 1 in the bass entirely) then answers on
      every off-beat "and" — the classic mento/calypso guitar skank.
    - "arpeggio" (labelled Banjo Roll below) reuses the same broken-chord
      "g"/"h"/"i"/"j" letters for the rolled, one-tone-per-pulse texture a
      trad-jazz tenor banjo plays under a verse.
*/
export const GCHORD_PATTERNS = [
  { value: "default", label: "Default", pattern: null },
  { value: "jazz", label: "Jazz (root+chord, chord)", pattern: "bzczbzcz" },
  { value: "two-beat", label: "New Orleans Two-beat (root, chord)", pattern: "fzczfzcz" },
  { value: "four-beat", label: "Four-beat (root+chord each beat)", pattern: "bzbzbzbz" },
  { value: "waltz", label: "Waltz (root, chord, chord)", pattern: "fzczcz" },
  { value: "charleston", label: "Charleston (dixieland kick)", pattern: "bzzczzzz" },
  { value: "second-line", label: "Second Line (brass band tresillo)", pattern: "bzzczzfz" },
  { value: "calypso", label: "Calypso (downbeat + off-beat chords)", pattern: "bczczczc" },
  { value: "arpeggio", label: "Banjo Roll (trad jazz, rolled chord)", pattern: "gzhzizjz" },
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

// abcjs's own default %%MIDI beat volumes (synth/abc_midi_flattener.js's
// stressBeat1/stressBeatDown/stressBeatUp) — the first note of a bar, other
// "strong" notes, and everything else, in that order. Scaling these three
// down together (rather than collapsing a voice to one flat number) keeps a
// voice's natural downbeat/upbeat accent at any fader position, and 100%
// reproduces this exact triple, so an untouched voice sounds byte-for-byte
// like it did before per-voice volume existed.
const DEFAULT_BEAT_STRESS = [105, 95, 85];

// A resolved voice's own %%MIDI beat modulus parameter (which notes within a
// bar count as "strong") is irrelevant once all three volumes are scaled by
// the same ratio, but abc2midi's syntax still requires four integers — 1 is
// as good as any.
const BEAT_MODULUS = 1;

// Map a 0-100 mixer percentage to abcjs's three %%MIDI beat volumes (see
// DEFAULT_BEAT_STRESS), scaled by the same cubic taper as every other fader
// here for a consistent feel, and clamped to MIDI's 0-127 range.
export function percentToBeatStress(percent) {
  const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
  const ratio = (clamped / 100) ** VOLUME_CURVE_EXPONENT;
  return DEFAULT_BEAT_STRESS.map((v) => Math.max(0, Math.min(MIDI_VOLUME_MAX, Math.round(v * ratio))));
}

// The %%MIDI beat line itself, ready to splice into ABC text — its own
// function so callers never have to remember BEAT_MODULUS or the param order.
export function beatStressLine(percent) {
  const [b1, b2, b3] = percentToBeatStress(percent);
  return `%%MIDI beat ${b1} ${b2} ${b3} ${BEAT_MODULUS}`;
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

  A voice is discovered from either of two forms, whichever it's first seen
  in: a header-style line that itself starts with "V:" (optionally with
  leading whitespace after the colon, e.g. "V: 1") — a voice's proper
  *declaration*, wherever it falls relative to K: (some tunes declare voices
  before it, honky_tonk_town_riffs.abc after) — or an inline mid-line switch
  ("[V:2] ..."), which most multi-voice tunes here use only to re-select an
  already header-declared voice between systems, but which short_dressed_gal.
  abc uses as the *only* place either of its two voices is ever named — it
  has no "V:" header line at all. Treating only header lines as declarations
  would leave such a tune looking like one implicit voice. A voice's name is
  read from whichever of its lines carries a `name="..."` attribute first —
  later bare re-declarations (a header or inline marker with no attributes)
  don't overwrite an already-found name, and inline markers never carry one
  themselves.
*/
// Matches an inline "[V:<id>]" voice-switch marker wherever it falls within
// a line -- not just at the very start -- so a line can carry notes before
// the marker (a voice switch mid-system) or more than one marker (several
// short switches on one line). Shared by parseVoiceList, hasVoiceDeclaration
// and injectPerVoiceLines below so all three agree on what counts as one.
const INLINE_VOICE_MARKER = /\[V:\s*([^\]\s]+)\]/g;

export function parseVoiceList(abcText) {
  const voices = new Map();
  const order = [];
  function ensure(id) {
    if (!voices.has(id)) {
      voices.set(id, null);
      order.push(id);
    }
  }
  function useName(id, line) {
    if (voices.get(id)) return;
    const nameMatch = /name="([^"]*)"/.exec(line);
    if (nameMatch) voices.set(id, nameMatch[1]);
  }
  abcText.split("\n").forEach((line) => {
    const header = /^V:\s*(\S+)/.exec(line);
    if (header) {
      ensure(header[1]);
      useName(header[1], line);
      return;
    }
    for (const inline of execAll(INLINE_VOICE_MARKER, line)) {
      ensure(inline[1]);
    }
  });
  return order.map((id, index) => ({ id, index, name: voices.get(id) }));
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

/*
  Insert each voice's own list of raw %%MIDI directive lines (in the order
  given — the id -> string[] map from injectMixerAudio, one entry per voice
  that has anything to stamp; %%MIDI program and %%MIDI beat both go through
  this same one scoping pass, since they need to land at exactly the same
  point in the text) right after that voice's own declaration line (matched
  the same way parseVoiceList finds it) -- but a *body* declaration (after
  the tune's K: line) whenever the voice has one there, never a header one,
  even though a header declaration is what most tunes hit first: ABCjs's own
  parser only scopes a %%MIDI directive to "the voice it trails" when it
  reads it *inside* the tune body, once real music has started. One that
  trails a V: line still in the header (before K:) — where a comping-
  augmented ordinary tune's "V:1" / "V:2 name=..." pair, and most multi-voice
  charts' own voice declarations, normally live — instead lands in the tune's
  single shared `formatting.midi.program` slot (or, for %%MIDI beat, its
  tune-wide stress state), not a per-voice one; every such header directive
  overwrites the last, so whichever voice's line comes last in the header
  silently wins for the *entire tune*, melody included (confirmed for
  %%MIDI program by decoding actual generated MIDI bytes: two different
  header-trailing %%MIDI program lines emitted one Program Change, on the
  same channel, at the second line's value only — see beatStressLine's own
  doc comment in this file for the equivalent %%MIDI beat finding, from
  rendered audio rather than MIDI bytes).

  Priority per voice id, highest wins ties broken by first occurrence: a
  real body "V:<id>" declaration line (bodyDecl) > a body-only inline
  "[V:<id>]" switch (inline) > a header-only "V:<id>" line (header, the
  fallback that hits the shared-slot bug above). A voice with only a header
  line and no body reference at all still falls back to it (nothing else to
  scope to). This matters because some tunes — short_dressed_gal.abc,
  feel_like_funkin_it_up.abc — declare their voice names in a header "V:1
  name=..." line (parseVoiceList needs it; inline markers never carry a
  name= of their own) but never re-declare the voice as its own body line,
  switching between voices only via inline "[V:1]"/"[V:2]" markers that
  introduce each system. Left alone, both voices' header lines collide in
  the shared slot exactly as described above — this is why Instrument/Voice
  pickers could end up sounding identical for two different voices despite
  each being set to a different program.

  Confirmed by decoding actual generated MIDI bytes (the same method used
  above): trailing the %%MIDI line directly off the inline "[V:1]"/"[V:2]"
  marker itself — even split onto its own line first, so the directive still
  starts a line — does *not* scope per voice either. Both voices' tracks came
  out on the first voice's program; the second inline switch's directive was
  silently dropped rather than colliding the way two header lines do. What
  does work, decoded the same way: inserting a genuine bare "V:<id>" line
  (no brackets — a real declaration, not a switch) immediately *before* that
  first inline-marker line, then the %%MIDI line, and leaving the original
  "[V:<id>] <notes...>" line completely untouched after it. Two lines are
  added, nothing is split — safe for the printed layout for the same reason
  buildCompingTune's own bare "V:1"/"V:2" declaration lines are (the sheet
  renders with `responsive: "resize"`, songs/sheet.js, which reflows the note
  stream into systems by available width rather than treating each source
  line as fixed).

  A chosen inline marker isn't always alone at the start of its line, though
  — INLINE_VOICE_MARKER matches wherever "[V:<id>]" falls, so the same line
  can carry notes before the marker (a switch mid-system) or more than one
  marker (several short switches in one line), and only one of those markers
  may be the one actually being scoped here. Splitting only at the *chosen*
  marker's boundary — pushing whatever came before it (notes still in the
  previous voice, or an earlier untouched marker) out as its own line, then
  the inserted "V:<id>"/%%MIDI pair, then the rest of the line starting at
  the marker itself — reproduces the "two lines added, nothing else split"
  shape above even when the marker isn't already alone on its line.
*/
function injectPerVoiceLines(text, linesById) {
  const lines = text.split("\n");
  const kIndex = lines.findIndex((l) => l.startsWith("K:"));
  const PRIORITY = { header: 0, inline: 1, bodyDecl: 2 };
  const chosen = new Map();
  function consider(id, kind, location) {
    const prev = chosen.get(id);
    if (!prev || PRIORITY[kind] > PRIORITY[prev.kind]) {
      chosen.set(id, { kind, location });
    }
  }
  lines.forEach((line, lineIndex) => {
    const header = /^V:\s*(\S+)/.exec(line);
    if (header) {
      const isBody = kIndex !== -1 && lineIndex > kIndex;
      consider(header[1], isBody ? "bodyDecl" : "header", { lineIndex });
      return;
    }
    for (const inline of execAll(INLINE_VOICE_MARKER, line)) {
      consider(inline[1], "inline", { lineIndex, col: inline.index });
    }
  });

  // Header/bodyDecl insertions just append the voice's directive lines after
  // the declaration, one group per line (a declaration line names exactly
  // one voice); inline insertions may share a line with other markers, so
  // those are grouped per line and sorted left to right to split that line
  // at each chosen marker in turn.
  const appendAfter = new Map();
  const inlineByLine = new Map();
  chosen.forEach(({ kind, location }, id) => {
    const directiveLines = linesById.get(id);
    if (directiveLines === undefined) return;
    if (kind === "inline") {
      const existing = inlineByLine.get(location.lineIndex);
      const list = existing === undefined ? [] : existing;
      list.push({ id, col: location.col, directiveLines });
      inlineByLine.set(location.lineIndex, list);
    } else {
      appendAfter.set(location.lineIndex, directiveLines);
    }
  });
  inlineByLine.forEach((list) => list.sort((a, b) => a.col - b.col));

  return lines
    .flatMap((line, lineIndex) => {
      const after = appendAfter.get(lineIndex);
      if (after !== undefined) return [line, ...after];

      const markers = inlineByLine.get(lineIndex);
      if (!markers) return [line];

      const out = [];
      let segmentStart = 0;
      markers.forEach(({ id, col, directiveLines }) => {
        const prefix = line.slice(segmentStart, col);
        if (prefix !== "") out.push(prefix);
        out.push(`V:${id}`, ...directiveLines);
        segmentStart = col;
      });
      out.push(line.slice(segmentStart));
      return out;
    })
    .join("\n");
}

// True once `text` declares at least one voice of its own — a real "V:<id>"
// line (wherever it falls relative to K:) or a body-only "[V:<id>]" inline
// switch (short_dressed_gal.abc's shape), anywhere in its line — i.e.
// whether injectPerVoiceLines above has anything to attach a scoped
// directive to at all.
const HEADER_VOICE_DECLARATION = /^V:\s*\S+/m;

function hasVoiceDeclaration(text) {
  return HEADER_VOICE_DECLARATION.test(text) || text.search(INLINE_VOICE_MARKER) !== -1;
}

/*
  Stamp Bass/Chords' full accompaniment directives, and every other voice's
  Voice + Volume (via beatStressLine's %%MIDI beat scaling — see the file doc
  comment for why not a plain %%MIDI vol), into the ABC text about to be
  handed to ABCJS.renderAbc, so whatever gets rendered is exactly what plays
  — there's no separate "audio-only" reparse, which would desync the
  playback cursor from the visible notation (ABCjs ties cursor highlighting
  to the actual rendered visualObj, not a freshly parsed twin of it).

  `voicePrograms` (id -> program) comes from resolveMixerVoices' resolved
  list — always at least one entry. `voiceVolumes` (id -> 0-100 percent) is
  its volume counterpart; a voice missing from it (an older caller, or a test
  that doesn't care about volume) defaults to 100 — full, today's untouched
  level — rather than being skipped, since the file doc comment's cross-voice
  %%MIDI beat leak means every voice needs an explicit line one way or
  another. Most tunes end up with a real "V:<id>" declaration in the text to
  scope each voice's lines to (either the tune's own, or the "V:1"/"V:2" pair
  buildCompingTune always emits once Comping is on — see its own doc
  comment). The one tune shape with no such line at all is an ordinary
  single-voice tune with Comping off and no V: declaration of its own (the
  vast majority of songs here): there's nothing to scope to, so this falls
  back to one tune-wide %%MIDI program + %%MIDI beat pair before K:, exactly
  as if the whole tune were voice 1.
*/
export function injectMixerAudio(abcText, {
  hasChords,
  bassPercent, bassProgram = DEFAULT_PROGRAM.bass,
  chordsPercent, chordsProgram = DEFAULT_PROGRAM.chords,
  gchordPattern = resolveGchordPattern(DEFAULT_GCHORD_PATTERN_VALUE),
  voicePrograms,
  voiceVolumes = new Map(),
}) {
  const withAccompaniment = insertLinesBeforeKeyLine(
    abcText, accompanimentLines(hasChords, {
      bassPercent, chordsPercent, bassProgram, chordsProgram, gchordPattern,
    }),
  );

  const linesById = new Map();
  voicePrograms.forEach((program, id) => {
    const storedVolumePercent = voiceVolumes.get(id);
    const volumePercent = storedVolumePercent === undefined ? 100 : storedVolumePercent;
    linesById.set(id, [`%%MIDI program ${program}`, beatStressLine(volumePercent)]);
  });

  if (hasVoiceDeclaration(withAccompaniment)) {
    return injectPerVoiceLines(withAccompaniment, linesById);
  }

  const [[, onlyLines]] = linesById;
  return insertLinesBeforeKeyLine(withAccompaniment, onlyLines);
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
