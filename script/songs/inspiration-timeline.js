// DOM helpers for the LoopTube timeline and its overview strip: mapping a
// pointer to a track position and positioning markers/played bars from times.
// Stateless — every function takes what it needs — so they live apart from the
// loop-bar controller (inspiration-loopbar.js) that owns the state.

import { byId } from "../lib/dom.js";
import { formatClock, timeToViewFraction, timeToFraction } from "../lib/looptube.js";

// Echoes a loop point's time inside its own Set A/B button — same
// gold-letter-over-caption layout as the Speed stepper's value cell — once
// that point is placed; an unset button is left exactly as it was (a bare
// letter), rather than showing a placeholder time. Doesn't touch the
// panel/ctx state, so it lives at module scope rather than nested inside
// createInspiration.
export function updateMarkerTime(id, value) {
  const time = byId(id);
  if (!time) return;
  if (value !== null) {
    time.textContent = formatClock(value);
    time.hidden = false;
  } else {
    time.hidden = true;
  }
}

// The horizontal position (0-100%) a click/drag point maps to along a slim
// timeline track.
export function trackFraction(track, e) {
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
}

// `value` is a marker's absolute time; [viewStart, viewEnd) is the timeline's
// current zoomed window — a marker outside it is hidden rather than clamped
// to the track's edge, since a clamped position would look like a real (but
// wrong) marker instead of "not currently in view".
export function positionLoopHandle(el, value, viewStart, viewEnd) {
  if (!el) return;
  if (value === null || viewEnd <= viewStart || value < viewStart || value > viewEnd) {
    el.hidden = true;
    return;
  }
  el.style.left = `${timeToViewFraction(value, viewStart, viewEnd) * 100}%`;
  el.hidden = false;
}

// A loop marker's position on the overview strip, which always spans the
// whole clip regardless of the main timeline's current zoom — so this maps
// against `duration`, not a view window, and (unlike positionLoopHandle)
// never has an "outside the visible range" case to hide for.
export function positionOverviewTick(el, value, duration) {
  if (!el) return;
  if (value === null || duration <= 0) {
    el.hidden = true;
    return;
  }
  el.style.left = `${timeToFraction(value, duration) * 100}%`;
  el.hidden = false;
}

// The overview strip's own "played so far" marker (see the CSS doc comment
// on .inspiration-loop-overview-played) — mapped against the whole clip via
// timeToFraction, not the zoomed view timeToViewFraction uses for the main
// timeline's played bar, so it keeps tracking the real playhead even once
// zoomed away from it.
export function updateOverviewPlayed(t, dur) {
  const el = byId("inspirationOverviewPlayed");
  if (!el) return;
  el.style.width = `${timeToFraction(t, dur) * 100}%`;
}
