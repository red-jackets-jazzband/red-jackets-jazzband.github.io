// Small wrapper around localStorage for the songs page's sticky UI choices
// (selected instrument, comping pattern, "advanced controls" toggle, personal
// setlists). Every access is guarded: private-browsing / disabled storage
// degrades to "the choice just won't persist" instead of throwing.

// localStorage keys, centralised so the schema is visible in one place. These
// are part of a persisted contract — don't rename without a migration.
export const PREF_KEYS = {
  instrument: "rj.instrument",
  comping: "rj.comping",
  sheetAdvanced: "rj.sheetAdvanced",
  inspirationWidth: "rj.inspirationWidth",
  mixerBassVolume: "rj.mixerBassVolume",
  mixerChordsVolume: "rj.mixerChordsVolume",
  mixerBassMuted: "rj.mixerBassMuted",
  mixerChordsMuted: "rj.mixerChordsMuted",
  mixerBassProgram: "rj.mixerBassProgram",
  mixerChordsProgram: "rj.mixerChordsProgram",
  mixerGchordPattern: "rj.mixerGchordPattern",
  mixerSwing: "rj.mixerSwing",
  metronomeEnabled: "rj.metronomeEnabled",
  highQualityAudio: "rj.highQualityAudio",
};

// The raw Storage object, or null when it can't be reached. Callers that hand
// this to setlists-store.js want the object itself.
export function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    // Storage access itself can throw (sandboxed iframe, blocked cookies).
    return null;
  }
}

export function readPref(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Unreadable storage — treat as "no stored value".
    return null;
  }
}

// Returns true when the value was persisted, false when storage was unavailable.
export function writePref(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    // Unwritable storage (private mode, quota) — the choice just won't stick.
    return false;
  }
}
