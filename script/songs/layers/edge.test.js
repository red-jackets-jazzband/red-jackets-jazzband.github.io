import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { rightEdgeGutter, scrollbarAtRightEdge } from "./edge.js";

// jsdom has no layout: give an element the box a browser would.
function fakeBox(el, { offsetWidth, clientWidth, right }) {
  Object.defineProperty(el, "offsetWidth", { value: offsetWidth, configurable: true });
  Object.defineProperty(el, "clientWidth", { value: clientWidth, configurable: true });
  el.getBoundingClientRect = () => ({ right, left: right - offsetWidth, top: 0, bottom: 0, width: offsetWidth, height: 0 });
}

test("a scroll box reaching the window's right edge reports its scrollbar", () => {
  const page = mountPage();
  try {
    const box = document.createElement("div");
    box.style.overflowY = "auto";
    document.body.append(box);
    fakeBox(box, { offsetWidth: 1000, clientWidth: 985, right: window.innerWidth });
    assert.equal(scrollbarAtRightEdge(box, window.innerWidth), 15);
    fakeBox(box, { offsetWidth: 1000, clientWidth: 985, right: window.innerWidth - 200 });
    assert.equal(scrollbarAtRightEdge(box, window.innerWidth), 0, "not at the edge: the tab isn't over it");
    box.style.overflowY = "hidden";
    fakeBox(box, { offsetWidth: 1000, clientWidth: 985, right: window.innerWidth });
    assert.equal(scrollbarAtRightEdge(box, window.innerWidth), 0, "doesn't scroll");
  } finally {
    page.cleanup();
  }
});

test("rightEdgeGutter takes the widest scrollbar among the anchor's ancestors", () => {
  const page = mountPage();
  try {
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    outer.style.overflowY = "scroll";
    outer.append(inner);
    document.body.append(outer);
    fakeBox(outer, { offsetWidth: 1200, clientWidth: 1183, right: window.innerWidth });
    fakeBox(inner, { offsetWidth: 600, clientWidth: 600, right: 600 });
    assert.equal(rightEdgeGutter(inner), 17);
    assert.equal(rightEdgeGutter(null), 0);
  } finally {
    page.cleanup();
  }
});
