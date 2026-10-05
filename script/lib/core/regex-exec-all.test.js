import { test } from "node:test";
import assert from "node:assert/strict";
import { execAll } from "./regex-exec-all.js";

test("execAll finds every match of a global regex, in order", () => {
  const matches = execAll(/[A-G]/g, "C E G B");
  assert.deepEqual(matches.map((m) => m[0]), ["C", "E", "G", "B"]);
});

test("execAll returns capture groups, same as a real exec() match", () => {
  const matches = execAll(/([A-G])(\d)/g, "C4 D5");
  assert.deepEqual(matches.map((m) => [m[1], m[2]]), [["C", "4"], ["D", "5"]]);
});

test("execAll returns an empty array when nothing matches", () => {
  assert.deepEqual(execAll(/xyz/g, "abc"), []);
});

test("execAll resets a shared regex's lastIndex, unlike a raw exec loop", () => {
  const shared = /a/g;
  execAll(shared, "aaa");
  const second = execAll(shared, "aa");
  assert.equal(second.length, 2);
});

test("execAll doesn't loop forever on a zero-width match", () => {
  const matches = execAll(/x*/g, "abxc");
  assert.deepEqual(matches.map((m) => m[0]), ["", "", "x", "", ""]);
});
