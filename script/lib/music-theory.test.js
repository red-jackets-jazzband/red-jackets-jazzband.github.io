import { test } from "node:test";
import assert from "node:assert/strict";
import {
  noteChroma,
  chordToRomanNumeral,
  convertChordsToRoman,
  extractKeyFromAbc,
  semitonesBetweenKeys,
  setlistTransposeSteps,
  formatSetlistKeyLabel,
  transposeKeyName,
  tempoBpmFromAbc,
} from "./music-theory.js";

// No `Tonal` global in Node, so these exercise the manual fallback table.
test("noteChroma resolves natural, flat, and sharp notes", () => {
  assert.equal(noteChroma("C"), 0);
  assert.equal(noteChroma("Bb"), 10);
  assert.equal(noteChroma("F#"), 6);
  assert.equal(noteChroma("B♭"), 10); // unicode flat, as chords are stored after replaceAccidentalWithUtf8Char
});

test("noteChroma doesn't throw on an empty note name", () => {
  // An empty string reaches the manual fallback table's `normalized[0]`
  // as undefined; every real caller happens to always pass a non-empty
  // key/chord root, but the function shouldn't crash if one ever doesn't.
  assert.equal(noteChroma(""), 0);
});

test("noteChroma prefers Tonal's chroma when it returns a real number", () => {
  const realTonal = globalThis.Tonal;
  globalThis.Tonal = { Note: { get: () => ({ chroma: 7 }) } };
  try {
    // A deliberately "wrong" chroma proves the Tonal branch is actually the
    // one that ran, not a coincidental match with the manual fallback.
    assert.equal(noteChroma("C"), 7);
  } finally {
    globalThis.Tonal = realTonal;
  }
});

test("noteChroma falls back to the manual table when Tonal.Note.get throws", () => {
  const realTonal = globalThis.Tonal;
  globalThis.Tonal = { Note: { get: () => { throw new Error("unparseable"); } } };
  try {
    assert.equal(noteChroma("Bb"), 10);
  } finally {
    globalThis.Tonal = realTonal;
  }
});

test("noteChroma skips the Tonal branch entirely when Tonal is defined but has no Note", () => {
  const realTonal = globalThis.Tonal;
  // If the Tonal branch ran anyway it would throw on `Tonal.Note.get` (Note
  // is undefined), which the manual-table branch never would.
  globalThis.Tonal = {};
  try {
    assert.equal(noteChroma("Bb"), 10);
  } finally {
    globalThis.Tonal = realTonal;
  }
});

test("noteChroma replaces a unicode sharp with '#', not with nothing", () => {
  // "C♯" stripped to "" instead of "#" would read as bare "C" (chroma 0)
  // instead of "C#" (chroma 1) — a real, audible transposition bug.
  assert.equal(noteChroma("C♯"), 1);
});

test("noteChroma only strips the accidentals off the note letter, not the letter's own case", () => {
  // A lowercase note letter exercises the manual table's `rest` slice: if
  // the leading letter itself were left in `rest` (instead of sliced off),
  // it would coincidentally never match the "b"/"#" accidental checks for
  // an uppercase letter — but a lowercase one does, so this is the case
  // that actually discriminates a broken slice from a correct one.
  assert.equal(noteChroma("bbb"), 9); // B (11) - 2 flats
});

test("noteChroma falls through to the manual table when Tonal returns NaN chroma", () => {
  // Regression test: Tonal.Note.get("Am") — a chord-like string, not a
  // plain note — returns { chroma: NaN, empty: true, ... } in the browser.
  // typeof NaN is still "number", so a naive `typeof n.chroma === "number"`
  // check accepts it and returns NaN instead of falling through. This bit
  // real setlist key-override transposition (semitonesBetweenKeys with a
  // minor-key target like "Am") since noteChroma is never called with a
  // bare accidental-only string elsewhere in the app.
  const realTonal = globalThis.Tonal;
  globalThis.Tonal = { Note: { get: () => ({ chroma: NaN }) } };
  try {
    assert.equal(noteChroma("Am"), 9);
  } finally {
    globalThis.Tonal = realTonal;
  }
});

test("chordToRomanNumeral maps a chord to its scale degree in a major key", () => {
  assert.equal(chordToRomanNumeral("F", "Bb", ""), "V"); // F is the 5th degree of Bb major
  assert.equal(chordToRomanNumeral("Eb", "Bb", ""), "IV"); // Eb is the 4th degree of Bb major
  assert.equal(chordToRomanNumeral("Bb7", "Bb", ""), "I7");
  assert.equal(chordToRomanNumeral(" % ", "Bb", ""), " % ");
});

test("chordToRomanNumeral passes a missing chord straight through instead of crashing", () => {
  assert.equal(chordToRomanNumeral(null, "Bb", ""), null);
  assert.equal(chordToRomanNumeral(undefined, "Bb", ""), undefined);
});

test("chordToRomanNumeral's chord-root match is anchored at the start — a leading non-root character isn't skipped over", () => {
  assert.equal(chordToRomanNumeral("xF", "Bb", ""), "xF");
});

test("chordToRomanNumeral's chord-quality checks are anchored at the start of the suffix, not matched anywhere in it", () => {
  assert.equal(chordToRomanNumeral("C7m", "C", ""), "I7"); // a stray "m" later in the suffix isn't a minor chord
  assert.equal(chordToRomanNumeral("CxØ", "C", ""), "I");
  assert.equal(chordToRomanNumeral("Cxdim", "C", ""), "I");
  assert.equal(chordToRomanNumeral("Cx+", "C", ""), "I");
});

test("chordToRomanNumeral lowercases minor chords", () => {
  assert.equal(chordToRomanNumeral("Cm", "Bb", ""), "ii");
});

// Chord roots spelling out chroma 0..11 relative to a "C" key, flat where
// there's a choice (matching the tables' own flat-leaning accidentals).
const CHROMA_ROOTS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

test("chordToRomanNumeral maps every scale degree in a major key (MAJOR_MAP)", () => {
  const expected = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
  for (let interval = 0; interval < 12; interval += 1) {
    assert.equal(chordToRomanNumeral(CHROMA_ROOTS[interval], "C", ""), expected[interval], `interval ${interval}`);
  }
});

test("chordToRomanNumeral maps every scale degree in a minor key (MINOR_MAP)", () => {
  const expected = ["I", "♭II", "II", "III", "♯III", "IV", "♭V", "V", "VI", "♯VI", "VII", "♯VII"];
  for (let interval = 0; interval < 12; interval += 1) {
    assert.equal(chordToRomanNumeral(CHROMA_ROOTS[interval], "C", "min"), expected[interval], `interval ${interval}`);
  }
});

test("chordToRomanNumeral treats undefined/blank/major/maj keyMode as major, everything else as minor", () => {
  for (const majorish of [undefined, null, "", "major", "maj"]) {
    assert.equal(chordToRomanNumeral("Eb", "C", majorish), "♭III", `keyMode ${majorish}`);
  }
  for (const minorish of ["m", "min", "-", "dorian", "minor"]) {
    assert.equal(chordToRomanNumeral("Eb", "C", minorish), "III", `keyMode ${minorish}`);
  }
});

test("chordToRomanNumeral recognises every chord-quality suffix", () => {
  assert.equal(chordToRomanNumeral("Cm7b5", "C", ""), "iø7"); // half-diminished, ASCII flat spelling
  assert.equal(chordToRomanNumeral("C13", "C", ""), "I13"); // a multi-digit numeric extension, no other quality
  assert.equal(chordToRomanNumeral("Cdim", "C", ""), "i°");
  assert.equal(chordToRomanNumeral("C°", "C", ""), "i°");
  assert.equal(chordToRomanNumeral("Cm", "C", ""), "i");
  assert.equal(chordToRomanNumeral("Cmin", "C", ""), "i");
  assert.equal(chordToRomanNumeral("C-", "C", ""), "i");
  assert.equal(chordToRomanNumeral("Cmaj7", "C", ""), "Imaj7"); // "maj" must not be mistaken for minor
  assert.equal(chordToRomanNumeral("CΔ", "C", ""), "Imaj7");
  assert.equal(chordToRomanNumeral("Caug", "C", ""), "I+");
  assert.equal(chordToRomanNumeral("C+", "C", ""), "I+");
  assert.equal(chordToRomanNumeral("C9", "C", ""), "I9"); // a bare numeric extension, no other quality
  assert.equal(chordToRomanNumeral("Cm9", "C", ""), "i9"); // minor keeps its extension too
  assert.equal(chordToRomanNumeral("C", "C", ""), "I"); // no suffix at all
});

function barsVoice(count) {
  return Array.from({ length: count }, () => ({ el_type: "bar" }));
}

function songWithOneLine(key, voice) {
  return { lines: [{ staff: [{ key, voices: [voice] }] }] };
}

test("convertChordsToRoman passes chords through unchanged when there's nothing to work with", () => {
  assert.equal(convertChordsToRoman(null, { lines: [{}] }), null);
  assert.equal(convertChordsToRoman(undefined, { lines: [{}] }), undefined);
  assert.deepEqual(convertChordsToRoman([], { lines: [{}] }), []);
  const chords = [{ text: ["F"] }];
  assert.equal(convertChordsToRoman(chords, {}), chords); // no song.lines at all
  assert.equal(convertChordsToRoman(chords, { lines: [] }), chords); // empty lines array
});

test("convertChordsToRoman converts each measure's chords using the key active at that bar", () => {
  const song = songWithOneLine({ root: "Bb", acc: "", mode: "" }, barsVoice(2));
  const chords = [{ text: ["F"] }, { text: ["Eb"] }];
  const result = convertChordsToRoman(chords, song);
  assert.deepEqual(result.map((m) => m.text), [["V"], ["IV"]]);
});

test("convertChordsToRoman's key.acc is folded into the tonic before conversion", () => {
  // key root "B" + acc "b" -> "Bb", not literally the note B.
  const song = songWithOneLine({ root: "B", acc: "b", mode: "" }, barsVoice(1));
  const chords = [{ text: ["F"] }];
  assert.deepEqual(convertChordsToRoman(chords, song)[0].text, ["V"]); // F is the 5th of Bb, not of B
});

test("convertChordsToRoman follows a key change mid-line at its own keySignature element", () => {
  const song = songWithOneLine({ root: "Bb", acc: "", mode: "" }, [
    { el_type: "bar" }, // measure 1 — still Bb
    { el_type: "keySignature", key: { root: "C", acc: "", mode: "" } },
    { el_type: "bar" }, // measure 2 — now C
  ]);
  const chords = [{ text: ["F"] }, { text: ["D"] }];
  const result = convertChordsToRoman(chords, song);
  assert.deepEqual(result.map((m) => m.text), [["V"], ["II"]]); // F/Bb=V, D/C=II
});

test("convertChordsToRoman propagates a line's key forward when a later line has none of its own", () => {
  const song = {
    lines: [
      { staff: [{ key: { root: "Bb", acc: "", mode: "" }, voices: [barsVoice(1)] }] },
      { staff: [{ key: null, voices: [barsVoice(1)] }] }, // inherits Bb
    ],
  };
  const chords = [{ text: ["F"] }, { text: ["F"] }];
  const result = convertChordsToRoman(chords, song);
  assert.deepEqual(result.map((m) => m.text), [["V"], ["V"]]);
});

test("convertChordsToRoman propagates the most recent key, not always the first line's", () => {
  // A 3rd line with no key of its own must inherit the 2nd line's key (C),
  // not fall back past it to the 1st line's (Bb) — a bug that a broken
  // "always adopt this line's key, even when it has none" guard would
  // produce while still coincidentally passing a simpler 2-line check.
  const song = {
    lines: [
      { staff: [{ key: { root: "Bb", acc: "", mode: "" }, voices: [barsVoice(1)] }] },
      { staff: [{ key: { root: "C", acc: "", mode: "" }, voices: [barsVoice(1)] }] },
      { staff: [{ key: null, voices: [barsVoice(1)] }] },
    ],
  };
  const chords = [{ text: ["F"] }, { text: ["F"] }, { text: ["F"] }];
  const result = convertChordsToRoman(chords, song);
  assert.deepEqual(result.map((m) => m.text), [["V"], ["IV"], ["IV"]]);
});

test("convertChordsToRoman ignores a malformed keySignature element (no key payload) instead of blanking the current key", () => {
  const song = {
    lines: [
      { staff: [{ key: { root: "Bb", acc: "", mode: "" }, voices: [barsVoice(1)] }] },
      {
        staff: [{
          key: { root: "C", acc: "", mode: "" },
          voices: [[{ el_type: "keySignature" }, { el_type: "bar" }]],
        }],
      },
    ],
  };
  const chords = [{ text: ["F"] }, { text: ["F"] }];
  const result = convertChordsToRoman(chords, song);
  assert.deepEqual(result.map((m) => m.text), [["V"], ["IV"]]); // 2nd line stays on its own key, C
});

test("convertChordsToRoman ignores a stray .key payload on a non-keySignature element", () => {
  const song = songWithOneLine({ root: "Bb", acc: "", mode: "" }, [
    { el_type: "note", key: { root: "D", acc: "", mode: "" } }, // not a real key change
    { el_type: "bar" },
  ]);
  const chords = [{ text: ["F"] }];
  const result = convertChordsToRoman(chords, song);
  assert.deepEqual(result[0].text, ["V"]); // still Bb, the "note" element's .key is irrelevant
});

test("convertChordsToRoman only counts an actual bar element as a measure boundary", () => {
  const song = songWithOneLine({ root: "Bb", acc: "", mode: "" }, [
    { el_type: "junk" }, // must not itself count as a bar
    { el_type: "keySignature", key: { root: "C", acc: "", mode: "" } },
    { el_type: "bar" },
  ]);
  const chords = [{ text: ["F"] }];
  const result = convertChordsToRoman(chords, song);
  assert.deepEqual(result[0].text, ["IV"]); // the one real bar, after the key change to C
});

test("convertChordsToRoman reads a line's key.mode to pick the major/minor interval map", () => {
  const majorSong = songWithOneLine({ root: "C", acc: "", mode: "" }, barsVoice(1));
  assert.deepEqual(convertChordsToRoman([{ text: ["Eb"] }], majorSong)[0].text, ["♭III"]);
  const minorSong = songWithOneLine({ root: "C", acc: "", mode: "min" }, barsVoice(1));
  assert.deepEqual(convertChordsToRoman([{ text: ["Eb"] }], minorSong)[0].text, ["III"]);
});

test("convertChordsToRoman skips a line with no staff/voices at all rather than crashing", () => {
  const song = {
    lines: [
      {}, // no staff — must be skipped, not treated as a bar-less line that errors
      { staff: [{ key: { root: "C", acc: "", mode: "" }, voices: [barsVoice(1)] }] },
    ],
  };
  const chords = [{ text: ["G"] }];
  const result = convertChordsToRoman(chords, song);
  assert.deepEqual(result.map((m) => m.text), [["V"]]); // G/C=V, from the second line's one bar
});

test("convertChordsToRoman falls back to the song's first key when there are more chord measures than bars found", () => {
  const song = songWithOneLine({ root: "Bb", acc: "", mode: "" }, []); // no bars at all
  const chords = [{ text: ["F"] }];
  const result = convertChordsToRoman(chords, song);
  assert.deepEqual(result[0].text, ["V"]); // still resolved against Bb, not the hardcoded C default
});

test("convertChordsToRoman falls all the way back to C when nothing supplies a key at all", () => {
  const song = songWithOneLine(null, []); // no key anywhere, no bars either
  const chords = [{ text: ["G"] }];
  const result = convertChordsToRoman(chords, song);
  assert.deepEqual(result[0].text, ["V"]); // G is the 5th of the hardcoded C default
});

test("convertChordsToRoman keeps every other field on a measure object untouched", () => {
  const song = songWithOneLine({ root: "C", acc: "", mode: "" }, barsVoice(1));
  const chords = [{ text: ["G"], startChar: 12, endChar: 15 }];
  const result = convertChordsToRoman(chords, song);
  assert.deepEqual(result, [{ text: ["V"], startChar: 12, endChar: 15 }]);
});

test("extractKeyFromAbc reads the tonic, ignoring the mode word", () => {
  assert.equal(extractKeyFromAbc("X:1\nK:Bbmaj\nC D E F|"), "Bb");
  assert.equal(extractKeyFromAbc("X:1\nK:Ebmaj\n"), "Eb");
  assert.equal(extractKeyFromAbc("X:1\nK:Em\n"), "E");
  assert.equal(extractKeyFromAbc("X:1\nK:C\n"), "C");
});

test("extractKeyFromAbc returns null when there's no K: line", () => {
  assert.equal(extractKeyFromAbc("X:1\nT:No key here\n"), null);
});

test("extractKeyFromAbc only reads a K: field anchored at the start of a line, not a stray 'K:' substring", () => {
  assert.equal(extractKeyFromAbc("X:1\nTK:Cmaj\n"), null);
});

test("semitonesBetweenKeys picks the shortest signed distance", () => {
  assert.equal(semitonesBetweenKeys("Bb", "C"), 2);
  assert.equal(semitonesBetweenKeys("Bb", "Ab"), -2);
  assert.equal(semitonesBetweenKeys("C", "C"), 0);
  // mode suffix on either side is ignored — only the tonic matters
  assert.equal(semitonesBetweenKeys("Bb", "Am"), -1);
});

test("semitonesBetweenKeys defaults to 0 when a key is missing", () => {
  assert.equal(semitonesBetweenKeys(null, "C"), 0);
  assert.equal(semitonesBetweenKeys("C", ""), 0);
});

test("semitonesBetweenKeys leaves an exact tritone (6 semitones) unflipped", () => {
  // diff > 6 flips to negative; diff === 6 is its own shortest path either
  // way and must stay +6, not become -6.
  assert.equal(semitonesBetweenKeys("C", "F#"), 6);
});

test("setlistTransposeSteps takes a bare integer literally, a key name relative to the tune", () => {
  assert.equal(setlistTransposeSteps("2", "Bb"), 2);
  assert.equal(setlistTransposeSteps("-3", "Bb"), -3);
  assert.equal(setlistTransposeSteps("+1", "Bb"), 1);
  assert.equal(setlistTransposeSteps("C", "Bb"), 2); // legacy key-name override
  assert.equal(setlistTransposeSteps("", "Bb"), 0);
  assert.equal(setlistTransposeSteps(null, "Bb"), 0);
});

test("setlistTransposeSteps takes a multi-digit semitone offset literally, not just single digits", () => {
  assert.equal(setlistTransposeSteps("12", "Bb"), 12);
  assert.equal(setlistTransposeSteps("-10", "Bb"), -10);
});

test("setlistTransposeSteps only recognises a bare integer as a semitone offset when the whole trimmed string is digits", () => {
  // A key-name-like override that happens to start or end with a digit must
  // still be diffed against the tune's key, not misread as an offset.
  assert.equal(setlistTransposeSteps("x9", "Bb"), 2);
  assert.equal(setlistTransposeSteps("9x", "Bb"), 2);
});

test("setlistTransposeSteps trims surrounding whitespace off a key-name override too, not just an integer one", () => {
  assert.equal(setlistTransposeSteps(" Bb ", "Bb"), 0);
});

test("setlistTransposeSteps falls back to C for the tune's own key when it's missing, for a key-name override", () => {
  assert.equal(setlistTransposeSteps("Eb", ""), 3);
  assert.equal(setlistTransposeSteps("Eb", undefined), 3);
});

test("formatSetlistKeyLabel signs a semitone offset and passes a key name through", () => {
  assert.equal(formatSetlistKeyLabel("2"), "+2");
  assert.equal(formatSetlistKeyLabel("-3"), "−3");
  assert.equal(formatSetlistKeyLabel("0"), "");
  assert.equal(formatSetlistKeyLabel(""), "");
  assert.equal(formatSetlistKeyLabel("Bb"), "Bb");
});

test("formatSetlistKeyLabel returns blank for a missing override, not the string 'null'/'undefined'", () => {
  assert.equal(formatSetlistKeyLabel(null), "");
  assert.equal(formatSetlistKeyLabel(undefined), "");
});

test("formatSetlistKeyLabel trims a key-name override's surrounding whitespace before passing it through", () => {
  assert.equal(formatSetlistKeyLabel(" Bb "), "Bb");
});

test("tempoBpmFromAbc reads the common Q: field forms", () => {
  assert.equal(tempoBpmFromAbc("X:1\nQ:1/4=120\nK:C\n"), 120);
  assert.equal(tempoBpmFromAbc("Q:120"), 120);
  assert.equal(tempoBpmFromAbc("Q:1/4 132"), 132);
  assert.equal(tempoBpmFromAbc('Q:"Swing" 1/4=134'), 134);
  assert.equal(tempoBpmFromAbc("Q: 3/8=60"), 60);
  assert.equal(tempoBpmFromAbc("X:1\nK:C\n"), null);
  assert.equal(tempoBpmFromAbc(""), null);
});

test("tempoBpmFromAbc only reads a Q: field anchored at the start of a line", () => {
  assert.equal(tempoBpmFromAbc("X:1\nTQ:120\nK:C\n"), null);
});

test("tempoBpmFromAbc rounds a decimal bpm after an '='", () => {
  assert.equal(tempoBpmFromAbc("Q:1/4=133.5"), 134);
});

test("tempoBpmFromAbc rounds a decimal bare bpm (no '=')", () => {
  assert.equal(tempoBpmFromAbc("Q:133.5"), 134);
});

test("tempoBpmFromAbc strips a quoted tempo label even when it contains a digit, instead of matching that digit", () => {
  assert.equal(tempoBpmFromAbc('Q:"Fast 4" 120'), 120);
});

test("tempoBpmFromAbc's bare-number scan skips a note-length numerator even when whitespace separates it from its slash", () => {
  assert.equal(tempoBpmFromAbc("Q:1 /2 96"), 96);
});

test("tempoBpmFromAbc replaces a stripped quoted label with a space, not nothing, so adjacent numbers don't merge", () => {
  assert.equal(tempoBpmFromAbc('Q:100"x"200'), 100); // not 100200
});

test("transposeKeyName spells every one of the 12 chromas, flats for black notes", () => {
  const expected = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
  for (let semitones = 0; semitones < 12; semitones += 1) {
    assert.equal(transposeKeyName("C", semitones), expected[semitones], `+${semitones}`);
  }
});

test("transposeKeyName spells the resulting key, flats for black notes", () => {
  assert.equal(transposeKeyName("Bb", 2), "C");
  assert.equal(transposeKeyName("C", -3), "A");
  assert.equal(transposeKeyName("C", 1), "D♭");
  assert.equal(transposeKeyName("C", 0), "C");
  assert.equal(transposeKeyName("F", 2), "G");
  assert.equal(transposeKeyName("Ebmaj", 0), "E♭"); // mode word ignored
  assert.equal(transposeKeyName("C", 14), "D"); // wraps past an octave
});

test("transposeKeyName falls back to no transposition for a non-finite semitone count", () => {
  // Math.round(Infinity) is Infinity, which turns the modulo below into NaN
  // and indexes the key-name table out of bounds — every real caller already
  // clamps its semitone value before this is reached, but the function
  // shouldn't silently return undefined if one ever doesn't.
  assert.equal(transposeKeyName("C", Infinity), "C");
  assert.equal(transposeKeyName("C", -Infinity), "C");
  assert.equal(transposeKeyName("C", NaN), "C");
});
