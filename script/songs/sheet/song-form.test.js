import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { makeCtx } from "../../../../tests/helpers/ctx.js";
import { createSongForm } from "./song-form.js";
import { renderWordsTables } from "./form-strip.js";

const FILE = "gotta_woman.abc";
const STORE_KEY = `rj.songForm.${FILE}`;
const CLARINET = "Clarinet solo";
const DELETE_LAST = '[aria-label="Delete round 3"]';
const SONG = "X:1\nT:Woman\nK:C\nP:A\nC4|\nP:B\nD4|]";
const TABLES = [{
  header: null,
  rows: [["1", "A B", "Collective; count-off: 3 tempo ticks"], ["2", "A B A B", "Vocals"], ["3", "A B", CLARINET]],
}];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const click = (node) => node.dispatchEvent(new window.Event("click", { bubbles: true }));
const CARD = ".songForm-card";
const CHIP = ".songForm-chip";
const TYPE = ".songForm-type";
const MORE_TIMES = (round) => $(`[data-focus="more-${round}"]`);
const leads = () => $$(".songForm .songForm-lead").map((node) => node.textContent);
const parts = (round) => $$(CARD)[round].querySelectorAll(CHIP).length;

async function setup({ stored } = {}) {
  const page = mountPage();
  if (stored) localStorage.setItem(STORE_KEY, stored);
  const ctx = makeCtx();
  ctx.songForm = createSongForm(ctx);
  // Nothing is drawn before the page has loaded.
  await ctx.songForm.init();
  // What a live render does: draw the band's strip, then publish the tune.
  const openSong = (file = FILE, tables = TABLES) => {
    ctx.store.set("nav", { currentSongFile: file });
    renderWordsTables(document.getElementById("chordtable"), tables);
    ctx.store.set("tune", { currentSongText: SONG, formTables: tables, songSerial: ctx.state.songSerial + 1 });
  };
  const cleanup = () => {
    localStorage.clear();
    page.cleanup();
  };
  return { ctx, openSong, leads, parts, cleanup };
}

const MENU_BTN = ".songForm-menu-btn";
const MENU = ".songForm-menu";
// Open the song form menu (if it isn't) and return its item `key` (band, mine, edit, copy).
const menuItem = (key) => {
  if (!$(MENU)) click($(MENU_BTN));
  return $(`.songForm-menu [data-focus="menu-${key}"]`);
};
const editButton = () => menuItem("edit");
// Whether the menu offers the band / mine choice (only once there's a version of your own).
const hasChoice = () => Boolean(menuItem("mine"));
const button = (text) => $$(".songForm-editor button").find((node) => node.textContent === text);

test("a song shows the band's strip with only the menu button under it", async () => {
  const { openSong, leads, cleanup } = await setup();
  try {
    openSong();
    assert.deepEqual(leads(), ["Collective", "Vocals", CLARINET]);
    assert.equal($(".songForm--mine"), null);
    assert.equal($(MENU), null);
    assert.equal($(MENU_BTN).getAttribute("aria-expanded"), "false");
    assert.equal(hasChoice(), false);
    assert.equal(editButton().textContent, "Make my own version");
    assert.equal($(MENU_BTN).getAttribute("aria-expanded"), "true");
  } finally {
    cleanup();
  }
});

test("the pencil opens one card per round, and the strip follows every edit", async () => {
  const { openSong, leads, parts, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    assert.equal($$(CARD).length, 3);
    assert.equal(document.activeElement, $(CARD));

    const lead = $$(".songForm-field--lead")[2];
    lead.value = "Banjo solo";
    lead.dispatchEvent(new window.Event("input"));
    assert.deepEqual(leads(), ["Collective", "Vocals", "Banjo solo"]);
    assert.ok($(".songForm--mine"));
    assert.equal($$(".songForm-changed").length, 1);

    click($$(CARD)[0].querySelector('[aria-label="Add part A to round 1"]'));
    assert.equal(parts(0), 3);
    click($$(CARD)[0].querySelector('[aria-label="Repeat round 1 as long as it takes"]'));
    assert.equal($$(CARD)[0].querySelector(".songForm-chip--more").textContent, "…×");
    click($$(CARD)[0].querySelector(CHIP));
    assert.equal(parts(0), 3);
  } finally {
    cleanup();
  }
});

test("rounds move by the grip's arrow keys, and duplicate and delete from their buttons", async () => {
  const { openSong, leads, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    const key = (node, name) => node.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true }));
    key($('[aria-label="Drag to move round 1"]'), "ArrowDown");
    assert.deepEqual(leads(), ["Vocals", "Collective", CLARINET]);
    assert.equal(document.activeElement, $('[aria-label="Drag to move round 2"]'));
    key($('[aria-label="Drag to move round 1"]'), "ArrowUp");
    assert.deepEqual(leads(), ["Vocals", "Collective", CLARINET]);
    click($('[aria-label="Duplicate round 3"]'));
    click($('[aria-label="Delete round 1"]'));
    assert.deepEqual(leads(), ["Collective", CLARINET, CLARINET]);
    click($(".songForm-add-round"));
    assert.equal($$(CARD).length, 4);
  } finally {
    cleanup();
  }
});

test("save keeps your version, and the switch flips between it and the band's", async () => {
  const { openSong, leads, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    click($(DELETE_LAST));
    click(button("Save"));

    assert.equal($(".songForm-editor"), null);
    assert.deepEqual(leads(), ["Collective", "Vocals"]);
    assert.ok($(".songForm--mine"));
    const stored = JSON.parse(localStorage.getItem(STORE_KEY));
    assert.equal(stored.show, "mine");
    assert.deepEqual(stored.rows.map((row) => row[2]), ["Collective; count-off: 3 tempo ticks", "Vocals"]);

    assert.ok($(MENU_BTN).classList.contains("is-mine"));
    click(menuItem("band"));
    assert.equal($(MENU), null);
    assert.deepEqual(leads(), ["Collective", "Vocals", CLARINET]);
    assert.equal($(".songForm--mine"), null);
    assert.equal($(MENU_BTN).classList.contains("is-mine"), false);
    assert.equal(JSON.parse(localStorage.getItem(STORE_KEY)).show, "band");
    assert.equal(editButton().textContent, "Edit my version");

    click(menuItem("mine"));
    assert.deepEqual(leads(), ["Collective", "Vocals"]);
    assert.equal(menuItem("mine").getAttribute("aria-checked"), "true");
    assert.equal(menuItem("band").getAttribute("aria-checked"), "false");
  } finally {
    cleanup();
  }
});

test("a version that matches the band's isn't kept", async () => {
  const { openSong, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    click($(DELETE_LAST));
    click($('[aria-label="Back to the band\'s form"]'));
    click(button("Save"));
    assert.equal(localStorage.getItem(STORE_KEY), null);
    assert.equal(hasChoice(), false);
  } finally {
    cleanup();
  }
});

test("cancel leaves everything as it was", async () => {
  const { openSong, leads, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    click($('[aria-label="Delete round 1"]'));
    click(button("Cancel"));
    assert.deepEqual(leads(), ["Collective", "Vocals", CLARINET]);
    assert.equal(localStorage.getItem(STORE_KEY), null);
  } finally {
    cleanup();
  }
});

test("the form copies as the W: lines a song's file carries", async () => {
  const { openSong, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    click($('[aria-label="Copy as text"]'));
    assert.equal($(".songForm-text-area").value, [
      "W:| 1 | A B | Collective; count-off: 3 tempo ticks |",
      "W:| 2 | A B A B | Vocals |",
      "W:| 3 | A B | Clarinet solo |",
    ].join("\n"));
  } finally {
    cleanup();
  }
});

test("each song has its own version, read back when it opens again", async () => {
  const stored = JSON.stringify({ show: "mine", rows: [["1", "A B ...", "Collective"]] });
  const { openSong, leads, cleanup } = await setup({ stored });
  try {
    openSong();
    assert.deepEqual(leads(), ["Collective"]);
    assert.ok($(".songForm-part--more"));
    openSong("other.abc");
    assert.deepEqual(leads(), ["Collective", "Vocals", CLARINET]);
    assert.equal(hasChoice(), false);
  } finally {
    cleanup();
  }
});

test("opening another song closes the editor", async () => {
  const { openSong, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    openSong("other.abc");
    assert.equal($(".songForm-editor"), null);
  } finally {
    cleanup();
  }
});

test("a chip's arrow keys move it within its round", async () => {
  const { openSong, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    const first = $$(CARD)[0].querySelector(CHIP);
    first.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    const names = $$(CARD)[0].querySelectorAll(CHIP);
    assert.deepEqual([...names].map((node) => node.firstChild.textContent), ["B", "A"]);
    assert.equal(document.activeElement, names[1]);
  } finally {
    cleanup();
  }
});

test("dragging a round by its grip moves it", async () => {
  const { openSong, leads, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    const cards = $$(CARD);
    document.elementFromPoint = () => cards[2];
    const pointer = (type, target, x) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: 0, button: 0 }));
    // Pointer events, or mouse events where there are none (jsdom, Safari 12).
    const [down, move, up] = window.PointerEvent ? ["pointerdown", "pointermove", "pointerup"] : ["mousedown", "mousemove", "mouseup"];
    pointer(down, cards[0].querySelector(".songForm-grip"), 0);
    pointer(move, window, 50);
    assert.ok(cards[2].classList.contains("is-drop-after"));
    pointer(up, window, 50);
    assert.deepEqual(leads(), ["Vocals", CLARINET, "Collective"]);
  } finally {
    cleanup();
  }
});

test("nothing is drawn until the page has loaded, and then the menu button comes", async () => {
  const page = mountPage();
  try {
    const ctx = makeCtx();
    const songForm = createSongForm(ctx);
    ctx.store.set("nav", { currentSongFile: FILE });
    ctx.store.set("tune", { currentSongText: SONG, formTables: TABLES, songSerial: 1 });
    assert.equal($(".songForm-tools"), null);
    await songForm.init();
    assert.ok($(".songForm-tools"));
  } finally {
    page.cleanup();
  }
});

const press = (node, key, mods = {}) => node.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }));

test("the setlist editor's keys: Ctrl+Enter saves, Escape cancels", async () => {
  const { openSong, leads, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    click($(DELETE_LAST));
    press($(".songForm-field--lead"), "Enter", { ctrlKey: true });
    assert.equal($(".songForm-editor"), null);
    assert.deepEqual(leads(), ["Collective", "Vocals"]);

    click(editButton());
    click($('[aria-label="Delete round 1"]'));
    press($(".songForm-field"), "Escape");
    assert.equal($(".songForm-editor"), null);
    assert.deepEqual(leads(), ["Collective", "Vocals"]);
  } finally {
    cleanup();
  }
});

test("Alt+↑/↓ moves the round the focus is in, and the focus goes with it", async () => {
  const { openSong, leads, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    press($$(".songForm-field")[1], "ArrowDown", { altKey: true });
    assert.deepEqual(leads(), ["Vocals", "Collective", CLARINET]);
    assert.equal(document.activeElement, $$(".songForm-field")[3]);
    press(document.activeElement, "ArrowUp", { altKey: true });
    assert.deepEqual(leads(), ["Collective", "Vocals", CLARINET]);
  } finally {
    cleanup();
  }
});

test("Delete on a grip removes its round; Enter steps through the fields", async () => {
  const { openSong, leads, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    press($('[aria-label="Drag to move round 2"]'), "Delete");
    assert.deepEqual(leads(), ["Collective", CLARINET]);
    assert.equal(document.activeElement, $('[aria-label="Drag to move round 2"]'));
    const fields = $$(".songForm-field");
    fields[0].focus();
    press(fields[0], "Enter");
    assert.equal(document.activeElement, fields[1]);
    press(fields[1], "Enter");
    assert.equal(document.activeElement, fields[2]);
  } finally {
    cleanup();
  }
});

test("↑/↓ inside the editor never reach the page (an open setlist would change song)", async () => {
  const { openSong, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    let reached = 0;
    document.addEventListener("keydown", () => {
      reached += 1;
    });
    press($(CHIP), "ArrowDown");
    assert.equal(reached, 0);
  } finally {
    cleanup();
  }
});

test("the menu copies the form on show, closes on Escape and on a click outside it", async () => {
  const { openSong, cleanup } = await setup();
  try {
    openSong();
    let copied = null;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (text) => { copied = text; return Promise.resolve(); } },
      configurable: true,
    });
    click(menuItem("copy"));
    await Promise.resolve();
    assert.equal(copied.split("\n")[0], "W:| 1 | A B | Collective; count-off: 3 tempo ticks |");
    assert.equal(menuItem("copy").textContent, "Copied ✓");

    press(menuItem("copy"), "Escape");
    assert.equal($(MENU), null);
    assert.equal(document.activeElement, $(MENU_BTN));

    menuItem("edit");
    click(document.getElementById("chordtable"));
    assert.equal($(MENU), null);
  } finally {
    cleanup();
  }
});

test("↑/↓ walk the menu's items", async () => {
  const stored = JSON.stringify({ show: "mine", rows: [["1", "A", "Collective"]] });
  const { openSong, cleanup } = await setup({ stored });
  try {
    openSong();
    click($(MENU_BTN));
    assert.equal(document.activeElement, menuItem("band"));
    press(document.activeElement, "ArrowDown");
    assert.equal(document.activeElement, menuItem("mine"));
    press(document.activeElement, "ArrowUp");
    press(document.activeElement, "ArrowUp");
    assert.equal(document.activeElement, menuItem("copy"));
  } finally {
    cleanup();
  }
});

test("the menu square shows on hovering or tapping the strip, and hides again", async () => {
  const { openSong, cleanup } = await setup();
  try {
    openSong();
    const shown = () => $(".songForm-tools").classList.contains("is-revealed");
    const mouse = (type, target, related) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, relatedTarget: related }));
    assert.equal(shown(), false);

    const strip = $(".songForm .songForm-lead");
    mouse("mouseover", strip);
    assert.equal(shown(), true);
    mouse("mouseout", strip, document.getElementById("chordtable"));
    await new Promise((resolve) => {
      setTimeout(resolve, 450);
    });
    assert.equal(shown(), false);

    click(strip);
    assert.equal(shown(), true);
    click(document.getElementById("chordtable"));
    assert.equal(shown(), false);

    $(MENU_BTN).focus();
    assert.equal(shown(), true);
    click($(MENU_BTN));
    click(document.getElementById("chordtable"));
    assert.equal($(MENU), null);
    assert.equal(shown(), false);
  } finally {
    cleanup();
  }
});

test("adding a ... keeps the focus in its round, and a click on the strip closes the menu", async () => {
  const { openSong, cleanup } = await setup();
  try {
    openSong();
    click(editButton());
    click($('[aria-label="Repeat round 1 as long as it takes"]'));
    assert.equal(document.activeElement, $(CARD));
    click(button("Cancel"));

    menuItem("edit");
    click($(".songForm .songForm-lead"));
    assert.equal($(MENU), null);
    assert.ok($(".songForm-tools").classList.contains("is-revealed"));
  } finally {
    cleanup();
  }
});

test("parts typed by hand and a repeat count, for a form the music doesn't mark", async () => {
  const { openSong, cleanup } = await setup();
  openSong();
  click(editButton());
  const field = $$(TYPE)[2];
  field.value = "aaba";
  field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(parts(2), 6);
  assert.equal(document.activeElement, $$(TYPE)[2]);
  // Backspace in the empty field takes the last part off.
  $$(TYPE)[2].dispatchEvent(new window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
  assert.equal(parts(2), 5);
  // − 2x +: two steps up from once.
  click(MORE_TIMES(2));
  click(MORE_TIMES(2));
  assert.equal($$(".songForm-repeat-value")[2].textContent, "3x");
  // A space after a part makes it a part, as in a mail address field.
  const typing = $$(TYPE)[1];
  typing.value = "Intro ";
  typing.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(parts(1), 5);
  // Text still typed in a field counts when saving, and survives other edits first.
  $$(TYPE)[0].value = "C 2x";
  click(button(" Add a round"));
  assert.equal($$(TYPE)[0].value, "C 2x");
  click(button("Save"));
  const rows = JSON.parse(localStorage.getItem(STORE_KEY)).rows;
  assert.deepEqual(rows[0], ["1", "A B C 2x", "Collective; count-off: 3 tempo ticks"]);
  assert.deepEqual(rows[1], ["2", "A B A B Intro", "Vocals"]);
  assert.deepEqual(rows[2], ["3", "A B A A B 3x", CLARINET]);
  cleanup();
});

test("only the round being worked on shows its tools", async () => {
  const { openSong, cleanup } = await setup();
  openSong();
  click(editButton());
  const active = () => $$(CARD).map((node) => node.classList.contains("is-active"));
  assert.deepEqual(active(), [true, false, false]);
  $$(TYPE)[2].dispatchEvent(new window.Event("mousedown", { bubbles: true }));
  assert.deepEqual(active(), [false, false, true]);
  // Moving there doesn't redraw: the control pressed is still in the page.
  assert.ok($$(TYPE)[2].isConnected);
  cleanup();
});

test("a song with no form and no part markers gets one from \"+ Song form\"", async () => {
  const { ctx, cleanup } = await setup();
  ctx.store.set("nav", { currentSongFile: "plain.abc" });
  renderWordsTables(document.getElementById("chordtable"), []);
  ctx.store.set("tune", { currentSongText: "X:1\nT:Plain\nK:C\nC4|]", formTables: [], songSerial: ctx.state.songSerial + 1 });
  const add = $(".songForm-add-form");
  assert.ok(add, "a labelled button, not the menu");
  click(add);
  assert.equal($$(CARD).length, 1);
  assert.equal(document.activeElement, $(TYPE));
  // A and B to pick from, though the music names no parts.
  assert.deepEqual($$(".songForm-add-part").map((node) => node.textContent), ["+ A", "+ B", "+ …"]);
  const field = $(TYPE);
  field.value = "aaba";
  field.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  click(MORE_TIMES(0));
  click(button("Save"));
  assert.deepEqual(JSON.parse(localStorage.getItem("rj.songForm.plain.abc")).rows, [["1", "A A B A 2x", ""]]);
  // With a version of its own the menu is back (band's form / mine).
  assert.ok($(MENU_BTN) && !$(".songForm-add-form"));
  cleanup();
});

test("text half typed in a round stays with it when rounds are deleted or moved", async () => {
  const { openSong, cleanup } = await setup();
  openSong();
  click(editButton());
  $$(TYPE)[2].value = "C";
  click($('[aria-label="Delete round 1"]'));
  assert.equal($$(CARD).length, 2);
  click(button("Save"));
  const rows = JSON.parse(localStorage.getItem(STORE_KEY)).rows;
  assert.deepEqual(rows.map((cells) => cells[1]), ["A B A B", "A B C"]);
  cleanup();
});
