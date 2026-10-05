// Setlist-wide "Listen" support: collects the references already on each
// song's own ABC (its F: field(s), same source inspiration-links.js reads for
// the single-song Inspiration button) into either one ad-hoc YouTube playlist
// for the whole setlist, or a Soundiiz import that saves the setlist as a
// playlist on the visitor's own streaming account.
import {
  parseInspirationLinks, firstYoutubeUrl, firstSpotifyUrl, firstSoundcloudUrl,
} from "../media/inspiration-links.js";
import { extractYouTubeId } from "../media/youtube.js";
import { extractSpotifyItem } from "../media/spotify.js";
import { extractSoundCloudUrl } from "../media/soundcloud.js";
import { execAll } from "../core/regex-exec-all.js";

const F_FIELD = /^F:(.*)$/gm;

// Reads a song's F: field lines straight off its raw ABC text, in source
// order — the same lines abcjs concatenates into tune.metaText.url — without
// needing the full abcjs parser (setlist-print.js already has the raw text in
// hand for every song, from building the printable booklet). Returns the
// YouTube video id of the song's first YouTube reference, or null if it has
// none.
function abcLinks(abcText) {
  const lines = execAll(F_FIELD, abcText).map((m) => m[1].trim());
  return parseInspirationLinks(lines.join("\n"));
}

export function firstYoutubeIdFromAbc(abcText) {
  if (typeof abcText !== "string") return null;
  const url = firstYoutubeUrl(abcLinks(abcText));
  return url ? extractYouTubeId(url) : null;
}

// A SoundCloud track's permalink path ("<user>/<track>"), the one stable
// identifier a soundcloud.com page link carries — its numeric track id is
// only known server-side.
function soundcloudPermalink(url) {
  const normalized = extractSoundCloudUrl(url);
  if (!normalized) return null;
  const segments = new URL(normalized).pathname.split("/").filter(Boolean);
  return segments.length === 2 && segments[1] !== "sets" ? segments.join("/") : null;
}

// Everything a setlist-wide export can use off one song's F: lines:
// { youtubeId, spotifyTrackId, soundcloudId }, each null when the song has
// no usable link of that kind. Only a Spotify *track* counts — an album or
// playlist link isn't one song — and likewise only a single SoundCloud
// track page, not a user page or a /sets/ playlist.
export function listenSourcesFromAbc(abcText) {
  if (typeof abcText !== "string") {
    return { youtubeId: null, spotifyTrackId: null, soundcloudId: null };
  }
  const links = abcLinks(abcText);
  const youtubeUrl = firstYoutubeUrl(links);
  const spotifyUrl = firstSpotifyUrl(links);
  const spotifyItem = spotifyUrl ? extractSpotifyItem(spotifyUrl) : null;
  const soundcloudUrl = firstSoundcloudUrl(links);
  return {
    youtubeId: youtubeUrl ? extractYouTubeId(youtubeUrl) : null,
    spotifyTrackId: spotifyItem && spotifyItem.type === "track" ? spotifyItem.id : null, // NOSONAR: `?.` is a SyntaxError on Safari 12 (see Browser support)
    soundcloudId: soundcloudUrl ? soundcloudPermalink(soundcloudUrl) : null,
  };
}

// Builds the YouTube "watch_videos" URL that opens an ad-hoc playlist of the
// given video ids, in order — YouTube's own mechanism for a temporary,
// unsaved multi-video playlist, needing no login or API key. Duplicate ids
// (the same song appearing twice in a setlist) are folded to one entry so the
// playlist doesn't repeat a video back to back. Returns null when there are
// no ids to play.
export function buildYoutubePlaylistUrl(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  return unique.length
    ? `https://www.youtube.com/watch_videos?video_ids=${unique.join(",")}`
    : null;
}

// ---- Soundiiz: the setlist as a playlist on the visitor's own account ----
//
// Spotify, Apple Music & co. have no unauthenticated "ad-hoc playlist" URL
// the way YouTube's watch_videos is, and this static site can't hold an
// OAuth token for any of them. Soundiiz's
// public Playlist Import API fills that gap without an API key: POST it a
// tracklist and it answers with a temporary share link where the visitor
// picks a streaming service, signs in and saves the playlist there.
// https://support.soundiiz.com/hc/en-us/articles/36613501259922
export const SOUNDIIZ_ENDPOINT = "https://soundiiz.com/go/import-playlist";
export const SOUNDIIZ_MAX_TRACKS = 200;

// One Soundiiz tracklist entry for a song. A platform/id pair pins the exact
// recording the band's chart points at, picked in order of preference — the
// Spotify track (the most widely matched catalogue id, and an exact hit when
// the playlist is saved to Spotify), else its YouTube video, else its
// SoundCloud track. The
// title always rides along so Soundiiz can still fall back to a plain search
// (and has something to show) when a song has none of the three, or the id
// can't be resolved on the destination.
export function soundiizTrack(title, sources) {
  const track = { title };
  const src = sources || {};
  if (src.spotifyTrackId) {
    track.platform = "spotify";
    track.id = src.spotifyTrackId;
  } else if (src.youtubeId) {
    track.platform = "youtube";
    track.id = src.youtubeId;
  } else if (src.soundcloudId) {
    track.platform = "soundcloud";
    track.id = src.soundcloudId;
  }
  return track;
}

// The JSON body for SOUNDIIZ_ENDPOINT, or null when there's nothing to send.
// `songs` is [{ title, sources }] in setlist order (holes from a song file
// that failed to load are skipped); a song repeated in the setlist is folded
// to its first occurrence, same as buildYoutubePlaylistUrl, and the list is
// capped at the API's own track limit. `destination` (a Soundiiz service
// slug such as "spotify") is optional; left out, the visitor picks the
// service on Soundiiz's own import page.
export function buildSoundiizPayload(name, songs, destination) {
  const seen = new Set();
  const tracklist = [];
  for (const song of songs) {
    if (!song || !song.title) continue; // NOSONAR: `?.` is a SyntaxError on Safari 12 (see Browser support)
    const track = soundiizTrack(song.title, song.sources);
    const key = track.platform ? `${track.platform}:${track.id}` : `title:${track.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tracklist.push(track);
  }
  if (tracklist.length === 0) return null;
  return {
    title: name || "Red Jackets setlist",
    sourceName: "Red Jackets Jazzband",
    ...(destination ? { destination } : {}),
    tracklist: tracklist.slice(0, SOUNDIIZ_MAX_TRACKS),
  };
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

// Soundiiz's reply carries the link to send the visitor to. Only ever
// navigate to a real https soundiiz.com import page, never to whatever URL a
// reply happens to contain. Returns the validated URL, or null.
export function soundiizShareUrl(reply) {
  if (!reply || reply.status !== "success" || typeof reply.shareUrl !== "string") return null; // NOSONAR: `?.` is a SyntaxError on Safari 12 (see Browser support)
  const url = parseUrl(reply.shareUrl);
  if (!url || url.protocol !== "https:") return null; // NOSONAR: `?.` is a SyntaxError on Safari 12 (see Browser support)
  // soundiiz.com itself or any subdomain of it ("." + host makes the bare
  // domain match the same suffix test).
  const isSoundiiz = `.${url.hostname.toLowerCase()}`.endsWith(".soundiiz.com");
  if (!isSoundiiz || !url.pathname.startsWith("/go/import-playlist/")) return null;
  return url.toString();
}
