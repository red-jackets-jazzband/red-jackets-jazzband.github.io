import { byId, qsa } from "../lib/dom.js";
import { safeStorage } from "../lib/preferences.js";
import { parseSongIndex, songTitleSlug } from "../lib/song-index.js";
import { songFileFromHash } from "../lib/song-hash.js";
import { humanizeSongFile } from "../lib/filename.js";
import { readFile } from "./read-file.js";
import { createAudioPlayer } from "./audio-player.js";
import { createSheet } from "./sheet.js";
import { createInspiration } from "./inspiration.js";
import { initSheetControls } from "./sheet-controls.js";
import { createInstrumentDropdown, createCompingDropdown } from "./selects.js";
import { createLibraryTab } from "./library-tab.js";
import { createSetlistData } from "./setlist-data.js";
import { createSetlistHome } from "./setlist-home.js";
import { createSetlistModal } from "./setlist-modal.js";
import { createSetlistPrint } from "./setlist-print.js";
import { createSetlistView } from "./setlist-view.js";
import { createSwipeNav } from "./swipe-nav.js";

/*
  Composition root for the songs page. Builds one shared `ctx` (mutable state +
  cross-module methods), instantiates every module against it, then wires and
  bootstraps. Modules reach each other only through `ctx`, never by importing
  one another, so the wiring order below is the whole dependency graph.
*/
function createApp() {
  const ctx = {
    state: {
      allSongs: [],
      allSongsLoaded: false,
      setlistIndex: [],
      activeTab: "library", // "library" | "setlists"
      setlistsView: "home", // "home" | "open"
      currentPersonalId: null,
      currentOpenSongs: null,
      currentOpenSetlistName: "",
      currentOpenSetlistDesc: "",
      currentSongFile: null,
      currentSetlistSongIndex: null,
      currentSongText: undefined, // clef-adjusted ABC currently on the sheet
      compingActive: false,
      tempoOverrideBpm: null,
    },
    readFile,
    storage: safeStorage,
  };

  ctx.songName = (file) => {
    const match = ctx.state.allSongs.find((song) => song.file === file);
    return match ? match.name : humanizeSongFile(file);
  };

  // The mobile "back" button leaves the sheet for whichever sidebar list you
  // came from — the Library song list, or an open setlist's song list.
  ctx.setSheetBackLabel = (label) => {
    const btn = byId("sheetBackBtn");
    if (btn) btn.textContent = `← ${label}`;
  };

  ctx.openLibrarySong = (song) => {
    window.location.hash = `s=${songTitleSlug(song)}`;
    ctx.state.currentSongFile = song.file;
    ctx.state.currentSetlistSongIndex = null;
    ctx.setSheetBackLabel("Songs");
    ctx.sheet.renderFromFile(song.file);
  };

  ctx.switchTab = (tab) => {
    ctx.state.activeTab = tab;
    qsa(".rj-library-tab", byId("libraryTabs")).forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    const searchRow = byId("librarySearchRow");
    const setlistTools = byId("setlistTools");
    const rail = byId("songRail");
    const isLibrary = tab === "library";
    if (searchRow) searchRow.hidden = !isLibrary;
    if (setlistTools) setlistTools.hidden = isLibrary;
    if (rail) rail.hidden = !isLibrary;

    if (isLibrary) {
      const search = byId("songSearch");
      ctx.library.render(search ? search.value : "");
    } else {
      ctx.state.setlistsView = "home";
      ctx.setlistHome.show();
    }
  };

  ctx.audio = createAudioPlayer(ctx);
  ctx.sheet = createSheet(ctx);
  ctx.inspiration = createInspiration();
  ctx.library = createLibraryTab(ctx);
  ctx.setlistData = createSetlistData(ctx);
  ctx.setlistHome = createSetlistHome(ctx);
  ctx.setlistModal = createSetlistModal(ctx);
  ctx.setlistPrint = createSetlistPrint(ctx);
  ctx.setlistView = createSetlistView(ctx);
  ctx.swipeNav = createSwipeNav(ctx);

  function initSheet() {
    createInstrumentDropdown(ctx);
    createCompingDropdown(ctx);
    initSheetControls(ctx);
    ctx.inspiration.init();
    ctx.swipeNav.init();
    const file = window.location.hash ? songFileFromHash(window.location.hash) : null;
    if (file) {
      // Seed the current-song pointer so swipe / arrow navigation works on a
      // deep link, before any sidebar row has been tapped.
      ctx.state.currentSongFile = file;
      ctx.sheet.renderFromFile(file);
    }
  }

  function initSidebar() {
    if (!byId("songList")) return;

    ctx.readFile("/songs/index_of_songs.txt", (data) => {
      ctx.state.allSongs = parseSongIndex(data);
      ctx.state.allSongsLoaded = true;
      const countEl = byId("songCount");
      if (countEl) countEl.textContent = `${ctx.state.allSongs.length} lead sheets`;
      if (ctx.state.activeTab === "library") ctx.library.render("");
    });

    ctx.readFile("/setlists/index_of_setlists.txt", (data) => {
      ctx.state.setlistIndex = parseSongIndex(data);
      if (ctx.state.activeTab === "setlists" && ctx.state.setlistsView === "home") {
        ctx.setlistHome.render();
      }
    });

    qsa(".rj-library-tab", byId("libraryTabs")).forEach((btn) => {
      btn.addEventListener("click", () => ctx.switchTab(btn.dataset.tab));
    });

    ctx.library.init();
    ctx.setlistView.initControls();

    const layout = document.querySelector(".rj-songs-layout");
    ctx.switchTab((layout && layout.dataset.defaultTab) || "library");
  }

  return {
    start() {
      initSheet();
      initSidebar();
    },
  };
}

export function start() {
  createApp().start();
}
