import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import {
  buildPracticeTune, exerciseTakesShape, formatExercise, isPracticeSetting, parseExercise, practiceNotes, practiceNoteSet,
  practiceSummary, practiceSummaryParts, PRACTICE_APPROACHES, PRACTICE_EXERCISES, PRACTICE_KINDS, PRACTICE_NOTE_SETS,
  practiceDefaultRhythms, PRACTICE_RHYTHMS, PRACTICE_SHAPES, rhythmSlots,
} from "./practice.js";
import { buildCompingTune, COMPING_PATTERNS } from "./comping.js";
import { parseChordScheme } from "./chords.js";
import { tonalStub } from "../../../../tests/helpers/stubs.js";
import {
  ABC, SONG, CHORDS, chordsOf, barSlots, voiceBars as practiceBars, withRealTonal,
} from "../../../../tests/helpers/bar-voice.js";

before(() => {
  globalThis.Tonal = tonalStub;
});
after(() => {
  delete globalThis.Tonal;
});

const SCALES_UPDOWN = "scales-updown";
const SCALES_THIRDS = "scales-thirds";
const BLUES_UP = "scales-up@blues";
const GUIDE_TONES = "arpeggios@37";
const NAMES = [["F"], ["C7"], ["F", "F7"], [null]];

const mod12 = (x) => ((x % 12) + 12) % 12;
const F_CHORD_TONES = new Set([5, 9, 0, 2]); // F A C D (the GA's major chord tones: 1 3 5 6)
const C7_CHORD_TONES = new Set([0, 4, 7, 10]);

test("every exercise builds a named Practice staff, one full bar per chart bar", () => {
  for (const value of PRACTICE_EXERCISES) {
    const { abc } = buildPracticeTune(ABC, CHORDS, SONG, value);
    assert.match(abc, /^V:2 name="Practice"$/m, value);
    const bars = practiceBars(abc);
    assert.equal(bars.length, 4, value);
    for (const bar of bars) assert.equal(barSlots(bar), 8, `${value}: ${bar}`);
  }
});

test("an exercise is the same every time", () => {
  assert.deepEqual(practiceNotes(NAMES, "enclosures"), practiceNotes(NAMES, "enclosures"));
});

test("a break bar stays silent", () => {
  for (const value of PRACTICE_EXERCISES) {
    const notes = practiceNotes(NAMES, value);
    assert.ok(notes.every((n) => n.start < 12), value);
  }
});

test("chord-tone runs only play chord tones of the chord they sound over", () => {
  const notes = practiceNotes([["F"], ["C7"]], "arpeggios");
  for (const n of notes) {
    const tones = n.start < 4 && n.start + n.duration <= 4 ? F_CHORD_TONES : C7_CHORD_TONES;
    assert.ok(tones.has(mod12(n.midi)), `${n.midi} at ${n.start}`);
  }
});

test("the first bar runs up eighth by eighth", () => {
  const notes = practiceNotes([["F"], ["F"]], "scales").slice(0, 8);
  assert.equal(notes.length, 8);
  notes.forEach((n, i) => {
    assert.equal(n.start, i / 2);
    if (i > 0) assert.ok(n.midi > notes[i - 1].midi);
  });
});

test("guide tones step to the nearest 3rd or 7th of the next chord", () => {
  const notes = practiceNotes([["F"], ["C7"], ["F"]], "guide");
  for (const n of notes) assert.notEqual(mod12(n.midi), 5, "never the root of F");
  // At each chord change the line moves to the nearest one: a step at most.
  for (const i of [2, 4]) assert.ok(Math.abs(notes[i].midi - notes[i - 1].midi) <= 2, `${notes[i].start}`);
});

test("an enclosure opens each chord and lands on its target: a step above, a half step below", () => {
  const notes = practiceNotes([["F"], ["C7"]], "enclosures", { rhythms: ["eighths"] });
  [F_CHORD_TONES, C7_CHORD_TONES].forEach((tones, bar) => {
    const [above, below, target] = notes.filter((n) => Math.floor(n.start / 4) === bar);
    assert.equal(target.start, bar * 4 + 1, "the target is the chord's third note, on a beat");
    assert.ok(tones.has(mod12(target.midi)), `${target.midi} is a chord tone`);
    assert.equal(below.midi, target.midi - 1);
    assert.ok(below.leadsUp);
    assert.ok(above.midi > target.midi && above.midi - target.midi <= 2);
  });
});

test("an enclosure's target takes the long note: on a long downbeat it's enclosed from the bar before", () => {
  // Three against four: the dotted quarter on 1 is the target, the bar
  // before's last two notes enclose it.
  const notes = practiceNotes([["F"], ["C7"]], "enclosures", { rhythms: ["threefour"], breathEvery: 0 });
  const at = notes.findIndex((n) => n.start === 4);
  assert.ok(C7_CHORD_TONES.has(mod12(notes[at].midi)));
  assert.equal(notes[at].duration, 1.5);
  assert.equal(notes[at - 1].midi, notes[at].midi - 1);
  assert.ok(notes[at - 2].midi > notes[at].midi);
  // A Charleston leaves no room before its long note: the target alone.
  const charleston = practiceNotes([["F"], ["C7"]], "enclosures", { rhythms: ["charleston"], breathEvery: 0 });
  const held = charleston.find((n) => n.start === 4);
  assert.ok(C7_CHORD_TONES.has(mod12(held.midi)));
  assert.equal(held.duration, 1.5);
});

test("scale runs keep chord tones on the beats, whatever the rhythm", () => {
  // Not in thirds: a broken-thirds pattern is the exercise, whatever lands on the beat.
  const fullScales = PRACTICE_EXERCISES.filter((e) => {
    const { kind, degrees, variant } = parseExercise(e);
    return kind === "scales" && degrees.length === 8 && variant !== "thirds";
  });
  assert.equal(fullScales.length, 4);
  for (const exercise of fullScales) {
    for (const rhythm of PRACTICE_RHYTHMS.filter((r) => r.run)) {
      const notes = practiceNotes([["F"], ["F"], ["F"], ["F"]], exercise, { rhythms: [rhythm.value], breathEvery: 0 });
      for (const n of notes.filter((note) => Number.isInteger(note.start))) {
        assert.ok(F_CHORD_TONES.has(mod12(n.midi)), `${exercise} ${rhythm.value}: ${n.midi} on beat ${n.start}`);
      }
    }
  }
});

test("enclosures: no note before the enclosure plays the target", () => {
  for (const rhythm of PRACTICE_RHYTHMS.filter((r) => r.run)) {
    const notes = practiceNotes([["F"], ["C7"]], "enclosures", { rhythms: [rhythm.value], breathEvery: 0 });
    const bar = notes.filter((n) => n.start >= 4 && n.start < 8);
    const target = bar.findIndex((n, i) => i >= 2 && bar[i - 1].midi === n.midi - 1);
    for (const n of bar.slice(0, Math.max(0, target - 2))) assert.notEqual(n.midi, bar[target].midi, rhythm.value);
  }
});

test("guide tones: the 7th falls a half step onto the next 3rd, on the downbeat", () => {
  const notes = practiceNotes([["Dm7"], ["G7"], ["C"], ["C"]], "guide", { rhythms: ["halves"], breathEvery: 0 });
  const at = (beat) => notes.find((n) => n.start === beat).midi;
  assert.equal(at(4) - at(2), -1, "C (Dm7's 7th) to B (G7's 3rd)");
  assert.equal(at(8) - at(6), -1, "F (G7's 7th) to E (C's 3rd)");
});

test("the tune's key reaches the scales: E7 in A minor runs with F and C", () => {
  const minor = `X:1
T:Minor
M:4/4
L:1/8
K:Am
A8|E8|]
`;
  withRealTonal(() => {
    const song = ABCJS.parseOnly(minor)[0];
    const { notes } = buildPracticeTune(minor, chordsOf(["Am"], ["E7"]), song, "scales", { rhythms: ["eighths"], breathEvery: 0 });
    const overE7 = new Set(notes.filter((n) => n.start >= 4).map((n) => mod12(n.midi)));
    assert.ok(overE7.has(5) && overE7.has(0), "F and C");
    assert.ok(!overE7.has(6) && !overE7.has(1), "never F# or C#");
  });
});

test("every exercise ends on the key's tonic when the last chord holds it", () => {
  const names = [["F"], ["C7"], ["Gm7"], ["F"]];
  for (const exercise of PRACTICE_EXERCISES) {
    const notes = practiceNotes(names, exercise, { breathEvery: 0, tonic: 5 });
    assert.equal(mod12(notes[notes.length - 1].midi), 5, exercise);
  }
  // A tune ending on its dominant doesn't: C7 has no F.
  const open = practiceNotes([["F"], ["C7"]], "guide", { breathEvery: 0, tonic: 5 });
  assert.notEqual(mod12(open[open.length - 1].midi), 5);
});

test("an enclosure's last target is the tonic, enclosed like any other", () => {
  const notes = practiceNotes([["F"], ["C7"]], "enclosures", { rhythms: ["eighths"], breathEvery: 0, tonic: 0 });
  const bar = notes.filter((n) => n.start >= 4);
  assert.equal(mod12(bar[2].midi), 0, "C, the tonic, is C7's root");
  assert.equal(bar[1].midi, bar[2].midi - 1);
  assert.ok(bar[0].midi > bar[2].midi);
});

test("a chromatic note leading up is spelled sharp", () => {
  // F into F: the target is A, enclosed by Bb and G# (never Ab).
  const [first] = practiceBars(buildPracticeTune(ABC, chordsOf(["F"], ["F"]), SONG, "enclosures").abc);
  assert.match(first, /\^G/);
  assert.doesNotMatch(first, /_A/);
});

test("a cell ending in > ties its last note into the next bar's chord", () => {
  assert.equal(rhythmSlots(2, new Set(), ["xxxxxx.x>"]), "xxxxxx.x-xxxxx.x");
  assert.equal(rhythmSlots(2, new Set([1]), ["xxxxxx.x>"]), "xxxxxx.x........", "never into a break");
  // Into a pattern that opens with a rest (Anticipate, then Late start): the
  // tied note still carries over onto the downbeat.
  const handover = rhythmSlots(4, new Set(), ["xxxxxx.x>", ".x--x---"]);
  assert.equal(handover.slice(8, 16), "-xxxxx.x", "bar 2: the anticipation again, tied into from bar 1");
  assert.equal(handover.slice(16), "-x--x---.x--x---");
  const notes = practiceNotes([["F"], ["F"], ["F"], ["F"]], "scales", { rhythms: ["anticipate", "late"], breathEvery: 0 });
  assert.equal(notes.find((n) => n.start === 7.5).duration, 1, "the and of 4 held into bar 3");
  // The fifth cell (bars 9-10) is the anticipated one.
  const names = [...Array.from({ length: 8 }, () => ["F"]), ["F"], ["C7"]];
  const anticipation = practiceNotes(names, "rhythm").find((n) => n.start === 35.5);
  assert.equal(anticipation.duration, 1, "the and of 4 tied over the bar line");
  assert.ok(C7_CHORD_TONES.has(mod12(anticipation.midi)), "plays the chord it lands on");
});

test("Practice goes on top of Comping as the next voice", () => {
  const comping = buildCompingTune(ABC, CHORDS, SONG, COMPING_PATTERNS[0].value);
  const { abc } = buildPracticeTune(comping.abc, CHORDS, SONG, "scales");
  assert.match(abc, /^V:3 name="Practice"$/m);
});

test("buildPracticeTune declines what it can't do", () => {
  assert.equal(buildPracticeTune(ABC, [], SONG, "scales"), null);
  assert.equal(buildPracticeTune(ABC, CHORDS, SONG, "kazoo"), null);
  assert.equal(buildPracticeTune(ABC.replace("M:4/4", "M:3/4"), CHORDS, SONG, "scales"), null);
});

// The Practice staff as abcjs actually plays it: the second voice's track
// (the melody's comes first, the chord accompaniment's last).
function practicePlayback(abc) {
  const tracks = ABCJS.parseOnly(abc)[0].setUpAudio({}).tracks;
  return tracks[1].filter((e) => e.cmd === "note").map((e) => e.pitch);
}

function practiceOf(text, exercise) {
  const song = ABCJS.parseOnly(text)[0];
  return buildPracticeTune(text, parseChordScheme(song), song, exercise);
}

test("a key change before a repeat is followed: the new section sounds as generated", () => {
  // K:Bb, then the new part opens on a bar line (Royal Garden Blues' "|:"
  // shape; a plain "|" here, so playback isn't unrolled by a repeat): the
  // E-naturals of the C7 bar must be spelled for Bb, not left bare from F.
  const text = [
    "X:1", "T:Keys", "M:4/4", "L:1/8", "K:F",
    "\"F\"F8|\"C7\"G8||", "K:Bb", "P:B", "|\"Bb\"B8|\"C7\"c8|\"F7\"c8|\"Bb\"B8|]", "",
  ].join("\n");
  withRealTonal(() => {
    for (const value of PRACTICE_EXERCISES) {
      const built = practiceOf(text, value);
      assert.deepEqual(practicePlayback(built.abc), built.notes.map((n) => n.midi), value);
    }
  });
});

test("a note tied into a bar doesn't set its accidental for the rest of the bar", () => {
  // The 3rd alone over C7 in Eb ties an E-natural into the next C7 bar:
  // abcjs ignores the accidental on a tied-over note, so the next E in that
  // bar must carry its own natural.
  // The anticipated cell comes round at bars 9-10.
  const bars = Array.from({ length: 12 }, () => "\"C7\"G8").join("|");
  const text = ["X:1", "T:Tie", "M:4/4", "L:1/8", "K:Eb", `${bars}|]`, ""].join("\n");
  withRealTonal(() => {
    const built = practiceOf(text, "arpeggios@3");
    // "...E- |E=E...": the tied-over E is written bare, the next one spells its own natural.
    assert.match(built.abc, /E- \|E=E/);
    assert.deepEqual(practicePlayback(built.abc), built.notes.map((n) => n.midi));
  });
});

test("the blues scale's raised 4th rising to the 5th is spelled sharp, and sounds as generated", () => {
  // In C: F# into G, never Gb; Eb and Bb flat.
  const text = ["X:1", "T:Blues", "M:4/4", "L:1/8", "K:C", "\"C7\"c8|\"F7\"c8|\"C7\"c8|\"G7\"B8|]", ""].join("\n");
  withRealTonal(() => {
    const built = practiceOf(text, BLUES_UP);
    const [first] = practiceBars(built.abc);
    assert.match(first, /\^F/);
    assert.doesNotMatch(first, /_G/);
    assert.match(first, /_E/);
    assert.deepEqual(practicePlayback(built.abc), built.notes.map((n) => n.midi));
  });
});

// The onsets of each bar, as "slot:length" in eighths.
function barRhythms(notes, bars) {
  return Array.from({ length: bars }, (_, bar) => notes
    .filter((n) => Math.floor(n.start / 4) === bar)
    .map((n) => `${n.start * 2 - bar * 8}:${n.duration * 2}`)
    .join(" "));
}

const EIGHT_BARS = [["F"], ["C7"], ["F"], ["C7"], ["F"], ["C7"], ["F"], ["C7"]];

test("a picked rhythm plays the whole way; varied changes it every two bars", () => {
  const fixed = barRhythms(practiceNotes(EIGHT_BARS, "arpeggios", { rhythms: ["charleston"], breathEvery: 0 }), 8);
  assert.ok(fixed.every((bar) => bar === "0:3 3:1"), fixed.join(" | "));
  const varied = barRhythms(practiceNotes(EIGHT_BARS, "arpeggios", { breathEvery: 0 }), 8);
  assert.notEqual(varied[0], varied[2]);
  for (const { value } of PRACTICE_RHYTHMS) {
    assert.ok(practiceNotes(EIGHT_BARS, "guide", { rhythms: [value] }).length > 0, value);
  }
});

// Each chord's notes as steps from its first one: the run's shape.
function shapes(notes) {
  return Array.from({ length: 8 }, (_, bar) => {
    const run = notes.filter((n) => Math.floor(n.start / 4) === bar).map((n) => n.midi);
    return run.map((m) => m - run[0]).join(",");
  });
}

test("runs: up, down and up-then-down give every chord the same shape", () => {
  for (const runs of ["up", "down", "updown"]) {
    const notes = practiceNotes([["F"], ["F"], ["F"], ["F"], ["F"], ["F"], ["F"], ["F"]], `arpeggios-${runs}`, { rhythms: ["eighths"], breathEvery: 0 });
    // The last bar has no next chord to lead into, so only the others compare.
    const each = shapes(notes).slice(0, -1);
    assert.ok(each.every((shape) => shape === each[0]), `${runs}: ${each.join(" | ")}`);
  }
});

test("runs: always up only ever climbs within a bar, always down only falls", () => {
  for (const { runs, sign } of [{ runs: "up", sign: 1 }, { runs: "down", sign: -1 }]) {
    const notes = practiceNotes(EIGHT_BARS, `scales-${runs}`, { rhythms: ["eighths"], breathEvery: 0 });
    for (let bar = 0; bar < 8; bar++) {
      const run = notes.filter((n) => Math.floor(n.start / 4) === bar).map((n) => n.midi);
      // One octave drop (or climb) back is allowed when the run reaches the edge of the range.
      const turns = run.slice(1).filter((m, i) => Math.sign(m - run[i]) !== sign);
      assert.ok(turns.length <= 1, `${runs} bar ${bar}: ${run}`);
    }
  }
});

test("runs: up-then-down climbs to the octave and back over eight notes", () => {
  // F major's chord tones here are 1 3 5 6: F A C D F' D C A.
  const arpeggio = practiceNotes([["F"]], "arpeggios-updown", { rhythms: ["eighths"], breathEvery: 0 }).map((n) => n.midi);
  assert.deepEqual(arpeggio, [65, 69, 72, 74, 77, 74, 72, 69]);
  const scale = practiceNotes([["F"]], SCALES_UPDOWN, { rhythms: ["eighths"], breathEvery: 0 }).map((n) => n.midi);
  assert.deepEqual(scale, [65, 67, 69, 70, 72, 70, 69, 67]);
});

test("runs: up-then-down with too few notes per chord goes up one bar, down the next", () => {
  const names = [["F"], ["F"], ["F"], ["F"]];
  for (const exercise of ["arpeggios-updown", SCALES_UPDOWN]) {
    const notes = practiceNotes(names, exercise, { rhythms: ["charleston"], breathEvery: 0 });
    [0, 1, 2, 3].forEach((bar) => {
      const [first, second] = notes.filter((n) => Math.floor(n.start / 4) === bar).map((n) => n.midi);
      if (bar % 2 === 0) {
        assert.equal(first, 65, `${exercise} bar ${bar} starts on the root`);
        assert.ok(second > first, `${exercise} bar ${bar} goes up`);
      } else {
        assert.equal(first, 77, `${exercise} bar ${bar} starts on the octave`);
        assert.ok(second < first, `${exercise} bar ${bar} comes down`);
      }
    });
  }
});

test("runs: a fixed shape stays within one octave of a root on the staff", () => {
  const names = [["F"], ["C7"], ["Bb"], ["G7"], ["Eb"], ["Ab"], ["D7"], ["A"]];
  for (const exercise of ["arpeggios", "scales"]) {
    for (const runs of ["up", "down", "updown"]) {
      const notes = practiceNotes(names, `${exercise}-${runs}`, { rhythms: ["eighths"], breathEvery: 0 });
      for (let bar = 0; bar < names.length; bar++) {
        const run = notes.filter((n) => Math.floor(n.start / 4) === bar).map((n) => n.midi);
        const low = Math.min(...run);
        assert.ok(Math.max(...run) - low <= 12, `${exercise} ${runs} bar ${bar}: ${run}`);
        assert.ok(low >= 57 && Math.max(...run) <= 80, `${exercise} ${runs} bar ${bar}: ${run}`);
      }
    }
  }
});

test("the Practice list offers each run in each shape, each set and each approach, read back from one value", () => {
  const values = PRACTICE_EXERCISES;
  assert.deepEqual(values, [
    "arpeggios", "arpeggios-up", "arpeggios-down", "arpeggios-updown", "arpeggios-thirds",
    "scales", "scales-up", "scales-down", SCALES_UPDOWN, SCALES_THIRDS,
    "arpeggios@1", "arpeggios-updown@135", "arpeggios-updown@13579", "arpeggios-updown@1356", GUIDE_TONES,
    "scales-updown@123", "scales-updown@12345", "scales-updown@penta", "scales-updown@blues",
    "enclosures-below", "enclosures-above", "enclosures",
  ]);
  for (const value of values) assert.ok(practiceNotes(EIGHT_BARS, value).length > 0, value);
  assert.deepEqual(practiceNotes(EIGHT_BARS, "kazoo-up"), []);
});

test("runs: always up jumps to the chord's root at every new chord, no voice leading", () => {
  const names = [["F"], ["C7"], ["Bb"], ["F", "C7"]];
  const roots = { F: 5, C7: 0, Bb: 10 };
  for (const exercise of ["arpeggios", "scales"]) {
    const notes = practiceNotes(names, `${exercise}-up`, { rhythms: ["eighths"] });
    names.forEach((row, bar) => {
      row.forEach((chord, i) => {
        const first = notes.find((n) => n.start === bar * 4 + i * (4 / row.length));
        assert.equal(mod12(first.midi), roots[chord], `${exercise} bar ${bar} ${chord}`);
        assert.ok(first.midi >= 57 && first.midi <= 68, "the root: A3 to G#4");
      });
    });
    // A run that runs out of room starts again from its root.
    const fBar = notes.filter((n) => n.start < 4).map((n) => n.midi);
    fBar.slice(1).forEach((m, i) => assert.ok(m > fBar[i] || m === fBar[0], `${exercise}: ${fBar}`));
  }
});

test("every 4th bar breathes: at least its last beat is a rest, nothing ties out of it", () => {
  assert.equal(rhythmSlots(4, new Set(), ["xxxxxxxx"], 4), "xxxxxxxx".repeat(3) + "xxxxxx..");
  // An anticipation into the breath bar still lands; none ties out of it.
  assert.equal(rhythmSlots(5, new Set(), ["xxxxxx.x>"], 4), "xxxxxx.x-xxxxx.x-xxxxx.x-xxxxx..xxxxxx.x");
  // A note held into the last beat is cut short there.
  assert.equal(rhythmSlots(4, new Set(), ["x--x--x-"], 4).slice(24), "x--x--..");
  for (const value of PRACTICE_EXERCISES) {
    const notes = practiceNotes(EIGHT_BARS, value, { rhythms: ["eighths"] });
    for (const bar of [3, 7]) {
      const end = bar * 4 + 4;
      assert.ok(notes.every((n) => n.start >= end || n.start + n.duration <= end - 1), `${value} bar ${bar}`);
    }
    // The other bars keep playing to the bar line.
    assert.ok(notes.some((n) => n.start + n.duration === 4), value);
  }
});

test("up-then-down turns its last note back towards the next chord, by a scale step", () => {
  // Bb into F7: ... F Eb D then Eb (not C), stepping up towards F.
  const intoF7 = practiceNotes([["Bb"], ["F7"]], SCALES_UPDOWN, { rhythms: ["eighths"], breathEvery: 0 });
  assert.deepEqual(intoF7.slice(0, 9).map((n) => n.midi), [58, 60, 62, 63, 65, 63, 62, 63, 65]);
  // Into the same chord again the run already steps onto its root: C stays.
  const again = practiceNotes([["Bb"], ["Bb"]], SCALES_UPDOWN, { rhythms: ["eighths"], breathEvery: 0 });
  assert.equal(again[7].midi, 60);
  // Always up / down keep going their way and jump; G (Bb's 6th) is put off
  // by an F# so it lands on beat 4, not on the "and".
  const up = practiceNotes([["Bb"], ["F7"]], "scales-up", { rhythms: ["eighths"], breathEvery: 0 });
  assert.deepEqual(up.slice(0, 8).map((n) => n.midi), [58, 60, 62, 63, 65, 66, 67, 69]);
});

// Whether a bar's rhythm is syncopated: a note on an "and" whose next beat
// isn't played — left silent, or the note held or tied over it (a trailing
// ">" ties the last "and" over the bar line).
function syncopated(cell) {
  return cell.split("").some((mark, i) => mark === "x" && i % 2 === 1 && cell[i + 1] !== "x");
}

// The syncopated run patterns, ticked together.
const SYNC = PRACTICE_RHYTHMS.filter((r) => r.sync && r.run).map((r) => r.value);

test("several ticked rhythms take turns; the syncopated ones are all syncopated", () => {
  for (const value of PRACTICE_EXERCISES) {
    const notes = practiceNotes(EIGHT_BARS, value, { rhythms: SYNC, breathEvery: 0 });
    assert.ok(notes.length > 0, value);
    // Never a bar of plain on-the-beat eighths.
    assert.ok(!barRhythms(notes, 8).includes("0:1 1:1 2:1 3:1 4:1 5:1 6:1 7:1"), value);
  }
  for (const rhythm of PRACTICE_RHYTHMS.filter((r) => r.sync)) {
    assert.ok(syncopated(rhythm.cell), rhythm.value);
  }
  // All six of its patterns come round, two bars at a time (a bar after an
  // anticipation opens with the tied-over note, so it reads differently).
  const bars = barRhythms(practiceNotes(Array.from({ length: 12 }, () => ["F"]), "scales", { rhythms: SYNC, breathEvery: 0 }), 12);
  assert.ok(new Set(bars).size >= 6, bars.join(" | "));
  assert.equal(bars[0], bars[1]);
});

test("with nothing ticked an exercise plays its own set; ticked ones play in pattern order", () => {
  const twelve = Array.from({ length: 12 }, () => ["F"]);
  assert.deepEqual(practiceDefaultRhythms("scales"), PRACTICE_RHYTHMS.filter((r) => r.run).map((r) => r.value));
  assert.deepEqual(practiceDefaultRhythms("guide"), PRACTICE_RHYTHMS.filter((r) => r.long).map((r) => r.value));
  assert.deepEqual(practiceDefaultRhythms(GUIDE_TONES), practiceDefaultRhythms("guide"));
  assert.deepEqual(practiceDefaultRhythms("arpeggios@1"), practiceDefaultRhythms("scales"));
  assert.deepEqual(practiceDefaultRhythms("nope"), []);
  assert.deepEqual(
    practiceNotes(twelve, "scales", { rhythms: null, breathEvery: 0 }),
    practiceNotes(twelve, "scales", { rhythms: practiceDefaultRhythms("scales"), breathEvery: 0 }),
  );
  assert.deepEqual(
    practiceNotes(twelve, "scales", { rhythms: ["pushes", "charleston"], breathEvery: 0 }),
    practiceNotes(twelve, "scales", { rhythms: ["charleston", "pushes"], breathEvery: 0 }),
  );
});

test("Pushes on the \"and\": the and of 2 held over beat 3, the and of 4 tied over the bar", () => {
  const pushes = PRACTICE_RHYTHMS.find((r) => r.value === "pushes");
  assert.equal(pushes.cell, "xx.x--.x>");
  const notes = practiceNotes([["F"], ["F"]], "scales", { rhythms: ["pushes"], breathEvery: 0 });
  assert.deepEqual(notes.slice(0, 4).map((n) => [n.start, n.duration]), [[0, 0.5], [0.5, 0.5], [1.5, 1.5], [3.5, 1]]);
});

test("an exercise value reads back as kind, variant and note set, and writes back the same", () => {
  assert.deepEqual(PRACTICE_KINDS.map((k) => k.value), ["arpeggios", "scales", "enclosures"]);
  assert.deepEqual(PRACTICE_SHAPES.map((s) => s.value), ["alternate", "up", "down", "updown", "thirds"]);
  assert.deepEqual(parseExercise("arpeggios-down"), { kind: "arpeggios", variant: "down", degrees: [1, 3, 5, 7] });
  assert.deepEqual(parseExercise("scales"), { kind: "scales", variant: "alternate", degrees: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.deepEqual(parseExercise("scales-up@12345"), { kind: "scales", variant: "up", degrees: [1, 2, 3, 4, 5] });
  assert.deepEqual(parseExercise("enclosures"), { kind: "enclosures", variant: "enclose", degrees: null });
  assert.deepEqual(parseExercise("enclosures-below"), { kind: "enclosures", variant: "below", degrees: null });
  for (const bad of ["kazoo", "scales-sideways", "arpeggios@2", "arpeggios@", "scales@11", "scales@19", "enclosures-up", "enclosures@1", "scales-up-down"]) {
    assert.equal(parseExercise(bad), null, bad);
  }
  for (const value of PRACTICE_EXERCISES) assert.equal(formatExercise(parseExercise(value)), value);
  // The default set and the voice-led shape are left out; so is a shape
  // that a set of one note or guide tones can't take.
  assert.equal(formatExercise({ kind: "scales", variant: "updown", degrees: [1, 2, 3, 4, 5, 6, 7, 8] }), SCALES_UPDOWN);
  assert.equal(formatExercise({ kind: "arpeggios", variant: "up", degrees: [3, 7] }), GUIDE_TONES);
  assert.equal(formatExercise({ kind: "arpeggios", variant: "up", degrees: [5] }), "arpeggios@5");
  assert.equal(formatExercise({ kind: "enclosures", variant: "enclose" }), "enclosures");
  assert.ok(exerciseTakesShape(parseExercise("arpeggios@135")));
  assert.ok(!exerciseTakesShape(parseExercise(GUIDE_TONES)));
  assert.ok(!exerciseTakesShape(parseExercise("scales@1")));
  assert.ok(!exerciseTakesShape(parseExercise("enclosures")));
});

test("the old guide tones and one-note exercises carry over as note sets", () => {
  assert.equal(formatExercise(parseExercise("guide")), GUIDE_TONES);
  assert.equal(formatExercise(parseExercise("rhythm")), "arpeggios@1");
  assert.deepEqual(practiceNotes(EIGHT_BARS, "guide"), practiceNotes(EIGHT_BARS, GUIDE_TONES));
  assert.ok(isPracticeSetting("off") && isPracticeSetting("guide") && isPracticeSetting("scales@135"));
  assert.ok(!isPracticeSetting("kazoo") && !isPracticeSetting(null));
});

test("every preset is a set the summary names; a card's set reads back as that preset", () => {
  for (const kind of ["arpeggios", "scales"]) {
    for (const set of PRACTICE_NOTE_SETS[kind]) {
      assert.equal(practiceNoteSet(kind, set.degrees, set.named ? set.value : null), set, `${kind} ${set.value}`);
      const value = formatExercise({
        kind, variant: "alternate", degrees: set.degrees, named: set.named ? set.value : null,
      });
      assert.ok(practiceSummary(value, null).startsWith(set.name), value);
    }
  }
  assert.equal(practiceNoteSet("arpeggios", [1, 7]), undefined);
});

// The chromas each chord of a run plays, by bar.
function chromasByBar(notes, bars) {
  return Array.from({ length: bars }, (_, bar) => new Set(notes
    .filter((n) => Math.floor(n.start / 4) === bar).map((n) => mod12(n.midi))));
}

test("a chord-tone set plays only its own degrees of each chord", () => {
  const names = [["F"], ["C7"], ["F"], ["C7"]];
  const expect = {
    "arpeggios-up@135": [[5, 9, 0], [0, 4, 7]],
    "arpeggios-up@13579": [[5, 9, 0, 2, 7], [0, 4, 7, 10, 2]],
    // A plain F's 7th is the 6th it's heard with (F A C D); C7's is Bb.
    "arpeggios-up": [[5, 9, 0, 2], [0, 4, 7, 10]],
  };
  for (const [value, [overF, overC7]] of Object.entries(expect)) {
    const bars = chromasByBar(practiceNotes(names, value, { rhythms: ["eighths"], breathEvery: 0 }), 4);
    assert.deepEqual([...bars[0]].sort((a, b) => a - b), [...overF].sort((a, b) => a - b), `${value} over F`);
    assert.deepEqual([...bars[1]].sort((a, b) => a - b), [...overC7].sort((a, b) => a - b), `${value} over C7`);
  }
});

test("Root alone holds each chord's root for the rhythm", () => {
  const notes = practiceNotes([["F"], ["C7"], ["Bb"], ["F"]], "arpeggios@1", { rhythms: ["charleston"], breathEvery: 0 });
  [5, 0, 10, 5].forEach((root, bar) => {
    const run = notes.filter((n) => Math.floor(n.start / 4) === bar).map((n) => n.midi);
    assert.ok(run.every((m) => m === run[0] && mod12(m) === root), `bar ${bar}: ${run}`);
  });
});

// One bar of F in eighths, as MIDI notes.
const runOverF = (value) => practiceNotes([["F"]], value, { rhythms: ["eighths"], breathEvery: 0 }).map((n) => n.midi);

test("runs in thirds: 1 3 2 4 3 5 … from each chord's root", () => {
  // F A G Bb A C Bb D.
  assert.deepEqual(runOverF(SCALES_THIRDS), [65, 69, 67, 70, 69, 72, 70, 74]);
  // F's chord tones 1 3 5 6 1': F C A D C F', then back down C D.
  assert.deepEqual(runOverF("arpeggios-thirds"), [65, 72, 69, 74, 72, 77, 72, 74]);
  // A new chord starts again from its own root.
  const notes = practiceNotes([["F"], ["C7"]], SCALES_THIRDS, { rhythms: ["eighths"], breathEvery: 0 });
  assert.equal(mod12(notes.find((n) => n.start === 4).midi), 0);
});

test("runs in thirds over three notes play all three", () => {
  // F G A: F A G, then A F G.
  assert.deepEqual(runOverF("scales-thirds@123"), [65, 69, 67, 69, 65, 67, 65, 69]);
});

test("runs in thirds turn round at the top of the set", () => {
  // F G A Bb C: F A G Bb A C, then the same mirrored down, C A Bb G A F,
  // without playing the C twice.
  assert.deepEqual(runOverF("scales-thirds@12345"), [65, 69, 67, 70, 69, 72, 69, 70]);
});

test("the phrase rhythms are tick-only: four eighths into a held note, a rest on one", () => {
  const target = practiceNotes([["F"]], "scales", { rhythms: ["target"], breathEvery: 0 });
  assert.deepEqual(target.map((n) => n.duration), [0.5, 0.5, 0.5, 0.5, 2]);
  const restOne = practiceNotes([["F"]], "scales", { rhythms: ["restone"], breathEvery: 0 });
  assert.equal(restOne[0].start, 0.5);
  assert.equal(restOne.length, 7);
  for (const exercise of ["scales", GUIDE_TONES]) {
    const own = practiceDefaultRhythms(exercise);
    assert.ok(!own.includes("target"), exercise);
    assert.ok(!own.includes("restone"), exercise);
  }
});

test("scale sets: the first 3 or 5 notes, up and back or up and again", () => {
  // F G A G F G A G: up to the 3rd and back.
  assert.deepEqual(runOverF("scales-updown@123"), [65, 67, 69, 67, 65, 67, 69, 67]);
  // F G A Bb C, then again from F.
  assert.deepEqual(runOverF("scales-up@12345"), [65, 67, 69, 70, 72, 65, 67, 69]);
});

// One chord's pentatonic, as semitones above its root.
function pentatonicOf(chord) {
  const notes = practiceNotes([[chord]], "scales-up@penta", { rhythms: ["eighths"], breathEvery: 0 });
  return [...new Set(notes.map((n) => n.midi - notes[0].midi))].filter((s) => s < 12);
}

test("the pentatonic scale: major over a major chord, minor over a minor one", () => {
  assert.deepEqual(pentatonicOf("C7"), [0, 2, 4, 7, 9]);
  assert.deepEqual(pentatonicOf("Cmaj7"), [0, 2, 4, 7, 9]);
  assert.deepEqual(pentatonicOf("Dm7"), [0, 3, 5, 7, 10]);
  // The chord's own 5th: a half-diminished chord's b5.
  assert.deepEqual(pentatonicOf("Bm7b5"), [0, 3, 5, 6, 10]);
  assert.deepEqual(parseExercise("scales-thirds@penta"), {
    kind: "scales", degrees: [1, 2, 3, 5, 6, 8], variant: "thirds", named: "penta",
  });
  assert.equal(parseExercise("arpeggios@penta"), null, "only a scale");
  assert.equal(practiceSummary("scales-up@penta", null), "Pentatonic scale, Up · Varied rhythm");
  assert.equal(practiceNoteSet("scales", [1, 2, 3, 5, 6, 8]), undefined, "a custom set with the same degrees isn't the pentatonic");
});

test("the blues scale plays the key's 1 b3 4 #4 5 b7 through every chord", () => {
  // An F blues: over F7, Bb7 and C7 alike, F Ab Bb B C Eb.
  const notes = practiceNotes([["F7"], ["Bb7"], ["C7"], ["F7"]], BLUES_UP, { rhythms: ["eighths"], breathEvery: 0, tonic: 5 });
  assert.deepEqual([...new Set(notes.map((n) => mod12(n.midi)))].sort((a, b) => a - b), [0, 3, 5, 8, 10, 11]);
  // Always up: every chord starts again on the key's F.
  [0, 1, 2, 3].forEach((bar) => assert.equal(mod12(notes.find((n) => n.start === bar * 4).midi), 5, `bar ${bar}`));
  // No key: each chord's own blues scale.
  const own = practiceNotes([["C7"]], BLUES_UP, { rhythms: ["eighths"], breathEvery: 0 }).map((n) => mod12(n.midi));
  assert.deepEqual(own.slice(0, 6), [0, 3, 5, 6, 7, 10]);
  assert.deepEqual(parseExercise("scales-down@blues"), {
    kind: "scales", degrees: [1, 3, 4, 5, 7, 8], variant: "down", named: "blues",
  });
  assert.equal(parseExercise("arpeggios@blues"), null, "only a scale");
  assert.ok(exerciseTakesShape(parseExercise("scales@blues")));
  assert.equal(practiceSummary("scales-updown@blues", null), "Blues scale, Up & down · Varied rhythm");
  assert.equal(practiceNoteSet("scales", [1, 3, 4, 5, 7, 8]), undefined, "a custom set with the same degrees isn't the blues scale");
});

test("approach from below or above: one note leads into the target", () => {
  for (const { style, offset } of [{ style: "below", offset: -1 }, { style: "above" }]) {
    const notes = practiceNotes([["F"], ["C7"]], `enclosures-${style}`, { rhythms: ["eighths"], breathEvery: 0 });
    const bar = notes.filter((n) => n.start >= 4);
    // The target: a chord tone on a beat, with its one approach note before it.
    const at = bar.findIndex((n) => C7_CHORD_TONES.has(mod12(n.midi)) && n.start % 1 === 0 && n.start > 4);
    const [lead, target] = [bar[at - 1], bar[at]];
    if (offset === -1) assert.equal(lead.midi, target.midi - 1, style);
    else assert.ok(lead.midi > target.midi && lead.midi - target.midi <= 2, style);
  }
  assert.deepEqual(PRACTICE_APPROACHES.map((a) => a.value), ["below", "above", "enclose"]);
});

test("practiceSummaryParts: the exercise and its rhythm apart, for a phone to stack", () => {
  assert.equal(practiceSummaryParts("off", null), null);
  assert.deepEqual(practiceSummaryParts(SCALES_UPDOWN, ["halfanticipate"]), {
    exercise: "Scale runs, Up & down", rhythm: "Half note, anticipate",
  });
});

test("practiceSummary: one line for the closed control", () => {
  assert.equal(practiceSummary("off", null), "Off");
  assert.equal(practiceSummary(SCALES_UPDOWN, SYNC), `Scale runs, Up & down · ${SYNC.length} rhythms`);
  assert.equal(practiceSummary("arpeggios", ["charleston"]), "7th chords, Voice-led · Charleston");
  assert.equal(practiceSummary("guide", null), "Guide tones · Varied rhythm");
  assert.equal(practiceSummary("arpeggios-up@1", null), "Roots · Varied rhythm");
  assert.equal(practiceSummary("arpeggios-up@359", null), "Chord tones: 3rd, 5th, 9th, Up · Varied rhythm");
  assert.equal(practiceSummary("scales-down@1235", null), "Scale: Root, 2nd, 3rd, 5th, Down · Varied rhythm");
  assert.equal(practiceSummary("enclosures-below", null), "Approach from below · Varied rhythm");
  assert.equal(practiceSummary("kazoo", null), "Off");
});
