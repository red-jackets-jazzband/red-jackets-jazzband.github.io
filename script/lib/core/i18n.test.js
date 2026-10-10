import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { tl, listOf, setMessages, resetMessages, pageLanguage } from "./i18n.js";

beforeEach(() => resetMessages());

test("tl() returns the English fallback when there is no table", () => {
  setMessages({}, "en");
  assert.equal(tl("save", "Save"), "Save");
});

test("tl() prefers the translation and fills placeholders", () => {
  setMessages({ js_done: "{done} van {total} klaar" }, "nl");
  assert.equal(tl("done", "{done} of {total} ready", { done: 2, total: 5 }), "2 van 5 klaar");
});

test("tl() fills placeholders in the English fallback too, and keeps unknown ones", () => {
  setMessages({}, "en");
  assert.equal(tl("n", "Set {n} of {m}", { n: 3 }), "Set 3 of {m}");
});

test("an empty or non-string translation falls back to English", () => {
  setMessages({ js_a: "", js_b: 4 }, "de");
  assert.equal(tl("a", "A"), "A");
  assert.equal(tl("b", "B"), "B");
});

test("pageLanguage() reports the table's language", () => {
  setMessages({}, "fr");
  assert.equal(pageLanguage(), "fr");
});

test("listOf() joins names with the language's own conjunction", () => {
  setMessages({}, "en");
  assert.equal(listOf(["A"], "and"), "A");
  assert.equal(listOf(["A", "B", "C"], "and"), "A, B and C");
  assert.equal(listOf(["A", "B"], "or"), "A or B");
  setMessages({ js_list_or: "{head} of {last}" }, "nl");
  assert.equal(listOf(["A", "B", "C"], "or"), "A, B of C");
});
