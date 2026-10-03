import { byId, el } from "../lib/dom.js";
import { readPref, writePref, PREF_KEYS } from "../lib/preferences.js";
import { INSTRUMENTS } from "../lib/instruments.js";
import { COMPING_PATTERNS } from "../lib/comping.js";
import { SOLO_STYLES } from "../lib/solo.js";

function dropdown(select) {
  return el("div", { class: "dropdown" }, select);
}

/*
  The Instrument <select> (#instrument): the chart is transposed and clef-set
  for whichever instrument is chosen. Lives in the sheet's button bar (#sheetStatus,
  falling back to #sheetmenu) right next to Key / Tempo / Play. The choice is
  sticky across songs; changing it re-renders the sheet.
*/
export function createInstrumentDropdown(ctx) {
  const select = el("select", {
    class: "dropbtn",
    id: "instrument",
    // aria-label only — a stray text node leaks into the styleable
    // (appearance: base-select) picker as a phantom first row.
    attrs: { "aria-label": "Instrument" },
  }, INSTRUMENTS.map((instrument) => el("option", {
    value: instrument.value,
    text: instrument.label.toUpperCase(),
  })));

  const stored = readPref(PREF_KEYS.instrument);
  if (stored && INSTRUMENTS.some((instrument) => instrument.value === stored)) {
    select.value = stored;
  }

  select.addEventListener("change", () => {
    writePref(PREF_KEYS.instrument, select.value);
    ctx.sheet.rerender();
  });

  const mount = byId("sheetStatus") || byId("sheetmenu");
  if (mount) mount.append(dropdown(select));
}

/*
  The comping-pattern <select> (#comping): an "OFF" entry plus the 15
  predefined patterns from lib/comping.js, grouped into optgroups. Changing it
  re-renders the current song, where sheet.js turns the pattern into the
  coloured block-chord comping staff. Sticky across songs.
*/
export function createCompingDropdown(ctx) {
  const slot = byId("compingSlot");
  if (!slot) return;

  const select = el("select", { class: "dropbtn", id: "comping" },
    el("option", { value: "off", text: "COMPING: OFF" }));

  const groups = new Map();
  for (const pattern of COMPING_PATTERNS) {
    if (!groups.has(pattern.group)) {
      const optgroup = el("optgroup", { label: pattern.group.toUpperCase() });
      groups.set(pattern.group, optgroup);
      select.append(optgroup);
    }
    groups.get(pattern.group).append(
      el("option", { value: pattern.value, text: pattern.label.toUpperCase() }),
    );
  }

  const stored = readPref(PREF_KEYS.comping);
  const known = stored === "off" || COMPING_PATTERNS.some((p) => p.value === stored);
  if (stored && known) select.value = stored;

  const split = createCompingSplit(ctx, select);
  select.addEventListener("change", () => {
    writePref(PREF_KEYS.comping, select.value);
    split.sync();
    ctx.sheet.rerender();
  });

  slot.append(dropdown(select), ...split.nodes);
  split.sync();
}

const COMPING_PARTS = ["R", "3", "5"];
const ARIA_PRESSED = "aria-pressed";

/*
  The Split button next to the comping dropdown (#compingSplitBtn) and the
  R / 3 / 5 toggles (.comping-part-btn) it reveals: split replaces the one
  block-chord staff with a single-note staff per chord tone, and the toggles
  pick which of those staves are drawn — e.g. just the 3 and the 5 to print.
  State lives in aria-pressed (sheet.js reads it from there) and is sticky
  across songs. At least one tone always stays selected. Both are hidden
  while comping is off; the toggles also while it isn't split.
*/
function createCompingSplit(ctx, select) {
  const validStored = (readPref(PREF_KEYS.compingParts) || "").split(",").filter((p) => COMPING_PARTS.includes(p));
  const storedParts = validStored.length > 0 ? validStored : COMPING_PARTS;
  const splitBtn = el("button", {
    type: "button", class: "sheet-icon-btn", id: "compingSplitBtn",
    attrs: {
      [ARIA_PRESSED]: readPref(PREF_KEYS.compingSplit) === "1" ? "true" : "false",
      title: "Split comping into R / 3 / 5 voices",
      "aria-label": "Split comping into separate R, 3 and 5 voices",
    },
  }, el("span", { class: "fa-solid fa-diagram-predecessor", attrs: { "aria-hidden": "true" } }));
  const group = el("div", {
    class: "comping-parts", id: "compingParts", attrs: { role: "group", "aria-label": "Comping voices to show" },
  });
  const partBtns = COMPING_PARTS.map((name, index) => el("button", {
    type: "button", class: "comping-part-btn", text: name,
    attrs: {
      "data-part": String(index),
      [ARIA_PRESSED]: storedParts.includes(name) ? "true" : "false",
      title: `Show the ${name} voice`,
    },
  }));
  group.append(...partBtns);

  function sync() {
    const on = select.value !== "off";
    const split = splitBtn.getAttribute(ARIA_PRESSED) === "true";
    splitBtn.hidden = !on;
    splitBtn.classList.toggle("active", split);
    group.hidden = !(on && split);
  }
  function changed() {
    sync();
    ctx.sheet.rerender();
  }

  splitBtn.addEventListener("click", () => {
    const next = splitBtn.getAttribute(ARIA_PRESSED) !== "true";
    splitBtn.setAttribute(ARIA_PRESSED, String(next));
    writePref(PREF_KEYS.compingSplit, next ? "1" : "0");
    changed();
  });
  partBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const pressed = btn.getAttribute(ARIA_PRESSED) === "true";
      const stillOn = partBtns.filter((b) => b !== btn && b.getAttribute(ARIA_PRESSED) === "true");
      if (pressed && stillOn.length === 0) return;
      btn.setAttribute(ARIA_PRESSED, String(!pressed));
      writePref(
        PREF_KEYS.compingParts,
        partBtns.filter((b) => b.getAttribute(ARIA_PRESSED) === "true").map((b) => b.textContent).join(","),
      );
      changed();
    });
  });

  return { nodes: [splitBtn, group], sync };
}

/*
  The solo <select> (#solo), built the same way as the comping one: an "OFF"
  entry plus one entry per solo style from lib/solo.js. Changing it re-renders
  the current song, where sheet.js evolves the line and adds it as another
  staff (and the Mixer mutes the lead while it plays). Sticky across songs.
*/
export function createSoloDropdown(ctx) {
  const slot = byId("soloSlot");
  if (!slot) return;

  const select = el("select", { class: "dropbtn", id: "solo" },
    el("option", { value: "off", text: "SOLO: OFF" }));
  for (const style of SOLO_STYLES) {
    select.append(el("option", { value: style.value, text: style.label.toUpperCase() }));
  }

  const stored = readPref(PREF_KEYS.solo);
  if (stored && (stored === "off" || SOLO_STYLES.some((s) => s.value === stored))) {
    select.value = stored;
  }

  select.addEventListener("change", () => {
    writePref(PREF_KEYS.solo, select.value);
    ctx.sheet.rerender();
  });

  // Progress of the background composing (written by sheet.js).
  const status = el("span", {
    class: "sheet-solo-status", id: "soloStatus", attrs: { role: "status", "aria-live": "polite" },
  });
  slot.append(dropdown(select), status);
}
