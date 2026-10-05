/*
  The audio feature's two store slices (see songs/core/state.js):

  - `mixer`: everything the Mixer panel controls that changes what the synth
    plays — Bass/Chords channels, the auto-accompaniment Pattern, Swing, the
    soundfont Quality toggle, and the tune's resolved per-voice channels.
    Owned by songs/audio/mixer.js.
  - `playback`: transport settings that don't change the engraved tune —
    the Tempo stepper's override, the Repeat stepper and the Metronome.
    Owned by songs/audio/player.js and songs/audio/metronome.js.

  `prefs` is each slice's persisted contract (lib/core/persisted.js): the
  localStorage keys are part of returning visitors' saved state, so don't
  rename one without a migration.
*/
import { PREF_KEYS } from "../../lib/core/preferences.js";
import {
  boolPref, intPref, nullableNumberPref, enumPref, objectPref,
} from "../../lib/core/persisted.js";
import { GCHORD_PATTERNS, DEFAULT_GCHORD_PATTERN_VALUE } from "../../lib/audio/audio-mix.js";

// Bass/Chords are ABCjs's own auto-accompaniment, generated from the tune's
// chord symbols — see lib/audio/audio-mix.js's file doc comment for why they
// work differently from every per-voice channel.
export const CHANNELS = ["bass", "chords"];
const DEFAULT_MUTED = { bass: false, chords: false };
const DEFAULT_VOLUME = { bass: 100, chords: 88 };

// Swing defaults on (a moderate amount, not full) rather than off, since most
// of this band's repertoire is swung, not straight.
const SWING_DEFAULT_PERCENT = 52;

// The Repeat stepper's bounds: at least one playthrough (no repeat), capped
// at 20 — enough for real practice loops without a runaway value ticking
// away in the background if someone mistypes into the number field.
export const REPEAT_COUNT_MIN = 1;
export const REPEAT_COUNT_MAX = 20;
export const REPEAT_COUNT_DEFAULT = 1;

function cap(channel) {
  return channel[0].toUpperCase() + channel.slice(1);
}

// A percent fader: missing -> the channel's default, out of range -> clamped,
// corrupt -> 100 (full volume, the long-standing behaviour).
function percentPref(key, fallback, corrupt = 100) {
  return intPref(key, {
    fallback, corrupt, min: 0, max: 100,
  });
}

function channelPrefs() {
  const fields = {};
  CHANNELS.forEach((channel) => {
    fields[`${channel}Volume`] = percentPref(PREF_KEYS[`mixer${cap(channel)}Volume`], DEFAULT_VOLUME[channel]);
    fields[`${channel}Muted`] = boolPref(PREF_KEYS[`mixer${cap(channel)}Muted`], DEFAULT_MUTED[channel]);
    fields[`${channel}Program`] = nullableNumberPref(PREF_KEYS[`mixer${cap(channel)}Program`]);
  });
  return objectPref(fields);
}

export const MIXER_SLICE = {
  name: "mixer",
  initial: {
    // Per-voice channel state for the tune on the sheet, materialised from
    // tune.instrumentVoices by mixer.js's syncVoices: { id, index, label,
    // slug, muted, program, volume, autoMuted, ... }. Persisted per voice
    // name by mixer.js itself (the keys are dynamic, so no schema entry).
    mixerVoices: [],
  },
  prefs: {
    // { bassVolume, bassMuted, bassProgram, chordsVolume, chordsMuted, chordsProgram }
    mixer: channelPrefs(),
    gchordPattern: enumPref(
      PREF_KEYS.mixerGchordPattern,
      GCHORD_PATTERNS.map((p) => p.value),
      DEFAULT_GCHORD_PATTERN_VALUE,
    ),
    // A corrupt swing pref falls back to the default swing, not maximum.
    swing: percentPref(PREF_KEYS.mixerSwing, SWING_DEFAULT_PERCENT, SWING_DEFAULT_PERCENT),
    // MusyngKite (richer, ~5x bigger samples) vs FatBoy — see player.js.
    highQualityAudio: boolPref(PREF_KEYS.highQualityAudio, true),
  },
};

export const PLAYBACK_SLICE = {
  name: "playback",
  initial: {
    // The Tempo stepper's bpm, or null for the tune's own Q: tempo. Reset on
    // every new song (sheet.js's render).
    tempoOverrideBpm: null,
  },
  prefs: {
    repeatCount: intPref(PREF_KEYS.repeatCount, {
      fallback: REPEAT_COUNT_DEFAULT, min: REPEAT_COUNT_MIN, max: REPEAT_COUNT_MAX, invalid: "fallback",
    }),
    metronomeEnabled: boolPref(PREF_KEYS.metronomeEnabled, false),
  },
};
