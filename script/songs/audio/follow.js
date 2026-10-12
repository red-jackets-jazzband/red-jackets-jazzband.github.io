import { byId, on } from "../../lib/core/dom.js";
import { followScrollTarget } from "../../lib/platform/follow-scroll.js";

/*
  Follow playback: while a tune plays, keep the staff line being played in
  view by scrolling whatever box the sheet scrolls in (the page itself on a
  phone, the content column on desktop, #rjSheet in full screen). The rule
  for when to move — not at all while the visitor is still at the top
  reading the chord table, only when the played line leaves the visible
  band — is lib/platform/follow-scroll.js's.

  The More-controls drawer's #followPlaybackBtn switches it on and off
  (`playback.followPlayback`, sticky): players who read the chord table
  rather than the staff (banjo, sousaphone) can keep the page still.

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

export function createFollowPlayback(ctx) {
  let lastLine = null;
  let userScrolledAt = -Infinity;

  function markUserScroll() {
    userScrolledAt = Date.now();
  }

  function reveal(node) {
    if (!ctx.state.followPlayback || !node || typeof node.closest !== "function") return;
    // ABCjs engraves one <svg> per staff line (sheet.js's oneSvgPerLine).
    const line = node.closest("svg");
    if (!line || line === lastLine) return;
    lastLine = line;
    if (Date.now() - userScrolledAt < USER_SCROLL_PAUSE_MS) return;
    const container = scrollContainerOf(line);
    const target = followScrollTarget({
      line: line.getBoundingClientRect(),
      band: visibleBand(container),
      scrollTop: container.scrollTop,
    });
    if (target !== null) scrollTo(container, target);
  }

  function draw() {
    const btn = byId("followPlaybackBtn");
    if (!btn) return;
    const enabled = Boolean(ctx.state.followPlayback);
    btn.classList.toggle("active", enabled);
    btn.setAttribute("aria-pressed", String(enabled));
  }

  function init() {
    draw();
    on("followPlaybackBtn", "click", () => {
      ctx.state.followPlayback = !ctx.state.followPlayback;
    });
    ctx.store.subscribe("playback", (_slice, changed) => {
      if (changed.includes("followPlayback")) draw();
    });
    window.addEventListener("wheel", markUserScroll, { capture: true, passive: true });
    window.addEventListener("touchmove", markUserScroll, { capture: true, passive: true });
  }

  return { init, reveal };
}
