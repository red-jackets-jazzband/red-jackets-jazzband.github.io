import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { createInspiration } from "./inspiration.js";

const SAMPLE_URL = "https://youtu.be/abcdefghijk";

function inDom(fn) {
  const page = mountPage();
  try {
    return fn(page);
  } finally {
    page.cleanup();
  }
}

// Opens the panel, primes its bounding rect and starts a left-edge drag at
// clientX 480 (the panel's left edge) — shared by the resize tests below,
// which differ only in where the pointer moves to next.
function startResizeDrag(window) {
  window.localStorage.clear();
  const insp = createInspiration();
  insp.init();
  const panel = document.getElementById("inspirationPanel");
  const handle = document.getElementById("inspirationResizeHandle");
  panel.getBoundingClientRect = () => ({ right: 800, left: 480, width: 320, top: 100, bottom: 400, height: 300 });
  handle.dispatchEvent(new window.PointerEvent("pointerdown", { pointerId: 1, clientX: 480 }));
  return { insp, panel, handle };
}

test("updateLink creates the Inspiration button for a tune with a reference", () => {
  inDom(() => {
    const insp = createInspiration();
    insp.updateLink(SAMPLE_URL, "Louis Armstrong");
    const btn = document.getElementById("inspirationLink");
    assert.ok(btn);
    assert.equal(btn.textContent, "Inspiration");
    assert.equal(btn.dataset.url, SAMPLE_URL);
    assert.equal(btn.dataset.title, "Louis Armstrong");
    assert.ok(document.getElementById("inspirationSlot").contains(btn));
  });
});

test("updateLink updates the existing button in place, without duplicating it", () => {
  inDom(() => {
    const insp = createInspiration();
    insp.updateLink("https://youtu.be/one11111111", "One");
    insp.updateLink("https://youtu.be/two22222222", "Two");
    assert.equal(document.querySelectorAll("#inspirationLink").length, 1);
    assert.equal(document.getElementById("inspirationLink").dataset.url, "https://youtu.be/two22222222");
  });
});

test("updateLink(undefined) removes the button for a tune without a reference", () => {
  inDom(() => {
    const insp = createInspiration();
    insp.updateLink(SAMPLE_URL, "X");
    insp.updateLink(undefined);
    assert.equal(document.getElementById("inspirationLink"), null);
  });
});

test("opening the panel marks the Inspiration button active, closing it clears that", () => {
  inDom(() => {
    const insp = createInspiration();
    insp.init();
    insp.updateLink(SAMPLE_URL, "X");
    const btn = document.getElementById("inspirationLink");

    btn.dispatchEvent(new window.Event("click"));
    assert.equal(btn.classList.contains("active"), true);
    assert.equal(btn.getAttribute("aria-expanded"), "true");

    document.getElementById("inspirationCloseBtn").dispatchEvent(new window.Event("click"));
    assert.equal(btn.classList.contains("active"), false);
    assert.equal(btn.getAttribute("aria-expanded"), "false");
  });
});

test("updateLink recreating the button while the panel is already open marks it active immediately", () => {
  inDom(() => {
    const insp = createInspiration();
    insp.init();
    insp.updateLink(SAMPLE_URL, "X");
    document.getElementById("inspirationLink").dispatchEvent(new window.Event("click"));

    // Simulate navigating to a song without a reference (button removed)
    // while the panel keeps playing, then back to one that has one.
    insp.updateLink(undefined);
    insp.updateLink("https://youtu.be/zyxwvutsrqp", "Y");

    const btn = document.getElementById("inspirationLink");
    assert.equal(btn.classList.contains("active"), true);
  });
});

test("init wires the close button without a player attached", () => {
  inDom(() => {
    const insp = createInspiration();
    insp.init();
    const panel = document.getElementById("inspirationPanel");
    panel.hidden = false;
    document.getElementById("inspirationCloseBtn").dispatchEvent(new window.Event("click"));
    assert.equal(panel.hidden, true);
  });
});

test("closePanel drops a pending video id so a late onReady can't play into a hidden panel", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    let fireReady = null;
    const loaded = [];
    window.YT = {
      Player: function FakePlayer(_el, opts) {
        fireReady = opts.events.onReady;
        this.loadVideoById = (id) => loaded.push(id);
        this.stopVideo = () => {};
        this.getCurrentTime = () => 0;
        this.getPlaybackRate = () => 1;
      },
      PlayerState: { PLAYING: 1 },
    };
    const insp = createInspiration();
    insp.init();
    insp.updateLink("https://youtu.be/aaaaaaaaaaa", "A");
    const btn = document.getElementById("inspirationLink");

    // Open once: no player yet, so the frame src is set and the player is
    // attached on the next microtask — but onReady hasn't fired.
    btn.dispatchEvent(new window.Event("click"));
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    // Switch to another video while the player is still not ready: its id is
    // parked in pendingVideoId.
    btn.dataset.url = "https://youtu.be/bbbbbbbbbbb";
    btn.dispatchEvent(new window.Event("click"));

    // Close before the player becomes ready.
    document.getElementById("inspirationCloseBtn").dispatchEvent(new window.Event("click"));
    assert.equal(document.getElementById("inspirationPanel").hidden, true);

    // The late onReady must not start the parked video into the hidden panel.
    fireReady();
    assert.deepEqual(loaded, []);
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("the size button steps the panel width and wraps back round", () => {
  inDom(({ window }) => {
    window.localStorage.clear();
    const insp = createInspiration();
    insp.init();
    const panel = document.getElementById("inspirationPanel");
    const btn = document.getElementById("inspirationSizeBtn");

    assert.equal(panel.style.width, "320px");
    const widths = [];
    for (let i = 0; i < 4; i += 1) {
      btn.dispatchEvent(new window.Event("click"));
      widths.push(panel.style.width);
    }
    assert.deepEqual(widths, ["420px", "540px", "680px", "320px"]);
  });
});

test("init restores a persisted panel width", () => {
  inDom(({ window }) => {
    window.localStorage.setItem("rj.inspirationWidth", "540");
    const insp = createInspiration();
    insp.init();
    assert.equal(document.getElementById("inspirationPanel").style.width, "540px");
    window.localStorage.clear();
  });
});

test("dragging the left edge resizes the panel and persists the new width", () => {
  inDom(({ window }) => {
    const { panel, handle } = startResizeDrag(window);
    handle.dispatchEvent(new window.PointerEvent("pointermove", { pointerId: 1, clientX: 300 }));
    assert.equal(panel.style.width, "500px");

    handle.dispatchEvent(new window.PointerEvent("pointerup", { pointerId: 1, clientX: 300 }));
    assert.equal(window.localStorage.getItem("rj.inspirationWidth"), "500");
  });
});

test("a shared A/B link opens the video with the loop already set", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    let fireReady = null;
    let fireState = null;
    const seeks = [];
    window.YT = {
      Player: function FakePlayer(_el, opts) {
        fireReady = opts.events.onReady;
        fireState = opts.events.onStateChange;
        this.loadVideoById = () => {};
        this.stopVideo = () => {};
        this.getCurrentTime = () => 0;
        this.getDuration = () => 200;
        this.getPlaybackRate = () => 1;
        this.getAvailablePlaybackRates = () => [0.5, 1, 2];
        this.setPlaybackRate = () => {};
        this.seekTo = (t) => seeks.push(t);
      },
      PlayerState: { PLAYING: 1 },
    };
    const insp = createInspiration();
    insp.init();
    insp.applyShareState({ a: 12, b: 30 });
    insp.updateLink(SAMPLE_URL, "X");

    assert.equal(document.getElementById("inspirationPanel").hidden, false);
    assert.equal(
      document.getElementById("inspirationLoopToggle").getAttribute("aria-pressed"), "true",
    );

    await new Promise((resolve) => { setTimeout(resolve, 0); });
    fireReady();
    // The shared start point (loop A) lands only once the video is playing,
    // not on onReady — a replacement video wouldn't have re-fired onReady.
    assert.deepEqual(seeks, []);
    fireState({ data: 1 });

    assert.deepEqual(seeks, [12]);
    assert.equal(document.getElementById("inspirationLoopHandleA").style.left, "6%");
    assert.equal(document.getElementById("inspirationLoopHandleB").style.left, "15%");
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("the share button copies the link ctx.shareUrl builds from the markers", () => {
  inDom(({ window }) => {
    const copied = [];
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: (t) => { copied.push(t); return Promise.resolve(); } },
      configurable: true,
    });
    const seen = [];
    const ctx = {
      shareUrl: (markers) => {
        seen.push(markers);
        return "https://red-jackets.example/songs/#s=basin_street&i=1";
      },
    };
    const insp = createInspiration(ctx);
    insp.init();

    document.getElementById("inspirationShareBtn").dispatchEvent(new window.Event("click"));

    assert.deepEqual(seen, [{ a: null, b: null }]);
    assert.deepEqual(copied, ["https://red-jackets.example/songs/#s=basin_street&i=1"]);
  });
});

test("a rejected clipboard write falls back to a prompt and shows no success tick", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
      configurable: true,
    });
    let prompted = null;
    window.prompt = (_label, value) => { prompted = value; return value; };
    const insp = createInspiration({ shareUrl: () => "https://x/songs/#s=y&i=1" });
    insp.init();

    window.document.getElementById("inspirationShareBtn").dispatchEvent(new window.Event("click"));
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    assert.equal(prompted, "https://x/songs/#s=y&i=1");
    assert.equal(
      window.document.getElementById("inspirationShareBtn").classList.contains("copied"), false,
    );
  } finally {
    page.cleanup();
  }
});

test("edge resize floors the panel at MIN_PANEL_WIDTH", () => {
  inDom(({ window }) => {
    const { panel, handle } = startResizeDrag(window);
    handle.dispatchEvent(new window.PointerEvent("pointermove", { pointerId: 1, clientX: 790 }));
    assert.equal(panel.style.width, "240px");
  });
});
