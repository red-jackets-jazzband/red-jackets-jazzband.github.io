import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { createFollowPlayback } from "./follow.js";

// Draws two engraved staff lines into the sheet, each one svg with one note,
// placed in viewport coordinates through a getBoundingClientRect stub.
function drawLines(tops) {
  const notation = document.getElementById("notation");
  return tops.map((top) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const note = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.append(note);
    svg.getBoundingClientRect = () => ({ top, bottom: top + 100, height: 100 });
    notation.append(svg);
    return note;
  });
}

function setup({ scrollTop }) {
  const page = mountPage();
  const follow = createFollowPlayback();
  follow.init();
  const scroller = document.scrollingElement || document.documentElement;
  const scrolls = [];
  Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => scrollTop });
  scroller.scrollTo = (options) => scrolls.push(options.top);
  return {
    follow, scrolls, cleanup: page.cleanup,
  };
}

test("a line running off the bottom is scrolled up once the visitor has scrolled down", () => {
  const { follow, scrolls, cleanup } = setup({ scrollTop: 400 });
  try {
    const [first, second] = drawLines([200, window.innerHeight + 50]);
    follow.reveal(first);
    assert.deepEqual(scrolls, []);
    follow.reveal(second);
    assert.equal(scrolls.length, 1);
    assert.equal(scrolls[0], 400 + window.innerHeight + 50 - 16);
    // Further notes on the same line don't scroll again.
    follow.reveal(second);
    assert.equal(scrolls.length, 1);
  } finally {
    cleanup();
  }
});

test("a visitor at the top of the page (reading the chord table) is left alone", () => {
  const { follow, scrolls, cleanup } = setup({ scrollTop: 0 });
  try {
    const [line] = drawLines([window.innerHeight + 50]);
    follow.reveal(line);
    assert.deepEqual(scrolls, []);
  } finally {
    cleanup();
  }
});

test("a visitor scrolled only a little, with the chord table still in view, is left alone", () => {
  const { follow, scrolls, cleanup } = setup({ scrollTop: 120 });
  try {
    const table = document.getElementById("chordtable");
    table.getBoundingClientRect = () => ({ top: -100, bottom: 200, height: 300 });
    const [line] = drawLines([window.innerHeight + 50]);
    follow.reveal(line);
    assert.deepEqual(scrolls, []);
    // Once the visitor has scrolled the table out of view, the very same
    // line is followed on its next note.
    table.getBoundingClientRect = () => ({ top: -400, bottom: -100, height: 300 });
    follow.reveal(line);
    assert.equal(scrolls.length, 1);
  } finally {
    cleanup();
  }
});

test("the visitor's own wheel scroll pauses following", () => {
  const { follow, scrolls, cleanup } = setup({ scrollTop: 400 });
  try {
    const [line] = drawLines([window.innerHeight + 50]);
    window.dispatchEvent(new window.Event("wheel"));
    follow.reveal(line);
    assert.deepEqual(scrolls, []);
  } finally {
    cleanup();
  }
});
