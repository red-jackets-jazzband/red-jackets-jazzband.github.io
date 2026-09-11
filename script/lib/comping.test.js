import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMPING_PATTERNS,
  PATTERNS,
  formatDuration,
  tokenizeBar,
  rebeamBar,
  respellBar,
  buildVoiceBody,
  buildCompingTune,
  measureBarSlots,
} from "./comping.js";
import { tonalStub as TonalStub, withTonal, nameToMidi } from "../../../tests/helpers/stubs.js";
import { injectMixerAudio } from "./audio-mix.js";

// The midpoint (in semitones) between a chord triple's bottom and top voice.
function centre(triple) {
  return (triple[0] + triple[2]) / 2;
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

test("tokenizeBar recognises 'x' (invisible rest) as a rest, alongside 'z'", () => {
  const toks = tokenizeBar("x2 z2 c2");
  assert.deepEqual(toks.map((t) => t.rest), [true, true, false]);
});

test("tokenizeBar strips every leading accidental, not just one, before checking the note/rest/chord head", () => {
  const toks = tokenizeBar("__B2 [CEG]2");
  assert.equal(toks[0].pitch, "__B");
  assert.equal(toks[0].rest, false); // a double-flat B is a note, not a rest
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

test("respellBar prints an accidental only where the key doesn't already imply it", () => {
  const F = { B: "_" }; // F major: one flat

  // a diatonic Bb in F major loses its redundant flat — nothing to print
  assert.equal(respellBar("[EG_B][FAc]", F), "[EGB][FAc]");
  // ...but the sharp/flat matched the key, so its *concert* pitch is unchanged
  assert.equal(respellBar("[^FAc]", { F: "^" }), "[FAc]");

  // a note the key would flat, wanted natural, gets the natural sign
  assert.equal(respellBar("[GBd]", F), "[G=Bd]");
  // and it then propagates for the rest of the bar (bare B stays natural)
  assert.equal(respellBar("[GBd][GBd]", F), "[G=Bd][GBd]");

  // a natural cancels a sharp/flat set earlier in the same bar
  assert.equal(respellBar("[^FAc] [FAc]", {}), "[^FAc] [=FAc]");
  // an accidental the key doesn't carry is still printed
  assert.equal(respellBar("[^FAc]", {}), "[^FAc]");
  // propagation is per octave: the low F sharp doesn't cover the high f
  assert.equal(respellBar("[^F,A,C][fac]", {}), "[^F,A,C][fac]");
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

test("buildVoiceBody keeps the repeat colon on a thick-thin repeat-start barline", () => {
  // "I've got a woman": the tune opens straight into a repeated section, so
  // the very first barline is "[|:" (thick-thin bar + repeat start) rather
  // than a plain "|:". Losing the colon here silently drops the repeat from
  // the comping voice, desyncing it from the melody on the second pass.
  const melody = '"C" c4 c4 [|: "F" e8 :| "C" c8 |]';
  const out = buildVoiceBody(melody, ["A1", "A2", "A3"], 0);
  assert.equal(out.trim(), "A1 [|: A2 :| A3 |]");
});

test("buildVoiceBody fills a whole rest when patterns run out", () => {
  const melody = "c4 c4 | d4 d4 |1 e8 :|2 f8 |]";
  const out = buildVoiceBody(melody, ["X1", "X2"], 0, "x8");
  assert.equal(out.trim(), "X1 | X2 |1 x8 :|2 x8 |]");
});

test("buildVoiceBody keeps multi-digit and comma/range volta brackets intact, not just single-digit ones", () => {
  const melody = "c4 c4 |12 d4 d4 :|22 e4 e4 [1-3 f4 f4 [1,3,5 g4 g4 |";
  const out = buildVoiceBody(melody, ["A1", "A2", "A3", "A4", "A5"], 0);
  assert.equal(out.trim(), "A1 |12 A2 :|22 A3 [1-3 A4 [1,3,5 A5 |");
});

test("buildVoiceBody keeps a line break that falls inside a measure", () => {
  // Oh when the Saints: the last intro measure straddles the P:Chorus line,
  // so its newline sits inside one note segment. The comping voice must break
  // there too, or the first pattern bar rides up onto the intro's last line.
  const melody = "c4 c4 | d2 d2 | e2\nP:Chorus\ne2 |: f4 f4 |";
  const out = buildVoiceBody(melody, ["P1", "P2"], 3, "x8");
  assert.equal(out.trim(), "x8 | x8 | x8\n|: P1 |");
});

test("buildVoiceBody splits a straddling rest bar at the line break", () => {
  // With L given, the rest bar the melody splits across the break is split the
  // same way (1 + 3 beats at L:1/4) so the following barline stays aligned.
  const melody = "c4 | d4 | e\nP:Chorus\nf g a |: G4 |";
  const out = buildVoiceBody(melody, ["P1"], 3, "x", 1, 4);
  assert.equal(out.trim(), "x | x | x\nx3 |: P1 |");
});

test("buildVoiceBody ignores lyric and part lines", () => {
  const melody = 'P:A\n"C" c8 | "G" d8 |\nw: la la la la';
  const out = buildVoiceBody(melody, ["B1", "B2"], 0, "x8");
  assert.equal(out.replace(/\s+/g, " ").trim(), "B1 | B2 |");
});

test("buildVoiceBody ignores every other stray metadata/directive line kind (W:, s:, N:, O:, I:, r:, %)", () => {
  const melody = [
    "W:whole song lyrics", "s:symbol line", "N:a footnote", "O:origin",
    "I:abc-charset UTF-8", "r:rhythm", "% a comment",
    '"C" c8 | "G" d8 |',
  ].join("\n");
  const out = buildVoiceBody(melody, ["B1", "B2"], 0, "x8");
  assert.equal(out.replace(/\s+/g, " ").trim(), "B1 | B2 |");
});

test("buildVoiceBody ignores a stray F: link line above the first bar", () => {
  // shake_that_thing: the only K: line is followed by an F: YouTube URL, so it
  // lands in the body. Its letters must not read as a phantom pickup bar that
  // pushes the first pattern onto the melody's second system.
  const melody =
    'F:https://www.youtube.com/watch?v=VyvU4hCRl08\nc ||: "Eb7" _d8 | _d8 :|';
  const out = buildVoiceBody(melody, ["B1", "B2"], 1, "x8", 1, 8);
  assert.equal(out.replace(/\s+/g, " ").trim(), "x ||: B1 | B2 :|");
});

test("buildVoiceBody ignores a stray L: field left above the pickup", () => {
  // Isle of Capri / All of Me / Jada order their header K: before L:, so
  // splitHeaderBody (which cuts on the last K:) drops the L: field into the
  // body, right above the pickup. Its newline must not read as a mid-measure
  // line break — that wrapped the comping's first bar onto the melody's second
  // system instead of sitting under the first full bar of line 1.
  const melody = 'L:1/4\nC/F/A/|| "F" c c/d/ c B/A/ | c c z/ C/F/A/ |';
  const out = buildVoiceBody(melody, ["B1", "B2"], 1, "x", 1, 4);
  assert.equal(out.trim(), "x3/2 || B1 | B2 |");
});

test("buildVoiceBody keeps a genuine mid-tune M: field, not just header leakage", () => {
  // A real meter change partway through, on its own line between barlines,
  // must reach the comping voice exactly like the melody voice keeps it —
  // only the header leak right after K: (the case above) gets dropped, not
  // every M:/L:/Q: field anywhere in the body.
  const melody = '"C" c8 |\nM:3/4\n| "C" c4 c4 c4 |';
  const out = buildVoiceBody(melody, ["B1", "B2"], 0, "x8");
  assert.equal(out.trim(), "B1 |\nM:3/4\n| B2 |");
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

test("measureBarSlots strips a mid-tune inline field ([M:...], [L:...], [Q:...]) without counting it as a note", () => {
  assert.equal(measureBarSlots("[M:3/4]c4 c4", 1, 8), 8); // field consumed silently, notes counted normally
  assert.equal(measureBarSlots("[L:1/8]c c c c", 1, 8), 4);
  assert.equal(measureBarSlots("[Q:1/4=120]", 1, 8), 0); // a bar that's only a field change has no note slots
});

test("measureBarSlots doesn't mistake a second-ending bracket ([2 ...) for an inline field", () => {
  // "[2" is ABC's repeat-ending marker (a digit, not a letter+colon field) —
  // it must not swallow the notes that follow it.
  assert.equal(measureBarSlots("[2 c4 c4", 1, 8), 8);
});

test("measureBarSlots keeps an unclosed inline field's text verbatim instead of dropping it", () => {
  // No closing "]" — the field-stripper's own fallback keeps the rest of the
  // segment untouched (the same "no closing delimiter" contract as
  // stripDelimited). The stray letters don't parse as notes either way.
  assert.equal(measureBarSlots("c4 [M:3/4 c4", 1, 8), 8); // both c4's count; the field text isn't dropped
});

test("buildVoiceBody matches a short pickup's length when given L", () => {
  // Bellamina: a two-eighth pickup at L:1/4 before the first chorded bar
  const melody = "B/2=A/2 || B2 G B/2=A/2 | B2 G B/2=A/2 |";
  const out = buildVoiceBody(melody, ["P1", "P2"], 1, "x", 1, 4);
  assert.equal(out.trim(), "x || P1 | P2 |");
});

test("buildVoiceBody rests a mid-tune anacrusis and skips its phantom pattern", () => {
  // Bei Mir: the chorus opens `D2 ||` — a quarter-note lead-in partway through
  // the tune. parseChordScheme emits a continuation chord measure for it, so
  // barStrings has an entry there; the comping voice must spend it on a
  // measured rest, not a full pattern bar, or every barline from the chorus on
  // drifts out of step with the melody.
  const melody = '"C" c8 | "G7" d8 | D2 || "C" c8 | "G7" d8 |';
  const out = buildVoiceBody(melody, ["B1", "B2", "SKIP", "B3", "B4"], 0, "x8", 1, 8);
  assert.equal(out.trim(), "B1 | B2 | x2 || B3 | B4 |");
});

// ---------------------------------------------------------------------------
// Pattern table
// ---------------------------------------------------------------------------

const callPatternBuilder = (fn) => fn("N", "ND", "NU", "NU2");

// Every pattern's exact twobar1/twobar2/half rhythm template, called with
// plain placeholder tokens ("N"/"ND"/"NU"/"NU2" for the chord/down-step/
// up-step/up-2-step tokens) so each pattern is pinned precisely without
// going through the full voice-leading pipeline for every one of the 15.
test("every COMPING_PATTERNS entry's rhythm templates match exactly", () => {
  const expected = {
    on_2_and_4: { twobar1: "z2 N2 z2 N2", twobar2: "N z z N-N4", half: "z2 N2" },
    hold_over: { twobar1: "N8-", twobar2: "N6 z2", half: "N4" },
    hit_and_hold: { twobar1: "N z z N-N4", twobar2: "N z z N-N4", half: "N z z N" },
    double_hit: { twobar1: "N N z2 z4", twobar2: "N N z N z N3", half: "N N z2" },
    whole_note: { twobar1: "N8-", twobar2: "N8", half: "N4" },
    walk_down_a: { twobar1: "N z z N-N2 z2", twobar2: "N N ND N z4", half: "N z z N" },
    walk_down_b: { twobar1: "z2 N z ND N2 ND", twobar2: "N N ND N z4", half: "z2 N z" },
    whole_then_step: { twobar1: "N8", twobar2: "ND z z ND z4", half: "N4" },
    walk_eighths: { twobar1: "N N ND ND N N ND ND", twobar2: "N z z N-N4", half: "N N ND ND" },
    cross_step: { twobar1: "z2 N z z N z2", twobar2: "N z z N-N NU ND z", half: "z2 N z" },
    step_approach: { twobar1: "N ND z2 NU ND z2", twobar2: "NU3 ND z4", half: "N ND z2" },
    double_then_step: { twobar1: "N N z2 N N z2", twobar2: "N z NU ND z4", half: "N N z2" },
    full_walk: { twobar1: "N N ND N NU N ND N", twobar2: "ND z z N-N4", half: "N N ND N" },
    third_approach: { twobar1: "N ND z ND-N4", twobar2: "NU2 ND z ND-N4", half: "N ND z ND" },
    step_neighbor: { twobar1: "N ND z NU-N4", twobar2: "N ND z NU z N3", half: "N ND z NU" },
  };
  assert.deepEqual(Object.keys(PATTERNS).sort(), Object.keys(expected).sort());
  for (const [name, pat] of Object.entries(PATTERNS)) {
    assert.equal(callPatternBuilder(pat.twobar1), expected[name].twobar1, `${name}.twobar1`);
    assert.equal(callPatternBuilder(pat.twobar2), expected[name].twobar2, `${name}.twobar2`);
    assert.equal(callPatternBuilder(pat.half), expected[name].half, `${name}.half`);
  }
});

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

// Mixer integration check: lib/audio-mix.js's injectMixerAudio depends on
// this function's exact "...\nV:1\n<melody>\nV:2\n<comping>\n" body shape
// (see its own doc comment above) to stamp each voice's %%MIDI program
// (Voice picker) after its own marker — this exercises that dependency
// against the real output rather than a hand-typed guess at the shape.
test("buildCompingTune's output accepts lib/audio-mix.js's injectMixerAudio", () => {
  const out = withTonal(() => buildCompingTune(TUNE, CHORDS, fakeSong(), "whole_note"));
  const stamped = injectMixerAudio(out.abc, {
    compingActive: true, hasChords: true, melodyProgram: 71, compingProgram: 0, bassPercent: 0, chordsPercent: 0,
  });
  assert.match(stamped, /\nV:1\n%%MIDI program 71\n/);
  assert.match(stamped, /\nV:2\n%%MIDI program 0\n/);
  // the voice declaration line is still there exactly once, untouched
  assert.equal((stamped.match(/V:2 name="R\\n3\\n5"/g) || []).length, 1);
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

test("buildCompingTune's header carries exactly one L: line, and the V:1 declaration exists (not blanked)", () => {
  const out = withTonal(() => buildCompingTune(TUNE, CHORDS, fakeSong(), "whole_note"));
  // one L: line total: the original is stripped from the echoed header, and
  // a fresh one is pushed in its place — never both, never neither.
  assert.equal((out.abc.match(/^L:1\/8$/gm) || []).length, 1);
  // "V:1" appears exactly twice: the header's voice declaration, and the
  // marker right before the melody body itself.
  assert.equal((out.abc.match(/^V:1$/gm) || []).length, 2);
});

test("buildCompingTune strips a pre-existing %%score/%%staves line from the header instead of duplicating it", () => {
  const withExistingStaves = TUNE.replace("K:C", "%%staves [1]\nK:C");
  const out = withTonal(() => buildCompingTune(withExistingStaves, CHORDS, fakeSong(), "whole_note"));
  assert.equal((out.abc.match(/^%%staves\b.*$/gm) || []).length, 1);
  assert.match(out.abc, /^%%staves \[1 2\]$/m);
});

test("buildCompingTune keeps an unrelated header field (e.g. C:composer) verbatim", () => {
  const withComposer = TUNE.replace("K:C", "C:Trad.\nK:C");
  const out = withTonal(() => buildCompingTune(withComposer, CHORDS, fakeSong(), "whole_note"));
  assert.match(out.abc, /^C:Trad\.$/m);
});

test("buildCompingTune's melody body loses trailing whitespace before V:2, not leading", () => {
  const trailing = TUNE + "  \n\n";
  const out = withTonal(() => buildCompingTune(trailing, CHORDS, fakeSong(), "whole_note"));
  const beforeV2 = out.abc.split("\nV:2\n")[0];
  // trimmed: the melody body's last line is real content, not a stray blank
  // line left over from the input's trailing whitespace.
  assert.equal(beforeV2.endsWith("\n"), false);
});

test("buildCompingTune's output ends with a trailing newline", () => {
  const out = withTonal(() => buildCompingTune(TUNE, CHORDS, fakeSong(), "whole_note"));
  assert.ok(out.abc.endsWith("\n"));
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
    const noKLine = TUNE.replace("K:C\n", "");
    assert.equal(buildCompingTune(noKLine, CHORDS, fakeSong(), "whole_note"), null);
  });
});

test("buildCompingTune defaults to 4/4 when the tune has no M: field at all", () => {
  const noMeter = TUNE.split("\n").filter((l) => !l.startsWith("M:")).join("\n");
  const out = withTonal(() => buildCompingTune(noMeter, CHORDS, fakeSong(), "whole_note"));
  assert.ok(out && out.abc, "produced a tune");
});

test("buildCompingTune accepts every supported meter (M:C, M:C|, M:2/2), not only 4/4", () => {
  withTonal(() => {
    for (const meter of ["C", "C|", "2/2"]) {
      const out = buildCompingTune(TUNE.replace("M:4/4", `M:${meter}`), CHORDS, fakeSong(), "whole_note");
      assert.ok(out && out.abc, `M:${meter} should be supported`);
    }
  });
});

test("buildCompingTune reads a multi-digit L: unit, and only when L: is anchored at a line start", () => {
  withTonal(() => {
    // multi-digit numerator/denominator
    const wide = TUNE.replace("L:1/8", "L:12/16");
    const outWide = buildCompingTune(wide, CHORDS, fakeSong(), "whole_note");
    assert.match(outWide.abc, /^L:12\/16$/m);

    // "L:" embedded mid-line (not at the true start of a line) must not be
    // read as the unit field — falls back to the 1/8 default instead.
    const embedded = TUNE.replace("L:1/8\n", "").replace("K:C", "XL:1/4\nK:C");
    const outEmbedded = buildCompingTune(embedded, CHORDS, fakeSong(), "whole_note");
    assert.match(outEmbedded.abc, /^L:1\/8$/m);
  });
});

test("buildCompingTune's L: unit regex tolerates whitespace around the slash on both sides", () => {
  withTonal(() => {
    const before = buildCompingTune(TUNE.replace("L:1/8", "L:1 /4"), CHORDS, fakeSong(), "whole_note");
    assert.match(before.abc, /^L:1\/4$/m);
    const after = buildCompingTune(TUNE.replace("L:1/8", "L:1/ 4"), CHORDS, fakeSong(), "whole_note");
    assert.match(after.abc, /^L:1\/4$/m);
  });
});

test("buildCompingTune defaults to L:1/8 when the tune has no L: field at all", () => {
  const noUnit = TUNE.split("\n").filter((l) => !l.startsWith("L:")).join("\n");
  const out = withTonal(() => buildCompingTune(noUnit, CHORDS, fakeSong(), "whole_note"));
  assert.match(out.abc, /^L:1\/8$/m);
  const v2 = out.abc.split("\nV:2\n").pop();
  assert.match(v2, /8-/); // whole_note's twobar1 at the default eighth-note unit
});

// The comping's K: line as an ABC key signature { letter: "^"|"_"|"" }.
function keySigOf(abc) {
  // eslint-disable-next-line regexp/no-misleading-capturing-group -- verified: [#b]? is greedy and always claims a real accidental first (K:Bb -> "Bb", never "B" + "b" spilling into the \w+ group)
  const m = abc.match(/^K:\s*([A-G][#b]?)\s*(\w+)?/m);
  const tonic = m ? m[1] : "C";
  const mode = m && /^m(in)?$/i.test(m[2] || "") ? "minor" : "major";
  const sig = {};
  for (const pc of TonalStub.Scale.get(tonic + " " + mode).notes) {
    const mm = String(pc).match(/^([A-G])([#b]*)$/);
    if (mm) sig[mm[1]] = mm[2].replace(/#/g, "^").replace(/b/g, "_");
  }
  return sig;
}

// Pull the comping voice's block chords out as bottom-to-top MIDI triples,
// reading each notehead at its true sounding pitch: bare noteheads follow the
// K: signature and accidentals propagate per letter+octave within a bar, the
// same way ABCjs resolves them.
// Splits a "[CEG]" chord's insides into its individual accidentals+letter+
// octave-marks notes ("C", "^E,", ...) — a manual scan, not a
// `[_^=]*[A-Ga-g][,']*` regex, since a star quantifier ahead of a single
// required letter is exactly the shape sonarjs's regex-DoS check flags.
function splitChordNotes(str) {
  const notes = [];
  let i = 0;
  while (i < str.length) {
    let j = i;
    while (str[j] === "_" || str[j] === "^" || str[j] === "=") j += 1;
    if (!/[A-Ga-g]/.test(str[j] || "")) {
      i += 1;
      continue;
    }
    j += 1;
    while (str[j] === "," || str[j] === "'") j += 1;
    notes.push(str.slice(i, j));
    i = j;
  }
  return notes;
}

function compingChordMidis(abc) {
  const v2 = abc.split("\nV:2\n").pop();
  const sig = keySigOf(abc);
  const out = [];
  for (const bar of v2.split(/\|+/)) {
    const barAcc = new Map();
    for (const tok of bar.match(/\[(?:[_^=]*[A-Ga-g][,']*)+\]/g) || []) {
      const notes = splitChordNotes(tok.slice(1, -1));
      out.push(
        notes.map((n) => {
          const nm = n.match(/^([_^=]*)([A-Ga-g])([,']*)$/);
          const letterOct = nm[2] + nm[3];
          let acc = nm[1].replace(/=/g, "");
          if (nm[1]) barAcc.set(letterOct, acc);
          else if (barAcc.has(letterOct)) acc = barAcc.get(letterOct);
          else acc = sig[nm[2].toUpperCase()] || "";
          const sci = TonalStub.AbcNotation.abcToScientificNotation(nm[2] + nm[3]);
          return nameToMidi(
            sci.replace(/^([A-G])/, "$1" + acc.replace(/\^/g, "#").replace(/_/g, "b")),
          );
        }),
      );
    }
  }
  return out;
}

test("buildCompingTune draws the first chord in root position", () => {
  // G first: root position at octave 4, not snapped to some seed's inversion.
  const tune = ["M:4/4", "L:1/8", "K:C", '"G" G8 | "G" G8 |'].join("\n");
  const chords = [{ text: ["G"] }, { text: ["G"] }];
  const out = withTonal(() => buildCompingTune(tune, chords, fakeSong(), "whole_note"));
  const bars = compingChordMidis(out.abc);
  assert.deepEqual(bars[0], [67, 71, 74]); // G4 B4 D5
  assert.deepEqual(out.palette[0], ["R", "3", "5"]);
});

test("buildCompingTune walks each colour to the nearest tone of the next chord", () => {
  // G(black) B(gold) D(red) -> C7: black holds G (common tone), gold steps
  // B->C, red steps D->E. Colour tracks the line, not the chord tone.
  const tune = ["M:4/4", "L:1/8", "K:C", '"G" G8 | "C7" G8 |'].join("\n");
  const chords = [{ text: ["G"] }, { text: ["C7"] }];
  const out = withTonal(() => buildCompingTune(tune, chords, fakeSong(), "whole_note"));
  const bars = compingChordMidis(out.abc);
  assert.deepEqual(bars[0], [67, 71, 74]); // G4 B4 D5
  assert.deepEqual(bars[1], [67, 72, 76]); // G4 C5 E5 — black held, gold/red +1 step
  // the colours never reorder: bottom is always black, middle gold, top red
  for (const order of out.palette) assert.deepEqual(order, ["R", "3", "5"]);
});

test("buildCompingTune draws each chord in the inversion closest to the last", () => {
  // G B D -> D7: F#4 A4 D5 sits right under G4 B4 D5 (each line moves <= a
  // tone), far closer than root-position D4 F#4 A4 would.
  const tune = ["M:4/4", "L:1/8", "K:C", '"G" G8 | "D7" G8 |'].join("\n");
  const chords = [{ text: ["G"] }, { text: ["D7"] }];
  const out = withTonal(() => buildCompingTune(tune, chords, fakeSong(), "whole_note"));
  const bars = compingChordMidis(out.abc);
  assert.deepEqual(bars[0], [67, 71, 74]); // G4 B4 D5
  assert.deepEqual(bars[1], [66, 69, 74]); // F#4 A4 D5 — closest inversion
  for (let v = 0; v < 3; v++) {
    assert.ok(Math.abs(bars[1][v] - bars[0][v]) <= 2, `slot ${v}`);
  }
});

test("buildCompingTune re-inverts on a chord change instead of moving in parallel", () => {
  // C (root position) -> D: root-position D4 F#4 A4 would just plane the whole
  // triad up a tone (parallel movement). The generator picks second-inversion
  // A3 D4 F#4 instead — same total motion, but the voices no longer lockstep.
  const tune = ["M:4/4", "L:1/8", "K:C", '"C" C8 | "D" G8 |'].join("\n");
  const chords = [{ text: ["C"] }, { text: ["D"] }];
  const out = withTonal(() => buildCompingTune(tune, chords, fakeSong(), "whole_note"));
  const bars = compingChordMidis(out.abc);
  assert.deepEqual(bars[0], [60, 64, 67]); // C4 E4 G4, root position
  assert.deepEqual(bars[1], [57, 62, 66]); // A3 D4 F#4, second inversion
});

test("buildCompingTune keeps the same inversion for a repeated chord", () => {
  // The anti-parallel nudge only fires on an actual chord change: two bars of
  // C stay put as C4 E4 G4 rather than being forced to re-invert.
  const tune = ["M:4/4", "L:1/8", "K:C", '"C" C8 | "C" G8 |'].join("\n");
  const chords = [{ text: ["C"] }, { text: ["C"] }];
  const out = withTonal(() => buildCompingTune(tune, chords, fakeSong(), "whole_note"));
  const bars = compingChordMidis(out.abc);
  assert.deepEqual(bars[0], [60, 64, 67]);
  assert.deepEqual(bars[1], [60, 64, 67]);
});

test("buildCompingTune spells comping accidentals against the concert key", () => {
  // Key of D (F# and C# in the signature). A chord tone the key already
  // sharpens must NOT carry a redundant sharp (it would resurface as a
  // courtesy natural once the sheet transposes); a chord tone the key would
  // sharpen but the chord wants natural gets an explicit natural.
  const tune = [
    "M:4/4", "L:1/8", "K:D",
    '"D" D8 | "A7" A8 | "C" C8 | "D" D8 |',
  ].join("\n");
  const chords = [{ text: ["D"] }, { text: ["A7"] }, { text: ["C"] }, { text: ["D"] }];
  const out = withTonal(() =>
    buildCompingTune(tune, chords, fakeSong({ root: "D", acc: "", mode: "" }), "whole_note"),
  );
  const v2 = out.abc.split("\nV:2\n").pop();
  const bars = v2.split(/\|+/).filter((b) => /\[/.test(b));
  assert.doesNotMatch(bars[0], /\^/); // D bar: F# is in the key, no printed sharp
  assert.doesNotMatch(bars[1], /\^/); // A7 bar: C# is in the key, no printed sharp
  assert.match(bars[2], /=C/); // C bar: C natural must cancel the key's C#
  // every notehead still sounds its real pitch: bare F in the D bar = F#
  const midis = compingChordMidis(out.abc);
  assert.deepEqual(midis[0], [62, 66, 69]); // D4 F#4 A4, root position
  assert.equal(midis[2][0] % 12, 0); // the C bar really does sound a natural C
});

test("buildCompingTune keeps every comping chord inside an octave", () => {
  // Bei mir bist du schön's changes wander far around the circle; the stack
  // must not spread past an octave as it chases them.
  const names = ["Gm", "Am7b5", "D7", "Gm", "Cm", "Eb7", "D7", "G7", "Cm", "D", "Gm"];
  const tune = [
    "M:4/4", "L:1/8", "K:Gm",
    names.map((n) => `"${n}" G8`).join(" | ") + " |",
  ].join("\n");
  const chords = names.map((n) => ({ text: [n] }));
  const out = withTonal(() => buildCompingTune(tune, chords, fakeSong({ root: "G", acc: "", mode: "m" }), "whole_note"));
  const bars = compingChordMidis(out.abc);
  assert.equal(bars.length, names.length);
  for (const triple of bars) {
    assert.ok(triple[0] < triple[1] && triple[1] < triple[2], `ascending: ${triple}`);
    assert.ok(triple[2] - triple[0] <= 12, `span ${triple[2] - triple[0]}: ${triple}`);
  }
});

test("buildCompingTune homes the comping instead of letting it climb an octave", () => {
  // My Blue Heaven's changes keep resolving up a fourth (Eb -> Bb7 -> Eb, C7 ->
  // F7 -> Bb7). Closest-inversion voice-leading alone would step the whole
  // stack up a bar at a time until it lurched back down an octave. The homing
  // pull keeps every chord within a fifth of the opening voicing, and no single
  // voice ever jumps an octave between chords.
  const names = [
    "Eb", "C7", "F7", "Bb7", "Eb", "C7", "F7", "Bb7", "Eb", "C7", "F7", "Bb7",
    "Eb", "Ab", "Bb7", "Eb", "C7", "F7", "Bb7", "Eb",
  ];
  const tune = [
    "M:4/4", "L:1/8", "K:Eb",
    names.map((n) => `"${n}" E8`).join(" | ") + " |",
  ].join("\n");
  const chords = names.map((n) => ({ text: [n] }));
  const out = withTonal(() =>
    buildCompingTune(tune, chords, fakeSong({ root: "E", acc: "b", mode: "" }), "whole_note"),
  );
  const bars = compingChordMidis(out.abc);
  assert.equal(bars.length, names.length);
  const start = centre(bars[0]);
  for (const triple of bars) {
    assert.ok(triple[0] < triple[1] && triple[1] < triple[2], `ascending: ${triple}`);
    assert.ok(
      Math.abs(centre(triple) - start) <= 7,
      `centre ${centre(triple)} vs start ${start}: ${triple}`,
    );
  }
  for (let b = 1; b < bars.length; b++) {
    for (let v = 0; v < 3; v++) {
      assert.ok(
        Math.abs(bars[b][v] - bars[b - 1][v]) < 12,
        `slot ${v} bar ${b} octave lurch: ${bars[b - 1][v]} -> ${bars[b][v]}`,
      );
    }
  }
});

test("buildCompingTune voice-leads a progression with minimal, non-crossing motion", () => {
  const tune = [
    "M:4/4", "L:1/8", "K:C",
    '"C" C8 | "Em" E8 | "Am" A8 | "F" F8 |',
  ].join("\n");
  const chords = [
    { text: ["C"] }, { text: ["Em"] }, { text: ["Am"] }, { text: ["F"] },
  ];
  const out = withTonal(() => buildCompingTune(tune, chords, fakeSong(), "whole_note"));
  const bars = compingChordMidis(out.abc);
  assert.deepEqual(bars[0], [60, 64, 67]); // C4 E4 G4
  for (const triple of bars) {
    assert.ok(triple[0] < triple[1] && triple[1] < triple[2], `ascending: ${triple}`);
  }
  // closest-inversion voice-leading keeps every slot within a tone per chord
  for (let b = 1; b < bars.length; b++) {
    for (let v = 0; v < 3; v++) {
      assert.ok(
        Math.abs(bars[b][v] - bars[b - 1][v]) <= 2,
        `slot ${v} bar ${b}: ${bars[b - 1][v]} -> ${bars[b][v]}`,
      );
    }
  }
});

test("buildCompingTune repeats the previous bar's chord for a '%' or blank chord symbol", () => {
  const tune = ["M:4/4", "L:1/8", "K:C", '"C" C8 | "%" C8 | C8 |'].join("\n");
  const chords = [{ text: ["C"] }, { text: ["%"] }, { text: [""] }];
  const out = withTonal(() => buildCompingTune(tune, chords, fakeSong(), "whole_note"));
  const bars = compingChordMidis(out.abc);
  assert.deepEqual(bars[0], bars[1]);
  assert.deepEqual(bars[1], bars[2]);
});

test("buildCompingTune drops a slash-bass chord's bass note, comping on the chord itself", () => {
  const plain = withTonal(() => buildCompingTune(
    ["M:4/4", "L:1/8", "K:C", '"C" C8 |'].join("\n"), [{ text: ["C"] }], fakeSong(), "whole_note",
  ));
  const slash = withTonal(() => buildCompingTune(
    ["M:4/4", "L:1/8", "K:C", '"C/E" C8 |'].join("\n"), [{ text: ["C/E"] }], fakeSong(), "whole_note",
  ));
  assert.deepEqual(compingChordMidis(slash.abc), compingChordMidis(plain.abc));
});

test("buildCompingTune pads an unrecognised chord symbol out to a full triad instead of drawing fewer notes", () => {
  const tune = ["M:4/4", "L:1/8", "K:C", '"NC" C8 |'].join("\n");
  const out = withTonal(() => buildCompingTune(tune, [{ text: ["NC"] }], fakeSong(), "whole_note"));
  const bars = compingChordMidis(out.abc);
  assert.equal(bars[0].length, 3);
  assert.ok(bars[0][0] < bars[0][1] && bars[0][1] < bars[0][2], `ascending: ${bars[0]}`);
  for (const midi of bars[0]) assert.equal(midi % 12, 0, "every voice falls back to pitch class C");
});

test("buildCompingTune draws two half-bar chords when a measure carries two chord symbols", () => {
  const tune = ["M:4/4", "L:1/8", "K:C", '"C" C4 "G" G4 |'].join("\n");
  const chords = [{ text: ["C", "G"] }];
  const out = withTonal(() => buildCompingTune(tune, chords, fakeSong(), "whole_note"));
  const bars = compingChordMidis(out.abc);
  assert.equal(bars.length, 2); // two chord onsets drawn in the one bar
  assert.deepEqual(bars[0], [60, 64, 67]); // C4 E4 G4, root-position seed
  assert.deepEqual(bars[1], [59, 62, 67]); // B3 D4 G4 — G's first inversion, closest to the C triad
  assert.equal(out.palette.length, 2);
});

test("buildCompingTune distributes three-plus chords in one bar evenly, one hit per chord", () => {
  const tune = ["M:4/4", "L:1/8", "K:C", '"C" C2 "F" F2 "G" G2 "C" C2 |'].join("\n");
  const chords = [{ text: ["C", "F", "G", "C"] }];
  const out = withTonal(() => buildCompingTune(tune, chords, fakeSong(), "whole_note"));
  const bars = compingChordMidis(out.abc);
  assert.equal(bars.length, 4); // one onset per chord symbol
  assert.equal(out.palette.length, 4);
  const roots = ["C", "F", "G", "C"];
  const pcChroma = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  for (let i = 0; i < roots.length; i++) {
    // the bottom voice of each hit sounds *a* tone of its own chord (not
    // necessarily the root, since it's still voice-led from the previous
    // hit) — but every voice must land on that chord's own pitch classes.
    const expectedPcs = new Set([0, 4, 7].map((step) => (pcChroma[roots[i]] + step) % 12));
    for (const midi of bars[i]) assert.ok(expectedPcs.has(midi % 12), `bar ${i} tone ${midi % 12} in chord ${roots[i]}`);
  }
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
