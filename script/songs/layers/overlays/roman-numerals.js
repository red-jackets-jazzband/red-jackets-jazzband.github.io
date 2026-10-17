/*
  Draws the "Roman numerals" layer (lib/music/roman-numerals.js) after ABCjs
  has engraved the sheet: each chord symbol gets its numeral written just
  behind it, on the same line and in a smaller, lighter face ("G7 V7"). It
  is a tspan appended to the symbol's own text, so it moves and prints with
  it, and nothing goes into the ABC or reaches the synth.

  ABCjs only made room for the symbol, so a numeral that would run into the
  next chord on its staff line shrinks to fit, down to MIN_SCALE of its size.
  Every numeral is written first and everything measured afterwards, so the
  sheet is laid out once, not once per chord.
*/
import { chordNumerals } from "../../../lib/music/roman-numerals.js";
import { bboxOf, chordTexts, SVG_NS } from "./svg.js";

const GAP = 3; // between a symbol and its numeral, and before the next chord
const MIN_SCALE = 0.6;
const SIZE = 0.8; // of the chord symbol's own size

function appendNumeral(text, numeral) {
  const span = document.createElementNS(SVG_NS, "tspan");
  span.setAttribute("class", "rj-layer-roman");
  span.setAttribute("dx", String(GAP));
  const size = Number(text.getAttribute("font-size"));
  if (Number.isFinite(size) && size > 0) span.setAttribute("font-size", String(Math.round(size * SIZE * 10) / 10));
  span.textContent = numeral;
  text.append(span);
  return span;
}

// The staff line an ABCjs element was drawn on ("abcjs-l2").
function lineOf(text) {
  const group = text.parentNode;
  const names = group && group.classList ? [...group.classList] : [];
  return names.find((name) => /^abcjs-l\d+$/.test(name)) || "";
}

export function drawRomanNumerals(visualObj) {
  const placed = [];
  chordNumerals(visualObj).forEach(({ el, numeral }) => {
    chordTexts(el).forEach((text) => placed.push({ text, span: appendNumeral(text, numeral) }));
  });
  const measured = placed.map((p) => ({ ...p, line: lineOf(p.text), box: bboxOf(p.text), width: textLength(p.span) })).filter((p) => p.box);
  measured.forEach((p, i) => {
    const next = measured[i + 1];
    if (!next || next.line !== p.line || next.box.x <= p.box.x) return;
    const overrun = p.box.x + p.box.width + GAP - next.box.x;
    if (overrun > 0) shrink(p.span, p.width, overrun);
  });
}

function textLength(span) {
  try {
    return span.getComputedTextLength();
  } catch {
    return 0; // not laid out (jsdom, a hidden container)
  }
}

// Shrinks `span` (drawn `width` wide) by about `overrun` svg units, not below MIN_SCALE.
function shrink(span, width, overrun) {
  const size = Number(span.getAttribute("font-size"));
  if (!Number.isFinite(size) || size <= 0 || width <= 0) return;
  const scale = Math.max(MIN_SCALE, (width - overrun) / width);
  span.setAttribute("font-size", String(Math.round(size * scale * 10) / 10));
}
