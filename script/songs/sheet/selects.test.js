import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
import { INSTRUMENTS } from "../../lib/music/instruments.js";
import { COMPING_PATTERNS } from "../../lib/music/comping.js";
import { SOLO_STYLES } from "../../lib/music/solo.js";
import { createInstrumentDropdown, createCompingDropdown, createSoloDropdown } from "./selects.js";

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

test("createInstrumentDropdown shows ctx.state.instrument and follows the store", () => {
  const page = mountPage();
  try {
    const ctx = makeCtx({ state: { instrument: "alto_saxophone" } });
    createInstrumentDropdown(ctx);
    const select = document.getElementById("instrument");
    assert.equal(select.value, "alto_saxophone");
    ctx.state.instrument = "trumpet"; // e.g. the tour restoring a snapshot
    assert.equal(select.value, "trumpet");
  } finally {
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

test("createSoloDropdown builds an OFF entry plus one per style and re-renders on change", () => {
  const page = mountPage();
  try {
    const rerenders = [];
    const ctx = makeCtx({ sheet: { rerender: () => rerenders.push(1) } });
    createSoloDropdown(ctx);
    assert.equal(ctx.state.soloEnabled, true, "the picker switches Solo on");
    rerenders.length = 0;
    const select = document.getElementById("solo");
    assert.ok(document.getElementById("soloSlot").contains(select));
    assert.deepEqual(
      [...select.options].map((o) => o.value),
      ["off", ...SOLO_STYLES.map((s) => s.value)],
    );
    select.value = "armstrong";
    select.dispatchEvent(new window.Event("change"));
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem("rj.solo"), "armstrong");
  } finally {
    page.cleanup();
  }
});
