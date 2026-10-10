import { findInstrument, offsetForInstrument } from "../music/instruments.js";
import {
  extractKeyFromAbc,
  setlistTransposeSteps,
  formatSetlistKeyLabel,
  transposeKeyName,
  tempoBpmFromAbc,
} from "../music/music-theory.js";
import { tl } from "../core/i18n.js";

// Per-song and per-booklet facts the printed setlist forms show. Pure: the
// selected instrument comes in as its <option> value, not read from the DOM.

// True when the instrument reads in a different key from concert (trumpet,
// clarinet, saxes, sousaphone). Concert pitch, Concert + Roman and trombone all
// read concert, so the stage list then shows a single key column.
export function instrumentTransposes(instrumentValue) {
  return offsetForInstrument(instrumentValue) !== 0;
}

export function instrumentLabel(instrumentValue) {
  const found = findInstrument(instrumentValue);
  return found ? found.label : tl("concert_pitch", "Concert pitch");
}

// The front-matter line naming what the booklet is engraved for.
export function exportInstrumentLine(instrumentValue) {
  if (instrumentValue === "concert_pitch" || instrumentValue === "concert_+_roman") {
    return tl("concert_pitch", "Concert pitch");
  }
  if (instrumentTransposes(instrumentValue)) {
    return tl("export_transposed_for", "Transposed for {instrument}", { instrument: instrumentLabel(instrumentValue) });
  }
  // e.g. trombone — bass clef, but still concert pitch
  return tl("export_concert_pitch_for", "{instrument} — concert pitch", { instrument: instrumentLabel(instrumentValue) });
}

/*
  Per-song facts the printed forms show, resolved once a song's .abc has loaded.
  Keys are spelled out ("B♭") and always shown — even for C — since on stage you
  call the key, not a semitone offset.
    concert    - the tune's K: plus the setlist's per-song override only
    instrument - also folds in the selected instrument's offset (what that
                 player reads; matches the engraved chordbook / songbook)
    bpm        - the tune's Q: tempo, or null
  Both keys fall back to the raw override badge when the .abc has no readable K:.
*/
export function resolvedExportSongMeta(abcText, song, instrumentValue) {
  const bpm = tempoBpmFromAbc(abcText);
  const nativeKey = extractKeyFromAbc(abcText);
  if (!nativeKey) {
    const fallback = formatSetlistKeyLabel(song.key);
    return { concert: fallback, instrument: fallback, bpm };
  }
  const overrideSteps = setlistTransposeSteps(song.key, nativeKey);
  return {
    concert: transposeKeyName(nativeKey, overrideSteps),
    instrument: transposeKeyName(nativeKey, overrideSteps + offsetForInstrument(instrumentValue)),
    bpm,
  };
}
