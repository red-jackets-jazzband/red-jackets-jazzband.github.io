import { test } from "node:test";
import assert from "node:assert/strict";
import { stripHistory, historyParagraphs } from "./history.js";

test("stripHistory removes every H: line and keeps the rest", () => {
  const text = "X:1\nT:Tune\nH:First.\nH:Second.\nW:H: stays\nK:C\nC|";
  assert.equal(stripHistory(text), "X:1\nT:Tune\nW:H: stays\nK:C\nC|");
});

test("stripHistory leaves a tune without history untouched", () => {
  const text = "X:1\nT:Tune\nK:C\nC|";
  assert.equal(stripHistory(text), text);
});

test("historyParagraphs splits abcjs's joined H: lines", () => {
  assert.deepEqual(historyParagraphs("First.\n Second. \n\n"), ["First.", "Second."]);
});

test("historyParagraphs is empty when there is no history", () => {
  assert.deepEqual(historyParagraphs(undefined), []);
  assert.deepEqual(historyParagraphs(""), []);
});
