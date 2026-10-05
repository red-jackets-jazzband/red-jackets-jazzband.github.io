import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
import { createPlaylistExport } from "./playlist-export.js";
import { SOUNDIIZ_ENDPOINT } from "../../lib/setlists/setlist-listen.js";

const NEVER = Symbol("never settles");
const SHARE_URL = "https://soundiiz.com/go/import-playlist/abc123";
const SONGS = [
  { title: "Bill Bailey", sources: { spotifyTrackId: "sp", youtubeId: "yt", soundcloudId: null } },
  { title: "Panama", sources: { spotifyTrackId: null, youtubeId: null, soundcloudId: null } },
];

function flush() {
  return new Promise((resolve) => { setTimeout(resolve, 0); });
}

// Mounts the page with fetch and window.open stubbed: `reply` is what the
// fake Soundiiz answers (or an Error to reject with), `tab` what window.open
// returns (null = blocked by a popup blocker).
function setup({ reply, timeoutMs, tab = { location: { replace(url) { this.url = url; } }, close() { this.closed = true; } } }) {
  const page = mountPage();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (url, init) => {
    requests.push({ url, init });
    if (reply === NEVER) return new Promise(() => {});
    return reply instanceof Error
      ? Promise.reject(reply)
      : Promise.resolve({ json: () => Promise.resolve(reply) });
  };
  window.open = () => tab;
  const ctx = makeCtx({
    setlistPrint: { getListenSongs: () => SONGS, getListenTitle: () => "Gig 2026" },
  });
  const exporter = createPlaylistExport(ctx, { timeoutMs });
  exporter.init();
  exporter.update(SONGS);
  return {
    exporter, requests, tab,
    status: () => document.getElementById("listenStatus"),
    cleanup: () => {
      globalThis.fetch = originalFetch;
      page.cleanup();
    },
  };
}

test("update enables the Export button once the setlist has songs", () => {
  const { exporter, cleanup } = setup({ reply: {} });
  try {
    const btn = document.getElementById("listenExportBtn");
    assert.equal(btn.disabled, false);
    exporter.update([]);
    assert.equal(btn.disabled, true);
  } finally {
    cleanup();
  }
});

test("a click POSTs the preferred-source tracklist and steers the pre-opened tab to Soundiiz", async () => {
  const { requests, tab, status, cleanup } = setup({ reply: { status: "success", shareUrl: SHARE_URL } });
  try {
    document.getElementById("listenExportBtn").click();
    assert.equal(status().hidden, false, "shows a busy line while waiting");
    await flush();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, SOUNDIIZ_ENDPOINT);
    assert.equal(requests[0].init.method, "POST");
    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.destination, undefined, "the visitor picks the service on Soundiiz");
    assert.deepEqual(body.tracklist, [
      { title: "Bill Bailey", platform: "spotify", id: "sp" },
      { title: "Panama" },
    ]);
    assert.equal(tab.location.url, SHARE_URL);
    assert.equal(status().hidden, true);
  } finally {
    cleanup();
  }
});

test("with the tab blocked, the import link is offered in the status line instead", async () => {
  const { status, cleanup } = setup({ reply: { status: "success", shareUrl: SHARE_URL }, tab: null });
  try {
    document.getElementById("listenExportBtn").click();
    await flush();
    const link = status().querySelector("a");
    assert.equal(link.href, SHARE_URL);
  } finally {
    cleanup();
  }
});

test("a failed or untrusted reply closes the pending tab and says so", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    for (const reply of [new Error("offline"), { status: "success", shareUrl: "https://evil.example/" }]) {
      const { tab, status, cleanup } = setup({ reply });
      try {
        document.getElementById("listenExportBtn").click();
        await flush();
        assert.equal(tab.closed, true);
        assert.match(status().textContent, /Couldn’t reach Soundiiz/);
      } finally {
        cleanup();
      }
    }
  } finally {
    console.warn = originalWarn;
  }
});

test("an error steering the tab still reports failure and lets the button be used again", async (t) => {
  t.mock.method(console, "warn", () => {});
  const tab = { location: { replace() { throw new Error("blocked"); } }, close() { this.closed = true; } };
  const { requests, status, cleanup } = setup({ reply: { status: "success", shareUrl: SHARE_URL }, tab });
  try {
    document.getElementById("listenExportBtn").click();
    await flush();
    assert.match(status().textContent, /Couldn’t reach Soundiiz/);
    document.getElementById("listenExportBtn").click();
    await flush();
    assert.equal(requests.length, 2, "not stuck busy after the failure");
  } finally {
    cleanup();
  }
});

test("a request that never settles times out: tab closed, failure shown, retry possible", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { requests, tab, status, cleanup } = setup({ reply: NEVER, timeoutMs: 5 });
  try {
    document.getElementById("listenExportBtn").click();
    await new Promise((resolve) => { setTimeout(resolve, 30); });
    assert.equal(tab.closed, true);
    assert.match(status().textContent, /Couldn’t reach Soundiiz/);
    document.getElementById("listenExportBtn").click();
    assert.equal(requests.length, 2, "not stuck busy after the timeout");
  } finally {
    cleanup();
  }
});
