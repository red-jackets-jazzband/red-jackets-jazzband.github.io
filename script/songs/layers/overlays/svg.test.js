import { test } from "node:test";
import assert from "node:assert/strict";
import { mountSvg } from "../../../../../tests/helpers/svg-layout.js";
import {
  SVG_NS, bboxOf, chordTexts, noteGroup, noteheadCentre, svgEl, viewTop,
} from "./svg.js";

test("svgEl builds a namespaced element with stringified attributes", () => {
  const { page } = mountSvg("");
  try {
    const circle = svgEl("circle", { cx: 4, r: 1.5, class: "x" });
    assert.equal(circle.namespaceURI, SVG_NS);
    assert.equal(circle.getAttribute("cx"), "4");
    assert.equal(circle.getAttribute("r"), "1.5");
  } finally {
    page.cleanup();
  }
});

test("bboxOf measures, and answers null for a node that can't be laid out", () => {
  const { page, notation } = mountSvg('<text data-box="1,2,3,4">a</text>');
  try {
    assert.deepEqual(bboxOf(notation.querySelector("text")), { x: 1, y: 2, width: 3, height: 4 });
    assert.equal(bboxOf({ getBBox() { throw new Error("not rendered"); } }), null);
  } finally {
    page.cleanup();
  }
});

test("noteheadCentre is the middle of the noteheads beside a text, or null with none", () => {
  const { page, notation } = mountSvg(
    '<g id="chord"><path class="abcjs-notehead" data-box="10,0,8,6"/><path class="abcjs-notehead" data-box="12,6,8,6"/><text id="t"/></g>'
    + '<g><text id="lonely"/></g>',
  );
  try {
    assert.equal(noteheadCentre(notation.querySelector("#t")), 15, "(10 .. 20) of a two-note chord");
    assert.equal(noteheadCentre(notation.querySelector("#lonely")), null);
  } finally {
    page.cleanup();
  }
});

test("noteGroup and chordTexts read an abcjs element's drawn group", () => {
  const { page, notation } = mountSvg('<g id="g"><text class="abcjs-chord">C</text><text class="abcjs-annotation">x</text></g>');
  try {
    const el = { abselem: { elemset: [notation.querySelector("#g")] } };
    assert.equal(noteGroup(el), notation.querySelector("#g"));
    assert.deepEqual(chordTexts(el).map((t) => t.textContent), ["C"]);
    assert.equal(noteGroup({}), null);
    assert.deepEqual(chordTexts({}), []);
  } finally {
    page.cleanup();
  }
});

test("viewTop is the viewBox's top, or -Infinity when unreadable", () => {
  const { page, svg } = mountSvg("", { viewBox: { x: 0, y: 42, width: 10, height: 10 } });
  try {
    assert.equal(viewTop(svg), 42);
    assert.equal(viewTop({}), -Infinity);
  } finally {
    page.cleanup();
  }
});
