// Pure helpers for the Inspiration player's LoopTube toolbar — A/B loop-range
// math, timeline positioning and playback-rate stepping. All DOM / YT.Player
// orchestration lives in render_abc.js.

const DEFAULT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// "0:05", "1:23", "1:02:03" (h:mm:ss only once past an hour).
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return h + ":" + pad(m) + ":" + pad(sec);
  return m + ":" + pad(sec);
}

// Position 0..1 of `time` within a clip of `duration` seconds.
export function timeToFraction(time, duration) {
  const d = Number(duration) || 0;
  if (d <= 0) return 0;
  return clamp01((Number(time) || 0) / d);
}

// Inverse of timeToFraction — seconds for a 0..1 position.
export function fractionToTime(fraction, duration) {
  const d = Number(duration) || 0;
  return clamp01(Number(fraction) || 0) * d;
}

// Given the two raw markers (either may be null), returns an ordered
// { a, b } with b - a >= minGapSeconds, or null when it isn't a usable loop.
export function normalizeLoop(a, b, minGapSeconds) {
  if (a == null || b == null) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi - lo < (minGapSeconds || 0)) return null;
  return { a: lo, b: hi };
}

// While dragging one handle, keep it on its side of the other by at least
// minGapFraction. `side` is "a" (must stay left of B) or "b" (right of A).
export function clampHandleDrag(fraction, otherFraction, side, minGapFraction) {
  const f = clamp01(fraction);
  const other = clamp01(otherFraction);
  const gap = minGapFraction || 0;
  if (side === "a") return Math.min(f, Math.max(0, other - gap));
  return Math.max(f, Math.min(1, other + gap));
}

// Next entry in `rates` from `current` moving `direction` (-1 slower, +1
// faster), clamped at the ends. `rates` is YT's getAvailablePlaybackRates()
// (ascending); falls back to a sane default set.
export function stepPlaybackRate(current, direction, rates) {
  const list = (rates && rates.length)
    ? rates.slice().sort((x, y) => { return x - y; })
    : DEFAULT_RATES.slice();
  let next = nearestIndex(list, current) + (direction < 0 ? -1 : 1);
  if (next < 0) next = 0;
  if (next > list.length - 1) next = list.length - 1;
  return list[next];
}

// Discrete zoom multiples the LoopTube timeline can show — 1 is the full
// clip; each step halves the visible window, doubling the pixels-per-second
// available for dragging A/B into place precisely.
export const ZOOM_LEVELS = [1, 2, 4, 8, 16, 32];

// The [start, end] time window (seconds) `zoomLevel` shows, centered on
// `center` (typically the current playhead when the zoom control is used)
// and clamped inside [0, duration] so the window never runs past either end
// of the clip. Falls back to the full clip below 1x or once no video/
// duration is loaded yet.
export function computeZoomWindow(center, duration, zoomLevel) {
  const dur = Math.max(0, Number(duration) || 0);
  const level = Number(zoomLevel) || 1;
  const width = level > 1 ? dur / level : dur;
  if (dur <= 0 || width >= dur) return { start: 0, end: dur };
  const c = Math.min(dur, Math.max(0, Number(center) || 0));
  let start = c - width / 2;
  let end = start + width;
  if (start < 0) { end -= start; start = 0; }
  if (end > dur) { start -= end - dur; end = dur; }
  return { start: Math.max(0, start), end: Math.min(dur, end) };
}

// Position 0..1 of `time` within the [viewStart, viewEnd] window currently
// on screen — the zoomed counterpart of timeToFraction above, used once a
// zoom level narrower than the full clip is in effect.
export function timeToViewFraction(time, viewStart, viewEnd) {
  const span = (Number(viewEnd) || 0) - (Number(viewStart) || 0);
  if (span <= 0) return 0;
  return clamp01(((Number(time) || 0) - (Number(viewStart) || 0)) / span);
}

// Inverse of timeToViewFraction.
export function viewFractionToTime(fraction, viewStart, viewEnd) {
  const span = (Number(viewEnd) || 0) - (Number(viewStart) || 0);
  return (Number(viewStart) || 0) + clamp01(Number(fraction) || 0) * span;
}

// Next/previous entry in ZOOM_LEVELS from `current` (direction -1 out, +1
// in), clamped at the ends — same shape as stepPlaybackRate above.
export function stepZoom(current, direction) {
  let idx = ZOOM_LEVELS.indexOf(current);
  if (idx === -1) idx = 0;
  idx += direction < 0 ? -1 : 1;
  return ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, idx))];
}

// The ZOOM_LEVELS entry whose implied window width (duration/level) is
// closest to `span` seconds — lets a free-form drag (the overview strip's
// resizable window edges) snap onto the same discrete steps the +/- buttons
// use, so dragging and stepping stay interchangeable instead of drifting the
// window to a width neither control could otherwise reach.
export function nearestZoomLevel(duration, span) {
  const dur = Math.max(0, Number(duration) || 0);
  const s = Math.max(1e-6, Number(span) || 0);
  const ideal = dur > 0 ? dur / s : ZOOM_LEVELS[0];
  return ZOOM_LEVELS.reduce(
    (best, level) => (Math.abs(level - ideal) < Math.abs(best - ideal) ? level : best),
    ZOOM_LEVELS[0],
  );
}

// Shifts a zoomed [viewStart, viewEnd] window by panFraction of its own
// width in `direction` (-1 left/earlier, +1 right/later), clamped inside
// [0, duration]. Used to auto-scroll the timeline when a drag reaches its
// visible edge, rather than trapping the handle at the window boundary.
export function panZoomWindow(viewStart, viewEnd, duration, direction, panFraction) {
  const dur = Math.max(0, Number(duration) || 0);
  const start0 = Number(viewStart) || 0;
  const end0 = Number(viewEnd) || 0;
  const span = end0 - start0;
  if (span <= 0 || span >= dur) return { start: 0, end: dur };
  const delta = (direction < 0 ? -1 : 1) * span * (Number(panFraction) || 0);
  let start = start0 + delta;
  let end = end0 + delta;
  if (start < 0) { end -= start; start = 0; }
  if (end > dur) { start -= end - dur; end = dur; }
  return { start: Math.max(0, start), end: Math.min(dur, end) };
}

// How far before B to fire the seek so playback doesn't audibly overshoot:
// covers one poll tick at the current rate, plus margin, floored at 0.12s.
export function loopLeadSeconds(playbackRate, intervalMs) {
  const rate = Number(playbackRate) || 1;
  const interval = Number(intervalMs) || 0;
  return Math.max(0.12, (rate * interval / 1000) * 1.5);
}

// True when the play head has reached the loop's tail (within `lead`) or has
// drifted well before A — i.e. it's time to seek back to A.
export function shouldLoopSeek(currentTime, a, b, lead) {
  const t = Number(currentTime);
  if (!isFinite(t)) return false;
  if (t >= b - (lead || 0)) return true;
  if (t < a - 0.5) return true;
  return false;
}

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function clamp01(n) {
  if (Number.isNaN(n) || n <= 0) return 0;
  if (n > 1) return 1;
  return n;
}

function nearestIndex(list, value) {
  const v = Number(value) || 1;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < list.length; i++) {
    const d = Math.abs(list[i] - v);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}
