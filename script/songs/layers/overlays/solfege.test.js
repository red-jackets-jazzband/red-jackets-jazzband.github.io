import { test } from "node:test";
import assert from "node:assert/strict";
import { mountSvg } from "../../../../../tests/helpers/svg-layout.js";
import { styleSolfege } from "./solfege.js";

const note = (text) => `<g><path class="abcjs-notehead" data-box="10,20,8,6"/><text class="abcjs-annotation" data-box="8,40,12,10">${text}</text></g>`;

test("a syllable loses its marker and is centred under its note", () => {
  const { page, notation } = mountSvg(note("​sol"));
  try {
    styleSolfege(notation);
    const text = notation.querySelector("text");
    assert.equal(text.textContent, "sol");
    assert.ok(text.classList.contains("rj-layer-solfege"));
    assert.equal(text.getAttribute("text-anchor"), "middle");
    assert.equal(text.getAttribute("x"), "14", "the middle of the notehead (10..18)");
  } finally {
    page.cleanup();
  }
});

test("a chart's own annotation is left alone, even one that reads like a syllable", () => {
  const { page, notation } = mountSvg(note("la"));
  try {
    styleSolfege(notation);
    const text = notation.querySelector("text");
    assert.equal(text.textContent, "la");
    assert.equal(text.classList.contains("rj-layer-solfege"), false);
    assert.equal(text.getAttribute("x"), null);
  } finally {
    page.cleanup();
  }
});
