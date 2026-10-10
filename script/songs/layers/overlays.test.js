import { test } from "node:test";
import assert from "node:assert/strict";
import { mountSvg } from "../../../../tests/helpers/svg-layout.js";
import { decorateLayers } from "./overlays.js";

// A line with a chord letter poking above its viewBox, a fingering and a
// scale degree under two notes.
const LINE = `
  <text class="abcjs-chord" data-box="20,36,20,14">F</text>
  <g><path class="abcjs-notehead" data-box="10,70,8,6"/><text class="abcjs-annotation" data-box="8,90,6,10">2</text></g>
  <g><path class="abcjs-notehead" data-box="50,70,8,6"/><text class="abcjs-annotation" data-box="48,90,12,10">●3</text></g>`;
const VIEW = { x: 0, y: 40, width: 1000, height: 120 };
const VISUAL_OBJ = { lines: [] };

function run(plan) {
  const mounted = mountSvg(LINE, { viewBox: VIEW });
  decorateLayers(mounted.notation, VISUAL_OBJ, plan);
  return mounted;
}

test("with no layers applied the sheet is untouched", () => {
  const { page, svg, notation } = run({ layersApplied: [], progressions: [] });
  try {
    assert.equal(svg.hasAttribute("viewBox"), false);
    assert.equal(notation.querySelector(".rj-layer-fingering"), null);
    assert.equal(notation.querySelector(".rj-layer-degree"), null);
  } finally {
    page.cleanup();
  }
});

test("a switched-on layer brings the chord letters back inside their svg", () => {
  const { page, svg } = run({ layersApplied: ["fingerings"], progressions: [], instrument: "trumpet" });
  try {
    assert.equal(svg.getAttribute("viewBox"), "0 35 1000 125");
  } finally {
    page.cleanup();
  }
});

test("each applied layer styles only its own annotations", () => {
  const { page, notation } = run({ layersApplied: ["fingerings", "scale-degrees"], progressions: [], instrument: "trumpet" });
  try {
    const texts = [...notation.querySelectorAll(".abcjs-annotation")];
    assert.ok(texts[0].classList.contains("rj-layer-fingering"), "the valve digit");
    assert.equal(texts[0].classList.contains("rj-layer-degree"), false);
    assert.ok(texts[1].classList.contains("rj-layer-degree--chord"), "the scale degree");
    assert.equal(texts[1].classList.contains("rj-layer-fingering"), false);
  } finally {
    page.cleanup();
  }
});

test("scale degrees alone leave a digit annotation to be a degree, not a fingering", () => {
  const { page, notation } = run({ layersApplied: ["scale-degrees"], progressions: [] });
  try {
    assert.equal(notation.querySelector(".rj-layer-fingering"), null);
    assert.ok(notation.querySelector(".rj-layer-degree"));
  } finally {
    page.cleanup();
  }
});

test("a trombone's positions are not drawn as valves", () => {
  const { page, notation } = run({ layersApplied: ["fingerings"], progressions: [], instrument: "trombone" });
  try {
    assert.equal(notation.querySelector(".rj-layer-valves"), null);
  } finally {
    page.cleanup();
  }
});

test("a missing notation element or visual object is a no-op", () => {
  assert.doesNotThrow(() => decorateLayers(null, VISUAL_OBJ, { layersApplied: ["fingerings"] }));
  assert.doesNotThrow(() => decorateLayers({}, null, { layersApplied: ["fingerings"] }));
});
