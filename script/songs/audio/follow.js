import { byId } from "../../lib/core/dom.js";
import { chordTableInView, followScrollTarget } from "../../lib/platform/follow-scroll.js";

/*
  Follow playback: while a tune plays, keep the staff line being played in
  view by scrolling whatever box the sheet scrolls in (the page itself on a
  phone, the content column on desktop, #rjSheet in full screen). The rule
  for when to move — not at all while the chord table is in view (players
  who read it rather than the staff, banjo and sousaphone, keep a still
  page by staying up there), only when the played line leaves the visible
  band — is lib/platform/follow-scroll.js's. It is always on: a toggle for
  it was one more button in the drawer that the chord-table rule made
  unnecessary.

  audio/player.js calls reveal(node) with the first note it highlights on
  every playback event; only a change of line is looked at. A wheel or touch
  scroll by the visitor pauses following for a moment, so playback never
  fights a hand that is moving the page.
*/

// How long a visitor's own scroll keeps following paused.
const USER_SCROLL_PAUSE_MS = 3000;

// Toolbars that stick to the top of the scroll box in full screen and so
// cover the top of the band.
const STICKY_SELECTORS = ["#sheetmenu", ".rj-sheet-navrow"];

function pageScroller() {
  return document.scrollingElement || document.documentElement;
}

function scrollsVertically(node) {
  if (node.scrollHeight <= node.clientHeight) return false;
  const overflow = window.getComputedStyle(node).overflowY;
  return overflow === "auto" || overflow === "scroll";
}

function scrollContainerOf(node) {
  for (let cur = node.parentElement; cur && cur !== document.body; cur = cur.parentElement) {
    if (scrollsVertically(cur)) return cur;
  }
  return pageScroller();
}

// The part of `container` the reader can see, in viewport coordinates.
function visibleBand(container) {
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  let top = 0;
  let bottom = viewportHeight;
  if (container !== pageScroller()) {
    const rect = container.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  STICKY_SELECTORS.forEach((selector) => {
    const bar = document.querySelector(selector);
    if (!bar || window.getComputedStyle(bar).position !== "sticky") return;
    const rect = bar.getBoundingClientRect();
    if (rect.height > 0 && rect.top <= top + 1 && rect.bottom > top) top = rect.bottom;
  });
  return { top, bottom };
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollTo(container, top) {
  if (typeof container.scrollTo === "function") {
    container.scrollTo({ top, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  } else {
    container.scrollTop = top;
  }
}

function chordTableRect() {
  const table = byId("chordtable");
  return table ? table.getBoundingClientRect() : null;
}

export function createFollowPlayback() {
  let lastLine = null;
  let userScrolledAt = -Infinity;

  function markUserScroll() {
    userScrolledAt = Date.now();
  }

  function reveal(node) {
    if (!node || typeof node.closest !== "function") return;
    // ABCjs engraves one <svg> per staff line (sheet.js's oneSvgPerLine).
    const line = node.closest("svg");
    if (!line || line === lastLine) return;
    if (Date.now() - userScrolledAt < USER_SCROLL_PAUSE_MS) {
      lastLine = line;
      return;
    }
    const container = scrollContainerOf(line);
    const band = visibleBand(container);
    const chordTable = chordTableRect();
    // Held back only by the chord table: don't count this line as handled,
    // so it's tried again on its next note once the table has left view.
    if (chordTableInView(chordTable, band)) return;
    lastLine = line;
    const target = followScrollTarget({
      line: line.getBoundingClientRect(),
      band,
      scrollTop: container.scrollTop,
      chordTable,
    });
    if (target !== null) scrollTo(container, target);
  }

  function init() {
    window.addEventListener("wheel", markUserScroll, { capture: true, passive: true });
    window.addEventListener("touchmove", markUserScroll, { capture: true, passive: true });
  }

  return { init, reveal };
}
