/*
  Pitch class of a note name, shared by everything that has to turn a
  printed note or chord root into 0-11: music-theory.js (keys, Roman
  numerals), chord-symbol.js (what the Layers modules parse chords with).
*/

// Tolerates Tonal.Note.get throwing on unparseable input by reporting no
// chroma — the caller falls back to the manual table below either way.
function tonalChroma(normalized) {
  try {
    return Tonal.Note.get(normalized).chroma;
  } catch {
    return undefined;
  }
}

// Pitch class (0-11) of a note name. Prefers Tonal.js (loaded as a global
// classic script alongside this module in the browser) for full enharmonic
// handling, falling back to a small manual table so this still works in
// Node (unit tests) or if Tonal fails to load.
export function noteChroma(noteName) {
  // NOSONAR: String#replaceAll is Safari 13.1+; the page must run on Safari 12.
  const normalized = noteName.replace(/♭/g, "b").replace(/♯/g, "#"); // NOSONAR
  if (typeof Tonal !== "undefined" && Tonal.Note) {
    const chroma = tonalChroma(normalized);
    // Tonal represents an unparseable note (e.g. "Am" — a chord, not a
    // plain note name — passed in when a setlist key override carries a
    // mode suffix) as chroma: NaN, not undefined. typeof NaN is still
    // "number", so this must be excluded explicitly or it gets returned
    // as-is instead of falling through to the manual table below.
    if (typeof chroma === "number" && !Number.isNaN(chroma)) return chroma;
  }
  const CHROMAS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const letter = (normalized[0] || "C").toUpperCase();
  const rest = normalized.slice(1);
  let c = CHROMAS[letter] !== undefined ? CHROMAS[letter] : 0;
  for (const accidental of rest) {
    if (accidental === "b") c--;
    else if (accidental === "#") c++;
  }
  return ((c % 12) + 12) % 12;
}
