import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { updateIrealProLink } from "./irealpro-link.js";

function song() {
  return {
    lines: [{ staff: [{ key: { root: "B", acc: "b" }, meter: { value: [{ num: "4", den: "4" }] } }] }],
    metaText: { title: "Basin Street Blues" },
  };
}

function inDom(fn) {
  const page = mountPage();
  try {
    return fn(page);
  } finally {
    page.cleanup();
  }
}

test("updateIrealProLink creates the link in the action cluster for a tune with chords", () => {
  inDom(() => {
    updateIrealProLink(song(), [{ text: ["Bb"] }, { text: ["F7"] }]);
    const link = document.getElementById("iRealPro");
    assert.ok(link);
    assert.ok(document.getElementById("sheetActions").contains(link));
    assert.match(link.getAttribute("href"), /^irealbook:\/\//);
  });
});

test("updateIrealProLink updates the href in place instead of adding a second link", () => {
  inDom(() => {
    updateIrealProLink(song(), [{ text: ["Bb"] }]);
    const first = document.getElementById("iRealPro").getAttribute("href");
    updateIrealProLink(song(), [{ text: ["Bb"] }, { text: ["Eb"] }, { text: ["Bb"] }]);
    assert.equal(document.querySelectorAll("#iRealPro").length, 1);
    assert.notEqual(document.getElementById("iRealPro").getAttribute("href"), first);
  });
});

test("updateIrealProLink removes the link when the tune has no chords", () => {
  inDom(() => {
    updateIrealProLink(song(), [{ text: ["Bb"] }]);
    assert.ok(document.getElementById("iRealPro"));
    updateIrealProLink(song(), []);
    assert.equal(document.getElementById("iRealPro"), null);
  });
});
