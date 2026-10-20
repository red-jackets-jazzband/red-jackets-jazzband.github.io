import { byId, clear, el } from "../../lib/core/dom.js";
import {
  exerciseTakesShape, formatExercise, parseExercise, practiceDefaultRhythms, practiceNoteSet, practiceSummary,
  practiceSummaryParts, PRACTICE_APPROACHES, PRACTICE_DEGREE_LABELS, PRACTICE_DEGREES, PRACTICE_KINDS,
  PRACTICE_NOTE_SETS, PRACTICE_RHYTHMS, PRACTICE_SHAPES,
} from "../../lib/music/practice.js";
import { tl } from "../../lib/core/i18n.js";
import { BACKGROUND } from "../core/state.js";
import { degreeItems, noteSetSvg } from "./notes-svg.js";
import { rhythmSvg } from "./rhythm-svg.js";

/*
  The practice routine (#practiceSlot, in the More-controls drawer): a view
  of the settings slice's `practice` (an exercise value, or "off") and
  `practiceRhythms`. Closed it's one control — an on/off switch and a summary
  button ("PRACTICE  7th chords, Up & down · Charleston"); the summary opens
  #practicePanel inline below it, numbered steps read top to bottom:
  1 what to play (PRACTICE_KINDS: Chord tones, Scales, Approach);
  2 which notes — preset cards, each drawing its notes on a little staff,
    plus Custom, which opens a row of the kind's degrees to switch on and
    off one by one (never none) — or, for Approach, how to approach;
  3 the run's shape (only for runs of two notes or more, not guide tones);
  then rhythm (every PRACTICE_RHYTHMS pattern drawn as one bar of rhythm
  notation, with a tick box: one ticked plays all the way, several take
  turns; never none — with none stored yet, the exercise's own set shows
  ticked), and Done. Any pick also switches practice on; the switch
  remembers the exercise it last turned off. sheet.js appends the exercise
  as one more staff.
*/

const SVG_NS = "http://www.w3.org/2000/svg";
const VALUE_ATTR = "data-value";
const KIND_ATTR = "data-kind";
const CUSTOM = "custom";
const DEFAULT_EXERCISE = "scales-updown";
// What Custom starts from before it's been changed: not one of the presets.
const FIRST_CUSTOM = { arpeggios: [1, 3, 7], scales: [1, 2, 3, 5] };
const RUN_KINDS = PRACTICE_KINDS.filter((k) => k.runs).map((k) => k.value);

function contour(points) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 64 26");
  svg.setAttribute("width", "56");
  svg.setAttribute("height", "22");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS(SVG_NS, "polyline");
  line.setAttribute("points", points);
  svg.append(line);
  return svg;
}

function stepTitle(num, text) {
  return el("div", { class: "practice-step-title" }, [num, typeof text === "string" ? el("span", { text }) : text]);
}

const stepNum = (text) => el("span", { class: "practice-step-num", text });

function choice(className, value, children) {
  return el("button", { type: "button", class: `practice-choice ${className}`, attrs: { [VALUE_ATTR]: value } }, children);
}

// Tick the buttons `isOn` says yes to (a value, or a test on the value).
function markPressed(buttons, isOn) {
  const test = typeof isOn === "function" ? isOn : (value) => value === isOn;
  for (const button of buttons) {
    const on = test(button.getAttribute(VALUE_ATTR));
    button.classList.toggle("is-selected", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

// Each button of a group calls `pick` with its own value.
function onPick(buttons, pick) {
  for (const button of buttons) {
    button.addEventListener("click", () => pick(button.getAttribute(VALUE_ATTR)));
  }
}

// The ticked patterns: the setting's, or the exercise's own set when it has none.
function tickedRhythms(rhythms, exercise) {
  return rhythms && rhythms.length > 0 ? rhythms : practiceDefaultRhythms(exercise);
}

const STEP_CLASS = "practice-step";
const choiceLabel = (text) => el("span", { class: "practice-choice-label", text });

const setCard = (value, label, svg) => choice("practice-set", value, [svg, choiceLabel(label)]);

// One kind's cards: its preset note sets and Custom, or the approach styles.
function buildCards(kind) {
  if (kind === "enclosures") {
    return PRACTICE_APPROACHES.map((a) => setCard(a.value, a.label, noteSetSvg(a.draw)));
  }
  const stacked = kind === "arpeggios";
  const cards = PRACTICE_NOTE_SETS[kind].map((set) => setCard(set.value, set.label, noteSetSvg(degreeItems(set.degrees), { stacked })));
  cards.push(setCard(CUSTOM, tl("practice_set_custom", "Custom"), noteSetSvg(degreeItems(FIRST_CUSTOM[kind]), { stacked })));
  return cards;
}

function buildNotesStep() {
  const groups = {};
  const degrees = {};
  const rows = [];
  for (const kind of PRACTICE_KINDS.map((k) => k.value)) {
    const cards = buildCards(kind);
    groups[kind] = { cards, box: el("div", { class: "practice-choices practice-choices--sets", attrs: { [KIND_ATTR]: kind } }, cards) };
    rows.push(groups[kind].box);
  }
  for (const kind of RUN_KINDS) {
    const buttons = PRACTICE_DEGREES[kind].map((d) => el("button", {
      type: "button", class: "practice-degree", text: PRACTICE_DEGREE_LABELS[d], attrs: { [VALUE_ATTR]: String(d) },
    }));
    degrees[kind] = {
      buttons,
      box: el("div", {
        class: "practice-degrees", attrs: { [KIND_ATTR]: kind, role: "group", "aria-label": tl("practice_custom_aria", "Notes to play") },
      }, buttons),
    };
    rows.push(degrees[kind].box);
  }
  const title = el("span", { id: "practiceNotesTitle" });
  const step = el("div", { class: STEP_CLASS, id: "practiceNotesStep" }, [stepTitle(stepNum("2"), title), ...rows]);
  return { step, title, groups, degrees };
}

function buildPanel() {
  const kinds = PRACTICE_KINDS.map((kind) => choice("practice-kind", kind.value, [
    choiceLabel(kind.label),
  ]));
  const shapes = PRACTICE_SHAPES.map((shape) => choice("practice-shape", shape.value, [
    contour(shape.points),
    choiceLabel(shape.label),
  ]));
  const patterns = PRACTICE_RHYTHMS.map((rhythm) => choice("practice-pattern", rhythm.value, [
    rhythmSvg(rhythm.cell),
    choiceLabel(rhythm.label),
  ]));
  const notes = buildNotesStep();
  const shapeStep = el("div", { class: STEP_CLASS, id: "practiceShapeStep" }, [
    stepTitle(stepNum("3"), tl("practice_step_shape", "Run shape")),
    el("div", { class: "practice-choices practice-choices--shapes" }, shapes),
  ]);
  const rhythmNum = stepNum("4");
  const patternGrid = el("div", {
    class: "practice-choices practice-choices--patterns", id: "practicePatterns",
    attrs: { role: "group", "aria-labelledby": "practiceRhythmTitle" },
  }, patterns);
  const done = el("button", { type: "button", class: "practice-done", id: "practiceDone", text: tl("practice_done", "Done") });
  const panel = el("section", {
    class: "practice-panel", id: "practicePanel", attrs: { "aria-label": tl("practice_title", "Practice routine") },
  }, [
    el("div", { class: "practice-head" }, [
      el("p", { class: "practice-title", text: tl("practice_title", "Practice routine") }),
    ]),
    el("div", { class: STEP_CLASS }, [
      stepTitle(stepNum("1"), tl("practice_step_what", "What to play")),
      el("div", { class: "practice-choices practice-choices--kinds" }, kinds),
    ]),
    notes.step,
    shapeStep,
    el("div", { class: STEP_CLASS }, [
      stepTitle(rhythmNum, el("span", { id: "practiceRhythmTitle", text: tl("practice_step_rhythm", "Rhythm") })),
      patternGrid,
    ]),
    el("div", { class: "practice-foot" }, [
      done,
    ]),
  ]);
  panel.hidden = true;
  return { panel, kinds, shapes, patterns, notes, shapeStep, rhythmNum, done };
}

export function createPracticePanel(ctx) {
  const slot = byId("practiceSlot");
  if (!slot) return;

  const knob = el("span", { class: "practice-switch-knob" });
  const toggle = el("button", {
    type: "button", class: "practice-switch", id: "practiceToggle",
    attrs: { "aria-label": tl("practice_toggle_aria", "Practice on or off") },
  }, el("span", { class: "practice-switch-track" }, knob));
  const summaryText = el("span", { class: "practice-summary-text", id: "practiceSummaryText" });
  const summary = el("button", {
    type: "button", class: "practice-summary", id: "practiceSummary",
    attrs: { "aria-expanded": "false", "aria-controls": "practicePanel" },
  }, [el("span", { class: "practice-summary-label", text: tl("practice_label", "Practice") }), summaryText]);
  const ui = buildPanel();
  slot.append(el("div", { class: "practice-control" }, [toggle, summary]), ui.panel);

  // What the switch turns back on.
  const initial = ctx.state.practice;
  let lastExercise = initial === "off" ? DEFAULT_EXERCISE : initial;
  const current = () => (ctx.state.practice === "off" ? lastExercise : ctx.state.practice);
  const parsedNow = () => parseExercise(current()) || parseExercise(DEFAULT_EXERCISE);
  // Each kind's last exercise, the last run shape picked, and Custom: open
  // (picked, even while it matches a preset) and the set it last held.
  const lastOfKind = {};
  const customOpen = { arpeggios: false, scales: false };
  const custom = { ...FIRST_CUSTOM };
  const start = parsedNow();
  lastOfKind[start.kind] = formatExercise(start);
  let lastShape = exerciseTakesShape(start) ? start.variant : "updown";
  if (start.degrees !== null && !practiceNoteSet(start.kind, start.degrees)) {
    customOpen[start.kind] = true;
    custom[start.kind] = start.degrees;
  }

  // Write one or both settings as one change, switching practice on with it.
  const write = (patch) => {
    ctx.store.set("settings", { practice: current(), ...patch }, BACKGROUND);
  };
  const writeExercise = (parsed, patch = {}) => {
    lastExercise = formatExercise(parsed);
    lastOfKind[parsed.kind] = lastExercise;
    if (exerciseTakesShape(parsed)) lastShape = parsed.variant;
    write({ practice: lastExercise, ...patch });
  };

  const setOpen = (open) => {
    ui.panel.hidden = !open;
    slot.classList.toggle("is-open", open);
    summary.setAttribute("aria-expanded", open ? "true" : "false");
  };

  const drawSummary = () => {
    const rhythm = ctx.state.practiceRhythms;
    // Exercise and rhythm as two spans, so a phone can stack them (split.css);
    // the full line is the button's tooltip.
    const parts = practiceSummaryParts(ctx.state.practice, rhythm);
    const line = practiceSummary(ctx.state.practice, rhythm);
    summary.title = line;
    clear(summaryText);
    if (parts === null) {
      summaryText.append(line);
    } else {
      summaryText.append(
        el("span", { class: "practice-summary-what", text: parts.exercise }),
        el("span", { class: "practice-summary-sep", text: " · " }),
        el("span", { class: "practice-summary-rhythm", text: parts.rhythm }),
      );
    }
  };

  // Step 2: the kind's cards (one picked), and for Custom its row of degrees.
  const drawNotes = (parsed, on) => {
    const { notes } = ui;
    notes.title.textContent = parsed.kind === "enclosures"
      ? tl("practice_step_approach", "How to approach")
      : tl("practice_step_notes", "Which notes");
    for (const kind of Object.keys(notes.groups)) notes.groups[kind].box.hidden = kind !== parsed.kind;
    let picked = parsed.variant;
    if (parsed.degrees !== null) {
      const preset = practiceNoteSet(parsed.kind, parsed.degrees);
      picked = customOpen[parsed.kind] || !preset ? CUSTOM : preset.value;
    }
    markPressed(notes.groups[parsed.kind].cards, on ? picked : null);
    for (const kind of RUN_KINDS) {
      const row = notes.degrees[kind];
      row.box.hidden = kind !== parsed.kind || picked !== CUSTOM;
      if (kind === parsed.kind) markPressed(row.buttons, (value) => parsed.degrees.includes(Number(value)));
      // Custom's card draws the set it holds (redrawn only when that changes).
      const card = notes.groups[kind].cards.find((c) => c.getAttribute(VALUE_ATTR) === CUSTOM);
      const held = (kind === parsed.kind && picked === CUSTOM ? parsed.degrees : custom[kind]).join("");
      if (card.dataset.held !== held) {
        card.dataset.held = held;
        card.firstChild.replaceWith(noteSetSvg(degreeItems(held.split("").map(Number)), { stacked: kind === "arpeggios" }));
      }
    }
  };

  const draw = () => {
    const on = ctx.state.practice !== "off";
    const parsed = parsedNow();
    toggle.setAttribute("aria-pressed", on ? "true" : "false");
    toggle.classList.toggle("is-on", on);
    drawSummary();
    markPressed(ui.kinds, on ? parsed.kind : null);
    drawNotes(parsed, on);
    const shaped = exerciseTakesShape(parsed);
    markPressed(ui.shapes, on && shaped ? parsed.variant : null);
    ui.shapeStep.hidden = !shaped;
    ui.rhythmNum.textContent = shaped ? "4" : "3";
    const ticked = tickedRhythms(ctx.state.practiceRhythms, current());
    markPressed(ui.patterns, (value) => ticked.includes(value));
  };
  draw();
  ctx.store.subscribe("settings", draw);

  toggle.addEventListener("click", () => {
    if (ctx.state.practice === "off") {
      ctx.store.set("settings", { practice: lastExercise }, BACKGROUND);
    } else {
      lastExercise = ctx.state.practice;
      ctx.store.set("settings", { practice: "off" }, BACKGROUND);
    }
  });
  summary.addEventListener("click", () => setOpen(ui.panel.hidden));
  // A click anywhere outside the control and its panel closes the panel. A
  // target no longer in the page was inside it: a card's staff redrawn by
  // the very click (Custom's), before the click reached the document.
  document.addEventListener("click", (event) => {
    if (!ui.panel.hidden && event.target.isConnected && !slot.contains(event.target)) setOpen(false);
  });
  ui.done.addEventListener("click", () => {
    setOpen(false);
    summary.focus();
  });
  ui.panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    setOpen(false);
    summary.focus();
  });

  // A kind comes back as it was last left; a run carries the shape over.
  onPick(ui.kinds, (kind) => {
    const now = parsedNow();
    if (kind === now.kind) {
      writeExercise(now);
      return;
    }
    const next = parseExercise(lastOfKind[kind] || kind);
    if (next.degrees !== null) next.variant = lastShape;
    writeExercise(next);
  });
  for (const kind of Object.keys(ui.notes.groups)) {
    onPick(ui.notes.groups[kind].cards, (value) => {
      const now = parsedNow();
      if (kind === "enclosures") {
        writeExercise({ kind, variant: value, degrees: null });
        return;
      }
      customOpen[kind] = value === CUSTOM;
      const degrees = value === CUSTOM ? custom[kind] : PRACTICE_NOTE_SETS[kind].find((set) => set.value === value).degrees;
      writeExercise({ kind, degrees, variant: exerciseTakesShape(now) ? now.variant : lastShape });
    });
  }
  // A degree of Custom's row switched on or off; the last one stays on.
  for (const kind of RUN_KINDS) {
    onPick(ui.notes.degrees[kind].buttons, (value) => {
      const now = parsedNow();
      const d = Number(value);
      const degrees = now.degrees.includes(d)
        ? now.degrees.filter((x) => x !== d)
        : PRACTICE_DEGREES[kind].filter((x) => x === d || now.degrees.includes(x));
      if (degrees.length === 0) return;
      custom[kind] = degrees;
      writeExercise({ kind, degrees, variant: exerciseTakesShape(now) ? now.variant : lastShape });
    });
  }
  onPick(ui.shapes, (shape) => {
    writeExercise({ ...parsedNow(), variant: shape });
  });
  // Tick or untick a rhythm, never leaving none ticked.
  onPick(ui.patterns, (pattern) => {
    const ticked = tickedRhythms(ctx.state.practiceRhythms, current());
    if (!ticked.includes(pattern)) {
      write({ practiceRhythms: [...ticked, pattern] });
    } else if (ticked.length > 1) {
      write({ practiceRhythms: ticked.filter((value) => value !== pattern) });
    }
  });
}
