import { byId, clear, el } from "../../lib/core/dom.js";
import {
  joinExercise, practiceDefaultRhythms, practiceSummary, practiceSummaryParts, PRACTICE_KINDS, PRACTICE_RHYTHMS,
  PRACTICE_SHAPES, splitExercise,
} from "../../lib/music/practice.js";
import { tl } from "../../lib/core/i18n.js";
import { BACKGROUND } from "../core/state.js";
import { rhythmSvg } from "./rhythm-svg.js";

/*
  The practice routine (#practiceSlot, in the More-controls drawer): a view
  of the settings slice's `practice` (an exercise value, or "off") and
  `practiceRhythms`. Closed it's one control — an on/off switch and a summary
  button ("PRACTICE  Scale runs, Up & down · Charleston"); the summary
  opens #practicePanel inline below it, three numbered steps read top to
  bottom: 1 what to play (PRACTICE_KINDS), 2 the run's shape (only for a
  run kind), 3 rhythm (every PRACTICE_RHYTHMS pattern drawn as one bar of
  rhythm notation, with a tick box: one ticked plays all the way, several
  take turns; never none — with none stored yet, the exercise's own set
  shows ticked), then Done. Any pick also switches practice on; the switch
  remembers the exercise it last turned off. sheet.js appends the exercise
  as one more staff.
*/

const SVG_NS = "http://www.w3.org/2000/svg";
const VALUE_ATTR = "data-value";
const DEFAULT_EXERCISE = "scales-updown";

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

function stepTitle(number, text) {
  return el("div", { class: "practice-step-title" }, [
    el("span", { class: "practice-step-num", text: number }),
    el("span", { text }),
  ]);
}

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
function tickedRhythms(rhythms, kind) {
  return rhythms && rhythms.length > 0 ? rhythms : practiceDefaultRhythms(kind);
}

function buildPanel() {
  const kinds = PRACTICE_KINDS.map((kind) => choice("practice-kind", kind.value, [
    el("span", { class: "practice-choice-label", text: kind.label }),
    el("span", { class: "practice-choice-hint", text: kind.hint }),
  ]));
  const shapes = PRACTICE_SHAPES.map((shape) => choice("practice-shape", shape.value, [
    contour(shape.points),
    el("span", { class: "practice-choice-label", text: shape.label }),
  ]));
  const patterns = PRACTICE_RHYTHMS.map((rhythm) => choice("practice-pattern", rhythm.value, [
    rhythmSvg(rhythm.cell),
    el("span", { class: "practice-choice-label", text: rhythm.label }),
  ]));
  const shapeStep = el("div", { class: "practice-step", id: "practiceShapeStep" }, [
    stepTitle("2", tl("practice_step_shape", "Run shape")),
    el("div", { class: "practice-choices practice-choices--shapes" }, shapes),
  ]);
  const rhythmNum = el("span", { class: "practice-step-num", text: "3" });
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
      el("p", { class: "practice-sub", text: tl("practice_sub", "Plays on its own staff under the melody") }),
    ]),
    el("div", { class: "practice-step" }, [
      stepTitle("1", tl("practice_step_what", "What to play")),
      el("div", { class: "practice-choices practice-choices--kinds" }, kinds),
    ]),
    shapeStep,
    el("div", { class: "practice-step" }, [
      el("div", { class: "practice-step-title" }, [rhythmNum, el("span", { id: "practiceRhythmTitle", text: tl("practice_step_rhythm", "Rhythm") })]),
      patternGrid,
    ]),
    el("div", { class: "practice-foot" }, [
      done,
    ]),
  ]);
  panel.hidden = true;
  return { panel, kinds, shapes, patterns, shapeStep, rhythmNum, done };
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

  // What the switch turns back on, and the pattern "One pattern" goes back to.
  const initial = ctx.state.practice;
  let lastExercise = initial === "off" ? DEFAULT_EXERCISE : initial;
  const current = () => (ctx.state.practice === "off" ? lastExercise : ctx.state.practice);
  // Write one or both settings as one change, switching practice on with it.
  const write = (patch) => {
    ctx.store.set("settings", { practice: current(), ...patch }, BACKGROUND);
  };

  const setOpen = (open) => {
    ui.panel.hidden = !open;
    slot.classList.toggle("is-open", open);
    summary.setAttribute("aria-expanded", open ? "true" : "false");
  };

  const draw = () => {
    const on = ctx.state.practice !== "off";
    const rhythm = ctx.state.practiceRhythms;
    const { kind, runs } = splitExercise(current());
    const runKind = PRACTICE_KINDS.some((k) => k.value === kind && k.runs);
    toggle.setAttribute("aria-pressed", on ? "true" : "false");
    toggle.classList.toggle("is-on", on);
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
    markPressed(ui.kinds, on ? kind : null);
    markPressed(ui.shapes, on ? runs : null);
    ui.shapeStep.hidden = !runKind;
    ui.rhythmNum.textContent = runKind ? "3" : "2";
    const ticked = tickedRhythms(rhythm, kind);
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
  // A click anywhere outside the control and its panel closes the panel.
  document.addEventListener("click", (event) => {
    if (!ui.panel.hidden && !slot.contains(event.target)) setOpen(false);
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

  onPick(ui.kinds, (kind) => {
    lastExercise = joinExercise(kind, splitExercise(current()).runs);
    write({ practice: lastExercise });
  });
  onPick(ui.shapes, (shape) => {
    lastExercise = joinExercise(splitExercise(current()).kind, shape);
    write({ practice: lastExercise });
  });
  // Tick or untick a rhythm, never leaving none ticked.
  onPick(ui.patterns, (pattern) => {
    const ticked = tickedRhythms(ctx.state.practiceRhythms, splitExercise(current()).kind);
    if (!ticked.includes(pattern)) {
      write({ practiceRhythms: [...ticked, pattern] });
    } else if (ticked.length > 1) {
      write({ practiceRhythms: ticked.filter((value) => value !== pattern) });
    }
  });
}
