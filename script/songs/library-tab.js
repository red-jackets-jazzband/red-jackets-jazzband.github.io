import { byId, el, clear } from "../lib/dom.js";
import {
  groupSongsByLetter, filterSongsByQuery, songTitleSlug,
} from "../lib/song-index.js";

/*
  The Library tab: a search-first list of every lead sheet with an A–Z scroll
  rail. Picking a song renders it into the shared sheet. Up/Down arrow keys
  rove a highlight through the results while the caret stays in the search box,
  so you can type, arrow and hit Enter without leaving the keyboard.
*/
export function createLibraryTab(ctx) {
  function buildSongRow(song) {
    const slug = songTitleSlug(song);
    return el("a", {
      class: "song-list-item",
      href: `#s=${slug}`,
      text: song.name,
      on: {
        click(e) {
          e.preventDefault();
          ctx.openLibrarySong(song);
        },
      },
    });
  }

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
            const list = byId("songList");
            if (!target) return;
            if (!list) {
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

  function moveHighlight(rows, delta, fromEnd) {
    const current = rows.findIndex((r) => r.classList.contains("kbd-active"));
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

  // Returns true when it opened a row (so the caller suppresses the default).
  function handleEnter(searchInput, rows) {
    const isSearching = searchInput.value.trim().length > 0;
    let target = rows.find((r) => r.classList.contains("kbd-active"));
    if (!target && isSearching && rows.length === 1) [target] = rows;
    if (!target) return false;
    target.click();
    if (isSearching) {
      searchInput.value = "";
      render("");
    }
    // Drop focus so Spacebar plays the song straight away instead of typing.
    searchInput.blur();
    return true;
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
      moveHighlight(rows, e.key === "ArrowDown" ? 1 : -1, e.key === "ArrowUp");
    });
  }

  function init() {
    const searchInput = byId("songSearch");
    if (!searchInput) return;

    searchInput.addEventListener("input", () => render(searchInput.value));

    // "/" focuses the search box, unless the caret is already in a field.
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (ctx.state.activeTab !== "library") ctx.switchTab("library");
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    });

    initKeyNav(searchInput);
  }

  return { render, init };
}
