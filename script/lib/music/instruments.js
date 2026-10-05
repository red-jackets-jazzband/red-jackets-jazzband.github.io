// The instruments a chart can be read as. `value` matches the <option>
// value historically produced by lowercasing/underscoring the label (kept
// stable since it's part of the localStorage schema from Milestone 2
// onward). `offsetSemitones` is the real-time transposition applied on top
// of any manual "song key" transpose the player has dialed in.
// `clef` controls whether a bass clef gets stamped onto the K: line.
export const INSTRUMENTS = [
  { value: "concert_pitch", label: "Concert pitch", offsetSemitones: 0, clef: "treble" },
  { value: "concert_+_roman", label: "Concert + Roman", offsetSemitones: 0, clef: "treble" },
  { value: "alto_saxophone", label: "Alto Saxophone", offsetSemitones: 9, clef: "treble" },
  { value: "clarinet_bb", label: "Clarinet Bb", offsetSemitones: 2, clef: "treble" },
  { value: "sousaphone", label: "Sousaphone", offsetSemitones: 2, clef: "bass" },
  { value: "tenor_saxophone", label: "Tenor Saxophone", offsetSemitones: 2, clef: "treble" },
  { value: "trombone", label: "Trombone", offsetSemitones: 0, clef: "bass" },
  { value: "trumpet", label: "Trumpet", offsetSemitones: 2, clef: "treble" },
];

export function findInstrument(instrumentValue) {
  return INSTRUMENTS.find((instrument) => instrument.value === instrumentValue);
}

export function offsetForInstrument(instrumentValue) {
  const entry = findInstrument(instrumentValue);
  return entry ? entry.offsetSemitones : 0;
}

// Stamps `clef=bass middle=D` onto the ABC K: line for bass-clef instruments,
// or strips it for everything else. Only touches the header K: line itself
// (line-start, never an inline `[K:...]` change), so it's a no-op for files
// that already define their own per-voice clef (see hasInstrumentVoices in
// render_abc.js, which bypasses this entirely). It also strips any clef it
// stamped before re-adding one, so repeated calls are idempotent — sheet.js
// hands back its own already-transformed ABC on every rerender.
// Removes every "clef=bass middle=D" (and any whitespace right before it)
// from `line` — a plain indexOf scan rather than a `\s*literal` regex, which
// backtracks over every position with no match the same way a bare
// `[^x]*literal` pattern does.
function stripBassClefStamp(line) {
  const marker = "clef=bass middle=D";
  let result = line;
  let idx = result.indexOf(marker);
  while (idx !== -1) {
    let start = idx;
    while (start > 0 && (result[start - 1] === " " || result[start - 1] === "\t")) start -= 1;
    result = result.slice(0, start) + result.slice(idx + marker.length);
    idx = result.indexOf(marker);
  }
  return result;
}

export function changeClefForInstrument(instrumentValue, text) {
  const entry = findInstrument(instrumentValue);
  const clef = entry ? entry.clef : "treble";
  return text.replace(/^K:(.*)$/m, (_match, keyLine) => {
    const bare = stripBassClefStamp(keyLine);
    return `K:${bare}${clef === "bass" ? " clef=bass middle=D" : ""}`;
  });
}
