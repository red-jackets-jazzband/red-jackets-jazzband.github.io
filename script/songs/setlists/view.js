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
  updateSongKeyInPersonalSetlist,
  updateSongNoteInPersonalSetlist,
  updateDividerLabelInPersonalSetlist,
  setPersonalSetlistOrder,
  exportPersonalSetlistText,
} from "../../lib/setlists/setlists-store.js";
import { isRenderWrite } from "../core/state.js";
import { createSetlistKeys } from "./keys.js";
import { createRowDrag, draggableRows, renumberOpen } from "./row-drag.js";
import { createAddSongTray } from "./add-song.js";

const emptyRow = (text) => el("div", { class: "song-list-empty", text });
const setHeaderRow = (text) => el("div", { class: "song-list-letter setlist-set-heading", text });

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
  }
  show("setlistNameInput", true);
  show("setlistRenameBtn", !isPersonal);
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
  const tray = createAddSongTray(ctx, { refresh: refreshOpenPersonal });

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
          updateDividerLabelInPersonalSetlist(
            ctx.storage(), personalEntry.id, index, e.target.value.trim(),
          );
          refreshOpenPersonal();
        },
      },
    }));
    appendRowControls(row, personalEntry);
    return row;
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

    const enterEdit = () => {
      cancelled = false;
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

    return el("div", { class: "setlist-song-note-row" }, [textEl, addBtn, inputEl]);
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

    walkSetlist(songs).entries.forEach((entry) => {
      if (entry.kind === "set-heading") {
        listEl.append(entry.index === undefined
          ? setHeaderRow(entry.label)
          : dividerRow(entry.item, entry.index, personalEntry, entry.setNumber));
      } else {
        listEl.append(songRow(entry.item, entry.index, personalEntry, entry.displayNumber));
      }
    });

    if (songs.length === 0) {
      listEl.append(emptyRow(
        isPersonal ? "No songs yet — add one below." : "This setlist has no songs.",
      ));
    }

    if (isPersonal) {
      listEl.append(tray.build());
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
    setPersonalSetlistOrder(ctx.storage(), personalId, orderIndices);
    refreshOpenPersonal();
  }

  // Drop a song / divider row from the open personal setlist, reading its
  // live position out of the DOM so it stays correct after a drag. Keyboard
  // focus lands on the handle that slides into the freed slot (or the last).
  function removeRow(row, personalId) {
    const rows = draggableRows();
    const pos = rows.indexOf(row);
    removeSongFromPersonalSetlist(ctx.storage(), personalId, Number(row.dataset.setlistIndex));
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
    const rows = draggableRows();
    const pos = rows.indexOf(row);
    const target = pos + dir;
    if (pos === -1 || target < 0 || target >= rows.length) return;
    row.parentNode.insertBefore(row, dir < 0 ? rows[target] : rows[target].nextSibling);
    renumberOpen();
    focusHandleAfterRender = target;
    // If the moved row is the song currently open in the sheet, carry its
    // index pointer along with it — otherwise a later plain Up/Down would
    // step from the now-stale pre-move index instead of continuing from
    // where the song just landed.
    if (row.dataset.songFile && row.dataset.songFile === ctx.state.currentSongFile) {
      ctx.nav.selectSetlistSong(row.dataset.songFile, target);
    }
    persistOrder(personalId, draggableRows().map((r) => Number(r.dataset.setlistIndex)));
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
    const renameBtn = byId("setlistRenameBtn");
    if (!titleText || !nameInput) return;

    const enterEdit = () => {
      if (!ctx.state.currentPersonalId) return;
      nameInput.value = titleText.textContent;
      titleText.hidden = true;
      if (renameBtn) renameBtn.hidden = true;
      nameInput.hidden = false;
      nameInput.focus();
      nameInput.select();
    };
    const leaveEdit = () => {
      nameInput.hidden = true;
      titleText.hidden = false;
      if (renameBtn) renameBtn.hidden = false;
    };
    const commit = () => {
      if (!ctx.state.currentPersonalId) return;
      renamePersonalSetlist(
        ctx.storage(), ctx.state.currentPersonalId, nameInput.value.trim() || "Untitled setlist",
      );
      refreshOpenPersonal();
    };

    titleText.addEventListener("dblclick", enterEdit);
    if (renameBtn) renameBtn.addEventListener("click", enterEdit);
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

  // Alt+Up/Alt+Down anywhere inside an open personal setlist's row (title
  // button, divider input, drag handle) reorders that row instead of falling
  // through to song navigation.
  function moveFocusedRowOnAltArrow(e) {
    if (ctx.state.setlistsView !== "open" || !ctx.state.currentPersonalId) return false;
    const target = e.target;
    const row = target && target.closest && target.closest(".setlist-song-row, .setlist-divider-row");
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

  // "Listen" button, under the Print row: opens every song in the open
  // setlist that has a YouTube F: link as one ad-hoc YouTube playlist (see
  // lib/setlist-listen.js). Its enabled state tracks ctx.setlistPrint's own
  // per-song reads (already fetching every setlist song's .abc to build the
  // print booklet), so it's never clickable mid-load or with nothing to play.
  function initListen() {
    const btn = byId("listenYoutubeBtn");
    if (!btn) return;
    ctx.setlistPrint.setListenChangeHandler((url) => {
      btn.disabled = !url;
      btn.title = url ? "Open this setlist’s songs on YouTube" : "No YouTube links in this setlist";
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
