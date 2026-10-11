import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import { clefName, noteMidi, topNote, walkMelody } from "./melody-walk.js";

const C_HEADER = "M:4/4\nL:1/4\nK:C";
const parse = (body, header = C_HEADER) => ABCJS.parseOnly(`X:1\n${header}\n${body}\n`)[0];

// Every note-or-rest of the first voice as { midi | null, el }.
function printed(body, header) {
  const out = [];
  walkMelody(parse(body, header), (el, state) => {
    if (el.el_type !== "note") return;
    const top = topNote(el, state);
    out.push({ midi: top === null ? null : top.midi, el });
  });
  return out;
}
const midis = (body, header) => printed(body, header).map((n) => n.midi);

test("treble clef: middle C is 60 and the octave marks move it by twelve", () => {
  assert.deepEqual(midis("C D E F G A B c d C, c'"), [60, 62, 64, 65, 67, 69, 71, 72, 74, 48, 84]);
});

test("the key signature alters every note of that letter", () => {
  assert.deepEqual(midis("B E A", "M:4/4\nL:1/4\nK:Bb"), [70, 63, 69], "B♭ and E♭, A natural");
  assert.deepEqual(midis("F C G", "M:4/4\nL:1/4\nK:D"), [66, 61, 67]);
});

test("an accidental lasts to the bar line, on that octave only, then the key returns", () => {
  assert.deepEqual(midis("^F F f | F", C_HEADER), [66, 66, 77, 65], "F# F# (still sharp) f natural (other octave) F (next bar)");
  assert.deepEqual(midis("_B =B B", C_HEADER), [70, 71, 71]);
});

test("bass clef keeps a note's pitch by its letter name", () => {
  assert.deepEqual(midis("C G c", "M:4/4\nL:1/4\nK:C clef=bass"), [60, 67, 72]);
});

test("clef=bass middle=D (how the sheet writes low brass) prints the same letters an octave down", () => {
  assert.deepEqual(midis("C G c", "M:4/4\nL:1/4\nK:C clef=bass middle=D"), [48, 55, 60]);
});

test("a rest has no printed note", () => {
  assert.deepEqual(midis("C z E"), [60, null, 64]);
});

test("a chord's printed note is its top one", () => {
  assert.deepEqual(midis("[CEG]"), [67]);
});

test("noteMidi: a clef without pitches has no chart", () => {
  assert.equal(noteMidi({ verticalPos: 0 }, "perc", new Map(), new Map()), null);
  assert.equal(noteMidi({ verticalPos: 0 }, "none", new Map(), new Map()), null);
});

test("C clefs and octave clefs are read where they're drawn", () => {
  // Middle C written in each clef (abcjs draws it at a different height).
  assert.deepEqual(midis("C c", "M:4/4\nL:1/4\nK:C clef=alto"), [60, 72]);
  assert.deepEqual(midis("C c", "M:4/4\nL:1/4\nK:C clef=tenor"), [60, 72]);
  assert.deepEqual(midis("C c", "M:4/4\nL:1/4\nK:C clef=bass3"), [60, 72]);
  assert.deepEqual(midis("C c", "M:4/4\nL:1/4\nK:C clef=alto1"), [60, 72]);
  // An octave clef is printed like its plain one.
  assert.deepEqual(midis("C c", "M:4/4\nL:1/4\nK:C clef=treble-8"), [60, 72]);
  assert.deepEqual(midis("C c", "M:4/4\nL:1/4\nK:C clef=bass-8"), [60, 72]);
});

test("clefName names the clef by family and line", () => {
  assert.equal(clefName({ type: "treble", clefPos: 4 }), "treble");
  assert.equal(clefName({ type: "treble+8", clefPos: 4 }), "treble");
  assert.equal(clefName({ type: "alto", clefPos: 6 }), "alto");
  assert.equal(clefName({ type: "alto", clefPos: 8 }), "tenor");
  assert.equal(clefName({ type: "bass", clefPos: 6 }), "bass3");
  assert.equal(clefName({ type: "perc" }), "perc");
  assert.equal(clefName(undefined), "treble");
});

test("walkMelody hands over the key in force, which a mid-tune K: changes", () => {
  const song = parse("C F |\nK:Bb\nB F", C_HEADER);
  const seen = [];
  walkMelody(song, (el, state) => {
    if (el.el_type === "note") seen.push(state.key.accidentals.length);
  });
  assert.deepEqual(seen, [0, 0, 2, 2]);
});

test("walkMelody hands over the clef in force, which a mid-tune clef change alters", () => {
  const song = parse("C |\n[K:C clef=bass]\nC [K:clef=tenor] C", C_HEADER);
  const clefs = [];
  walkMelody(song, (el, state) => {
    if (el.el_type === "note") clefs.push(state.clef);
  });
  assert.deepEqual(clefs, ["treble", "bass", "tenor"]);
});

test("walkMelody forgets a bar's accidentals at the bar line", () => {
  const song = parse("^F F | F", C_HEADER);
  const sizes = [];
  walkMelody(song, (el, state) => {
    if (el.el_type === "note") {
      topNote(el, state);
      sizes.push(state.barAccidentals.size);
    }
  });
  assert.deepEqual(sizes, [1, 1, 0]);
});

test("a bar that runs over a line break keeps its accidentals", () => {
  // The bar has no bar line at the break, so the F# is still in force.
  assert.deepEqual(midis("^F A B\nF C D |", C_HEADER).slice(0, 4), [66, 69, 71, 66]);
});

test("a bar line at a line break does reset them", () => {
  assert.deepEqual(midis("^F A B |\nF C D |", C_HEADER).slice(0, 4), [66, 69, 71, 65]);
});

test("a key change's cancelling naturals don't override the new key's own accidentals", () => {
  // G after Eb carries ♮B ♮E ♮A; transposed down a semitone it's F# major,
  // and abcjs leaves those naturals unmoved, so ♮A must not erase its A#.
  const text = "X:1\nM:4/4\nL:1/4\nK:Eb\nE F G A|\nK:G\nB A G F|\n";
  const song = ABCJS.parseOnly(text, { visualTranspose: -1 })[0];
  const out = [];
  walkMelody(song, (el, state) => {
    const top = topNote(el, state);
    if (top !== null) out.push(top.midi);
  });
  assert.deepEqual(out.slice(4), [70, 68, 66, 65], "A# G# F# E# in F# major");
});

test("topNote reports the printed letter", () => {
  const letters = [];
  walkMelody(parse("C ^F _B c", "M:4/4\nL:1/4\nK:C clef=bass middle=D"), (el, state) => {
    const top = topNote(el, state);
    if (top !== null) letters.push(top.letter);
  });
  assert.deepEqual(letters, ["C", "F", "B", "C"]);
});
