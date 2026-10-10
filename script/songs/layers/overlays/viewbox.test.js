import { test } from "node:test";
import assert from "node:assert/strict";
import { mountSvg } from "../../../../../tests/helpers/svg-layout.js";
import { uncropChords } from "./viewbox.js";

const chord = (name, y) => `<text class="abcjs-chord" data-box="20,${y},20,14">${name}</text>`;

test("a chord row sticking out above the viewBox is brought inside, width unchanged", () => {
  const { page, svg, notation } = mountSvg(chord("F", 36) + chord("D7", 40), { viewBox: { x: 0, y: 40, width: 1000, height: 120 } });
  try {
    uncropChords(notation);
    // The topmost letter is at 36; one unit of headroom above it.
    assert.equal(svg.getAttribute("viewBox"), "0 35 1000 125");
  } finally {
    page.cleanup();
  }
});

test("a line whose chords already fit is left exactly as ABCjs made it", () => {
  const { page, svg, notation } = mountSvg(chord("F", 60), { viewBox: { x: 0, y: 40, width: 1000, height: 120 } });
  try {
    uncropChords(notation);
    assert.equal(svg.hasAttribute("viewBox"), false, "never written");
  } finally {
    page.cleanup();
  }
});

test("a line without chord symbols, or one that can't be measured, is skipped", () => {
  const { page, svg, notation } = mountSvg('<text class="abcjs-title" data-box="0,0,1,1">T</text>', { viewBox: { x: 0, y: 40, width: 1000, height: 120 } });
  try {
    uncropChords(notation);
    assert.equal(svg.hasAttribute("viewBox"), false);
  } finally {
    page.cleanup();
  }
  const bare = mountSvg(chord("F", 0));
  try {
    uncropChords(bare.notation); // jsdom: no viewBox at all
    assert.equal(bare.svg.hasAttribute("viewBox"), false);
  } finally {
    bare.page.cleanup();
  }
});
