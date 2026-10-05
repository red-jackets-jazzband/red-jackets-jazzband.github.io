import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.js";
import {
  boolPref, intPref, nullableNumberPref, enumPref, objectPref, loadPersisted, bindPersisted,
} from "./persisted.js";

/** @param {Record<string, string>} [initial] */
function memory(initial = {}) {
  /** @type {Record<string, string>} */
  const data = { ...initial };
  return {
    data,
    read: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    write: (key, value) => {
      data[key] = value;
      return true;
    },
  };
}

test("boolPref: missing -> fallback, '1' -> true, anything else -> false", () => {
  const codec = boolPref("k", true);
  assert.equal(codec.load(memory().read), true);
  assert.equal(codec.load(memory({ k: "1" }).read), true);
  assert.equal(codec.load(memory({ k: "0" }).read), false);
  const m = memory();
  codec.save(false, m.write);
  assert.equal(m.data.k, "0");
});

test("intPref clamps by default and rounds", () => {
  const codec = intPref("k", { fallback: 50, min: 0, max: 100 });
  assert.equal(codec.load(memory().read), 50);
  assert.equal(codec.load(memory({ k: "140" }).read), 100);
  assert.equal(codec.load(memory({ k: "-3" }).read), 0);
  assert.equal(codec.load(memory({ k: "12.6" }).read), 13);
  assert.equal(codec.load(memory({ k: "abc" }).read), 50);
});

test("intPref's corrupt value can differ from its missing value", () => {
  const codec = intPref("k", { fallback: 88, corrupt: 100, min: 0, max: 100 });
  assert.equal(codec.load(memory().read), 88);
  assert.equal(codec.load(memory({ k: "x" }).read), 100);
});

test("intPref invalid: 'fallback' discards out-of-range and fractional values", () => {
  const codec = intPref("k", { fallback: 1, min: 1, max: 20, invalid: "fallback" });
  assert.equal(codec.load(memory({ k: "21" }).read), 1);
  assert.equal(codec.load(memory({ k: "0" }).read), 1);
  assert.equal(codec.load(memory({ k: "2.5" }).read), 1);
  assert.equal(codec.load(memory({ k: "4" }).read), 4);
});

test("nullableNumberPref stores null as an empty string", () => {
  const codec = nullableNumberPref("k");
  assert.equal(codec.load(memory().read), null);
  assert.equal(codec.load(memory({ k: "" }).read), null);
  assert.equal(codec.load(memory({ k: "33" }).read), 33);
  const m = memory();
  codec.save(null, m.write);
  assert.equal(m.data.k, "");
});

test("enumPref falls back on an unknown value", () => {
  const codec = enumPref("k", ["a", "b"], "a");
  assert.equal(codec.load(memory({ k: "b" }).read), "b");
  assert.equal(codec.load(memory({ k: "gone" }).read), "a");
  assert.equal(codec.load(memory().read), "a");
});

test("objectPref loads and saves each field under its own pref", () => {
  const codec = objectPref({ on: boolPref("p.on", false), level: intPref("p.level", { fallback: 5 }) });
  const m = memory({ "p.on": "1" });
  assert.deepEqual(codec.load(m.read), { on: true, level: 5 });
  codec.save({ on: false, level: 9 }, m.write);
  assert.deepEqual(m.data, { "p.on": "0", "p.level": "9" });
});

test("loadPersisted builds a values object from a schema", () => {
  const schema = { a: boolPref("a", false), b: enumPref("b", ["x", "y"], "x") };
  assert.deepEqual(loadPersisted(schema, memory({ a: "1", b: "y" }).read), { a: true, b: "y" });
});

test("bindPersisted loads into the slice, then writes back only changed persisted keys", () => {
  const store = createStore({ s: { a: false, b: "x", transient: 0 } });
  const schema = { a: boolPref("a", false), b: enumPref("b", ["x", "y"], "x") };
  const m = memory({ a: "1" });
  bindPersisted(store, "s", schema, m);
  assert.deepEqual(store.get("s"), { a: true, b: "x", transient: 0 });
  assert.deepEqual(m.data, { a: "1" }, "loading writes nothing back");
  store.set("s", { b: "y", transient: 5 });
  assert.deepEqual(m.data, { a: "1", b: "y" });
});

test("bindPersisted with load: false keeps the slice's values and still writes changes back", () => {
  const store = createStore({ s: { a: true } });
  const m = memory({ a: "0" });
  bindPersisted(store, "s", { a: boolPref("a", false) }, { ...m, load: false });
  assert.equal(store.get("s").a, true);
  store.set("s", { a: false });
  assert.equal(m.data.a, "0");
  store.set("s", { a: true });
  assert.equal(m.data.a, "1");
});
