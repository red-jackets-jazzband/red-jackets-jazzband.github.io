import { byId, el } from "../lib/dom.js";
import { readPref, writePref, PREF_KEYS } from "../lib/preferences.js";
import { INSTRUMENTS } from "../lib/instruments.js";
import { COMPING_PATTERNS } from "../lib/comping.js";

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

  select.addEventListener("change", () => {
    writePref(PREF_KEYS.comping, select.value);
    ctx.sheet.rerender();
  });

  slot.append(dropdown(select));
}
