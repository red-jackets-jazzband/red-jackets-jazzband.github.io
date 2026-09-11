import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { createInspiration } from "./inspiration.js";

const SAMPLE_URL = "https://youtu.be/abcdefghijk";
const ARIA_PRESSED = "aria-pressed";

function inDom(fn) {
  const page = mountPage();
  try {
    return fn(page);
  } finally {
    page.cleanup();
  }
}

// Mounts the mocked window.YT.Player every LoopTube-timeline test needs
// (getCurrentTime/getDuration/seekTo/etc.) without driving the actual open
// sequence — for the one test below (the shared-link one) that has to
// interleave its own assertions between mounting the mock and firing
// onReady. `overrides` patches individual player methods (e.g. a mutable
// getCurrentTime, a seekTo/playVideo/pauseVideo that records its calls).
// Returns { ready, state }, the two event callbacks the real onReady/
// onStateChange wire up once FakePlayer is actually constructed.
function mockYouTubePlayer(window, overrides = {}) {
  const events = {};
  window.YT = {
    Player: function FakePlayer(_el, opts) {
      events.ready = opts.events.onReady;
      events.state = opts.events.onStateChange;
      this.loadVideoById = () => {};
      this.stopVideo = () => {};
      this.getCurrentTime = () => 0;
      this.getDuration = () => 200;
      this.getPlaybackRate = () => 1;
      this.getAvailablePlaybackRates = () => [0.5, 1, 2];
      this.setPlaybackRate = () => {};
      this.seekTo = () => {};
      Object.assign(this, overrides);
    },
    PlayerState: { PLAYING: 1 },
  };
  return events;
}

// Mounts the mock (see above), opens the panel through the normal
// Inspiration-button click, and fires onReady so the track/A/B/zoom
// controls are live — the sequence every test but the shared-link one
// needs. The caller still owns `delete window.YT` and `page.cleanup()` in
// its own finally. Returns `insp` (rarely needed — most tests only ever
// drive the panel through its DOM) and `fireState`, a helper for simulating
// the player's onStateChange (e.g. `fireState(YT_PLAYING)`).
async function openLoopPanel(window, overrides = {}) {
  const events = mockYouTubePlayer(window, overrides);
  const insp = createInspiration();
  insp.init();
  insp.updateLink(SAMPLE_URL, "X");
  document.getElementById("inspirationLink").dispatchEvent(new window.Event("click"));
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  events.ready();
  return { insp, fireState: (data) => events.state({ data }) };
}

// Opens the panel already zoomed to 4x ([75,125] of a 200s clip, playhead
// at 100) with the overview strip primed to a 1px == 1s scale, for the three
// overview-drag tests below — they differ only in what they grab and where
// they drag it to.
async function openZoomedOverview(window) {
  await openLoopPanel(window, { getCurrentTime: () => 100 });
  const zoomIn = document.getElementById("inspirationZoomIn");
  zoomIn.dispatchEvent(new window.Event("click")); // 2x -> [50,150]
  zoomIn.dispatchEvent(new window.Event("click")); // 4x -> [75,125]
  const overview = document.getElementById("inspirationLoopOverview");
  overview.getBoundingClientRect = () => ({ left: 0, width: 200 });
  return overview;
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
    const seeks = [];
    const events = mockYouTubePlayer(window, { seekTo: (t) => seeks.push(t) });
    const insp = createInspiration();
    insp.init();
    insp.applyShareState({ a: 12, b: 30 });
    insp.updateLink(SAMPLE_URL, "X");

    assert.equal(document.getElementById("inspirationPanel").hidden, false);
    assert.equal(
      document.getElementById("inspirationLoopToggle").getAttribute(ARIA_PRESSED), "true",
    );

    await new Promise((resolve) => { setTimeout(resolve, 0); });
    events.ready();
    // The shared start point (loop A) lands only once the video is playing,
    // not on onReady — a replacement video wouldn't have re-fired onReady.
    assert.deepEqual(seeks, []);
    events.state({ data: 1 });

    assert.deepEqual(seeks, [12]);
    assert.equal(document.getElementById("inspirationLoopHandleA").style.left, "6%");
    assert.equal(document.getElementById("inspirationLoopHandleB").style.left, "15%");
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("the play/pause button drives the player and its icon follows player state", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    const calls = [];
    const { fireState } = await openLoopPanel(window, {
      playVideo: () => calls.push("play"),
      pauseVideo: () => calls.push("pause"),
    });

    const toggle = document.getElementById("inspirationPlayToggle");
    const icon = toggle.querySelector("span");
    assert.equal(icon.className, "fa-solid fa-play");
    assert.equal(toggle.getAttribute("aria-label"), "Play");
    assert.equal(toggle.classList.contains("playing"), false);

    // Not playing yet -> the click should ask the player to start.
    toggle.dispatchEvent(new window.Event("click"));
    assert.deepEqual(calls, ["play"]);

    // The player reports it's now playing -> the button flips to pause and
    // picks up the same solid-gold .playing look as the sheet's own Play
    // button (.sheet-play-btn.playing) while actually playing.
    fireState(1);
    assert.equal(icon.className, "fa-solid fa-pause");
    assert.equal(toggle.getAttribute("aria-label"), "Pause");
    assert.equal(toggle.classList.contains("playing"), true);

    // Playing -> the next click should ask the player to pause.
    toggle.dispatchEvent(new window.Event("click"));
    assert.deepEqual(calls, ["play", "pause"]);

    // Any non-playing state (e.g. paused) flips the icon back.
    fireState(2);
    assert.equal(icon.className, "fa-solid fa-play");
    assert.equal(toggle.getAttribute("aria-label"), "Play");
    assert.equal(toggle.classList.contains("playing"), false);
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("zoom in narrows the timeline window around the current playhead", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    let currentTime = 100;
    await openLoopPanel(window, { getCurrentTime: () => currentTime });

    const zoomOut = document.getElementById("inspirationZoomOut");
    const zoomIn = document.getElementById("inspirationZoomIn");
    const zoomValue = document.getElementById("inspirationZoomValue");
    assert.equal(zoomValue.textContent, "1×");
    assert.equal(zoomOut.disabled, true); // already the widest view

    // A 200s clip, playhead at 100s -> smack in the middle either way, so a
    // marker placed here reads 50% before and after zooming in.
    document.getElementById("inspirationSetA").dispatchEvent(new window.Event("click"));
    assert.equal(document.getElementById("inspirationLoopHandleA").style.left, "50%");

    zoomIn.dispatchEvent(new window.Event("click")); // -> 2x, window [50, 150]
    assert.equal(zoomValue.textContent, "2×");
    assert.equal(zoomOut.disabled, false);
    assert.equal(document.getElementById("inspirationLoopHandleA").style.left, "50%");

    // A marker outside the now-narrower window is hidden, not clamped to an
    // edge (which would look like a real, wrong marker).
    currentTime = 199;
    document.getElementById("inspirationSetB").dispatchEvent(new window.Event("click"));
    assert.equal(document.getElementById("inspirationLoopHandleB").hidden, true);
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("zoom in/out buttons disable at ZOOM_LEVELS' ends", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    await openLoopPanel(window, { getCurrentTime: () => 100 });

    const zoomOut = document.getElementById("inspirationZoomOut");
    const zoomIn = document.getElementById("inspirationZoomIn");
    const zoomValue = document.getElementById("inspirationZoomValue");

    for (let i = 0; i < 10; i += 1) zoomIn.dispatchEvent(new window.Event("click"));
    assert.equal(zoomValue.textContent, "32×"); // ZOOM_LEVELS' last entry
    assert.equal(zoomIn.disabled, true);
    assert.equal(zoomOut.disabled, false);

    for (let i = 0; i < 10; i += 1) zoomOut.dispatchEvent(new window.Event("click"));
    assert.equal(zoomValue.textContent, "1×");
    assert.equal(zoomOut.disabled, true);
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("the overview window covers the full strip at 1x and narrows once zoomed, echoing A/B ticks", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    let currentTime = 100;
    await openLoopPanel(window, { getCurrentTime: () => currentTime });

    // Always part of the progress bar, not hidden until zoomed: at 1x the
    // window simply spans the whole strip.
    const win = document.getElementById("inspirationOverviewWindow");
    assert.equal(win.style.left, "0%");
    assert.equal(win.style.width, "100%");

    document.getElementById("inspirationSetA").dispatchEvent(new window.Event("click")); // A=100
    currentTime = 150;
    document.getElementById("inspirationSetB").dispatchEvent(new window.Event("click")); // B=150
    currentTime = 100;

    document.getElementById("inspirationZoomIn").dispatchEvent(new window.Event("click")); // 2x -> [50,150]

    assert.equal(win.style.left, "25%"); // 50/200
    assert.equal(win.style.width, "50%"); // (150-50)/200

    const tickA = document.getElementById("inspirationOverviewTickA");
    const tickB = document.getElementById("inspirationOverviewTickB");
    assert.equal(tickA.hidden, false);
    assert.equal(tickA.style.left, "50%"); // 100/200
    assert.equal(tickB.hidden, false);
    assert.equal(tickB.style.left, "75%"); // 150/200
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("the overview strip's played marker tracks the playhead against the full clip, not the zoomed view", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    let currentTime = 0;
    let tick = null;
    window.setInterval = (fn) => { tick = fn; return 1; };
    window.clearInterval = () => { tick = null; };

    const { fireState } = await openLoopPanel(window, { getCurrentTime: () => currentTime });
    const overviewPlayed = document.getElementById("inspirationOverviewPlayed");
    assert.equal(overviewPlayed.style.width, "0%");

    fireState(1); // PLAYING — starts the loop poll
    assert.ok(tick, "loop poll should be running");

    currentTime = 50; // 50/200 of the 200s clip
    tick();
    assert.equal(overviewPlayed.style.width, "25%");

    // Zoom in around the current playhead — the zoomed timeline's own played
    // bar would now read differently (it's relative to the narrower view),
    // but the overview marker still reads against the whole clip.
    document.getElementById("inspirationZoomIn").dispatchEvent(new window.Event("click"));
    currentTime = 100; // 100/200
    tick();
    assert.equal(overviewPlayed.style.width, "50%");
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("dragging the overview window's body pans it without changing the zoom level", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    const overview = await openZoomedOverview(window);
    const win = document.getElementById("inspirationOverviewWindow");

    // Grab the window at its own center (t=100) and drag 20px/20s right.
    win.dispatchEvent(new window.PointerEvent("pointerdown", { pointerId: 1, clientX: 100, bubbles: true }));
    overview.dispatchEvent(new window.PointerEvent("pointermove", { pointerId: 1, clientX: 120 }));

    assert.equal(document.getElementById("inspirationZoomValue").textContent, "4×"); // unchanged
    assert.equal(win.style.left, "47.5%"); // 95/200
    assert.equal(win.style.width, "25%"); // 50/200, same width as before the drag
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("dragging an overview handle resizes the window and snaps zoom to the nearest level", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    const overview = await openZoomedOverview(window);
    const startHandle = document.getElementById("inspirationOverviewHandleStart");

    // Drag the start edge from 75 out to 25 -> a 100s span, anchored on the
    // unmoved end (125) -> snaps to the nearest ZOOM_LEVELS entry, 2x.
    startHandle.dispatchEvent(new window.PointerEvent("pointerdown", { pointerId: 1, clientX: 75, bubbles: true }));
    overview.dispatchEvent(new window.PointerEvent("pointermove", { pointerId: 1, clientX: 25 }));

    assert.equal(document.getElementById("inspirationZoomValue").textContent, "2×");
    const win = document.getElementById("inspirationOverviewWindow");
    assert.equal(win.style.left, "12.5%"); // 25/200
    assert.equal(win.style.width, "50%"); // 100/200
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("clicking the overview strip's background jumps the window there", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    const overview = await openZoomedOverview(window);

    overview.dispatchEvent(new window.PointerEvent("pointerdown", { pointerId: 1, clientX: 10 }));

    assert.equal(document.getElementById("inspirationZoomValue").textContent, "4×"); // unchanged
    const win = document.getElementById("inspirationOverviewWindow");
    assert.equal(win.style.left, "0%");
    assert.equal(win.style.width, "25%"); // 50/200
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("Left/Right arrow keys on the overview strip pan it, same width", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    const overview = await openZoomedOverview(window);
    const win = document.getElementById("inspirationOverviewWindow");

    overview.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }));
    assert.equal(win.style.left, "40%"); // 80/200
    assert.equal(win.style.width, "25%"); // unchanged (50/200)

    overview.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft" }));
    overview.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft" }));
    assert.equal(win.style.left, "35%"); // 70/200 — one step right, two back left
    assert.equal(win.style.width, "25%");
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("Up/Down arrow keys on the overview strip zoom, same as the +/- buttons", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    const overview = await openZoomedOverview(window);
    const zoomValue = document.getElementById("inspirationZoomValue");

    overview.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp" }));
    assert.equal(zoomValue.textContent, "8×");

    overview.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown" }));
    overview.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown" }));
    assert.equal(zoomValue.textContent, "2×");
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("Home/End on the overview strip jump the window to the clip's start/end", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    const overview = await openZoomedOverview(window);
    const win = document.getElementById("inspirationOverviewWindow");

    overview.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home" }));
    assert.equal(win.style.left, "0%");
    assert.equal(win.style.width, "25%"); // 50/200, same width as before jumping

    overview.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End" }));
    assert.equal(win.style.left, "75%"); // 150/200
    assert.equal(win.style.width, "25%");
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("dragging a handle near the zoomed timeline's edge pans the window", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    await openLoopPanel(window, { getCurrentTime: () => 100 });

    document.getElementById("inspirationSetA").dispatchEvent(new window.Event("click")); // A=100
    const zoomIn = document.getElementById("inspirationZoomIn");
    zoomIn.dispatchEvent(new window.Event("click")); // 2x -> [50, 150]
    zoomIn.dispatchEvent(new window.Event("click")); // 4x -> [75, 125]

    const track = document.getElementById("inspirationLoopTrack");
    track.getBoundingClientRect = () => ({ left: 0, width: 200 });
    const handleA = document.getElementById("inspirationLoopHandleA");

    // Grab handle A (currently at 50% of [75,125], i.e. t=100) and drag to
    // the track's left edge — inside EDGE_PAN_THRESHOLD of it.
    handleA.dispatchEvent(new window.PointerEvent("pointerdown", { pointerId: 1, clientX: 100, bubbles: true }));
    track.dispatchEvent(new window.PointerEvent("pointermove", { pointerId: 1, clientX: 2 }));

    // The window panned left (toward 0) by one EDGE_PAN_STEP rather than
    // trapping the drag at the pre-pan [75,125] floor: without panning, 1%
    // into that window would land on 75.5s ("1:15"); with it, the window has
    // shifted to [65,115] and 1% into that lands on 65.5s ("1:05") instead.
    assert.equal(document.getElementById("inspirationSetATime").textContent, "1:05");
    assert.equal(document.getElementById("inspirationZoomValue").textContent, "4×"); // zoom level itself is untouched by panning
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("setting point B auto-enables the loop toggle once A and B form a span", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    let currentTime = 0;
    const seeks = [];
    await openLoopPanel(window, { getCurrentTime: () => currentTime, seekTo: (t, allowSeekAhead) => seeks.push([t, allowSeekAhead]) });

    const toggle = document.getElementById("inspirationLoopToggle");
    assert.equal(toggle.getAttribute(ARIA_PRESSED), "false");

    currentTime = 10;
    document.getElementById("inspirationSetA").dispatchEvent(new window.Event("click"));
    assert.equal(toggle.getAttribute(ARIA_PRESSED), "false"); // A alone isn't a loop yet

    currentTime = 20;
    document.getElementById("inspirationSetB").dispatchEvent(new window.Event("click"));
    assert.equal(toggle.getAttribute(ARIA_PRESSED), "true"); // B completes the span — auto-armed
    // Same seek-back-to-A the toggle button itself does when turned on by
    // hand — allowSeekAhead=true, since A may not have played yet (unlike
    // the loop poll's own repeat-seek, which only ever targets an A that's
    // already buffered).
    assert.deepEqual(seeks, [[10, true]]);

    // A later Set B press just moves B — already looping, so it isn't
    // re-toggled off.
    currentTime = 25;
    document.getElementById("inspirationSetB").dispatchEvent(new window.Event("click"));
    assert.equal(toggle.getAttribute(ARIA_PRESSED), "true");
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("setting point B too close to A to form a loop doesn't enable the toggle", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    let currentTime = 0;
    await openLoopPanel(window, { getCurrentTime: () => currentTime });

    currentTime = 10;
    document.getElementById("inspirationSetA").dispatchEvent(new window.Event("click"));
    currentTime = 10.5; // under LOOP_MIN_GAP — not a playable span
    document.getElementById("inspirationSetB").dispatchEvent(new window.Event("click"));

    const toggle = document.getElementById("inspirationLoopToggle");
    assert.equal(toggle.getAttribute(ARIA_PRESSED), "false");
    assert.equal(toggle.disabled, true);
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

// Regression test for a real YouTube IFrame API quirk (see the loopTick doc
// comment): a repeat-seek can leave the player silently stalled at A —
// reporting itself as still playing, with getCurrentTime() frozen, and no
// onStateChange firing to trigger a recovery. The explicit playVideo() after
// the seek is the backstop for that; this also pins the seek itself back to
// allowSeekAhead=true (a prior version used false to avoid flashing the
// native controls, which turned out to cause exactly this stall).
test("the loop poll's repeat-seek forces a resume so the loop survives more than one repeat", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    let currentTime = 0;
    const seeks = [];
    const plays = [];
    let tick = null;
    window.setInterval = (fn) => { tick = fn; return 1; };
    window.clearInterval = () => { tick = null; };

    const { fireState } = await openLoopPanel(window, {
      getCurrentTime: () => currentTime,
      seekTo: (t, allowSeekAhead) => {
        seeks.push([t, allowSeekAhead]);
        currentTime = t;
        // Simulates the real-world stall: the seek alone leaves the player
        // reporting paused rather than continuing playback on its own.
        fireState(0);
      },
      playVideo: () => { plays.push(true); fireState(1); },
    });

    currentTime = 10;
    document.getElementById("inspirationSetA").dispatchEvent(new window.Event("click"));
    currentTime = 20;
    document.getElementById("inspirationSetB").dispatchEvent(new window.Event("click"));

    fireState(1); // PLAYING — starts the loop poll
    assert.ok(tick, "loop poll should be running");

    currentTime = 19.95; // within shouldLoopSeek's lead of B
    tick();
    assert.deepEqual(seeks, [[10, true], [10, true]]);
    assert.equal(plays.length, 1, "playVideo must be called to force the resume");
    assert.ok(tick, "the poll must still be running after the forced resume");

    // A second repeat must still work — this is what regressed without the
    // playVideo() call: the first repeat's stall permanently stopped the poll.
    currentTime = 19.95;
    tick();
    assert.deepEqual(seeks.at(-1), [10, true]);
    assert.equal(plays.length, 2);
  } finally {
    delete window.YT;
    page.cleanup();
  }
});

test("clicking the timeline to seek while paused moves the played bar immediately, not just on the next loop-poll tick", async () => {
  const page = mountPage();
  const { window } = page;
  try {
    const seeks = [];
    await openLoopPanel(window, {
      getCurrentTime: () => 0,
      getDuration: () => 200,
      seekTo: (t) => seeks.push(t),
    });
    // No fireState(PLAYING) here — the player stays paused, so the loop poll
    // (the only other thing that normally drives these bars) never starts.

    const track = document.getElementById("inspirationLoopTrack");
    track.getBoundingClientRect = () => ({ left: 0, width: 200 });
    track.dispatchEvent(new window.PointerEvent("pointerdown", { pointerId: 1, clientX: 100 })); // 50% of 200s

    assert.deepEqual(seeks, [100]);
    assert.equal(document.getElementById("inspirationLoopPlayed").style.width, "50%");
    assert.equal(document.getElementById("inspirationOverviewPlayed").style.width, "50%");
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
