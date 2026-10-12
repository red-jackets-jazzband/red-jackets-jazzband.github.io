import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
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
  const ctx = makeCtx();
  const follow = createFollowPlayback(ctx);
  follow.init();
  const scroller = document.scrollingElement || document.documentElement;
  const scrolls = [];
  Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => scrollTop });
  scroller.scrollTo = (options) => scrolls.push(options.top);
  return {
    ctx, follow, scrolls, btn: document.getElementById("followPlaybackBtn"), cleanup: page.cleanup,
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

test("the toggle button switches following off and on, and is remembered", () => {
  const { ctx, follow, scrolls, btn, cleanup } = setup({ scrollTop: 400 });
  try {
    assert.equal(btn.getAttribute("aria-pressed"), "true");
    assert.equal(btn.classList.contains("active"), true);
    btn.dispatchEvent(new window.Event("click"));
    assert.equal(ctx.state.followPlayback, false);
    assert.equal(btn.getAttribute("aria-pressed"), "false");
    assert.equal(btn.classList.contains("active"), false);
    assert.equal(window.localStorage.getItem("rj.followPlayback"), "0");

    const [line] = drawLines([window.innerHeight + 50]);
    follow.reveal(line);
    assert.deepEqual(scrolls, []);

    btn.dispatchEvent(new window.Event("click"));
    assert.equal(btn.getAttribute("aria-pressed"), "true");
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
