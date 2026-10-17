import { test } from "node:test";
import assert from "node:assert/strict";
import { followScrollTarget, AT_TOP_PX, LEAD_PX } from "./follow-scroll.js";

const band = { top: 100, bottom: 900 };

test("followScrollTarget leaves a visitor at the top of the page alone", () => {
  const line = { top: 1200, bottom: 1300 };
  assert.equal(followScrollTarget({ line, band, scrollTop: 0 }), null);
  assert.equal(followScrollTarget({ line, band, scrollTop: AT_TOP_PX }), null);
});

test("followScrollTarget leaves the page alone while the chord table is in view", () => {
  const line = { top: 1200, bottom: 1300 };
  // Scrolled a little, but the chord table's lower rows still show.
  assert.equal(followScrollTarget({ line, band, scrollTop: 300, chordTable: { top: -200, bottom: 400 } }), null);
  // Scrolled past it (or above the band, under a sticky toolbar): follow.
  assert.equal(followScrollTarget({ line, band, scrollTop: 900, chordTable: { top: -600, bottom: 80 } }), 900 + 1200 - 100 - LEAD_PX);
  // An empty chord table (a tune without chords) doesn't hold anything up.
  assert.equal(followScrollTarget({ line, band, scrollTop: 300, chordTable: { top: 300, bottom: 300 } }), 300 + 1200 - 100 - LEAD_PX);
});

test("followScrollTarget does nothing while the line is comfortably in view", () => {
  assert.equal(followScrollTarget({ line: { top: 300, bottom: 400 }, band, scrollTop: 500 }), null);
});

test("followScrollTarget brings a line running off the bottom up to the band's top", () => {
  // Bottom margin is 10% of the 800px band: anything past 820 counts.
  const line = { top: 760, bottom: 860 };
  assert.equal(followScrollTarget({ line, band, scrollTop: 500 }), 500 + 760 - 100 - LEAD_PX);
});

test("followScrollTarget follows a line that is wholly below the band", () => {
  const line = { top: 1500, bottom: 1600 };
  assert.equal(followScrollTarget({ line, band, scrollTop: 200 }), 200 + 1500 - 100 - LEAD_PX);
});

test("followScrollTarget brings back a line above the band (a repeat), never past 0", () => {
  assert.equal(followScrollTarget({ line: { top: -300, bottom: -200 }, band, scrollTop: 900 }), 900 - 300 - 100 - LEAD_PX);
  assert.equal(followScrollTarget({ line: { top: -300, bottom: -200 }, band, scrollTop: 100 }), 0);
});

test("followScrollTarget leaves a line taller than the band alone once it starts at the top", () => {
  assert.equal(followScrollTarget({ line: { top: 110, bottom: 1400 }, band, scrollTop: 400 }), null);
  // ...but still scrolls it up when it starts further down.
  assert.equal(followScrollTarget({ line: { top: 600, bottom: 1900 }, band, scrollTop: 400 }), 400 + 500 - LEAD_PX);
});

test("followScrollTarget ignores missing or empty geometry", () => {
  assert.equal(followScrollTarget({ line: null, band, scrollTop: 400 }), null);
  assert.equal(followScrollTarget({ line: { top: 0, bottom: 10 }, band: { top: 5, bottom: 5 }, scrollTop: 400 }), null);
});
