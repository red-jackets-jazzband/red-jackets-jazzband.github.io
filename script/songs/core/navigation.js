import { byId, qsa } from "../../lib/core/dom.js";
import { parseSongsParams, buildSongsHash } from "../../lib/core/song-hash.js";
import { getPersonalSetlist } from "../../lib/setlists/setlists-store.js";
import { tl } from "../../lib/core/i18n.js";

// The header's language links go to this page in each language; give them
// the same hash so switching language keeps the song / setlist open. (A
// language with no translation links to its home page: no hash there.)
function syncLangLinks(hash) {
  qsa(".rj-intro-nav-lang a[data-lang]").forEach((link) => {
    if (!link.dataset.base) link.dataset.base = link.getAttribute("href");
    const base = link.dataset.base;
    link.setAttribute("href", hash && base.endsWith("/songs/") ? `${base}#${hash}` : base);
  });
}

// The `.abc` filename -> its slug (basename), used in the `s=` hash param.
function songSlug(file) {
  return file ? String(file).replace(/\.abc$/, "") : null;
}

// A band setlist's `sl=` id is its file's basename.
function bandSetlistId(file) {
  return String(file).replace(/\.txt$/, "");
}

// The mobile "back" button leaves the sheet for whichever sidebar list you
// came from — the Library song list, or an open setlist's song list.
function setSheetBackLabel(label) {
  const span = byId("sheetBackLabel");
  if (span) span.textContent = label;
}

/*
  Navigation: the one owner of the store's `nav` slice (songs/core/state.js)
  — which tab is showing, which song is on the sheet, which setlist is open
  and where in it. Every other module moves around through these methods
  (ctx.nav.*), never by writing nav state itself, and reads it from
  ctx.state.

  The URL hash and the tab title are views of that state: a subscription
  rewrites both whenever it (or the song index, for the title's song name)
  changes, so no caller has to remember to.

    openLibrarySong(song, row)   a Library song onto the sheet
    switchTab(tab)               Library / Setlists
    enterSetlist(ids)            a setlist is being opened (band or personal)
    showSetlistContents(list)    ... and its songs are on screen
    selectSetlistSong(file, i)   a song of the open setlist onto the sheet
    leaveSetlist()               back to the setlists home
    forgetPersonal(id)           a personal setlist was deleted
    step(dir) / canStep(dir)     previous / next song in whichever list
    openSetlistById(id, ...)     open a setlist from a `sl=` id
    start()                      act on the load-time URL hash
    setlistIndexLoaded()         the band setlist index arrived
    shareUrl({ a, b })           the Inspiration panel's copy-link URL
*/
export function createNavigation(ctx) {
  const { store } = ctx;
  const setNav = (patch) => store.set("nav", patch);

  // The tab title as rendered by Hugo, e.g. "Red Jackets Jazzband - Songs" —
  // captured once so the active song/setlist can be appended to it without
  // hardcoding the site/page name here.
  const baseTitle = document.title;

  // The hash the page was loaded with, read before anything rewrites it
  // (settling the default tab does) — what start() acts on.
  const initialParams = parseSongsParams(window.location.hash);

  // A `sl=` band setlist can be deep-linked before its index has loaded; the
  // bootstrap parks the "open it" step here for setlistIndexLoaded() to run.
  let pendingBandOpen = null;

  // Whatever's on the sheet titles the tab: the open song takes priority
  // (it's what's actually rendered, even back at the setlists home), else
  // the open setlist's name, else just the page's own base title.
  function syncTitle() {
    const { currentSongFile, currentSetlistId, currentOpenSetlistName } = store.get("nav");
    let activeName = null;
    if (currentSongFile) activeName = ctx.songName(currentSongFile);
    else if (currentSetlistId) activeName = currentOpenSetlistName;
    document.title = activeName ? `${baseTitle} - ${activeName}` : baseTitle;
  }

  // Mirror the current song / open setlist in the location hash, so a plain
  // reload or a copied URL lands back in the same place. Loop markers
  // (`a`/`b`) are never written here — they only ride the Inspiration "copy
  // link" button (shareUrl).
  function syncHash() {
    const { currentSongFile, currentSetlistId } = store.get("nav");
    const hash = buildSongsHash({ song: songSlug(currentSongFile), setlist: currentSetlistId });
    syncLangLinks(hash);
    const current = window.location.hash.replace(/^#/, "");
    if (current === hash) return;
    if (window.history && window.history.replaceState) {
      const { pathname, search } = window.location;
      window.history.replaceState(null, "", hash ? `#${hash}` : pathname + search);
    } else if (hash) {
      window.location.hash = hash;
    }
  }

  store.subscribe(["nav", "catalog"], () => {
    syncTitle();
    syncHash();
  });

  // `row` is the exact Library row it was picked from ({ index, name }): a
  // song can be listed under several names, so the file alone doesn't say
  // which row to highlight or step on from.
  function openLibrarySong(song, row) {
    const patch = { currentSongFile: song.file, currentSetlistId: null, currentSetlistSongIndex: null };
    if (row) {
      patch.currentLibraryIndex = row.index;
      patch.currentLibrarySongName = row.name;
    }
    setNav(patch);
    setSheetBackLabel(tl("back_songs", "Songs"));
    ctx.sheet.renderFromFile(song.file);
  }

  function switchTab(tab) {
    setNav({ activeTab: tab });
    qsa(".rj-library-tab", byId("libraryTabs")).forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    const isLibrary = tab === "library";
    const searchRow = byId("librarySearchRow");
    const setlistTools = byId("setlistTools");
    const rail = byId("songRail");
    if (searchRow) searchRow.hidden = !isLibrary;
    if (setlistTools) setlistTools.hidden = isLibrary;
    if (rail) rail.hidden = !isLibrary;

    if (isLibrary) {
      setNav({ currentSetlistId: null });
      const search = byId("songSearch");
      ctx.library.render(search ? search.value : "");
    } else {
      setNav({ setlistsView: "home" });
      ctx.setlistHome.show();
    }
  }

  // Opening a setlist drops the pointer to whatever song was last on the
  // sheet — otherwise a stale song / position gets serialised into the hash
  // and can spuriously highlight a row in the new list. A caller that means
  // to open a specific song selects it right after.
  function enterSetlist({ id, personalId = null }) {
    setNav({
      currentSetlistId: id, currentPersonalId: personalId, currentSongFile: null, currentSetlistSongIndex: null,
    });
  }

  function showSetlistContents({ songs, name, desc = "" }) {
    setNav({
      setlistsView: "open", currentOpenSongs: songs, currentOpenSetlistName: name, currentOpenSetlistDesc: desc,
    });
  }

  function selectSetlistSong(file, index) {
    setNav({ currentSongFile: file, currentSetlistSongIndex: index == null ? null : Number(index) });
    setSheetBackLabel(tl("back_setlist", "Setlist"));
  }

  // Back at the setlists home: no setlist open any more. The song itself may
  // still be on the sheet, so currentSongFile stays.
  function leaveSetlist() {
    setNav({
      setlistsView: "home",
      currentPersonalId: null,
      currentSetlistId: null,
      currentSetlistSongIndex: null,
      currentOpenSongs: null,
    });
  }

  function forgetPersonal(id) {
    if (store.get("nav").currentPersonalId === id) setNav({ currentPersonalId: null });
  }

  // Previous / next song in whichever list the sidebar is showing: the open
  // setlist (Setlists tab) or the rendered library list (Library tab).
  function step(dir) {
    const { activeTab, setlistsView } = store.get("nav");
    if (activeTab === "setlists") {
      if (setlistsView === "open") ctx.setlistView.stepSong(dir);
      return;
    }
    ctx.library.stepLibrarySong(dir);
  }

  function canStep(dir) {
    const { activeTab, setlistsView } = store.get("nav");
    if (activeTab === "setlists") return setlistsView === "open" && ctx.setlistView.canStep(dir);
    return ctx.library.canStepLibrary(dir);
  }

  // Open the setlist named by a `sl=` hash value — a personal one by id (from
  // this device's storage), else a band one by file basename — and call
  // `then` once its song list is on screen, or `onMissing` when nothing
  // resolves (a personal `sl=` from another device, say).
  function openSetlistById(id, then, onMissing) {
    if (getPersonalSetlist(ctx.storage(), id)) {
      ctx.setlistView.openPersonal(id, then);
      return;
    }
    const openBand = () => {
      const entry = store.get("catalog").setlistIndex.find((e) => e.file === id || bandSetlistId(e.file) === id);
      if (entry) ctx.setlistView.openBand(entry.file, entry.name, then);
      else if (onMissing) onMissing();
    };
    if (store.get("catalog").setlistIndex.length) openBand();
    else pendingBandOpen = openBand;
  }

  // Called once the band setlist index has loaded: run a deep link parked by
  // openSetlistById, and report whether one was waiting.
  function setlistIndexLoaded() {
    if (!pendingBandOpen) return false;
    const open = pendingBandOpen;
    pendingBandOpen = null;
    open();
    return true;
  }

  // Open a Library song by its slug (a deep link). Seeds the current-song
  // pointer so swipe / arrow navigation works before any row was tapped.
  function openSongBySlug(slug) {
    const file = `${slug}.abc`;
    setNav({ currentSongFile: file, currentSetlistId: null });
    if (store.get("nav").activeTab !== "library") switchTab("library");
    ctx.sheet.renderFromFile(file);
  }

  // Act on the hash the page was loaded with (initialParams): open a setlist
  // (and, with `s=`, its song at the right position), or a Library song;
  // then arm the Inspiration panel if the link carried a loop.
  function start(params = initialParams) {
    if (params.inspiration) ctx.inspiration.applyShareState({ a: params.a, b: params.b });
    if (params.setlist) {
      switchTab("setlists");
      openSetlistById(
        params.setlist,
        () => {
          if (params.song) ctx.setlistView.openSongInOpenSetlist(params.song);
        },
        () => {
          if (params.song) openSongBySlug(params.song);
        },
      );
      return;
    }
    if (params.song) openSongBySlug(params.song);
  }

  // The URL the Inspiration panel's "copy link" button hands out: the current
  // song (optionally within its open setlist) plus the given loop markers, so
  // the recipient lands on the sheet with the video open and the phrase set.
  function shareUrl({ a = null, b = null } = {}) {
    const { currentSongFile, currentSetlistId } = store.get("nav");
    const song = songSlug(currentSongFile);
    if (!song) return "";
    const hash = buildSongsHash({
      song, setlist: currentSetlistId, a, b, inspiration: true,
    });
    const { origin, pathname } = window.location;
    return `${origin}${pathname}#${hash}`;
  }

  return {
    openLibrarySong,
    switchTab,
    enterSetlist,
    showSetlistContents,
    selectSetlistSong,
    leaveSetlist,
    forgetPersonal,
    step,
    canStep,
    openSetlistById,
    setlistIndexLoaded,
    start,
    shareUrl,
  };
}
