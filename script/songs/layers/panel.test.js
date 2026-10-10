import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
import { createLayersPanel } from "./panel.js";

const row = (id) => document.querySelector(`.rj-layer-row[data-layer="${id}"]`);
const sw = (id) => row(id).querySelector(".rj-layer-switch");
const click = (node) => node.dispatchEvent(new window.Event("click", { bubbles: true }));

function setup(overrides = {}) {
  const page = mountPage();
  const ctx = makeCtx(overrides);
  const layers = createLayersPanel(ctx);
  layers.init();
  return { ctx, layers, cleanup: page.cleanup };
}

test("one row per layer, grouped, each with its preview", () => {
  const { cleanup } = setup();
  try {
    const groups = [...document.querySelectorAll(".rj-layer-group")].map((g) => g.textContent);
    assert.deepEqual(groups, ["Harmony", "Performance"]);
    assert.ok(row("progressions").querySelector(".rj-layer-preview svg"));
    assert.ok(row("fingerings").querySelector(".rj-layer-preview svg"));
    assert.equal(row("progressions").querySelector(".rj-layer-label").textContent, "Named progressions");
  } finally {
    cleanup();
  }
});

test("the tab opens the panel, the close button and Escape close it", () => {
  const { ctx, cleanup } = setup();
  try {
    const tab = document.getElementById("layersTab");
    const panel = document.getElementById("layersPanel");
    assert.equal(panel.hidden, true);
    click(tab);
    assert.equal(ctx.store.get("layers").layersOpen, true);
    assert.equal(panel.hidden, false);
    assert.equal(tab.getAttribute("aria-expanded"), "true");
    assert.ok(document.body.classList.contains("rj-layers-open"));
    click(document.getElementById("layersCloseBtn"));
    assert.equal(panel.hidden, true);
    click(tab);
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    assert.equal(panel.hidden, true);
    assert.ok(!document.body.classList.contains("rj-layers-open"));
  } finally {
    cleanup();
  }
});

test("a row toggles its layer in the store, and the sheet re-renders", () => {
  const { ctx, cleanup } = setup({ state: { instrument: "trumpet" } });
  try {
    let renders = 0;
    ctx.sheet.rerender = () => {
      renders += 1;
    };
    click(row("fingerings"));
    assert.equal(ctx.store.get("layers").activeLayers.fingerings, true);
    assert.equal(sw("fingerings").getAttribute("aria-checked"), "true");
    assert.ok(row("fingerings").classList.contains("is-on"));
    const badge = document.getElementById("layersTabCount");
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, "1");
    click(sw("fingerings"));
    assert.equal(ctx.store.get("layers").activeLayers.fingerings, false, "the switch's click toggles once, not twice");
    assert.equal(badge.hidden, true);
    assert.equal(renders, 2, "each switch re-renders the sheet once");
  } finally {
    cleanup();
  }
});

test("fingerings are greyed out for a non-brass instrument but keep their setting", () => {
  const { ctx, cleanup } = setup({ state: { instrument: "trumpet" } });
  try {
    click(row("fingerings"));
    ctx.store.set("settings", { instrument: "alto_saxophone" });
    assert.equal(sw("fingerings").disabled, true);
    assert.equal(sw("fingerings").getAttribute("aria-checked"), "false");
    assert.match(row("fingerings").querySelector(".rj-layer-hint").textContent, /Not for Alto Saxophone/);
    click(row("fingerings"));
    assert.equal(ctx.store.get("layers").activeLayers.fingerings, true, "an unavailable row ignores clicks");
    ctx.store.set("settings", { instrument: "trombone" });
    assert.equal(sw("fingerings").getAttribute("aria-checked"), "true");
  } finally {
    cleanup();
  }
});

test("Reset all switches everything off", () => {
  const { ctx, cleanup } = setup({ state: { instrument: "trumpet" } });
  try {
    click(row("fingerings"));
    click(row("progressions"));
    click(document.getElementById("layersResetBtn"));
    assert.deepEqual(ctx.store.get("layers").activeLayers, { progressions: false, fingerings: false });
  } finally {
    cleanup();
  }
});
