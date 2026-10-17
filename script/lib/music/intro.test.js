import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ABCJS from "abcjs";
import { introBarCount } from "./intro.js";

function parse(text) {
  return ABCJS.parseOnly(text)[0];
}

function song(file) {
  return parse(readFileSync(new URL(`../../../songs/${file}`, import.meta.url), "utf8"));
}

test("Paul Barbarin's Second Line: the two-bar intro", () => {
  assert.equal(introBarCount(song("paul_barbarins_second_line.abc")), 2);
});

test("an intro with a pickup counts the pickup as a bar of its own", () => {
  // Panama: B=A_A | then four bars
  assert.equal(introBarCount(song("panama.abc")), 5);
});

test("a lower-case title and a line starting with a bar line", () => {
  const tune = parse("X:1\nM:4/4\nL:1/4\nK:C\nP:intro\nCDEF|GABc||\nP:A\n|:c4|G4:|\n");
  assert.equal(introBarCount(tune), 2);
});

test("no intro: no parts, a first part that isn't one, notes before it, or nothing after it", () => {
  assert.equal(introBarCount(parse("X:1\nM:4/4\nL:1/4\nK:C\nCDEF|GABc|\n")), 0);
  assert.equal(introBarCount(parse("X:1\nM:4/4\nL:1/4\nK:C\nP:A\nCDEF|\nP:B\nGABc|\n")), 0);
  assert.equal(introBarCount(parse("X:1\nM:4/4\nL:1/4\nK:C\nCDEF|\nP:Intro\nGABc|\nP:A\nc4|\n")), 0);
  assert.equal(introBarCount(parse("X:1\nM:4/4\nL:1/4\nK:C\nP:Intro\nCDEF|GABc|\n")), 0);
  assert.equal(introBarCount(null), 0);
});
