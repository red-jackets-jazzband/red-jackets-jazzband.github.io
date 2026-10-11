import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
import { PRACTICE_RHYTHMS } from "../../lib/music/practice.js";
import { createPracticePanel } from "./practice-panel.js";

const TOGGLE = "#practiceToggle";
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
    assert.equal($("#practiceSummaryText").textContent, "Off");
    assert.equal($("#practicePanel").hidden, true);
    assert.equal($("#practiceSlot").querySelectorAll("select").length, 0, "no dropdowns left");
    click("#practiceSummary");
    assert.equal($("#practicePanel").hidden, false);
    assert.equal($("#practiceSummary").getAttribute("aria-expanded"), "true");
    click("#practiceDone");
    assert.equal($("#practicePanel").hidden, true);
  } finally {
    page.cleanup();
  }
});

test("each step writes its own setting, and any pick switches practice on", () => {
  const { page, ctx, rerenders } = setup();
  try {
    click("#practiceSummary");
    click('.practice-kind[data-value="arpeggios"]');
    assert.equal(ctx.state.practice, "scales-updown".replace("scales", "arpeggios"), "keeps the default shape");
    assert.equal(window.localStorage.getItem("rj.practice"), "arpeggios-updown");
    assert.deepEqual(pressed("kind"), ["arpeggios"]);
    assert.equal(rerenders.length, 1, "one pick, one re-render");

    click('.practice-shape[data-value="up"]');
    assert.equal(ctx.state.practice, "arpeggios-up");
    assert.deepEqual(pressed("shape"), ["up"]);
    assert.equal($("#practiceSummaryText").textContent, "Chord-tone runs, Up · Varied rhythm");

    click('.practice-mix[data-value="syncopated"]');
    assert.equal(ctx.state.practiceRhythm, "syncopated");
    assert.equal($("#practicePatterns").hidden, true);

    click('.practice-mix[data-value="fixed"]');
    assert.equal(ctx.state.practiceRhythm, "charleston", "one pattern starts on the Charleston");
    assert.equal($("#practicePatterns").hidden, false);
    assert.equal(document.querySelectorAll(".practice-pattern").length, PRACTICE_RHYTHMS.length);
    click('.practice-pattern[data-value="pushes"]');
    assert.equal(ctx.state.practiceRhythm, "pushes");
    assert.deepEqual(pressed("mix"), ["fixed"]);
    assert.deepEqual(pressed("pattern"), ["pushes"]);
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
    assert.equal($("#practiceSummaryText").textContent, "Off");
    assert.equal($(TOGGLE).getAttribute("aria-pressed"), "false");
    click(TOGGLE);
    assert.equal(ctx.state.practice, "enclosures");
    // A rhythm pick while off switches it back on too.
    click(TOGGLE);
    click('.practice-mix[data-value="varied"]');
    assert.equal(ctx.state.practice, "enclosures");
  } finally {
    page.cleanup();
  }
});

test("Escape inside the panel closes it", () => {
  const { page } = setup();
  try {
    click("#practiceSummary");
    $(".practice-kind").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal($("#practicePanel").hidden, true);
  } finally {
    page.cleanup();
  }
});
