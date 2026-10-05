// Pure gesture classifier for the songs page's mobile swipe navigation. Given
// the start and end points of a one-finger touch (each `{ x, y, t }`, `t` in
// ms), decide whether it was a deliberate horizontal flick and, if so, which
// way. The DOM / touch-event plumbing lives in songs/swipe-nav.js.

const DEFAULTS = {
  minDistance: 55, // px travelled on the X axis before it counts as a swipe
  maxOffAxis: 0.6, // |dy| may be at most this fraction of |dx| — steeper is a scroll
  maxDuration: 700, // slower than this (ms) is a drag or stray touch, not a flick
};

export function classifySwipe(start, end, opts = {}) {
  if (!start || !end) return null;
  const { minDistance, maxOffAxis, maxDuration } = { ...DEFAULTS, ...opts };

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dt = end.t - start.t;

  const horizontal = Math.abs(dx) >= minDistance && Math.abs(dy) <= Math.abs(dx) * maxOffAxis;
  if (!horizontal || dt > maxDuration) return null;

  return dx < 0 ? "left" : "right";
}
