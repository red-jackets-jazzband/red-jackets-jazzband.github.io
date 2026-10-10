import { byId, qsa } from "../../lib/core/dom.js";
import { parseSongIndex } from "../../lib/core/song-index.js";
import { createNavigation } from "./navigation.js";
import { createAudioPlayer } from "../audio/player.js";
import { createMetronome } from "../audio/metronome.js";
import { createMixer } from "../audio/mixer.js";
import { initMp3Export } from "../audio/mp3-export.js";
import { createSheet } from "../sheet/sheet.js";
import { initSheetControls } from "../sheet/controls.js";
import { createInstrumentDropdown, createCompingDropdown } from "../sheet/selects.js";
import { createFullscreen } from "../sheet/fullscreen.js";
import { createSongHistory } from "../sheet/history.js";
import { createSwipeNav } from "../sheet/swipe-nav.js";
import { createInspiration } from "../inspiration/inspiration.js";
import { createLibraryTab } from "../library/library-tab.js";
import { createSetlistData } from "../setlists/data.js";
import { createSetlistHome } from "../setlists/home.js";
import { createSetlistModal } from "../setlists/modal.js";
import { createSetlistPrint } from "../setlists/print.js";
import { createSetlistView } from "../setlists/view.js";
import { createTour } from "../tour/tour.js";
import { createOffline } from "../offline/offline.js";
import { createLayersPanel } from "../layers/panel.js";
import { tl } from "../../lib/core/i18n.js";

/*
  The songs page's feature registry — the whole dependency graph in one
  list. Each entry is

    { name, create?(ctx) -> api, init?(ctx) }

  app.js first calls every `create`, in order, and puts its api on
  ctx[name] (so features reach each other only as ctx.<name>, never by
  importing one another); then it calls every `init`, in order, each
  isolated so one failing feature can't take the rest down. `create` only
  builds (subscribes to the store, keeps closures) and may not call another
  feature yet; anything touching the page belongs in `init`, which runs once
  every feature exists. An entry may be init-only: a start-up step that
  isn't an api of its own (the sidebar, acting on the deep link).

  A feature with state of its own also adds a slice to core/state.js.
  Order matters only for `init`: the sheet's toolbar before the sidebar,
  the sidebar before the deep link is acted on, the tour last (it sees the
  page as everything else left it).
*/

// The two indexes everything else browses: the song list and the band
// setlists. A deep link into a band setlist waits for the second one.
function loadCatalog(ctx) {
  ctx.readFile("/songs/index_of_songs.txt", (data) => {
    ctx.store.set("catalog", { allSongs: parseSongIndex(data), allSongsLoaded: true });
    const countEl = byId("songCount");
    if (countEl) countEl.textContent = tl("library_count", "{count} lead sheets", { count: ctx.state.allSongs.length });
    if (ctx.state.activeTab === "library") ctx.library.render("");
  });

  ctx.readFile("/setlists/index_of_setlists.txt", (data) => {
    ctx.store.set("catalog", { setlistIndex: parseSongIndex(data) });
    if (ctx.nav.setlistIndexLoaded()) return;
    if (ctx.state.activeTab === "setlists" && ctx.state.setlistsView === "home") ctx.setlistHome.render();
  });
}

// The sidebar: the Library / Setlists tab switcher and both lists, starting
// on the tab the page asks for (data-default-tab on .rj-songs-layout).
function initSidebar(ctx) {
  if (!byId("songList")) return;
  loadCatalog(ctx);
  qsa(".rj-library-tab", byId("libraryTabs")).forEach((btn) => {
    btn.addEventListener("click", () => ctx.nav.switchTab(btn.dataset.tab));
  });
  ctx.library.init();
  ctx.setlistView.initControls();
  const layout = document.querySelector(".rj-songs-layout");
  // `?.` is a SyntaxError on Safari 12 (see CLAUDE.md's Browser support).
  ctx.nav.switchTab((layout && layout.dataset.defaultTab) || "library"); // NOSONAR
}

export const FEATURES = [
  { name: "nav", create: createNavigation },
  { name: "audio", create: createAudioPlayer },
  { name: "sheet", create: createSheet },
  {
    name: "sheetToolbar",
    init(ctx) {
      createInstrumentDropdown(ctx);
      createCompingDropdown(ctx);
      // Solo is hidden for now (results not good enough yet); re-enable by
      // calling createSoloDropdown(ctx) here.
      initSheetControls(ctx);
      initMp3Export(ctx);
    },
  },
  { name: "mixer", create: createMixer, init: (ctx) => ctx.mixer.init() },
  { name: "metronome", create: createMetronome, init: (ctx) => ctx.metronome.init() },
  { name: "inspiration", create: createInspiration, init: (ctx) => ctx.inspiration.init() },
  { name: "swipeNav", create: createSwipeNav, init: (ctx) => ctx.swipeNav.init() },
  { name: "fullscreen", create: createFullscreen, init: (ctx) => ctx.fullscreen.init() },
  { name: "history", create: createSongHistory, init: (ctx) => ctx.history.init() },
  { name: "layers", create: createLayersPanel, init: (ctx) => ctx.layers.init() },
  { name: "library", create: createLibraryTab },
  { name: "setlistData", create: createSetlistData },
  { name: "setlistHome", create: createSetlistHome },
  { name: "setlistModal", create: createSetlistModal },
  { name: "setlistPrint", create: createSetlistPrint },
  { name: "setlistView", create: createSetlistView },
  { name: "sidebar", init: initSidebar },
  { name: "offline", create: createOffline, init: (ctx) => ctx.offline.init() },
  // Act on the URL the page was loaded with (captured by createNavigation,
  // before settling the default tab rewrote the hash).
  { name: "deepLink", init: (ctx) => ctx.nav.start() },
  { name: "tour", create: createTour, init: (ctx) => ctx.tour.init() },
];
