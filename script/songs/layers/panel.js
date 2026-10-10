/*
  The Layers panel: a collapsible panel on the sheet's right edge (a bottom
  sheet below 1024px) with one switch per lib/music/layers.js layer. It owns
  the `layers` slice (layers/state.js) and is a view of it: a switch writes
  activeLayers, the sheet re-renders itself from that (sheet.js's
  subscribeRerender), and the rows redraw from the store.

    #layersTab        the thin tab (desktop) / floating pill (mobile) that
                      opens the panel; its badge counts the layers that are on
    #layersPanel      the panel; rows are built into #layersList from LAYERS,
                      each with its preview cloned from
                      <template id="layerPreview-<id>">
    #layersBackdrop   mobile only: tapping it closes the bottom sheet

  A row whose layer doesn't apply to the current instrument (fingerings on a
  saxophone) is greyed out with a note instead — its switch keeps its stored
  value, so picking Trumpet again brings the fingerings straight back.

  setOpen(bool) is exposed for the tour, like the Mixer's.
*/
import { byId, clear, el } from "../../lib/core/dom.js";
import { LAYERS, activeLayers } from "../../lib/music/layers.js";
import { findInstrument, INSTRUMENTS } from "../../lib/music/instruments.js";
import { trackRightEdge } from "./edge.js";

function brassLabels() {
  return INSTRUMENTS.filter((i) => LAYERS.find((l) => l.id === "fingerings").availableFor(i.value)).map((i) => i.label);
}

function previewFor(id) {
  const template = byId(`layerPreview-${id}`);
  return template && template.content ? template.content.cloneNode(true) : null; // NOSONAR
}

// "A, B or C".
function orList(names) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

function unavailableHint(instrument) {
  const found = findInstrument(instrument);
  const names = orList(brassLabels());
  return `Not for ${found ? found.label : "this instrument"} — pick ${names} under Instrument.`;
}

// "<prefix><link>" — the row's click toggles the layer, so the link keeps its
// own click from bubbling up to it.
function buildCredit(credit) {
  if (!credit) return null;
  const link = el("a", { text: credit.text, attrs: { href: credit.href, target: "_blank", rel: "noopener" } });
  link.addEventListener("click", (event) => event.stopPropagation());
  return el("span", { class: "rj-layer-credit" }, [credit.prefix, link]);
}

function buildRow(layer, toggle) {
  const labelId = `layerLabel-${layer.id}`;
  const switchBtn = el("button", {
    type: "button",
    class: "rj-layer-switch",
    attrs: { role: "switch", "aria-checked": "false", "aria-labelledby": labelId },
  }, [el("span", { class: "rj-layer-knob", attrs: { "aria-hidden": "true" } })]);
  const hintText = el("span", { text: layer.hint });
  const credit = buildCredit(layer.credit);
  const hint = el("span", { class: "rj-layer-hint" }, credit ? [hintText, " ", credit] : [hintText]);
  const row = el("div", { class: "rj-layer-row", dataset: { layer: layer.id } }, [
    el("span", { class: "rj-layer-preview", attrs: { "aria-hidden": "true" } }, [previewFor(layer.id)]),
    el("span", { class: "rj-layer-text" }, [
      el("span", { class: "rj-layer-label", id: labelId, text: layer.label }),
      hint,
    ]),
    switchBtn,
  ]);
  // The whole row is the hit area; the switch's own click (and its
  // Enter/Space) bubbles up to here.
  row.addEventListener("click", () => {
    if (!switchBtn.disabled) toggle(layer.id);
  });
  return { row, switchBtn, hintText, credit, layer };
}

function buildList(listEl, toggle) {
  clear(listEl);
  const rows = [];
  let group = null;
  LAYERS.forEach((layer) => {
    if (layer.group !== group) {
      group = layer.group;
      listEl.append(el("div", { class: "rj-layer-group", text: group }));
    }
    const built = buildRow(layer, toggle);
    rows.push(built);
    listEl.append(built.row);
  });
  return rows;
}

function updateRow({ row, switchBtn, hintText, credit, layer }, active, instrument) {
  const available = layer.availableFor(instrument);
  const on = Boolean(active[layer.id]);
  switchBtn.setAttribute("aria-checked", on && available ? "true" : "false");
  switchBtn.disabled = !available;
  row.classList.toggle("is-on", on && available);
  row.classList.toggle("is-unavailable", !available);
  hintText.textContent = available ? layer.hint : unavailableHint(instrument);
  if (credit) credit.hidden = !available;
}

function updateCount(active, instrument) {
  const count = activeLayers(active, instrument).length;
  ["layersTabCount", "layersPanelCount"].forEach((id) => {
    const badge = byId(id);
    if (!badge) return;
    badge.textContent = count > 0 ? String(count) : "";
    badge.hidden = count === 0;
  });
  const tab = byId("layersTab");
  if (tab) tab.setAttribute("aria-label", count > 0 ? `Layers (${count} on)` : "Layers");
}

// The chord table measures its container, and the open panel narrows it —
// on desktop only (split.css): below that it's a bottom sheet over the page,
// and a resize there would only make the page re-settle its scroll.
const PUSHES_SHEET = "(min-width: 1025px)";

function announceResize() {
  if (window.matchMedia && window.matchMedia(PUSHES_SHEET).matches) window.dispatchEvent(new Event("resize")); // NOSONAR
}

function showOpen(open) {
  const panel = byId("layersPanel");
  const tab = byId("layersTab");
  const backdrop = byId("layersBackdrop");
  if (panel) panel.hidden = !open;
  if (backdrop) backdrop.hidden = !open;
  if (tab) tab.setAttribute("aria-expanded", open ? "true" : "false");
  document.body.classList.toggle("rj-layers-open", open);
  announceResize();
}

export function createLayersPanel(ctx) {
  let rows = [];

  function setOpen(open) {
    ctx.store.set("layers", { layersOpen: Boolean(open) });
  }

  function toggle(id) {
    const active = ctx.store.get("layers").activeLayers;
    ctx.store.set("layers", { activeLayers: { ...active, [id]: !active[id] } });
  }

  function resetAll() {
    const active = ctx.store.get("layers").activeLayers;
    const off = {};
    Object.keys(active).forEach((id) => {
      off[id] = false;
    });
    ctx.store.set("layers", { activeLayers: off });
  }

  function redraw() {
    const { activeLayers: active } = ctx.store.get("layers");
    const { instrument } = ctx.store.get("settings");
    rows.forEach((r) => updateRow(r, active, instrument));
    updateCount(active, instrument);
  }

  function onKeydown(event) {
    if (event.key === "Escape" && ctx.store.get("layers").layersOpen) setOpen(false);
  }

  function init() {
    const listEl = byId("layersList");
    if (!listEl) return;
    rows = buildList(listEl, toggle);
    const tab = byId("layersTab");
    if (tab) tab.addEventListener("click", () => setOpen(!ctx.store.get("layers").layersOpen));
    const close = byId("layersCloseBtn");
    if (close) {
      close.addEventListener("click", () => {
        setOpen(false);
        if (tab) tab.focus();
      });
    }
    const reset = byId("layersResetBtn");
    if (reset) reset.addEventListener("click", resetAll);
    const backdrop = byId("layersBackdrop");
    if (backdrop) backdrop.addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", onKeydown);

    ctx.store.subscribe("layers", (state, changed) => {
      if (changed.includes("activeLayers")) redraw();
      if (changed.includes("layersOpen")) showOpen(state.layersOpen);
    });
    ctx.store.subscribe("settings", (_settings, changed) => {
      if (changed.includes("instrument")) redraw();
    });
    // A newly drawn song can make the page scroll (or stop scrolling).
    const updateEdge = trackRightEdge(tab ? tab.parentElement : null);
    ctx.store.subscribe("tune", updateEdge);
    redraw();
    showOpen(ctx.store.get("layers").layersOpen);
  }

  return { init, setOpen, toggle };
}
