// The Inspiration panel's window behaviour: where it may sit (header drag,
// clamped on screen) and how wide it is (edge drag, or stepping through
// presets), with the chosen width persisted. Knows nothing about what the
// panel is playing.

import { byId } from "../../lib/core/dom.js";
import { PREF_KEYS, readPref, writePref } from "../../lib/core/preferences.js";

export const EDGE_MARGIN = 8; // px — how close to a window edge the panel may be dragged

// The panel (and the video with it — everything below the header is
// width-driven) can be resized by dragging its left edge, or stepped through
// these presets with the size button. MIN_PANEL_WIDTH floors both; the ceiling
// is the viewport minus the edge margin.
export const PANEL_WIDTHS = [320, 420, 540, 680];
const MIN_PANEL_WIDTH = 240;

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
export function initDrag(panel, header) {
  let drag = null;
  header.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".inspiration-panel-icon-btn, .inspiration-panel-tab")) return;
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

// The width state and everything that changes it. One instance per panel; the
// panel element is passed to each operation rather than captured so init order
// stays the caller's business.
export function createPanelSizer() {
  let panelWidth = PANEL_WIDTHS[0];

  function updateSizeButtonIcon() {
    const sizeBtn = byId("inspirationSizeBtn");
    const icon = sizeBtn && sizeBtn.querySelector("span");
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
    const wider = PANEL_WIDTHS.find((w) => w > panelWidth + 1);
    const next = wider === undefined ? PANEL_WIDTHS[0] : wider;
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

  return { setPanelWidth, readStoredWidth, cyclePanelSize, initResize };
}
