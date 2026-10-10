import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import ABCJS from "abcjs";
import { drawChordSkeleton } from "./chord-skeleton.js";

const NOTEHEAD_BOX = 7; // a head's drawn height
let dom;

// jsdom has no layout: a notehead path's box is the one its own "M x y" start implies.
function stubbedBoxes() {
  return function getBBox() {
    const d = this.getAttribute("d");
    const [x, y] = d ? d.slice(1).trim().split(/[ c]/).map(Number) : [0, 0];
    return { x, y: y - NOTEHEAD_BOX / 2, width: NOTEHEAD_BOX, height: NOTEHEAD_BOX };
  };
}

function render(body) {
  const text = `X:1\nM:4/4\nL:1/4\nK:C\n${body}\n`;
  return ABCJS.renderAbc("notation", text, {})[0];
}

beforeEach(() => {
  dom = new JSDOM('<div id="notation"></div>');
  global.window = dom.window;
  global.document = dom.window.document;
  dom.window.SVGElement.prototype.getBBox = stubbedBoxes();
});

afterEach(() => {
  delete global.window;
  delete global.document;
});

test("a chord's notes are drawn as ghost noteheads in the note's column", () => {
  const tune = render('"C" E G c G | "G7" B d f d |');
  drawChordSkeleton(tune);
  const stacks = [...document.querySelectorAll(".rj-layer-skeleton")];
  assert.equal(stacks.length, 2);
  assert.equal(stacks[0].querySelectorAll(".rj-layer-skeleton-note").length, 3);
  assert.equal(stacks[1].querySelectorAll(".rj-layer-skeleton-note").length, 4);
});

test("each skeleton note is one step (half a staff space) from the next position", () => {
  const tune = render('"C" E G c G |');
  drawChordSkeleton(tune);
  const ys = [...document.querySelectorAll(".rj-layer-skeleton-note")].map((n) => Number(n.getAttribute("cy")));
  // E4 (2), G4 (4), C5 (7): two then three steps.
  const step = (ys[0] - ys[1]) / 2;
  assert.ok(step > 0);
  assert.ok(Math.abs((ys[1] - ys[2]) - 3 * step) < 1e-6);
});

test("it lies under its column's note group, not over the melody", () => {
  const tune = render('"C" E G c G |');
  drawChordSkeleton(tune);
  const stack = document.querySelector(".rj-layer-skeleton");
  assert.ok(stack.nextElementSibling);
  assert.ok(stack.nextElementSibling.querySelector(".abcjs-notehead"));
});

test("a note below the staff gets a ledger line", () => {
  drawChordSkeleton(render('"C" C, E, G, C E |'));
  assert.ok(document.querySelectorAll(".rj-layer-skeleton-ledger").length > 0);
});

test("a tune with no chords draws nothing", () => {
  drawChordSkeleton(render("C D E F |"));
  assert.equal(document.querySelectorAll(".rj-layer-skeleton").length, 0);
});

test("without layout (no getBBox) nothing is drawn and nothing throws", () => {
  const tune = render('"C" E G c G |');
  dom.window.SVGElement.prototype.getBBox = () => {
    throw new Error("not laid out");
  };
  drawChordSkeleton(tune);
  assert.equal(document.querySelectorAll(".rj-layer-skeleton").length, 0);
});

test("a chord on a rest in a line with no pitched note is anchored to the staff", () => {
  const tune = render('C D E F |\n"C" z4 |');
  // jsdom has no layout: the stubbed heads give the step; the rest and the
  // second line's top staff line get boxes of their own.
  const lineTwoTop = document.querySelectorAll(".abcjs-top-line")[1];
  const heads = stubbedBoxes();
  dom.window.SVGElement.prototype.getBBox = function getBBox() {
    if (this === lineTwoTop) return { x: 0, y: 100, width: 200, height: 0 };
    if ((this.getAttribute("data-name") || "").startsWith("rests")) return { x: 50, y: 120, width: NOTEHEAD_BOX, height: NOTEHEAD_BOX };
    return heads.call(this);
  };
  drawChordSkeleton(tune);
  assert.equal(document.querySelectorAll(".rj-layer-skeleton-note").length, 3);
});
