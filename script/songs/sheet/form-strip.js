import { el, qsa } from "../../lib/core/dom.js";
import { parseFormStep } from "../../lib/music/words-table.js";
import { tl } from "../../lib/core/i18n.js";

/*
  The form strip under the chord table: one arrow per round of a song's form
  table (`W:| a | b |` lines, lib/music/words-table.js), with what plays
  underlined beneath it. sheet.js draws the band's form here for every sheet
  and booklet song; the form editor (song-form.js) redraws it on the live
  sheet with the visitor's own version, marking the rounds that differ.
*/

// Shade of the `index`th of `count` kinds of step in the form strip: very light grey to light grey (dark text on top, to save ink).
function stepShade(index, count) {
  const level = Math.round(225 - (count > 1 ? (index / (count - 1)) * 60 : 0));
  return `rgb(${level}, ${level}, ${level})`;
}

// A step's share of the strip's width: what its arrow needs for the number, part box and repeat
// note, plus a bonus growing with its text length.
function stepWeight(step) {
  const text = [step.lead, ...step.adds, ...step.notes].join(" ");
  const arrow = step.number.length + step.part.length + step.repeat.length + 8;
  // Square root: a long text earns more room, but not so much that its neighbours get squeezed.
  return arrow + 4 * Math.sqrt(text.length);
}

// A gold dot in the arrow of a round that differs from the band's form.
function changedMark() {
  return el("span", { class: "songForm-changed", attrs: { title: tl("form_changed", "Changed from the band's form") } }, [
    el("span", { class: "rj-sr-only", text: tl("form_changed", "Changed from the band's form") }),
  ]);
}

// One step of the form strip: an arrow with the step number and part box,
// and below it what plays (underlined), who joins (+), and any asides.
function formStep(step, shade, changed) {
  const arrow = el("div", { class: "songForm-arrow", style: { backgroundColor: shade } }, [
    el("span", { class: "songForm-num", text: step.number }),
    ...step.part.split(" ").filter(Boolean).map((name) => el("span", { class: name === "..." ? "songForm-part songForm-part--more" : "songForm-part", text: name })),
    step.repeat ? el("span", { class: "songForm-repeat", text: step.repeat }) : null,
    changed ? changedMark() : null,
  ]);
  return el("li", { class: "songForm-step", style: { flex: `${stepWeight(step)} 1 0` } }, [
    arrow,
    step.lead ? el("div", { class: "songForm-lead", text: step.lead }) : null,
    ...step.adds.map((add) => el("div", { class: "songForm-add", text: `+ ${add}` })),
    step.notes.length > 0 ? el("div", { class: "songForm-note", text: step.notes.join(" · ") }) : null,
  ]);
}

// Arrow colour per step: the same part (every A, every Intro) always gets the same shade, so a
// repeated part reads at a glance. Steps without a part each count as their own kind.
function stepShades(steps) {
  const kinds = [];
  const kindOf = steps.map((step, i) => {
    const key = step.part || `#${i}`;
    if (!kinds.includes(key)) kinds.push(key);
    return kinds.indexOf(key);
  });
  return kindOf.map((kind) => stepShade(kind, kinds.length));
}

/*
  One strip for a table's rows. `changed[i]` marks round i as differing from
  the band's form; `mine` frames the whole strip as the visitor's version.
*/
export function buildFormStrip(rows, { changed = [], mine = false } = {}) {
  const steps = rows.map(parseFormStep);
  const shades = stepShades(steps);
  return el("ol", { class: mine ? "songForm songForm--mine" : "songForm" },
    steps.map((step, i) => formStep(step, shades[i], Boolean(changed[i]))));
}

// Draw the tables written as `W:| a | b |` lines as a strip of arrows, one per form step, just below
// the chord table, replacing whatever an earlier render of this sheet left there.
export function renderWordsTables(chordEl, tables) {
  qsa(".songForm", chordEl.parentNode).forEach((old) => old.remove());
  let anchor = chordEl;
  tables.forEach((source) => {
    const form = buildFormStrip(source.rows);
    anchor.after(form);
    anchor = form;
  });
}
