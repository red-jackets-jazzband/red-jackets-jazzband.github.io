import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APP_SLICES, createAppStore, bindAppPrefs, RENDER, isRenderWrite,
} from "./state.js";

function memory(initial = {}) {
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

test("every slice key is unique, so ctx.state can be one flat view", () => {
  assert.doesNotThrow(() => createAppStore());
  const names = APP_SLICES.map((s) => s.name);
  assert.deepEqual(names, ["catalog", "nav", "settings", "tune", "mixer", "playback", "layers"]);
});

test("createAppStore starts at the defaults, with nothing read from storage", () => {
  const store = createAppStore();
  assert.equal(store.state.activeTab, "library");
  assert.equal(store.state.instrument, "concert_pitch");
  assert.equal(store.state.comping, "off");
  assert.deepEqual(store.state.compingParts, [0, 1, 2]);
  assert.equal(store.state.repeatCount, 1);
  assert.equal(store.state.swing, 52);
  assert.deepEqual(store.state.mixer, {
    bassVolume: 100, bassMuted: false, bassProgram: null, chordsVolume: 88, chordsMuted: false, chordsProgram: null,
  });
});

test("createAppStore routes flat overrides to their slices and rejects unknown keys", () => {
  const store = createAppStore({ instrument: "trumpet", currentSongFile: "a.abc" });
  assert.equal(store.get("settings").instrument, "trumpet");
  assert.equal(store.get("nav").currentSongFile, "a.abc");
  assert.throws(() => createAppStore({ nope: 1 }), /no slice declares "nope"/);
});

test("bindAppPrefs loads the stored prefs and writes changes back under the same keys", () => {
  const store = createAppStore();
  const io = memory({
    "rj.instrument": "trombone",
    "rj.compingParts": "3,5",
    "rj.sheetAdvanced": "1",
    "rj.mixerBassVolume": "40",
    "rj.repeatCount": "4",
  });
  bindAppPrefs(store, io);
  assert.equal(store.state.instrument, "trombone");
  assert.deepEqual(store.state.compingParts, [1, 2]);
  assert.equal(store.state.advancedOpen, true);
  assert.equal(store.state.mixer.bassVolume, 40);
  assert.equal(store.state.repeatCount, 4);

  store.state.compingParts = [0];
  store.state.metronomeEnabled = true;
  store.state.transpose = 3; // not persisted
  assert.equal(io.data["rj.compingParts"], "R");
  assert.equal(io.data["rj.metronomeEnabled"], "1");
  assert.equal(Object.values(io.data).includes("3"), false);
});

test("an empty or unreadable compingParts pref means all three tones", () => {
  const store = createAppStore();
  bindAppPrefs(store, memory({ "rj.compingParts": "x,y" }));
  assert.deepEqual(store.state.compingParts, [0, 1, 2]);
});

test("isRenderWrite recognises the RENDER tag only", () => {
  assert.equal(isRenderWrite(RENDER), true);
  assert.equal(isRenderWrite({}), false);
  assert.equal(isRenderWrite(undefined), false);
});
