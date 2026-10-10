import { byId, on } from "../../lib/core/dom.js";
import { TEMPO_STEP } from "../../lib/music/tempo.js";
import { tl } from "../../lib/core/i18n.js";

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

function pad(n) {
  return String(n).padStart(2, "0");
}

// Today's date as YYYYMMDD (local time), the prefix on every print's title.
function printDateStamp(date = new Date()) {
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

// Nudge a stepper field's numeric value by delta and dispatch an "input"
// event, reusing whichever listener re-renders/persists that field — the Key
// stepper's #transpose (re-renders the chart and, for a personal setlist,
// writes the offset back into the setlist row) and the Repeat stepper's
// #repeatCount (ctx.audio.setRepeatCount does the clamping and persisting)
// both follow this same nudge-and-dispatch pattern.
function stepNumericField(id, delta, fallback) {
  const input = byId(id);
  if (!input) return;
  const next = Number(input.value || fallback) + delta;
  input.value = Math.max(Number(input.min), Math.min(Number(input.max), next));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// The double-chevron button that reveals the "advanced" controls (the
// comping dropdown, the Repeat stepper). A view of ctx.state.advancedOpen
// (sticky), drawn as `.show-advanced` on #sheetmenu; toggling re-renders so
// the comping staff appears with it.
function initAdvancedToggle(ctx) {
  const btn = byId("advancedToggleBtn");
  const menu = byId("sheetmenu");
  if (!btn || !menu) return;

  const draw = () => {
    const open = ctx.state.advancedOpen;
    menu.classList.toggle("show-advanced", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.title = open ? tl("controls_fewer", "Fewer controls") : tl("controls_more", "More controls");
  };
  draw();
  ctx.store.subscribe("settings", draw);

  btn.addEventListener("click", () => {
    ctx.state.advancedOpen = !ctx.state.advancedOpen;
  });
}

// The Key stepper (#transpose): a view of ctx.state.transpose, in semitones.
// Typing into it or the -/+ buttons (which nudge it and dispatch "input",
// see stepNumericField) write the store; a newly opened song seeds the
// store, and the field follows.
function initKeyStepper(ctx) {
  const input = byId("transpose");
  if (!input) return;
  const draw = () => {
    if (Number(input.value) !== ctx.state.transpose) input.value = String(ctx.state.transpose);
  };
  draw();
  ctx.store.subscribe("settings", draw);
  input.addEventListener("input", () => {
    const n = Number(input.value);
    if (!Number.isFinite(n)) return; // mid-typing ("-")
    ctx.state.transpose = Math.round(n);
  });
  on("keyUpBtn", "click", () => stepNumericField("transpose", 1, 0));
  on("keyDownBtn", "click", () => stepNumericField("transpose", -1, 0));
}

function initPrintLink() {
  on("printLink", "click", (e) => {
    e.preventDefault();
    clearBookletPrintState();
    const title = byId("songtitle");
    printWithTitle(title ? title.textContent.trim() : "");
  });
}

// True when Space belongs to the focused element rather than play/pause: a
// text field, a <select> (Space opens it) or a contentEditable. Buttons and
// links deliberately do NOT own it, so Space plays/pauses even while e.g. the
// Mixer or Full screen button has focus instead of toggling that button.
function ownsSpacebar(t) {
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"
    || t.isContentEditable;
}

function isPlainSpace(e) {
  if (e.key !== " " && e.key !== "Spacebar") return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return document.body.classList.contains("rj-sheet-active") && !ownsSpacebar(e.target);
}

/*
  Spacebar toggles play/pause while a sheet is open, matching every audio
  player's convention. preventDefault stops the page from scrolling; the keyup
  is cancelled too because a focused button fires its click on Space keyup
  (and Firefox ignores a cancelled keydown for that).
*/
function initSpacebarPlayPause(ctx) {
  document.addEventListener("keydown", (e) => {
    if (!isPlainSpace(e)) return;
    e.preventDefault();
    if (!e.repeat) ctx.audio.playPause();
  });
  document.addEventListener("keyup", (e) => {
    if (isPlainSpace(e)) e.preventDefault();
  });
}

/*
  Wire the sheet toolbar: the Key / Tempo steppers, the transport buttons, the
  "back to list" button, the advanced-controls toggle and the print link. The
  instrument / comping <select>s are built and wired in selects.js.
*/
export function initSheetControls(ctx) {
  initKeyStepper(ctx);
  on("tempoUpBtn", "click", () => ctx.audio.stepTempo(TEMPO_STEP));
  on("tempoDownBtn", "click", () => ctx.audio.stepTempo(-TEMPO_STEP));
  const repeatCountInput = byId("repeatCount");
  if (repeatCountInput) repeatCountInput.value = String(ctx.state.repeatCount);
  on("repeatCount", "input", () => ctx.audio.setRepeatCount(byId("repeatCount").value));
  on("repeatUpBtn", "click", () => stepNumericField("repeatCount", 1, 1));
  on("repeatDownBtn", "click", () => stepNumericField("repeatCount", -1, 1));
  on("playPauseBtn", "click", () => ctx.audio.playPause());
  on("stopBtn", "click", () => ctx.audio.stop());
  on("mixerBtn", "click", () => ctx.mixer.toggle());
  on("sheetBackBtn", "click", () => document.body.classList.remove("rj-sheet-active"));

  initAdvancedToggle(ctx);
  initPrintLink();
  initSpacebarPlayPause(ctx);
}
