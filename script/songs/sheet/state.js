/*
  The sheet feature's two store slices (see songs/core/state.js):

  - `settings`: what the listener has chosen for how the chart is drawn — the
    Instrument, the Key stepper, the More-controls drawer and the Comping /
    Solo pickers in it. The toolbar widgets (selects.js, controls.js) write
    here and redraw from here; sheet.js reads only this, never the widgets.
  - `tune`: what the live sheet is currently showing, published by sheet.js
    after every live render (never by a booklet render) for everything that
    reacts to it: audio, the Mixer, the tour, rerender().

  `prefs` is the persisted contract (lib/core/persisted.js) — the keys are
  part of returning visitors' saved state, so don't rename one without a
  migration.
*/
import { PREF_KEYS } from "../../lib/core/preferences.js";
import { boolPref, enumPref } from "../../lib/core/persisted.js";
import { INSTRUMENTS } from "../../lib/music/instruments.js";
import { COMPING_PATTERNS } from "../../lib/music/comping.js";
import { SOLO_STYLES } from "../../lib/music/solo.js";

// The comping Split toggles, in staff order: root, third, fifth.
export const COMPING_PARTS = ["R", "3", "5"];
const ALL_COMPING_PARTS = COMPING_PARTS.map((_name, index) => index);

// The selected chord tones, as indices into COMPING_PARTS, stored by name
// ("R,3,5"). At least one is always selected; an empty or unreadable pref
// means all three.
const compingPartsPref = {
  load(read) {
    const names = new Set((read(PREF_KEYS.compingParts) || "").split(","));
    const parts = ALL_COMPING_PARTS.filter((index) => names.has(COMPING_PARTS[index]));
    return parts.length > 0 ? parts : ALL_COMPING_PARTS;
  },
  save(parts, write) {
    write(PREF_KEYS.compingParts, parts.map((index) => COMPING_PARTS[index]).join(","));
  },
};

export const SETTINGS_SLICE = {
  name: "settings",
  initial: {
    // The Key stepper, in semitones. Not sticky: every newly opened song
    // starts from its own key (or its setlist row's override).
    transpose: 0,
    // Solo is built but switched off (results not good enough yet): the
    // dropdown is only created, and the pick only honoured, once this is on.
    soloEnabled: false,
  },
  prefs: {
    instrument: enumPref(PREF_KEYS.instrument, INSTRUMENTS.map((i) => i.value), INSTRUMENTS[0].value),
    advancedOpen: boolPref(PREF_KEYS.sheetAdvanced, false),
    comping: enumPref(PREF_KEYS.comping, ["off", ...COMPING_PATTERNS.map((p) => p.value)], "off"),
    compingSplit: boolPref(PREF_KEYS.compingSplit, false),
    compingParts: compingPartsPref,
    solo: enumPref(PREF_KEYS.solo, ["off", ...SOLO_STYLES.map((s) => s.value)], "off"),
  },
};

export const TUNE_SLICE = {
  name: "tune",
  initial: {
    currentSongText: undefined, // clef-adjusted ABC currently on the sheet
    hasChords: false,
    compingActive: false,
    soloActive: false,
    // The tune's fully resolved Mixer voice list — lib/audio/audio-mix.js's
    // resolveMixerVoices.
    instrumentVoices: [],
    songSerial: 0, // bumped by each render() of a newly opened song
    title: "",
    inspirationLinks: [], // the tune's F: links, lib/media/inspiration-links.js
    audioTranspose: 0, // semitones the synth plays at (Key stepper + setlist row)
    chordOffset: 0, // leading chordless bars before the chord table's first cell
    repeatBoundaries: null, // the chord table's { start, end } repeat span
    visualObj: null, // the engraved ABCjs tune object the player loads
  },
  prefs: {},
};
