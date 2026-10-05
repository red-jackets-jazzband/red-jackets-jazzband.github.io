import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
import { createAbcjsStub } from "../../../../tests/helpers/stubs.js";
import { GM_VOICES } from "../../lib/audio/gm-voices.js";
import { createOffline, WIDE_RANGE_ABC } from "./offline.js";

const SONG_INDEX = "Bourbon Street Parade,bourbon_street_parade.abc\nFive Foot Two,five_foot_two.abc\n"
  // A file listed twice under different alias names, the same shape
  // index_of_songs.txt itself uses (e.g. "Ain't my fault" / "It ain't my
  // fault" both pointing at aint_my_fault.abc) — must be fetched once, not
  // once per alias.
  + "St Louis Blues,st_louis_blues.abc\nSaint Louis Blues,st_louis_blues.abc\n";
const SETLIST_INDEX = "Setlist 2026,setlist_2026.txt\n";
const TOUR_MD = "# ui\n";

// `status` lets a test simulate an HTTP error response (fetch() resolves,
// doesn't reject, for those) alongside `failOn`'s network-error case.
function fakeFetch(calls, { failOn = [], status = {} } = {}) {
  return (path) => {
    calls.push(path);
    if (failOn.includes(path)) return Promise.reject(new Error("network error"));
    const statusCode = status[path] || 200;
    let body = "";
    if (path === "/songs/index_of_songs.txt") body = SONG_INDEX;
    else if (path === "/setlists/index_of_setlists.txt") body = SETLIST_INDEX;
    else if (path.startsWith("/tour/")) body = TOUR_MD;
    return Promise.resolve({
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      text: () => Promise.resolve(body),
    });
  };
}

// A minimal navigator.serviceWorker stub with a real listener list, so tests
// can simulate the "not controlling this page yet" race (waitForController
// in offline.js) by firing "controllerchange" themselves.
function makeServiceWorkerStub({ controller = {}, registerCalls = [] } = {}) {
  const listeners = new Set();
  return {
    register: (url, options) => {
      registerCalls.push({ url, options });
      return Promise.resolve({});
    },
    ready: Promise.resolve(),
    controller,
    addEventListener: (type, listener) => { if (type === "controllerchange") listeners.add(listener); },
    removeEventListener: (type, listener) => listeners.delete(listener),
    fireControllerChange(newController) {
      this.controller = newController;
      listeners.forEach((listener) => listener());
    },
  };
}

function setup({ serviceWorkerSupported = true, controller = {} } = {}) {
  const page = mountPage();
  const registerCalls = [];
  let swStub = null;
  if (serviceWorkerSupported) {
    swStub = makeServiceWorkerStub({ controller, registerCalls });
    navigator.serviceWorker = swStub;
  } else {
    delete navigator.serviceWorker;
  }
  const ctx = makeCtx();
  const offline = createOffline(ctx);
  return {
    page, ctx, offline, registerCalls, swStub, cleanup: page.cleanup,
  };
}

// A downloadForOffline() run stays inside its own many-await async chain
// long after any synchronous wrapper (stubs.js's withAbcjs included) would
// already have torn its stub down — so, unlike every other ABCJS-stubbing
// test in this suite, this file installs the stub for the run's whole
// (awaited) duration itself rather than reaching for that helper.
async function runWithAbcjs(stub, fn) {
  globalThis.ABCJS = stub;
  try {
    return await fn();
  } finally {
    delete globalThis.ABCJS;
  }
}

// A fake BeforeInstallPromptEvent — neither jsdom nor Node has a real one,
// and the only parts offline.js touches are preventDefault() (inherited
// from Event, works as-is on a real dispatched event) plus the two
// install-specific members, so a plain cancelable Event with those two
// stubbed on is a faithful enough double.
function makeInstallPromptEvent({ outcome = "accepted" } = {}) {
  const event = new window.Event("beforeinstallprompt", { cancelable: true });
  event.calls = { prompted: 0 };
  event.prompt = () => {
    event.calls.prompted += 1;
    return Promise.resolve();
  };
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

test("init() hides the button and never registers when serviceWorker isn't supported", () => {
  const {
    offline, registerCalls, cleanup,
  } = setup({ serviceWorkerSupported: false });
  try {
    offline.init();
    assert.equal(document.getElementById("offlineBtn").hidden, true);
    assert.equal(registerCalls.length, 0);
  } finally {
    cleanup();
  }
});

test("init() registers the service worker at /songs/ scope and wires the button", () => {
  const { offline, registerCalls, cleanup } = setup();
  try {
    offline.init();
    assert.equal(document.getElementById("offlineBtn").hidden, false);
    assert.equal(registerCalls.length, 1);
    assert.equal(registerCalls[0].url, "/sw.js");
    assert.deepEqual(registerCalls[0].options, { scope: "/songs/", type: "module" });
  } finally {
    cleanup();
  }
});

test("beforeinstallprompt is captured and suppressed, and offers install on the button", () => {
  const { offline, cleanup } = setup();
  try {
    offline.init();
    const btn = document.getElementById("offlineBtn");
    assert.equal(btn.title, "Download for offline");

    const event = makeInstallPromptEvent();
    window.dispatchEvent(event);

    assert.equal(event.defaultPrevented, true, "the browser's own install affordance should be suppressed");
    assert.equal(btn.title, "Install app & download for offline");
    assert.equal(btn.getAttribute("aria-label"), "Install app & download for offline");
  } finally {
    cleanup();
  }
});

test("downloadForOffline shows the captured install prompt first, then proceeds with the normal download", async () => {
  const { offline, cleanup } = setup();
  const fetchCalls = [];
  globalThis.fetch = fakeFetch(fetchCalls);
  try {
    offline.init();
    const event = makeInstallPromptEvent();
    window.dispatchEvent(event);

    await runWithAbcjs(createAbcjsStub(), () => offline.downloadForOffline());

    assert.equal(event.calls.prompted, 1);
    assert.ok(fetchCalls.includes("/songs/index_of_songs.txt"));
    assert.equal(document.getElementById("offlineStatus").textContent, "Available offline.");
    // The captured event is spent after one use — the button drops back to
    // a plain download affordance rather than offering an install that
    // would just throw if tried again.
    assert.equal(document.getElementById("offlineBtn").title, "Download for offline");
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("a captured install prompt is used at most once; a later download doesn't try to reuse it", async () => {
  const { offline, cleanup } = setup();
  globalThis.fetch = fakeFetch([]);
  try {
    offline.init();
    const event = makeInstallPromptEvent();
    window.dispatchEvent(event);

    await runWithAbcjs(createAbcjsStub(), () => offline.downloadForOffline());
    // The first run already consumed the captured prompt; a second,
    // separate download shouldn't try to call .prompt() on it again.
    await runWithAbcjs(createAbcjsStub(), () => offline.downloadForOffline());

    assert.equal(event.calls.prompted, 1);
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("appinstalled clears the captured prompt and reverts the button to a plain download affordance", () => {
  const { offline, cleanup } = setup();
  try {
    offline.init();
    window.dispatchEvent(makeInstallPromptEvent());
    const btn = document.getElementById("offlineBtn");
    assert.equal(btn.title, "Install app & download for offline");

    window.dispatchEvent(new window.Event("appinstalled"));
    assert.equal(btn.title, "Download for offline");
    assert.equal(btn.getAttribute("aria-label"), "Download for offline");
  } finally {
    cleanup();
  }
});

test("downloadForOffline fetches the indexes, every song/setlist/tour file, warms every curated voice, and reports status", async () => {
  const { offline, cleanup } = setup();
  const fetchCalls = [];
  globalThis.fetch = fakeFetch(fetchCalls);
  try {
    await runWithAbcjs(createAbcjsStub(), () => offline.downloadForOffline());

    assert.ok(fetchCalls.includes("/songs/index_of_songs.txt"));
    assert.ok(fetchCalls.includes("/setlists/index_of_setlists.txt"));
    assert.ok(fetchCalls.includes("/songs/bourbon_street_parade.abc"));
    assert.ok(fetchCalls.includes("/songs/five_foot_two.abc"));
    assert.ok(fetchCalls.includes("/setlists/setlist_2026.txt"));
    for (const lang of ["en", "nl", "de", "fr"]) {
      assert.ok(fetchCalls.includes(`/tour/tour.${lang}.md`));
    }

    assert.equal(document.getElementById("offlineStatus").textContent, "Available offline.");
    assert.equal(document.getElementById("offlineStatus").hidden, false);
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("downloadForOffline fetches a file listed under multiple aliases only once", async () => {
  const { offline, cleanup } = setup();
  const fetchCalls = [];
  globalThis.fetch = fakeFetch(fetchCalls);
  try {
    await runWithAbcjs(createAbcjsStub(), () => offline.downloadForOffline());

    const stLouisFetches = fetchCalls.filter((path) => path === "/songs/st_louis_blues.abc");
    assert.equal(stLouisFetches.length, 1);
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("downloadForOffline renders every curated GM voice through CreateSynth against the current soundfont", async () => {
  const { ctx, offline, cleanup } = setup();
  ctx.state.highQualityAudio = false;
  globalThis.fetch = fakeFetch([]);
  const stub = createAbcjsStub();
  try {
    await runWithAbcjs(stub, () => offline.downloadForOffline());
    assert.equal(stub.calls.createSynths.length, GM_VOICES.length);
    const programs = stub.calls.createSynths.map((c) => c.init.options.program).sort((a, b) => a - b);
    assert.deepEqual(programs, GM_VOICES.map((v) => v.value).sort((a, b) => a - b));
    stub.calls.createSynths.forEach((c) => {
      assert.match(c.init.options.soundFontUrl, /FatBoy/);
    });
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("downloadForOffline warms the high-quality soundfont set when that's the current preference", async () => {
  const { ctx, offline, cleanup } = setup();
  ctx.state.highQualityAudio = true;
  globalThis.fetch = fakeFetch([]);
  const stub = createAbcjsStub();
  try {
    await runWithAbcjs(stub, () => offline.downloadForOffline());
    stub.calls.createSynths.forEach((c) => {
      assert.match(c.init.options.soundFontUrl, /MusyngKite/);
    });
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("a failed fetch is skipped, not fatal, but the final status is honest about it", async () => {
  const { offline, cleanup } = setup();
  globalThis.fetch = fakeFetch([], { failOn: ["/songs/five_foot_two.abc"] });
  try {
    await runWithAbcjs(createAbcjsStub(), () => offline.downloadForOffline());
    const status = document.getElementById("offlineStatus").textContent;
    assert.notEqual(status, "Available offline.");
    assert.match(status, /1 item couldn't be downloaded/);
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("an HTTP error response on a library file counts as a failure too, not just a network error", async () => {
  const { offline, cleanup } = setup();
  globalThis.fetch = fakeFetch([], { status: { "/songs/five_foot_two.abc": 404 } });
  try {
    await runWithAbcjs(createAbcjsStub(), () => offline.downloadForOffline());
    assert.match(document.getElementById("offlineStatus").textContent, /1 item couldn't be downloaded/);
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("a 500 on the song index is treated as a failure, not parsed as an empty/garbage index", async () => {
  const { offline, cleanup } = setup();
  globalThis.fetch = fakeFetch([], { status: { "/songs/index_of_songs.txt": 500 } });
  try {
    await runWithAbcjs(createAbcjsStub(), () => offline.downloadForOffline());
    assert.equal(
      document.getElementById("offlineStatus").textContent,
      "Couldn't reach the song library — try again when you're back online.",
    );
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("waits for the page to become controlled before fetching, so early requests aren't bypassing the worker", async () => {
  const { offline, swStub, cleanup } = setup({ controller: null });
  const fetchCalls = [];
  globalThis.fetch = fakeFetch(fetchCalls);
  try {
    const run = runWithAbcjs(createAbcjsStub(), () => offline.downloadForOffline());
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(fetchCalls.length, 0, "no fetches should start before the page is controlled");

    swStub.fireControllerChange({});
    await run;
    assert.ok(fetchCalls.includes("/songs/index_of_songs.txt"));
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("gives up and prompts a normal reload if the page never becomes controlled (a forced/hard reload)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { offline, swStub, cleanup } = setup({ controller: null });
  const fetchCalls = [];
  globalThis.fetch = fakeFetch(fetchCalls);
  try {
    const run = runWithAbcjs(createAbcjsStub(), () => offline.downloadForOffline());
    // A real setImmediate (not mocked — only setTimeout is) is a genuine
    // macrotask boundary, so awaiting one flushes every microtask queued so
    // far — however many `await`/`.then()` hops runDownload needs to reach
    // waitForController()'s own setTimeout call — without hand-counting them.
    await new Promise((resolve) => { setImmediate(resolve); });

    t.mock.timers.tick(10000);
    await run;

    assert.equal(fetchCalls.length, 0, "should never have started fetching the library");
    assert.equal(
      document.getElementById("offlineStatus").textContent,
      "Reload this page normally (not a forced/hard reload) to enable offline mode.",
    );

    // A late controllerchange (the worker eventually claims the page anyway)
    // must not resolve an already-timed-out wait a second time.
    swStub.fireControllerChange({});
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("a second concurrent call is a no-op while a download is already running", async () => {
  const { offline, cleanup } = setup();
  globalThis.fetch = fakeFetch([]);
  try {
    const first = runWithAbcjs(createAbcjsStub(), () => offline.downloadForOffline());
    const second = offline.downloadForOffline(); // no-op: a run is already in flight
    await Promise.all([first, second]);
    assert.equal(document.getElementById("offlineStatus").textContent, "Available offline.");
  } finally {
    delete globalThis.fetch;
    cleanup();
  }
});

test("WIDE_RANGE_ABC covers every chromatic semitone, not just the seven naturals", () => {
  assert.ok(WIDE_RANGE_ABC.includes("^C"), "should include a sharped natural (accidental coverage)");
  assert.ok(WIDE_RANGE_ABC.includes("^f"), "should include a sharped natural in the upper octaves too");
  // The first 5 lines are the ABC header (X:/T:/M:/L:/K:) — "K:C" itself
  // ends in a bare note-letter-shaped "C", so only the note-body lines
  // below it are counted here.
  const noteLines = WIDE_RANGE_ABC.split("\n").slice(5);
  const noteCount = (noteLines.join(" ").match(/\^?[A-Ga-g][,']*/g) || []).length;
  assert.equal(noteCount, 12 * 6, "six full chromatic octaves, twelve semitones each");
});
