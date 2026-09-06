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
  try {
    return fn(() => last);
  } finally {
    globalThis.XMLHttpRequest = savedXHR;
    globalThis.window = savedWin;
  }
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
