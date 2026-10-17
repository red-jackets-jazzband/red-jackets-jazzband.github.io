import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import ABCJS from "abcjs";
import { drawRomanNumerals } from "./roman-numerals.js";
import { decorateLayers } from "../overlays.js";

let dom;

beforeEach(() => {
  dom = new JSDOM('<div id="notation"></div>');
  global.window = dom.window;
  global.document = dom.window.document;
});

afterEach(() => {
  delete global.window;
  delete global.document;
});

// The tune parsed, with each chord-bearing note given a group holding the
// chord symbol as ABCjs would draw it; `boxes` are each symbol's
// { x, width } (jsdom can't lay a real render out).
function tuneWithChordGroups(body, boxes = [], key = "C") {
  const tune = ABCJS.parseOnly(`X:1\nM:4/4\nL:1/4\nK:${key}\n${body}\n`)[0];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  document.getElementById("notation").append(svg);
  let i = 0;
  tune.lines.forEach((line, lineIndex) => line.staff[0].voices[0].forEach((el) => {
    if (!el.chord) return;
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", `abcjs-note abcjs-l${lineIndex}`);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "abcjs-chord");
    text.setAttribute("font-size", "15");
    text.textContent = el.chord[0].name;
    const box = boxes[i++];
    if (box) text.getBBox = () => ({ x: box.x, y: 0, width: box.width, height: 10 });
    group.append(text);
    svg.append(group);
    el.abselem = { elemset: [group] };
  }));
  return tune;
}

const spans = () => [...document.querySelectorAll("tspan.rj-layer-roman")];

test("each chord symbol gets its numeral appended, smaller", () => {
  drawRomanNumerals(tuneWithChordGroups('"C" C | "Dm7" D | "G7" G | "N.C." C |'));
  assert.deepEqual(spans().map((s) => s.textContent), ["I", "ii7", "V7"]);
  assert.deepEqual(spans().map((s) => s.parentNode.textContent), ["CI", "Dm7ii7", "G7V7"]);
  assert.equal(spans()[0].getAttribute("font-size"), "12");
});

test("a numeral running into the next chord on its line shrinks, not below 60%", () => {
  const tune = tuneWithChordGroups('"C" C "G7" G |\n"F" F |', [{ x: 0, width: 30 }, { x: 25, width: 30 }, { x: 0, width: 30 }]);
  window.SVGElement.prototype.getComputedTextLength = function length() {
    return 10;
  };
  drawRomanNumerals(tune);
  const [c, g7, f] = spans();
  assert.equal(c.getAttribute("font-size"), "7.2"); // 8 units over: clamped at 60% of 12
  assert.equal(g7.getAttribute("font-size"), "12"); // the last chord on its line
  assert.equal(f.getAttribute("font-size"), "12");
});

test("a tune with no key draws nothing", () => {
  drawRomanNumerals(tuneWithChordGroups('"C" C |', [], "none"));
  assert.equal(spans().length, 0);
});

test("with Outside chords on too, the magenta shade takes in the numeral", () => {
  const tune = tuneWithChordGroups('"C" C | "D7" D |');
  // A symbol measures 20 wide, 12 more once its numeral is appended.
  for (const text of document.querySelectorAll("text.abcjs-chord")) {
    text.getBBox = () => ({ x: 100, y: 0, width: text.querySelector("tspan") ? 32 : 20, height: 10 });
  }
  decorateLayers(document.getElementById("notation"), tune, { layersApplied: ["outside-chords", "roman-numerals"], progressions: [] });
  const shades = [...document.querySelectorAll("rect.rj-layer-outside-chord")];
  assert.equal(shades.length, 1, "only D7 is outside C");
  assert.equal(shades[0].nextSibling.textContent, "D7II7");
  assert.equal(Number(shades[0].getAttribute("width")), 32 + 6);
});
