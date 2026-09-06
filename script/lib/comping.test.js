import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPING_PATTERNS,
  formatDuration,
  tokenizeBar,
  rebeamBar,
  buildVoiceBody,
  buildCompingTune,
  measureBarSlots,
} from "./comping.js";

// ---------------------------------------------------------------------------
// A small but arithmetically real Tonal stub — enough for buildCompingTune to
// run over a diatonic progression without pulling the 200 KB browser bundle.
// ---------------------------------------------------------------------------
const SHARP_PC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function pcChroma(pc) {
  const m = String(pc).match(/^([A-G])([#b]*)/);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  let acc = 0;
  for (const c of m[2]) acc += c === "#" ? 1 : -1;
  return ((base + acc) % 12 + 12) % 12;
}
function pcAdd(pc, semis) {
  return SHARP_PC[(pcChroma(pc) + semis % 12 + 12) % 12];
}
function nameToMidi(name) {
  const m = String(name).match(/^([A-G])([#b]*)(-?\d+)$/);
  if (!m) return null;
  return (parseInt(m[3], 10) + 1) * 12 + pcChroma(m[1] + m[2]);
}

const TonalStub = {
  Scale: {
    get(name) {
      const m = name.match(/^([A-G][#b]*)\s+(\w+)$/);
      if (!m) return { notes: [] };
      const steps = m[2] === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
      return { notes: steps.map((s) => pcAdd(m[1], s)) };
    },
  },
  Chord: {
    get(name) {
      const m = String(name).match(/^([A-G][#b]*)(.*)$/);
      if (!m) return { notes: [] };
      const q = m[2];
      const third = /^(m|min|-|dim|°|o)/.test(q) ? 3 : 4;
      const fifth = /^(dim|°|o)/.test(q) ? 6 : /^(aug|\+)/.test(q) ? 8 : 7;
      return { notes: [m[1], pcAdd(m[1], third), pcAdd(m[1], fifth)] };
    },
  },
  Note: { midi: nameToMidi },
  Interval: {
    distance: (a, b) => ({ a, b }),
    semitones: (d) => ((pcChroma(d.b) - pcChroma(d.a)) % 12 + 12) % 12,
  },
  AbcNotation: {
    scientificToAbcNotation(sci) {
      const m = sci.match(/^([A-G])([#b]*)(-?\d+)$/);
      const acc = m[2].replace(/#/g, "^").replace(/b/g, "_");
      const oct = parseInt(m[3], 10);
      const body =
        oct >= 5
          ? m[1].toLowerCase() + "'".repeat(oct - 5)
          : m[1] + ",".repeat(Math.max(0, 4 - oct));
      return acc + body;
    },
    abcToScientificNotation(abc) {
      const m = abc.match(/^([_^=]*)([A-Ga-g])([,']*)$/);
      if (!m) return null;
      const acc = m[1].replace(/\^/g, "#").replace(/_/g, "b").replace(/=/g, "");
      let oct = m[2] === m[2].toLowerCase() ? 5 : 4;
      for (const c of m[3]) oct += c === "'" ? 1 : -1;
      return m[2].toUpperCase() + acc + oct;
    },
  },
};

function withTonal(fn) {
  const real = globalThis.Tonal;
  globalThis.Tonal = TonalStub;
  try {
    return fn();
  } finally {
    globalThis.Tonal = real;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("formatDuration scales eighth slots to the tune's unit note length", () => {
  // L:1/8 — one slot is the unit
  assert.equal(formatDuration(1, 1, 8), "");
  assert.equal(formatDuration(2, 1, 8), "2");
  assert.equal(formatDuration(8, 1, 8), "8");
  // L:1/4 — one slot is half the unit
  assert.equal(formatDuration(1, 1, 4), "/2");
  assert.equal(formatDuration(2, 1, 4), "");
  assert.equal(formatDuration(3, 1, 4), "3/2");
  assert.equal(formatDuration(8, 1, 4), "4");
  // L:1/16 — one slot is two units
  assert.equal(formatDuration(1, 1, 16), "2");
});

test("tokenizeBar reads notes, rests, ties and annotations", () => {
  const toks = tokenizeBar('"C7" z2 c-c4');
  assert.deepEqual(toks, [
    { annotation: '"C7"' },
    { pitch: "z", dur: 2, tie: false, rest: true },
    { pitch: "c", dur: 1, tie: true, rest: false },
    { pitch: "c", dur: 4, tie: false, rest: false },
  ]);
  assert.equal(tokenizeBar("_B,2 ^f'")[0].pitch, "_B,");
  assert.equal(tokenizeBar("_B,2 ^f'")[1].pitch, "^f'");
});

test("tokenizeBar reads chord tokens as one note", () => {
  const toks = tokenizeBar("[CEG]2 [Bdf]-[Bdf]4");
  assert.deepEqual(toks, [
    { pitch: "[CEG]", dur: 2, tie: false, rest: false },
    { pitch: "[Bdf]", dur: 1, tie: true, rest: false },
    { pitch: "[Bdf]", dur: 4, tie: false, rest: false },
  ]);
});

test("rebeamBar keeps eighths in groups of four and rescales durations", () => {
  // 8 straight eighths -> two beamed groups of four
  assert.equal(rebeamBar("c c c c c c c c", 1, 8), "cccc cccc");
  // long notes and rests get breathing space around them
  assert.equal(rebeamBar("c z z c-c4", 1, 8), "c z z c- c4");
  // at L:1/4 the same eighths become "/2" each, still grouped by four
  assert.equal(rebeamBar("c c c c", 1, 4), "c/2c/2c/2c/2");
});

test("buildVoiceBody mirrors the melody's barlines, repeats and voltas", () => {
  const melody = '"C" c4 c4 | "G7" d4 d4 |: "F" e8 :| "C" c8 |]';
  const out = buildVoiceBody(melody, ["A1", "A2", "A3", "A4"], 0);
  assert.equal(out.trim(), "A1 | A2 |: A3 :| A4 |]");
});

test("buildVoiceBody rests through pickup/intro bars then consumes patterns", () => {
  const melody = "E2 D2 | c4 c4 | d4 d4 |";
  const out = buildVoiceBody(melody, ["P1", "P2"], 1, "x8");
  assert.equal(out.trim(), "x8 | P1 | P2 |");
});

test("buildVoiceBody fills a whole rest when patterns run out", () => {
  const melody = "c4 c4 | d4 d4 |1 e8 :|2 f8 |]";
  const out = buildVoiceBody(melody, ["X1", "X2"], 0, "x8");
  assert.equal(out.trim(), "X1 | X2 |1 x8 :|2 x8 |]");
});

test("buildVoiceBody ignores lyric and part lines", () => {
  const melody = 'P:A\n"C" c8 | "G" d8 |\nw: la la la la';
  const out = buildVoiceBody(melody, ["B1", "B2"], 0, "x8");
  assert.equal(out.replace(/\s+/g, " ").trim(), "B1 | B2 |");
});

test("measureBarSlots sums a bar segment in eighth slots", () => {
  // L:1/8 — one slot per unit
  assert.equal(measureBarSlots("c c c c", 1, 8), 4);
  assert.equal(measureBarSlots('"C" c4 c4', 1, 8), 8);
  assert.equal(measureBarSlots("[CEG]2 [CEG]2", 1, 8), 4);
  // L:1/4 — two slots per unit; a two-eighth pickup is one slot each
  assert.equal(measureBarSlots("B/2=A/2", 1, 4), 2);
  assert.equal(measureBarSlots("B2 G B/2=A/2", 1, 4), 8);
  assert.equal(measureBarSlots("   ", 1, 4), 0);
});

test("buildVoiceBody matches a short pickup's length when given L", () => {
  // Bellamina: a two-eighth pickup at L:1/4 before the first chorded bar
  const melody = "B/2=A/2 || B2 G B/2=A/2 | B2 G B/2=A/2 |";
  const out = buildVoiceBody(melody, ["P1", "P2"], 1, "x", 1, 4);
  assert.equal(out.trim(), "x || P1 | P2 |");
});

// ---------------------------------------------------------------------------
// Pattern table
// ---------------------------------------------------------------------------

test("COMPING_PATTERNS exposes 15 patterns, each with a builder set", () => {
  assert.equal(COMPING_PATTERNS.length, 15);
  for (const p of COMPING_PATTERNS) {
    assert.ok(p.value && p.label && p.group, `${p.value} fully described`);
  }
  const groups = [...new Set(COMPING_PATTERNS.map((p) => p.group))];
  assert.deepEqual(groups, ["Base patterns", "Step down", "Step up & down"]);
});

// ---------------------------------------------------------------------------
// buildCompingTune
// ---------------------------------------------------------------------------

const TUNE = [
  "T:Test Tune",
  "M:4/4",
  "L:1/8",
  "K:C",
  '|: "C" C8 | "F" F8 | "G7" G8 | "C" C8 :|',
].join("\n");

function fakeSong(key = { root: "C", acc: "", mode: "" }) {
  // Minimal shape used by buildCompingTune / computeChordOffset.
  return {
    lines: [
      {
        staff: [
          {
            key,
            voices: [[
              { el_type: "note", chord: [{ name: "C" }] },
              { el_type: "bar" },
            ]],
          },
        ],
      },
    ],
  };
}

const CHORDS = [
  { text: ["C"] },
  { text: ["F"] },
  { text: ["G7"] },
  { text: ["C"] },
];

test("buildCompingTune adds a bracketed one-voice block-chord comping staff", () => {
  const out = withTonal(() => buildCompingTune(TUNE, CHORDS, fakeSong(), "whole_note"));
  assert.ok(out && out.abc, "produced a tune");
  const abc = out.abc;
  assert.match(abc, /^%%staves \[1 2\]/m);
  assert.match(abc, /^V:2 name="R\\n3\\n5"$/m);
  assert.doesNotMatch(abc, /^V:3/m);
  // melody body is kept verbatim under V:1, repeat included
  assert.match(abc, /V:1\n\|: "C" C8 \| "F" F8 \| "G7" G8 \| "C" C8 :\|/);
  // T: gets the pattern name appended
  assert.match(abc, /T:Test Tune {2}\(comping – Whole note\)/);
  // the comping voice is block chords and carries the same repeat structure
  const v2 = abc.split("\nV:2\n").pop().trim();
  assert.match(v2, /^\|:/);
  assert.match(v2, /:\|$/);
  assert.match(v2, /\[[A-Ga-g][A-Ga-g][A-Ga-g]\]/);
});

test("buildCompingTune returns a colour palette, one entry per drawn chord onset", () => {
  // whole_note draws one chord per bar (n8- / n8), 4 bars -> 4 onsets.
  const out = withTonal(() => buildCompingTune(TUNE, CHORDS, fakeSong(), "whole_note"));
  assert.equal(out.palette.length, 4);
  for (const order of out.palette) {
    assert.deepEqual([...order].sort(), ["3", "5", "R"]);
  }
  // first chord is voiced from the root-position seed, so bottom-to-top is R/3/5
  assert.deepEqual(out.palette[0], ["R", "3", "5"]);
});

test("buildCompingTune transposes nothing itself (concert-pitch K: kept)", () => {
  const out = withTonal(() => buildCompingTune(TUNE, CHORDS, fakeSong(), "on_2_and_4"));
  assert.match(out.abc, /^K:C$/m);
});

test("buildCompingTune bass instrument stamps clef=bass on the comping voice", () => {
  const bassTune = TUNE.replace("K:C", "K:C clef=bass middle=D");
  const out = withTonal(() =>
    buildCompingTune(bassTune, CHORDS, fakeSong(), "whole_note"),
  );
  assert.match(out.abc, /^V:2 name="R\\n3\\n5" clef=bass middle=D/m);
});

test("buildCompingTune returns null when it cannot apply", () => {
  withTonal(() => {
    assert.equal(buildCompingTune(TUNE, [], fakeSong(), "whole_note"), null);
    assert.equal(buildCompingTune(TUNE, CHORDS, fakeSong(), "not_a_pattern"), null);
    const threeFour = TUNE.replace("M:4/4", "M:3/4");
    assert.equal(buildCompingTune(threeFour, CHORDS, fakeSong(), "whole_note"), null);
    const voiced = TUNE.replace("K:C", "V:1\nK:C");
    assert.equal(buildCompingTune(voiced, CHORDS, fakeSong(), "whole_note"), null);
  });
});

test("buildCompingTune scales pattern durations to a L:1/4 tune", () => {
  const quarterTune = TUNE.replace("L:1/8", "L:1/4").replace(/C8/g, "C4").replace(/F8/, "F4").replace(/G8/, "G4");
  const out = withTonal(() =>
    buildCompingTune(quarterTune, CHORDS, fakeSong(), "whole_note"),
  );
  assert.match(out.abc, /^L:1\/4$/m);
  // whole_note bar 1 is "n8-" in eighths -> "n4-" at L:1/4
  const v2 = out.abc.split("\nV:2\n").pop();
  assert.match(v2, /4-/);
});
