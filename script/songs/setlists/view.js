import {
  byId, el, clear, on, downloadBlob,
} from "../../lib/core/dom.js";
import { isSetlistDivider } from "../../lib/setlists/setlist-format.js";
import { walkSetlist } from "../../lib/setlists/setlist-walk.js";
import { extractKeyFromAbc, setlistTransposeSteps } from "../../lib/music/music-theory.js";
import {
  getPersonalSetlist,
  renamePersonalSetlist,
  removeSongFromPersonalSetlist,
  insertItemInPersonalSetlist,
  updateSongKeyInPersonalSetlist,
  updateSongNoteInPersonalSetlist,
  updateDividerLabelInPersonalSetlist,
  setPersonalSetlistOrder,
  exportPersonalSetlistText,
} from "../../lib/setlists/setlists-store.js";
import { isRenderWrite } from "../core/state.js";
import { createSetlistKeys } from "./keys.js";
import {
  createRowDrag, draggableRows, currentOrder, renumberOpen,
} from "./row-drag.js";
import { createAddSongTray } from "./add-song.js";
import { createPlaylistExport } from "./playlist-export.js";

const emptyRow = (text) => el("div", { class: "song-list-empty", text });
// A read-only set heading (band setlists): the same row as a personal set's
// editable one, with the name as plain text.
const setHeaderRow = (text) => el("div", { class: "song-list-item setlist-divider-row" },
  el("span", { class: "setlist-set-label", text }));

function downloadText(filename, text) {
  downloadBlob(filename, new Blob([text], { type: "text/plain" }));
}

// Show the open-setlist chrome (crumb, tools, title row) and set the title /
// personal-only buttons for `name`.
function applyOpenChrome(name, isPersonal) {
  const show = (id, hidden = false) => {
    const node = byId(id);
    if (node) node.hidden = hidden;
  };
  show("setlistTools");
  show("setlistsBackBtn");
  show("openSetlistTools");

  // The title row drops below the "Print …" group, directly on top of the list.
  const titleRow = byId("setlistTitleRow");
  const openTools = byId("openSetlistTools");
  if (titleRow && openTools) openTools.append(titleRow);

  const titleText = byId("setlistTitleText");
  if (titleText) {
    titleText.hidden = false;
    titleText.textContent = name;
    // A personal setlist's name is editable: dashed underline, focusable,
    // click (or Tab + focus) to rename.
    titleText.classList.toggle("is-editable", isPersonal);
    titleText.title = isPersonal ? "Click to rename" : "";
    if (isPersonal) titleText.tabIndex = 0;
    else titleText.removeAttribute("tabindex");
  }
  show("setlistNameInput", true);
  show("setlistExportBtn", !isPersonal);
}

// A row control that can plausibly be a note field's blur destination (the
// user clicking straight from an open note onto something else in the
// list) — used by describeFocusTarget/restoreDescribedFocus below to carry
// focus across a refreshOpenPersonal() rebuild, which wipes and rebuilds
// every one of these from scratch.
const ROW_FOCUS_SELECTORS = [
  ".setlist-drag-handle",
  ".setlist-song-remove",
  ".setlist-set-merge",
  ".setlist-song-title",
  ".setlist-song-note-add",
  ".setlist-song-note-text",
  ".setlist-divider-input",
];

// Describe `target` (a note field's blur `relatedTarget`) in a way that
// survives refreshOpenPersonal() wiping and rebuilding #songList: a row
// index + the control's own role, or one of the two fixed controls in the
// "Add to setlist" tray at the list's foot. Returns null for anything else
// — outside #songList entirely (refreshOpenPersonal never touches it, so
// it's still correctly focused once the render settles) or a control this
// list doesn't know how to relocate.
function describeFocusTarget(listEl, target) {
  if (!listEl || !listEl.contains(target)) return null;
  if (target.id === "setlistAddSongSearch") return { addSearch: true };
  if (target.closest(".rj-library-add-break")) return { addBreak: true };
  const row = target.closest(".setlist-song-row, .setlist-divider-row");
  if (!row) return null;
  const selector = ROW_FOCUS_SELECTORS.find((s) => target.closest(s));
  return selector ? { index: row.dataset.setlistIndex, selector } : null;
}

// The other half of describeFocusTarget: relocate and focus the equivalent
// control after a rebuild. Returns whether it found one.
function restoreDescribedFocus(listEl, described) {
  if (!listEl || !described) return false;
  if (described.addSearch) {
    const target = byId("setlistAddSongSearch");
    if (target) target.focus();
    return Boolean(target);
  }
  if (described.addBreak) {
    const target = listEl.querySelector(".rj-library-add-break");
    if (target) target.focus();
    return Boolean(target);
  }
  const row = listEl.querySelector(`[data-setlist-index="${described.index}"]`);
  const target = row && row.querySelector(described.selector);
  if (target) target.focus();
  return Boolean(target);
}

// A field that wants the arrow keys for itself. Drag handles don't — reorder
// is a pointer-drag-only gesture, so the arrow keys always step through songs
// even when a handle has focus (see initArrowNav below).
function ownsArrowKeys(target) {
  if (!target) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
  return Boolean(target.isContentEditable);
}

// The next/previous song row beside `row` inside its own set box (hover
// splitters and other non-song siblings are skipped), or null at the edge.
function songSibling(row, dir) {
  let node = dir > 0 ? row.nextElementSibling : row.previousElementSibling;
  while (node && !node.classList.contains("setlist-song-row")) {
    node = dir > 0 ? node.nextElementSibling : node.previousElementSibling;
  }
  return node;
}

// Where Alt+Up/Down puts `row`: one slot past its neighbouring song, or — at
// the edge of its set — into the neighbouring set box (right under that set's
// heading going down, at the foot of its songs going up). Null when there is
// nowhere to go (the first/last set's edge).
function keyboardSlot(row, dir) {
  const box = row.parentNode;
  const sibling = songSibling(row, dir);
  if (sibling) return { parent: box, before: dir > 0 ? sibling.nextSibling : sibling };
  const next = dir > 0 ? box.nextElementSibling : box.previousElementSibling;
  if (!next || !next.classList.contains("setlist-set")) return null;
  if (dir > 0) {
    const heading = next.querySelector(".setlist-divider-row");
    return { parent: next, before: heading ? heading.nextSibling : next.firstChild };
  }
  return { parent: next, before: next.lastElementChild };
}

// Wording of a set's "add a song" control, button and search field alike.
function addLabel(setNumber, split) {
  return split ? `Add song to set ${setNumber}` : "Add song";
}

/*
  An open setlist: band setlists are read-only, personal ones are fully
  editable (reorder by drag or arrow keys, per-song transpose, add songs / set
  breaks, rename, export). Clicking a song opens it in the *same* interactive
  sheet a Library song opens in, pre-seeded with the setlist's transposition —
  a setlist is a different song list feeding the same reader, not a flattened
  dump.
*/
export function createSetlistView(ctx) {
  let focusHandleAfterRender = null; // draggable-row index to re-focus after a keyboard nudge
  let noteFocusAfterRender = null; // describeFocusTarget() result to re-focus after a note commit
  let songLoadSeq = 0; // bumped per song open; a stale XHR callback checks it before rendering
  const keys = createSetlistKeys(ctx);
  // Hoisted function declarations below, so these can be built up front.
  const rowDrag = createRowDrag({ onReorder: persistOrder });
  const tray = createAddSongTray(ctx, {
    refresh: refreshOpenPersonal,
    onInsert: (index) => shiftOpenIndex(index, 1),
  });

  // Inserting (`delta` 1) or removing (-1) the item at `index` shifts every
  // item after it, so carry the open song's index pointer along — otherwise
  // the highlight, Up/Down stepping and the Key stepper's write-back would all
  // aim at whichever item now sits at the stale index. Removing the open song
  // itself drops the pointer (the sheet keeps showing it).
  function shiftOpenIndex(index, delta) {
    const open = ctx.state.currentSetlistSongIndex;
    if (open == null || !ctx.state.currentSongFile) return;
    let next = open;
    if (delta > 0 && open >= index) next = open + 1;
    else if (delta < 0 && open === index) next = null;
    else if (delta < 0 && open > index) next = open - 1;
    if (next !== open) ctx.nav.selectSetlistSong(ctx.state.currentSongFile, next);
  }

  // ---- opening -----------------------------------------------------

  function openBand(file, fallbackName, afterRender) {
    ctx.setlistData.loadBand(file, (setlist) => {
      ctx.nav.enterSetlist({ id: String(file).replace(/\.txt$/, "") });
      renderOpen(setlist.name || fallbackName, setlist.songs, null, setlist.desc);
      if (afterRender) afterRender();
    }, (status) => {
      console.warn(`Could not load setlist ${file} (status ${status})`);
    });
  }

  function openPersonal(id, afterRender) {
    const entry = getPersonalSetlist(ctx.storage(), id);
    if (!entry) return;
    ctx.nav.enterSetlist({ id, personalId: id });
    const open = () => {
      renderOpen(entry.name, entry.songs, entry, entry.desc);
      if (afterRender) afterRender();
    };
    ctx.setlistData.ensureSongsLoaded(open, (status) => {
      // Index fetch failed: still open the setlist so it isn't a dead click —
      // song titles just fall back to their filenames.
      console.warn(`Song index failed to load (status ${status}); titles may show as filenames`);
      open();
    });
  }

  function refreshOpenPersonal() {
    if (!ctx.state.currentPersonalId) return;
    const entry = getPersonalSetlist(ctx.storage(), ctx.state.currentPersonalId);
    if (!entry) {
      ctx.setlistHome.show();
      return;
    }
    renderOpen(entry.name, entry.songs, entry, entry.desc);
    if (ctx.swipeNav) ctx.swipeNav.updateButtons();
  }

  // ---- row controls (personal) ----------------------------------

  function appendRowControls(row, personalEntry) {
    const handle = el("button", {
      type: "button",
      class: "setlist-drag-handle",
      title: "Drag to reorder",
      html: '<span class="fa-solid fa-grip-vertical" aria-hidden="true"></span>',
      attrs: { "aria-label": "Drag to reorder" },
      on: {
        pointerdown: (e) => rowDrag.begin(e, handle, row, personalEntry.id),
        keydown: (e) => {
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            removeRow(row, personalEntry.id);
          }
        },
      },
    });
    row.insertBefore(handle, row.firstChild);

    row.append(el("button", {
      type: "button",
      class: "setlist-song-btn setlist-song-remove",
      title: "Remove",
      html: '<span class="fa-solid fa-trash-can" aria-hidden="true"></span>',
      attrs: { "aria-label": "Remove" },
      on: {
        click: () => removeRow(row, personalEntry.id),
      },
    }));
  }

  // ---- rows ---------------------------------------------------

  // Set 1 has no divider item until it is given a name: the first rename
  // inserts one at the top of the list (a leading divider is set 1's name),
  // and clearing it later removes that divider again.
  function firstSetHeading(label) {
    const personalId = ctx.state.currentPersonalId;
    return el("div", { class: "song-list-item setlist-divider-row" },
      el("input", {
        type: "text",
        class: "setlist-divider-input",
        placeholder: "Set 1",
        value: label === "Set 1" ? "" : label,
        on: {
          change: (e) => {
            const value = e.target.value.trim();
            if (value && value !== "Set 1") {
              insertItemInPersonalSetlist(ctx.storage(), personalId, 0, { divider: value });
              shiftOpenIndex(0, 1);
            }
            tray.clearTarget();
            refreshOpenPersonal();
          },
        },
      }));
  }

  function dividerRow(item, index, personalEntry, setNumber) {
    if (!personalEntry) return setHeaderRow(item.divider || `Set ${setNumber}`);

    const row = el("div", {
      class: "song-list-item setlist-divider-row",
      dataset: { setlistIndex: String(index) },
    });
    row.append(el("input", {
      type: "text",
      class: "setlist-divider-input",
      placeholder: `Set ${setNumber}`,
      value: item.divider || "",
      on: {
        change: (e) => {
          const value = e.target.value.trim();
          if (setNumber === 1 && !value) {
            removeSongFromPersonalSetlist(ctx.storage(), personalEntry.id, index);
            shiftOpenIndex(index, -1);
          } else {
            updateDividerLabelInPersonalSetlist(ctx.storage(), personalEntry.id, index, value);
          }
          refreshOpenPersonal();
        },
      },
    }));
    // A heading belongs to its set box, so it has no drag handle; merging
    // joins its songs onto the set before it.
    if (setNumber === 1) return row;
    row.append(el("button", {
      type: "button",
      class: "setlist-set-merge",
      title: "Merge into previous set",
      html: '<span class="fa-solid fa-arrows-up-to-line" aria-hidden="true"></span>',
      attrs: { "aria-label": "Merge into previous set" },
      on: { click: () => removeRow(row, personalEntry.id) },
    }));
    return row;
  }

  // The hover splitter between two songs of a personal setlist: a scissors
  // button on the left edge that starts a new set at `index` (the item the
  // new set opens with). Invisible until the gap is hovered or focused.
  function splitGap(index, personalEntry) {
    return el("div", { class: "setlist-split-gap" }, el("button", {
      type: "button",
      class: "setlist-split-btn",
      title: "Start a new set here",
      html: '<span class="fa-solid fa-scissors" aria-hidden="true"></span>',
      attrs: { "aria-label": "Start a new set here" },
      on: {
        click: () => {
          tray.clearTarget();
          insertItemInPersonalSetlist(ctx.storage(), personalEntry.id, index, { divider: "" });
          shiftOpenIndex(index, 1);
          refreshOpenPersonal();
        },
      },
    }));
  }

  // A set's own "Add song" row: aims the tray's next add at the end of this
  // set (`endIndex`, the item index just past its last row).
  function setAddRow(setNumber, endIndex) {
    return el("button", {
      type: "button",
      class: "setlist-set-add",
      html: '<span class="fa-solid fa-plus" aria-hidden="true"></span>',
      on: { click: () => tray.targetEnd(endIndex) },
    }, el("span", { text: addLabel(setNumber, true) }));
  }

  // A song's per-setlist note (e.g. "Ben solos 2nd chorus") — shown only in
  // the setlist itself (this list, and the printed stage list in
  // setlist-print.js), never on the song's own interactive sheet. Read-only
  // text for a band setlist (whatever its .txt file's own "> " lines set);
  // click-to-edit for a personal one, same in-place-edit pattern as the
  // setlist title (initRename below) and the divider label.
  function noteBlock(song, index, personalEntry) {
    const hasNote = Boolean(song.note);
    if (!personalEntry) {
      return hasNote
        ? el("div", { class: "setlist-song-note-row" },
          el("div", { class: "setlist-song-note-text", text: song.note }))
        : null;
    }

    let cancelled = false;
    const textEl = el("button", {
      type: "button",
      class: "setlist-song-note-text",
      text: song.note || "",
      hidden: !hasNote,
    });
    const addBtn = el("button", {
      type: "button", class: "setlist-song-note-add", text: "+ note", hidden: hasNote,
    });
    const inputEl = el("textarea", {
      class: "setlist-song-note-input",
      placeholder: "Add a note (e.g. who solos)…",
      title: "Ctrl+Enter to finish, Esc to cancel",
      value: song.note || "",
      rows: 2,
      hidden: true,
    });

    // A note-less row keeps "+ note" on the title's own line (no extra row
    // height); it only claims a full line while a note is shown or edited.
    const noteRow = el("div", {
      class: `setlist-song-note-row${hasNote ? "" : " is-inline"}`,
    }, [textEl, addBtn, inputEl]);

    const enterEdit = () => {
      cancelled = false;
      noteRow.classList.remove("is-inline");
      textEl.hidden = true;
      addBtn.hidden = true;
      inputEl.hidden = false;
      inputEl.focus();
    };
    // `relatedTarget` is the blur's real destination, if any: null for a
    // programmatic blur() with nowhere else to go (Ctrl+Enter, Escape), set
    // when the user instead clicked straight onto another focusable control
    // (a different row, the add-song tray). Only the null case should pull
    // focus back onto this row — otherwise we'd be fighting the browser's
    // own pending focus change to wherever the user actually clicked.
    const leaveEdit = (relatedTarget) => {
      inputEl.hidden = true;
      noteRow.classList.toggle("is-inline", !hasNote);
      textEl.hidden = !hasNote;
      addBtn.hidden = hasNote;
      // Blur already moved focus to <body> by the time this runs — without
      // reclaiming it here, Alt+Up/Down's row lookup (e.target.closest(...))
      // finds nothing and keyboard reorder silently stops working until the
      // row is clicked again.
      if (!relatedTarget) (hasNote ? textEl : addBtn).focus();
    };
    const commit = (relatedTarget) => {
      if (cancelled) {
        cancelled = false;
        leaveEdit(relatedTarget);
        return;
      }
      const value = inputEl.value.trim();
      if (value === (song.note || "")) {
        leaveEdit(relatedTarget);
        return;
      }
      updateSongNoteInPersonalSetlist(ctx.storage(), personalEntry.id, index, value);
      // The row gets fully rebuilt by this re-render, so the local textEl
      // above won't exist afterward. A keyboard commit / nowhere-else blur
      // hands off to the same post-render refocus mechanism removeRow/
      // moveRowByKeyboard use (this row's drag handle); a real click
      // destination gets relocated to its own rebuilt equivalent instead.
      if (relatedTarget) {
        noteFocusAfterRender = describeFocusTarget(byId("songList"), relatedTarget);
      } else {
        focusHandleAfterRender = index;
      }
      refreshOpenPersonal();
    };

    textEl.addEventListener("click", enterEdit);
    addBtn.addEventListener("click", enterEdit);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        inputEl.blur();
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      cancelled = true;
      inputEl.value = song.note || "";
      inputEl.blur();
    });
    inputEl.addEventListener("blur", (e) => commit(e.relatedTarget));

    return noteRow;
  }

  function songRow(song, index, personalEntry, displayNumber) {
    const row = el("div", {
      class: "song-list-item setlist-song-row",
      dataset: { setlistIndex: String(index), songFile: song.file },
    }, [
      el("span", { class: "setlist-song-number", text: String(displayNumber) }),
      el("button", {
        type: "button",
        class: "setlist-song-title",
        text: ctx.songName(song.file),
        ...(personalEntry ? { title: "Alt+↑/↓ to reorder" } : {}),
        on: { click: () => openSetlistSong(song, index) },
      }),
    ]);

    row.append(keys.keyBadge(song));
    if (personalEntry) appendRowControls(row, personalEntry);

    const note = noteBlock(song, index, personalEntry);
    if (note) row.append(note);

    return row;
  }

  // ---- render ------------------------------------------------

  function renderOpen(name, songs, personalEntry, desc) {
    ctx.nav.showSetlistContents({ songs, name, desc: desc || "" });

    const isPersonal = Boolean(personalEntry);
    if (!isPersonal) tray.reset();

    applyOpenChrome(name, isPersonal);

    const listEl = byId("songList");
    clear(listEl);

    const walk = walkSetlist(songs);
    // A personal setlist is drawn as one box per set (heading, songs, and —
    // once split — an "Add song to set N" row); a band setlist stays flat.
    let box = null;
    let openSet = 1;
    let endIndex = 0;
    let prevWasSong = false;
    const target = () => box || listEl;
    const openBox = () => {
      box = el("div", { class: "setlist-set" });
      listEl.append(box);
    };
    // The set that owns the add-song field shows it; every other set shows an
    // "Add song to set N" row that hands the field over. By default the field
    // sits in the last set.
    let trayHolder = null;
    const closeSet = (isLast) => {
      if (!box || !isPersonal) return;
      const aimed = tray.target();
      const mine = aimed === null ? isLast : aimed === endIndex;
      if (mine && !trayHolder) {
        trayHolder = tray.build(addLabel(openSet, walk.hasDividers));
        box.append(trayHolder);
      } else {
        box.append(setAddRow(openSet, endIndex));
      }
    };
    if (songs.length > 0 && !isSetlistDivider(songs[0])) openBox();
    walk.entries.forEach((entry) => {
      if (entry.kind === "set-heading") {
        if (entry.index !== undefined) {
          closeSet(false);
          openBox();
          openSet = entry.setNumber;
          endIndex = entry.index + 1;
        }
        prevWasSong = false;
        let heading;
        if (entry.index !== undefined) {
          heading = dividerRow(entry.item, entry.index, personalEntry, entry.setNumber);
        } else {
          heading = isPersonal ? firstSetHeading(entry.label) : setHeaderRow(entry.label);
        }
        target().append(heading);
      } else {
        if (isPersonal && prevWasSong) target().append(splitGap(entry.index, personalEntry));
        target().append(songRow(entry.item, entry.index, personalEntry, entry.displayNumber));
        endIndex = entry.index + 1;
        prevWasSong = true;
      }
    });
    if (songs.length === 0) {
      listEl.append(emptyRow(
        isPersonal ? "No songs yet — add one below." : "This setlist has no songs.",
      ));
      if (isPersonal) openBox();
    }
    closeSet(true);
    if (isPersonal && !trayHolder) {
      // The aimed set no longer exists (the list changed under it): fall back
      // to the last set.
      tray.clearTarget();
      box.lastChild.replaceWith(tray.build(addLabel(openSet, walk.hasDividers)));
    }

    if (isPersonal) {
      listEl.append(tray.buildNewSet());
      restoreFocusAfterRender(listEl);
    }

    ctx.setlistPrint.buildBooklet(name, songs, desc);
    highlightCurrent();
  }

  function restoreFocusAfterRender(listEl) {
    tray.restoreFocus();
    if (focusHandleAfterRender != null) {
      const handles = listEl.querySelectorAll(".setlist-drag-handle");
      if (handles[focusHandleAfterRender]) handles[focusHandleAfterRender].focus();
      focusHandleAfterRender = null;
    }
    if (noteFocusAfterRender) {
      const described = noteFocusAfterRender;
      noteFocusAfterRender = null;
      restoreDescribedFocus(listEl, described);
    }
  }

  // ---- drag / keyboard reorder --------------------------------

  function persistOrder(personalId, orderIndices) {
    tray.clearTarget();
    // The open song keeps its place in the list, so carry its index pointer to
    // wherever the reorder put it — whichever row was moved. Otherwise a later
    // plain Up/Down would step from the stale pre-move index.
    const { currentSetlistSongIndex: open } = ctx.state;
    if (open != null && ctx.state.currentSongFile) {
      const moved = orderIndices.indexOf(open);
      if (moved !== -1) ctx.nav.selectSetlistSong(ctx.state.currentSongFile, moved);
    }
    setPersonalSetlistOrder(ctx.storage(), personalId, orderIndices);
    refreshOpenPersonal();
  }

  // Drop a song / divider row from the open personal setlist, reading its
  // live position out of the DOM so it stays correct after a drag. Keyboard
  // focus lands on the handle that slides into the freed slot (or the last).
  function removeRow(row, personalId) {
    const rows = draggableRows();
    const pos = rows.indexOf(row);
    tray.clearTarget();
    const removedIndex = Number(row.dataset.setlistIndex);
    removeSongFromPersonalSetlist(ctx.storage(), personalId, removedIndex);
    shiftOpenIndex(removedIndex, -1);
    if (pos !== -1) {
      if (rows.length > 1) {
        focusHandleAfterRender = Math.min(pos, rows.length - 2);
      } else {
        tray.focusAfterRender();
      }
    }
    refreshOpenPersonal();
  }

  // Alt+Up/Alt+Down on any focusable element of a row (title button, divider
  // input, drag handle): the keyboard peer of a pointer-drag, one slot at a
  // time. Clamped at both ends (no wraparound). Wired into initArrowNav
  // rather than the drag handle alone, so it works no matter which part of
  // the row currently has focus.
  function moveRowByKeyboard(row, personalId, dir) {
    const slot = keyboardSlot(row, dir);
    if (!slot) return;
    slot.parent.insertBefore(row, slot.before);
    renumberOpen();
    persistOrder(personalId, currentOrder());
  }

  // ---- opening a song from the list -------------------------

  function openSetlistSong(song, index) {
    ctx.nav.selectSetlistSong(song.file, index);
    highlightCurrent();
    songLoadSeq += 1;
    const seq = songLoadSeq;
    ctx.readFile(`/songs/${song.file}`, (text) => {
      // A slower earlier request must not overwrite the sheet the user has
      // since moved on to.
      if (seq !== songLoadSeq) return;
      const extra = setlistTransposeSteps(song.key, extractKeyFromAbc(text));
      ctx.sheet.render(text, { transposeSemitones: extra });
    }, (status) => {
      console.warn(`Setlist references a missing song file: ${song.file} (status ${status})`);
    });
  }

  // Open the song at `idx` of the open setlist (its position, so a song listed
  // twice comes back on the right row). False for a divider / out-of-range.
  function openSongAtIndex(idx) {
    const song = ctx.state.currentOpenSongs && ctx.state.currentOpenSongs[idx];
    if (!song || isSetlistDivider(song)) return false;
    openSetlistSong(song, idx);
    const listEl = byId("songList");
    const row = listEl && listEl.querySelector(`.setlist-song-row[data-setlist-index="${idx}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
    return true;
  }

  // Open the setlist song whose file matches `slug` (`s=` hash value), used
  // when a shared `sl=…&s=…` link lands on an open setlist. Returns whether a
  // matching row was found.
  function openSongInOpenSetlist(slug) {
    const songs = ctx.state.currentOpenSongs;
    if (!songs || !slug) return false;
    const target = `${slug}.abc`;
    let idx = -1;
    songs.forEach((item, i) => {
      if (idx === -1 && !isSetlistDivider(item) && item.file === target) idx = i;
    });
    return idx !== -1 && openSongAtIndex(idx);
  }

  // Open the previous / next song of the open setlist, skipping break dividers
  // and clamping at both ends. Returns whether it actually moved, so a caller
  // (initArrowNav) can tell a clamped edge apart from a real step.
  // Index (into the songs array) of the song stepSong(dir) would open, or -1
  // when there is none — nothing open, or already at that end of the list.
  function stepTarget(dir) {
    const songs = ctx.state.currentOpenSongs;
    if (ctx.state.setlistsView !== "open" || !songs || !songs.length) return -1;
    const songIndexes = [];
    songs.forEach((item, i) => {
      if (!isSetlistDivider(item)) songIndexes.push(i);
    });
    if (!songIndexes.length) return -1;

    const pos = songIndexes.indexOf(ctx.state.currentSetlistSongIndex);
    if (pos === -1) return dir > 0 ? songIndexes[0] : songIndexes[songIndexes.length - 1];
    const np = pos + dir;
    if (np < 0 || np >= songIndexes.length) return -1;
    return songIndexes[np];
  }

  function canStep(dir) {
    return stepTarget(dir) !== -1;
  }

  function stepSong(dir) {
    const next = stepTarget(dir);
    if (next === -1) return false;
    const songs = ctx.state.currentOpenSongs;

    openSetlistSong(songs[next], next);
    const row = byId("songList")
      && byId("songList").querySelector(`.setlist-song-row[data-setlist-index="${next}"]`);
    // On the narrow layout the sidebar (and this row with it) is display:none
    // once a sheet is open — scrollIntoView on an element with no box makes
    // some browsers fall back to scrolling the document itself to (0,0),
    // i.e. the whole page jumps to the top. offsetParent is null exactly
    // when the row has no layout box, so skip the scroll in that case.
    if (row && row.offsetParent) row.scrollIntoView({ block: "nearest" });
    return true;
  }

  function highlightCurrent() {
    const listEl = byId("songList");
    if (!listEl) return;
    listEl.querySelectorAll(".setlist-song-row").forEach((row) => {
      const isCurrent = Boolean(ctx.state.currentSongFile)
        && row.dataset.songFile === ctx.state.currentSongFile
        && (ctx.state.currentSetlistSongIndex == null
          || Number(row.dataset.setlistIndex) === ctx.state.currentSetlistSongIndex);
      row.classList.toggle("is-current-song", isCurrent);
      if (isCurrent) row.setAttribute("aria-current", "true");
      else row.removeAttribute("aria-current");
    });
  }

  // ---- controls (wired once) -----------------------------

  function initRename() {
    const titleText = byId("setlistTitleText");
    const nameInput = byId("setlistNameInput");
    if (!titleText || !nameInput) return;

    const enterEdit = () => {
      if (!ctx.state.currentPersonalId) return;
      nameInput.value = titleText.textContent;
      titleText.hidden = true;
      nameInput.hidden = false;
      nameInput.focus();
      nameInput.select();
    };
    const leaveEdit = () => {
      nameInput.hidden = true;
      titleText.hidden = false;
    };
    const commit = () => {
      if (!ctx.state.currentPersonalId) return;
      renamePersonalSetlist(
        ctx.storage(), ctx.state.currentPersonalId, nameInput.value.trim() || "Untitled setlist",
      );
      refreshOpenPersonal();
    };

    titleText.addEventListener("click", enterEdit);
    titleText.addEventListener("focus", enterEdit);
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        nameInput.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        leaveEdit();
      }
    });
    nameInput.addEventListener("blur", () => {
      if (!nameInput.hidden) commit();
    });
  }

  // Alt+Up/Alt+Down reorders the highlighted (currently open) song, wherever
  // keyboard focus happens to be. A divider row is the exception: with focus
  // inside one (its label input) that divider moves instead, since a divider
  // is never "selected".
  function rowToMoveOnAltArrow(target) {
    const focused = target && target.closest && target.closest(".setlist-song-row");
    if (focused && !focused.dataset.songFile) return focused;
    const idx = ctx.state.currentSetlistSongIndex;
    const current = idx == null ? null
      : byId("songList").querySelector(`.setlist-song-row[data-setlist-index="${idx}"]`);
    return current || focused;
  }

  function moveFocusedRowOnAltArrow(e) {
    if (ctx.state.setlistsView !== "open" || !ctx.state.currentPersonalId) return false;
    if (!e.target.closest(".setlist-song-row") && ownsArrowKeys(e.target)) return false;
    const row = rowToMoveOnAltArrow(e.target);
    if (!row) return false;
    e.preventDefault();
    moveRowByKeyboard(row, ctx.state.currentPersonalId, e.key === "ArrowDown" ? 1 : -1);
    return true;
  }

  function handlePlainArrowNav(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (ctx.state.setlistsView !== "open" || ownsArrowKeys(e.target)) return;
    e.preventDefault();
    const down = e.key === "ArrowDown";
    if (stepSong(down ? 1 : -1)) return;
    // Stepped past the last song: hand off to the "Add to setlist" tray
    // (personal setlists only — a band setlist has no such tray) instead
    // of just clamping in place.
    const addSearch = byId("setlistAddSongSearch");
    if (down && addSearch) addSearch.focus();
  }

  function initArrowNav() {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        moveFocusedRowOnAltArrow(e);
        return;
      }
      handlePlainArrowNav(e);
    });
  }

  // The listener nudging the Key stepper while a personal setlist's song is
  // open writes that row's override back. A render seeding the stepper for a
  // newly opened song changes ctx.state.transpose too, but is tagged RENDER.
  function initTransposeWriteBack() {
    ctx.store.subscribe("settings", (settings, changed, _name, meta) => {
      if (!changed.includes("transpose") || isRenderWrite(meta)) return;
      const { currentPersonalId, currentSetlistSongIndex, currentOpenSongs } = ctx.state;
      if (ctx.state.setlistsView !== "open" || !currentPersonalId) return;
      if (currentSetlistSongIndex == null || !currentOpenSongs) return;
      const song = currentOpenSongs[currentSetlistSongIndex];
      if (!song || isSetlistDivider(song) || song.file !== ctx.state.currentSongFile) return;
      const n = settings.transpose;
      const stored = Number.isFinite(n) && n !== 0 ? String(n) : "";
      if (stored === String(song.key == null ? "" : song.key)) return;
      updateSongKeyInPersonalSetlist(ctx.storage(), currentPersonalId, currentSetlistSongIndex, stored);
      refreshOpenPersonal();
    });
  }

  function initExport() {
    on("setlistExportBtn", "click", () => {
      if (!ctx.state.currentPersonalId) return;
      const entry = getPersonalSetlist(ctx.storage(), ctx.state.currentPersonalId);
      const text = exportPersonalSetlistText(ctx.storage(), ctx.state.currentPersonalId, ctx.songName);
      if (!text) return;
      const filename = `${(entry.name || "setlist").toLowerCase().replace(/[^a-z0-9]+/g, "_")}.txt`;
      downloadText(filename, text);
    });
  }

  // "Listen" buttons, under the Print row. YouTube opens every song in the
  // open setlist that has a YouTube F: link as one ad-hoc YouTube playlist;
  // Export saves the whole setlist as a playlist on the visitor's own
  // streaming account through Soundiiz (see playlist-export.js). Their enabled state
  // tracks ctx.setlistPrint's own per-song reads (already fetching every
  // setlist song's .abc to build the print booklet), so neither is clickable
  // mid-load or with nothing to play.
  function initListen() {
    const btn = byId("listenYoutubeBtn");
    if (!btn) return;
    const playlistExport = createPlaylistExport(ctx);
    playlistExport.init();
    ctx.setlistPrint.setListenChangeHandler((url, songs) => {
      btn.disabled = !url;
      btn.title = url ? "Open this setlist’s songs on YouTube" : "No YouTube links in this setlist";
      playlistExport.update(songs || []);
    });
    on("listenYoutubeBtn", "click", () => {
      const url = ctx.setlistPrint.getListenUrl();
      if (url) window.open(url, "_blank", "noopener");
    });
  }

  function initControls() {
    on("setlistsBackBtn", "click", () => ctx.setlistHome.show());
    ctx.setlistModal.init();
    initRename();
    initArrowNav();

    [
      ["printSetlistBtn", "setlist"],
      ["printChordbookBtn", "chordbook"],
      ["printSongbookBtn", "songbook"],
    ].forEach(([id, mode]) => on(id, "click", () => ctx.setlistPrint.print(mode)));

    initListen();

    // The booklet is engraved for whichever instrument the sheet is on; rebuild
    // it off-screen when the instrument changes so a later "Print …" is current.
    ctx.store.subscribe("settings", (_settings, changed) => {
      if (!changed.includes("instrument")) return;
      if (ctx.state.setlistsView === "open" && ctx.state.currentOpenSongs) {
        ctx.setlistPrint.buildBooklet(
          ctx.state.currentOpenSetlistName,
          ctx.state.currentOpenSongs,
          ctx.state.currentOpenSetlistDesc,
        );
      }
    });

    initTransposeWriteBack();
    initExport();
  }

  return {
    openBand, openPersonal, refreshOpenPersonal, renderOpen,
    highlightCurrent, stepSong, canStep, openSongInOpenSetlist, openSongAtIndex, initControls,
    addSongByFile: (file) => tray.addSongByFile(file),
  };
}
