import { byId, el, clear } from "../lib/dom.js";
import {
  groupSongsByLetter, filterSongsByQuery, songTitleSlug,
} from "../lib/song-index.js";

function renderRail(railEl, groups) {
  clear(railEl);
  groups.forEach((group) => {
    railEl.append(el("button", {
      type: "button",
      text: group.letter,
      title: `Jump to ${group.letter}`,
      on: {
        click() {
          const target = byId(`letter-${group.letter}`);
          if (!target) return;
          const list = byId("songList");
          // On narrow layouts the list isn't the scroll container (the page
          // is), so scrolling its scrollTop does nothing — scroll the target
          // into view instead.
          const listScrolls = list && list.scrollHeight > list.clientHeight + 1;
          if (!listScrolls) {
            target.scrollIntoView({ block: "start" });
            return;
          }
          // The letter headings are position: sticky, so a rect / offsetTop
          // read reports a heading's *stuck* position. Resetting scrollTop to
          // 0 first unsticks every heading, making the offsetTop read honest.
          list.scrollTop = 0;
          list.scrollTop = target.offsetTop;
        },
      },
    }));
  });
}

// Returns true when it opened a row (so the caller suppresses the default).
function handleEnter(searchInput, rows) {
  const isSearching = searchInput.value.trim().length > 0;
  let target = rows.find((r) => r.classList.contains("kbd-active"));
  if (!target && isSearching && rows.length === 1) [target] = rows;
  if (!target) return false;
  // The row's own click handler clears the search when one is active.
  target.click();
  // Drop focus so Spacebar plays the song straight away instead of typing.
  searchInput.blur();
  return true;
}

// The row for the currently-open song, preferring the remembered index (a
// song can appear more than once in the index, so matching by file alone
// would always land on its first occurrence) but falling back to a file+name
// lookup when the list has moved on since (e.g. clearing a search re-renders
// the filtered list into the full grouped one, at completely different
// positions — the stored index from before then points at an unrelated row),
// and finally to a plain file lookup when the remembered name doesn't match
// anything either — currentSongFile can change through paths that don't
// update currentLibrarySongName (a deep link, a setlist song, swipe-nav), so
// a stale name must never make this resolve to nothing.
function currentSongRowIndex(rows, ctx) {
  if (!ctx.state.currentSongFile) return -1;
  const stored = ctx.state.currentLibraryIndex;
  const storedName = ctx.state.currentLibrarySongName;
  const matchesFile = (row) => row.dataset.songFile === ctx.state.currentSongFile;
  const matchesIdentity = (row) => matchesFile(row) && row.dataset.songName === storedName;
  if (stored !== null && rows[stored] && matchesFile(rows[stored])
    && (storedName === undefined || rows[stored].dataset.songName === storedName)) {
    return stored;
  }
  if (storedName !== undefined) {
    const byIdentity = rows.findIndex(matchesIdentity);
    if (byIdentity >= 0) return byIdentity;
  }
  return rows.findIndex(matchesFile);
}

function moveHighlight(rows, delta, fromEnd, ctx) {
  let current = rows.findIndex((r) => r.classList.contains("kbd-active"));
  // No highlight yet (e.g. the last action was a mouse click, not an arrow
  // key) — start from the currently-open song instead of snapping to an end.
  if (current < 0) current = currentSongRowIndex(rows, ctx);
  let next;
  if (current < 0) next = fromEnd ? rows.length - 1 : 0;
  else next = Math.min(Math.max(current + delta, 0), rows.length - 1);
  rows.forEach((r) => r.classList.remove("kbd-active"));
  const row = rows[next];
  if (row) {
    row.classList.add("kbd-active");
    row.scrollIntoView({ block: "nearest" });
  }
}

/*
  The Library tab: a search-first list of every lead sheet with an A–Z scroll
  rail. Picking a song renders it into the shared sheet. Up/Down arrow keys
  rove a highlight through the results while the caret stays in the search box,
  so you can type, arrow and hit Enter without leaving the keyboard.
*/
export function createLibraryTab(ctx) {
  function clearSearchIfActive() {
    const searchInput = byId("songSearch");
    if (!searchInput || searchInput.value.trim().length === 0) return;
    searchInput.value = "";
    render("");
  }

  function buildSongRow(song) {
    const slug = songTitleSlug(song);
    return el("a", {
      class: "song-list-item",
      href: `#s=${slug}`,
      text: song.name,
      dataset: { songFile: song.file, songName: song.name },
      on: {
        click(e) {
          e.preventDefault();
          // The exact row, not the song file, is the source of truth: a song
          // can appear more than once in the index, so matching by file would
          // always resolve to its first occurrence.
          ctx.state.currentLibraryIndex = libraryRows().indexOf(e.currentTarget);
          ctx.state.currentLibrarySongName = song.name;
          ctx.openLibrarySong(song);
          clearSearchIfActive();
        },
      },
    });
  }

  function render(query) {
    const listEl = byId("songList");
    const railEl = byId("songRail");
    const filtered = filterSongsByQuery(ctx.state.allSongs, query);
    clear(listEl);

    if (query.trim().length > 0) {
      if (filtered.length === 0) {
        listEl.append(el("div", { class: "song-list-empty", text: "No songs match your search." }));
      } else {
        filtered.forEach((song) => listEl.append(buildSongRow(song)));
      }
      if (railEl) clear(railEl);
      return;
    }

    const groups = groupSongsByLetter(filtered);
    groups.forEach((group) => {
      listEl.append(el("div", {
        class: "song-list-letter",
        id: `letter-${group.letter}`,
        text: group.letter,
      }));
      group.items.forEach((song) => listEl.append(buildSongRow(song)));
    });
    if (railEl) renderRail(railEl, groups);
  }

  // ---- keyboard navigation ------------------------------------------

  function libraryRows() {
    if (ctx.state.activeTab !== "library") return [];
    const list = byId("songList");
    return list ? Array.from(list.querySelectorAll("a.song-list-item")) : [];
  }

  // Open the song before / after the current one in the rendered list — the
  // touch swipe's counterpart to roving with the arrow keys. Clamps at both
  // ends; a no-op when no library song is open or the list has moved on.
  //
  // Steps from the remembered row index, not a lookup by file name: the same
  // song can appear more than once in the index (an alternate title, say), so
  // matching by file would always land back on its first occurrence and never
  // advance past it. The stored index is only trusted while it still points
  // at a row for the current song — a stale index (the list was re-filtered
  // since) falls back to the first matching row, same as before.
  function stepLibrarySong(dir) {
    if (!ctx.state.currentSongFile) return;
    const rows = libraryRows();
    if (!rows.length) return;
    const current = currentSongRowIndex(rows, ctx);
    if (current < 0) return;
    const next = current + dir;
    if (next < 0 || next >= rows.length) return;
    ctx.state.currentLibraryIndex = next;
    ctx.state.currentLibrarySongName = rows[next].dataset.songName;
    rows[next].click();
    // On the narrow layout the sidebar (and this row with it) is display:none
    // once a sheet is open — scrollIntoView on an element with no box makes
    // some browsers fall back to scrolling the document itself to (0,0),
    // i.e. the whole page jumps to the top. offsetParent is null exactly
    // when the row has no layout box, so skip the scroll in that case.
    if (rows[next].offsetParent) rows[next].scrollIntoView({ block: "nearest" });
  }

  function initKeyNav(searchInput) {
    document.addEventListener("keydown", (e) => {
      if (ctx.state.activeTab !== "library") return;
      if (!["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
      const inField = e.target === searchInput
        || (e.target && e.target.closest && e.target.closest("#songList"));
      if (!inField) return;
      const rows = libraryRows();
      if (!rows.length) return;

      if (e.key === "Enter") {
        if (handleEnter(searchInput, rows)) e.preventDefault();
        return;
      }
      e.preventDefault();
      moveHighlight(rows, e.key === "ArrowDown" ? 1 : -1, e.key === "ArrowUp", ctx);
    });
  }

  function init() {
    const searchInput = byId("songSearch");
    if (!searchInput) return;

    searchInput.addEventListener("input", () => render(searchInput.value));

    // "/" focuses the search box, unless the caret is already in a field. On
    // the Setlists tab it drives that tab's add-song search when one is open.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const addSong = ctx.state.activeTab === "setlists"
        && document.getElementById("setlistAddSongSearch");
      const field = addSong || searchInput;
      if (!addSong && ctx.state.activeTab !== "library") ctx.switchTab("library");
      e.preventDefault();
      field.focus();
      field.select();
    });

    initKeyNav(searchInput);
  }

  return { render, init, stepLibrarySong };
}
