import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { createFullscreen } from "./fullscreen.js";

// jsdom implements neither the Wake Lock API nor navigator.wakeLock; stub a
// fake one so requestWakeLock()/releaseWakeLock() have something to call.
function stubWakeLock({ rejects } = {}) {
  const calls = { requested: 0, released: 0 };
  const sentinel = {
    released: false,
    release() {
      calls.released += 1;
      this.released = true;
      return Promise.resolve();
    },
    addEventListener() {},
  };
  window.navigator.wakeLock = {
    request: (type) => {
      calls.requested += 1;
      if (rejects) return Promise.reject(new Error("denied"));
      assert.equal(type, "screen");
      return Promise.resolve(sentinel);
    },
  };
  return calls;
}

function setup() {
  const page = mountPage();
  const fullscreen = createFullscreen();
  fullscreen.init();
  return { page, fullscreen, cleanup: page.cleanup };
}

const isFullscreen = () => document.body.classList.contains("rj-sheet-fullscreen");

test("clicking the button toggles body.rj-sheet-fullscreen and the button's own state", () => {
  const { cleanup } = setup();
  try {
    const btn = document.getElementById("sheetFullscreenBtn");
    assert.equal(isFullscreen(), false);
    assert.equal(btn.getAttribute("aria-pressed"), "false");

    btn.dispatchEvent(new window.Event("click"));
    assert.equal(isFullscreen(), true);
    assert.equal(btn.getAttribute("aria-pressed"), "true");
    assert.equal(btn.title, "Exit full screen");
    assert.equal(btn.classList.contains("active"), true);
    assert.equal(btn.querySelector(".fa-solid").className, "fa-solid fa-compress");

    btn.dispatchEvent(new window.Event("click"));
    assert.equal(isFullscreen(), false);
    assert.equal(btn.getAttribute("aria-pressed"), "false");
    assert.equal(btn.title, "Full screen");
    assert.equal(btn.classList.contains("active"), false);
    assert.equal(btn.querySelector(".fa-solid").className, "fa-solid fa-expand");
  } finally {
    cleanup();
  }
});

test("Escape exits full screen but is a no-op when it isn't active", () => {
  const { cleanup } = setup();
  try {
    const escape = () => document.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    escape();
    assert.equal(isFullscreen(), false);

    document.getElementById("sheetFullscreenBtn").dispatchEvent(new window.Event("click"));
    assert.equal(isFullscreen(), true);
    escape();
    assert.equal(isFullscreen(), false);
  } finally {
    cleanup();
  }
});

test("entering full screen requests a screen wake lock, exiting releases it", async () => {
  const { cleanup } = setup();
  try {
    const calls = stubWakeLock();
    const btn = document.getElementById("sheetFullscreenBtn");

    btn.dispatchEvent(new window.Event("click"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls.requested, 1);

    btn.dispatchEvent(new window.Event("click"));
    assert.equal(calls.released, 1);
  } finally {
    cleanup();
  }
});

test("a wake lock that resolves after full screen was exited is released straight away", async () => {
  const { cleanup } = setup();
  try {
    const calls = { released: 0 };
    const sentinel = {
      release() {
        calls.released += 1;
        return Promise.resolve();
      },
      addEventListener() {},
    };
    let resolveRequest;
    window.navigator.wakeLock = {
      request: () => new Promise((resolve) => { resolveRequest = resolve; }),
    };
    const btn = document.getElementById("sheetFullscreenBtn");

    btn.dispatchEvent(new window.Event("click"));
    btn.dispatchEvent(new window.Event("click"));
    assert.equal(isFullscreen(), false);
    assert.equal(calls.released, 0);

    resolveRequest(sentinel);
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls.released, 1);
  } finally {
    cleanup();
  }
});

test("a denied wake lock request is swallowed rather than thrown", async () => {
  const { cleanup } = setup();
  try {
    stubWakeLock({ rejects: true });
    document.getElementById("sheetFullscreenBtn").dispatchEvent(new window.Event("click"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(isFullscreen(), true);
  } finally {
    cleanup();
  }
});

test("becoming visible again while still full screen re-requests the wake lock", async () => {
  const { cleanup } = setup();
  try {
    const calls = stubWakeLock();
    document.getElementById("sheetFullscreenBtn").dispatchEvent(new window.Event("click"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls.requested, 1);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new window.Event("visibilitychange"));
    await Promise.resolve();
    assert.equal(calls.requested, 2);
  } finally {
    cleanup();
  }
});
