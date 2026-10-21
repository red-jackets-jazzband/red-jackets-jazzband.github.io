import { test } from "node:test";
import assert from "node:assert/strict";
import { extractWordsTables } from "./words-table.js";
import {
  MORE, addPart, addRound, deleteRound, duplicateRound, formText, movePart, moveRound,
  addTypedParts, parseTypedParts, partChoices, readStoredForm, removePart, removeRepeat,
  roundsFromTables, sameForm, sameRound, setRepeat, setText, writeStoredForm,
} from "./song-form.js";

const WOMAN = [
  "X:1",
  "T:I've got a woman",
  "W:| 1 | A B | Collective; count-off: 3 tempo ticks |",
  "W:| 2 | A B A B | Vocals; 1st: riff \"I gotta woman\" from the start; 2nd: no riff |",
  "W:| 3 | A B | Clarinet solo |",
  "K:C",
  "P:A",
  "C4 |",
  "P:B",
  "D4 |]",
].join("\n");

const band = () => roundsFromTables(extractWordsTables(WOMAN).tables);
const leads = (rounds) => rounds.map((round) => round.lead);

test("a form table reads as rounds of parts, what plays and a note", () => {
  assert.deepEqual(band()[1], {
    parts: ["A", "B", "A", "B"],
    repeat: "",
    lead: "Vocals",
    note: "1st: riff \"I gotta woman\" from the start; 2nd: no riff",
  });
});

test("the rounds write back to exactly the W: lines they came from", () => {
  const lines = WOMAN.split("\n").filter((line) => line.startsWith("W:|")).join("\n");
  assert.equal(formText(band()), lines);
});

test("a repeat count and +instrument asides survive the round trip", () => {
  const rounds = roundsFromTables([{ header: null, rows: [["4", "AABA 2x", "Solos; +Banjo; no riff"]] }]);
  assert.deepEqual(rounds[0], { parts: ["AABA"], repeat: "2x", lead: "Solos", note: "+Banjo; no riff" });
  assert.equal(formText(rounds), "W:| 1 | AABA 2x | Solos; +Banjo; no riff |");
});

test("a two-column row gets an empty part cell", () => {
  const rounds = roundsFromTables([{ header: null, rows: [["1", "intro; drums count off"]] }]);
  assert.equal(formText(rounds), "W:| 1 |  | intro; drums count off |");
});

test("typed text can't break the table with a |", () => {
  const rounds = setText(band(), 2, "note", "a | b");
  assert.equal(formText(rounds).split("\n")[2], "W:| 3 | A B | Clarinet solo; a / b |");
});

test("the part choices are the tune's P: parts, then other names the form uses", () => {
  const rounds = roundsFromTables([{ header: null, rows: [["1", "Intro", "x"], ["2", "A B ...", "y"]] }]);
  assert.deepEqual(partChoices(WOMAN, rounds), ["A", "B", "Intro"]);
  assert.deepEqual(partChoices("K:C\nC4|", []), []);
});

test("a part is added at the end, but before a ...", () => {
  let rounds = addPart(band(), 2, MORE);
  assert.deepEqual(rounds[2].parts, ["A", "B", MORE]);
  rounds = addPart(rounds, 2, "A");
  assert.deepEqual(rounds[2].parts, ["A", "B", "A", MORE]);
  rounds = addPart(rounds, 2, MORE);
  assert.deepEqual(rounds[2].parts, ["A", "B", "A", MORE]);
});

test("removing a part or a repeat count leaves the rest", () => {
  const rounds = removePart(band(), 1, 0);
  assert.deepEqual(rounds[1].parts, ["B", "A", "B"]);
  const counted = roundsFromTables([{ header: null, rows: [["1", "A 2x", "x"]] }]);
  assert.equal(removeRepeat(counted, 0)[0].repeat, "");
});

test("edits return a new list and leave the old one alone", () => {
  const before = band();
  const after = addPart(before, 0, "A");
  assert.deepEqual(before[0].parts, ["A", "B"]);
  assert.deepEqual(after[0].parts, ["A", "B", "A"]);
});

test("a part dragged within its round takes the target's place", () => {
  assert.deepEqual(movePart(band(), { round: 0, part: 0 }, 0, 1)[0].parts, ["B", "A"]);
  assert.deepEqual(movePart(band(), { round: 0, part: 1 }, 0, 0)[0].parts, ["B", "A"]);
});

test("a part dragged onto another round goes there", () => {
  const rounds = movePart(band(), { round: 0, part: 1 }, 2, null);
  assert.deepEqual(rounds[0].parts, ["A"]);
  assert.deepEqual(rounds[2].parts, ["A", "B", "B"]);
});

test("a ... stays last, and a round never gets two", () => {
  let rounds = addPart(band(), 0, MORE);
  rounds = movePart(rounds, { round: 0, part: 2 }, 0, 0);
  assert.deepEqual(rounds[0].parts, ["A", "B", MORE]);
  rounds = addPart(rounds, 2, MORE);
  const moved = movePart(rounds, { round: 0, part: 2 }, 2, 0);
  assert.equal(moved, rounds);
});

test("rounds move, duplicate, delete and get added", () => {
  assert.deepEqual(leads(moveRound(band(), 0, 2)), ["Vocals", "Clarinet solo", "Collective"]);
  assert.deepEqual(leads(moveRound(band(), 2, 0)), ["Clarinet solo", "Collective", "Vocals"]);
  assert.deepEqual(leads(duplicateRound(band(), 0)), ["Collective", "Collective", "Vocals", "Clarinet solo"]);
  assert.deepEqual(leads(deleteRound(band(), 1)), ["Collective", "Clarinet solo"]);
  const added = addRound(band(), ["A", "B"]);
  assert.deepEqual(added[3], { parts: ["A", "B"], repeat: "", lead: "", note: "" });
});

test("rounds compare by what they write out", () => {
  const rounds = band();
  assert.equal(sameForm(rounds, band()), true);
  assert.equal(sameRound(rounds[0], { ...rounds[0], lead: " Collective " }), true);
  assert.equal(sameForm(rounds, setText(rounds, 0, "lead", "Tutti")), false);
  assert.equal(sameRound(rounds[0], undefined), false);
});

test("a stored form reads back, and anything unreadable is null", () => {
  const stored = writeStoredForm(band(), "mine");
  const read = readStoredForm(stored);
  assert.equal(read.show, "mine");
  assert.equal(sameForm(read.rounds, band()), true);
  assert.equal(readStoredForm(writeStoredForm(band(), "band")).show, "band");
  assert.equal(readStoredForm(null), null);
  assert.equal(readStoredForm("{oops"), null);
  assert.equal(readStoredForm("{\"rows\":3}"), null);
});

test("typed parts: a form a reader says, names, ... and a count", () => {
  assert.deepEqual(parseTypedParts("AABA"), { parts: ["A", "A", "B", "A"], repeat: null });
  assert.deepEqual(parseTypedParts("aaba"), { parts: ["A", "A", "B", "A"], repeat: null });
  assert.deepEqual(parseTypedParts("A A B A 2x"), { parts: ["A", "A", "B", "A"], repeat: "2x" });
  assert.deepEqual(parseTypedParts("Intro, Head …"), { parts: ["Intro", "Head", MORE], repeat: null });
  assert.deepEqual(parseTypedParts("Bad 1x"), { parts: ["Bad"], repeat: "" });
  assert.deepEqual(parseTypedParts("A|B"), { parts: ["A", "B"], repeat: null });
  // Tabs and no-break spaces separate too; a trailing ... or … is its own part.
  assert.deepEqual(parseTypedParts("A\tB\u00a0C"), { parts: ["A", "B", "C"], repeat: null });
  assert.deepEqual(parseTypedParts("Solos... aab…"), { parts: ["Solos", MORE, "A", "A", "B", MORE], repeat: null });
  assert.deepEqual(parseTypedParts("Riff...out"), { parts: ["Riff...out"], repeat: null });
});

test("typed parts go into a round, before its ..., and a count sets its repeat", () => {
  const rounds = addPart(band(), 0, MORE);
  const next = addTypedParts(rounds, 0, "aaba 3x");
  assert.deepEqual(next[0].parts, ["A", "B", "A", "A", "B", "A", MORE]);
  assert.equal(next[0].repeat, "3x");
  assert.equal(formText(next).split("\n")[0], "W:| 1 | A B A A B A ... 3x | Collective; count-off: 3 tempo ticks |");
  assert.equal(roundsFromTables(extractWordsTables(formText(next)).tables)[0].repeat, "3x");
});

test("a repeat count is set and cleared", () => {
  const twice = setRepeat(band(), 2, "2x");
  assert.equal(twice[2].repeat, "2x");
  assert.equal(setRepeat(twice, 2, "")[2].repeat, "");
});
