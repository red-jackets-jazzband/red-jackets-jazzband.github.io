// Classifies the URL(s) from a tune's ABC F: field(s) into a known
// inspiration source by hostname. abcjs concatenates every repeated F: line
// into tune.metaText.url, one URL per line in source order (confirmed
// against the real abcjs parser, not just its docs), so a song can point to
// a YouTube video, a Spotify track, a SoundCloud track and its
// SecondHandSongs page (the cover-versions/original-versions database) all
// at once — each rendered as its own link (see songs/inspiration.js for the
// docked YouTube/Spotify panel, songs/inspiration-links.js for the rest,
// both fed from songs/sheet.js's engrave()).
const TYPE_HOSTS = {
  youtube: [
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "youtube-nocookie.com", "www.youtube-nocookie.com",
    "youtu.be", "www.youtu.be",
  ],
  spotify: ["open.spotify.com", "spotify.com", "www.spotify.com", "play.spotify.com"],
  soundcloud: ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"],
  secondhandsongs: ["secondhandsongs.com", "www.secondhandsongs.com"],
};

const HOST_TO_TYPE = new Map();
for (const [type, hosts] of Object.entries(TYPE_HOSTS)) {
  for (const host of hosts) HOST_TO_TYPE.set(host, type);
}

// A URL that parses fine but isn't one of the hosts above still gets a
// generic link button (see inspiration-links.js's LINK_META) rather than
// being silently dropped — a song can reference something this list hasn't
// anticipated yet.
export const OTHER_LINK_TYPE = "other";

// Returns the recognized type for `url`'s hostname, OTHER_LINK_TYPE for any
// other parseable http(s) URL, or null if it isn't a URL at all.
export function classifyInspirationUrl(url) {
  if (typeof url !== "string") return null;
  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase();
  return HOST_TO_TYPE.get(host) || OTHER_LINK_TYPE;
}

// Splits a tune's metaText.url (one or more F: lines, newline-joined, in
// source order) into { url, type } entries, dropping blank lines and
// anything that isn't a parseable http(s) URL.
export function parseInspirationLinks(metaTextUrl) {
  if (typeof metaTextUrl !== "string") return [];
  return metaTextUrl
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((url) => ({ url, type: classifyInspirationUrl(url) }))
    .filter((link) => link.type !== null);
}

// The tune's YouTube, Spotify and SoundCloud links (if any) among its
// already-classified F: field links — the three sources inspiration.js's
// docked panel can embed (YouTube with the full LoopTube toolbar, Spotify
// and SoundCloud as plain embedded players — see its own doc comment).
// Undefined (not null) so all three drop straight into updateLink's own
// "no sources -> remove the button" contract.
export function firstYoutubeUrl(links) {
  const link = links.find((l) => l.type === "youtube");
  return link && link.url;
}

export function firstSpotifyUrl(links) {
  const link = links.find((l) => l.type === "spotify");
  return link && link.url;
}

export function firstSoundcloudUrl(links) {
  const link = links.find((l) => l.type === "soundcloud");
  return link && link.url;
}

// The first link of each type, in F: field order — one button per source
// even if a tune's ABC ever repeats the same kind of link across more than
// one F: line.
export function firstLinkPerType(links) {
  const seen = new Set();
  const result = [];
  for (const link of links) {
    if (seen.has(link.type)) continue;
    seen.add(link.type);
    result.push(link);
  }
  return result;
}
