// The Inspiration panel's source model: which of YouTube / Spotify / SoundCloud
// a tune has, the tab switcher that picks between them, and the plain iframe
// embeds (Spotify, SoundCloud). DOM helpers keyed by element id; no panel state.

import { byId } from "../../lib/core/dom.js";
import { extractYouTubeId } from "../../lib/media/youtube.js";
import { extractSpotifyItem, spotifyEmbedUrl, spotifyEmbedHeight } from "../../lib/media/spotify.js";
import { soundcloudEmbedUrl } from "../../lib/media/soundcloud.js";

// Mirrors the Mixer button's own .active toggle: the Inspiration button
// stays gold for as long as its panel is open, not just while hovered.
// Doesn't touch the panel/ctx state, so it lives at module scope rather than
// nested inside createInspiration.
export function setLinkActive(active) {
  const btn = byId("inspirationLink");
  if (!btn) return;
  btn.classList.toggle("active", active);
  btn.setAttribute("aria-expanded", active ? "true" : "false");
}

// The sources that get a deliberately plain iframe embed (own play/pause/
// seek bar, no custom toolbar) rather than YouTube's LoopTube treatment —
// see the doc comment on createInspiration. `embedUrl` doubles as this
// source's own validity check (it returns null for an unparseable/
// non-content link), so nothing else in this file needs to re-derive that
// separately. `embedHeight`, when present, is recomputed on every load since
// it can vary by content type (Spotify's track vs. album/playlist); null
// means the iframe's own static height (set in content/songs.md) is enough.
export const PLAIN_EMBED_SOURCES = {
  spotify: {
    frameId: "inspirationSpotifyFrame",
    boxId: "inspirationSpotifyBox",
    tabId: "inspirationTabSpotify",
    label: "Spotify",
    embedUrl: spotifyEmbedUrl,
    embedHeight: (url) => spotifyEmbedHeight(extractSpotifyItem(url).type),
  },
  soundcloud: {
    frameId: "inspirationSoundcloudFrame",
    boxId: "inspirationSoundcloudBox",
    tabId: "inspirationTabSoundcloud",
    label: "SoundCloud",
    embedUrl: soundcloudEmbedUrl,
    embedHeight: null,
  },
};
export const PLAIN_EMBED_KEYS = Object.keys(PLAIN_EMBED_SOURCES);
// All embeddable source keys, YouTube first — this order is also the
// priority defaultTab and sourcesKey below fall back to, and what a fresh
// { youtube, spotify, soundcloud } source object should be keyed by.
export const TAB_KEYS = ["youtube", ...PLAIN_EMBED_KEYS];
// Each tab key's own switcher button id, so updateTabsUI can hide the
// individual buttons for sources this tune doesn't have (not just the
// switcher as a whole — see its own doc comment).
export const TAB_IDS = {
  youtube: "inspirationTabYoutube",
  ...Object.fromEntries(PLAIN_EMBED_KEYS.map((key) => [key, PLAIN_EMBED_SOURCES[key].tabId])),
};

// A fresh { youtube, spotify, soundcloud } source triple with everything
// unset — doesn't touch the panel/ctx state, so it lives at module scope
// rather than nested inside createInspiration.
export function emptySources() {
  return Object.fromEntries(TAB_KEYS.map((key) => [key, null]));
}

// Validates and normalizes a { youtube, spotify, soundcloud } source triple,
// dropping any entry that doesn't actually parse as that service's kind of
// link — doesn't touch the panel/ctx state, so it lives at module scope
// rather than nested inside createInspiration.
export function resolveSources(sources) {
  const resolved = emptySources();
  if (sources.youtube && extractYouTubeId(sources.youtube)) resolved.youtube = sources.youtube;
  for (const key of PLAIN_EMBED_KEYS) {
    const url = sources[key];
    if (url && PLAIN_EMBED_SOURCES[key].embedUrl(url)) resolved[key] = url;
  }
  return resolved;
}

// Which tab a freshly opened panel defaults to: YouTube first (it's the
// only one with the LoopTube toolbar), then whichever plain-embed source
// comes first in TAB_KEYS — doesn't touch the panel/ctx state, so it lives
// at module scope rather than nested inside createInspiration.
export function defaultTab(sources) {
  return TAB_KEYS.find((key) => sources[key]);
}

// A stable identity for a { youtube, spotify, soundcloud } source triple, so
// togglePanel can tell "the same tune's button, clicked again" (close) apart
// from "a different tune's button" (open fresh) — doesn't touch the
// panel/ctx state, so it lives at module scope rather than nested inside
// createInspiration.
export function sourcesKey(sources) {
  return TAB_KEYS.map((key) => sources[key] || "").join("|");
}

// Reflects which tab is current on the tab buttons themselves (selected
// state + the gold .active look) — doesn't touch the panel/ctx state, so it
// lives at module scope rather than nested inside createInspiration.
export function updateTabButtonsUi(tab) {
  const ytTab = byId("inspirationTabYoutube");
  if (ytTab) {
    ytTab.classList.toggle("active", tab === "youtube");
    ytTab.setAttribute("aria-selected", tab === "youtube" ? "true" : "false");
  }
  for (const key of PLAIN_EMBED_KEYS) {
    const el = byId(PLAIN_EMBED_SOURCES[key].tabId);
    if (!el) continue;
    el.classList.toggle("active", tab === key);
    el.setAttribute("aria-selected", tab === key ? "true" : "false");
  }
}

// Points the header's "open externally" link at whichever source the panel
// is currently showing — doesn't touch the panel/ctx state, so it lives at
// module scope rather than nested inside createInspiration.
export function setExpandLink(url, label) {
  const expandLink = byId("inspirationExpandBtn");
  if (!expandLink) return;
  expandLink.href = url || "#";
  expandLink.title = `Open on ${label}`;
  expandLink.setAttribute("aria-label", `Open on ${label}`);
}

// Loads a track/link into a plain-embed tab (Spotify or SoundCloud). A no-op
// if it's already showing this exact url — both widgets keep their own
// playback position across re-renders, and reassigning the same src would
// restart it. Doesn't touch the panel/ctx state, so it lives at module scope
// rather than nested inside createInspiration.
export function loadPlainEmbed(key, url) {
  const source = PLAIN_EMBED_SOURCES[key];
  const frame = byId(source.frameId);
  if (!frame || !url) return;
  const embedUrl = source.embedUrl(url);
  if (!embedUrl) return;
  if (source.embedHeight) frame.height = String(source.embedHeight(url));
  if (frame.dataset.loadedUrl === url) return;
  frame.dataset.loadedUrl = url;
  frame.src = embedUrl;
}

// Stops a plain-embed tab's playback by clearing its src — neither widget
// has a scriptable pause here, so this is the one reliable way to silence it
// when switching to another tab or closing the panel. Doesn't touch the
// panel/ctx state, so it lives at module scope rather than nested inside
// createInspiration.
export function stopPlainEmbed(key) {
  const frame = byId(PLAIN_EMBED_SOURCES[key].frameId);
  if (!frame) return;
  frame.src = "";
  delete frame.dataset.loadedUrl;
}
