import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
import { PRACTICE_RHYTHMS } from "../../lib/music/practice.js";
import { createPracticePanel } from "./practice-panel.js";

const TOGGLE = "#practiceToggle";
const PANEL = "#practicePanel";
const SUMMARY = "#practiceSummary";
const SUMMARY_TEXT = "#practiceSummaryText";
const $ = (selector) => document.querySelector(selector);
const click = (selector) => $(selector).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
// The values ticked in one group of choices ("kind", "shape", "mix", "pattern").
const pressed = (group) => [...document.querySelectorAll(`.practice-${group}.is-selected`)].map((b) => b.getAttribute("data-value"));

function setup() {
  const page = mountPage();
  const rerenders = [];
  const ctx = makeCtx({ sheet: { rerender: () => rerenders.push(1) } });
  createPracticePanel(ctx);
  return { page, ctx, rerenders };
}

test("closed, practice is one control: a switch and a summary that opens the panel", () => {
  const { page } = setup();
  try {
    assert.equal($(SUMMARY_TEXT).textContent, "Off");
    assert.equal($(PANEL).hidden, true);
    assert.equal($("#practiceSlot").querySelectorAll("select").length, 0, "no dropdowns left");
    click(SUMMARY);
    assert.equal($(PANEL).hidden, false);
    assert.equal($(SUMMARY).getAttribute("aria-expanded"), "true");
    click("#practiceDone");
    assert.equal($(PANEL).hidden, true);
  } finally {
    page.cleanup();
  }
});

test("a click outside the control and its panel closes the panel; one inside doesn't", () => {
  const { page } = setup();
  try {
    click(SUMMARY);
    click('.practice-kind[data-value="scales"]');
    assert.equal($(PANEL).hidden, false, "a pick inside keeps it open");
    document.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal($(PANEL).hidden, true);
    assert.equal($(SUMMARY).getAttribute("aria-expanded"), "false");
  } finally {
    page.cleanup();
  }
});

test("each step writes its own setting, and any pick switches practice on", () => {
  const { page, ctx, rerenders } = setup();
  try {
    click(SUMMARY);
    click('.practice-kind[data-value="arpeggios"]');
    assert.equal(ctx.state.practice, "scales-updown".replace("scales", "arpeggios"), "keeps the default shape");
    assert.equal(window.localStorage.getItem("rj.practice"), "arpeggios-updown");
    assert.deepEqual(pressed("kind"), ["arpeggios"]);
    assert.equal(rerenders.length, 1, "one pick, one re-render");

    click('.practice-shape[data-value="up"]');
    assert.equal(ctx.state.practice, "arpeggios-up");
    assert.deepEqual(pressed("shape"), ["up"]);
    assert.equal($(SUMMARY_TEXT).textContent, "Chord-tone runs, Up · Varied rhythm");

    // Nothing ticked yet: the exercise's own set shows ticked, every pattern on offer.
    const runs = PRACTICE_RHYTHMS.filter((r) => r.run).map((r) => r.value);
    assert.equal(document.querySelectorAll(".practice-pattern").length, PRACTICE_RHYTHMS.length);
    assert.deepEqual(pressed("pattern"), runs);
    assert.equal(document.querySelector(".practice-mix"), null, "no One pattern / Syncopated / Varied buttons");
  } finally {
    page.cleanup();
  }
});

test("the shape step only shows for runs, and the rhythm step renumbers", () => {
  const { page } = setup();
  try {
    click('.practice-kind[data-value="guide"]');
    assert.equal($("#practiceShapeStep").hidden, true);
    assert.equal(document.querySelectorAll(".practice-step-num")[2].textContent, "2");
    click('.practice-kind[data-value="scales"]');
    assert.equal($("#practiceShapeStep").hidden, false);
    assert.equal(document.querySelectorAll(".practice-step-num")[2].textContent, "3");
  } finally {
    page.cleanup();
  }
});

test("the switch turns practice off and back on to the same exercise", () => {
  const { page, ctx } = setup();
  try {
    click('.practice-kind[data-value="enclosures"]');
    assert.equal($(TOGGLE).getAttribute("aria-pressed"), "true");
    click(TOGGLE);
    assert.equal(ctx.state.practice, "off");
    assert.equal($(SUMMARY_TEXT).textContent, "Off");
    assert.equal($(TOGGLE).getAttribute("aria-pressed"), "false");
    click(TOGGLE);
    assert.equal(ctx.state.practice, "enclosures");
    // A rhythm pick while off switches it back on too.
    click(TOGGLE);
    click('.practice-pattern[data-value="halves"]');
    assert.equal(ctx.state.practice, "enclosures");
  } finally {
    page.cleanup();
  }
});

test("Escape inside the panel closes it", () => {
  const { page } = setup();
  try {
    click(SUMMARY);
    $(".practice-kind").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal($(PANEL).hidden, true);
  } finally {
    page.cleanup();
  }
});

test("each pattern choice shows its rhythm as one bar of notation", () => {
  setup();
  const svgs = document.querySelectorAll(".practice-pattern svg.practice-rhythm");
  assert.equal(svgs.length, PRACTICE_RHYTHMS.length);
  assert.equal(document.querySelector(".practice-preview"), null, "no preview by Done");
  // Straight eighths: eight noteheads beamed in four pairs, no flags or rests.
  const eighths = document.querySelector('.practice-pattern[data-value="eighths"] svg');
  assert.equal(eighths.querySelectorAll("ellipse").length, 8);
  assert.equal(eighths.querySelectorAll("rect").length, 4);
});

test("rhythms are ticked and unticked, one or several, never none", () => {
  const { page, ctx } = setup();
  try {
    click(SUMMARY);
    const runs = PRACTICE_RHYTHMS.filter((r) => r.run).map((r) => r.value);
    // Unticking from the exercise's own set keeps the rest of it.
    click('.practice-pattern[data-value="pushes"]');
    assert.deepEqual(ctx.state.practiceRhythms, runs.filter((v) => v !== "pushes"));
    assert.equal(window.localStorage.getItem("rj.practiceRhythms"), runs.filter((v) => v !== "pushes").join(","));
    assert.equal($(SUMMARY_TEXT).textContent, `Scale runs, Up & down · ${runs.length - 1} rhythms`);
    // Down to one: it plays all the way, and the summary names it.
    for (const value of runs) click(`.practice-pattern[data-value="${value}"]`);
    assert.deepEqual(pressed("pattern"), ["pushes"], "pushes ticked back on, the rest off");
    click('.practice-pattern[data-value="pushes"]');
    assert.deepEqual(ctx.state.practiceRhythms, ["pushes"], "the last one stays ticked");
    assert.equal($(SUMMARY_TEXT).textContent, "Scale runs, Up & down · Pushes on the \"and\"");
    // A long-note pattern can join a run exercise.
    click('.practice-pattern[data-value="halves"]');
    assert.deepEqual(pressed("pattern"), ["pushes", "halves"]);
  } finally {
    page.cleanup();
  }
});
