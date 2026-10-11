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
function dockedSheet({ pointerEvents, open = true }) {
  const { cleanup } = mountPage();
  const ctx = makeCtx();
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
  const tab = document.getElementById("layersTab");
  grip.setPointerCapture = () => {};
  head.setPointerCapture = () => {};
  tab.setPointerCapture = () => {};
  Object.defineProperty(panel, "offsetHeight", { value: 500 });
  createLayersPanel(ctx).init();
  ctx.store.set("layers", { layersOpen: open });
  return {
    ctx, grip, head, tab,
    cleanup() {
      window.matchMedia = realMatchMedia;
      window.PointerEvent = realPointerEvent;
      cleanup();
    },
  };
}

const dragVar = () => document.body.style.getPropertyValue("--rj-layers-drag");
const panelEl = () => document.getElementById("layersPanel");
const isOpen = (ctx) => ctx.store.get("layers").layersOpen;
const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

// Runs `body(sheet)` on a docked sheet and always restores the page.
async function withDockedSheet(options, body) {
  const sheet = dockedSheet(options);
  try {
    await body(sheet);
  } finally {
    sheet.cleanup();
  }
}

// One gesture on `el`: down at `from`, a move to `to` (left out when `to` is
// undefined — a tap), up where it got to. `move`/`up` are the timestamps.
function pull(el, { from, to, start = 0, move = start + 200, up = move }) {
  el.dispatchEvent(pointer("pointerdown", { clientY: from, timeStamp: start }));
  if (to !== undefined) el.dispatchEvent(pointer("pointermove", { clientY: to, timeStamp: move }));
  el.dispatchEvent(pointer("pointerup", { clientY: to === undefined ? from : to, timeStamp: up }));
}

// The same with touch events (no Pointer Events, Safari 12); returns the move.
function touchPull(el, { from, to, move = 200, up = move }) {
  el.dispatchEvent(touch("touchstart", from, 0));
  const moveEvent = touch("touchmove", to, move);
  el.dispatchEvent(moveEvent);
  el.dispatchEvent(touch("touchend", to, up));
  return moveEvent;
}

test("pulling the bottom sheet's grip down dismisses it; a short pull springs back", () => withDockedSheet({ pointerEvents: true }, ({ ctx, grip }) => {
  grip.dispatchEvent(pointer("pointerdown", { clientY: 100, timeStamp: 0 }));
  grip.dispatchEvent(pointer("pointermove", { clientY: 130, timeStamp: 400 }));
  assert.equal(dragVar(), "30px");
  grip.dispatchEvent(pointer("pointerup", { clientY: 130, timeStamp: 900 }));
  assert.equal(isOpen(ctx), true);
  assert.equal(dragVar(), "");

  pull(grip, { from: 100, to: 300 });
  assert.equal(isOpen(ctx), false);
}));

test("a tap closes the sheet from the grip, but not from the header's empty space", () => withDockedSheet({ pointerEvents: true }, ({ ctx, grip, head }) => {
  pull(head, { from: 50, up: 60 });
  assert.equal(isOpen(ctx), true);

  // ...while a real pull from the header still dismisses it.
  pull(head, { from: 50, to: 260 });
  assert.equal(isOpen(ctx), false);

  ctx.store.set("layers", { layersOpen: true });
  pull(grip, { from: 10, up: 50 });
  assert.equal(isOpen(ctx), false);
}));

test("without Pointer Events (Safari 12) the same pull works from touch events", () => withDockedSheet({ pointerEvents: false }, ({ ctx, grip }) => {
  const move = touchPull(grip, { from: 100, to: 140, move: 100, up: 1000 });
  assert.equal(move.defaultPrevented, true, "the page doesn't scroll under the pull");
  assert.equal(isOpen(ctx), true, "a short, slow pull springs back");

  touchPull(grip, { from: 100, to: 320 });
  assert.equal(isOpen(ctx), false);
}));

test("pulling the closed sheet's tab up draws the sheet out and opens it; the click it ends in is swallowed", () => withDockedSheet({ pointerEvents: true, open: false }, ({ ctx, tab }) => {
  tab.dispatchEvent(pointer("pointerdown", { clientY: 600, timeStamp: 0 }));
  tab.dispatchEvent(pointer("pointermove", { clientY: 300, timeStamp: 200 }));
  assert.equal(panelEl().hidden, false, "the sheet shows under the finger");
  assert.equal(dragVar(), "200px", "500px tall, 300px of it pulled up");
  tab.dispatchEvent(pointer("pointerup", { clientY: 300, timeStamp: 200 }));
  click(tab);
  assert.equal(isOpen(ctx), true);
  assert.equal(dragVar(), "");
}));

// 60px up over most of a second: neither far nor quick enough to open.
const SHORT_SLOW_PULL = { from: 600, to: 540, move: 800, up: 900 };

test("a short, slow pull on the closed tab slides the sheet back down and hides it", () => withDockedSheet({ pointerEvents: true, open: false }, async ({ ctx, tab }) => {
  pull(tab, SHORT_SLOW_PULL);
  assert.equal(isOpen(ctx), false);
  assert.equal(dragVar(), "500px", "sliding back out of sight");
  await wait(250);
  assert.equal(panelEl().hidden, true);
  assert.equal(dragVar(), "");
}));

test("the open sheet's tab pulls it down to close; a tap on it is just its click", () => withDockedSheet({ pointerEvents: true }, ({ ctx, tab }) => {
  pull(tab, { from: 100, up: 50 });
  assert.equal(isOpen(ctx), true, "the tap itself doesn't close it...");
  click(tab);
  assert.equal(isOpen(ctx), false, "...its click does");

  ctx.store.set("layers", { layersOpen: true });
  pull(tab, { from: 100, to: 320 });
  click(tab);
  assert.equal(isOpen(ctx), false, "closed by the pull, not re-opened by its click");

  // A pull that ends in no click at all (touch) doesn't eat the next tap.
  ctx.store.set("layers", { layersOpen: true });
  pull(tab, { from: 100, to: 140, move: 900, up: 1000 });
  assert.equal(isOpen(ctx), true, "a short, slow pull springs back");
  pull(tab, { from: 100, start: 1200, up: 1250 });
  click(tab);
  assert.equal(isOpen(ctx), false, "the tap after it still toggles");
}));

test("without Pointer Events the tab pulls the sheet open from touch events", () => withDockedSheet({ pointerEvents: false, open: false }, ({ ctx, tab }) => {
  touchPull(tab, { from: 600, to: 300 });
  assert.equal(isOpen(ctx), true);
}));

test("a new pull on the tab while the sheet slides back starts clean, and the old timer can't hide it", () => withDockedSheet({ pointerEvents: true, open: false }, async ({ ctx, tab }) => {
  pull(tab, SHORT_SLOW_PULL);
  assert.equal(dragVar(), "500px", "sliding back");

  tab.dispatchEvent(pointer("pointerdown", { clientY: 600, timeStamp: 1000 }));
  assert.equal(dragVar(), "", "the new gesture starts with no offset");
  assert.equal(panelEl().hidden, true, "the cut-short slide back has hidden the sheet");
  tab.dispatchEvent(pointer("pointermove", { clientY: 300, timeStamp: 1200 }));
  await wait(250);
  assert.equal(panelEl().hidden, false, "the old timer doesn't hide the sheet mid-pull");
  assert.equal(dragVar(), "200px");
  tab.dispatchEvent(pointer("pointerup", { clientY: 300, timeStamp: 1200 }));
  assert.equal(isOpen(ctx), true);
}));
