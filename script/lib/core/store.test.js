import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.js";

const make = () => createStore({ nav: { tab: "library", song: null }, mixer: { swing: 52 } });

test("get returns each slice's initial values", () => {
  const store = make();
  assert.deepEqual(store.get("nav"), { tab: "library", song: null });
  assert.equal(store.get("mixer").swing, 52);
});

test("set merges, replaces the slice object and notifies with the changed keys", () => {
  const store = make();
  const before = store.get("nav");
  const calls = [];
  store.subscribe("nav", (slice, keys, name) => calls.push({ slice, keys, name }));
  store.set("nav", { tab: "setlists", song: null });
  assert.notEqual(store.get("nav"), before);
  assert.equal(before.tab, "library", "the previous object is left untouched");
  assert.deepEqual(calls, [{ slice: { tab: "setlists", song: null }, keys: ["tab"], name: "nav" }]);
});

test("set with nothing actually changed notifies nobody", () => {
  const store = make();
  let calls = 0;
  store.subscribe("nav", () => { calls += 1; });
  store.set("nav", { tab: "library" });
  assert.equal(calls, 0);
});

test("subscribers of one slice don't hear another slice's changes", () => {
  const store = make();
  let calls = 0;
  store.subscribe("mixer", () => { calls += 1; });
  store.set("nav", { tab: "setlists" });
  assert.equal(calls, 0);
});

test("subscribe accepts several slices and returns an unsubscribe", () => {
  const store = make();
  const seen = [];
  const off = store.subscribe(["nav", "mixer"], (_slice, _keys, name) => seen.push(name));
  store.set("mixer", { swing: 10 });
  store.set("nav", { tab: "x" });
  off();
  store.set("nav", { tab: "y" });
  assert.deepEqual(seen, ["mixer", "nav"]);
});

test("batch defers notification and merges changed keys per slice", () => {
  const store = make();
  const calls = [];
  store.subscribe("nav", (_slice, keys) => calls.push(keys));
  const result = store.batch(() => {
    store.set("nav", { tab: "a" });
    store.state.song = "b.abc";
    store.batch(() => store.set("nav", { tab: "c" }));
    assert.equal(calls.length, 0, "nothing is notified mid-batch");
    return 7;
  });
  assert.equal(result, 7);
  assert.deepEqual(calls, [["tab", "song"]]);
  assert.equal(store.get("nav").tab, "c");
});

test("batch still notifies when its callback throws", () => {
  const store = make();
  let calls = 0;
  store.subscribe("nav", () => { calls += 1; });
  assert.throws(() => store.batch(() => {
    store.set("nav", { tab: "a" });
    throw new Error("boom");
  }), /boom/);
  assert.equal(calls, 1);
});

test("the flat state view reads and writes through to the owning slice", () => {
  const store = make();
  const calls = [];
  store.subscribe("mixer", (_slice, keys) => calls.push(keys));
  assert.equal(store.state.tab, "library");
  store.state.swing = 30;
  assert.equal(store.get("mixer").swing, 30);
  assert.deepEqual(calls, [["swing"]]);
  assert.equal(store.sliceOf("swing"), "mixer");
});

test("the flat state view rejects keys no slice declares", () => {
  const store = make();
  assert.throws(() => { store.state.nope = 1; }, TypeError);
});

test("a key may only belong to one slice", () => {
  assert.throws(() => createStore({ a: { x: 1 }, b: { x: 2 } }), /both "a" and "b"/);
});

test("set rejects an unknown slice or a key from another slice", () => {
  const store = make();
  assert.throws(() => store.set("nope", {}), /unknown slice/);
  assert.throws(() => store.set("nav", { swing: 1 }), /isn't part of slice "nav"/);
});

test("a listener unsubscribing during notification doesn't skip the next one", () => {
  const store = make();
  const seen = [];
  const off = store.subscribe("nav", () => { seen.push("a"); off(); });
  store.subscribe("nav", () => seen.push("b"));
  store.set("nav", { tab: "x" });
  store.state.tab = "y";
  assert.deepEqual(seen, ["a", "b", "b"]);
});

test("a write's meta tag reaches subscribers", () => {
  const store = make();
  const metas = [];
  store.subscribe("nav", (_slice, _keys, _name, meta) => metas.push(meta));
  store.set("nav", { tab: "a" }, { source: "render" });
  store.state.tab = "b";
  assert.deepEqual(metas, [{ source: "render" }, {}]);
});

test("a batched notification keeps the tag only when every write agreed", () => {
  const store = make();
  const metas = [];
  store.subscribe(["nav", "mixer"], (_slice, _keys, name, meta) => metas.push([name, meta]));
  store.batch(() => {
    store.set("nav", { tab: "a" }, { source: "render" });
    store.set("nav", { song: "s" }, { source: "render" });
    store.set("mixer", { swing: 1 }, { source: "render" });
    store.set("mixer", { swing: 2 });
  });
  assert.deepEqual(metas, [["nav", { source: "render" }], ["mixer", {}]]);
});

test("set rejects a foreign or unknown key even when its value didn't change", () => {
  const store = make();
  // swing belongs to "mixer"; with an equal value it used to slip into "nav"
  // unnoticed whenever another key in the same patch changed.
  assert.throws(() => store.set("nav", { tab: "x", swing: 52 }), /isn't part of slice "nav"/);
  assert.throws(() => store.set("nav", { tab: "x", typo: undefined }), /isn't part of slice "nav"/);
  assert.equal(Object.prototype.hasOwnProperty.call(store.get("nav"), "swing"), false);
  assert.equal(store.get("nav").tab, "library", "a rejected patch changes nothing");
});

test("a throwing subscriber doesn't stop the others; the error still surfaces", () => {
  const store = make();
  const seen = [];
  store.subscribe("nav", () => {
    seen.push("a");
    throw new Error("boom");
  });
  store.subscribe("nav", () => seen.push("b"));
  assert.throws(() => store.set("nav", { tab: "x" }), /boom/);
  assert.deepEqual(seen, ["a", "b"]);
  assert.equal(store.get("nav").tab, "x");
});

test("a throwing subscriber during a batch flush doesn't strand the other slices' notifications", () => {
  const store = make();
  const seen = [];
  store.subscribe("nav", () => {
    throw new Error("boom");
  });
  store.subscribe("mixer", () => seen.push("mixer"));
  assert.throws(() => store.batch(() => {
    store.set("nav", { tab: "x" });
    store.set("mixer", { swing: 1 });
  }), /boom/);
  assert.deepEqual(seen, ["mixer"]);
  // Nothing is left pending to leak into a later, unrelated batch.
  store.batch(() => {});
  assert.deepEqual(seen, ["mixer"]);
});
