import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { clockTime, statusText, updateStatusRow } from "./dialog-parts.js";

function mountRow() {
  mountPage();
  document.body.insertAdjacentHTML("beforeend",
    '<div id="row"><p id="line"></p><button id="btn" hidden></button></div><div id="other"></div>');
  return { row: document.getElementById("row"), line: document.getElementById("line"), btn: document.getElementById("btn") };
}

test("a status row hides itself while it has no text and no visible button", () => {
  const { row, line, btn } = mountRow();
  updateStatusRow("row", "line", "btn");
  assert.equal(row.hidden, true);
  line.textContent = "Synced 12:00";
  updateStatusRow("row", "line", "btn");
  assert.equal(row.hidden, false);
  line.textContent = "";
  btn.hidden = false;
  updateStatusRow("row", "line", "btn");
  assert.equal(row.hidden, false, "a visible button keeps the row");
});

test("a row with no button element still follows its text", () => {
  const { row, line } = mountRow();
  updateStatusRow("row", "line", "nope");
  assert.equal(row.hidden, true);
  line.textContent = "x";
  updateStatusRow("row", "line", "nope");
  assert.equal(row.hidden, false);
});

test("a page without the row (or the line) is left alone, never another element", () => {
  mountRow();
  const before = document.body.innerHTML;
  updateStatusRow("missing", "line", "btn");
  updateStatusRow("row", "missing", "btn");
  assert.equal(document.body.innerHTML, before);
});

test("the shared helpers still format a status and the clock", () => {
  assert.equal(statusText({ status: "off" }, "12:00"), "Not connected");
  assert.match(statusText({ status: "ok" }, "12:00"), /12:00/);
  assert.match(clockTime(), /^\d\d:\d\d$/);
});
