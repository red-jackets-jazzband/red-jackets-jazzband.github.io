import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCK_MAX_WIDTH,
  dockScrollDelta,
  firstStepOfChapter,
  isDocked,
  nextStepIndex,
  placeTooltip,
  spotlightClipPath,
} from "./tour-layout.js";

const VIEWPORT = { width: 1400, height: 900 };
const CARD = { width: 320, height: 180 };
const box = (left, top, width, height) => ({ left, top, width, height });
const ok = (step) => step.ok;

test("placeTooltip puts the card below the target, centred, when there's room", () => {
  const spot = placeTooltip(box(600, 100, 200, 40), CARD, VIEWPORT);
  assert.equal(spot.placement, "bottom");
  assert.equal(spot.top, 152);
  assert.equal(spot.left, 700 - 160);
});

test("placeTooltip flips above when the target hugs the bottom edge", () => {
  const spot = placeTooltip(box(600, 800, 200, 40), CARD, VIEWPORT);
  assert.equal(spot.placement, "top");
  assert.equal(spot.top, 800 - 12 - 180);
});

test("placeTooltip goes beside a tall target that leaves no room above or below", () => {
  const right = placeTooltip(box(100, 20, 200, 860), CARD, VIEWPORT);
  assert.equal(right.placement, "right");
  assert.equal(right.left, 312);
  const left = placeTooltip(box(1000, 20, 300, 860), CARD, VIEWPORT);
  assert.equal(left.placement, "left");
  assert.equal(left.left, 1000 - 12 - 320);
});

test("placeTooltip clamps the card inside the viewport along its cross axis", () => {
  const spot = placeTooltip(box(0, 100, 40, 40), CARD, VIEWPORT);
  assert.equal(spot.placement, "bottom");
  assert.equal(spot.left, 8);
  const far = placeTooltip(box(1380, 100, 20, 40), CARD, VIEWPORT);
  assert.equal(far.left, 1400 - 320 - 8);
});

test("placeTooltip centres when the target fills the screen or is missing", () => {
  const huge = placeTooltip(box(0, 0, 1400, 900), CARD, VIEWPORT);
  assert.equal(huge.placement, "center");
  assert.equal(huge.left, 540);
  assert.equal(huge.top, 360);
  assert.equal(placeTooltip(null, CARD, VIEWPORT).placement, "center");
});

test("placeTooltip docks at or below the single-column breakpoint", () => {
  const narrow = placeTooltip(box(10, 10, 50, 50), CARD, { width: DOCK_MAX_WIDTH, height: 700 });
  assert.equal(narrow.placement, "dock");
  const wide = placeTooltip(box(10, 10, 50, 50), CARD, { width: DOCK_MAX_WIDTH + 1, height: 700 });
  assert.notEqual(wide.placement, "dock");
});

test("a docked card sits at the top when the target is in the lower half of the screen", () => {
  const narrow = { width: 390, height: 800 };
  assert.equal(placeTooltip(box(20, 100, 200, 40), CARD, narrow).placement, "dock");
  assert.equal(placeTooltip(box(20, 600, 200, 40), CARD, narrow).placement, "dock-top");
  assert.equal(placeTooltip(null, CARD, narrow).placement, "dock");
  assert.equal(isDocked("dock") && isDocked("dock-top"), true);
  assert.equal(isDocked("bottom") || isDocked("center"), false);
});

test("dockScrollDelta scrolls just enough to clear a docked card, and not at all when it already does", () => {
  // Card 180 tall in an 800px viewport: the bottom card covers everything below y=604.
  assert.equal(dockScrollDelta("dock", box(0, 100, 50, 40), 180, 800), 0);
  assert.equal(dockScrollDelta("dock", box(0, 700, 50, 40), 180, 800), 136);
  // The top card covers everything above y=196.
  assert.equal(dockScrollDelta("dock-top", box(0, 500, 50, 40), 180, 800), 0);
  assert.equal(dockScrollDelta("dock-top", box(0, 60, 50, 40), 180, 800), -136);
});

test("spotlightClipPath cuts an evenodd hole padded around the target", () => {
  assert.equal(
    spotlightClipPath(box(100, 50, 200, 40), 6),
    "polygon(evenodd, 0 0, 0 100%, 100% 100%, 100% 0, 0 0, 94px 44px, 306px 44px, 306px 96px, 94px 96px, 94px 44px, 0 0)",
  );
  assert.equal(spotlightClipPath(null), "none");
});

test("nextStepIndex walks either way and skips unavailable steps", () => {
  const steps = [{ ok: true }, { ok: false }, { ok: true }, { ok: false }];
  assert.equal(nextStepIndex(steps, 0, 1, ok), 2);
  assert.equal(nextStepIndex(steps, 2, -1, ok), 0);
  assert.equal(nextStepIndex(steps, 2, 1, ok), -1);
  assert.equal(nextStepIndex(steps, 0, -1, ok), -1);
});

test("firstStepOfChapter finds a chapter's first flattened step", () => {
  const flat = [{ chapterIndex: 0 }, { chapterIndex: 0 }, { chapterIndex: 1 }, { chapterIndex: 2 }];
  assert.equal(firstStepOfChapter(flat, 1), 2);
  assert.equal(firstStepOfChapter(flat, 2), 3);
  assert.equal(firstStepOfChapter(flat, 5), -1);
});
