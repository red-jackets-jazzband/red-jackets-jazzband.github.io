import { byId, el } from "../../lib/core/dom.js";
import { INSTRUMENTS } from "../../lib/music/instruments.js";
import { COMPING_PATTERNS } from "../../lib/music/comping.js";
import { SOLO_STYLES } from "../../lib/music/solo.js";
import { COMPING_PARTS } from "./state.js";

function dropdown(select) {
  return el("div", { class: "dropdown" }, select);
}

/*
  The Instrument <select> (#instrument): the chart is transposed and clef-set
  for whichever instrument is chosen. Lives in the sheet's button bar (#sheetStatus,
  falling back to #sheetmenu) right next to Key / Tempo / Play. A view of
  ctx.state.instrument (songs/sheet/state.js, sticky across songs): a pick
  writes the store, and the select redraws from it.
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

  const draw = () => {
    if (select.value !== ctx.state.instrument) select.value = ctx.state.instrument;
  };
  draw();
  ctx.store.subscribe("settings", draw);

  select.addEventListener("change", () => {
    ctx.state.instrument = select.value;
  });

  const mount = byId("sheetStatus") || byId("sheetmenu");
  if (mount) mount.append(dropdown(select));
}

/*
  The comping-pattern <select> (#comping): an "OFF" entry plus the 15
  predefined patterns from lib/comping.js, grouped into optgroups. A view of
  ctx.state.comping (sticky across songs); sheet.js turns the pattern into
  the coloured block-chord comping staff.
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

  const split = createCompingSplit(ctx);
  const draw = () => {
    if (select.value !== ctx.state.comping) select.value = ctx.state.comping;
    split.draw();
  };
  select.addEventListener("change", () => {
    ctx.state.comping = select.value;
  });

  slot.append(dropdown(select), ...split.nodes);
  draw();
  ctx.store.subscribe("settings", draw);
}

const ARIA_PRESSED = "aria-pressed";

/*
  The Split button next to the comping dropdown (#compingSplitBtn) and the
  R / 3 / 5 toggles (.comping-part-btn) it reveals: split replaces the one
  block-chord staff with a single-note staff per chord tone, and the toggles
  pick which of those staves are drawn — e.g. just the 3 and the 5 to print.
  Views of ctx.state.compingSplit / compingParts (sticky across songs). At
  least one tone always stays selected. Both are hidden while comping is
  off; the toggles also while it isn't split.
*/
function createCompingSplit(ctx) {
  const splitBtn = el("button", {
    type: "button", class: "sheet-icon-btn", id: "compingSplitBtn",
    attrs: {
      [ARIA_PRESSED]: "false",
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
      [ARIA_PRESSED]: "false",
      title: `Show the ${name} voice`,
    },
  }));
  group.append(...partBtns);

  function draw() {
    const { comping, compingSplit, compingParts } = ctx.state;
    const on = comping !== "off";
    splitBtn.setAttribute(ARIA_PRESSED, String(compingSplit));
    splitBtn.hidden = !on;
    splitBtn.classList.toggle("active", compingSplit);
    group.hidden = !(on && compingSplit);
    partBtns.forEach((btn, index) => btn.setAttribute(ARIA_PRESSED, String(compingParts.includes(index))));
  }

  splitBtn.addEventListener("click", () => {
    ctx.state.compingSplit = !ctx.state.compingSplit;
  });
  partBtns.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      const parts = ctx.state.compingParts;
      const pressed = parts.includes(index);
      if (pressed && parts.length === 1) return;
      ctx.state.compingParts = pressed
        ? parts.filter((p) => p !== index)
        : [...parts, index].sort((a, b) => a - b);
    });
  });

  return { nodes: [splitBtn, group], draw };
}

/*
  The solo <select> (#solo), built the same way as the comping one: an "OFF"
  entry plus one entry per solo style from lib/solo.js — a view of
  ctx.state.solo. Creating it switches ctx.state.soloEnabled on (until then
  sheet.js ignores the stored pick); sheet.js evolves the line and adds it as
  another staff (and the Mixer mutes the lead while it plays).
*/
export function createSoloDropdown(ctx) {
  const slot = byId("soloSlot");
  if (!slot) return;

  const select = el("select", { class: "dropbtn", id: "solo" },
    el("option", { value: "off", text: "SOLO: OFF" }));
  for (const style of SOLO_STYLES) {
    select.append(el("option", { value: style.value, text: style.label.toUpperCase() }));
  }

  ctx.state.soloEnabled = true;
  const draw = () => {
    if (select.value !== ctx.state.solo) select.value = ctx.state.solo;
  };
  draw();
  ctx.store.subscribe("settings", draw);

  select.addEventListener("change", () => {
    ctx.state.solo = select.value;
  });

  // Progress of the background composing (written by sheet.js).
  const status = el("span", {
    class: "sheet-solo-status", id: "soloStatus", attrs: { role: "status", "aria-live": "polite" },
  });
  slot.append(dropdown(select), status);
}
