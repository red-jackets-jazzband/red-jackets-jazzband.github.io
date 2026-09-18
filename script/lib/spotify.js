// Hostnames we treat as embeddable Spotify content links — narrower than the
// broader classification set in lib/inspiration-links.js (which also has to
// recognize spotify.com/www.spotify.com for icon purposes): only the two
// hosts that actually serve /track/, /album/, ... paths with an id to embed.
const SPOTIFY_HOSTS = new Set(["open.spotify.com", "play.spotify.com"]);

// The content types Spotify's own embed widget (open.spotify.com/embed/<type>/<id>)
// supports.
const EMBED_TYPES = new Set(["track", "album", "playlist", "episode", "show", "artist"]);

// Spotify's own base62 ids are always 22 characters.
const ITEM_ID = /^[A-Za-z0-9]{22}$/;

// Pulls { type, id } out of a Spotify share link's path — "/track/<id>",
// optionally preceded by a locale segment Spotify's own share links
// sometimes carry ("/intl-de/track/<id>") — or null if the URL isn't a
// recognizable Spotify content link.
export function extractSpotifyItem(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (!SPOTIFY_HOSTS.has(host)) return null;

  const segments = parsed.pathname.split("/").filter(Boolean);
  const [type, id] = EMBED_TYPES.has(segments[0]) ? segments : segments.slice(1);
  if (!type || !id || !EMBED_TYPES.has(type) || !ITEM_ID.test(id)) return null;
  return { type, id };
}

// Builds the embed URL for the Inspiration panel's Spotify tab. theme=0 asks
// for Spotify's own dark variant, matching the panel's dark chrome — unlike
// the YouTube embed, nothing here needs a jsApi/controls=0 treatment:
// Spotify's widget draws its own play/pause/seek bar, and this project isn't
// reimplementing it (see songs/inspiration.js's Spotify tab — a deliberately
// simple embed, not LoopTube parity).
export function spotifyEmbedUrl(url) {
  const item = extractSpotifyItem(url);
  if (!item) return null;
  return `https://open.spotify.com/embed/${item.type}/${item.id}?utm_source=generator&theme=0`;
}

// The panel height Spotify's own embed docs recommend per content type: a
// single track/episode fits the compact 152px layout; a multi-item
// album/playlist/show/artist needs the taller 352px one so it shows its own
// tracklist rather than just a play bar with nothing under it.
const TALL_TYPES = new Set(["album", "playlist", "show", "artist"]);
export function spotifyEmbedHeight(type) {
  return TALL_TYPES.has(type) ? 352 : 152;
}
