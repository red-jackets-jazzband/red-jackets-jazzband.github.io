import { byId, on } from "../lib/dom.js";
import { youtubeEmbedUrl, extractYouTubeId } from "../lib/youtube.js";
import { PREF_KEYS, readPref, writePref } from "../lib/preferences.js";
import {
  formatClock, normalizeLoop, clampHandleDrag, stepPlaybackRate, loopLeadSeconds, shouldLoopSeek,
  ZOOM_LEVELS, computeZoomWindow, timeToViewFraction, viewFractionToTime, stepZoom, panZoomWindow,
  timeToFraction, nearestZoomLevel,
} from "../lib/looptube.js";

const LOOP_POLL_MS = 80;
const LOOP_MIN_GAP = 1; // seconds — the shortest loop the toggle will accept
const EDGE_MARGIN = 8; // px — how close to a window edge the panel may be dragged

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

// The panel (and the video with it — everything below the header is
// width-driven) can be resized by dragging its left edge, or stepped through
// these presets with the size button. MIN_PANEL_WIDTH floors both; the ceiling
// is the viewport minus the edge margin.
const PANEL_WIDTHS = [320, 420, 540, 680];
const MIN_PANEL_WIDTH = 240;

// Doesn't touch the panel/ctx state, so it lives at module scope rather than
// nested inside createInspiration.
function runExecCopy(url) {
  const ta = document.createElement("textarea");
  ta.value = url;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  // finally, not a trailing statement: a throwing select()/execCommand must
  // not leave ta stuck in the document.
  try {
    ta.select();
    // execCommand is deprecated in favour of the async Clipboard API, but
    // that's exactly why this fallback (for browsers that deny or lack it)
    // still has to call it. NOSONAR: intentional legacy-fallback use.
    return document.execCommand("copy"); // NOSONAR
  } finally {
    ta.remove();
  }
}

// Old-style copy via a throwaway textarea + execCommand, for browsers that
// deny or lack the async Clipboard API. Returns whether it took.
function execCopy(url) {
  try {
    return runExecCopy(url);
  } catch {
    return false;
  }
}

function fallbackCopy(url, btn) {
  if (execCopy(url)) flashShareBtn(btn);
  else window.prompt("Copy this link:", url);
}

function flashShareBtn(btn) {
  if (!btn) return;
  const icon = btn.querySelector("span");
  if (!icon || btn.dataset.flashing) return;
  const original = icon.className;
  btn.dataset.flashing = "1";
  icon.className = "fa-solid fa-check";
  btn.classList.add("copied");
  setTimeout(() => {
    icon.className = original;
    btn.classList.remove("copied");
    delete btn.dataset.flashing;
  }, 1400);
}

// The horizontal position (0-100%) a click/drag point maps to along a slim
// timeline track.
function trackFraction(track, e) {
  const rect = track.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
}

// `value` is a marker's absolute time; [viewStart, viewEnd) is the timeline's
// current zoomed window — a marker outside it is hidden rather than clamped
// to the track's edge, since a clamped position would look like a real (but
// wrong) marker instead of "not currently in view".
function positionLoopHandle(el, value, viewStart, viewEnd) {
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
function positionOverviewTick(el, value, duration) {
  if (!el) return;
  if (value === null || duration <= 0) {
    el.hidden = true;
    return;
  }
  el.style.left = `${timeToFraction(value, duration) * 100}%`;
  el.hidden = false;
}

function maxPanelWidth() {
  return Math.max(MIN_PANEL_WIDTH, window.innerWidth - EDGE_MARGIN * 2);
}

function clampWidth(width) {
  return Math.round(Math.min(maxPanelWidth(), Math.max(MIN_PANEL_WIDTH, width)));
}

// Keep an explicitly-positioned (already dragged) panel fully on screen after
// it grows. A still-corner-anchored panel needs nothing — right/bottom hold it
// in place and max-width caps it to the viewport.
function clampPanelIntoView(panel) {
  if (!panel.style.left && !panel.style.top) return;
  const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - panel.offsetWidth - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - panel.offsetHeight - EDGE_MARGIN);
  panel.style.left = `${Math.min(Math.max(EDGE_MARGIN, Number.parseFloat(panel.style.left) || 0), maxLeft)}px`;
  panel.style.top = `${Math.min(Math.max(EDGE_MARGIN, Number.parseFloat(panel.style.top) || 0), maxTop)}px`;
}

// The panel can be dragged to any corner by its header; position switches
// from the default bottom-right anchor to an explicit left/top on first drag.
function initDrag(panel, header) {
  let drag = null;
  header.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".inspiration-panel-icon-btn")) return;
    const rect = panel.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
    header.setPointerCapture(e.pointerId);
    panel.classList.add("dragging");
  });
  header.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const maxLeft = window.innerWidth - panel.offsetWidth - EDGE_MARGIN;
    const maxTop = window.innerHeight - panel.offsetHeight - EDGE_MARGIN;
    const left = Math.min(Math.max(EDGE_MARGIN, drag.left + (e.clientX - drag.x)), Math.max(EDGE_MARGIN, maxLeft));
    const top = Math.min(Math.max(EDGE_MARGIN, drag.top + (e.clientY - drag.y)), Math.max(EDGE_MARGIN, maxTop));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });
  header.addEventListener("pointerup", (e) => {
    drag = null;
    panel.classList.remove("dragging");
    if (header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId);
  });
}

// Mirrors the Mixer button's own .active toggle: the Inspiration button
// stays gold for as long as its panel is open, not just while hovered.
// Doesn't touch the panel/ctx state, so it lives at module scope rather than
// nested inside createInspiration.
function setLinkActive(active) {
  const btn = byId("inspirationLink");
  if (!btn) return;
  btn.classList.toggle("active", active);
  btn.setAttribute("aria-expanded", active ? "true" : "false");
}

/*
  The Inspiration picture-in-picture panel: a docked, draggable YouTube player
  that keeps playing across song navigation (until explicitly closed) instead
  of leaving the page, plus a LoopTube toolbar under the video — a play/pause
  toggle, A/B loop markers on a slim timeline, an endless A–B loop toggle (an
  ~80 ms poll that seekTo's back to A just before B, since YouTube has no
  native sub-range loop) and a playback-rate stepper. The toolbar reimplements
  everything the native YouTube control bar offers (play/pause, seek, speed),
  so the embed is loaded with controls=0 (see youtubeEmbedUrl) rather than
  showing a redundant native bar under it. Driven through the YouTube IFrame
  Player API; the pure range/rate/clock maths is in lib/looptube.js.
*/
export function createInspiration(ctx) {
  let panelUrl = null;
  let apiPromise = null;
  let player = null;
  let playerReady = false;
  let pendingVideoId = null;
  let loopA = null;
  let loopB = null;
  let isPlaying = false;
  let loopEnabled = false;
  let loopPollId = null;
  let loopDragging = null; // "a" | "b" | null
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
  let panelWidth = PANEL_WIDTHS[0];
  // A shared link's `a`/`b` markers, parked until the next tune with a
  // reference calls updateLink() so we know which video to open.
  let pendingShare = null;
  // Where to resume once the player is ready (a shared loop starts at A).
  let shareResumeAt = null;

  // ---- YouTube IFrame API --------------------------------------------

  function loadIframeApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === "function") prev();
        resolve();
      };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });
    return apiPromise;
  }

  function attachPlayer() {
    if (player) return;
    player = new window.YT.Player("inspirationVideoFrame", {
      events: {
        onReady() {
          playerReady = true;
          if (pendingVideoId) {
            player.loadVideoById(pendingVideoId);
            pendingVideoId = null;
          }
          updateSpeedLabel();
          updateLoopUI();
        },
        onStateChange: onPlayerStateChange,
        onPlaybackRateChange: updateSpeedLabel,
      },
    });
  }

  // ---- the "Inspiration" button on the sheet -------------------------

  /*
    Keep the sheet's Inspiration button in sync with the current tune: created
    for a tune whose ABC has an F: field, removed for one without. It only
    updates its own url/title — it never touches an already-open panel, so a
    video someone is playing along to keeps going while they browse songs.
  */
  function updateLink(url, title) {
    let btn = byId("inspirationLink");
    if (url === undefined) {
      if (btn) btn.remove();
      pendingShare = null;
      return;
    }
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Inspiration";
      btn.id = "inspirationLink";
      btn.className = "sheet-inspiration-link";
      btn.addEventListener("click", () => togglePanel(btn.dataset.url, btn.dataset.title));
      const slot = byId("inspirationSlot");
      if (slot) slot.appendChild(btn);
      // The panel can already be open (playing along across a song change
      // per the doc comment above) by the time this song's own button gets
      // (re)created — reflect that straight away instead of waiting for the
      // next open/close.
      const panel = byId("inspirationPanel");
      setLinkActive(Boolean(panel && !panel.hidden));
    }
    btn.dataset.url = url;
    btn.dataset.title = title || "";

    if (pendingShare) {
      const share = pendingShare;
      pendingShare = null;
      openPanel(url, title);
      applySharedLoop(share.a, share.b);
    }
  }

  // Arm a shared link's A/B markers: the next tune that reports a reference
  // opens its video with this loop already set. Called from app.js on a deep
  // link like `/songs/#s=<slug>&a=12&b=30`.
  function applyShareState({ a = null, b = null } = {}) {
    pendingShare = { a, b };
  }

  // Drop the shared A/B onto a freshly opened panel (openPanel has just run its
  // resetLoopState, so this is the authoritative write) and, when it's a real
  // range, arm the loop and cue playback to A once the video is actually
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

  // Copy a link to the current song + loop to the clipboard. app.js owns the
  // URL shape (it knows the song / open setlist); we just supply the markers.
  // The success tick only shows on a confirmed copy — a rejection or a missing
  // Clipboard API falls back to execCommand, then to a prompt the user can
  // copy out of by hand.
  function copyShareLink() {
    const btn = byId("inspirationShareBtn");
    const url = ctx && ctx.shareUrl ? ctx.shareUrl({ a: loopA, b: loopB }) : "";
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        () => flashShareBtn(btn),
        () => fallbackCopy(url, btn),
      );
    } else {
      fallbackCopy(url, btn);
    }
  }

  // ---- open / close -------------------------------------------------

  function togglePanel(url, title) {
    const panel = byId("inspirationPanel");
    if (!panel) return;
    if (!panel.hidden && panelUrl === url) closePanel();
    else openPanel(url, title);
  }

  function openPanel(url, title) {
    const panel = byId("inspirationPanel");
    const frame = byId("inspirationVideoFrame");
    if (!panel || !frame) return;
    const videoId = extractYouTubeId(url);
    if (!videoId) return;

    const titleEl = byId("inspirationPanelTitle");
    if (titleEl) titleEl.textContent = title || "Inspiration";
    const expandLink = byId("inspirationExpandBtn");
    if (expandLink) expandLink.href = url;

    panelUrl = url;
    panel.hidden = false;
    setLinkActive(true);
    stopLoopPoll();
    isPlaying = false;
    updatePlayToggleUI();
    resetLoopState();

    if (player && playerReady) {
      player.loadVideoById(videoId);
      return;
    }
    if (player) {
      pendingVideoId = videoId; // player exists but onReady hasn't fired yet
      return;
    }
    pendingVideoId = null;
    frame.src = youtubeEmbedUrl(url, {
      autoplay: true, jsApi: true, origin: window.location.origin,
    });
    loadIframeApi().then(attachPlayer);
  }

  function closePanel() {
    const panel = byId("inspirationPanel");
    if (!panel) return;
    panel.hidden = true;
    setLinkActive(false);
    stopLoopPoll();
    // Drop any id that was queued for a not-yet-ready player, so a late
    // onReady doesn't start a video into the now-hidden panel; likewise a
    // shared start point that never got to play.
    pendingVideoId = null;
    shareResumeAt = null;
    if (player && playerReady && player.stopVideo) {
      player.stopVideo();
    } else {
      const frame = byId("inspirationVideoFrame");
      if (frame) frame.src = "";
    }
    isPlaying = false;
    updatePlayToggleUI();
    const bar = byId("inspirationLoopBar");
    if (bar) bar.hidden = true;
    panelUrl = null;
  }

  function onPlayerStateChange(e) {
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

  // ---- loop poll ---------------------------------------------------

  function startLoopPoll() {
    if (loopPollId === null) loopPollId = window.setInterval(loopTick, LOOP_POLL_MS);
  }

  function stopLoopPoll() {
    if (loopPollId === null) return;
    window.clearInterval(loopPollId);
    loopPollId = null;
  }

  function loopTick() {
    if (!player || !playerReady) return;
    let t = player.getCurrentTime();
    if (loopEnabled && !loopDragging) {
      const span = normalizeLoop(loopA, loopB, LOOP_MIN_GAP);
      if (span) {
        const rate = player.getPlaybackRate ? player.getPlaybackRate() : 1;
        if (shouldLoopSeek(t, span.a, span.b, loopLeadSeconds(rate, LOOP_POLL_MS))) {
          // allowSeekAhead=false: A has already played, so it's buffered —
          // this skips the "new stream request" the player would otherwise
          // make, which is what flashes the native controls back into view
          // on every repeat.
          player.seekTo(span.a, false);
          t = span.a;
        }
      }
    }
    updatePlayhead(t);
  }

  // ---- loop UI ----------------------------------------------------

  function playerDuration() {
    return player && playerReady && player.getDuration ? player.getDuration() : 0;
  }

  function updatePlayhead(t) {
    const played = byId("inspirationLoopPlayed");
    if (!played) return;
    // Clamps to the near/far edge of the current view when the playhead is
    // outside it (e.g. still playing past a zoomed-in window) — the same
    // "clipped, not wrong" reading a scrolled-out-of-view progress bar gets
    // anywhere else, so it's left as a plain clamp rather than hidden.
    played.style.width = `${timeToViewFraction(t, viewStart, viewEnd) * 100}%`;
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

  function updateLoopReadout() {
    const readout = byId("inspirationLoopReadout");
    if (!readout) return;
    if (loopA !== null || loopB !== null) {
      const a = loopA !== null ? formatClock(loopA) : "–";
      const b = loopB !== null ? formatClock(loopB) : "–";
      readout.textContent = `${a} – ${b}`;
      readout.hidden = false;
    } else {
      readout.hidden = true;
    }
  }

  function updateZoomUI(dur) {
    const value = byId("inspirationZoomValue");
    if (value) value.textContent = `${zoomLevel}×`;
    const hasVideo = dur > 0;
    const zoomOut = byId("inspirationZoomOut");
    const zoomIn = byId("inspirationZoomIn");
    if (zoomOut) zoomOut.disabled = !hasVideo || zoomLevel === ZOOM_LEVELS[0];
    if (zoomIn) zoomIn.disabled = !hasVideo || zoomLevel === ZOOM_LEVELS.at(-1);
  }

  /*
    The minimap strip showing where [viewStart, viewEnd] sits within the
    whole clip — always visible (its own zoom +/- buttons live right next to
    it, see the markup) rather than only once actually zoomed, since it's the
    permanent home for the zoom control now, not an extra that only earns
    its place once zoomed. At 1x its window simply spans the whole strip,
    same as a browser scrollbar's thumb filling the track when there's
    nothing to scroll. A/B's own position is echoed as a tick so they stay
    visible even when zoomed away from them entirely.
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
    updateLoopReadout();
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
    const dur = playerDuration();
    if (dur <= 0) return;
    zoomLevel = stepZoom(zoomLevel, direction);
    const center = player && playerReady && player.getCurrentTime ? player.getCurrentTime() : (viewStart + viewEnd) / 2;
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

  function togglePlayPause() {
    if (!player || !playerReady) return;
    if (isPlaying) player.pauseVideo();
    else player.playVideo();
  }

  function updateSpeedLabel() {
    const label = byId("inspirationSpeedValue");
    if (!label) return;
    const rate = player && playerReady && player.getPlaybackRate ? player.getPlaybackRate() : 1;
    label.textContent = `${Math.round(rate * 100) / 100}×`;
  }

  function resetLoopState() {
    loopA = null;
    loopB = null;
    loopEnabled = false;
    loopDragging = null;
    overviewDragging = null;
    shareResumeAt = null;
    zoomLevel = ZOOM_LEVELS[0];
    viewStart = 0;
    viewEnd = 0; // recomputed to [0, duration] on the updateLoopUI() call below
    const bar = byId("inspirationLoopBar");
    if (bar) bar.hidden = false;
    if (player && playerReady && player.setPlaybackRate) player.setPlaybackRate(1);
    const played = byId("inspirationLoopPlayed");
    if (played) played.style.width = "0%";
    updateSpeedLabel();
    updateLoopUI();
  }

  function setLoopMarker(which) {
    if (!player || !playerReady) return;
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
    const span = normalizeLoop(loopA, loopB, LOOP_MIN_GAP);
    if (!span) return;
    loopEnabled = !loopEnabled;
    updateLoopUI();
    if (loopEnabled && player && playerReady) {
      const t = player.getCurrentTime();
      // Unlike the loop poll's seek-back (which only ever seeks to an A
      // that's already played, hence buffered), A here may never have
      // played at all — the markers can be dragged into a region the
      // player hasn't buffered yet — so this seek must be allowed to
      // request a new stream rather than silently no-op.
      if (t < span.a || t >= span.b) player.seekTo(span.a, true);
    }
  }

  function clearLoopMarkers() {
    loopA = null;
    loopB = null;
    loopEnabled = false;
    updateLoopUI();
  }

  function changeSpeed(direction) {
    if (!player || !playerReady) return;
    const rates = player.getAvailablePlaybackRates ? player.getAvailablePlaybackRates() : null;
    const current = player.getPlaybackRate ? player.getPlaybackRate() : 1;
    player.setPlaybackRate(stepPlaybackRate(current, direction, rates));
    updateSpeedLabel();
  }

  // ---- wiring ----------------------------------------------------

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
      if (!player || !playerReady || viewEnd <= viewStart) return;
      player.seekTo(viewFractionToTime(trackFraction(track, e), viewStart, viewEnd), true);
    });
    track.addEventListener("pointermove", (e) => {
      if (!loopDragging) return;
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
    });
    track.addEventListener("pointerup", (e) => {
      if (!loopDragging) return;
      loopDragging = null;
      if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId);
      updateLoopUI();
    });
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
      const handle = e.target.closest?.(".inspiration-loop-overview-handle");
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

  // ---- panel size ------------------------------------------------

  function updateSizeButtonIcon() {
    const icon = byId("inspirationSizeBtn")?.querySelector("span");
    if (!icon) return;
    const atMax = panelWidth >= PANEL_WIDTHS[PANEL_WIDTHS.length - 1];
    icon.className = atMax
      ? "fa-solid fa-down-left-and-up-right-to-center"
      : "fa-solid fa-up-right-and-down-left-from-center";
  }

  // The single writer for the panel width: clamp it, put it on the element,
  // keep the size button's icon honest and (optionally) persist it.
  function setPanelWidth(panel, width, persist) {
    panelWidth = clampWidth(width);
    panel.style.width = `${panelWidth}px`;
    updateSizeButtonIcon();
    if (persist) writePref(PREF_KEYS.inspirationWidth, String(panelWidth));
    clampPanelIntoView(panel);
  }

  function readStoredWidth() {
    const stored = Number(readPref(PREF_KEYS.inspirationWidth));
    if (Number.isFinite(stored) && stored >= MIN_PANEL_WIDTH) return Math.min(stored, maxPanelWidth());
    return PANEL_WIDTHS[0];
  }

  // The size button jumps to the next preset wider than the current width
  // (which may be an in-between value left by an edge drag), wrapping round.
  function cyclePanelSize(panel) {
    const next = PANEL_WIDTHS.find((w) => w > panelWidth + 1) ?? PANEL_WIDTHS[0];
    setPanelWidth(panel, next, true);
  }

  // Drag the panel's left edge to resize. The right edge stays put: a
  // corner-anchored panel is held there by its CSS `right`, a dragged one by
  // rewriting `left` as the width changes.
  function initResize(panel, handle) {
    let resize = null;
    handle.addEventListener("pointerdown", (e) => {
      const rect = panel.getBoundingClientRect();
      resize = { right: rect.right, positioned: Boolean(panel.style.left) };
      handle.setPointerCapture(e.pointerId);
      panel.classList.add("resizing");
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!resize) return;
      // Never let a positioned panel's left edge cross the viewport margin.
      const ceiling = resize.positioned ? resize.right - EDGE_MARGIN : maxPanelWidth();
      panelWidth = Math.min(clampWidth(resize.right - e.clientX), ceiling);
      panel.style.width = `${panelWidth}px`;
      if (resize.positioned) panel.style.left = `${resize.right - panelWidth}px`;
      updateSizeButtonIcon();
    });
    handle.addEventListener("pointerup", (e) => {
      if (!resize) return;
      resize = null;
      panel.classList.remove("resizing");
      if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      writePref(PREF_KEYS.inspirationWidth, String(panelWidth));
      clampPanelIntoView(panel);
    });
  }

  function init() {
    const panel = byId("inspirationPanel");
    const header = byId("inspirationPanelHeader");
    if (!panel || !header) return;
    initLoopBar();
    initOverview();
    on("inspirationCloseBtn", "click", closePanel);
    on("inspirationShareBtn", "click", copyShareLink);
    on("inspirationSizeBtn", "click", () => cyclePanelSize(panel));
    setPanelWidth(panel, readStoredWidth(), false);
    initDrag(panel, header);
    const resizeHandle = byId("inspirationResizeHandle");
    if (resizeHandle) initResize(panel, resizeHandle);
  }

  return { updateLink, applyShareState, init };
}
