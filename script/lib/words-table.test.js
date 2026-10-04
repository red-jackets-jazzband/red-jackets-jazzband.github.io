import test from "node:test";
import assert from "node:assert/strict";
import { extractWordsTables, extractPartOrderRows, parseFormStep, transposeTable } from "./words-table.js";

test("extractWordsTables pulls a header table out and leaves other lines", () => {
  const src = "T:x\nW:intro text\nW:| # | Section |\nW:|---|---|\nW:| 1 | Intro |\nK:C\nCDEF|";
  const { abcText, tables } = extractWordsTables(src);
  assert.equal(abcText, "T:x\nW:intro text\nK:C\nCDEF|");
  assert.deepEqual(tables, [{ header: ["#", "Section"], rows: [["1", "Intro"]] }]);
});

test("extractWordsTables keeps empty cells and handles a headerless table", () => {
  const { tables } = extractWordsTables("W:| 3 | Vocals | |\nW:| 4 | Solos | x |");
  assert.deepEqual(tables[0].header, null);
  assert.deepEqual(tables[0].rows, [["3", "Vocals", ""], ["4", "Solos", "x"]]);
});

test("extractWordsTables returns no tables when there are none", () => {
  const src = "W:Form:\nW:1. Intro";
  assert.deepEqual(extractWordsTables(src), { abcText: src, tables: [] });
});

test("transposeTable turns columns into labelled rows", () => {
  const table = { header: ["#", "Section"], rows: [["1", "Intro"], ["2", "Vocals"]] };
  assert.deepEqual(transposeTable(table), {
    labels: ["#", "Section"],
    rows: [["1", "2"], ["Intro", "Vocals"]],
  });
});

test("transposeTable pads ragged rows and has no labels without a header", () => {
  assert.deepEqual(transposeTable({ header: null, rows: [["a", "b"], ["c"]] }), {
    labels: null,
    rows: [["a", "c"], ["b", ""]],
  });
});

test("parseFormStep splits the lead, the additions and the asides", () => {
  assert.deepEqual(parseFormStep(["2", "A", "collective; + trombone fills; no repeat"]), {
    number: "2",
    part: "A",
    repeat: "",
    lead: "collective",
    adds: ["trombone fills"],
    notes: ["no repeat"],
  });
  assert.deepEqual(parseFormStep(["3", "Vocals"]), { number: "3", part: "", repeat: "", lead: "Vocals", adds: [], notes: [] });
});

test("parseFormStep moves a trailing repeat note out of the part", () => {
  assert.deepEqual(parseFormStep(["2", "Verse 2x", "collective"]).repeat, "2x");
  assert.deepEqual(parseFormStep(["2", "Verse 2x", "collective"]).part, "Verse");
  assert.deepEqual(parseFormStep(["4", "A no repeat", "collective"]).part, "A");
  assert.deepEqual(parseFormStep(["4", "A no repeat", "collective"]).repeat, "no repeat");
  assert.equal(parseFormStep(["5", "B B B", "x"]).part, "B B B");
});

test("parseFormStep moves a trailing count on the lead text into the repeat", () => {
  assert.deepEqual(parseFormStep(["1", "Collective 2x"]), { number: "1", part: "", repeat: "2x", lead: "Collective", adds: [], notes: [] });
  assert.equal(parseFormStep(["2", "A", "solos 1x; riff"]).repeat, "1x");
  assert.equal(parseFormStep(["2", "Verse 2x", "collective 1x"]).lead, "collective 1x");
});

test("extractPartOrderRows reads the header P: order, not a part marker after K:", () => {
  assert.deepEqual(extractPartOrderRows("X:1\nP:Intro A B\nK:C\nP:A\nCDEF|"), [["1", "Intro", ""], ["2", "A", ""], ["3", "B", ""]]);
  assert.equal(extractPartOrderRows("X:1\nK:C\nP:A B\nCDEF|"), null);
  assert.equal(extractPartOrderRows("X:1\nP:A\nK:C\nCDEF|"), null);
});
