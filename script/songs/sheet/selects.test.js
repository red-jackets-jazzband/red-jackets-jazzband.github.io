import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
import { INSTRUMENTS } from "../../lib/music/instruments.js";
import { COMPING_PATTERNS } from "../../lib/music/comping.js";
import { SOLO_STYLES } from "../../lib/music/solo.js";
import { PRACTICE_EXERCISES, PRACTICE_RHYTHMS } from "../../lib/music/practice.js";
import {
  createInstrumentDropdown, createCompingDropdown, createPracticeDropdown, createSoloDropdown,
} from "./selects.js";

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

test("createPracticeDropdown is one select: a summary, then an Exercise and a Rhythm group", () => {
  const page = mountPage();
  try {
    const rerenders = [];
    const ctx = makeCtx({ sheet: { rerender: () => rerenders.push(1) } });
    createPracticeDropdown(ctx);
    const select = document.getElementById("practice");
    const slot = document.getElementById("practiceSlot");
    assert.ok(slot.contains(select));
    assert.equal(slot.querySelectorAll("select").length, 1, "one picker");
    const [exerciseGroup, rhythmGroup] = select.querySelectorAll("optgroup");
    const values = (group) => [...group.children].map((o) => o.value);
    assert.deepEqual(values(exerciseGroup), ["ex:off", ...PRACTICE_EXERCISES.map((e) => `ex:${e.value}`)]);
    assert.deepEqual(values(rhythmGroup), ["rh:varied", "rh:syncopated", ...PRACTICE_RHYTHMS.map((r) => `rh:${r.value}`)]);
    const shown = () => select.selectedOptions[0].textContent;
    assert.equal(select.value, "summary");
    assert.equal(shown(), "PRACTICE: OFF");
    assert.equal(rhythmGroup.disabled, true, "no rhythm to pick while practice is off");

    const pick = (value) => {
      select.value = value;
      select.dispatchEvent(new window.Event("change"));
    };
    pick("ex:scales-updown");
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem("rj.practice"), "scales-updown");
    assert.equal(select.value, "summary", "back to the summary after a pick");
    assert.equal(shown(), "SCALE RUNS: UP, THEN DOWN · VARIED RHYTHM");
    assert.equal(rhythmGroup.disabled, false);
    assert.ok(select.querySelector('option[value="ex:scales-updown"]').textContent.startsWith("\u2713 "));

    pick("rh:charleston");
    assert.equal(rerenders.length, 2);
    assert.equal(window.localStorage.getItem("rj.practiceRhythm"), "charleston");
    assert.equal(window.localStorage.getItem("rj.practice"), "scales-updown", "the exercise stays");
    assert.equal(shown(), "SCALE RUNS: UP, THEN DOWN · CHARLESTON");
    assert.ok(select.querySelector('option[value="rh:charleston"]').textContent.startsWith("\u2713 "));
    assert.ok(!select.querySelector('option[value="rh:varied"]').textContent.startsWith("\u2713 "));

    pick("rh:syncopated");
    assert.equal(shown(), "SCALE RUNS: UP, THEN DOWN · SYNCOPATED RHYTHM");

    pick("ex:off");
    assert.equal(shown(), "PRACTICE: OFF");
    assert.equal(window.localStorage.getItem("rj.practiceRhythm"), "syncopated", "the rhythm is kept for next time");
  } finally {
    page.cleanup();
  }
});
