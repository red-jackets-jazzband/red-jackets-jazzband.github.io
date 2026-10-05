// The YouTube tab's LoopTube toolbar: A/B loop markers, the endless-loop poll,
// the zoomable timeline with its overview minimap, play/pause and the speed
// stepper. It owns all loop/zoom/playhead state and drives the player only
// through `getPlayer`, which returns the live YT player once it is ready
// (null before). Loading and switching sources is inspiration.js's job; the
// pure range/zoom/rate maths is in lib/looptube.js.

import { byId, on } from "../../lib/core/dom.js";
import {
  normalizeLoop, clampHandleDrag, stepPlaybackRate, loopLeadSeconds, shouldLoopSeek,
  ZOOM_LEVELS, computeZoomWindow, timeToViewFraction, viewFractionToTime, stepZoom, panZoomWindow,
  timeToFraction, nearestZoomLevel,
} from "../../lib/media/looptube.js";
import {
  updateMarkerTime, trackFraction, positionLoopHandle, positionOverviewTick, updateOverviewPlayed,
} from "./timeline.js";

const LOOP_POLL_MS = 80;
const LOOP_MIN_GAP = 1; // seconds — the shortest loop the toggle will accept

// While dragging a handle on a zoomed-in timeline, getting within this
// fraction of either track edge auto-scrolls the view (by this fraction of
// its own width per pointermove tick) so the drag can keep reaching times
// currently off-screen, rather than trapping the handle at the visible edge.
const EDGE_PAN_THRESHOLD = 0.04;
const EDGE_PAN_STEP = 0.2;

// How far an ArrowLeft/ArrowRight keypress pans the overview strip's window,
// as a fraction of its own current width — same shape as EDGE_PAN_STEP, just
// keyboard- rather than drag-triggered (see initOverview's keydown handler).
const OVERVIEW_KEY_PAN_FRACTION = 0.1;

export function createLoopBar({ getPlayer }) {
  let loopA = null;
  let loopB = null;
  let isPlaying = false;
  let loopEnabled = false;
  let loopPollId = null;
  let loopDragging = null; // "a" | "b" | null
  // Whether a pointer is currently dragging the timeline's own played-so-far
  // bar (as opposed to an A/B handle) to scrub playback — see initLoopBar's
  // pointer handlers. Kept distinct from loopDragging so the loop poll's
  // "!loopDragging" guard doesn't need to know about scrubbing separately.
  let scrubbing = false;
  // The timeline's current zoomed window (seconds) — [0, duration] at 1x.
  // Only ever moved explicitly: changeZoom() re-centers it on the playhead
  // when the zoom level changes, and a drag nearing its edge pans it (see
  // maybePanZoomWindow) — never a passive side effect of an unrelated
  // updateLoopUI() refresh, which would yank it out from under the user.
  let zoomLevel = ZOOM_LEVELS[0];
  let viewStart = 0;
  let viewEnd = 0;
  // The overview strip's own drag state — "pan" (dragging the window body,
  // width unchanged) or "start"/"end" (dragging one of its edges, which
  // resizes the window and snaps zoomLevel to the nearest ZOOM_LEVELS entry
  // via nearestZoomLevel). overviewDragAnchor* only matter mid-pan.
  let overviewDragging = null; // "pan" | "start" | "end" | null
  let overviewDragAnchorTime = 0;
  let overviewDragAnchorCenter = 0;
  // Where to resume once the player is ready (a shared loop starts at A).
  let shareResumeAt = null;

  function startLoopPoll() {
    if (loopPollId === null) loopPollId = window.setInterval(loopTick, LOOP_POLL_MS);
  }

  function stopLoopPoll() {
    if (loopPollId === null) return;
    window.clearInterval(loopPollId);
    loopPollId = null;
  }

  function loopTick() {
    const player = getPlayer();
    if (!player) return;
    let t = player.getCurrentTime();
    if (loopEnabled && !loopDragging && !scrubbing) {
      const span = normalizeLoop(loopA, loopB, LOOP_MIN_GAP);
      if (span) {
        const rate = player.getPlaybackRate ? player.getPlaybackRate() : 1;
        if (shouldLoopSeek(t, span.a, span.b, loopLeadSeconds(rate, LOOP_POLL_MS))) {
          // allowSeekAhead=true: an earlier version passed false here, since
          // A has already played and is buffered, to skip the "new stream
          // request" the player would otherwise make and avoid flashing its
          // native controls back into view on every repeat. In practice that
          // mode is unreliable — confirmed empirically, not just from docs —
          // and can leave the player silently stalled at A: it keeps
          // reporting itself as playing (no further onStateChange fires at
          // all) while getCurrentTime() stops advancing, so the loop just
          // freezes after its first repeat. A correctness bug is worse than
          // an occasional UI flash, so this always requests a real seek; the
          // explicit playVideo() is a backstop for the same stall and a
          // no-op when playback never actually stopped.
          player.seekTo(span.a, true);
          if (player.playVideo) player.playVideo();
          t = span.a;
        }
      }
    }
    updatePlayhead(t);
  }

  // ---- loop UI ----------------------------------------------------

  function playerDuration() {
    const player = getPlayer();
    return player && player.getDuration ? player.getDuration() : 0;
  }

  function updatePlayhead(t) {
    const played = byId("inspirationLoopPlayed");
    if (played) {
      // Clamps to the near/far edge of the current view when the playhead is
      // outside it (e.g. still playing past a zoomed-in window) — the same
      // "clipped, not wrong" reading a scrolled-out-of-view progress bar gets
      // anywhere else, so it's left as a plain clamp rather than hidden.
      played.style.width = `${timeToViewFraction(t, viewStart, viewEnd) * 100}%`;
    }
    updateOverviewPlayed(t, playerDuration());
  }

  function updateLoopRange() {
    const range = byId("inspirationLoopRange");
    if (!range) return;
    if (loopA !== null && loopB !== null && viewEnd > viewStart) {
      const fa = timeToViewFraction(Math.min(loopA, loopB), viewStart, viewEnd);
      const fb = timeToViewFraction(Math.max(loopA, loopB), viewStart, viewEnd);
      range.style.left = `${fa * 100}%`;
      range.style.width = `${(fb - fa) * 100}%`;
      range.hidden = false;
    } else {
      range.hidden = true;
    }
  }

  function updateLoopMarkerTimes() {
    updateMarkerTime("inspirationSetATime", loopA);
    updateMarkerTime("inspirationSetBTime", loopB);
  }

  function updateZoomUI(dur) {
    const value = byId("inspirationZoomValue");
    if (value) value.textContent = `${zoomLevel}×`;
    const hasVideo = dur > 0;
    const zoomOut = byId("inspirationZoomOut");
    const zoomIn = byId("inspirationZoomIn");
    if (zoomOut) zoomOut.disabled = !hasVideo || zoomLevel === ZOOM_LEVELS[0];
    if (zoomIn) zoomIn.disabled = !hasVideo || zoomLevel === ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  }

  /*
    The minimap strip showing where [viewStart, viewEnd] sits within the
    whole clip — always visible (its own zoom +/- buttons live right next to
    it, see the markup) rather than only once actually zoomed, since it's the
    permanent home for the zoom control now, not an extra that only earns
    its place once zoomed. At 1x its window simply spans the whole strip,
    same as a browser scrollbar's thumb filling the track when there's
    nothing to scroll. A/B's own position is echoed as a tick so they stay
    visible even when zoomed away from them entirely. The playhead itself is
    echoed the same way — see updateOverviewPlayed/.inspiration-loop-overview-played
    — so overall progress through the clip stays visible here too, not just
    on the zoomed timeline below.
  */
  function updateOverviewUI(dur) {
    const win = byId("inspirationOverviewWindow");
    if (win) {
      const fa = timeToFraction(viewStart, dur);
      const fb = timeToFraction(viewEnd, dur);
      win.style.left = `${fa * 100}%`;
      win.style.width = `${(fb - fa) * 100}%`;
    }
    positionOverviewTick(byId("inspirationOverviewTickA"), loopA, dur);
    positionOverviewTick(byId("inspirationOverviewTickB"), loopB, dur);
  }

  function updateLoopUI() {
    const dur = playerDuration();
    // The view only auto-tracks the full clip at 1x — see the zoomLevel/
    // viewStart/viewEnd doc comment above for why any narrower window is
    // left alone here rather than recomputed on every refresh.
    if (zoomLevel === ZOOM_LEVELS[0]) {
      viewStart = 0;
      viewEnd = dur;
    }
    positionLoopHandle(byId("inspirationLoopHandleA"), loopA, viewStart, viewEnd);
    positionLoopHandle(byId("inspirationLoopHandleB"), loopB, viewStart, viewEnd);

    const setA = byId("inspirationSetA");
    const setB = byId("inspirationSetB");
    if (setA) setA.classList.toggle("armed", loopA !== null);
    if (setB) setB.classList.toggle("armed", loopB !== null);

    updateLoopRange();
    updateLoopMarkerTimes();
    updateZoomUI(dur);
    updateOverviewUI(dur);

    const canLoop = normalizeLoop(loopA, loopB, LOOP_MIN_GAP) !== null;
    if (!canLoop && loopEnabled) loopEnabled = false;
    const toggle = byId("inspirationLoopToggle");
    if (toggle) {
      toggle.disabled = !canLoop;
      toggle.setAttribute("aria-pressed", loopEnabled ? "true" : "false");
    }
  }

  // Re-centers the view window on the current playhead each time the zoom
  // level changes — the natural "zoom in on where I am" a user reaches for
  // the control expecting, rather than an arbitrary fixed point.
  function changeZoom(direction) {
    const player = getPlayer();
    const dur = playerDuration();
    if (dur <= 0) return;
    zoomLevel = stepZoom(zoomLevel, direction);
    const center = player && player.getCurrentTime ? player.getCurrentTime() : (viewStart + viewEnd) / 2;
    const win = computeZoomWindow(center, dur, zoomLevel);
    viewStart = win.start;
    viewEnd = win.end;
    updateLoopUI();
  }

  // Auto-scrolls the zoomed view when `frac` (the drag's current position on
  // the visible track, 0..1) is near an edge — see EDGE_PAN_THRESHOLD/STEP.
  // A no-op once the view already covers the whole clip (panZoomWindow's own
  // guard), so this is safe to call unconditionally on every drag tick.
  function maybePanZoomWindow(frac, dur) {
    let win = null;
    if (frac <= EDGE_PAN_THRESHOLD && viewStart > 0) {
      win = panZoomWindow(viewStart, viewEnd, dur, -1, EDGE_PAN_STEP);
    } else if (frac >= 1 - EDGE_PAN_THRESHOLD && viewEnd < dur) {
      win = panZoomWindow(viewStart, viewEnd, dur, 1, EDGE_PAN_STEP);
    }
    if (win) {
      viewStart = win.start;
      viewEnd = win.end;
    }
  }

  // Dragging the overview window's body pans it: the width (and so
  // zoomLevel) never changes, only where it's centered — computed from how
  // far the pointer has moved since the drag started, not from the pointer's
  // own absolute position, so wherever on the window it was grabbed stays
  // under the pointer throughout the drag instead of snapping to center.
  function panOverviewWindow(pointerTime, dur) {
    const center = overviewDragAnchorCenter + (pointerTime - overviewDragAnchorTime);
    const win = computeZoomWindow(center, dur, zoomLevel);
    viewStart = win.start;
    viewEnd = win.end;
  }

  // Dragging one of the window's edges resizes it: the OTHER edge is the
  // anchor, the dragged point's distance from it is snapped to the nearest
  // ZOOM_LEVELS entry (nearestZoomLevel) so resizing and the +/- stepper
  // always agree on the same set of reachable widths, and the new window is
  // centered between the anchor and the drag point (so both edges settle
  // near where the drag actually put them, not just the anchored one).
  function resizeOverviewWindow(edge, pointerTime, dur) {
    const anchor = edge === "start" ? viewEnd : viewStart;
    zoomLevel = nearestZoomLevel(dur, Math.abs(anchor - pointerTime));
    const win = computeZoomWindow((anchor + pointerTime) / 2, dur, zoomLevel);
    viewStart = win.start;
    viewEnd = win.end;
  }

  // Keyboard equivalent of dragging the overview window's body: pans by a
  // fixed fraction of the window's own (unchanged) width, using the same
  // pure panZoomWindow the edge-of-drag auto-scroll already relies on, so it
  // stays perfectly smooth rather than snapping between zoom levels the way
  // the edge-resize keys below deliberately do.
  function panOverviewByKey(direction) {
    const dur = playerDuration();
    if (dur <= 0) return;
    const win = panZoomWindow(viewStart, viewEnd, dur, direction, OVERVIEW_KEY_PAN_FRACTION);
    viewStart = win.start;
    viewEnd = win.end;
    updateLoopUI();
  }

  // Keyboard equivalent of "click the overview background to jump there":
  // moves the window (same width) flush against the clip's start or end,
  // the two endpoints a keyboard user can't otherwise name without a pointer
  // coordinate — anywhere in between is still reachable by panning from one.
  function jumpOverviewToEdge(edge) {
    const dur = playerDuration();
    if (dur <= 0) return;
    const span = viewEnd - viewStart;
    if (edge === "start") {
      viewStart = 0;
      viewEnd = Math.min(dur, span);
    } else {
      viewEnd = dur;
      viewStart = Math.max(0, dur - span);
    }
    updateLoopUI();
  }

  function updatePlayToggleUI() {
    const btn = byId("inspirationPlayToggle");
    if (!btn) return;
    const icon = btn.querySelector("span");
    if (icon) icon.className = isPlaying ? "fa-solid fa-pause" : "fa-solid fa-play";
    const label = isPlaying ? "Pause" : "Play";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    // Same treatment as the sheet's own Play button (.sheet-play-btn.playing):
    // a solid gold fill while actually playing, the one control in its shell
    // that earns that at rest rather than only on hover/press.
    btn.classList.toggle("playing", isPlaying);
  }

  // Whether the player is actually playing right now. Prefers the IFrame
  // API's own getPlayerState() over the cached `isPlaying` flag when it's
  // available: `isPlaying` only updates once onStateChange fires, so right
  // after an autoplaying load there's a window where the video is already
  // playing but `isPlaying` still says otherwise (the same staleness
  // inspiration.js's pauseYoutube() works around) — getPlayerState() asks the player
  // directly instead of waiting for that event.
  function currentlyPlaying() {
    const player = getPlayer();
    if (player && player.getPlayerState && window.YT && window.YT.PlayerState) {
      return player.getPlayerState() === window.YT.PlayerState.PLAYING;
    }
    return isPlaying;
  }

  function togglePlayPause() {
    const player = getPlayer();
    if (!player) return;
    if (currentlyPlaying()) player.pauseVideo();
    else player.playVideo();
  }

  function updateSpeedLabel() {
    const player = getPlayer();
    const label = byId("inspirationSpeedValue");
    if (!label) return;
    const rate = player && player.getPlaybackRate ? player.getPlaybackRate() : 1;
    label.textContent = `${Math.round(rate * 100) / 100}×`;
  }

  function resetLoopState() {
    const player = getPlayer();
    loopA = null;
    loopB = null;
    loopEnabled = false;
    loopDragging = null;
    scrubbing = false;
    overviewDragging = null;
    shareResumeAt = null;
    zoomLevel = ZOOM_LEVELS[0];
    viewStart = 0;
    viewEnd = 0; // recomputed to [0, duration] on the updateLoopUI() call below
    const bar = byId("inspirationLoopBar");
    if (bar) bar.hidden = false;
    if (player && player.setPlaybackRate) player.setPlaybackRate(1);
    const played = byId("inspirationLoopPlayed");
    if (played) played.style.width = "0%";
    const overviewPlayed = byId("inspirationOverviewPlayed");
    if (overviewPlayed) overviewPlayed.style.width = "0%";
    updateSpeedLabel();
    updateLoopUI();
  }

  function setLoopMarker(which) {
    const player = getPlayer();
    if (!player) return;
    const t = player.getCurrentTime();
    if (!Number.isFinite(t)) return;
    if (which === "a") loopA = t;
    else loopB = t;
    updateLoopUI();
    // B is normally the second (last) marker placed — flip looping on right
    // away instead of making the toggle a separate third click, as long as
    // it now has a playable A-B span to loop. toggleLoopEnabled no-ops
    // without one (and calls updateLoopUI itself), so no extra guard needed
    // beyond "isn't already on".
    if (which === "b" && !loopEnabled) toggleLoopEnabled();
  }

  function toggleLoopEnabled() {
    const player = getPlayer();
    const span = normalizeLoop(loopA, loopB, LOOP_MIN_GAP);
    if (!span) return;
    loopEnabled = !loopEnabled;
    updateLoopUI();
    if (loopEnabled && player) {
      const t = player.getCurrentTime();
      // Unlike the loop poll's seek-back (which only ever seeks to an A
      // that's already played, hence buffered), A here may never have
      // played at all — the markers can be dragged into a region the
      // player hasn't buffered yet — so this seek must be allowed to
      // request a new stream rather than silently no-op.
      if (t < span.a || t >= span.b) {
        player.seekTo(span.a, true);
        updatePlayhead(span.a);
      }
    }
  }

  function clearLoopMarkers() {
    loopA = null;
    loopB = null;
    loopEnabled = false;
    updateLoopUI();
  }

  function changeSpeed(direction) {
    const player = getPlayer();
    if (!player) return;
    const rates = player.getAvailablePlaybackRates ? player.getAvailablePlaybackRates() : null;
    const current = player.getPlaybackRate ? player.getPlaybackRate() : 1;
    player.setPlaybackRate(stepPlaybackRate(current, direction, rates));
    updateSpeedLabel();
  }

  // ---- wiring ----------------------------------------------------

  // Dragging an A/B handle on the zoomed timeline: moves whichever marker
  // is being dragged, clamped against the other one, panning the view if
  // the drag nears its edge.
  function dragLoopHandle(track, e) {
    const dur = playerDuration();
    if (dur <= 0) return;
    const frac = trackFraction(track, e);
    // Pan before mapping frac -> time, so a drag held at the edge scrolls
    // the window under a stationary pointer instead of getting stuck once
    // the visible track runs out.
    maybePanZoomWindow(frac, dur);
    const span = viewEnd - viewStart;
    let otherTime;
    if (loopDragging === "a") {
      otherTime = loopB === null ? viewEnd : loopB;
    } else {
      otherTime = loopA === null ? viewStart : loopA;
    }
    const otherFrac = timeToViewFraction(otherTime, viewStart, viewEnd);
    const clamped = clampHandleDrag(frac, otherFrac, loopDragging, span > 0 ? LOOP_MIN_GAP / span : 0);
    const time = viewFractionToTime(clamped, viewStart, viewEnd);
    if (loopDragging === "a") loopA = time;
    else loopB = time;
    updateLoopUI();
  }

  // Dragging the track's own background (the played-so-far bar) scrubs
  // playback: the playhead follows the pointer live, panning the view if
  // the drag nears its edge, same as dragLoopHandle above.
  function scrubToPointer(track, e) {
    const player = getPlayer();
    if (!player) return;
    const dur = playerDuration();
    if (dur <= 0) return;
    const frac = trackFraction(track, e);
    maybePanZoomWindow(frac, dur);
    const t = viewFractionToTime(frac, viewStart, viewEnd);
    player.seekTo(t, true);
    updatePlayhead(t);
  }

  function initLoopBar() {
    on("inspirationPlayToggle", "click", togglePlayPause);
    on("inspirationSetA", "click", () => setLoopMarker("a"));
    on("inspirationSetB", "click", () => setLoopMarker("b"));
    on("inspirationLoopToggle", "click", toggleLoopEnabled);
    on("inspirationLoopClear", "click", clearLoopMarkers);
    on("inspirationSpeedDown", "click", () => changeSpeed(-1));
    on("inspirationSpeedUp", "click", () => changeSpeed(1));
    on("inspirationZoomOut", "click", () => changeZoom(-1));
    on("inspirationZoomIn", "click", () => changeZoom(1));

    const track = byId("inspirationLoopTrack");
    if (!track) return;
    track.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest && e.target.closest(".inspiration-loop-handle");
      if (handle) {
        loopDragging = handle.id === "inspirationLoopHandleB" ? "b" : "a";
        track.setPointerCapture(e.pointerId);
        return;
      }
      const player = getPlayer();
      if (!player || viewEnd <= viewStart) return;
      scrubbing = true;
      track.setPointerCapture(e.pointerId);
      const t = viewFractionToTime(trackFraction(track, e), viewStart, viewEnd);
      player.seekTo(t, true);
      // The loop poll (which normally drives the played-bar position) only
      // runs while playing, so a seek made while paused would otherwise
      // leave the bar showing the old position until playback resumes —
      // reflect the new position immediately instead of waiting for that.
      updatePlayhead(t);
    });
    track.addEventListener("pointermove", (e) => {
      if (loopDragging) dragLoopHandle(track, e);
      else if (scrubbing) scrubToPointer(track, e);
    });
    const endTrackDrag = (e) => {
      if (!loopDragging && !scrubbing) return;
      loopDragging = null;
      scrubbing = false;
      if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
      updateLoopUI();
    };
    track.addEventListener("pointerup", endTrackDrag);
    // A pointercancel (e.g. the browser reclaiming the gesture for scroll
    // or a system gesture) never fires pointerup, so without this handler
    // scrubbing/loopDragging would stay stuck true and the loop poll's
    // "!loopDragging && !scrubbing" guard (see its own comment above) would
    // never let playback resume driving the played-bar again.
    track.addEventListener("pointercancel", endTrackDrag);
  }

  /*
    The minimap strip (see updateOverviewUI's doc comment): grabbing its
    window body pans (panOverviewWindow), grabbing one of the two edge
    handles resizes (resizeOverviewWindow), and clicking its background
    outside the window jumps straight there at the current zoom level — the
    same three interactions a video editor's overview/minimap gives you,
    rather than the zoom stepper being the only way to move around once
    zoomed in.

    All three are pointer-only otherwise, so the strip itself is a single
    tabindex="0" focus stop (content/songs.md) exposing the same three
    actions from the keyboard: Left/Right pans (panOverviewByKey), Up/Down
    zooms (the same changeZoom the +/- buttons already use, so keyboard and
    button zoom always land on the same ZOOM_LEVELS step), Home/End jumps to
    the clip's start/end (jumpOverviewToEdge) as the keyboard-reachable
    equivalent of an arbitrary background-click target. The two edge
    handles stay pointer-only decoration on top of that one focus stop
    rather than becoming separate tab stops of their own — everything they
    do is already reachable through it.
  */
  function initOverview() {
    const overview = byId("inspirationLoopOverview");
    const win = byId("inspirationOverviewWindow");
    if (!overview || !win) return;

    const OVERVIEW_KEYDOWN_ACTIONS = {
      ArrowLeft: () => panOverviewByKey(-1),
      ArrowRight: () => panOverviewByKey(1),
      ArrowUp: () => changeZoom(1),
      ArrowDown: () => changeZoom(-1),
      Home: () => jumpOverviewToEdge("start"),
      End: () => jumpOverviewToEdge("end"),
    };
    overview.addEventListener("keydown", (e) => {
      const action = OVERVIEW_KEYDOWN_ACTIONS[e.key];
      if (!action) return;
      e.preventDefault();
      action();
    });

    overview.addEventListener("pointerdown", (e) => {
      const dur = playerDuration();
      if (dur <= 0) return;
      const handle = e.target.closest && e.target.closest(".inspiration-loop-overview-handle");
      if (handle) {
        overviewDragging = handle.id === "inspirationOverviewHandleEnd" ? "end" : "start";
        overview.setPointerCapture(e.pointerId);
        return;
      }
      const t = trackFraction(overview, e) * dur;
      if (e.target === win || win.contains(e.target)) {
        overviewDragging = "pan";
        overviewDragAnchorTime = t;
        overviewDragAnchorCenter = (viewStart + viewEnd) / 2;
        overview.setPointerCapture(e.pointerId);
        return;
      }
      // Background click (not the window, not a handle) -> jump there at once.
      const jumped = computeZoomWindow(t, dur, zoomLevel);
      viewStart = jumped.start;
      viewEnd = jumped.end;
      updateLoopUI();
    });
    overview.addEventListener("pointermove", (e) => {
      if (!overviewDragging) return;
      const dur = playerDuration();
      if (dur <= 0) return;
      const t = trackFraction(overview, e) * dur;
      if (overviewDragging === "pan") panOverviewWindow(t, dur);
      else resizeOverviewWindow(overviewDragging, t, dur);
      updateLoopUI();
    });
    overview.addEventListener("pointerup", (e) => {
      if (!overviewDragging) return;
      overviewDragging = null;
      if (overview.hasPointerCapture(e.pointerId)) overview.releasePointerCapture(e.pointerId);
    });
  }

  // ---- entry points for the panel/player ---------------------------

  function onPlayerReady() {
    updateSpeedLabel();
    updateLoopUI();
  }

  function onPlayerStateChange(e) {
    const player = getPlayer();
    const states = window.YT && window.YT.PlayerState;
    isPlaying = Boolean(states) && e.data === states.PLAYING;
    if (isPlaying) {
      // A shared link's start point (loop A) is applied here, not on onReady:
      // by the time the *right* video is actually playing a seek lands where
      // we mean it, whereas onReady fires once and openPanel may since have
      // swapped in a replacement video.
      if (shareResumeAt !== null && player && player.seekTo) {
        player.seekTo(shareResumeAt, true);
        shareResumeAt = null;
      }
      startLoopPoll();
    } else {
      stopLoopPoll();
    }
    updatePlayToggleUI();
    updateLoopUI();
  }

  // Playback has ended for good (panel closed, or a different video is about
  // to load): stop polling, forget any pending shared start point, reset the
  // play button.
  function halt() {
    stopLoopPoll();
    shareResumeAt = null;
    isPlaying = false;
    updatePlayToggleUI();
  }

  // Drop a shared link's A/B onto a freshly opened panel (the caller has just
  // reset the loop state, so this is the authoritative write) and, when it's a
  // real range, arm the loop and cue playback to A once the video is actually
  // playing (onPlayerStateChange consumes shareResumeAt).
  function applySharedLoop(a, b) {
    loopA = a;
    loopB = b;
    const span = normalizeLoop(a, b, LOOP_MIN_GAP);
    loopEnabled = Boolean(span);
    if (span) {
      shareResumeAt = span.a;
    } else {
      shareResumeAt = Number.isFinite(a) ? a : null;
    }
    updateLoopUI();
  }

  return {
    init() {
      initLoopBar();
      initOverview();
    },
    reset: resetLoopState,
    refresh: updateLoopUI,
    halt,
    onPlayerReady,
    onPlayerStateChange,
    updateSpeedLabel,
    applySharedLoop,
    loopRange: () => ({ a: loopA, b: loopB }),
  };
}
