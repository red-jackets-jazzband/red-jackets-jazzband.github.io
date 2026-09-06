import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { INSTRUMENTS } from "../lib/instruments.js";
import { COMPING_PATTERNS } from "../lib/comping.js";
import { createInstrumentDropdown, createCompingDropdown } from "./selects.js";

test("createInstrumentDropdown builds every instrument option into #sheetStatus", () => {
  const page = mountPage();
  try {
    const rerenders = [];
    createInstrumentDropdown(makeCtx({ sheet: { rerender: () => rerenders.push(1) } }));
    const select = document.getElementById("instrument");
    assert.ok(document.getElementById("sheetStatus").contains(select));
    assert.deepEqual(
      [...select.options].map((o) => o.value),
      INSTRUMENTS.map((i) => i.value),
    );
    assert.equal(select.getAttribute("aria-label"), "Instrument");

    select.value = "trombone";
    select.dispatchEvent(new window.Event("change"));
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem("rj.instrument"), "trombone");
  } finally {
    page.cleanup();
  }
});

test("createInstrumentDropdown preselects a valid stored instrument", () => {
  const page = mountPage();
  try {
    window.localStorage.setItem("rj.instrument", "alto_saxophone");
    createInstrumentDropdown(makeCtx());
    assert.equal(document.getElementById("instrument").value, "alto_saxophone");
  } finally {
    window.localStorage.clear();
    page.cleanup();
  }
});

test("createCompingDropdown builds an OFF entry plus grouped patterns", () => {
  const page = mountPage();
  try {
    const rerenders = [];
    createCompingDropdown(makeCtx({ sheet: { rerender: () => rerenders.push(1) } }));
    const select = document.getElementById("comping");
    assert.equal(select.options[0].value, "off");
    assert.equal(
      select.querySelectorAll("optgroup").length,
      new Set(COMPING_PATTERNS.map((p) => p.group)).size,
    );
    assert.equal(
      select.querySelectorAll("option").length,
      COMPING_PATTERNS.length + 1,
    );

    select.value = COMPING_PATTERNS[0].value;
    select.dispatchEvent(new window.Event("change"));
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem("rj.comping"), COMPING_PATTERNS[0].value);
  } finally {
    page.cleanup();
  }
});
