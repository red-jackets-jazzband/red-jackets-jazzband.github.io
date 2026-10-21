import { byId, el, qsa } from "../../lib/core/dom.js";
import { readPref, removePref, songFormPrefKey, writePref } from "../../lib/core/preferences.js";
import { tl } from "../../lib/core/i18n.js";
import {
  MORE, addPart, addRound, cloneRounds, deleteRound, duplicateRound, formText, movePart,
  moveRound, partChoices, readStoredForm, removePart, removeRepeat, roundsFromTables,
  roundsToRows, sameForm, sameRound, setText, writeStoredForm,
} from "../../lib/music/song-form.js";
import { buildFormStrip, renderWordsTables } from "./form-strip.js";
import { fitSongForms } from "./chord-table.js";
import { createFormDrag } from "./form-drag.js";
import { afterPageLoad } from "../core/after-load.js";

/*
  A visitor's own version of a song's form, next to the band's.

  The band's form is the strip sheet.js draws under the chord table from the
  tune's `W:|` table (published as `tune.formTables`). Under it sits a small
  pencil; it opens an editor below the strip: one card per round, with its
  part chips (tap to remove, drag to reorder or into another round), buttons
  to add a part or "..." (as long as it takes), what plays and a note. The
  strip follows every edit. Save keeps the version in this browser only
  (rj.songForm.<file>, lib/music/song-form.js's stored shape); a version that
  matches the band's exactly isn't kept. Once there is one, a two-icon switch
  beside the pencil flips between the band's form and it, and while it shows
  the strip is framed in gold with a dot on every round that differs. The
  editor can hand the form over as the W: lines a song's .abc file carries,
  for the band's own scores.

  Its state is per song and lives here, not in a store slice: which version
  shows is stored with the version itself, and the editor closes whenever
  another song opens. It redraws after every live render (a `tune` publish),
  since the render draws the band's strip afresh, but draws nothing at all
  until the page has loaded and gone idle (init): on a deep link the sheet
  and the band's form come first, the pencil and a version of your own after.
*/

// Who usually plays a round, offered as the "Who plays" field's suggestions
// (with whatever the band's form already says). Written as the band's .abc
// files write them.
const LEAD_SUGGESTIONS = [
  "Collective", "Vocals", "Clarinet solo", "Trumpet solo", "Trombone solo",
  "Banjo solo", "Sousaphone solo", "Drum solo",
];
const DATALIST_ID = "songFormWho";
const ICON_BTN = "songForm-icon-btn";
// How long the menu square stays once the pointer leaves the form: enough to
// cross the few pixels between the strip and the square.
const REVEAL_GRACE_MS = 400;

function icon(name) {
  return el("span", { class: `fa-solid ${name}`, attrs: { "aria-hidden": "true" } });
}

// An icon-only button; `focus` names it for focus to come back to after a redraw.
function iconButton(cls, iconName, label, onClick, focus) {
  return el("button", {
    type: "button",
    class: cls,
    attrs: { "aria-label": label, title: label, "data-focus": focus },
    on: { click: onClick },
  }, [icon(iconName)]);
}

function partLabel(name) {
  return name === MORE ? "…" : name;
}

// Put the focus back on the control a redraw replaced, when it's still there.
function refocus(container, key) {
  if (!key || !container) return;
  const target = container.querySelector(`[data-focus="${key}"]`);
  if (target) target.focus();
}

// Copy `text` from `textarea`: the Clipboard API where there is one (Safari 13.1+),
// else the old select-and-copy.
function copyText(textarea, text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  textarea.select();
  // No Clipboard API on the old browsers this fallback is for.
  document.execCommand("copy"); // NOSONAR
  return Promise.resolve();
}

// Copy `text` with no field of its own on the page: a throwaway one for the
// select-and-copy fallback.
function copyPlain(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  const area = el("textarea", { value: text, readOnly: true, class: "rj-sr-only" });
  document.body.append(area);
  try {
    return copyText(area, text);
  } finally {
    area.remove();
  }
}

// Enter in a field goes on to the next one: Who plays, Note, the next round's Who plays.
function nextField(e, input) {
  e.preventDefault();
  const fields = qsa(".songForm-field", input.closest(".songForm-editor"));
  const next = fields[fields.indexOf(input) + 1];
  if (next) next.focus();
}

// One item of the song form menu; `checked` (true/false) makes it a radio item.
function menuItem(key, iconName, label, onPick, checked) {
  const radio = checked !== undefined;
  return el("button", {
    type: "button",
    class: "songForm-menu-item",
    attrs: {
      role: radio ? "menuitemradio" : "menuitem",
      "aria-checked": radio ? String(checked) : null,
      tabindex: "-1",
      "data-focus": `menu-${key}`,
    },
    on: { click: onPick },
  }, [
    icon(iconName),
    el("span", { class: "songForm-menu-label", text: label }),
    checked ? icon("fa-check") : null,
  ]);
}

const TOOLS = ".songForm-tools";

// Whether `target` is where hovering or tapping shows the menu square: the
// form strip, or the chord grid when the tune has no form to hang it beside.
function inRevealArea(target) {
  if (target.closest(".songForm")) return true;
  return Boolean(target.closest("#chordtable")) && Boolean(document.querySelector(".songForm-tools--alone"));
}

export function createSongForm(ctx) {
  let file = null;
  let band = [];
  let choices = [];
  let mine = null; // the visitor's rounds, or null
  let show = "band"; // which one the strip shows when not editing
  let draft = null; // the rounds being edited, or null
  let textOpen = false;
  let menuOpen = false;
  // The menu square shows only while the form is hovered, tapped or focused.
  let revealed = false;
  let hideTimer = null;
  // Nothing is drawn until the page has loaded (init): the sheet comes first.
  let ready = false;

  const drag = createFormDrag({ onDrop: dropped });

  const editing = () => draft !== null;
  const showingMine = () => show === "mine" && mine !== null;

  function shownRounds() {
    if (editing()) return draft;
    return showingMine() ? mine : band;
  }

  function load(songFile) {
    file = songFile;
    const stored = songFile ? readStoredForm(readPref(songFormPrefKey(songFile))) : null;
    mine = stored ? stored.rounds : null;
    show = stored ? stored.show : "band";
    draft = null;
    textOpen = false;
    menuOpen = false;
  }

  function persist() {
    if (!file) return;
    if (mine === null) removePref(songFormPrefKey(file));
    else writePref(songFormPrefKey(file), writeStoredForm(mine, show));
  }

  // ---- the strip -----------------------------------------------------------

  function mineStrip(rounds) {
    return buildFormStrip(roundsToRows(rounds), {
      changed: rounds.map((round, i) => !sameRound(round, band[i])),
      mine: true,
    });
  }

  // The band's strip(s) as the render drew them, or the visitor's version in
  // their place; returns the last one (or the chord table when there's none).
  function drawStrip(chordEl) {
    const parent = chordEl.parentNode;
    if (!editing() && !showingMine()) {
      renderWordsTables(chordEl, ctx.state.formTables);
    } else {
      qsa(".songForm", parent).forEach((old) => old.remove());
      if (shownRounds().length > 0) chordEl.after(mineStrip(shownRounds()));
    }
    const strips = qsa(".songForm", parent);
    return strips.length > 0 ? strips[strips.length - 1] : chordEl;
  }

  // Redraw only the strip, while typing in the editor (rebuilding the editor
  // would take the focus out of the field).
  function redrawStrip() {
    const chordEl = byId("chordtable");
    if (!chordEl || !chordEl.parentNode) return;
    drawStrip(chordEl);
    fitSongForms(chordEl);
  }

  // ---- the switch and the pencil -------------------------------------------

  /*
    One small square at the strip's end, drawn like the strip's own part
    boxes, with a ≡ in it (not "…": a dashed "…" box in the strip already
    means "as long as it takes"). It opens a menu: the band's form or mine
    (once there is one), edit, and copy as text. Gold while your version
    shows.
  */
  function menuButton() {
    return el("button", {
      type: "button",
      class: showingMine() ? "songForm-menu-btn is-mine" : "songForm-menu-btn",
      attrs: {
        "aria-label": tl("form_menu", "Song form options"),
        title: tl("form_menu", "Song form options"),
        "aria-haspopup": "menu",
        "aria-expanded": String(menuOpen),
        "data-focus": "menu",
      },
      on: { click: () => setMenuOpen(!menuOpen, "menu-first") },
    }, [el("span", { class: "songForm-menu-box", attrs: { "aria-hidden": "true" } }, [icon("fa-bars")])]);
  }

  function menu() {
    const items = [];
    if (mine) {
      items.push(
        menuItem("band", "fa-users", tl("form_band", "The band's form"), () => setShow("band"), !showingMine()),
        menuItem("mine", "fa-user", tl("form_mine", "My version"), () => setShow("mine"), showingMine()),
        el("div", { class: "songForm-menu-sep", attrs: { role: "separator" } }),
      );
    }
    items.push(
      menuItem("edit", "fa-pen", mine ? tl("form_edit_mine", "Edit my version") : tl("form_edit_new", "Make my own version"), () => {
        menuOpen = false;
        startEdit();
      }),
      menuItem("copy", "fa-file-lines", tl("form_copy_text", "Copy as text"), copyFromMenu),
    );
    return el("div", {
      class: "songForm-menu",
      attrs: { role: "menu", "aria-label": tl("form_menu", "Song form options") },
      on: { keydown: menuKey },
    }, items);
  }

  // Hung outside the strip's left edge, level with its first arrow, the way
  // the chord grid's part markers hang outside its rows; on its own line when
  // the tune has no form to hang beside.
  function tools(hasStrip) {
    let cls = hasStrip ? "songForm-tools" : "songForm-tools songForm-tools--alone";
    if (revealed || menuOpen) cls += " is-revealed";
    return el("div", { class: cls }, [
      menuButton(),
      menuOpen ? menu() : null,
    ]);
  }

  // ↑ / ↓ (and Home / End) walk the menu, Escape or Tab closes it.
  function menuKey(e) {
    const items = qsa(".songForm-menu-item", e.currentTarget);
    const at = items.indexOf(document.activeElement);
    let to = null;
    if (e.key === "ArrowDown") to = (at + 1) % items.length;
    else if (e.key === "ArrowUp") to = (at - 1 + items.length) % items.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = items.length - 1;
    if (to !== null) {
      e.preventDefault();
      e.stopPropagation();
      items[to].focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setMenuOpen(false, "menu");
    } else if (e.key === "Tab") {
      setMenuOpen(false);
    }
  }

  function setMenuOpen(open, focus) {
    if (menuOpen === open) return;
    menuOpen = open;
    draw(focus);
  }

  // Copy the form on show as the W: lines, and say so on the item itself.
  function copyFromMenu(e) {
    const item = e.currentTarget;
    copyPlain(formText(shownRounds())).then(() => {
      const labelEl = item.querySelector(".songForm-menu-label");
      if (labelEl) labelEl.textContent = tl("form_copied", "Copied ✓");
    }, () => {});
  }

  // ---- the editor ----------------------------------------------------------

  function edit(next, focus) {
    draft = next;
    draw(focus);
  }

  function chip(round, i, name, j) {
    const label = name === MORE
      ? tl("form_remove_more", "Stop repeating round {n} as long as it takes", { n: i + 1 })
      : tl("form_remove_part", "Remove part {part} from round {n}", { part: name, n: i + 1 });
    const node = el("button", {
      type: "button",
      class: name === MORE ? "songForm-chip songForm-chip--more" : "songForm-chip",
      dataset: { part: String(j) },
      attrs: {
        "aria-label": label,
        title: name === MORE ? tl("form_more", "Repeat as long as it takes") : label,
        "aria-keyshortcuts": "Alt+ArrowLeft Alt+ArrowRight Delete",
        "data-focus": `part-${i}-${j}`,
      },
      on: {
        click: () => {
          if (!drag.clickWasDrag()) edit(removePart(draft, i, j), `card-${i}`);
        },
        keydown: (e) => chipKey(e, i, j),
      },
    }, [partLabel(name), el("span", { class: "songForm-chip-x", attrs: { "aria-hidden": "true" }, text: "×" })]);
    drag.bind(node, () => node, { kind: "part", round: i, part: j });
    return node;
  }

  // ← / → (with or without Alt) move a focused chip within its round; Delete removes it.
  function chipKey(e, i, j) {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    const parts = draft[i].parts;
    let to = null;
    if (e.key === "ArrowLeft") to = j - 1;
    else if (e.key === "ArrowRight") to = j + 1;
    if (to !== null) {
      e.preventDefault();
      if (to < 0 || to >= parts.length) return;
      const next = movePart(draft, { round: i, part: j }, i, to);
      // A "..." stays last, so a move onto or off it changes nothing.
      const moved = next[i].parts.join(" ") !== parts.join(" ");
      edit(next, `part-${i}-${moved ? to : j}`);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      edit(removePart(draft, i, j), `card-${i}`);
    }
  }

  function addButton(i, name) {
    const label = name === MORE
      ? tl("form_add_more", "Repeat round {n} as long as it takes", { n: i + 1 })
      : tl("form_add_part", "Add part {part} to round {n}", { part: name, n: i + 1 });
    return el("button", {
      type: "button",
      class: "songForm-add-part",
      attrs: { "aria-label": label, title: label, "data-focus": `add-${i}-${name}` },
      // "+ …" goes once the round has its "…", so the focus goes to the round.
      on: { click: () => edit(addPart(draft, i, name), name === MORE ? `card-${i}` : `add-${i}-${name}`) },
    }, `+ ${partLabel(name)}`);
  }

  function textField(round, i, field) {
    const isLead = field === "lead";
    const input = el("input", {
      type: "text",
      class: isLead ? "songForm-field songForm-field--lead" : "songForm-field",
      value: round[field],
      placeholder: isLead ? tl("form_who", "Who plays") : tl("form_note", "Note"),
      attrs: {
        "aria-label": isLead
          ? tl("form_who_round", "Who plays in round {n}", { n: i + 1 })
          : tl("form_note_round", "Note for round {n}", { n: i + 1 }),
        list: isLead ? DATALIST_ID : null,
        "data-focus": `${field}-${i}`,
      },
      on: {
        input: () => {
          draft = setText(draft, i, field, input.value);
          redrawStrip();
        },
        keydown: (e) => {
          if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) nextField(e, input);
        },
      },
    });
    return input;
  }

  /*
    A round, laid out on one grid so every control lines up with the rest:
    a handle column (grip and number), a field column (the parts, as one
    tag field holding its chips and add buttons, over "Who plays" and
    "Note"), and the round's own actions, all the fields' height.
  */
  function card(round, i) {
    const n = i + 1;
    const gripLabel = tl("form_drag_round", "Drag to move round {n}", { n });
    const grip = el("button", {
      type: "button",
      class: "songForm-grip",
      attrs: {
        "aria-label": gripLabel,
        title: gripLabel,
        "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown Delete",
        "data-focus": `grip-${i}`,
      },
      on: { keydown: (e) => gripKey(e, i) },
    }, [icon("fa-grip-vertical")]);
    const adds = choices.map((name) => addButton(i, name));
    if (!round.parts.includes(MORE)) adds.push(addButton(i, MORE));
    const repeat = round.repeat ? el("button", {
      type: "button",
      class: "songForm-chip songForm-chip--repeat",
      attrs: { "aria-label": tl("form_remove_repeat", "Remove {repeat} from round {n}", { repeat: round.repeat, n }) },
      on: { click: () => edit(removeRepeat(draft, i), `card-${i}`) },
    }, [round.repeat, el("span", { class: "songForm-chip-x", attrs: { "aria-hidden": "true" }, text: "×" })]) : null;
    const cardNode = el("div", {
      class: sameRound(round, band[i]) ? "songForm-card" : "songForm-card is-changed",
      dataset: { round: String(i) },
      attrs: { tabindex: "-1", "data-focus": `card-${i}` },
    }, [
      el("div", { class: "songForm-card-handle" }, [
        grip,
        el("span", { class: "songForm-card-num", text: String(n) }),
      ]),
      el("div", { class: "songForm-parts", attrs: { role: "group", "aria-label": tl("form_parts_round", "Parts of round {n}", { n }) } }, [
        ...round.parts.map((name, j) => chip(round, i, name, j)),
        repeat,
        el("span", { class: "songForm-parts-adds" }, adds),
      ]),
      el("div", { class: "songForm-card-actions" }, [
        iconButton(ICON_BTN, "fa-copy", tl("form_duplicate", "Duplicate round {n}", { n }), () => edit(duplicateRound(draft, i), `grip-${i + 1}`), `dup-${i}`),
        iconButton(`${ICON_BTN} songForm-icon-btn--danger`, "fa-trash-can", tl("form_delete", "Delete round {n}", { n }), () => edit(deleteRound(draft, i), afterDelete(i)), `del-${i}`),
      ]),
      el("div", { class: "songForm-card-fields" }, [textField(round, i, "lead"), textField(round, i, "note")]),
    ]);
    drag.bind(grip, () => cardNode, { kind: "round", round: i }, { grab: true });
    return cardNode;
  }

  // Where the focus goes once round `i` is deleted: the grip now in its place.
  function afterDelete(i) {
    if (draft.length > 1) return `grip-${Math.min(i, draft.length - 2)}`;
    return "addRound";
  }

  // On the grip, as on a setlist row's handle: ↑ / ↓ move the round, Delete removes it.
  function gripKey(e, i) {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      edit(deleteRound(draft, i), afterDelete(i));
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") moveRoundBy(e, i, e.key === "ArrowDown" ? 1 : -1);
  }

  // Move round `i` one place up or down, keeping the focus on the control the
  // key was pressed in, now in the round's new place ("lead-2" -> "lead-3").
  function moveRoundBy(e, i, step) {
    e.preventDefault();
    const to = i + step;
    if (to < 0 || to >= draft.length) return;
    const key = e.target.getAttribute("data-focus") || `grip-${i}`;
    const dash = key.indexOf("-");
    const rest = key.slice(dash + 1);
    const after = rest.indexOf("-");
    edit(moveRound(draft, i, to), `${key.slice(0, dash)}-${to}${after < 0 ? "" : rest.slice(after)}`);
  }

  /*
    The editor's own keys, the setlist editor's: Ctrl/Cmd+Enter saves, Escape
    cancels (or closes the text first), Alt+↑ / ↓ moves the round the focus is
    in. ↑ / ↓ never reach the page's own handlers from in here: in an open
    setlist they'd step to the next song and drop the edit.
  */
  function editorKey(e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (textOpen) setTextOpen(false);
      else cancel();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.stopPropagation();
      const cardEl = e.target.closest(".songForm-card");
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && cardEl) {
        moveRoundBy(e, Number(cardEl.dataset.round), e.key === "ArrowDown" ? 1 : -1);
      }
    }
  }

  function leadSuggestions() {
    const names = [];
    [...band.map((round) => round.lead), ...LEAD_SUGGESTIONS].forEach((name) => {
      if (name && !names.includes(name)) names.push(name);
    });
    return el("datalist", { id: DATALIST_ID }, names.map((name) => el("option", { value: name })));
  }

  function textPanel() {
    const text = formText(draft);
    const area = el("textarea", {
      class: "songForm-text-area",
      readOnly: true,
      rows: Math.max(2, draft.length),
      value: text,
      attrs: { "aria-label": tl("form_text", "Song form as text"), "data-focus": "text", spellcheck: "false" },
    });
    const copyBtn = el("button", { type: "button", class: "songForm-btn songForm-btn--primary" }, tl("form_copy", "Copy"));
    copyBtn.addEventListener("click", () => {
      copyText(area, text).then(() => {
        copyBtn.textContent = tl("form_copied", "Copied ✓");
      }, () => area.select());
    });
    return el("div", { class: "songForm-text" }, [
      area,
      el("div", { class: "songForm-text-actions" }, [
        el("button", {
          type: "button",
          class: "songForm-btn",
          on: { click: () => setTextOpen(false) },
        }, tl("form_close", "Close")),
        copyBtn,
      ]),
    ]);
  }

  function editor() {
    return el("section", {
      class: "songForm-editor",
      attrs: { "aria-label": tl("form_editor", "Edit your song form") },
      on: { keydown: editorKey },
    }, [
      leadSuggestions(),
      ...draft.map((round, i) => card(round, i)),
      el("button", {
        type: "button",
        class: "songForm-add-round",
        attrs: { "data-focus": "addRound" },
        on: { click: () => edit(addRound(draft, choices), `lead-${draft.length}`) },
      }, [icon("fa-plus"), ` ${tl("form_add_round", "Add a round")}`]),
      el("div", { class: "songForm-footer" }, [
        iconButton(ICON_BTN, "fa-rotate-left", tl("form_restart", "Back to the band's form"), () => edit(cloneRounds(band), "restart"), "restart"),
        iconButton(ICON_BTN, "fa-file-lines", tl("form_copy_text", "Copy as text"), () => setTextOpen(!textOpen), "copyText"),
        el("span", { class: "songForm-footer-gap" }),
        el("button", {
          type: "button",
          class: "songForm-btn",
          attrs: { title: tl("form_cancel_hint", "Cancel (Esc)"), "aria-keyshortcuts": "Escape" },
          on: { click: cancel },
        }, tl("form_cancel", "Cancel")),
        el("button", {
          type: "button",
          class: "songForm-btn songForm-btn--primary",
          attrs: { title: tl("form_save_hint", "Save (Ctrl+Enter)"), "aria-keyshortcuts": "Control+Enter Meta+Enter" },
          on: { click: save },
        }, tl("form_save", "Save")),
      ]),
      textOpen ? textPanel() : null,
    ]);
  }

  // ---- drawing -------------------------------------------------------------

  // Everything under the chord table: the menu button (and its menu) at the
  // strip's start, the strip, and the editor below it while editing. `focus` names the control to focus
  // after ("menu-first": the menu's first item).
  function draw(focus) {
    const chordEl = byId("chordtable");
    if (!chordEl || !chordEl.parentNode || ctx.state.currentSongText === undefined) return;
    const parent = chordEl.parentNode;
    qsa(".songForm-tools, .songForm-editor", parent).forEach((old) => old.remove());
    const last = drawStrip(chordEl);
    if (editing()) last.after(editor());
    else chordEl.after(tools(last !== chordEl));
    fitSongForms(chordEl);
    const first = focus === "menu-first" ? parent.querySelector(".songForm-menu-item") : null;
    if (first) first.focus();
    else refocus(parent, focus);
  }

  // A click anywhere outside the open menu (and its button) closes it. A
  // click inside may already have redrawn it, leaving its target detached.
  function closeMenuOnOutsideClick(e) {
    if (!e.target.isConnected || e.target.closest(TOOLS)) return;
    // A tap on the form shows the square (a touch screen has no hover).
    if (inRevealArea(e.target)) {
      setRevealed(true);
      if (menuOpen) setMenuOpen(false);
      return;
    }
    setRevealed(false);
    if (menuOpen) setMenuOpen(false);
  }

  /*
    The square is hidden until wanted: hovering or tapping the form strip
    (the chord grid, for a tune with no form), or the keyboard focus reaching
    it, shows it; it stays while its menu is open. Leaving it waits a moment,
    so the pointer can cross the gap from the strip to the square.
  */
  function setRevealed(on) {
    clearTimeout(hideTimer);
    revealed = on;
    const toolsEl = document.querySelector(TOOLS);
    if (toolsEl) toolsEl.classList.toggle("is-revealed", on || menuOpen);
  }

  function hideSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const toolsEl = document.querySelector(TOOLS);
      if (!menuOpen && !(toolsEl && toolsEl.contains(document.activeElement))) setRevealed(false);
    }, REVEAL_GRACE_MS);
  }

  function onPointerOver(e) {
    if (e.target.closest(TOOLS) || inRevealArea(e.target)) setRevealed(true);
  }

  function onPointerOut(e) {
    const to = e.relatedTarget;
    if (to && (to.closest(TOOLS) || inRevealArea(to))) return;
    if (e.target.closest(TOOLS) || inRevealArea(e.target)) hideSoon();
  }

  function onFocusIn(e) {
    if (e.target.closest(TOOLS)) setRevealed(true);
  }

  function onFocusOut(e) {
    if (e.target.closest(TOOLS)) hideSoon();
  }

  // ---- actions -------------------------------------------------------------

  function setShow(which) {
    show = which;
    menuOpen = false;
    persist();
    draw("menu");
  }

  function startEdit() {
    let start = cloneRounds(mine || band);
    if (start.length === 0) start = addRound([], choices);
    textOpen = false;
    // The card, not its text field: on a phone a field would pop the keyboard up.
    edit(start, "card-0");
  }

  function cancel() {
    draft = null;
    textOpen = false;
    draw("menu");
  }

  function save() {
    if (sameForm(draft, band)) {
      mine = null;
      show = "band";
    } else {
      mine = cloneRounds(draft);
      show = "mine";
    }
    persist();
    cancel();
  }

  function setTextOpen(open) {
    textOpen = open;
    draw(open ? "text" : "copyText");
  }

  function dropped(source, target) {
    if (source.kind === "round") {
      edit(moveRound(draft, source.round, target.round), `card-${target.round}`);
    } else {
      edit(movePart(draft, source, target.round, target.part), `card-${target.round}`);
    }
  }

  // A live render drew the band's strip afresh: draw over it, and pick up the
  // song's own version when another song opened.
  ctx.store.subscribe("tune", (tune) => {
    const songFile = ctx.state.currentSongFile;
    if (songFile !== file) load(songFile);
    band = roundsFromTables(tune.formTables);
    choices = partChoices(tune.currentSongText, band);
    if (ready) draw();
  });

  return {
    // The menu button, and a version of your own, only once the page has loaded and
    // the browser is idle: the sheet and its band's form come first.
    init() {
      document.addEventListener("click", closeMenuOnOutsideClick);
      document.addEventListener("mouseover", onPointerOver);
      document.addEventListener("mouseout", onPointerOut);
      document.addEventListener("focusin", onFocusIn);
      document.addEventListener("focusout", onFocusOut);
      return afterPageLoad().then(() => {
        ready = true;
        draw();
      });
    },
    // For the tour and tests: open or close the editor.
    setEditing(open) {
      if (open && !editing()) startEdit();
      if (!open && editing()) cancel();
    },
  };
}
