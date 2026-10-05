/*
  The songs page's state layout: every store slice (lib/core/store.js), who
  owns it, and how the app store is built from them.

    slice      owner                         what
    ---------  ----------------------------  ---------------------------------
    catalog    core/app.js, setlists/data    the song + band-setlist indexes
    nav        core/navigation.js            tab, open song, open setlist
    settings   sheet/selects + controls      instrument, key, drawer, comping
    tune       sheet/sheet.js                what the live sheet is showing
    mixer      audio/mixer.js                channels, pattern, swing, voices
    playback   audio/player + metronome      tempo, repeat, metronome

  Only a slice's owner writes it; everyone else reads it (ctx.state.<key>, or
  ctx.store.get(slice)) and, to react to a change, subscribes
  (ctx.store.subscribe(slice, fn)). Each slice is `{ name, initial, prefs }`:
  `initial` holds its transient keys, `prefs` its persisted ones as
  lib/core/persisted.js codecs, whose fallbacks double as the defaults.

  A new feature with state of its own adds a slice here.
*/
import { createStore } from "../../lib/core/store.js";
import { loadPersisted, bindPersisted } from "../../lib/core/persisted.js";
import { SETTINGS_SLICE, TUNE_SLICE } from "../sheet/state.js";
import { MIXER_SLICE, PLAYBACK_SLICE } from "../audio/state.js";

export const CATALOG_SLICE = {
  name: "catalog",
  initial: {
    allSongs: [], // parsed index_of_songs.txt: [{ name, file }]
    allSongsLoaded: false,
    setlistIndex: [], // parsed index_of_setlists.txt: [{ name, file }]
  },
  prefs: {},
};

export const NAV_SLICE = {
  name: "nav",
  initial: {
    activeTab: "library", // "library" | "setlists"
    setlistsView: "home", // "home" | "open"
    currentSongFile: null, // the song on the sheet
    // Library: the exact row the open song was picked from (a song can be
    // listed under several names), and that row's name.
    currentLibraryIndex: null,
    currentLibrarySongName: undefined,
    // The open setlist: its `sl=` hash id, its personal-setlist id (null for
    // a band setlist), its contents, and the open song's position in it.
    currentSetlistId: null,
    currentPersonalId: null,
    currentOpenSongs: null,
    currentOpenSetlistName: "",
    currentOpenSetlistDesc: "",
    currentSetlistSongIndex: null,
  },
  prefs: {},
};

// The meta tag (lib/core/store.js) for state a render derives itself — the
// Key stepper seeded for a newly opened song, the Mixer's voice list for the
// tune on the sheet. Subscribers that react to the listener's own changes
// (re-engraving, writing a setlist row's key back) skip these.
export const RENDER = Object.freeze({ source: "render" });

export function isRenderWrite(meta) {
  return Boolean(meta) && meta.source === RENDER.source;
}

export const APP_SLICES = [CATALOG_SLICE, NAV_SLICE, SETTINGS_SLICE, TUNE_SLICE, MIXER_SLICE, PLAYBACK_SLICE];

const NOTHING_STORED = () => null;

/*
  A store holding every slice at its defaults (persisted keys at their codec
  fallbacks — nothing is read from storage here), with `overrides` — a flat
  `{ key: value }` map like ctx.state's own shape — applied on top. Tests use
  the overrides to seed state; the app binds the stored prefs afterwards
  (bindAppPrefs).
*/
export function createAppStore(overrides = {}, slices = APP_SLICES) {
  const initial = {};
  slices.forEach((slice) => {
    initial[slice.name] = { ...loadPersisted(slice.prefs, NOTHING_STORED), ...slice.initial };
  });
  const store = createStore(initial);
  Object.keys(overrides).forEach((key) => {
    const name = store.sliceOf(key);
    if (!name) throw new Error(`createAppStore: no slice declares "${key}"`);
    store.set(name, { [key]: overrides[key] });
  });
  return store;
}

// Load every slice's persisted keys from storage and write them back on change.
export function bindAppPrefs(store, io, slices = APP_SLICES) {
  slices.forEach((slice) => {
    if (Object.keys(slice.prefs).length > 0) bindPersisted(store, slice.name, slice.prefs, io);
  });
}
