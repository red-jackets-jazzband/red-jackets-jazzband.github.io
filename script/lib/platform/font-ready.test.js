import { test } from "node:test";
import assert from "node:assert/strict";
import { whenFontReady } from "./font-ready.js";

function deferred() {
  const handle = { resolve: (_value) => {}, reject: (_error) => {} };
  const promise = new Promise((res, rej) => {
    handle.resolve = res;
    handle.reject = rej;
  });
  return { promise, resolve: handle.resolve, reject: handle.reject };
}

test("runs straight away without a FontFaceSet", () => {
  let calls = 0;
  whenFontReady(undefined, "16px X", 1000, () => { calls += 1; });
  assert.equal(calls, 1);
});

test("runs straight away when the font is already loaded", () => {
  let calls = 0;
  const fonts = { check: () => true, load: () => assert.fail("no load needed") };
  whenFontReady(fonts, "16px X", 1000, () => { calls += 1; });
  assert.equal(calls, 1);
});

test("waits for the font to load, then runs once", async () => {
  const load = deferred();
  let calls = 0;
  const fonts = { check: () => false, load: () => load.promise };
  whenFontReady(fonts, "16px X", 50, () => { calls += 1; });
  assert.equal(calls, 0);
  load.resolve([]);
  await load.promise;
  assert.equal(calls, 1);
  await new Promise((resolve) => { setTimeout(resolve, 80); });
  assert.equal(calls, 1, "the timeout doesn't run it a second time");
});

test("runs when the font fails to load", async () => {
  const load = deferred();
  let calls = 0;
  whenFontReady({ check: () => false, load: () => load.promise }, "16px X", 1000, () => { calls += 1; });
  load.reject(new Error("blocked"));
  await load.promise.catch(() => null);
  await Promise.resolve();
  assert.equal(calls, 1);
});

test("gives up waiting after the timeout", async () => {
  let calls = 0;
  whenFontReady({ check: () => false, load: () => new Promise(() => {}) }, "16px X", 10, () => { calls += 1; });
  await new Promise((resolve) => { setTimeout(resolve, 30); });
  assert.equal(calls, 1);
});
