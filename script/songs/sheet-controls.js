import { byId, on } from "../lib/dom.js";
import { readPref, writePref, PREF_KEYS } from "../lib/preferences.js";
import { TEMPO_STEP } from "../lib/tempo.js";

/*
  Strip any leftover setlist-booklet print classes from <body>. The setlist
  "Print …" buttons add these and remove them on "afterprint", but a stale
  class (or a browser that skips the event) would otherwise drag the last-built
  booklet into an unrelated single-song print.
*/
export function clearBookletPrintState() {
  const { classList } = document.body;
  classList.remove("export-booklet-mode");
  [...classList]
    .filter((cls) => cls.startsWith("export-mode-"))
    .forEach((cls) => classList.remove(cls));
}

// Today's date as YYYYMMDD (local time), the prefix on every print's title.
function printDateStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/*
  Print with `document.title` briefly set to `<YYYYMMDD>-<title>`, so the
  browser's print header and the "Save as PDF" default filename read as the
  song / setlist name (dated, so a saved PDF's filename shows which day's
  version it is) instead of the page's generic <title>. Restored on
  "afterprint" (the dialog is modal in desktop browsers, so the title is back
  before the user sees the page again); a browser that skips the event just
  keeps the nicer title until the next print, which is harmless.
*/
export function printWithTitle(title) {
  const original = document.title;
  if (title) document.title = `${printDateStamp()}-${title}`;
  window.addEventListener("afterprint", function restore() {
    document.title = original;
    window.removeEventListener("afterprint", restore);
  });
  window.print();
}

// Nudge the Key stepper's underlying #transpose value by one semitone and
// dispatch an "input" event, reusing the listeners that re-render the chart
// (and, for a personal setlist, write the offset back into the setlist row).
function stepTranspose(delta) {
  const input = byId("transpose");
  if (!input) return;
  const next = Number(input.value || 0) + delta;
  input.value = Math.max(Number(input.min), Math.min(Number(input.max), next));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// The double-chevron button that reveals the "advanced" controls (currently
// just the comping dropdown). State lives as `.show-advanced` on #sheetmenu and
// is persisted; toggling re-renders so the comping staff appears with it.
function initAdvancedToggle(ctx) {
  const btn = byId("advancedToggleBtn");
  const menu = byId("sheetmenu");
  if (!btn || !menu) return;

  const apply = (open) => {
    menu.classList.toggle("show-advanced", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.title = open ? "Fewer controls" : "More controls";
  };

  apply(readPref(PREF_KEYS.sheetAdvanced) === "1");

  btn.addEventListener("click", () => {
    const open = !menu.classList.contains("show-advanced");
    apply(open);
    writePref(PREF_KEYS.sheetAdvanced, open ? "1" : "0");
    ctx.sheet.rerender();
  });
}

function initPrintLink() {
  on("printLink", "click", (e) => {
    e.preventDefault();
    clearBookletPrintState();
    const title = byId("songtitle");
    printWithTitle(title ? title.textContent.trim() : "");
  });
}

/*
  Spacebar toggles play/pause while a sheet is open, matching every audio
  player's convention. Skipped when the caret is in a text field or the focus
  is on a button/link (so Space still activates the focused control instead of
  double-toggling), and preventDefault stops the page from scrolling.
*/
function initSpacebarPlayPause(ctx) {
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " && e.key !== "Spacebar") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!document.body.classList.contains("rj-sheet-active")) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"
      || t.isContentEditable || (t.closest && t.closest("button, a, [role=button]")))) {
      return;
    }
    e.preventDefault();
    ctx.audio.playPause();
  });
}

/*
  Wire the sheet toolbar: the Key / Tempo steppers, the transport buttons, the
  "back to list" button, the advanced-controls toggle and the print link. The
  instrument / comping <select>s are built and wired in selects.js.
*/
export function initSheetControls(ctx) {
  on("transpose", "input", () => ctx.sheet.rerender());
  on("keyUpBtn", "click", () => stepTranspose(1));
  on("keyDownBtn", "click", () => stepTranspose(-1));
  on("tempoUpBtn", "click", () => ctx.audio.stepTempo(TEMPO_STEP));
  on("tempoDownBtn", "click", () => ctx.audio.stepTempo(-TEMPO_STEP));
  on("playPauseBtn", "click", () => ctx.audio.playPause());
  on("stopBtn", "click", () => ctx.audio.stop());
  on("melodyOffBtn", "click", () => ctx.audio.toggleMelody());
  on("sheetBackBtn", "click", () => document.body.classList.remove("rj-sheet-active"));

  initAdvancedToggle(ctx);
  initPrintLink();
  initSpacebarPlayPause(ctx);
}
