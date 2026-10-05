import {
  byId, clear, el, qsa,
} from "../../lib/core/dom.js";
import { PREF_KEYS, readPref, writePref } from "../../lib/core/preferences.js";
import {
  TOUR_LANGS,
  flattenTourSteps,
  formatTourString,
  mergeTourLang,
  parseTourMarkdown,
  resolveTourLang,
} from "../../lib/tour/tour-content.js";
import {
  dockScrollDelta,
  firstStepOfChapter,
  isDocked,
  nextStepIndex,
  placeTooltip,
  spotlightClipPath,
  tightenBox,
} from "../../lib/tour/tour-layout.js";
import { launchConfetti } from "./confetti.js";
import { createTourActions, isShown, waitUntil } from "./actions.js";

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
const TOUR_LINK_ID = "tourStartLink";
const SPOTLIGHT_PAD = 6;
const TARGET_WAIT_MS = 1500;
const SETTLE_STILL_FRAMES = 6;
const SETTLE_MAX_FRAMES = 90;
const SWALLOWED_KEYS = new Set([" ", "Spacebar", "/", "ArrowUp", "ArrowDown", "Enter"]);
const INLINE_TAGS = { strong: "strong", em: "em", code: "code" };
// `gold:word` / `magenta:word` in the copy: a bold word in that note colour.
const COLOUR_WORD = /^(gold|magenta):(.+)$/;
// `btn:A` in the copy draws a text-labelled button (the loop bar's A and B).
const BUTTON_WORD = /^btn:(.+)$/;
const KEY_WORD = /^key:(.+)$/;
const TAB_WORD = /^tab:(.+)$/;
const BUTTON = "button";
const CONTROL_SELECTOR = "button, a, select, input, textarea";
const LANG_NAMES = {
  en: "English", nl: "Nederlands", de: "Deutsch", fr: "Français",
};

const stepKey = (step) => `${step.chapterId}/${step.id}`;

const toBox = (rect) => ({
  left: rect.left, top: rect.top, width: rect.width, height: rect.height,
});

// The box to spotlight for a non-interactive `target`: its own box, tightened
// to its visible children's — a target that's a flex-stretched container
// (e.g. the library list, `flex: 1` over whatever height the sidebar leaves,
// even with only a couple of rows in it) spotlights just its content instead
// of the empty space filling out the rest of its own height.
function targetBox(target) {
  const own = toBox(target.getBoundingClientRect());
  // A control's own box is the thing to point at: its icon/label is centred
  // inside it, so tightening to that would shrink the ring to the glyph.
  if (target.matches(CONTROL_SELECTOR)) return own;
  const children = [...target.children]
    .filter((child) => isShown(child))
    .map((child) => toBox(child.getBoundingClientRect()));
  return tightenBox(own, children);
}

// A "try it" step needs the whole real control reachable through the
// shield's hole, not just the part `targetBox` currently sees — including
// content that only exists once the visitor has interacted with it (search
// results dropping in below the add-song field, a set-break's label input
// appearing after the button is clicked). So an interactive step always
// spotlights the target's own full bounding box; a step that's only
// pointing something out keeps the tightened box.
function boxForTarget(target, step) {
  return step.interactive ? toBox(target.getBoundingClientRect()) : targetBox(target);
}

// Stops a key from reaching the page's own shortcuts.
function swallow(event) {
  event.preventDefault();
  event.stopPropagation();
}

// Space / Enter on one of the card's own buttons must keep their native
// "press the button" behaviour, so those are the one case not preventDefault-ed.
function activatesCardButton(event, card) {
  if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
    const target = event.target;
    const closestButton = target && target.closest && target.closest(BUTTON);
    return card.contains(closestButton);
  }
  return false;
}

// State class of chapter `i`'s dot: filled once its chapter is finished, gold for
// the one being walked, pulsing on the next chapter's while the "chapter done"
// card is up.
function dotState(i, step) {
  if (step.interstitial) {
    if (i <= step.chapterIndex) return "is-done";
    return i === step.chapterIndex + 1 ? "is-next" : "";
  }
  if (i === step.chapterIndex) return "is-active";
  return i < step.chapterIndex ? "is-done" : "";
}

// How much of a chapter's bar is filled: all of a finished chapter's, none of
// a later one's, and the walked one's by how many of its shown steps are reached.
function fillFraction(state, step, shown) {
  if (state === "is-done") return 1;
  if (state !== "is-active" || !shown.length) return 0;
  return (shown.indexOf(step) + 1) / shown.length;
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

// A "..." part marker is dashed, like the form strip's .songForm-part--more.
function inlineAttrs(token) {
  return token.type === "code" && token.text === "..."
    ? { text: token.text, class: "rj-tour-more" }
    : { text: token.text };
}

// `fa-drum` in the copy draws that Font Awesome icon, as on the real button.
function renderToken(token) {
  if (token.type === "text") return token.text;
  if (token.type === "code" && token.text.startsWith("fa-")) {
    const icon = el("span", { class: `fa-solid ${token.text}`, attrs: { "aria-hidden": "true" } });
    return el("span", { class: "rj-tour-keyicon" }, [icon]);
  }
  const button = token.type === "code" ? BUTTON_WORD.exec(token.text) : null;
  if (button) return el("span", { class: "rj-tour-keyicon", text: button[1] });
  const key = token.type === "code" ? KEY_WORD.exec(token.text) : null;
  if (key) return el("kbd", { text: key[1], class: "rj-tour-key" });
  const tab = token.type === "code" ? TAB_WORD.exec(token.text) : null;
  if (tab) return el("span", { class: "rj-tour-tab", text: tab[1] });
  const colour = token.type === "code" ? COLOUR_WORD.exec(token.text) : null;
  if (colour) return el("strong", { text: colour[2], class: `rj-tour-${colour[1]}` });
  return el(INLINE_TAGS[token.type], inlineAttrs(token));
}

function renderInline(tokens) {
  return tokens.map(renderToken);
}

// Paragraph / bullet blocks → <p> and <ul>, consecutive bullets sharing a list.
function renderBlocks(blocks) {
  const nodes = [];
  const tips = [];
  let list = null;
  for (const block of blocks) {
    if (block.tip) {
      tips.push(el("p", { class: "rj-tour-tip" }, renderInline(block.tokens)));
    } else if (block.list) {
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
  return [...nodes, ...tips];
}

// Tab stays inside the card (the page behind it is out of play).
function trapTab(event, card) {
  const focusable = qsa("button:not([disabled])", card);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
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

// A quiet menu rather than a row of buttons: the current language's name
// (its own endonym) with a native picker behind it.
function buildLangMenu() {
  return TOUR_LANGS.map((code) => el("option", {
    value: code, text: LANG_NAMES[code] || code.toUpperCase(), attrs: { lang: code },
  }));
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
  let pageObserver = null; // watches the page for content changes under the current spotlight

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

  function buildOverlay() {
    if (refs) return;
    const veil = el("div", { class: "rj-tour-veil" });
    const shield = el("div", { class: "rj-tour-shield" });
    const ring = el("div", { class: "rj-tour-ring" });
    const progress = el("span", { class: "rj-tour-progress" });
    const closeBtn = el(BUTTON, {
      type: BUTTON, class: "rj-tour-close", text: "×", on: { click: () => finish() },
    });
    const langs = el("select", {
      class: "rj-tour-lang",
      on: { change: () => setLang(langs.value) },
    }, buildLangMenu());
    const title = el("h2", { class: "rj-tour-title", id: "rjTourTitle" });
    const body = el("div", { class: "rj-tour-body", id: "rjTourBody" });
    const dots = el("div", { class: "rj-tour-rail", attrs: { role: "group" } });
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
      el("div", { class: "rj-tour-scroll" }, [title, body, dots]),
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

  // The chapter rail: a numbered mark per chapter (a tick once finished) with a
  // progress bar under it; only the chapter being walked shows its short name.
  function renderRail(step, shown) {
    clear(refs.dots);
    refs.dots.append(...content.chapters.map((chapter, i) => {
      const state = dotState(i, step);
      const current = state === "is-active";
      const fill = fillFraction(state, step, shown);
      return el(BUTTON, {
        type: BUTTON,
        class: `rj-tour-rail-item ${state}`.trim(),
        attrs: {
          title: chapter.title,
          "aria-label": chapter.title,
          "aria-current": current ? "step" : null,
        },
        on: { click: () => jumpToChapter(i) },
      }, [
        el("span", { class: "rj-tour-rail-mark", text: state === "is-done" ? "✓" : String(i + 1) }),
        el("span", { class: "rj-tour-rail-bar" }, [
          el("span", { class: "rj-tour-rail-fill", style: { width: `${Math.round(fill * 100)}%` } }),
        ]),
        el("span", { class: "rj-tour-rail-label", text: current ? railLabel(chapter) : "" }),
      ]);
    }));
  }

  function railLabel(chapter) {
    return ui(`rail${chapter.id.charAt(0).toUpperCase()}${chapter.id.slice(1)}`) || chapter.title;
  }

  // Numbered, clickable overview of the chapters (title + one-line summary).
  // On a "chapter done" card finished chapters show a check and the next is
  // highlighted; on the welcome card none is marked.
  function buildTopicList(step) {
    return el("ol", { class: "rj-tour-topics" }, content.chapters.map((chapter, i) => {
      const state = step.interstitial ? dotState(i, step) : "";
      return el("li", {}, [
        el(BUTTON, { type: BUTTON, class: `rj-tour-topic ${state}`.trim(), on: { click: () => jumpToChapter(i) } }, [
          el("span", { class: "rj-tour-topic-num", text: state === "is-done" ? "✓" : String(i + 1) }),
          el("span", { class: "rj-tour-topic-text" }, [
            el("strong", { text: chapter.title }),
            el("span", { text: ui(`topic${chapter.id.charAt(0).toUpperCase()}${chapter.id.slice(1)}`) }),
          ]),
        ]),
      ]);
    }));
  }

  // On a "chapter done" card the next chapter's row can sit below the fold of
  // the card's own scroll area; bring it into view (scrollTop, not
  // scrollIntoView, so only that area moves — never the page behind).
  function revealNextTopic() {
    const row = refs.body.querySelector(".rj-tour-topic.is-next");
    const area = row && row.closest(".rj-tour-scroll");
    if (!area) return;
    const areaBox = area.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (rowBox.bottom > areaBox.bottom) area.scrollTop += rowBox.bottom - areaBox.bottom + 8;
    else if (rowBox.top < areaBox.top) area.scrollTop -= areaBox.top - rowBox.top + 8;
  }

  // Everything textual in the card, for the current step and language.
  function renderCard() {
    const step = flat[index];
    // Counted over the steps that are actually shown, so a skipped one
    // (no target on this song) doesn't leave a hole in "2/5".
    const shown = flat.filter((s) => s.chapterIndex === step.chapterIndex && !s.interstitial && isAvailable(s));
    refs.progress.textContent = step.interstitial ? step.chapterTitle : formatTourString(ui("progress"), {
      chapter: step.chapterTitle, n: shown.indexOf(step) + 1, total: shown.length,
    });
    refs.title.textContent = step.title;
    clear(refs.body);
    const blocks = renderBlocks(step.body);
    // The first card lays out the whole plan, one row per chapter; each "chapter
    // done" card repeats it with the finished ones checked off.
    if (index === 0) blocks.splice(1, 0, el("p", { text: ui("topicsIntro") }), buildTopicList(step));
    else if (step.interstitial) blocks.push(buildTopicList(step));
    refs.body.append(...blocks);
    refs.langs.setAttribute("aria-label", ui("language"));
    refs.langs.value = lang;
    refs.dots.setAttribute("aria-label", ui("chapters"));
    renderRail(step, shown);
    refs.closeBtn.setAttribute("aria-label", ui("close"));
    refs.skip.textContent = ui("skip");
    refs.back.textContent = ui("back");
    const hasNext = nextStepIndex(flat, index, 1, isAvailable) >= 0;
    refs.next.textContent = hasNext ? primaryLabel(step) : ui("done");
    refs.back.disabled = nextStepIndex(flat, index, -1, isAvailable) < 0;
  }

  // First card invites ("Show me around"), a chapter break moves on ("On to the next").
  function primaryLabel(step) {
    if (index === 0) return ui("start") || ui("next");
    return (step.interstitial && ui("nextChapter")) || ui("next");
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
    let box = target ? boxForTarget(target, step) : null;
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
      box = boxForTarget(target, step);
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

  // A target can still be moving when the step is laid out (a CSS transition,
  // a toolbar reflowing after the scroll, a late-loading font) — none of which
  // fires a resize/scroll/mutation. Keep re-measuring each frame until its box
  // has held still for a few frames (bounded), so the ring lands on where the
  // control ends up, not where it was mid-move.
  function settleLayout(token) {
    let last = "";
    let still = 0;
    let frames = 0;
    const tick = () => {
      if (!active || token !== seq) return;
      const rect = currentTarget ? currentTarget.getBoundingClientRect() : null;
      const key = rect ? `${rect.left},${rect.top},${rect.width},${rect.height}` : "";
      still = key === last ? still + 1 : 0;
      if (key !== last) layout(currentTarget);
      last = key;
      frames += 1;
      if (still < SETTLE_STILL_FRAMES && frames < SETTLE_MAX_FRAMES) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // An interactive step's real target can change shape after the visitor
  // touches it — search results dropping in below the add-song field, a
  // set-break's label row appearing once the button is clicked — with
  // nothing so much as a resize or scroll to tell the tour to re-measure.
  // Watching the page for any content change and re-running the same
  // re-find-and-place scheduleLayout does for resize/scroll covers all of
  // that generically, current and future steps alike. Mutations inside the
  // tour's own card (renderCard's own re-renders) are ignored — those are
  // already followed by an explicit layout() call.
  function onPageMutation(records) {
    if (records.every((record) => refs.root.contains(record.target))) return;
    scheduleLayout();
  }

  function watchPage(on) {
    if (pageObserver) pageObserver.disconnect();
    pageObserver = null;
    if (!on) return;
    pageObserver = new window.MutationObserver(onPageMutation);
    pageObserver.observe(document.body, { childList: true, subtree: true });
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
    settleLayout(token);
    revealNextTopic();
    refs.root.classList.remove("is-busy");
    refs.next.focus({ preventScroll: true });
    if (nextStepIndex(flat, index, 1, isAvailable) < 0) launchConfetti(refs.root, refs.card);
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

  // The capture-phase scroll listener also hears the card's own inner scroll
  // area; re-laying out then resets the card (placement removed to measure it
  // neutrally), which snaps its scroll position back — so the step list on an
  // overview card couldn't be scrolled once the page itself was scrolled.
  function onScroll(event) {
    if (event.target instanceof Node && refs.root.contains(event.target)) return;
    scheduleLayout();
  }

  function setListeners(on) {
    const method = on ? "addEventListener" : "removeEventListener";
    document[method]("keydown", onKeydown, true);
    window[method]("resize", scheduleLayout);
    window[method]("scroll", onScroll, true);
    watchPage(on);
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
    if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true });
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
    const link = byId(TOUR_LINK_ID);
    if (link) {
      link.addEventListener("click", () => start());
      link.hidden = false;
    }
  }

  return {
    init, start, stop: finish, isActive: () => active,
  };
}
