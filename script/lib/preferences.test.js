import { test } from "node:test";
import assert from "node:assert/strict";
import { PREF_KEYS, safeStorage, readPref, writePref } from "./preferences.js";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function withWindow(win, fn) {
  const real = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  try {
    return fn();
  } finally {
    if (real) Object.defineProperty(globalThis, "window", real);
    else delete globalThis.window;
  }
}

test("PREF_KEYS pins the persisted key names", () => {
  assert.deepEqual(PREF_KEYS, {
    instrument: "rj.instrument",
    comping: "rj.comping",
    sheetAdvanced: "rj.sheetAdvanced",
    inspirationWidth: "rj.inspirationWidth",
  });
});

test("readPref / writePref round-trip through localStorage", () => {
  withWindow({ localStorage: fakeStorage() }, () => {
    assert.equal(readPref("rj.instrument"), null);
    assert.equal(writePref("rj.instrument", "trumpet"), true);
    assert.equal(readPref("rj.instrument"), "trumpet");
  });
});

test("readPref / writePref swallow a throwing storage", () => {
  const throwing = {
    get localStorage() {
      throw new Error("blocked");
    },
  };
  withWindow(throwing, () => {
    assert.equal(readPref("x"), null);
    assert.equal(writePref("x", "y"), false);
    assert.equal(safeStorage(), null);
  });
});

test("safeStorage returns the storage object when reachable", () => {
  const ls = fakeStorage();
  withWindow({ localStorage: ls }, () => {
    assert.equal(safeStorage(), ls);
  });
});
