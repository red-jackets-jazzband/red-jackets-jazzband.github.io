import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import ABCJS from "abcjs";
import { markOutsideChords } from "./outside-chords.js";
import { drawChordSkeleton } from "./chord-skeleton.js";

let dom;

function render(body) {
  return ABCJS.renderAbc("notation", `X:1\nM:4/4\nL:1/4\nK:C\n${body}\n`, {})[0];
}

beforeEach(() => {
  dom = new JSDOM('<div id="notation"></div>');
  global.window = dom.window;
  global.document = dom.window.document;
  dom.window.SVGElement.prototype.getBBox = function getBBox() {
    const d = this.getAttribute("d");
    const [x, y] = d ? d.slice(1).trim().split(/[ c]/).map(Number) : [0, 0];
    return { x, y, width: 7, height: 7 };
  };
});

afterEach(() => {
  delete global.window;
  delete global.document;
});

// The tune parsed, with each chord-bearing note given a group holding the
// chord symbol as ABCjs would draw it (jsdom can't lay a real render out).
function tuneWithChordGroups(body) {
  const tune = ABCJS.parseOnly(`X:1\nM:4/4\nL:1/4\nK:C\n${body}\n`)[0];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.getElementById("notation").append(svg);
  tune.lines.forEach((line) => line.staff[0].voices[0].forEach((el) => {
    if (!el.chord) return;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "abcjs-chord");
    text.textContent = el.chord[0].name;
    group.append(text);
    svg.append(group);
    el.abselem = { elemset: [group] };
  }));
  return tune;
}

test("only the chord outside the key gets a shade and the magenta text class", () => {
  markOutsideChords(tuneWithChordGroups('"C" E G c G | "A7" c e g e |'));
  assert.equal(document.querySelectorAll(".rj-layer-outside-chord").length, 1);
  const marked = [...document.querySelectorAll(".rj-layer-outside-text")];
  assert.deepEqual(marked.map((t) => t.textContent), ["A7"]);
  assert.equal(marked[0].previousElementSibling.getAttribute("class"), "rj-layer-outside-chord");
});

test("a diatonic tune is left alone", () => {
  markOutsideChords(tuneWithChordGroups('"C" E G c G | "G7" B d f d |'));
  assert.equal(document.querySelectorAll(".rj-layer-outside-chord").length, 0);
});

test("the skeleton tints out-of-key ghost notes only when asked to", () => {
  drawChordSkeleton(render('"A7" c e g e |'));
  assert.equal(document.querySelectorAll(".rj-layer-skeleton--outside").length, 0);
  document.getElementById("notation").innerHTML = "";
  drawChordSkeleton(render('"A7" c e g e |'), { markOutside: true });
  assert.ok(document.querySelectorAll(".rj-layer-skeleton-note.rj-layer-skeleton--outside").length >= 1);
});
