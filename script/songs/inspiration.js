import { byId, on } from "../lib/dom.js";
import { youtubeEmbedUrl, extractYouTubeId } from "../lib/youtube.js";
import { PREF_KEYS, readPref, writePref } from "../lib/preferences.js";
import {
  formatClock, timeToFraction, fractionToTime, normalizeLoop,
  clampHandleDrag, stepPlaybackRate, loopLeadSeconds, shouldLoopSeek,
} from "../lib/looptube.js";

const LOOP_POLL_MS = 80;
const LOOP_MIN_GAP = 1; // seconds — the shortest loop the toggle will accept
const EDGE_MARGIN = 8; // px — how close to a window edge the panel may be dragged

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

function positionLoopHandle(el, value, dur) {
  if (!el) return;
  if (value === null || dur <= 0) {
    el.hidden = true;
    return;
  }
  el.style.left = `${timeToFraction(value, dur) * 100}%`;
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
  of leaving the page, plus a LoopTube toolbar under the video — A/B loop
  markers on a slim timeline, an endless A–B loop toggle (an ~80 ms poll that
  seekTo's back to A just before B, since YouTube has no native sub-range loop)
  and a playback-rate stepper. Driven through the YouTube IFrame Player API;
  the pure range/rate/clock maths is in lib/looptube.js.
*/
export function createInspiration(ctx) {
  let panelUrl = null;
  let apiPromise = null;
  let player = null;
  let playerReady = false;
  let pendingVideoId = null;
  let loopA = null;
  let loopB = null;
  let loopEnabled = false;
  let loopPollId = null;
  let loopDragging = null; // "a" | "b" | null
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
    const bar = byId("inspirationLoopBar");
    if (bar) bar.hidden = true;
    panelUrl = null;
  }

  function onPlayerStateChange(e) {
    const states = window.YT && window.YT.PlayerState;
    if (states && e.data === states.PLAYING) {
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
          player.seekTo(span.a, true);
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
    const dur = player && player.getDuration ? player.getDuration() : 0;
    played.style.width = `${timeToFraction(t, dur) * 100}%`;
  }

  function updateLoopRange(dur) {
    const range = byId("inspirationLoopRange");
    if (!range) return;
    if (loopA !== null && loopB !== null && dur > 0) {
      const fa = timeToFraction(Math.min(loopA, loopB), dur);
      const fb = timeToFraction(Math.max(loopA, loopB), dur);
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

  function updateLoopUI() {
    const dur = playerDuration();
    positionLoopHandle(byId("inspirationLoopHandleA"), loopA, dur);
    positionLoopHandle(byId("inspirationLoopHandleB"), loopB, dur);

    const setA = byId("inspirationSetA");
    const setB = byId("inspirationSetB");
    if (setA) setA.classList.toggle("armed", loopA !== null);
    if (setB) setB.classList.toggle("armed", loopB !== null);

    updateLoopRange(dur);
    updateLoopReadout();

    const canLoop = normalizeLoop(loopA, loopB, LOOP_MIN_GAP) !== null;
    if (!canLoop && loopEnabled) loopEnabled = false;
    const toggle = byId("inspirationLoopToggle");
    if (toggle) {
      toggle.disabled = !canLoop;
      toggle.setAttribute("aria-pressed", loopEnabled ? "true" : "false");
    }
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
    shareResumeAt = null;
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
  }

  function toggleLoopEnabled() {
    const span = normalizeLoop(loopA, loopB, LOOP_MIN_GAP);
    if (!span) return;
    loopEnabled = !loopEnabled;
    updateLoopUI();
    if (loopEnabled && player && playerReady) {
      const t = player.getCurrentTime();
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
    on("inspirationSetA", "click", () => setLoopMarker("a"));
    on("inspirationSetB", "click", () => setLoopMarker("b"));
    on("inspirationLoopToggle", "click", toggleLoopEnabled);
    on("inspirationLoopClear", "click", clearLoopMarkers);
    on("inspirationSpeedDown", "click", () => changeSpeed(-1));
    on("inspirationSpeedUp", "click", () => changeSpeed(1));

    const track = byId("inspirationLoopTrack");
    if (!track) return;
    track.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest && e.target.closest(".inspiration-loop-handle");
      if (handle) {
        loopDragging = handle.id === "inspirationLoopHandleB" ? "b" : "a";
        track.setPointerCapture(e.pointerId);
        return;
      }
      if (!player || !playerReady) return;
      const dur = playerDuration();
      if (dur > 0) player.seekTo(fractionToTime(trackFraction(track, e), dur), true);
    });
    track.addEventListener("pointermove", (e) => {
      if (!loopDragging) return;
      const dur = playerDuration();
      if (dur <= 0) return;
      const frac = trackFraction(track, e);
      let otherTime;
      if (loopDragging === "a") {
        otherTime = loopB === null ? dur : loopB;
      } else {
        otherTime = loopA === null ? 0 : loopA;
      }
      const otherFrac = timeToFraction(otherTime, dur);
      const clamped = clampHandleDrag(frac, otherFrac, loopDragging, LOOP_MIN_GAP / dur);
      const time = fractionToTime(clamped, dur);
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
