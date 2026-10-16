import { byId, clear, el } from "../../lib/core/dom.js";
import {
  joinExercise, practiceSummary, practiceSummaryParts, PRACTICE_KINDS, PRACTICE_RHYTHM_MIXES, PRACTICE_RHYTHMS, PRACTICE_SHAPES,
  splitExercise,
} from "../../lib/music/practice.js";
import { tl } from "../../lib/core/i18n.js";
import { BACKGROUND } from "../core/state.js";

/*
  The practice routine (#practiceSlot, in the More-controls drawer): a view
  of the settings slice's `practice` (an exercise value, or "off") and
  `practiceRhythm`. Closed it's one control — an on/off switch and a summary
  button ("PRACTICE  Scale runs, Up & down · Syncopated rhythm"); the summary
  opens #practicePanel inline below it, three numbered steps read top to
  bottom: 1 what to play (PRACTICE_KINDS), 2 the run's shape (only for a
  run kind), 3 rhythm (One pattern / Syncopated / Varied, the first opening a
  grid of PRACTICE_RHYTHMS drawn as eight eighth-note cells), then a one-bar
  preview and Done. Any pick also switches practice on; the switch
  remembers the exercise it last turned off. sheet.js appends the exercise
  as one more staff.
*/

const SVG_NS = "http://www.w3.org/2000/svg";
const FIXED = "fixed";
const VALUE_ATTR = "data-value";
// Shown in the preview for the two cycling mixes: one of their own patterns.
const MIX_PREVIEW = { varied: "tied", syncopated: "pushes" };
const DEFAULT_EXERCISE = "scales-updown";
const DEFAULT_PATTERN = "charleston";

const isPattern = (value) => PRACTICE_RHYTHMS.some((r) => r.value === value);
const cellOf = (value) => PRACTICE_RHYTHMS.find((r) => r.value === value).cell;

// One bar as eight cells: a note, its hold, or a rest; a tie over the bar line marks the last.
function cellStrip(cell) {
  const strip = el("span", { class: "practice-cells", attrs: { "aria-hidden": "true" } });
  const body = cell.slice(0, 8);
  [...body].forEach((mark, i) => {
    let kind = "rest";
    if (mark === "x") kind = body[i + 1] === "-" ? "note is-held" : "note";
    else if (mark === "-") kind = "hold";
    if (i === 7 && cell.endsWith(">")) kind += " is-tied";
    strip.append(el("span", { class: `practice-cell practice-cell--${kind}` }));
  });
  return strip;
}

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

function markPressed(buttons, value) {
  for (const button of buttons) {
    const on = button.getAttribute(VALUE_ATTR) === value;
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

function buildPanel() {
  const kinds = PRACTICE_KINDS.map((kind) => choice("practice-kind", kind.value, [
    el("span", { class: "practice-choice-label", text: kind.label }),
    el("span", { class: "practice-choice-hint", text: kind.hint }),
  ]));
  const shapes = PRACTICE_SHAPES.map((shape) => choice("practice-shape", shape.value, [
    contour(shape.points),
    el("span", { class: "practice-choice-label", text: shape.label }),
  ]));
  // One pattern first, then the mixes the other way round: One pattern / Syncopated / Varied.
  const mixes = [{ value: FIXED, label: tl("practice_mix_fixed", "One pattern") },
    ...PRACTICE_RHYTHM_MIXES.map((mix) => ({ value: mix.value, label: mix.choice })).reverse()]
    .map((mix) => choice("practice-mix", mix.value, [el("span", { class: "practice-choice-label", text: mix.label })]));
  const patterns = PRACTICE_RHYTHMS.map((rhythm) => choice("practice-pattern", rhythm.value, [
    cellStrip(rhythm.cell),
    el("span", { class: "practice-choice-label", text: rhythm.label }),
  ]));
  const shapeStep = el("div", { class: "practice-step", id: "practiceShapeStep" }, [
    stepTitle("2", tl("practice_step_shape", "Run shape")),
    el("div", { class: "practice-choices practice-choices--shapes" }, shapes),
  ]);
  const rhythmNum = el("span", { class: "practice-step-num", text: "3" });
  const patternGrid = el("div", { class: "practice-choices practice-choices--patterns", id: "practicePatterns" }, patterns);
  const preview = el("span", { class: "practice-preview" });
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
      el("div", { class: "practice-step-title" }, [rhythmNum, el("span", { text: tl("practice_step_rhythm", "Rhythm") })]),
      el("div", { class: "practice-choices practice-choices--mixes" }, mixes),
      patternGrid,
    ]),
    el("div", { class: "practice-foot" }, [
      el("div", { class: "practice-foot-text" }, [preview]),
      done,
    ]),
  ]);
  panel.hidden = true;
  return { panel, kinds, shapes, mixes, patterns, shapeStep, rhythmNum, patternGrid, preview, done };
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
  let lastPattern = isPattern(ctx.state.practiceRhythm) ? ctx.state.practiceRhythm : DEFAULT_PATTERN;
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
    const rhythm = ctx.state.practiceRhythm;
    const { kind, runs } = splitExercise(current());
    const runKind = PRACTICE_KINDS.some((k) => k.value === kind && k.runs);
    const fixed = isPattern(rhythm);
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
    markPressed(ui.mixes, fixed ? FIXED : rhythm);
    markPressed(ui.patterns, rhythm);
    ui.shapeStep.hidden = !runKind;
    ui.rhythmNum.textContent = runKind ? "3" : "2";
    ui.patternGrid.hidden = !fixed;
    ui.preview.textContent = "";
    ui.preview.append(cellStrip(cellOf(fixed ? rhythm : MIX_PREVIEW[rhythm] || DEFAULT_PATTERN)));
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
  onPick(ui.mixes, (mix) => write({ practiceRhythm: mix === FIXED ? lastPattern : mix }));
  onPick(ui.patterns, (pattern) => {
    lastPattern = pattern;
    write({ practiceRhythm: pattern });
  });
}
