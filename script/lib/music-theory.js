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
  const normalized = noteName.replace(/♭/g, "b").replace(/♯/g, "#");
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
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "b") c--;
    else if (rest[i] === "#") c++;
  }
  return ((c % 12) + 12) % 12;
}

export function chordToRomanNumeral(chordStr, keyRoot, keyMode) {
  if (!chordStr || chordStr === " % ") return chordStr;

  const match = chordStr.match(/^([A-G][♭♯b#]?)(.*)/);
  if (!match) return chordStr;
  const chordRoot = match[1];
  const suffix = match[2] || "";

  const interval = (noteChroma(chordRoot) - noteChroma(keyRoot) + 12) % 12;
  const isMinorKey = keyMode && keyMode !== "" && keyMode !== "major" && keyMode !== "maj";

  const MAJOR_MAP = {
    0: [0, ""], 1: [1, "♭"], 2: [1, ""], 3: [2, "♭"], 4: [2, ""], 5: [3, ""],
    6: [3, "♯"], 7: [4, ""], 8: [5, "♭"], 9: [5, ""], 10: [6, "♭"], 11: [6, ""],
  };
  const MINOR_MAP = {
    0: [0, ""], 1: [1, "♭"], 2: [1, ""], 3: [2, ""], 4: [2, "♯"], 5: [3, ""],
    6: [4, "♭"], 7: [4, ""], 8: [5, ""], 9: [5, "♯"], 10: [6, ""], 11: [6, "♯"],
  };

  const entry = (isMinorKey ? MINOR_MAP : MAJOR_MAP)[interval] || [0, ""];
  const ROMANS = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const romanBase = ROMANS[entry[0]];
  const accidental = entry[1];

  const isMinorChord = /^(m|min|-)(?!aj)/i.test(suffix);
  const isHalfDim = /^(Ø|m7[b♭]5)/i.test(suffix);
  const isDim = /^(°|dim)/i.test(suffix);
  const isAug = /^(\+|aug)/i.test(suffix);
  const isMaj7 = /maj7|Δ/.test(suffix);
  const numExt = (suffix.match(/\d+/) || [])[0] || "";

  let roman;
  if (isHalfDim) roman = romanBase.toLowerCase() + "ø7";
  else if (isDim) roman = romanBase.toLowerCase() + "°";
  else if (isMinorChord) roman = romanBase.toLowerCase() + numExt;
  else if (isAug) roman = romanBase + "+";
  else if (isMaj7) roman = romanBase + "maj7";
  else roman = romanBase + numExt;

  return accidental + roman;
}

export function convertChordsToRoman(chords, song) {
  if (!chords || !chords.length || !song.lines || !song.lines[0]) return chords;

  // Build a per-line key map so key changes mid-song are handled
  const lineKeys = song.lines.map((line) => {
    return (line.staff && line.staff[0] && line.staff[0].key) || null;
  });

  // Walk lines again to propagate: each line inherits the last known key
  const resolvedKeys = [];
  let lastKey = lineKeys[0] || { root: "C", acc: "", mode: "" };
  for (let i = 0; i < lineKeys.length; i++) {
    if (lineKeys[i] && lineKeys[i].root) lastKey = lineKeys[i];
    resolvedKeys.push(lastKey);
  }

  // Count measures per line so we can map measure index → key
  const measureKeyMap = [];
  for (let li = 0; li < song.lines.length; li++) {
    const line = song.lines[li];
    if (!line.staff || !line.staff[0] || !line.staff[0].voices) continue;
    const voice = line.staff[0].voices[0] || [];
    const lineKey = resolvedKeys[li];
    let currentKey = lineKey;
    for (let j = 0; j < voice.length; j++) {
      const el = voice[j];
      if (el.el_type === "keySignature" && el.key && el.key.root) currentKey = el.key;
      if (el.el_type === "bar") measureKeyMap.push(currentKey);
    }
  }

  return chords.map((measure, idx) => {
    const key = measureKeyMap[idx] || resolvedKeys[0] || { root: "C", acc: "", mode: "" };
    const keyRoot = key.root + (key.acc || "");
    const keyMode = key.mode || "";
    const romanText = measure.text.map((chordStr) => {
      return chordToRomanNumeral(chordStr, keyRoot, keyMode);
    });
    return { ...measure, text: romanText };
  });
}

// Reads the tonic (letter + optional single accidental) off an ABC file's
// K: line, ignoring any mode word that follows (maj/min/m/dor/...) so
// "K:Bbmaj" doesn't get misread as "Bbm". Returns null if there's no K:
// line to read (e.g. malformed input).
export function extractKeyFromAbc(text) {
  const match = text.match(/^K:\s*([A-Ga-g])([#b]?)/m);
  return match ? match[1] + match[2] : null;
}

/*
   Reads the tempo in beats per minute off an ABC file's Q: field, for the
   printed setlist's "134 bpm" hint. Handles the common forms:
   "Q:120", "Q:1/4=120", "Q:1/4 120", 'Q:"Swing" 1/4=132', "Q: 3/8=60".
   Returns null when there's no Q: field or no number to read.
*/
export function tempoBpmFromAbc(text) {
  // The surrounding whitespace this used to trim off within the regex
  // itself (`\s*(.+?)\s*$`) is trimmed below instead — that pattern let the
  // lazy `.+?` and the trailing `\s*` disagree over which of them owned a
  // run of whitespace, which is exactly the ambiguity that makes a regex
  // engine backtrack superlinearly.
  const line = /^Q:(.*)$/m.exec(String(text || ""));
  if (!line) return null;
  const body = line[1].replace(/"[^"]*"/g, " ").trim();
  const afterEquals = /=\s*(\d+(?:\.\d+)?)/.exec(body);
  if (afterEquals) return Math.round(Number.parseFloat(afterEquals[1]));
  // No "=": a bare "Q:120" or "Q:1/4 120" — take a number that isn't the
  // denominator of a note-length fraction.
  const bare = /(?:^|\s)(\d+(?:\.\d+)?)(?!\s*\/)/.exec(body);
  return bare ? Math.round(Number.parseFloat(bare[1])) : null;
}

// Shortest signed semitone distance to transpose `fromKeyStr` to
// `toKeyStr` (range roughly -6..+6, rather than always 0..11) — e.g. going
// from Bb to Ab is -2, not +10. Mode suffixes (m, maj, min, ...) on either
// string are ignored; only the tonic pitch class matters for transposition.
export function semitonesBetweenKeys(fromKeyStr, toKeyStr) {
  if (!fromKeyStr || !toKeyStr) return 0;
  let diff = (noteChroma(toKeyStr) - noteChroma(fromKeyStr) + 12) % 12;
  if (diff > 6) diff -= 12;
  return diff;
}

// True when a setlist key-override column holds a bare signed integer
// (a semitone offset) rather than a target key name.
function isSemitoneOffset(raw) {
  return /^[+-]?\d+$/.test(String(raw == null ? "" : raw).trim());
}

/*
   A setlist song's optional override column resolves to a signed semitone
   transposition. Personal setlists now store that column as a literal
   semitone offset ("2", "-3"); band setlists (and older exports) store a
   target key name ("Bb"), diffed against the tune's own native key. Returns
   0 for a blank/zero override.
*/
export function setlistTransposeSteps(rawOverride, nativeKey) {
  const trimmed = String(rawOverride == null ? "" : rawOverride).trim();
  if (!trimmed) return 0;
  if (isSemitoneOffset(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return semitonesBetweenKeys(nativeKey || "C", trimmed);
}

// Names each pitch class the way a jazz chart tends to spell a key — flats
// for the black notes (D♭, E♭, G♭, A♭, B♭). Good enough for a setlist key
// badge you call on stage; not a full key-signature speller.
const KEY_NAME_BY_CHROMA = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

/*
   Transpose a key name (letter + optional accidental; any trailing mode word
   is ignored) by a signed semitone count and return the resulting key name.
   Used for the printed setlist / chordbook / songbook, where musicians want
   the key spelled out ("B♭") rather than a raw semitone offset ("+2").
*/
export function transposeKeyName(keyStr, semitones) {
  const base = noteChroma(keyStr || "C");
  const raw = Number(semitones);
  const n = Number.isFinite(raw) ? Math.round(raw) : 0;
  const idx = (((base + n) % 12) + 12) % 12;
  return KEY_NAME_BY_CHROMA[idx];
}

// Human-readable badge for a setlist override column: a signed "+2" / "−3"
// for a semitone offset (real minus sign), the key name as-is otherwise,
// and "" for a blank or zero override (nothing to show).
export function formatSetlistKeyLabel(rawOverride) {
  const trimmed = String(rawOverride == null ? "" : rawOverride).trim();
  if (!trimmed) return "";
  if (isSemitoneOffset(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n === 0) return "";
    return (n > 0 ? "+" : "−") + Math.abs(n);
  }
  return trimmed;
}
