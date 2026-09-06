import { test } from "node:test";
import assert from "node:assert/strict";
import {
  replaceAccidentalWithUtf8Char,
  parseChordScheme,
  simplifyBlues,
  simplifySong,
  computeChordOffset,
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
