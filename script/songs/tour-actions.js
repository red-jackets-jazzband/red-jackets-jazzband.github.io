import { byId } from "../lib/dom.js";
import { isSetlistDivider } from "../lib/setlist-format.js";
import {
  clearPersonalSetlistMarker, copyBandSetlistToPersonal, deletePersonalSetlist, getPersonalSetlist,
  listPersonalSetlists,
} from "../lib/setlists-store.js";

/*
  The guided tour's hands: everything that moves the real page into the state a
  step needs (open the demo song, the mixer, the Setlists tab, ...) and puts it
  back afterwards. The tour's markdown names these actions in its `setup:`
  lines; songs/tour.js runs them and does the spotlighting.

  Actions are idempotent ("make it so", not "toggle it") because a step's setup
  is re-applied on every visit, in either direction. Anything that reaches the
  page does so through `ctx` or a real click — the same paths a user takes.
*/

export const DEMO_SONG_FILE = "bourbon_street_parade.abc";
export const DEMO_SETLIST_FILE = "setlist_2026.txt";
// A plain, easy-to-read comping pattern (see COMPING_PATTERNS in lib/comping.js).
export const COMPING_DEMO_PATTERN = "on_2_and_4";

// The personal setlist the "build one from scratch" steps create and grow.
// desc carries an invisible marker (never shown or settable through the UI)
// instead of matching on the display name, so a visitor's own real setlist —
// even one they happen to have named the same — is never swept up with it.
export const DEMO_SETLIST_NAME = "Tour setlist";
const DEMO_SETLIST_MARKER = "\u0000rj-tour-demo";
export const DEMO_SETLIST_SONG_1 = "basin_street.abc";
export const DEMO_SETLIST_SONG_2 = "bill_bailey.abc";
const DEMO_SETLIST_FILES = [DEMO_SETLIST_SONG_1, DEMO_SETLIST_SONG_2];

// Whether `song` is still exactly one of the demo's own two scripted songs —
// never a divider, a transposed one, or one already counted.
function isPlainDemoSong(song, filesSoFar) {
  return !isSetlistDivider(song) && !song.key
    && DEMO_SETLIST_FILES.includes(song.file) && !filesSoFar.includes(song.file);
}

// True while a demo setlist entry still holds nothing but what the tour's own
// script put there — no rename, no extra or duplicated song, no set break, no
// transpose. Every one of those is directly reachable while the tour is open
// (the add-song, reorder and break steps are all `interactive: true`), so a
// visitor can turn this into something real of their own; once they do, it
// must never be swept away or deleted like ordinary tour scaffolding.
function isUntouchedDemoSetlist(entry) {
  if (!entry || entry.name !== DEMO_SETLIST_NAME) return false;
  const filesSoFar = [];
  for (const song of entry.songs) {
    if (!isPlainDemoSong(song, filesSoFar)) return false;
    filesSoFar.push(song.file);
  }
  return true;
}

// Every action name a tour file's `setup:` line may use — checked against the
// real static/tour/tour.en.md by tests/tour-content.test.js.
export const TOUR_ACTION_NAMES = [
  "showLibrary",
  "showSetlists",
  "openDemoSong",
  "openDemoSetlist",
  "openDrawer",
  "openMixer",
  "openInspiration",
  "compingOn",
  "createDemoSetlist",
  "addDemoSong1",
  "addDemoSong2",
];

const SHEET_ACTIVE_CLASS = "rj-sheet-active";
const FULLSCREEN_CLASS = "rj-sheet-fullscreen";
const SONG_WAIT_MS = 6000;
const SETLIST_WAIT_MS = 5000;
const LOOP_BAR_WAIT_MS = 6000;
const POLL_MS = 50;

// Not hidden by `hidden`, `display:none` (including a closed <dialog>) or a
// display:none ancestor — what a user would call "on screen", minus layout.
export function isShown(node) {
  for (let current = node; current?.nodeType === 1; current = current.parentElement) {
    if (current.hidden) return false;
    if (window.getComputedStyle(current).display === "none") return false;
  }
  return Boolean(node);
}

// Resolves true as soon as `predicate()` is truthy, false once `timeout` ms
// have passed. Polled rather than observed: the conditions are a mix of
// state fields and DOM, and 50ms is imperceptible next to a song render.
export function waitUntil(predicate, { timeout = 5000, interval = POLL_MS } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) resolve(true);
      else if (Date.now() - started >= timeout) resolve(false);
      else setTimeout(tick, interval);
    };
    tick();
  });
}

// Settles when `promise` does, or after `ms` — so an XHR that fails without
// ever calling back can't leave the tour hanging on a step.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const isDrawerOpen = () => Boolean(byId("sheetmenu")?.classList.contains("show-advanced"));

function setDrawer(open) {
  const btn = byId("advancedToggleBtn");
  if (btn && isDrawerOpen() !== open) btn.click();
}

// Set the (native) <select> to `value` the way a user's pick would.
function chooseComping(value) {
  const select = byId("comping");
  if (!select || select.value === value) return false;
  select.value = value;
  if (select.value !== value) return false; // no such option
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  return true;
}

// Below 1024px the library and the sheet are alternate screens
// (body.rj-sheet-active swaps them) and the sheet has a back button; on
// desktop both are always on screen and that button is display:none.
function leaveSheetIfStacked() {
  const back = byId("sheetBackBtn");
  if (document.body.classList.contains(SHEET_ACTIVE_CLASS) && isShown(back)) back.click();
}

async function openDrawer() {
  setDrawer(true);
}

function exitFullscreen() {
  if (document.body.classList.contains(FULLSCREEN_CLASS)) byId("sheetFullscreenBtn")?.click();
}

export function createTourActions(ctx) {
  let snapshot = null;
  let demoShown = false; // has the tour put the demo song on the sheet?
  let loopBarGaveUp = false; // YouTube's player never came up (blocked / offline)
  let demoSetlistId = null; // the personal setlist createDemoSetlist made, deleted again in end()

  async function showLibrary() {
    leaveSheetIfStacked();
    if (ctx.state.activeTab !== "library") ctx.switchTab("library");
  }

  async function showSetlists() {
    leaveSheetIfStacked();
    if (ctx.state.activeTab !== "setlists" || ctx.state.setlistsView !== "home") ctx.switchTab("setlists");
  }

  async function openDemoSong() {
    if (demoShown || ctx.state.currentSongFile === DEMO_SONG_FILE) {
      demoShown = true;
      document.body.classList.add(SHEET_ACTIVE_CLASS);
      return;
    }
    if (ctx.state.activeTab !== "library") ctx.switchTab("library");
    const before = ctx.state.currentSongText;
    ctx.openLibrarySong({ file: DEMO_SONG_FILE });
    demoShown = true;
    await waitUntil(
      () => ctx.state.currentSongText && ctx.state.currentSongText !== before,
      { timeout: SONG_WAIT_MS },
    );
  }

  async function openDemoSetlist() {
    leaveSheetIfStacked();
    const id = DEMO_SETLIST_FILE.replace(/\.txt$/, "");
    const { state } = ctx;
    if (state.activeTab === "setlists" && state.setlistsView === "open" && state.currentSetlistId === id) return;
    if (state.activeTab !== "setlists") ctx.switchTab("setlists");
    await waitUntil(() => state.setlistIndex.length > 0, { timeout: SETLIST_WAIT_MS });
    const entry = state.setlistIndex.find((e) => e.file === DEMO_SETLIST_FILE);
    if (!entry) return;
    await withTimeout(
      new Promise((resolve) => { ctx.setlistView.openBand(entry.file, entry.name, resolve); }),
      SETLIST_WAIT_MS,
    );
  }

  // Deletes any leftover demo setlist from a tour that never reached end()
  // (a closed tab, a JS error). Matches on the marker in `desc`, not the
  // display name, so a visitor's own real setlist is never at risk even if
  // they happened to name it the same thing. One that no longer looks like
  // the tour's own untouched scaffolding — a visitor built on it for real —
  // is kept instead: the marker is dropped so it reads as an ordinary
  // personal setlist and is never swept again.
  function sweepStaleDemoSetlists() {
    const storage = ctx.storage();
    listPersonalSetlists(storage)
      .filter((entry) => entry.desc === DEMO_SETLIST_MARKER)
      .forEach((entry) => {
        if (isUntouchedDemoSetlist(entry)) deletePersonalSetlist(storage, entry.id);
        else clearPersonalSetlistMarker(storage, entry.id);
      });
  }

  // The "build a setlist from scratch" steps skip the New-setlist modal (its
  // z-index sits below the tour overlay's, so it would open invisibly behind
  // the shield — see tour.en.md's "new" step) and create the same kind of
  // personal, empty setlist the *Empty* choice in that modal would.
  async function createDemoSetlist() {
    const { state } = ctx;
    const storage = ctx.storage();
    if (!demoSetlistId || !getPersonalSetlist(storage, demoSetlistId)) {
      demoSetlistId = copyBandSetlistToPersonal(storage, {
        name: DEMO_SETLIST_NAME, desc: DEMO_SETLIST_MARKER, songs: [],
      }).id;
    }
    if (state.activeTab !== "setlists") ctx.switchTab("setlists");
    if (state.setlistsView === "open" && state.currentPersonalId === demoSetlistId) return;
    await withTimeout(
      new Promise((resolve) => { ctx.setlistView.openPersonal(demoSetlistId, resolve); }),
      SETLIST_WAIT_MS,
    );
  }

  // Adds `file` to the demo setlist through the exact function a real click on
  // an add-song search result calls, so a visitor who tries the step
  // themselves and one who skips it end up in the identical state. A no-op
  // once the song is already there, so re-running it (Back, a chapter jump)
  // never adds a second copy.
  function addDemoSetlistSong(file) {
    if (!demoSetlistId) return;
    const entry = getPersonalSetlist(ctx.storage(), demoSetlistId);
    if (!entry || entry.songs.some((song) => song.file === file)) return;
    ctx.setlistView.addSongByFile(file);
  }

  async function addDemoSong1() {
    addDemoSetlistSong(DEMO_SETLIST_SONG_1);
  }

  async function addDemoSong2() {
    addDemoSetlistSong(DEMO_SETLIST_SONG_2);
  }

  async function openMixer() {
    ctx.mixer.setOpen(true);
  }

  // The loop toolbar only appears once YouTube's player is up; if it never
  // does (blocked, offline) remember that, so the remaining Inspiration steps
  // don't each wait it out again.
  function openInspiration() {
    ctx.inspiration.setOpen(true);
    if (loopBarGaveUp) return Promise.resolve();
    return waitUntil(() => isShown(byId("inspirationLoopBar")), { timeout: LOOP_BAR_WAIT_MS }).then((ready) => {
      if (!ready) loopBarGaveUp = true;
    });
  }

  // Make sure a comping pattern is on so the sheet shows the comping staff —
  // but never replace one the visitor picked themselves on the step before.
  // (Comping only renders while the More-controls drawer is open, so a step
  // that uses this must also `setup: openDrawer`.)
  async function compingOn() {
    const select = byId("comping");
    if (select?.value === "off" && chooseComping(COMPING_DEMO_PATTERN)) {
      await waitUntil(() => ctx.state.compingActive, { timeout: 2000 });
    }
  }

  const actions = {
    showLibrary,
    showSetlists,
    openDemoSong,
    openDemoSetlist,
    openDrawer,
    openMixer,
    openInspiration,
    compingOn,
    createDemoSetlist,
    addDemoSong1,
    addDemoSong2,
  };

  // Panels are only ever open because the current step asked for them, so the
  // ones a step doesn't name are shut first — stepping Back out of a mixer
  // step, or jumping chapters, leaves nothing dangling over the next spotlight.
  function closeUnrequested(names) {
    if (!names.includes("openMixer")) ctx.mixer.setOpen(false);
    if (!names.includes("openInspiration")) ctx.inspiration.setOpen(false);
    if (!names.includes("openDrawer")) setDrawer(false);
  }

  // Bring the page to the state a step's `setup` names, in order.
  async function apply(names) {
    closeUnrequested(names);
    for (const name of names) {
      const action = actions[name];
      if (action) await action();
    }
  }

  // Remember what the visitor had before the tour touches anything.
  function begin() {
    const select = byId("comping");
    const { state } = ctx;
    snapshot = {
      tab: state.activeTab,
      songFile: state.currentSongFile,
      setlistOpen: state.activeTab === "setlists" && state.setlistsView === "open",
      setlistId: state.currentSetlistId,
      setlistSongIndex: state.currentSetlistSongIndex,
      sheetActive: document.body.classList.contains(SHEET_ACTIVE_CLASS),
      drawerOpen: isDrawerOpen(),
      compingValue: select ? select.value : null,
      fullscreen: document.body.classList.contains(FULLSCREEN_CLASS),
      mixerOpen: Boolean(ctx.mixer.isOpen?.()),
      inspirationOpen: Boolean(ctx.inspiration.isOpen?.()),
    };
    demoShown = state.currentSongFile === DEMO_SONG_FILE;
    loopBarGaveUp = false;
    demoSetlistId = null;
    sweepStaleDemoSetlists();
    ctx.audio.stop();
    exitFullscreen();
  }

  // Wait for the sheet to swap to a different tune than `before`.
  const waitForSheet = (before) => waitUntil(
    () => ctx.state.currentSongText && ctx.state.currentSongText !== before,
    { timeout: SONG_WAIT_MS },
  );

  // The tour started inside an open setlist: reopen it (by id, band or
  // personal) and put the sheet back on the song, at the same row.
  async function restoreSetlist(snap) {
    const { state } = ctx;
    const stillOpen = state.activeTab === "setlists" && state.setlistsView === "open"
      && state.currentSetlistId === snap.setlistId;
    if (!stillOpen) {
      if (state.activeTab !== "setlists") ctx.switchTab("setlists");
      const opened = await withTimeout(
        new Promise((resolve) => {
          ctx.openSetlistById(snap.setlistId, () => resolve(true), () => resolve(false));
        }),
        SETLIST_WAIT_MS,
      );
      if (!opened) return false; // e.g. a personal setlist deleted mid-tour
    }
    const idx = snap.setlistSongIndex;
    if (idx == null || state.currentSetlistSongIndex === idx) return false;
    return ctx.setlistView.openSongAtIndex(idx);
  }

  // The tour started on a song of their own: put it back (the demo replaced
  // it), and return to the tab they were on. With no song of their own the
  // demo stays open on desktop, which beats an empty sheet; on a phone the
  // sheet is a separate screen, so that goes back to the list. Resolves once
  // any re-opened song has rendered.
  async function restoreLocation(snap) {
    const before = ctx.state.currentSongText;
    const sameSong = ctx.state.currentSongFile === snap.songFile;
    let reopened = false;
    if (snap.setlistOpen && snap.setlistId) {
      reopened = await restoreSetlist(snap);
    } else {
      if (snap.songFile && demoShown && snap.songFile !== DEMO_SONG_FILE) {
        ctx.openLibrarySong({ file: snap.songFile });
        reopened = true;
      }
      if (ctx.state.activeTab !== snap.tab) ctx.switchTab(snap.tab);
    }
    if (!snap.sheetActive) leaveSheetIfStacked();
    if (reopened && !sameSong) await waitForSheet(before);
  }

  // Panels that were open before the tour come back last, once the sheet they
  // belong to is on screen again (the mixer's voices and the Inspiration
  // button are both built per rendered song).
  function restorePanels(snap) {
    if (snap.fullscreen && !document.body.classList.contains(FULLSCREEN_CLASS)) {
      byId("sheetFullscreenBtn")?.click();
    }
    if (snap.mixerOpen) ctx.mixer.setOpen(true);
    if (snap.inspirationOpen) ctx.inspiration.setOpen(true);
  }

  async function end() {
    if (!snapshot) return;
    const snap = snapshot;
    snapshot = null;
    ctx.mixer.setOpen(false);
    ctx.inspiration.setOpen(false);
    setDrawer(snap.drawerOpen);
    if (snap.compingValue !== null) chooseComping(snap.compingValue);
    await restoreLocation(snap);
    restorePanels(snap);
    if (demoSetlistId) {
      const staleId = demoSetlistId;
      // Escape/Skip can land end() before restoreLocation ever leaves the
      // Setlists tab (e.g. snap.tab was already "setlists"), so the demo
      // setlist can still be the one on screen — either open, or just
      // listed on the shelf under "Yours" — when it's touched underneath it.
      const viewingIt = ctx.state.activeTab === "setlists" && ctx.state.setlistsView === "open"
        && ctx.state.currentPersonalId === staleId;
      const onShelf = ctx.state.activeTab === "setlists" && ctx.state.setlistsView === "home";
      const storage = ctx.storage();
      // Interactive steps (add-song, reorder, break) let a visitor build for
      // real on top of the demo — only an untouched entry is tour
      // scaffolding safe to delete; anything else is their own work now, so
      // it's kept and just quietly promoted to an ordinary personal setlist.
      if (isUntouchedDemoSetlist(getPersonalSetlist(storage, staleId))) {
        deletePersonalSetlist(storage, staleId);
      } else {
        clearPersonalSetlistMarker(storage, staleId);
      }
      demoSetlistId = null;
      // refreshOpenPersonal already falls back to the shelf itself once the
      // entry it looks up is gone — the same path a real "delete this
      // setlist while it's open elsewhere" takes; it re-renders it in place
      // just as normally when the entry is kept instead.
      if (viewingIt) ctx.setlistView.refreshOpenPersonal();
      else if (onShelf) ctx.setlistHome.render();
    }
  }

  return { actions, apply, begin, end };
}
