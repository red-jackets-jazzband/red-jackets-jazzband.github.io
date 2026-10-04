import { byId, on } from "../lib/dom.js";

/*
  The sheet's "full screen" toggle: #sheetFullscreenBtn (content/songs.md)
  is a small floating button hovering over .rj-sheet-paper's own top-right
  corner, styled in split.css (.rj-sheet-fullscreen-btn), rather than living
  in the #sheetmenu toolbar. body.rj-sheet-fullscreen plus the rules in
  split.css pin the whole .rj-songs-layout over the viewport. On a mouse-only
  device (no touchscreen at all) it additionally asks for the real Fullscreen
  API so the browser chrome goes away too. Any device with a coarse pointer
  stays CSS-only: mobile browsers suspend pinch-zoom for as long as a genuine
  fullscreen element is active, which would defeat the point of a mode built
  for reading a dense chart up close. See split.css's own doc comment
  for the portrait/landscape layout split.
*/
const FULLSCREEN_CLASS = "rj-sheet-fullscreen";

const isActive = () => document.body.classList.contains(FULLSCREEN_CLASS);

const nativeFullscreenElement = () => document.fullscreenElement || null;

function wantsNativeFullscreen() {
  return typeof document.documentElement.requestFullscreen === "function"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(pointer: fine)").matches
    && !window.matchMedia("(any-pointer: coarse)").matches;
}

const ignore = () => {};

// Refusal (or no support) is fine — the CSS-only mode still works. Starting
// from a resolved promise also turns a synchronous throw into a rejection.
function enterNativeFullscreen() {
  if (!wantsNativeFullscreen() || nativeFullscreenElement()) return;
  Promise.resolve().then(() => document.documentElement.requestFullscreen()).catch(ignore);
}

function exitNativeFullscreen() {
  if (!nativeFullscreenElement() || typeof document.exitFullscreen !== "function") return;
  Promise.resolve().then(() => document.exitFullscreen()).catch(ignore);
}

export function createFullscreen() {
  let wakeLock = null;

  // Best-effort only: not every browser implements the Wake Lock API (and
  // Safari didn't before iOS 16.4) — without it, this mode just falls back
  // to the device's normal screen-auto-lock timeout.
  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      // Full screen may have been exited while the request was in flight —
      // releaseWakeLock() had nothing to release yet, so drop the late lock
      // here instead of leaving the screen held awake.
      if (!isActive()) {
        lock.release().catch(ignore);
        return;
      }
      wakeLock = lock;
      lock.addEventListener("release", () => { if (wakeLock === lock) wakeLock = null; });
    } catch {
      // Denied (backgrounded tab, battery saver, unsupported) — harmless.
      wakeLock = null;
    }
  }

  function releaseWakeLock() {
    const lock = wakeLock;
    wakeLock = null;
    if (lock) lock.release().catch(ignore);
  }

  function apply(active) {
    document.body.classList.toggle(FULLSCREEN_CLASS, active);
    const btn = byId("sheetFullscreenBtn");
    if (btn) {
      const label = active ? "Exit full screen" : "Full screen";
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.classList.toggle("active", active);
      const icon = btn.querySelector(".fa-solid");
      if (icon) icon.className = `fa-solid ${active ? "fa-compress" : "fa-expand"}`;
    }
    if (active) {
      enterNativeFullscreen();
      requestWakeLock().catch(ignore);
    } else {
      exitNativeFullscreen();
      releaseWakeLock();
    }
    // The class flip changes the sheet's available width without the window
    // itself resizing, so nothing would re-fit the chord table (sheet.js
    // listens for "resize") and it would keep its old, narrow zoom. Fire one
    // once the new layout has been applied.
    requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  }

  function toggle() {
    apply(!isActive());
  }

  function init() {
    on("sheetFullscreenBtn", "click", toggle);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (isActive()) apply(false);
    });
    // In native fullscreen the browser swallows Escape itself and only
    // reports it here.
    document.addEventListener("fullscreenchange", () => {
      if (!nativeFullscreenElement() && isActive()) apply(false);
    });
    // The Wake Lock spec releases the lock automatically the moment the tab
    // is backgrounded (or the device screen locks); re-request it once the
    // page is visible again so leaving full screen up across a phone
    // lock/unlock still keeps the screen on afterwards.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible"
        && isActive()) {
        requestWakeLock().catch(ignore);
      }
    });
  }

  return { init, toggle };
}
