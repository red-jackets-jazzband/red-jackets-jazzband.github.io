import { byId, on } from "../../lib/core/dom.js";
import { youtubeEmbedUrl, extractYouTubeId } from "../../lib/media/youtube.js";
import { fallbackCopy, flashShareBtn } from "./share.js";
import {
  PLAIN_EMBED_SOURCES, PLAIN_EMBED_KEYS, TAB_KEYS, TAB_IDS,
  setLinkActive, emptySources, resolveSources, defaultTab, sourcesKey,
  updateTabButtonsUi, setExpandLink, loadPlainEmbed, stopPlainEmbed,
} from "./embeds.js";
import { initDrag, createPanelSizer } from "./panel.js";
import { createLoopBar } from "./loopbar.js";
import { updateInspirationExtLinks } from "./links.js";
import {
  firstYoutubeUrl, firstSpotifyUrl, firstSoundcloudUrl,
} from "../../lib/media/inspiration-links.js";
import { tl } from "../../lib/core/i18n.js";

/*
  The Inspiration picture-in-picture panel: a docked, draggable player that
  keeps playing across song navigation (until explicitly closed) instead of
  leaving the page. A tune can carry up to three independent sources — a
  YouTube F: link, a Spotify one and a SoundCloud one — and the panel embeds
  whichever it has:

  - YouTube gets the full LoopTube toolbar under the video — a play/pause
    toggle, A/B loop markers on a slim timeline, an endless A–B loop toggle
    (an ~80 ms poll that seekTo's back to A just before B, since YouTube has
    no native sub-range loop) and a playback-rate stepper. The toolbar
    reimplements everything the native YouTube control bar offers (play/
    pause, seek, speed), so the embed is loaded with controls=0 (see
    youtubeEmbedUrl) rather than showing a redundant native bar under it.
    Driven through the YouTube IFrame Player API; the pure range/rate/clock
    maths is in lib/looptube.js.
  - Spotify and SoundCloud both get a deliberately plain embed instead —
    each widget draws its own play/pause/seek bar, and (unlike YouTube's
    autoplaying, freely-streamable video) a logged-out Spotify listener only
    ever gets a preview anyway, so there's no LoopTube-style toolbar built
    for either.

  When a tune has more than one, a small tab switcher in the header picks
  which is visible; only one plays at a time (switching tabs pauses/stops
  whichever else was active, see selectTab). When it only has one, the
  switcher is normally hidden and the panel behaves exactly like a
  single-source player — except a lone YouTube or SoundCloud source still
  shows the (single, inert) tab, since neither embed otherwise carries any
  visible indication of which service it's playing from, unlike Spotify's
  own branded widget (see updateTabsUI).
*/
// Whether the docked panel is on screen (for the guided tour's snapshot).
const isOpen = () => {
  const panel = byId("inspirationPanel");
  return Boolean(panel) && !panel.hidden;
};

export function createInspiration(ctx) {
  // The sources the currently *open* panel is showing (not necessarily the
  // sidebar's current song — see updateLink's own doc comment: browsing
  // songs never touches an already-open panel). Set once per openPanel call;
  // selectTab reads it to know what to load into whichever tab is chosen.
  let currentSources = emptySources();
  // Identifies which tune's panel is currently open, so a second click on
  // the same tune's button closes it instead of reopening — see togglePanel.
  let panelKey = null;
  let apiPromise = null;
  let player = null;
  let playerReady = false;
  let pendingVideoId = null;
  // The YouTube video id currently loaded into the player, so switching back
  // to the YouTube tab after visiting Spotify doesn't restart playback or
  // wipe the A/B markers when it's still the same video — see loadYoutube.
  let loadedYoutubeId = null;
  // A shared link's `a`/`b` markers, parked until the next tune with a
  // reference calls updateLink() so we know which video to open.
  let pendingShare = null;

  const loopBar = createLoopBar({ getPlayer: () => (player && playerReady ? player : null) });
  const sizer = createPanelSizer();

  // ---- YouTube IFrame API --------------------------------------------

  function loadIframeApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve) => {
      if (window.YT && window.YT.Player) {
        resolve();
        return;
      }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof prev === "function") prev();
        resolve();
      };
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    });
    return apiPromise;
  }

  function attachPlayer() {
    if (player) return;
    player = new window.YT.Player("inspirationVideoFrame", {
      events: {
        onReady() {
          playerReady = true;
          if (pendingVideoId) {
            player.loadVideoById(pendingVideoId);
            pendingVideoId = null;
          }
          loopBar.onPlayerReady();
        },
        onStateChange: loopBar.onPlayerStateChange,
        onPlaybackRateChange: loopBar.updateSpeedLabel,
      },
    });
  }

  // ---- the "Inspiration" button on the sheet -------------------------

  /*
    Keep the sheet's Inspiration button in sync with the current tune: created
    for a tune whose ABC has a YouTube, Spotify and/or SoundCloud F: link,
    removed for one with none of the three. It only updates its own
    url/title dataset — it never touches an already-open panel, so a video
    someone is playing along to keeps going while they browse songs.
    `sources` is { youtube, spotify, soundcloud }, any of which may be
    undefined — see lib/inspiration-links.js's firstYoutubeUrl/
    firstSpotifyUrl/firstSoundcloudUrl, which is what sheet.js's engrave()
    actually passes in.
  */
  // Creates the Inspiration button the first time a tune with a reference
  // needs one, wiring its click handler off its own dataset (so a stale
  // closure never holds an old song's urls) — split out of updateLink below
  // purely to keep that function's own branching within the complexity gate.
  function ensureLinkButton() {
    let btn = byId("inspirationLink");
    if (btn) return btn;
    btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = tl("inspiration", "Inspiration");
    btn.id = "inspirationLink";
    btn.className = "sheet-inspiration-link";
    btn.addEventListener("click", () => togglePanel({
      youtube: btn.dataset.url || undefined,
      spotify: btn.dataset.spotifyUrl || undefined,
      soundcloud: btn.dataset.soundcloudUrl || undefined,
    }, btn.dataset.title));
    const slot = byId("inspirationSlot");
    if (slot) slot.appendChild(btn);
    // The panel can already be open (playing along across a song change per
    // updateLink's own doc comment) by the time this song's own button gets
    // (re)created — reflect that straight away instead of waiting for the
    // next open/close.
    const panel = byId("inspirationPanel");
    setLinkActive(Boolean(panel && !panel.hidden));
    return btn;
  }

  function updateLink(sources, title) {
    const safeSources = sources || {};
    const youtubeUrl = safeSources.youtube;
    const spotifyUrl = safeSources.spotify;
    const soundcloudUrl = safeSources.soundcloud;
    if (!youtubeUrl && !spotifyUrl && !soundcloudUrl) {
      const btn = byId("inspirationLink");
      if (btn) btn.remove();
      pendingShare = null;
      return;
    }

    const btn = ensureLinkButton();
    btn.dataset.url = youtubeUrl || "";
    btn.dataset.spotifyUrl = spotifyUrl || "";
    btn.dataset.soundcloudUrl = soundcloudUrl || "";
    btn.dataset.title = title || "";

    if (pendingShare) {
      const share = pendingShare;
      pendingShare = null;
      // A shared link's A/B markers only ever mean a YouTube loop (LoopTube
      // is YouTube-only) — a tune with no YouTube source has nothing for
      // them to apply to.
      if (youtubeUrl) {
        openPanel({ youtube: youtubeUrl, spotify: spotifyUrl, soundcloud: soundcloudUrl }, title);
        loopBar.applySharedLoop(share.a, share.b);
      }
    }
  }

  // Arm a shared link's A/B markers: the next tune that reports a reference
  // opens its video with this loop already set. Called from app.js on a deep
  // link like `/songs/#s=<slug>&a=12&b=30`.
  function applyShareState({ a = null, b = null } = {}) {
    pendingShare = { a, b };
  }

  // Copy a link to the current song + loop to the clipboard. app.js owns the
  // URL shape (it knows the song / open setlist); we just supply the markers.
  // The success tick only shows on a confirmed copy — a rejection or a missing
  // Clipboard API falls back to execCommand, then to a prompt the user can
  // copy out of by hand.
  function copyShareLink() {
    const btn = byId("inspirationShareBtn");
    const url = ctx && ctx.nav.shareUrl ? ctx.nav.shareUrl(loopBar.loopRange()) : "";
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        () => flashShareBtn(btn),
        () => fallbackCopy(url, btn),
      );
    } else {
      fallbackCopy(url, btn);
    }
  }

  // ---- open / close -------------------------------------------------

  function togglePanel(sources, title) {
    const panel = byId("inspirationPanel");
    if (!panel) return;
    if (!panel.hidden && panelKey === sourcesKey(sources)) closePanel();
    else openPanel(sources, title);
  }

  function openPanel(sources, title) {
    const panel = byId("inspirationPanel");
    if (!panel) return;
    const resolved = resolveSources(sources);
    if (!resolved.youtube && !resolved.spotify && !resolved.soundcloud) return;

    currentSources = resolved;
    panelKey = sourcesKey(sources);

    const titleEl = byId("inspirationPanelTitle");
    if (titleEl) titleEl.textContent = title || tl("inspiration", "Inspiration");

    panel.hidden = false;
    setLinkActive(true);
    updateTabsUI();
    selectTab(defaultTab(currentSources));
  }

  // Which panel tabs are currently shown/usable — each individual button is
  // hidden unless this tune actually has that source (e.g. a YouTube +
  // Spotify tune shows only those two, never a dead SoundCloud button). The
  // switcher as a whole normally only earns its place once there's more than
  // one source to switch between, but a lone YouTube or SoundCloud source
  // still shows it (as a single, unclickable-elsewhere tab) so the source is
  // never ambiguous — a bare video/waveform embed carries no branding of its
  // own the way Spotify's widget already does, so without the tab label
  // there'd be nothing on screen saying which service it came from.
  function updateTabsUI() {
    const tabs = byId("inspirationTabs");
    if (!tabs) return;
    const sourceCount = TAB_KEYS.filter((key) => currentSources[key]).length;
    const soleSource = sourceCount === 1 ? TAB_KEYS.find((key) => currentSources[key]) : null;
    tabs.hidden = sourceCount === 0 || (sourceCount === 1 && soleSource !== "youtube" && soleSource !== "soundcloud");
    for (const key of TAB_KEYS) {
      const btn = byId(TAB_IDS[key]);
      if (btn) btn.hidden = !currentSources[key];
    }
  }

  // Switches which source is visible in the panel — the YouTube tab (video +
  // LoopTube toolbar) or a plain-embed tab (Spotify/SoundCloud, no toolbar).
  // Only one ever plays at a time: switching away from a tab pauses/stops it
  // rather than leaving it running out of sight.
  function selectTab(tab) {
    updateTabButtonsUi(tab);
    if (tab === "youtube") showYoutubeTab();
    else showPlainEmbedTab(tab);
  }

  function showYoutubeTab() {
    for (const key of PLAIN_EMBED_KEYS) {
      stopPlainEmbed(key);
      const box = byId(PLAIN_EMBED_SOURCES[key].boxId);
      if (box) box.hidden = true;
    }
    const videoBox = byId("inspirationVideoBox");
    if (videoBox) videoBox.hidden = false;
    setExpandLink(currentSources.youtube, "YouTube");
    loadYoutube(currentSources.youtube);
  }

  // Shows a plain-embed tab (Spotify or SoundCloud): pauses YouTube, stops
  // whichever other plain-embed tab was showing (only one plays at a time),
  // and loads this one's own source.
  function showPlainEmbedTab(key) {
    pauseYoutube();
    const bar = byId("inspirationLoopBar");
    if (bar) bar.hidden = true;
    const videoBox = byId("inspirationVideoBox");
    if (videoBox) videoBox.hidden = true;
    for (const otherKey of PLAIN_EMBED_KEYS) {
      if (otherKey === key) continue;
      stopPlainEmbed(otherKey);
      const otherBox = byId(PLAIN_EMBED_SOURCES[otherKey].boxId);
      if (otherBox) otherBox.hidden = true;
    }
    const source = PLAIN_EMBED_SOURCES[key];
    const box = byId(source.boxId);
    if (box) box.hidden = false;
    setExpandLink(currentSources[key], source.label);
    loadPlainEmbed(key, currentSources[key]);
  }

  // Loads a video into the YouTube tab. A no-op beyond re-showing the
  // LoopTube toolbar when it's the same video already loaded (switching back
  // from the Spotify tab shouldn't restart playback or wipe the A/B
  // markers) — otherwise this is the same load sequence openPanel always ran
  // before the two tabs existed.
  function loadYoutube(url) {
    const frame = byId("inspirationVideoFrame");
    if (!frame || !url) return;
    const videoId = extractYouTubeId(url);
    if (!videoId) return;
    if (videoId === loadedYoutubeId) {
      const bar = byId("inspirationLoopBar");
      if (bar) bar.hidden = false;
      loopBar.refresh();
      return;
    }
    loadedYoutubeId = videoId;
    loopBar.halt();
    loopBar.reset();

    if (player && playerReady) {
      player.loadVideoById(videoId);
      return;
    }
    if (player) {
      pendingVideoId = videoId; // player exists but onReady hasn't fired yet
      return;
    }
    pendingVideoId = null;
    frame.src = youtubeEmbedUrl(url, {
      autoplay: true, jsApi: true, origin: window.location.origin,
    });
    loadIframeApi().then(attachPlayer);
  }

  // Pauses (rather than stops) the YouTube player when switching away from
  // its tab, so switching back resumes where it left off instead of
  // restarting — the frame/player themselves are left alone, only playback.
  // Always calls pauseVideo() when the player exists, rather than gating on
  // the `isPlaying` flag: that flag only flips once the IFrame API's
  // onStateChange callback fires, so a video that autoplayed just before the
  // tab switch (already playing, but not yet reflected in `isPlaying`) would
  // otherwise keep playing out of sight. pauseVideo() is a no-op on an
  // already-paused player, so calling it unconditionally is safe.
  function pauseYoutube() {
    if (player && playerReady && player.pauseVideo) player.pauseVideo();
  }

  function closePanel() {
    const panel = byId("inspirationPanel");
    if (!panel) return;
    panel.hidden = true;
    setLinkActive(false);
    // Drop any id that was queued for a not-yet-ready player, so a late
    // onReady doesn't start a video into the now-hidden panel (halt() below
    // likewise drops a shared start point that never got to play).
    pendingVideoId = null;
    if (player && playerReady && player.stopVideo) {
      player.stopVideo();
    } else {
      const frame = byId("inspirationVideoFrame");
      if (frame) frame.src = "";
    }
    loadedYoutubeId = null;
    for (const key of PLAIN_EMBED_KEYS) stopPlainEmbed(key);
    loopBar.halt();
    const bar = byId("inspirationLoopBar");
    if (bar) bar.hidden = true;
    panelKey = null;
    currentSources = emptySources();
  }

  function init() {
    const panel = byId("inspirationPanel");
    const header = byId("inspirationPanelHeader");
    if (!panel || !header) return;
    loopBar.init();
    on("inspirationCloseBtn", "click", closePanel);
    on("inspirationShareBtn", "click", copyShareLink);
    on("inspirationTabYoutube", "click", () => { if (currentSources.youtube) selectTab("youtube"); });
    for (const key of PLAIN_EMBED_KEYS) {
      on(PLAIN_EMBED_SOURCES[key].tabId, "click", () => { if (currentSources[key]) selectTab(key); });
    }
    on("inspirationSizeBtn", "click", () => sizer.cyclePanelSize(panel));
    sizer.setPanelWidth(panel, sizer.readStoredWidth(), false);
    initDrag(panel, header);
    const resizeHandle = byId("inspirationResizeHandle");
    if (resizeHandle) sizer.initResize(panel, resizeHandle);
  }

  // Programmatic open/close, for the guided tour (songs/tour.js). Opening does
  // exactly what a click on the song's own Inspiration button does (a no-op when
  // the tune has no reference, so there's no button); closing is the header's ×.
  function setOpen(next) {
    const panel = byId("inspirationPanel");
    if (!panel || next === !panel.hidden) return;
    if (!next) {
      closePanel();
      return;
    }
    const btn = byId("inspirationLink");
    if (btn) btn.click();
  }

  // Follow the live sheet (the store's `tune` slice, published on every
  // render): its F: links decide the Inspiration button and the panel's
  // sources, plus the plain "open in a new tab" link buttons beside it.
  ctx.store.subscribe("tune", (tune, changed) => {
    if (!changed.includes("inspirationLinks")) return;
    const links = tune.inspirationLinks;
    updateLink({
      youtube: firstYoutubeUrl(links),
      spotify: firstSpotifyUrl(links),
      soundcloud: firstSoundcloudUrl(links),
    }, tune.title);
    updateInspirationExtLinks(links);
  });

  return { updateLink, applyShareState, init, setOpen, isOpen };
}
