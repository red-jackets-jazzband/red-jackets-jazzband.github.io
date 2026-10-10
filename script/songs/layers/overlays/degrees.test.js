import { test } from "node:test";
import assert from "node:assert/strict";
import { mountSvg } from "../../../../../tests/helpers/svg-layout.js";
import { styleDegrees } from "./degrees.js";

const note = (text, box) => `<g><path class="abcjs-notehead" data-box="10,20,8,6"/><text class="abcjs-annotation" data-box="${box}">${text}</text></g>`;

test("a chord tone's number is centred under its note and circled", () => {
  const { page, notation } = mountSvg(note("●3", "8,40,12,10"));
  try {
    styleDegrees(notation);
    const text = notation.querySelector("text");
    assert.equal(text.textContent, "3", "the marker is stripped");
    assert.ok(text.classList.contains("rj-layer-degree"));
    assert.ok(text.classList.contains("rj-layer-degree--chord"));
    assert.equal(text.getAttribute("text-anchor"), "middle");
    assert.equal(text.getAttribute("x"), "14", "the middle of the notehead (10..18)");
    const circle = notation.querySelector("circle.rj-layer-degree-circle");
    assert.ok(circle, "a chord tone gets its circle");
    assert.equal(circle.getAttribute("cx"), "14");
    assert.equal(circle.getAttribute("cy"), "45");
    assert.equal(Number(circle.getAttribute("r")), 6 + 1.6, "round the larger side of the text, plus padding");
    assert.equal(circle.nextElementSibling, text, "drawn just behind the number");
  } finally {
    page.cleanup();
  }
});

test("any other note's number is centred but bare", () => {
  const { page, notation } = mountSvg(note("○♭7", "8,40,12,10"));
  try {
    styleDegrees(notation);
    const text = notation.querySelector("text");
    assert.equal(text.textContent, "♭7");
    assert.ok(text.classList.contains("rj-layer-degree--other"));
    assert.equal(notation.querySelector("circle"), null);
  } finally {
    page.cleanup();
  }
});

test("a note before the first chord is marked as having none", () => {
  const { page, notation } = mountSvg(note("•5", "8,40,12,10"));
  try {
    styleDegrees(notation);
    assert.ok(notation.querySelector("text").classList.contains("rj-layer-degree--none"));
    assert.equal(notation.querySelector("circle"), null);
  } finally {
    page.cleanup();
  }
});

test("annotations that aren't scale degrees are left alone", () => {
  const { page, notation } = mountSvg(note("Salty Dog progression", "8,40,12,10") + note("1", "8,40,4,10"));
  try {
    styleDegrees(notation);
    const texts = [...notation.querySelectorAll("text")];
    assert.deepEqual(texts.map((t) => t.textContent), ["Salty Dog progression", "1"]);
    texts.forEach((t) => assert.equal(t.getAttribute("class"), "abcjs-annotation"));
  } finally {
    page.cleanup();
  }
});

test("a note with no measurable notehead keeps its number in place", () => {
  const { page, notation } = mountSvg('<g><text class="abcjs-annotation" data-box="8,40,12,10">●3</text></g>');
  try {
    styleDegrees(notation);
    const text = notation.querySelector("text");
    assert.equal(text.textContent, "3");
    assert.equal(text.hasAttribute("text-anchor"), false);
    assert.equal(notation.querySelector("circle"), null);
  } finally {
    page.cleanup();
  }
});
