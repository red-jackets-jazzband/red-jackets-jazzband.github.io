import { test } from "node:test";
import assert from "node:assert/strict";
import {
  replaceAccidentalWithUtf8Char,
  parseChordScheme,
  simplifyBlues,
  simplifySong,
  computeChordOffset,
  BREAK_CHORD,
} from "./chords.js";

function measure(text) {
  return { text };
}

test("replaceAccidentalWithUtf8Char converts flat/sharp/diminished markers", () => {
  assert.equal(replaceAccidentalWithUtf8Char("Bb "), "B♭");
  assert.equal(replaceAccidentalWithUtf8Char("C#"), "C♯");
  assert.equal(replaceAccidentalWithUtf8Char("Cdim"), "CØ");
});

test("simplifySong returns the input unchanged when length isn't a multiple of count", () => {
  const chords = [measure(["C"]), measure(["F"]), measure(["G"])];
  assert.deepEqual(simplifySong(chords, 12), chords);
});

test("simplifySong collapses an exactly-repeating scheme down to one repeat", () => {
  const pattern = [measure(["C"]), measure(["F"]), measure(["G"]), measure(["C"])];
  const chords = pattern.concat(pattern, pattern); // 3 repeats of a 4-bar pattern
  const result = simplifySong(chords, 4);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map((m) => m.text), pattern.map((m) => m.text));
});

test("simplifySong leaves a scheme alone if any repeat differs", () => {
  const a = [measure(["C"]), measure(["F"])];
  const b = [measure(["C"]), measure(["G"])]; // differs in bar 2
  const chords = a.concat(b);
  assert.deepEqual(simplifySong(chords, 2), chords);
});

test("simplifyBlues delegates to simplifySong with count=12", () => {
  const pattern = Array.from({ length: 12 }, (_, i) => measure(["C" + i]));
  const chords = pattern.concat(pattern);
  const result = simplifyBlues(chords);
  assert.equal(result.length, 12);
});

test("computeChordOffset counts measures before the first chord", () => {
  const song = {
    lines: [
      {
        staff: [
          {
            voices: [
              [
                { el_type: "note" },
                { el_type: "bar" },
                { el_type: "note" },
                { el_type: "bar" },
                { el_type: "note", chord: [{ name: "C" }] },
              ],
            ],
          },
        ],
      },
    ],
  };
  assert.equal(computeChordOffset(song), 2);
});

test("computeChordOffset returns 0 when there are no lines", () => {
  assert.equal(computeChordOffset({}), 0);
});

test("parseChordScheme extracts one chord per measure", () => {
  const song = {
    lines: [
      {
        staff: [
          {
            voices: [
              [
                { el_type: "note", chord: [{ name: "C" }] },
                { el_type: "note" },
                { el_type: "bar", type: "bar_thin" },
                { el_type: "note", chord: [{ name: "F" }] },
                { el_type: "note" },
                { el_type: "bar", type: "bar_thin" },
              ],
            ],
          },
        ],
      },
    ],
  };
  const chords = parseChordScheme(song);
  assert.equal(chords.length, 2);
  assert.deepEqual(chords[0].text, ["C"]);
  assert.deepEqual(chords[1].text, ["F"]);
});

test("parseChordScheme keeps the final measure when the body has no trailing barline", () => {
  const song = {
    lines: [
      {
        staff: [
          {
            voices: [
              [
                { el_type: "note", chord: [{ name: "C" }] },
                { el_type: "note" },
                { el_type: "bar", type: "bar_thin" },
                { el_type: "note", chord: [{ name: "G" }] },
                { el_type: "note" },
              ],
            ],
          },
        ],
      },
    ],
  };
  const chords = parseChordScheme(song);
  assert.equal(chords.length, 2);
  assert.deepEqual(chords[1].text, ["G"]);
});

// A "C | F |1 G :|2 C2 |]" scheme, in the shape a real ABCjs parse produces
// (confirmed against ABCJS.parseOnly): the ":|2" barline that closes ending 1
// and opens ending 2 carries both startEnding and endEnding at once.
function voltaSong() {
  return {
    lines: [
      {
        staff: [
          {
            voices: [
              [
                { el_type: "note", chord: [{ name: "C" }] },
                { el_type: "note" },
                { el_type: "bar", type: "bar_thin" },
                { el_type: "note", chord: [{ name: "F" }] },
                { el_type: "note" },
                { el_type: "bar", type: "bar_thin", startEnding: "1" },
                { el_type: "note", chord: [{ name: "G" }] },
                { el_type: "bar", type: "bar_right_repeat", startEnding: "2", endEnding: true },
                { el_type: "note", chord: [{ name: "C2" }] },
                { el_type: "bar", type: "bar_thin_thick", endEnding: true },
              ],
            ],
          },
        ],
      },
    ],
  };
}

test("parseChordScheme drops a second-ending's own measures by default", () => {
  // The chord table's "one canonical pass" view: a tag/outro second ending's
  // bars don't belong in the collapsed grid.
  const chords = parseChordScheme(voltaSong());
  assert.deepEqual(chords.map((m) => m.text), [["C"], ["F"], ["G"]]);
});

test("parseChordScheme keeps every measure, endings included, with includeAlternateEndings", () => {
  // buildCompingTune needs one entry per physical printed bar or it runs out
  // of comping bars (and falls silent) the moment the melody reaches a
  // second ending — see happy_feet_blues' part C outro.
  const chords = parseChordScheme(voltaSong(), { includeAlternateEndings: true });
  assert.deepEqual(chords.map((m) => m.text), [["C"], ["F"], ["G"], ["C2"]]);
});

test("parseChordScheme normalizes abcjs's break synonyms to a single N.C. marker", () => {
  // "N.C." (any of abcjs's own breakSynonyms — break, (break), no chord,
  // n.c., tacet — case-insensitively) must not be treated as a real chord:
  // it's not a valid chord name, but it's not silently dropped either, or
  // the bar would fall back to holding the previous chord over the silence.
  const song = {
    lines: [
      {
        staff: [
          {
            voices: [
              [
                { el_type: "note", chord: [{ name: "F7" }] },
                { el_type: "note" },
                { el_type: "bar", type: "bar_thin" },
                { el_type: "note", chord: [{ name: "N.C.", position: "above" }] },
                { el_type: "note" },
                { el_type: "bar", type: "bar_thin" },
                { el_type: "note", chord: [{ name: "Tacet" }] },
                { el_type: "note" },
                { el_type: "bar", type: "bar_thin" },
              ],
            ],
          },
        ],
      },
    ],
  };
  const chords = parseChordScheme(song);
  assert.deepEqual(chords.map((m) => m.text), [["F7"], [BREAK_CHORD], [BREAK_CHORD]]);
});

test("parseChordScheme keeps a break and a real chord as separate entries within one measure", () => {
  const song = {
    lines: [
      {
        staff: [
          {
            voices: [
              [
                { el_type: "note", chord: [{ name: "F7" }] },
                { el_type: "note" },
                { el_type: "note", chord: [{ name: "N.C.", position: "above" }] },
                { el_type: "note" },
                { el_type: "bar", type: "bar_thin" },
              ],
            ],
          },
        ],
      },
    ],
  };
  const chords = parseChordScheme(song);
  assert.deepEqual(chords[0].text, ["F7", BREAK_CHORD]);
});

test("parseChordScheme returns an empty list when no valid chords were found", () => {
  const song = {
    lines: [
      {
        staff: [
          {
            voices: [[{ el_type: "note" }, { el_type: "bar", type: "bar_thin" }]],
          },
        ],
      },
    ],
  };
  assert.deepEqual(parseChordScheme(song), []);
});
