/*
  Keeps the Layers tab and panel clear of the page's own scrollbar.

  Both are `position: fixed` against the window's right edge, but on
  /songs/ the page never scrolls the window itself: the split layout's
  content column (.split-content) — or, in full screen, #rjSheet — is the
  scroll box, and its scrollbar runs down that same right edge. With
  always-visible scrollbars (Windows, or macOS set to "Always") the tab sat
  right on top of it. This measures that scrollbar and publishes its width
  as --rj-layers-edge on <body>, which split.css adds to their `right`.
  Overlay scrollbars (phones, macOS's default) measure 0, so nothing moves.
*/
const SCROLLS = new Set(["auto", "scroll"]);

function px(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

// The vertical scrollbar `el` draws along the window's right edge, in px.
export function scrollbarAtRightEdge(el, viewportWidth) {
  const style = window.getComputedStyle(el);
  if (!SCROLLS.has(style.overflowY)) return 0;
  if (el.getBoundingClientRect().right < viewportWidth - 1) return 0;
  const borders = px(style.borderLeftWidth) + px(style.borderRightWidth);
  return Math.max(0, el.offsetWidth - el.clientWidth - borders);
}

// The widest such scrollbar among `from` and its ancestors (the window's
// own scrollbar is already outside a fixed element's containing block).
export function rightEdgeGutter(from) {
  let widest = 0;
  for (let el = from; el && el !== document.documentElement; el = el.parentElement) {
    widest = Math.max(widest, scrollbarAtRightEdge(el, window.innerWidth));
  }
  return widest;
}

/*
  Measure now and whenever the layout may have changed: a window resize,
  a class change on <body> (full screen, the panel opening, a song
  becoming active), or `update()` called by hand after a render. Batched
  to one measurement per frame.
*/
export function trackRightEdge(anchor) {
  let pending = false;
  function measure() {
    pending = false;
    document.body.style.setProperty("--rj-layers-edge", `${rightEdgeGutter(anchor)}px`);
  }
  function update() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(measure);
  }
  window.addEventListener("resize", update);
  if (typeof MutationObserver === "function") {
    new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  }
  measure();
  return update;
}
