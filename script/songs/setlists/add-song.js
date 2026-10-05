import {
  byId, el, qsa, clear,
} from "../../lib/core/dom.js";
import { filterSongsByQuery } from "../../lib/core/song-index.js";
import {
  addSongToPersonalSetlist,
  addDividerToPersonalSetlist,
  insertItemInPersonalSetlist,
} from "../../lib/setlists/setlists-store.js";

/*
  The "Add to setlist" tray at the foot of an open personal setlist: a
  search-to-add field whose matches open below it (arrow keys walk them,
  Enter or a click adds one, the field clears but keeps focus for the next
  title), and a "New set" button. A set's own "Add song" row aims the next add at
  the end of that set (`targetEnd`) instead of the end of the list. `refresh()` re-renders the open
  setlist after a change; the tray re-focuses itself afterwards when asked to
  (restoreFocus).
*/
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

function addSongResultButtons() {
  const resultsEl = byId("setlistAddSongResults");
  return resultsEl
    ? Array.from(resultsEl.querySelectorAll(".rj-library-add-song-result"))
    : [];
}

// With the field empty there are no results to walk, so the arrows leave
// the tray: Up jumps back into the setlist (its last row's title — never
// the drag handle, which is a pointer-drag target only, not an arrow-key
// stop), Down drops onto the "New set" button.
function focusAdjacentOnEmptyArrow(key) {
  if (key === "ArrowDown") {
    const newSet = byId("songList").querySelector(".rj-library-add-break");
    if (newSet) newSet.focus();
    return;
  }
  const rows = qsa(".setlist-song-title, .setlist-divider-input", byId("songList"));
  const last = rows[rows.length - 1];
  if (last) last.focus();
}

export function createAddSongTray(ctx, { refresh, onInsert }) {
  let addSongQuery = "";
  let addSongActiveIndex = -1; // keyboard-highlighted add-song result, -1 = none
  let focusAfterRender = false;
  let insertAt = null; // item index the next added song lands at; null = end of list

  // Top matches for an add-song query (empty query -> no matches).
  function addSongMatches(query) {
    return query ? filterSongsByQuery(ctx.state.allSongs, query).slice(0, 8) : [];
  }

  // Append one song to the open personal setlist, then clear the search and
  // keep it focused so the next title can be typed straight away.
  function addSongByFile(file) {
    if (!ctx.state.currentPersonalId) return false;
    const song = { file, key: "" };
    if (insertAt === null) {
      addSongToPersonalSetlist(ctx.storage(), ctx.state.currentPersonalId, song);
    } else {
      insertItemInPersonalSetlist(ctx.storage(), ctx.state.currentPersonalId, insertAt, song);
      if (onInsert) onInsert(insertAt);
      insertAt += 1; // the next title typed goes right after this one
    }
    addSongQuery = "";
    focusAfterRender = true;
    refresh();
    return true;
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
  // search — the top match when nothing is highlighted, then clears the
  // field. Always clears, match or not.
  function submitAddSong(inputEl) {
    const matches = addSongMatches(addSongQuery);
    let chosen = null;
    if (addSongActiveIndex >= 0) chosen = matches[addSongActiveIndex];
    else if (matches.length > 0) chosen = matches[0];
    addSongQuery = "";
    inputEl.value = "";
    renderAddSongResults("");
    if (chosen) addSongByFile(chosen.file);
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

  // `label` is the field's resting text, the same wording as a set's own
  // "Add song to set N" row so the two read as one control.
  function buildAddSongRow(label) {
    const search = el("input", {
      type: "search",
      id: "setlistAddSongSearch",
      placeholder: label,
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
      html: '<span class="fa-solid fa-plus" aria-hidden="true"></span>',
    });
    inputWrap.append(search);
    inputWrap.append(el("kbd", {
      class: "rj-search-hint", text: "/", attrs: { "aria-hidden": "true" },
    }));

    const results = el("div", {
      id: "setlistAddSongResults",
      class: "rj-library-add-song-results",
    });

    return el("div", { class: "rj-library-add-song rj-library-add-song-inline" }, [
      el("div", { class: "rj-library-add-song-field" }, [inputWrap, results]),
    ]);
  }

  // The "New set" button that closes the list, after every set box.
  function buildNewSetButton() {
    return el("button", {
      type: "button",
      class: "rj-library-add-break",
      html: '<span class="fa-solid fa-plus" aria-hidden="true"></span>'
        + '<span class="rj-library-add-break-label">New set</span>',
      on: {
        click: () => {
          if (!ctx.state.currentPersonalId) return;
          addDividerToPersonalSetlist(ctx.storage(), ctx.state.currentPersonalId);
          insertAt = null;
          refresh();
        },
      },
    });
  }

  // After a re-render: put focus (and the query in progress) back in the
  // search field, when the change came from the tray or emptied the list.
  function restoreFocus() {
    if (!focusAfterRender) return;
    focusAfterRender = false;
    const addSearch = byId("setlistAddSongSearch");
    if (!addSearch) return;
    addSearch.value = addSongQuery;
    addSearch.focus();
    if (addSongQuery) {
      ctx.setlistData.ensureSongsLoaded(() => renderAddSongResults(addSongQuery), showAddSongError);
    }
  }

  return {
    build: buildAddSongRow,
    buildNewSet: buildNewSetButton,
    // Item index the next add lands at, or null for the end of the list.
    target: () => insertAt,
    addSongByFile,
    restoreFocus,
    // Focus the search field after the next re-render.
    focusAfterRender: () => { focusAfterRender = true; },
    // A band setlist has no tray: forget any query in progress.
    reset: () => { addSongQuery = ""; insertAt = null; },
    // Aim the next added song at item index `index` (the end of one set): the
    // re-render moves the search field into that set and focuses it.
    targetEnd: (index) => {
      insertAt = index;
      focusAfterRender = true;
      refresh();
    },
    clearTarget: () => { insertAt = null; },
  };
}
