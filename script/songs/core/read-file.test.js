import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "./read-file.js";

// A tiny controllable XHR: `readFile` opens/sends synchronously, then the test
// drives the response through `finish()`.
function withEnv(protocol, fn) {
  const savedXHR = globalThis.XMLHttpRequest;
  const savedWin = globalThis.window;
  let last = null;
  globalThis.XMLHttpRequest = class {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.responseText = "";
      last = this;
    }

    open() {}

    send() {}

    finish(status, text) {
      this.readyState = 4;
      this.status = status;
      this.responseText = text ?? "";
      this.onreadystatechange();
    }
  };
  globalThis.window = { location: { protocol } };
  const restore = () => {
    globalThis.XMLHttpRequest = savedXHR;
    globalThis.window = savedWin;
  };
  let result;
  try {
    result = fn(() => last);
  } catch (error) {
    restore();
    throw error;
  }
  // An async test keeps the stand-ins until it has finished.
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
}

test("readFile resolves a status-200 HTTP read", () => {
  withEnv("https:", (xhr) => {
    let got = null;
    readFile("/songs/index.txt", (text) => { got = text; }, () => { got = "ERROR"; });
    xhr().finish(200, "a\nb\nc");
    assert.equal(got, "a\nb\nc");
  });
});

test("readFile treats HTTP status 0 as a failure, not an empty success", () => {
  withEnv("https:", (xhr) => {
    let loaded = false;
    let errStatus = "unset";
    readFile("/songs/index.txt", () => { loaded = true; }, (status) => { errStatus = status; });
    xhr().finish(0, "");
    assert.equal(loaded, false);
    assert.equal(errStatus, 0);
  });
});

test("readFile accepts status 0 for a genuine file: read", () => {
  withEnv("file:", (xhr) => {
    let got = null;
    readFile("songs/index.txt", (text) => { got = text; }, () => { got = "ERROR"; });
    xhr().finish(0, "local contents");
    assert.equal(got, "local contents");
  });
});

test("readFile reports a 404 through onError", () => {
  withEnv("https:", (xhr) => {
    let errStatus = "unset";
    readFile("/songs/missing.abc", () => {}, (status) => { errStatus = status; });
    xhr().finish(404, "Not Found");
    assert.equal(errStatus, 404);
  });
});

// A request the page's <head> started (lib/core/early-requests.js) is adopted.
function earlyRequest(state) {
  const listeners = [];
  return {
    ...state,
    addEventListener(type, fn) {
      if (type === "loadend") listeners.push(fn);
    },
    finish(status, text) {
      Object.assign(this, { readyState: 4, status, responseText: text });
      listeners.forEach((fn) => fn());
    },
  };
}

test("readFile adopts a request the page already started, instead of sending one", () => {
  withEnv("https:", (xhr) => {
    const early = earlyRequest({ readyState: 3 });
    window.rjEarlyRequests = { "/songs/panama.abc": early };
    let got = null;
    readFile("/songs/panama.abc", (text) => { got = text; });
    assert.equal(xhr(), null, "no second request");
    early.finish(200, "X:1");
    assert.equal(got, "X:1");
  });
});

test("readFile answers a finished early request asynchronously, and only once", async () => {
  await withEnv("https:", async (xhr) => {
    window.rjEarlyRequests = { "/songs/index_of_songs.txt": { readyState: 4, status: 404, responseText: "" } };
    let failed = null;
    readFile("/songs/index_of_songs.txt", () => {}, (status) => { failed = status; });
    assert.equal(failed, null, "not synchronously");
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    assert.equal(failed, 404);
    readFile("/songs/index_of_songs.txt", () => {});
    assert.notEqual(xhr(), null, "a second read fetches afresh");
  });
});
