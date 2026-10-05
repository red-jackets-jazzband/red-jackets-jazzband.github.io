import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import {
  updateMarkerTime, trackFraction, positionLoopHandle, positionOverviewTick, updateOverviewPlayed,
} from "./timeline.js";

const percentOf = (el) => el.style.left;

test("trackFraction maps a pointer to 0..1 along the track and clamps outside it", () => {
  const track = { getBoundingClientRect: () => ({ left: 100, width: 200 }) };
  assert.equal(trackFraction(track, { clientX: 200 }), 0.5);
  assert.equal(trackFraction(track, { clientX: 0 }), 0);
  assert.equal(trackFraction(track, { clientX: 900 }), 1);
  assert.equal(trackFraction({ getBoundingClientRect: () => ({ left: 0, width: 0 }) }, { clientX: 5 }), 0);
});

test("positionLoopHandle places a marker inside the view and hides one outside or unset", () => {
  const el = { hidden: true, style: {} };
  positionLoopHandle(el, 50, 0, 100);
  assert.equal(el.hidden, false);
  assert.equal(percentOf(el), "50%");
  positionLoopHandle(el, 150, 0, 100);
  assert.equal(el.hidden, true);
  positionLoopHandle(el, null, 0, 100);
  assert.equal(el.hidden, true);
  positionLoopHandle(el, 5, 10, 10);
  assert.equal(el.hidden, true);
  assert.doesNotThrow(() => positionLoopHandle(null, 5, 0, 10));
});

test("positionOverviewTick maps against the whole clip and hides when unset or duration is unknown", () => {
  const el = { hidden: true, style: {} };
  positionOverviewTick(el, 25, 100);
  assert.equal(el.hidden, false);
  assert.equal(percentOf(el), "25%");
  positionOverviewTick(el, null, 100);
  assert.equal(el.hidden, true);
  positionOverviewTick(el, 25, 0);
  assert.equal(el.hidden, true);
});

test("updateMarkerTime shows a placed point as a clock and hides an unset one", () => {
  const page = mountPage({ html: '<span id="t" hidden></span>' });
  try {
    updateMarkerTime("t", 75);
    const time = document.getElementById("t");
    assert.equal(time.hidden, false);
    assert.equal(time.textContent, "1:15");
    updateMarkerTime("t", null);
    assert.equal(time.hidden, true);
    assert.doesNotThrow(() => updateMarkerTime("missing", 1));
  } finally {
    page.cleanup();
  }
});

test("updateOverviewPlayed sizes the played bar against the whole clip", () => {
  const page = mountPage({ html: '<div id="inspirationOverviewPlayed"></div>' });
  try {
    updateOverviewPlayed(50, 200);
    assert.equal(document.getElementById("inspirationOverviewPlayed").style.width, "25%");
    assert.doesNotThrow(() => { document.getElementById("inspirationOverviewPlayed").remove(); updateOverviewPlayed(1, 2); });
  } finally {
    page.cleanup();
  }
});
