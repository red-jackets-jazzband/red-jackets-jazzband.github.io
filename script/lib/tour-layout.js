// Geometry and step navigation for the guided tour — pure numbers in, numbers
// and strings out, so songs/tour.js only has to read rects and apply results.

// At or below this width the card docks to the bottom of the screen instead of
// floating beside its target (same breakpoint as split.css's single-column
// layout, where there's rarely room to float anywhere).
export const DOCK_MAX_WIDTH = 1024;

const VIEWPORT_MARGIN = 8;
const DEFAULT_GAP = 12;

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

/**
 * @typedef {{ left: number, top: number, width: number, height: number }} Box
 * @typedef {{ width: number, height: number }} Size
 * @typedef {"bottom" | "top" | "right" | "left" | "center" | "dock" | "dock-top"} Placement
 */

// Candidate positions in preference order; each returns the card's top-left
// (unclamped along its cross axis) or null when it can't fit on that side.
/** @type {[Placement, (t: Box, c: Size, v: Size, gap: number) => { left: number, top: number } | null][]} */
const SIDES = [
  ["bottom", (t, c, v, gap) => {
    const top = t.top + t.height + gap;
    return top + c.height <= v.height - VIEWPORT_MARGIN ? { left: t.left + t.width / 2 - c.width / 2, top } : null;
  }],
  ["top", (t, c, _v, gap) => {
    const top = t.top - gap - c.height;
    return top >= VIEWPORT_MARGIN ? { left: t.left + t.width / 2 - c.width / 2, top } : null;
  }],
  ["right", (t, c, v, gap) => {
    const left = t.left + t.width + gap;
    return left + c.width <= v.width - VIEWPORT_MARGIN ? { left, top: t.top + t.height / 2 - c.height / 2 } : null;
  }],
  ["left", (t, c, _v, gap) => {
    const left = t.left - gap - c.width;
    return left >= VIEWPORT_MARGIN ? { left, top: t.top + t.height / 2 - c.height / 2 } : null;
  }],
];

function clampInto(point, card, viewport) {
  return {
    left: clamp(point.left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.width - card.width - VIEWPORT_MARGIN)),
    top: clamp(point.top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewport.height - card.height - VIEWPORT_MARGIN)),
  };
}

/**
 * Where to put the tour card for a spotlighted `target`.
 * Narrow viewports dock (bottom, or top for a target in the lower half); otherwise the first of below / above / right / left
 * where the card fits wins, and a target too big to leave room on any side
 * (or no target at all) centres the card on screen.
 * @param {Box | null} target
 * @param {Size} card
 * @param {Size} viewport
 * @param {number} [gap]
 * @returns {{ left: number, top: number, placement: Placement }}
 */
export function placeTooltip(target, card, viewport, gap = DEFAULT_GAP) {
  if (viewport.width <= DOCK_MAX_WIDTH) {
    // Docked along the edge farthest from the target, so the card doesn't sit
    // on it (a target already in the bottom half — the mixer's bottom sheet,
    // the floating player — gets a card docked at the top).
    const lower = target && target.top + target.height / 2 > viewport.height / 2;
    return { left: 0, top: 0, placement: lower ? "dock-top" : "dock" };
  }
  if (target) {
    for (const [placement, fit] of SIDES) {
      const point = fit(target, card, viewport, gap);
      if (point) return { ...clampInto(point, card, viewport), placement };
    }
  }
  const centred = clampInto(
    { left: (viewport.width - card.width) / 2, top: (viewport.height - card.height) / 2 },
    card,
    viewport,
  );
  return { ...centred, placement: "center" };
}

export const isDocked = (placement) => placement === "dock" || placement === "dock-top";

/**
 * `box`, tightened to the union of `childBoxes` when that's shorter — so a
 * flex-stretched target (e.g. the library list, which fills whatever height
 * the sidebar leaves even when it only holds a couple of rows) spotlights its
 * actual content instead of the empty space padding out its own box. Left,
 * top and width always stay the container's own; only the bottom can move
 * up, never down — a scrolled container with more content than fits keeps
 * its own (clipped) height rather than growing past it.
 * @param {Box} box
 * @param {Box[]} childBoxes
 * @returns {Box}
 */
export function tightenBox(box, childBoxes) {
  if (!childBoxes.length) return box;
  const bottom = Math.max(...childBoxes.map((child) => child.top + child.height));
  return { ...box, height: clamp(bottom - box.top, 0, box.height) };
}

/**
 * How far to scroll the page (positive = down) so a docked card of
 * `cardHeight` doesn't cover the spotlighted `box`. Zero when it already clears.
 * @param {Placement} placement  "dock" (card along the bottom) or "dock-top"
 * @param {Box} box
 * @param {number} cardHeight
 * @param {number} viewportHeight
 * @returns {number}
 */
export function dockScrollDelta(placement, box, cardHeight, viewportHeight) {
  const room = cardHeight + 2 * VIEWPORT_MARGIN;
  if (placement === "dock") {
    const limit = viewportHeight - room;
    return Math.max(0, box.top + box.height - limit);
  }
  return Math.min(0, box.top - room);
}

/**
 * CSS `clip-path` for the full-screen dimming layer: everything except a
 * rectangular hole around `target` (padded by `pad`). Clipped-away regions
 * don't take pointer events either, so the hole is also where clicks pass
 * through to the real control. No target → "none" (a solid dim, all blocked).
 * @param {Box | null} target
 * @param {number} pad
 * @returns {string}
 */
export function spotlightClipPath(target, pad = 6) {
  if (!target) return "none";
  const x1 = Math.round(target.left - pad);
  const y1 = Math.round(target.top - pad);
  const x2 = Math.round(target.left + target.width + pad);
  const y2 = Math.round(target.top + target.height + pad);
  // Outer ring, a seam to the hole, the hole, and back along the same seam —
  // under evenodd the doubled seam cancels, leaving a clean cut-out.
  const points = [
    "0 0", "0 100%", "100% 100%", "100% 0", "0 0",
    `${x1}px ${y1}px`, `${x2}px ${y1}px`, `${x2}px ${y2}px`, `${x1}px ${y2}px`, `${x1}px ${y1}px`,
    "0 0",
  ];
  return `polygon(evenodd, ${points.join(", ")})`;
}

/**
 * The next step index in direction `dir` (+1 / -1) whose step is available
 * (its target can be found), or -1 when there's none that way.
 * @template T
 * @param {T[]} steps
 * @param {number} index  current index
 * @param {1 | -1} dir
 * @param {(step: T) => boolean} isAvailable
 * @returns {number}
 */
export function nextStepIndex(steps, index, dir, isAvailable) {
  for (let i = index + dir; i >= 0 && i < steps.length; i += dir) {
    if (isAvailable(steps[i])) return i;
  }
  return -1;
}

// Index of the first step belonging to `chapterIndex` in a flattened list.
export function firstStepOfChapter(flatSteps, chapterIndex) {
  return flatSteps.findIndex((step) => step.chapterIndex === chapterIndex);
}
