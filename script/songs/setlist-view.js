import { byId, el, qsa, clear, on } from "../lib/dom.js";
import { isSetlistDivider } from "../lib/setlist-format.js";
import { walkSetlist } from "../lib/setlist-walk.js";
import { filterSongsByQuery } from "../lib/song-index.js";
import {
  extractKeyFromAbc, setlistTransposeSteps, formatSetlistKeyLabel,
} from "../lib/music-theory.js";
import {
  getPersonalSetlist,
  renamePersonalSetlist,
  addSongToPersonalSetlist,
  removeSongFromPersonalSetlist,
  updateSongKeyInPersonalSetlist,
  addDividerToPersonalSetlist,
  updateDividerLabelInPersonalSetlist,
  setPersonalSetlistOrder,
  exportPersonalSetlistText,
} from "../lib/setlists-store.js";

const emptyRow = (text) => el("div", { class: "song-list-empty", text });
const setHeaderRow = (text) => el("div", { class: "song-list-letter setlist-set-heading", text });

// Semitone-override value (what personal setlists store) -> the digits shown in
// the stepper: blank for none, and blank for a legacy key-name override the
// number field can't represent (the stored value is left intact until a number
// is set).
function semitoneFieldValue(raw) {
  const trimmed = String(raw == null ? "" : raw).trim();
  return /^[+-]?\d+$/.test(trimmed) && Number.parseInt(trimmed, 10) !== 0
    ? String(Number.parseInt(trimmed, 10))
    : "";
}

// What a semitone <input> should persist as its override: "" unless the user
// typed a whole number in the field's -12..12 range (HTML min/max/step don't
// gate a change handler, so "1.5" or "40" reach us verbatim).
function semitoneOverride(rawValue) {
  const trimmed = String(rawValue == null ? "" : rawValue).trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return "";
  const n = Number(trimmed);
  return Number.isInteger(n) && n !== 0 && n >= -12 && n <= 12 ? String(n) : "";
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  let addSongQuery = "";
  let addSongActiveIndex = -1; // keyboard-highlighted add-song result, -1 = none
  let focusAddSongAfterRender = false;
  let focusHandleAfterRender = null; // draggable-row index to re-focus after a keyboard nudge
  let rowDrag = null;
  let songLoadSeq = 0; // bumped per song open; a stale XHR callback checks it before rendering

  // ---- opening -----------------------------------------------------

  // Opening a *different* setlist drops the pointer to whatever song was last
  // on the sheet — otherwise a stale currentSongFile / currentSetlistSongIndex
  // gets serialised into the hash and can spuriously highlight a row in the
  // new list. A caller that means to open a specific song sets them again
  // right after (via its afterRender hook).
  function clearOpenSongPointer() {
    ctx.state.currentSongFile = null;
    ctx.state.currentSetlistSongIndex = null;
  }

  function openBand(file, fallbackName, afterRender) {
    ctx.setlistData.loadBand(file, (setlist) => {
      ctx.state.currentPersonalId = null;
      ctx.state.currentSetlistId = String(file).replace(/\.txt$/, "");
      clearOpenSongPointer();
      renderOpen(setlist.name || fallbackName, setlist.songs, null, setlist.desc);
      if (afterRender) afterRender();
    }, (status) => {
      console.warn(`Could not load setlist ${file} (status ${status})`);
    });
  }

  function openPersonal(id, afterRender) {
    const entry = getPersonalSetlist(ctx.storage(), id);
    if (!entry) return;
    ctx.state.currentPersonalId = id;
    ctx.state.currentSetlistId = id;
    clearOpenSongPointer();
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
  }

  // ---- row controls (personal) ----------------------------------

  function appendRowControls(row, personalEntry) {
    const handle = el("button", {
      type: "button",
      class: "setlist-drag-handle",
      title: "Drag to reorder",
      html: '<span class="fa-solid fa-grip-vertical" aria-hidden="true"></span>',
      attrs: { "aria-label": "Reorder — drag, or use the arrow keys" },
      on: {
        pointerdown: (e) => beginRowDrag(e, handle, row, personalEntry.id),
        keydown: (e) => {
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            removeRow(row, personalEntry.id);
            return;
          }
          let step = 0;
          if (e.key === "ArrowUp") step = -1;
          else if (e.key === "ArrowDown") step = 1;
          if (!step) return;
          e.preventDefault();
          nudgeRow(row, personalEntry.id, step);
        },
      },
    });
    row.insertBefore(handle, row.firstChild);

    row.append(el("button", {
      type: "button",
      class: "setlist-song-btn setlist-song-remove",
      text: "×",
      title: "Remove",
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

  function semitoneField(song, index, personalEntry) {
    return el("input", {
      type: "number",
      class: "setlist-song-semitones",
      min: "-12",
      max: "12",
      step: "1",
      placeholder: "0",
      title: "Transpose, in semitones",
      value: semitoneFieldValue(song.key),
      attrs: { "aria-label": `Transpose ${ctx.songName(song.file)}, in semitones` },
      on: {
        change: (e) => {
          const stored = semitoneOverride(e.target.value);
          updateSongKeyInPersonalSetlist(ctx.storage(), personalEntry.id, index, stored);
          refreshOpenPersonal();
        },
      },
    });
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
        on: { click: () => openSetlistSong(song, index) },
      }),
    ]);

    if (personalEntry) {
      row.append(semitoneField(song, index, personalEntry));
      appendRowControls(row, personalEntry);
    } else {
      const badge = formatSetlistKeyLabel(song.key);
      if (badge) row.append(el("span", { class: "setlist-song-key-badge", text: badge }));
    }
    return row;
  }

  // ---- render ------------------------------------------------

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

  function renderOpen(name, songs, personalEntry, desc) {
    ctx.state.setlistsView = "open";
    ctx.state.currentOpenSongs = songs;
    ctx.state.currentOpenSetlistName = name;
    ctx.state.currentOpenSetlistDesc = desc || "";

    const isPersonal = Boolean(personalEntry);
    if (!isPersonal) addSongQuery = "";

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
      listEl.append(buildAddSongRow());
      restoreFocusAfterRender(listEl);
    }

    ctx.setlistPrint.buildBooklet(name, songs, desc);
    highlightCurrent();
    if (ctx.syncHash) ctx.syncHash();
  }

  function restoreFocusAfterRender(listEl) {
    if (focusAddSongAfterRender) {
      focusAddSongAfterRender = false;
      const addSearch = byId("setlistAddSongSearch");
      if (addSearch) {
        addSearch.value = addSongQuery;
        addSearch.focus();
        if (addSongQuery) {
          ctx.setlistData.ensureSongsLoaded(
            () => renderAddSongResults(addSongQuery), showAddSongError,
          );
        }
      }
    }
    if (focusHandleAfterRender != null) {
      const handles = listEl.querySelectorAll(".setlist-drag-handle");
      if (handles[focusHandleAfterRender]) handles[focusHandleAfterRender].focus();
      focusHandleAfterRender = null;
    }
  }

  // ---- drag / keyboard reorder --------------------------------

  function draggableRows() {
    const listEl = byId("songList");
    return listEl
      ? Array.from(listEl.querySelectorAll(".setlist-song-row, .setlist-divider-row"))
      : [];
  }

  // Rewrite the number badges / "Set N" placeholders straight from current DOM
  // order — used mid-drag, before any re-render. Mirrors walkSetlist: numbers
  // restart each set when the list has any dividers, else run 1..n.
  function renumberOpen() {
    const listEl = byId("songList");
    if (!listEl) return;
    const rows = qsa(".setlist-song-row, .setlist-divider-row, .setlist-set-heading", listEl);
    const hasDividers = listEl.querySelector(".setlist-divider-row, .setlist-set-heading") != null;
    let n = 0;
    let songInSet = 0;
    let setNumber = 1;
    rows.forEach((row) => {
      if (row.classList.contains("setlist-song-row")) {
        n += 1;
        songInSet += 1;
        const numEl = row.querySelector(".setlist-song-number");
        if (numEl) numEl.textContent = String(hasDividers ? songInSet : n);
        return;
      }
      songInSet = 0;
      if (row.classList.contains("setlist-divider-row")) {
        setNumber += 1;
        const input = row.querySelector(".setlist-divider-input");
        if (input) input.placeholder = `Set ${setNumber}`;
      }
    });
  }

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
        focusAddSongAfterRender = true;
      }
    }
    refreshOpenPersonal();
  }

  function nudgeRow(row, personalId, step) {
    const rows = draggableRows();
    const from = rows.indexOf(row);
    const to = from + step;
    if (from === -1 || to < 0 || to >= rows.length) return;
    const order = rows.map((_row, i) => i);
    order.splice(from, 1);
    order.splice(to, 0, from);
    focusHandleAfterRender = to;
    persistOrder(personalId, order.map((i) => Number(rows[i].dataset.setlistIndex)));
  }

  function beginRowDrag(e, handle, row, personalId) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    rowDrag = { personalId, row, moved: false };
    row.classList.add("setlist-row-dragging");
    document.body.classList.add("setlist-dragging");
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // pointer capture is a nice-to-have; the window listeners still fire.
    }
    window.addEventListener("pointermove", onRowDragMove);
    window.addEventListener("pointerup", endRowDrag, { once: true });
    window.addEventListener("pointercancel", endRowDrag, { once: true });
  }

  function onRowDragMove(e) {
    if (!rowDrag) return;
    const dragged = rowDrag.row;
    const others = draggableRows().filter((r) => r !== dragged);
    if (others.length === 0) return;

    let before = null;
    for (const other of others) {
      const box = other.getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) {
        before = other;
        break;
      }
    }
    const anchor = before || others[others.length - 1].nextSibling;
    if (anchor !== dragged && dragged.nextSibling !== anchor) {
      dragged.parentNode.insertBefore(dragged, anchor);
      rowDrag.moved = true;
      renumberOpen();
    }
  }

  function endRowDrag() {
    window.removeEventListener("pointermove", onRowDragMove);
    if (!rowDrag) return;
    const drag = rowDrag;
    rowDrag = null;
    drag.row.classList.remove("setlist-row-dragging");
    document.body.classList.remove("setlist-dragging");
    if (!drag.moved) return;
    persistOrder(
      drag.personalId,
      draggableRows().map((r) => Number(r.dataset.setlistIndex)),
    );
  }

  // ---- opening a song from the list -------------------------

  function openSetlistSong(song, index) {
    ctx.state.currentSongFile = song.file;
    ctx.state.currentSetlistSongIndex = index == null ? null : Number(index);
    ctx.setSheetBackLabel("Setlist");
    if (ctx.syncHash) ctx.syncHash();
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
    if (idx === -1) return false;
    openSetlistSong(songs[idx], idx);
    const row = byId("songList")
      && byId("songList").querySelector(`.setlist-song-row[data-setlist-index="${idx}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
    return true;
  }

  // Open the previous / next song of the open setlist, skipping break dividers
  // and clamping at both ends.
  function stepSong(dir) {
    const songs = ctx.state.currentOpenSongs;
    if (ctx.state.setlistsView !== "open" || !songs || !songs.length) return;
    const songIndexes = [];
    songs.forEach((item, i) => {
      if (!isSetlistDivider(item)) songIndexes.push(i);
    });
    if (!songIndexes.length) return;

    const pos = songIndexes.indexOf(ctx.state.currentSetlistSongIndex);
    let next;
    if (pos === -1) {
      next = dir > 0 ? songIndexes[0] : songIndexes[songIndexes.length - 1];
    } else {
      const np = pos + dir;
      if (np < 0 || np >= songIndexes.length) return;
      next = songIndexes[np];
    }

    openSetlistSong(songs[next], next);
    const row = byId("songList")
      && byId("songList").querySelector(`.setlist-song-row[data-setlist-index="${next}"]`);
    if (row) row.scrollIntoView({ block: "nearest" });
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

  // ---- add-song / add-break tray --------------------------

  function showAddSongError() {
    const resultsEl = byId("setlistAddSongResults");
    if (!resultsEl) return;
    clear(resultsEl);
    resultsEl.classList.add("is-open");
    resultsEl.append(el("div", {
      class: "rj-library-add-song-empty",
      text: "Couldn’t load the song list — try again in a moment.",
    }));
  }

  // Top matches for an add-song query (empty query -> no matches).
  function addSongMatches(query) {
    return query ? filterSongsByQuery(ctx.state.allSongs, query).slice(0, 8) : [];
  }

  // Append one song to the open personal setlist, then clear the search and
  // keep it focused so the next title can be typed straight away.
  function addSongByFile(file) {
    if (!ctx.state.currentPersonalId) return false;
    addSongToPersonalSetlist(ctx.storage(), ctx.state.currentPersonalId, { file, key: "" });
    addSongQuery = "";
    focusAddSongAfterRender = true;
    refreshOpenPersonal();
    return true;
  }

  function addSongResultButtons() {
    const resultsEl = byId("setlistAddSongResults");
    return resultsEl
      ? Array.from(resultsEl.querySelectorAll(".rj-library-add-song-result"))
      : [];
  }

  // Paint the keyboard highlight on the active result and scroll it into view.
  function highlightAddSongActive() {
    const buttons = addSongResultButtons();
    buttons.forEach((btn, i) => btn.classList.toggle("is-active", i === addSongActiveIndex));
    const active = buttons[addSongActiveIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  // Step the highlight through the results with the Up/Down arrows, wrapping
  // at both ends; the first press from "nothing selected" lands on an end.
  function moveAddSongActive(dir) {
    const count = addSongResultButtons().length;
    if (!count) return;
    if (addSongActiveIndex === -1) addSongActiveIndex = dir > 0 ? 0 : count - 1;
    else addSongActiveIndex = (addSongActiveIndex + dir + count) % count;
    highlightAddSongActive();
  }

  function renderAddSongResults(query) {
    const resultsEl = byId("setlistAddSongResults");
    if (!resultsEl) return;
    addSongActiveIndex = -1;
    clear(resultsEl);
    resultsEl.classList.toggle("is-open", Boolean(query));
    if (!query) return;

    const matches = addSongMatches(query);
    if (matches.length === 0) {
      resultsEl.append(el("div", {
        class: "rj-library-add-song-empty",
        text: `No songs match “${query}”`,
      }));
      return;
    }
    matches.forEach((song) => {
      resultsEl.append(el("button", {
        type: "button",
        class: "rj-library-add-song-result",
        html: '<span class="fa-solid fa-plus" aria-hidden="true"></span>',
        on: { click: () => addSongByFile(song.file) },
      }, el("span", { class: "rj-library-add-song-result-name", text: song.name })));
    });
  }

  // Enter adds the arrow-highlighted result, or — mirroring the library
  // search — the lone match when nothing is highlighted, then clears the
  // field. Always clears, match or not.
  function submitAddSong(inputEl) {
    const matches = addSongMatches(addSongQuery);
    let chosen = null;
    if (addSongActiveIndex >= 0) chosen = matches[addSongActiveIndex];
    else if (matches.length === 1) chosen = matches[0];
    addSongQuery = "";
    inputEl.value = "";
    renderAddSongResults("");
    if (chosen) addSongByFile(chosen.file);
  }

  function buildAddSongRow() {
    // With the field empty there are no results to walk, so the arrows leave
    // the tray: Up jumps back into the setlist (its last row), Down drops
    // onto the "Add a set break" button.
    function focusAdjacentOnEmptyArrow(key) {
      if (key === "ArrowDown") {
        breakBtn.focus();
        return;
      }
      const handles = byId("songList")
        ? byId("songList").querySelectorAll(".setlist-drag-handle")
        : [];
      const last = handles[handles.length - 1];
      if (last) last.focus();
    }

    function handleAddSongArrowKey(e) {
      e.preventDefault();
      if (!e.target.value.trim()) {
        focusAdjacentOnEmptyArrow(e.key);
        return;
      }
      const move = () => moveAddSongActive(e.key === "ArrowDown" ? 1 : -1);
      ctx.setlistData.ensureSongsLoaded(move, move);
    }

    const search = el("input", {
      type: "search",
      id: "setlistAddSongSearch",
      placeholder: "Search songs to add…",
      autocomplete: "off",
      on: {
        input: (e) => {
          addSongQuery = e.target.value.trim();
          ctx.setlistData.ensureSongsLoaded(
            () => renderAddSongResults(addSongQuery), showAddSongError,
          );
        },
        keydown: (e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            handleAddSongArrowKey(e);
            return;
          }
          if (e.key !== "Enter") return;
          e.preventDefault();
          const submit = () => submitAddSong(e.target);
          ctx.setlistData.ensureSongsLoaded(submit, submit);
        },
      },
    });

    const inputWrap = el("div", {
      class: "rj-library-add-song-inputwrap",
      html: '<span class="fa-solid fa-magnifying-glass" aria-hidden="true"></span>',
    });
    inputWrap.append(search);
    inputWrap.append(el("kbd", {
      class: "rj-search-hint", text: "/", attrs: { "aria-hidden": "true" },
    }));

    const results = el("div", {
      id: "setlistAddSongResults",
      class: "rj-library-add-song-results",
    });

    const breakBtn = el("button", {
      type: "button",
      class: "rj-library-add-break",
      html: '<span class="fa-solid fa-plus" aria-hidden="true"></span>'
        + '<span class="rj-library-add-break-label">Add a set break</span>',
      on: {
        click: () => {
          if (!ctx.state.currentPersonalId) return;
          addDividerToPersonalSetlist(ctx.storage(), ctx.state.currentPersonalId);
          refreshOpenPersonal();
        },
      },
    });

    return el("div", { class: "rj-library-add-song rj-library-add-song-inline" }, [
      el("div", { class: "rj-library-add-label", text: "Add to setlist" }),
      el("div", { class: "rj-library-add-song-field" }, [inputWrap, results]),
      breakBtn,
    ]);
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

  // A field (or a drag handle) that wants the arrow keys for itself.
  function ownsArrowKeys(target) {
    if (!target) return false;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return true;
    if (target.isContentEditable) return true;
    return Boolean(target.closest && target.closest(".setlist-drag-handle"));
  }

  function initArrowNav() {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (ctx.state.setlistsView !== "open" || ownsArrowKeys(e.target)) return;
      e.preventDefault();
      stepSong(e.key === "ArrowDown" ? 1 : -1);
    });
  }

  function initTransposeWriteBack() {
    on("transpose", "input", () => {
      const { currentPersonalId, currentSetlistSongIndex, currentOpenSongs } = ctx.state;
      if (ctx.state.setlistsView !== "open" || !currentPersonalId) return;
      if (currentSetlistSongIndex == null || !currentOpenSongs) return;
      const song = currentOpenSongs[currentSetlistSongIndex];
      if (!song || isSetlistDivider(song) || song.file !== ctx.state.currentSongFile) return;
      const n = Number.parseInt(byId("transpose").value, 10);
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
      const text = exportPersonalSetlistText(ctx.storage(), ctx.state.currentPersonalId);
      if (!text) return;
      const filename = `${(entry.name || "setlist").toLowerCase().replace(/[^a-z0-9]+/g, "_")}.txt`;
      downloadText(filename, text);
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

    // The booklet is engraved for whichever instrument the sheet is on; rebuild
    // it off-screen when the instrument changes so a later "Print …" is current.
    on("instrument", "change", () => {
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
    highlightCurrent, stepSong, openSongInOpenSetlist, initControls,
  };
}
