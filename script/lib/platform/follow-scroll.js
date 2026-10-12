/*
  Follow playback: where to scroll the sheet so the line being played stays
  in view (songs/audio/follow.js does the DOM side).

  The rule is deliberately modest. A visitor still at the very top of the
  page (`scrollTop` within AT_TOP_PX) is left alone: up there they're reading
  the chord table, which banjo and sousaphone players follow instead of the
  staff lines, and the first lines of the sheet are in view anyway. Once
  they've scrolled down into a longer score, a played line that is no longer
  wholly inside the visible band — running off the bottom, or a repeat
  jumping back above it — is brought up to just under the band's top, so the
  lines that come next are visible below it.

  All rects are viewport coordinates ({ top, bottom }); `band` is the part of
  the scroll container the reader can actually see, already shortened by any
  sticky toolbar pinned over its top.
*/

// How far down a visitor must have scrolled before playback may move the page.
export const AT_TOP_PX = 8;

// Space left above a line scrolled to the top of the band.
export const LEAD_PX = 16;

// The bottom part of the band (a fraction of its height) a line counts as
// "about to run off": scrolling a little early keeps the next line in sight.
export const BOTTOM_MARGIN = 0.1;

export function followScrollTarget({ line, band, scrollTop }) {
  if (!line || !band || !Number.isFinite(scrollTop) || scrollTop <= AT_TOP_PX) return null;
  const height = band.bottom - band.top;
  if (height <= 0) return null;
  const bottom = band.bottom - height * BOTTOM_MARGIN;
  if (line.top >= band.top && line.bottom <= bottom) return null;
  // A line taller than the band that already starts at its top is as
  // visible as it can get; moving it would only hide its top.
  if (line.top >= band.top && line.top <= band.top + 2 * LEAD_PX) return null;
  return Math.max(0, Math.round(scrollTop + line.top - band.top - LEAD_PX));
}
