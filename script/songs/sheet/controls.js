import { byId, el, on, qsa } from "../../lib/core/dom.js";
import { TEMPO_STEP } from "../../lib/music/tempo.js";
import { tl } from "../../lib/core/i18n.js";
import { BACKGROUND } from "../core/state.js";

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
// comping, solo and practice pickers, the Repeat stepper). A view of
// ctx.state.advancedOpen (sticky), drawn as `.show-advanced` on #sheetmenu.
// What's picked there keeps playing with the drawer closed, so a closed
// drawer's button carries a small gold badge counting the extra staves on
// the sheet (Comping, Solo, Practice) — a reminder of where they're switched.
function initAdvancedToggle(ctx) {
  const btn = byId("advancedToggleBtn");
  const menu = byId("sheetmenu");
  if (!btn || !menu) return;
  const badge = el("span", { class: "sheet-advanced-badge", attrs: { "aria-hidden": "true" } });
  badge.hidden = true;
  btn.append(badge);

  const draw = () => {
    const open = ctx.state.advancedOpen;
    const { compingActive, soloActive, practiceActive } = ctx.state;
    const active = [compingActive, soloActive, practiceActive].filter(Boolean).length;
    menu.classList.toggle("show-advanced", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    badge.hidden = open || active === 0;
    badge.textContent = String(active);
    let title = tl("controls_more", "More controls");
    if (open) title = tl("controls_fewer", "Fewer controls");
    else if (active > 0) title = tl("controls_more_active", "More controls ({count} on)", { count: active });
    btn.title = title;
  };
  draw();
  ctx.store.subscribe("settings", draw);
  ctx.store.subscribe("tune", draw);

  btn.addEventListener("click", () => {
    ctx.state.advancedOpen = !ctx.state.advancedOpen;
  });
}

// A -/+ press on any stepper (Key, Tempo, Repeat) reads the new value out
// ("3 semitones", "132 bpm"): the value sits in an <input> or a plain span,
// neither of which a screen reader announces by itself when it changes. Only
// presses speak, so opening a song doesn't. Listens on the stepper, so it
// runs after the button's own handler has updated the value.
function stepperReadout(stepper) {
  const input = stepper.querySelector("input");
  const value = input ? input.value : stepper.querySelector(".sheet-stepper-value span").textContent;
  const unit = stepper.querySelector(".sheet-stepper-label");
  return unit ? `${value} ${unit.textContent.trim()}` : value;
}

// How long the live region stays empty before the readout goes back in.
const ANNOUNCE_DELAY_MS = 50;

// The region is emptied, then refilled in a later task: a press at a limit
// (Key at +12) leaves the readout unchanged, and writing the same text again
// isn't a change a screen reader announces. A newer press cancels a pending
// refill, so only the latest value is spoken.
function initStepperAnnouncements() {
  qsa(".sheet-stepper").forEach((stepper) => {
    const live = stepper.querySelector(".sheet-stepper-announce");
    if (!live) return;
    let pending = null;
    stepper.addEventListener("click", (e) => {
      if (!e.target.closest(".sheet-stepper-btn")) return;
      clearTimeout(pending);
      live.textContent = "";
      const readout = stepperReadout(stepper);
      pending = setTimeout(() => {
        pending = null;
        live.textContent = readout;
      }, ANNOUNCE_DELAY_MS);
    });
  });
}

// The Key stepper (#transpose): a view of ctx.state.transpose, in semitones.
// Typing into it or the -/+ buttons (which nudge it and dispatch "input",
// see stepNumericField) write the store; a newly opened song seeds the
// store, and the field follows. The write is tagged BACKGROUND: re-engraving
// takes a good half second on an old iPad, and drawn in the click it froze
// the page — the field's own new number included — once per press. In the
// background the number moves at once, and a burst of presses engraves once.
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
    const transpose = Math.round(n);
    if (transpose !== ctx.state.transpose) ctx.store.set("settings", { transpose }, BACKGROUND);
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
  initStepperAnnouncements();
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
