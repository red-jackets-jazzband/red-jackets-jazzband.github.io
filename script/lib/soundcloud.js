// Hostnames we treat as embeddable SoundCloud content links — same set
// lib/inspiration-links.js classifies as "soundcloud", kept independently
// since this module has its own narrower job (build an embeddable url, not
// just recognize a host for icon purposes).
const SOUNDCLOUD_HOSTS = new Set([
  "soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com",
]);

// The fixed height SoundCloud's own oEmbed docs recommend for the classic
// (non-"visual") player: enough for its waveform + transport controls, no
// separate compact/tall split the way Spotify's embed needs (see
// spotifyEmbedHeight) since a SoundCloud link is always a single track or
// playlist widget at this one size.
export const SOUNDCLOUD_EMBED_HEIGHT = 166;

// Validates `url` is a SoundCloud content link (a host we recognize, with a
// real path — not just the bare homepage) and returns it normalized, or null.
// Unlike Spotify's extractSpotifyItem, this doesn't try to pull a track/
// playlist id out of the path itself: SoundCloud's own player widget
// resolves the *page* url server-side (https://w.soundcloud.com/player/?url=...),
// so there's no id-shape to validate locally, only that it's plausibly a
// SoundCloud content page.
export function extractSoundCloudUrl(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase();
  if (!SOUNDCLOUD_HOSTS.has(host)) return null;
  if (parsed.pathname.split("/").filter(Boolean).length === 0) return null;
  return parsed.toString();
}

// Builds the embed URL for the Inspiration panel's SoundCloud tab, matching
// the panel's dark chrome the same way spotifyEmbedUrl's theme=0 does —
// SoundCloud's widget takes its accent as a literal color, not a theme
// switch, so it's set to the site's own gold. hide_related/show_comments/
// show_teaser are turned off to keep the embed a plain player, same spirit
// as the deliberately-plain Spotify tab (see songs/inspiration.js's doc
// comment): no related-tracks rail or comment stream bolted on.
export function soundcloudEmbedUrl(url) {
  const normalized = extractSoundCloudUrl(url);
  if (!normalized) return null;
  const params = new URLSearchParams({
    url: normalized,
    color: "#e29d0f",
    auto_play: "false",
    hide_related: "true",
    show_comments: "false",
    show_user: "true",
    show_reposts: "false",
    show_teaser: "false",
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}
