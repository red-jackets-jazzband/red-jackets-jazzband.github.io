import { test } from "node:test";
import assert from "node:assert/strict";
import { mountSvg } from "../../../../../tests/helpers/svg-layout.js";
import { styleFingerings } from "./fingerings.js";

const slot = (text) => `<g><path class="abcjs-notehead" data-box="10,20,8,6"/><text class="abcjs-annotation" data-box="8,40,6,10">${text}</text></g>`;

test("a pressed valve is a solid disc with its number, centred under the note", () => {
  const { page, notation } = mountSvg(slot("2"));
  try {
    styleFingerings(notation, "trumpet");
    const text = notation.querySelector("text.abcjs-annotation");
    assert.ok(text.classList.contains("rj-layer-fingering"));
    assert.ok(text.classList.contains("rj-layer-fingering--drawn"), "the text stays but is hidden by the stylesheet");
    assert.equal(text.getAttribute("x"), "14");
    const disc = notation.querySelector(".rj-layer-valves circle.rj-layer-valve");
    assert.equal(disc.getAttribute("cx"), "14");
    assert.equal(disc.classList.contains("rj-layer-valve--open"), false);
    assert.equal(notation.querySelector(".rj-layer-valve-digit").textContent, "2");
  } finally {
    page.cleanup();
  }
});

test("an open horn is a ring with a 0", () => {
  const { page, notation } = mountSvg(slot("0"));
  try {
    styleFingerings(notation, "trumpet");
    assert.ok(notation.querySelector("circle.rj-layer-valve--open"));
    assert.equal(notation.querySelector(".rj-layer-valve-digit").textContent, "0");
  } finally {
    page.cleanup();
  }
});

test("a valve left up is a small dot", () => {
  const { page, notation } = mountSvg(slot("·"));
  try {
    styleFingerings(notation, "trumpet");
    const dot = notation.querySelector("circle.rj-layer-valve-up");
    assert.equal(dot.getAttribute("r"), "1.6");
    assert.equal(notation.querySelector(".rj-layer-valve-digit"), null);
  } finally {
    page.cleanup();
  }
});

test("a trombone's positions stay plain bold digits, even 1-3 that look like valves", () => {
  const { page, notation } = mountSvg(slot("2"));
  try {
    styleFingerings(notation, "trombone");
    assert.equal(notation.querySelector(".rj-layer-valves"), null);
    const text = notation.querySelector("text");
    assert.ok(text.classList.contains("rj-layer-fingering"));
    assert.equal(text.classList.contains("rj-layer-fingering--drawn"), false);
    assert.equal(text.getAttribute("text-anchor"), "middle");
  } finally {
    page.cleanup();
  }
});

test("a digit that is a scale degree is not mistaken for a fingering", () => {
  const { page, notation } = mountSvg('<g><path class="abcjs-notehead" data-box="10,20,8,6"/><text class="abcjs-annotation rj-layer-degree" data-box="8,40,6,10">3</text></g>');
  try {
    styleFingerings(notation, "trumpet");
    assert.equal(notation.querySelector(".rj-layer-valves"), null);
    assert.equal(notation.querySelector("text").classList.contains("rj-layer-fingering"), false);
  } finally {
    page.cleanup();
  }
});

test("annotations that aren't fingerings are left alone", () => {
  const { page, notation } = mountSvg(slot("Salty Dog") + slot("●3"));
  try {
    styleFingerings(notation, "trumpet");
    notation.querySelectorAll("text").forEach((t) => assert.equal(t.getAttribute("class"), "abcjs-annotation"));
    assert.equal(notation.querySelector(".rj-layer-valves"), null);
  } finally {
    page.cleanup();
  }
});

// One note's valve diagram, its three slots at the given ys.
function valveSlot(y, i, x) {
  const glyph = i === 0 ? "1" : "·";
  return `<text class="abcjs-annotation abcjs-l0 abcjs-v0" y="${y}" data-box="${x},${y - 10},6,10">${glyph}</text>`;
}
const diagram = (ys, x) => `<g><path class="abcjs-notehead" data-box="${x},20,8,6"/>${ys.map((y, i) => valveSlot(y, i, x)).join("")}</g>`;

test("each valve row is put back on one line before its discs are drawn", () => {
  // ABCjs pushed the middle note's bottom valve a row down.
  const { page, notation } = mountSvg(diagram([40, 60, 80], 10) + diagram([40, 60, 100], 30) + diagram([40, 60, 80], 50));
  try {
    styleFingerings(notation, "trumpet");
    const rows = [...notation.querySelectorAll("svg > g")].map((g) => [...g.querySelectorAll("text.rj-layer-fingering")].map((t) => t.getAttribute("y")));
    assert.deepEqual(rows, [["40", "60", "80"], ["40", "60", "80"], ["40", "60", "80"]]);
  } finally {
    page.cleanup();
  }
});
