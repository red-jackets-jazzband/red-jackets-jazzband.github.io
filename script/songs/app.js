import { byId, qsa } from "../lib/dom.js";
import { safeStorage } from "../lib/preferences.js";
import { parseSongIndex } from "../lib/song-index.js";
import { parseSongsParams, buildSongsHash } from "../lib/song-hash.js";
import { getPersonalSetlist } from "../lib/setlists-store.js";
import { humanizeSongFile } from "../lib/filename.js";
import { readFile } from "./read-file.js";
import { createAudioPlayer } from "./audio-player.js";
import { createSheet } from "./sheet.js";
import {
  createMixer, loadMixerState, loadGchordPatternState, loadHighQualityAudioState, loadSwingState,
} from "./mixer.js";
import { createMetronome, loadMetronomeState } from "./metronome.js";
import { createInspiration } from "./inspiration.js";
import { initSheetControls } from "./sheet-controls.js";
import { initWavExport } from "./wav-export.js";
import { createInstrumentDropdown, createCompingDropdown } from "./selects.js";
import { createLibraryTab } from "./library-tab.js";
import { createSetlistData } from "./setlist-data.js";
import { createSetlistHome } from "./setlist-home.js";
import { createSetlistModal } from "./setlist-modal.js";
import { createSetlistPrint } from "./setlist-print.js";
import { createSetlistView } from "./setlist-view.js";
import { createSwipeNav } from "./swipe-nav.js";

// The `.abc` filename -> its slug (basename), used in the `s=` hash param.
function songSlug(file) {
  return file ? String(file).replace(/\.abc$/, "") : null;
}

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
      currentSetlistId: null, // the `sl=` hash value for the open setlist
      currentOpenSongs: null,
      currentOpenSetlistName: "",
      currentOpenSetlistDesc: "",
      currentSongFile: null,
      currentSetlistSongIndex: null,
      currentLibraryIndex: null,
      currentLibrarySongName: undefined, // name of the row currentLibraryIndex was set from, to tell apart duplicate aliases sharing a file
      currentSongText: undefined, // clef-adjusted ABC currently on the sheet
      compingActive: false,
      tempoOverrideBpm: null,
      mixer: loadMixerState(),
      gchordPattern: loadGchordPatternState(),
      metronomeEnabled: loadMetronomeState(),
      highQualityAudio: loadHighQualityAudioState(),
      swing: loadSwingState(),
    },
    readFile,
    storage: safeStorage,
  };

  ctx.songName = (file) => {
    const match = ctx.state.allSongs.find((song) => song.file === file);
    return match ? match.name : humanizeSongFile(file);
  };

  // The tab title as rendered by Hugo, e.g. "Red Jackets Jazzband - Songs" —
  // captured once so the active song/setlist can be appended to it without
  // hardcoding the site/page name here.
  const baseTitle = document.title;

  // Reflect whatever's on the sheet in the tab title: the open song takes
  // priority (it's what's actually rendered, even back at the setlists home
  // with a setlist no longer open — see setlist-home.js's `show()`), else the
  // open setlist's name, else just the page's own base title.
  ctx.updateTitle = () => {
    let activeName = null;
    if (ctx.state.currentSongFile) activeName = ctx.songName(ctx.state.currentSongFile);
    else if (ctx.state.currentSetlistId) activeName = ctx.state.currentOpenSetlistName;
    document.title = activeName ? `${baseTitle} - ${activeName}` : baseTitle;
  };

  // The mobile "back" button leaves the sheet for whichever sidebar list you
  // came from — the Library song list, or an open setlist's song list.
  ctx.setSheetBackLabel = (label) => {
    const span = byId("sheetBackLabel");
    if (span) span.textContent = label;
  };

  // Rewrite the location hash to mirror the current song / open setlist, so a
  // plain reload or a copied URL lands back in the same place. Loop markers
  // (`a`/`b`) are never written here — they only ride the Inspiration "copy
  // link" button (see ctx.shareUrl).
  ctx.syncHash = () => {
    // Runs even when the hash itself doesn't change: a deep link into an
    // already-matching hash, or a renamed personal setlist whose id (and so
    // whose hash) stays the same, both still need the tab title refreshed.
    ctx.updateTitle();
    const hash = buildSongsHash({
      song: songSlug(ctx.state.currentSongFile),
      setlist: ctx.state.currentSetlistId,
    });
    const current = window.location.hash.replace(/^#/, "");
    if (current === hash) return;
    if (window.history && window.history.replaceState) {
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", hash ? `#${hash}` : pathname + search);
    } else if (hash) {
      window.location.hash = hash;
    }
  };

  // The URL the Inspiration panel's "copy link" button hands out: the current
  // song (optionally within its open setlist) plus the given loop markers, so
  // the recipient lands on the sheet with the video open and the phrase set.
  ctx.shareUrl = ({ a = null, b = null } = {}) => {
    const song = songSlug(ctx.state.currentSongFile);
    if (!song) return "";
    const hash = buildSongsHash({
      song, setlist: ctx.state.currentSetlistId, a, b, inspiration: true,
    });
    const { origin, pathname } = window.location;
    return `${origin}${pathname}#${hash}`;
  };

  ctx.openLibrarySong = (song) => {
    ctx.state.currentSongFile = song.file;
    ctx.state.currentSetlistId = null;
    ctx.state.currentSetlistSongIndex = null;
    ctx.syncHash();
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
      ctx.state.currentSetlistId = null;
      const search = byId("songSearch");
      ctx.library.render(search ? search.value : "");
      ctx.syncHash();
    } else {
      ctx.state.setlistsView = "home";
      ctx.setlistHome.show();
    }
  };

  ctx.audio = createAudioPlayer(ctx);
  ctx.metronome = createMetronome(ctx);
  ctx.sheet = createSheet(ctx);
  ctx.mixer = createMixer(ctx);
  ctx.inspiration = createInspiration(ctx);
  ctx.library = createLibraryTab(ctx);
  ctx.setlistData = createSetlistData(ctx);
  ctx.setlistHome = createSetlistHome(ctx);
  ctx.setlistModal = createSetlistModal(ctx);
  ctx.setlistPrint = createSetlistPrint(ctx);
  ctx.setlistView = createSetlistView(ctx);
  ctx.swipeNav = createSwipeNav(ctx);

  // A `sl=` band setlist can be deep-linked before its index has loaded; the
  // bootstrap parks the "open it" step here for the index fetch to run.
  let pendingBandBootstrap = null;

  function initSheet() {
    createInstrumentDropdown(ctx);
    createCompingDropdown(ctx);
    initSheetControls(ctx);
    initWavExport(ctx);
    ctx.mixer.init();
    ctx.metronome.init();
    ctx.inspiration.init();
    ctx.swipeNav.init();
  }

  // Open the setlist named by a `sl=` hash value — a personal one by id (from
  // this device's storage), else a band one by file basename — and call `then`
  // once its song list is on screen, or `onMissing` when nothing resolves (a
  // personal `sl=` from another device, say).
  function openSetlistById(id, then, onMissing) {
    if (getPersonalSetlist(ctx.storage(), id)) {
      ctx.setlistView.openPersonal(id, then);
      return;
    }
    const openBand = () => {
      const entry = ctx.state.setlistIndex.find(
        (e) => e.file === id || String(e.file).replace(/\.txt$/, "") === id,
      );
      if (entry) ctx.setlistView.openBand(entry.file, entry.name, then);
      else if (onMissing) onMissing();
    };
    if (ctx.state.setlistIndex.length) openBand();
    else pendingBandBootstrap = openBand;
  }

  // Open a Library song by its slug and mirror it into the hash. Seeds the
  // current-song pointer so swipe / arrow navigation works before any sidebar
  // row has been tapped.
  function openSongDeepLink(slug) {
    const file = `${slug}.abc`;
    ctx.state.currentSongFile = file;
    ctx.state.currentSetlistId = null;
    if (ctx.state.activeTab !== "library") ctx.switchTab("library");
    ctx.syncHash();
    ctx.sheet.renderFromFile(file);
  }

  // Act on the load-time hash: open a setlist (and, with `s=`, its song at the
  // right position), or a Library song; then arm the Inspiration panel if the
  // link carried a loop. `params` is captured before initSidebar, which can
  // rewrite the hash as it settles the default tab.
  function bootstrap(params) {
    if (params.inspiration) {
      ctx.inspiration.applyShareState({ a: params.a, b: params.b });
    }
    if (params.setlist) {
      ctx.switchTab("setlists");
      openSetlistById(
        params.setlist,
        () => {
          if (params.song) ctx.setlistView.openSongInOpenSetlist(params.song);
        },
        () => {
          if (params.song) openSongDeepLink(params.song);
        },
      );
      return;
    }
    if (params.song) openSongDeepLink(params.song);
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
      if (pendingBandBootstrap) {
        const open = pendingBandBootstrap;
        pendingBandBootstrap = null;
        open();
      } else if (ctx.state.activeTab === "setlists" && ctx.state.setlistsView === "home") {
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
      const params = parseSongsParams(window.location.hash);
      initSheet();
      initSidebar();
      bootstrap(params);
    },
  };
}

export function start() {
  createApp().start();
}
