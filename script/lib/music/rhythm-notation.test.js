import { test } from "node:test";
import assert from "node:assert/strict";
import { notateRhythm } from "./rhythm-notation.js";

const shape = (cell) => notateRhythm(cell).map((e) => {
  let s = e.rest ? `r${e.len}` : `n${e.len}`;
  if (e.tie) s += "-";
  if (e.beam) s += "=";
  return s;
}).join(" ");

test("straight eighths beam in pairs, one beat each", () => {
  assert.equal(shape("xxxxxxxx"), "n1= n1 n1= n1 n1= n1 n1= n1");
});

test("Charleston is a dotted quarter, an eighth and a half rest", () => {
  assert.equal(shape("x--x...."), "n3 n1 r4");
  assert.equal(notateRhythm("x--x....")[0].dotted, true);
});

test("a note held across a beat is split into tied pieces", () => {
  assert.equal(shape("xx-xx-xx"), "n1= n1- n1= n1 n2 n1= n1");
  assert.equal(shape(".x--x---"), "r1 n1- n2 n4");
  assert.equal(shape("x--x--x-"), "n3 n1- n2 n2");
});

test("nothing starting off beat 1 crosses the middle of the bar", () => {
  assert.equal(shape("xx.x--.x>"), "n1= n1 r1 n1- n2 r1 n1-");
  assert.equal(shape("x--x---."), "n3 n1- n3 r1");
});

test("a trailing > ties the last note over the bar line", () => {
  assert.equal(shape("x---...x>"), "n4 r2 r1 n1-");
  assert.equal(notateRhythm("x---...x")[3].tie, false);
});

test("every event fills exactly one bar", () => {
  for (const cell of ["x---x---", ".x.x.x.x", ".xxx.xxx", "xxxxxx.x>"]) {
    const total = notateRhythm(cell).reduce((sum, e) => sum + e.len, 0);
    assert.equal(total, 8, cell);
  }
});
