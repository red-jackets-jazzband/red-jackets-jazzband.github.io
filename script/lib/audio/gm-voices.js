// A curated General MIDI instrument subset for the Mixer's per-channel Voice
// picker — not the full 128-entry GM set, just what suits a jazz combo (same
// spirit as lib/instruments.js's playing-instrument list, but this picks the
// *sound* SynthController renders, not which transposed part is on the
// page). `value` is the 0-indexed GM program number that ABCjs's
// %%MIDI program / bassprog / chordprog directives all expect.
import { tl } from "../core/i18n.js";
export const GM_VOICES = [
  { value: 0, label: tl("gm_piano", "Piano"), group: tl("gm_group_keys", "Keys") },
  { value: 4, label: tl("gm_electric_piano", "Electric Piano"), group: tl("gm_group_keys", "Keys") },
  { value: 16, label: tl("gm_organ", "Organ"), group: tl("gm_group_keys", "Keys") },
  { value: 11, label: tl("gm_vibraphone", "Vibraphone"), group: tl("gm_group_keys", "Keys") },
  { value: 24, label: tl("gm_acoustic_guitar_nylon", "Acoustic Guitar (nylon)"), group: tl("gm_group_guitars", "Guitars") },
  { value: 25, label: tl("gm_acoustic_guitar_steel", "Acoustic Guitar (steel)"), group: tl("gm_group_guitars", "Guitars") },
  { value: 26, label: tl("gm_jazz_guitar", "Jazz Guitar"), group: tl("gm_group_guitars", "Guitars") },
  { value: 105, label: tl("gm_banjo", "Banjo"), group: tl("gm_group_guitars", "Guitars") },
  { value: 32, label: tl("gm_acoustic_bass", "Acoustic Bass"), group: tl("gm_group_bass", "Bass") },
  { value: 33, label: tl("gm_electric_bass_finger", "Electric Bass (finger)"), group: tl("gm_group_bass", "Bass") },
  { value: 34, label: tl("gm_electric_bass_pick", "Electric Bass (pick)"), group: tl("gm_group_bass", "Bass") },
  { value: 43, label: tl("gm_contrabass", "Contrabass"), group: tl("gm_group_bass", "Bass") },
  { value: 56, label: tl("gm_trumpet", "Trumpet"), group: tl("gm_group_brass", "Brass") },
  { value: 59, label: tl("gm_muted_trumpet", "Muted Trumpet"), group: tl("gm_group_brass", "Brass") },
  { value: 57, label: tl("gm_trombone", "Trombone"), group: tl("gm_group_brass", "Brass") },
  { value: 58, label: tl("gm_tuba", "Tuba"), group: tl("gm_group_brass", "Brass") },
  { value: 60, label: tl("gm_french_horn", "French Horn"), group: tl("gm_group_brass", "Brass") },
  { value: 61, label: tl("gm_brass_section", "Brass Section"), group: tl("gm_group_brass", "Brass") },
  { value: 65, label: tl("gm_alto_sax", "Alto Sax"), group: tl("gm_group_reeds", "Reeds") },
  { value: 66, label: tl("gm_tenor_sax", "Tenor Sax"), group: tl("gm_group_reeds", "Reeds") },
  { value: 67, label: tl("gm_baritone_sax", "Baritone Sax"), group: tl("gm_group_reeds", "Reeds") },
  { value: 71, label: tl("gm_clarinet", "Clarinet"), group: tl("gm_group_reeds", "Reeds") },
  { value: 73, label: tl("gm_flute", "Flute"), group: tl("gm_group_reeds", "Reeds") },
];

// A tune's own instrument-voice name (a Rebirth Brass Band chart's "Trumpet"/
// "Sousaphone" V: declarations — see lib/audio-mix.js's parseVoiceList) is a
// far better hint for that voice's Mixer "Default" sound than the single
// hardcoded Trumpet every plain melody voice defaulted to before per-voice
// Voice pickers existed. Checked in order (most specific first, so e.g.
// "Baritone Sax" matches before the generic "sax" fallback); an unrecognised
// name falls back to Trumpet, the same one-size-fits-all default every other
// channel's own "Default" already uses.
const VOICE_NAME_PROGRAM_HINTS = [
  { test: /sousaphone|tuba/i, value: 58 },
  { test: /trombone/i, value: 57 },
  { test: /trumpet/i, value: 56 },
  { test: /french horn/i, value: 60 },
  { test: /baritone sax/i, value: 67 },
  { test: /tenor sax/i, value: 66 },
  { test: /alto sax|sax(ophone)?/i, value: 65 },
  { test: /clarinet/i, value: 71 },
  { test: /flute/i, value: 73 },
  { test: /banjo/i, value: 105 },
  { test: /bass/i, value: 32 },
  { test: /guitar/i, value: 26 },
  { test: /organ/i, value: 16 },
  { test: /piano/i, value: 0 },
  { test: /vibraphone|vibes/i, value: 11 },
];

// A resolved Mixer voice's un-overridden program: its own `fallbackProgram`
// when the voice came with one (the generated Solo, whose instrument follows
// its style), else a guess from its name.
export function defaultVoiceProgram(voice) {
  return voice.fallbackProgram === undefined ? guessGmProgram(voice.label) : voice.fallbackProgram;
}

export function guessGmProgram(label, fallback = 66) {
  if (!label) return fallback;
  const hit = VOICE_NAME_PROGRAM_HINTS.find((hint) => hint.test.test(label));
  return hit ? hit.value : fallback;
}
