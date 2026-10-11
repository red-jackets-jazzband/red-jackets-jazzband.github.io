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
    assert.deepEqual(groups, ["Harmony", "Melody", "Performance"]);
    assert.ok(row("progressions").querySelector(".rj-layer-preview svg"));
    assert.ok(row("fingerings").querySelector(".rj-layer-preview svg"));
    assert.ok(row("scale-degrees").querySelector(".rj-layer-preview svg"));
    assert.equal(row("progressions").querySelector(".rj-layer-label").textContent, "Named progressions");
  } finally {
    cleanup();
  }
});

test("the scale-degrees row credits Improvise for Real with a link", () => {
  const { cleanup } = setup();
  try {
    const link = row("scale-degrees").querySelector(".rj-layer-credit a");
    assert.equal(link.textContent, "Improvise for Real");
    assert.equal(link.getAttribute("href"), "https://www.improviseforreal.com/");
    assert.equal(link.getAttribute("target"), "_blank");
  } finally {
    cleanup();
  }
});

test("the tab opens the panel and collapses it again; so does Escape", () => {
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
    assert.equal(tab.getAttribute("aria-label"), "Layers");
    assert.equal(tab.title, "Close layers");
    click(tab);
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
    assert.deepEqual(ctx.store.get("layers").activeLayers, {
      progressions: false, "chord-skeleton": false, "outside-chords": false, "scale-degrees": false, solfege: false, fingerings: false,
    });
  } finally {
    cleanup();
  }
});

function fakeEvent(type, props) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.entries(props).forEach(([key, value]) => {
    Object.defineProperty(event, key, { value });
  });
  return event;
}

const pointer = (type, props) => fakeEvent(type, { pointerId: 1, pointerType: "touch", button: 0, ...props });
const touch = (type, y, timeStamp) => fakeEvent(type, {
  changedTouches: [{ identifier: 7, clientY: y }], timeStamp,
});

// A docked (phone-width) page with a grip and header on the sheet; the panel
// is wired after they exist, as in the real markup.
function dockedSheet({ pointerEvents }) {
  const { ctx, cleanup } = setup();
  const realMatchMedia = window.matchMedia;
  const realPointerEvent = window.PointerEvent;
  window.matchMedia = () => ({ matches: true });
  window.PointerEvent = pointerEvents ? function PointerEvent() {} : undefined;
  const panel = document.getElementById("layersPanel");
  const grip = document.createElement("div");
  grip.className = "rj-layers-grip";
  const head = document.createElement("div");
  head.className = "rj-layers-head";
  panel.prepend(head);
  panel.prepend(grip);
  grip.setPointerCapture = () => {};
  head.setPointerCapture = () => {};
  Object.defineProperty(panel, "offsetHeight", { value: 500 });
  createLayersPanel(ctx).init();
  ctx.store.set("layers", { layersOpen: true });
  return {
    ctx, grip, head,
    cleanup() {
      window.matchMedia = realMatchMedia;
      window.PointerEvent = realPointerEvent;
      cleanup();
    },
  };
}

const dragVar = () => document.body.style.getPropertyValue("--rj-layers-drag");

test("pulling the bottom sheet's grip down dismisses it; a short pull springs back", () => {
  const { ctx, grip, cleanup } = dockedSheet({ pointerEvents: true });
  try {
    grip.dispatchEvent(pointer("pointerdown", { clientY: 100, timeStamp: 0 }));
    grip.dispatchEvent(pointer("pointermove", { clientY: 130, timeStamp: 400 }));
    assert.equal(dragVar(), "30px");
    grip.dispatchEvent(pointer("pointerup", { clientY: 130, timeStamp: 900 }));
    assert.equal(ctx.store.get("layers").layersOpen, true);
    assert.equal(dragVar(), "");

    grip.dispatchEvent(pointer("pointerdown", { clientY: 100, timeStamp: 0 }));
    grip.dispatchEvent(pointer("pointermove", { clientY: 300, timeStamp: 300 }));
    grip.dispatchEvent(pointer("pointerup", { clientY: 300, timeStamp: 300 }));
    assert.equal(ctx.store.get("layers").layersOpen, false);
  } finally {
    cleanup();
  }
});

test("a tap closes the sheet from the grip, but not from the header's empty space", () => {
  const { ctx, grip, head, cleanup } = dockedSheet({ pointerEvents: true });
  try {
    head.dispatchEvent(pointer("pointerdown", { clientY: 50, timeStamp: 0 }));
    head.dispatchEvent(pointer("pointerup", { clientY: 50, timeStamp: 60 }));
    assert.equal(ctx.store.get("layers").layersOpen, true);

    // ...while a real pull from the header still dismisses it.
    head.dispatchEvent(pointer("pointerdown", { clientY: 50, timeStamp: 0 }));
    head.dispatchEvent(pointer("pointermove", { clientY: 260, timeStamp: 200 }));
    head.dispatchEvent(pointer("pointerup", { clientY: 260, timeStamp: 200 }));
    assert.equal(ctx.store.get("layers").layersOpen, false);

    ctx.store.set("layers", { layersOpen: true });
    grip.dispatchEvent(pointer("pointerdown", { clientY: 10, timeStamp: 0 }));
    grip.dispatchEvent(pointer("pointerup", { clientY: 10, timeStamp: 50 }));
    assert.equal(ctx.store.get("layers").layersOpen, false);
  } finally {
    cleanup();
  }
});

test("without Pointer Events (Safari 12) the same pull works from touch events", () => {
  const { ctx, grip, cleanup } = dockedSheet({ pointerEvents: false });
  try {
    grip.dispatchEvent(touch("touchstart", 100, 0));
    const move = touch("touchmove", 140, 100);
    grip.dispatchEvent(move);
    assert.equal(dragVar(), "40px");
    assert.equal(move.defaultPrevented, true, "the page doesn't scroll under the pull");
    grip.dispatchEvent(touch("touchend", 140, 1000));
    assert.equal(ctx.store.get("layers").layersOpen, true, "a short, slow pull springs back");

    grip.dispatchEvent(touch("touchstart", 100, 0));
    grip.dispatchEvent(touch("touchmove", 320, 200));
    grip.dispatchEvent(touch("touchend", 320, 200));
    assert.equal(ctx.store.get("layers").layersOpen, false);
  } finally {
    cleanup();
  }
});
