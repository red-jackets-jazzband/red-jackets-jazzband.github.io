import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldDismissSheet } from "./sheet-drag.js";

test("a tap on the handle closes the sheet", () => {
  assert.equal(shouldDismissSheet(0, 80, 500), true);
  assert.equal(shouldDismissSheet(3, 120, 500), true);
});

test("a long press without moving does not", () => {
  assert.equal(shouldDismissSheet(0, 900, 500), false);
});

test("a short, slow pull springs back", () => {
  assert.equal(shouldDismissSheet(60, 800, 500), false);
});

test("pulling past a third of the height closes it, however slowly", () => {
  assert.equal(shouldDismissSheet(160, 3000, 500), true);
});

test("a quick flick closes it from a short distance", () => {
  assert.equal(shouldDismissSheet(50, 60, 500), true);
});

test("an upward pull never closes", () => {
  assert.equal(shouldDismissSheet(-80, 100, 500), false);
});
