import { byId, el, qsa } from "../lib/dom.js";
import { PREF_KEYS, readPref, writePref } from "../lib/preferences.js";
import {
  TOUR_LANGS,
  flattenTourSteps,
  formatTourString,
  mergeTourLang,
  parseTourMarkdown,
  resolveTourLang,
} from "../lib/tour-content.js";
import {
  dockScrollDelta,
  firstStepOfChapter,
  isDocked,
  nextStepIndex,
  placeTooltip,
  spotlightClipPath,
} from "../lib/tour-layout.js";
import { createTourActions, isShown, waitUntil } from "./tour-actions.js";

/*
  Guided first-time tour of the songs page: dims the page, spotlights the real
  control each step is about and explains it, in the visitor's language.
  Copy and structure come from static/tour/tour.<lang>.md (parsed by
  lib/tour-content.js); moving the page into the right state for each step is
  tour-actions.js's job. This module is the overlay, the step state machine and
  the keyboard.

  While the tour is open it owns the keyboard: a capture-phase handler on the
  document sees every key before the page's own shortcuts do — Escape would
  otherwise also close the mixer / leave full screen, Space would toggle
  playback, and Up/Down would step through a setlist behind the overlay.
  Clicks inside the tour stop at its root so they don't reach the mixer's
  "click outside to close" listener either.
*/

const TOUR_BTN_ID = "tourBtn";
const SPOTLIGHT_PAD = 6;
const TARGET_WAIT_MS = 1500;
const SWALLOWED_KEYS = new Set([" ", "Spacebar", "/", "ArrowUp", "ArrowDown", "Enter"]);
const INLINE_TAGS = { strong: "strong", em: "em", code: "code" };
const BUTTON = "button";

const stepKey = (step) => `${step.chapterId}/${step.id}`;

const toBox = (rect) => ({
  left: rect.left, top: rect.top, width: rect.width, height: rect.height,
});

// Stops a key from reaching the page's own shortcuts.
function swallow(event) {
  event.preventDefault();
  event.stopPropagation();
}

// Space / Enter on one of the card's own buttons must keep their native
// "press the button" behaviour, so those are the one case not preventDefault-ed.
function activatesCardButton(event, card) {
  if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
    return card.contains(event.target?.closest?.(BUTTON));
  }
  return false;
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function safeQuery(selector) {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

// The first of a step's target selectors that's really on screen.
function firstShown(selectors) {
  for (const selector of selectors) {
    const node = safeQuery(selector);
    if (node && isShown(node)) return node;
  }
  return null;
}

function renderInline(tokens) {
  return tokens.map((token) => (
    token.type === "text" ? token.text : el(INLINE_TAGS[token.type], { text: token.text })
  ));
}

// Paragraph / bullet blocks → <p> and <ul>, consecutive bullets sharing a list.
function renderBlocks(blocks) {
  const nodes = [];
  let list = null;
  for (const block of blocks) {
    if (block.list) {
      if (!list) {
        list = el("ul");
        nodes.push(list);
      }
      list.append(el("li", {}, renderInline(block.tokens)));
    } else {
      list = null;
      nodes.push(el("p", {}, renderInline(block.tokens)));
    }
  }
  return nodes;
}

// Tab stays inside the card (the page behind it is out of play).
function trapTab(event, card) {
  const focusable = qsa("button:not([disabled])", card);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  const current = document.activeElement;
  let to = null;
  if (!card.contains(current) || (!event.shiftKey && current === last)) to = first;
  else if (event.shiftKey && current === first) to = last;
  if (!to) return;
  swallow(event);
  to.focus();
}

async function findTarget(step) {
  if (!step.targets.length) return null;
  await waitUntil(() => firstShown(step.targets), { timeout: TARGET_WAIT_MS });
  return firstShown(step.targets);
}

export function createTour(ctx) {
  const actions = createTourActions(ctx);
  const fileCache = new Map(); // language code -> Promise<parsed file | null>
  const skipped = new Set(); // step keys whose target turned out not to exist
  let content = null;
  let flat = [];
  let lang = "en";
  let active = false;
  let index = 0;
  let seq = 0; // bumped on every navigation, so a slow step can tell it was overtaken
  let currentTarget = null;
  let returnFocus = null;
  let layoutPending = false;
  let refs = null;

  const ui = (key) => (content ? content.ui[key] || "" : "");
  const isAvailable = (step) => !skipped.has(stepKey(step));

  // ---- content ------------------------------------------------------

  function fetchFile(code) {
    if (!fileCache.has(code)) {
      fileCache.set(code, new Promise((resolve) => {
        ctx.readFile(`/tour/tour.${code}.md`, (text) => resolve(parseTourMarkdown(text)), () => resolve(null));
      }));
    }
    return fileCache.get(code);
  }

  // English is always the base (structure + fallback copy); another language
  // overlays it. Null when even the English file can't be read.
  async function loadContent(code) {
    const base = await fetchFile("en");
    if (!base) return null;
    if (code === "en") return base;
    return mergeTourLang(base, await fetchFile(code));
  }

  // ---- overlay ------------------------------------------------------

  function buildLangButtons() {
    return TOUR_LANGS.map((code) => el(BUTTON, {
      type: BUTTON,
      class: "rj-tour-lang-btn",
      text: code.toUpperCase(),
      dataset: { lang: code },
      attrs: { "aria-pressed": "false", lang: code },
      on: { click: () => setLang(code) },
    }));
  }

  function buildOverlay() {
    if (refs) return;
    const veil = el("div", { class: "rj-tour-veil" });
    const shield = el("div", { class: "rj-tour-shield" });
    const ring = el("div", { class: "rj-tour-ring" });
    const progress = el("span", { class: "rj-tour-progress" });
    const closeBtn = el(BUTTON, {
      type: BUTTON, class: "rj-tour-close", text: "×", on: { click: () => finish() },
    });
    const langs = el("div", { class: "rj-tour-lang", attrs: { role: "group" } }, buildLangButtons());
    const title = el("h2", { class: "rj-tour-title", id: "rjTourTitle" });
    const body = el("div", { class: "rj-tour-body", id: "rjTourBody" });
    const dots = el("div", { class: "rj-tour-dots", attrs: { role: "group" } });
    const skip = el(BUTTON, { type: BUTTON, class: "rj-tour-btn rj-tour-btn--quiet", on: { click: () => finish() } });
    const back = el(BUTTON, { type: BUTTON, class: "rj-tour-btn", on: { click: () => go(-1) } });
    const next = el(BUTTON, { type: BUTTON, class: "rj-tour-btn rj-tour-btn--primary", on: { click: () => go(1) } });
    const card = el("div", {
      class: "rj-tour-card",
      attrs: {
        role: "dialog", "aria-modal": "true", "aria-labelledby": "rjTourTitle", "aria-describedby": "rjTourBody",
      },
    }, [
      el("div", { class: "rj-tour-card-head" }, [progress, langs, closeBtn]),
      title, body, dots,
      el("div", { class: "rj-tour-actions" }, [skip, el("span", { class: "rj-tour-spacer" }), back, next]),
    ]);
    const root = el("div", { id: "rjTour", class: "rj-tour", hidden: true }, [veil, shield, ring, card]);
    // Clicks in the tour must not reach page-level "click outside" listeners
    // (the mixer closes itself on one).
    root.addEventListener("click", (event) => event.stopPropagation());
    document.body.append(root);
    refs = {
      root, veil, shield, ring, card, progress, closeBtn, langs, title, body, dots, skip, back, next,
    };
  }

  function renderDots(step) {
    refs.dots.replaceChildren(...content.chapters.map((chapter, i) => el(BUTTON, {
      type: BUTTON,
      class: i === step.chapterIndex ? "rj-tour-dot is-active" : "rj-tour-dot",
      attrs: {
        title: chapter.title,
        "aria-label": chapter.title,
        "aria-current": i === step.chapterIndex ? "step" : null,
      },
      on: { click: () => jumpToChapter(i) },
    })));
  }

  // Everything textual in the card, for the current step and language.
  function renderCard() {
    const step = flat[index];
    // Counted over the steps that are actually shown, so a skipped one
    // (no target on this song) doesn't leave a hole in "2/5".
    const shown = flat.filter((s) => s.chapterIndex === step.chapterIndex && isAvailable(s));
    refs.progress.textContent = formatTourString(ui("progress"), {
      chapter: step.chapterTitle, n: shown.indexOf(step) + 1, total: shown.length,
    });
    refs.title.textContent = step.title;
    refs.body.replaceChildren(...renderBlocks(step.body));
    refs.langs.setAttribute("aria-label", ui("language"));
    for (const btn of qsa(".rj-tour-lang-btn", refs.langs)) {
      btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
      btn.classList.toggle("is-active", btn.dataset.lang === lang);
    }
    refs.dots.setAttribute("aria-label", ui("chapters"));
    renderDots(step);
    refs.closeBtn.setAttribute("aria-label", ui("close"));
    refs.skip.textContent = ui("skip");
    refs.back.textContent = ui("back");
    const hasNext = nextStepIndex(flat, index, 1, isAvailable) >= 0;
    refs.next.textContent = hasNext ? ui("next") : ui("done");
    refs.back.disabled = nextStepIndex(flat, index, -1, isAvailable) < 0;
  }

  function positionRing(box) {
    const { style } = refs.ring;
    refs.ring.hidden = !box;
    if (!box) return;
    style.left = `${box.left - SPOTLIGHT_PAD}px`;
    style.top = `${box.top - SPOTLIGHT_PAD}px`;
    style.width = `${box.width + SPOTLIGHT_PAD * 2}px`;
    style.height = `${box.height + SPOTLIGHT_PAD * 2}px`;
  }

  function layout(target) {
    const step = flat[index];
    let box = target ? toBox(target.getBoundingClientRect()) : null;
    // Measure the card in its neutral (undocked, unplaced) shape.
    delete refs.card.dataset.placement;
    refs.card.style.left = "";
    refs.card.style.top = "";
    const cardRect = refs.card.getBoundingClientRect();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const spot = placeTooltip(box, cardRect, viewport);
    if (isDocked(spot.placement) && box) {
      // Nudge the page so the spotlighted control clears the docked card.
      const dy = dockScrollDelta(spot.placement, box, cardRect.height, viewport.height);
      if (dy) window.scrollBy(0, dy);
      box = toBox(target.getBoundingClientRect());
    }
    refs.veil.style.clipPath = spotlightClipPath(box, SPOTLIGHT_PAD);
    // A hole in the shield lets clicks through to the real control — only
    // wanted on the "try it" steps; otherwise the shield blocks everything.
    refs.shield.style.clipPath = step.interactive ? spotlightClipPath(box, SPOTLIGHT_PAD) : "none";
    positionRing(box);
    refs.card.dataset.placement = spot.placement;
    const docked = isDocked(spot.placement);
    refs.card.style.left = docked ? "" : `${spot.left}px`;
    refs.card.style.top = docked ? "" : `${spot.top}px`;
  }

  // Resize / scroll: re-find the target (a re-render may have replaced it) and
  // re-place, at most once a frame.
  function scheduleLayout() {
    if (!active || layoutPending) return;
    layoutPending = true;
    requestAnimationFrame(() => {
      layoutPending = false;
      if (!active) return;
      currentTarget = firstShown(flat[index].targets) || currentTarget;
      layout(currentTarget);
    });
  }

  // ---- navigation ---------------------------------------------------

  async function showStep(nextIndex, dir) {
    const token = seq + 1;
    seq = token;
    index = nextIndex;
    const step = flat[index];
    refs.root.classList.add("is-busy");
    renderCard();
    await actions.apply(step.setup);
    if (token !== seq) return;
    const target = await findTarget(step);
    if (token !== seq) return;
    if (!target && step.targets.length) {
      // Nothing to point at (a tune without chords has no iReal Pro button,
      // YouTube blocked, ...): drop the step and carry on in the same direction.
      skipped.add(stepKey(step));
      advance(nextStepIndex(flat, index, dir, isAvailable), dir);
      return;
    }
    if (target) target.scrollIntoView({ block: "center", inline: "nearest" });
    await nextFrame();
    if (token !== seq) return;
    currentTarget = target;
    renderCard();
    layout(target);
    refs.root.classList.remove("is-busy");
    refs.next.focus({ preventScroll: true });
  }

  // `to` is the next index in direction `dir`, or -1 when that way is exhausted.
  function advance(to, dir) {
    if (to >= 0) {
      showStep(to, dir);
    } else if (dir > 0) {
      finish();
    } else {
      showStep(nextStepIndex(flat, index, 1, isAvailable), 1);
    }
  }

  function go(dir) {
    if (active) advance(nextStepIndex(flat, index, dir, isAvailable), dir);
  }

  function jumpToChapter(chapterIndex) {
    const target = firstStepOfChapter(flat, chapterIndex);
    if (active && target >= 0) showStep(target, 1);
  }

  async function setLang(code) {
    const next = await loadContent(code);
    if (!next) return;
    lang = code;
    content = next;
    flat = flattenTourSteps(content);
    writePref(PREF_KEYS.tourLang, code);
    labelHelpButton();
    if (active) {
      renderCard();
      layout(currentTarget);
    }
  }

  // ---- keyboard / lifecycle ------------------------------------------

  function onKeydown(event) {
    if (!active) return;
    if (event.key === "Escape") {
      swallow(event);
      finish();
      return;
    }
    const step = flat[index];
    // On a "try it" step the page underneath is meant to be used — leave its
    // keys alone unless focus is on the tour's own card.
    if (step.interactive && !refs.card.contains(event.target)) return;
    if (event.key === "ArrowRight") {
      swallow(event);
      go(1);
    } else if (event.key === "ArrowLeft") {
      swallow(event);
      go(-1);
    } else if (event.key === "Tab" && !step.interactive) {
      trapTab(event, refs.card);
    } else if (SWALLOWED_KEYS.has(event.key)) {
      // Kept from the page's own shortcuts, and from scrolling it (Space,
      // Up/Down) — except a card button's own Space/Enter activation.
      event.stopPropagation();
      if (!activatesCardButton(event, refs.card)) event.preventDefault();
    }
  }

  function setListeners(on) {
    const method = on ? "addEventListener" : "removeEventListener";
    document[method]("keydown", onKeydown, true);
    window[method]("resize", scheduleLayout);
    window[method]("scroll", scheduleLayout, true);
  }

  function finish() {
    if (!active) return;
    active = false;
    seq += 1;
    setListeners(false);
    refs.root.hidden = true;
    refs.root.classList.remove("is-busy");
    currentTarget = null;
    actions.end();
    if (returnFocus?.focus) returnFocus.focus({ preventScroll: true });
  }

  function start() {
    if (active || !content || !flat.length) return undefined;
    active = true;
    skipped.clear();
    returnFocus = document.activeElement;
    buildOverlay();
    actions.begin();
    setListeners(true);
    refs.root.hidden = false;
    return showStep(nextStepIndex(flat, -1, 1, isAvailable), 1);
  }

  // ---- launcher: the "?" button ----------------

  function labelHelpButton() {
    const btn = byId(TOUR_BTN_ID);
    if (!btn) return;
    btn.title = ui("helpLabel");
    btn.setAttribute("aria-label", ui("helpLabel"));
  }

  /*
    The tour only ever starts from the "?" button. If the tour files can't be
    fetched the button stays hidden.
  */
  async function init() {
    lang = resolveTourLang(readPref(PREF_KEYS.tourLang), window.location.pathname, window.navigator.languages);
    content = await loadContent(lang);
    if (!content) return;
    flat = flattenTourSteps(content);
    const btn = byId(TOUR_BTN_ID);
    if (btn) {
      btn.addEventListener("click", () => start());
      labelHelpButton();
      btn.hidden = false;
    }
  }

  return {
    init, start, stop: finish, isActive: () => active,
  };
}
