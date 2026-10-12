import { test } from "node:test";
import assert from "node:assert/strict";
import { mountSvg } from "../../../../../tests/helpers/svg-layout.js";
import {
  SVG_NS, alignRows, bboxOf, chordTexts, noteGroup, noteheadCentre, svgEl, viewTop,
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

const annotationAt = (cls, y) => `<g><text class="abcjs-annotation ${cls}" y="${y}">x</text></g>`;

test("alignRows puts a layer's annotations back on the row it usually takes, per staff line and voice", () => {
  const { page, svg } = mountSvg([
    annotationAt("abcjs-l1 abcjs-m0 abcjs-v0", 356),
    annotationAt("abcjs-l1 abcjs-m0 abcjs-v0", 376),
    annotationAt("abcjs-l1 abcjs-m1 abcjs-v0", 356),
    annotationAt("abcjs-l1 abcjs-m1 abcjs-v0", 396),
    annotationAt("abcjs-l1 abcjs-m1 abcjs-v1", 420),
    annotationAt("abcjs-l2 abcjs-m3 abcjs-v0", 589),
    annotationAt("abcjs-l2 abcjs-m3 abcjs-v0", 569),
  ].join(""));
  try {
    const texts = [...svg.querySelectorAll("text")];
    alignRows(texts);
    assert.deepEqual(texts.map((t) => t.getAttribute("y")), ["356", "356", "356", "356", "420", "569", "569"], "a tie goes to the higher row");
  } finally {
    page.cleanup();
  }
});

// A note's group: optionally a fingering at y 40, and its degree.
const noteWith = (fingering, degreeY) => `<g>${fingering ? '<text class="abcjs-annotation abcjs-l0 abcjs-v0" y="40">3</text>' : ""}<text class="abcjs-annotation abcjs-l0 abcjs-v0 degree" y="${degreeY}">3</text></g>`;

test("alignRows leaves a label where it is when another annotation of its note holds the row", () => {
  // Three notes: the first two have a fingering (y 40) above their degree
  // (y 60); the third has none, so ABCjs put its degree up at 40.
  const { page, svg } = mountSvg(noteWith(true, 60) + noteWith(true, 80) + noteWith(false, 40) + noteWith(true, 60));
  try {
    const degrees = [...svg.querySelectorAll(".degree")];
    alignRows(degrees);
    assert.deepEqual(degrees.map((t) => t.getAttribute("y")), ["60", "60", "60", "60"], "the usual row is 60, and nothing else of the third note is there");
    const blocked = mountSvg(noteWith(true, 80) + noteWith(true, 60) + noteWith(true, 60));
    try {
      const [first] = [...blocked.svg.querySelectorAll(".degree")];
      blocked.svg.querySelector("g text").setAttribute("y", "60"); // the note's own fingering took row 60
      alignRows([...blocked.svg.querySelectorAll(".degree")]);
      assert.equal(first.getAttribute("y"), "80", "not moved onto its own fingering");
    } finally {
      blocked.page.cleanup();
    }
  } finally {
    page.cleanup();
  }
});

const labelAt = (x, width) => `<text class="abcjs-annotation abcjs-l0 abcjs-v0" x="${x}" y="50" font-size="16" data-box="${x - width / 2},40,${width},12">do</text>`;

test("alignRows shrinks a label that would touch its neighbours, but not past 75%", () => {
  const { page, svg } = mountSvg(labelAt(100, 16) + labelAt(114, 16) + labelAt(150, 16) + labelAt(200, 30) + labelAt(210, 10));
  try {
    const texts = [...svg.querySelectorAll("text")];
    alignRows(texts);
    assert.deepEqual(texts.map((t) => t.getAttribute("font-size")), [
      "12", // 14 apart, 2 kept clear: 12 of its 16
      "12",
      "16", // room to spare
      "12", // would need a third of its size: stops at 75%
      "12.8", // 10 apart: 8 of its 10
    ]);
  } finally {
    page.cleanup();
  }
});

// A "do" at (x, y); one at y 70 also has a fingering of its own on row 50.
const doAt = (x, y) => `<g><text class="abcjs-annotation abcjs-l0 abcjs-v0" x="${x}" y="${y}" font-size="16" data-box="${x - 8},${y - 10},16,12">do</text>${y === 70 ? '<text class="abcjs-annotation abcjs-l0 abcjs-v0" y="50">1</text>' : ""}</g>`;

test("alignRows only fits a label against neighbours on its own row", () => {
  // The middle label stayed a row lower (its own note held the usual row), so
  // although its x is close to both others, nothing on its row crowds it.
  const { page, svg } = mountSvg(doAt(100, 50) + doAt(110, 70) + doAt(150, 50));
  try {
    const texts = [...svg.querySelectorAll("text[font-size]")];
    alignRows(texts);
    assert.deepEqual(texts.map((t) => t.getAttribute("y")), ["50", "70", "50"]);
    assert.deepEqual(texts.map((t) => t.getAttribute("font-size")), ["16", "16", "16"]);
  } finally {
    page.cleanup();
  }
});
