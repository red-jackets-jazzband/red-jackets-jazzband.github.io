import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { PREF_KEYS } from "../lib/preferences.js";
import { createTour } from "./tour.js";
import { waitUntil } from "./tour-actions.js";

const UI = `# ui
next: Next
back: Back
skip: Skip tour
done: Done
progress: {chapter} · {n}/{total}
chapters: Chapters
language: Language
close: Close the tour
helpLabel: Take the tour
`;

// Four steps: search -> play (interactive) | ghost (target doesn't exist) -> print.
const EN = `${UI}
# one: Chapter one

## first: First step
target: #songSearch
Body with **bold**.

## second: Second step
target: #playPauseBtn
interactive: true
Try it.

# two: Chapter two

## ghost: Ghost step
target: #doesNotExist
Never shown.

## last: Last step
target: #printLink
- one
- two
`;

const NL = `# ui
next: Volgende
helpLabel: Volg de rondleiding

# one: Hoofdstuk een

## first: Eerste stap
Tekst met **vet**.
`;

const SECOND_STEP = "Second step";
const FILES = { "/tour/tour.en.md": EN, "/tour/tour.nl.md": NL };

const byId = (id) => document.getElementById(id);
const rootEl = () => byId("rjTour");
const title = () => rootEl().querySelector(".rj-tour-title").textContent;
const progress = () => rootEl().querySelector(".rj-tour-progress").textContent;
const primaryBtn = () => rootEl().querySelector(".rj-tour-btn--primary");
const backBtn = () => rootEl().querySelector(".rj-tour-btn:not(.rj-tour-btn--primary):not(.rj-tour-btn--quiet)");
const keydown = (key, target = document.body) => target.dispatchEvent(
  new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
);
// Resolves once the current step has finished its setup and been placed.
const settle = () => waitUntil(() => !rootEl().classList.contains("is-busy"), { timeout: 4000, interval: 10 });

async function setup({ files = FILES, storage = {} } = {}) {
  const page = mountPage();
  for (const [key, value] of Object.entries(storage)) {
    window.localStorage.setItem(key, value);
  }
  const calls = [];
  const ctx = makeCtx({
    readFile: (path, onLoad, onError) => {
      if (path in files) onLoad(files[path]);
      else onError(404);
    },
    mixer: { setOpen: (open) => calls.push(`mixer:${open}`) },
    inspiration: { setOpen: (open) => calls.push(`inspiration:${open}`) },
    audio: { stop: () => calls.push("audio.stop") },
  });
  const tour = createTour(ctx);
  await tour.init();
  return { tour, calls, cleanup: page.cleanup };
}

test("init shows the ? button, labelled in the visitor's language, and offers nothing unprompted", async () => {
  const { cleanup } = await setup();
  try {
    const btn = byId("tourBtn");
    assert.equal(btn.hidden, false);
    assert.equal(btn.getAttribute("aria-label"), "Take the tour");
    assert.equal(rootEl(), null, "the tour only starts from the ? button");
  } finally {
    cleanup();
  }
});

test("if the tour files can't be fetched, nothing is shown at all", async () => {
  const { cleanup } = await setup({ files: {} });
  try {
    assert.equal(byId("tourBtn").hidden, true);
    assert.equal(byId("rjTourOffer"), null);
  } finally {
    cleanup();
  }
});

test("the browser language picks NL, and a missing NL step falls back to English", async () => {
  const { cleanup } = await setup({ storage: { [PREF_KEYS.tourLang]: "nl" } });
  try {
    assert.equal(byId("tourBtn").getAttribute("aria-label"), "Volg de rondleiding");
    byId("tourBtn").click();
    await settle();
    assert.equal(title(), "Eerste stap");
    assert.equal(byId("rjTourBody").textContent, "Tekst met vet.");
    primaryBtn().click();
    await settle();
    assert.equal(title(), SECOND_STEP);
  } finally {
    cleanup();
  }
});

test("starting the tour dims the page, renders step one and stops any audio", async () => {
  const { calls, cleanup } = await setup();
  try {
    byId("tourBtn").click();
    await settle();
    assert.equal(rootEl().hidden, false);
    assert.equal(title(), "First step");
    assert.equal(progress(), "Chapter one · 1/2");
    assert.equal(byId("rjTourBody").querySelector("strong").textContent, "bold");
    assert.equal(backBtn().disabled, true);
    assert.equal(primaryBtn().textContent, "Next");
    assert.ok(calls.includes("audio.stop"));
  } finally {
    cleanup();
  }
});

test("Next / Back and the arrow keys walk the steps; a step with no target is skipped both ways", async () => {
  const { cleanup } = await setup();
  try {
    byId("tourBtn").click();
    await settle();
    primaryBtn().click();
    await settle();
    assert.equal(title(), SECOND_STEP);

    primaryBtn().click(); // Ghost step has no target: skipped, lands on "Last step"
    await settle();
    assert.equal(title(), "Last step");
    assert.equal(progress(), "Chapter two · 1/1", "a skipped step leaves no hole in the count");
    assert.equal(primaryBtn().textContent, "Done");
    assert.equal(byId("rjTourBody").querySelectorAll("li").length, 2);

    keydown("ArrowLeft");
    await settle();
    assert.equal(title(), SECOND_STEP, "Back doesn't land on the skipped step");
    // SECOND_STEP is a try-it step, so the arrows only count from the card itself.
    keydown("ArrowRight");
    await settle();
    assert.equal(title(), SECOND_STEP);
    keydown("ArrowRight", primaryBtn());
    await settle();
    assert.equal(title(), "Last step");
  } finally {
    cleanup();
  }
});

test("Done on the last step closes the tour", async () => {
  const { cleanup } = await setup();
  try {
    byId("tourBtn").click();
    await settle();
    for (let i = 0; i < 2; i += 1) {
      primaryBtn().click();
      await settle();
    }
    assert.equal(title(), "Last step");
    primaryBtn().click();
    assert.equal(rootEl().hidden, true);
  } finally {
    cleanup();
  }
});

test("chapter dots jump to a chapter's first available step", async () => {
  const { cleanup } = await setup();
  try {
    byId("tourBtn").click();
    await settle();
    rootEl().querySelectorAll(".rj-tour-dot")[1].click();
    await settle();
    assert.equal(title(), "Last step", "chapter two's first step is skipped for lack of a target");
    assert.equal(rootEl().querySelectorAll(".rj-tour-dot")[1].classList.contains("is-active"), true);
  } finally {
    cleanup();
  }
});

test("Escape ends the tour, restores the page and is kept from the page's own handlers", async () => {
  const { calls, cleanup } = await setup();
  try {
    let pageSawEscape = 0;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") pageSawEscape += 1;
    });
    byId("tourBtn").click();
    await settle();
    calls.length = 0;

    keydown("Escape");
    assert.equal(rootEl().hidden, true);
    assert.equal(pageSawEscape, 0);
    assert.ok(calls.includes("mixer:false") && calls.includes("inspiration:false"), "actions.end() ran");

    keydown("Escape"); // tour closed: the page gets Escape again
    assert.equal(pageSawEscape, 1);
  } finally {
    cleanup();
  }
});

test("while open, Space / arrows / slash never reach the page — except on a 'try it' step", async () => {
  const { cleanup } = await setup();
  try {
    const seen = [];
    document.addEventListener("keydown", (event) => seen.push(event.key));
    byId("tourBtn").click();
    await settle();

    for (const key of [" ", "ArrowDown", "ArrowUp", "/", "Enter"]) keydown(key);
    assert.deepEqual(seen, []);

    primaryBtn().click();
    await settle();
    assert.equal(title(), SECOND_STEP);
    keydown(" ");
    assert.deepEqual(seen, [" "], "an interactive step leaves the page's keys alone");
    keydown(" ", primaryBtn());
    assert.deepEqual(seen, [" "], "…but not when focus is on the tour's own card");
  } finally {
    cleanup();
  }
});

test("swallowed scroll keys are preventDefault-ed, except a card button's own Space/Enter", async () => {
  const { cleanup } = await setup();
  try {
    byId("tourBtn").click();
    await settle();
    const press = (key, target) => {
      const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    for (const key of [" ", "ArrowDown", "ArrowUp", "/"]) {
      assert.equal(press(key, document.body), true, `${JSON.stringify(key)} on the page must not scroll it`);
    }
    assert.equal(press(" ", primaryBtn()), false, "Space still presses a focused card button");
    assert.equal(press("Enter", primaryBtn()), false, "Enter still presses a focused card button");
    assert.equal(press("ArrowDown", primaryBtn()), true, "arrows on a card button don't scroll the page");
  } finally {
    cleanup();
  }
});

test("clicks inside the tour don't reach page-level click listeners", async () => {
  const { cleanup } = await setup();
  try {
    let pageClicks = 0;
    document.addEventListener("click", () => { pageClicks += 1; });
    byId("tourBtn").click();
    const afterLaunch = pageClicks;
    await settle();
    primaryBtn().click();
    assert.equal(pageClicks, afterLaunch);
  } finally {
    cleanup();
  }
});

test("the language switcher re-renders the step in place and remembers the choice", async () => {
  const { cleanup } = await setup();
  try {
    byId("tourBtn").click();
    await settle();
    assert.equal(title(), "First step");

    rootEl().querySelector('[data-lang="nl"]').click();
    await waitUntil(() => title() === "Eerste stap", { timeout: 2000, interval: 10 });
    assert.equal(title(), "Eerste stap");
    assert.equal(rootEl().querySelector('[data-lang="nl"]').getAttribute("aria-pressed"), "true");
    assert.equal(window.localStorage.getItem(PREF_KEYS.tourLang), "nl");
    assert.equal(byId("tourBtn").getAttribute("aria-label"), "Volg de rondleiding");
    assert.equal(primaryBtn().textContent, "Volgende");
  } finally {
    cleanup();
  }
});

test("Tab stays inside the card while a non-interactive step is showing", async () => {
  const { cleanup } = await setup();
  try {
    byId("tourBtn").click();
    await settle();
    const card = rootEl().querySelector(".rj-tour-card");
    const buttons = [...card.querySelectorAll("button:not([disabled])")];
    buttons.at(-1).focus();
    const event = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(document.activeElement, buttons[0]);
  } finally {
    cleanup();
  }
});
