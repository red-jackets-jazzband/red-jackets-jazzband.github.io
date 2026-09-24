// Setlist-wide "Listen" support: collects the YouTube reference already on
// each song's own ABC (its F: field(s), same source inspiration-links.js
// reads for the single-song Inspiration button) into one ad-hoc YouTube
// playlist for the whole setlist.
import { parseInspirationLinks, firstYoutubeUrl } from "./inspiration-links.js";
import { extractYouTubeId } from "./youtube.js";
import { execAll } from "./regex-exec-all.js";

const F_FIELD = /^F:(.*)$/gm;

// Reads a song's F: field lines straight off its raw ABC text, in source
// order — the same lines abcjs concatenates into tune.metaText.url — without
// needing the full abcjs parser (setlist-print.js already has the raw text in
// hand for every song, from building the printable booklet). Returns the
// YouTube video id of the song's first YouTube reference, or null if it has
// none.
export function firstYoutubeIdFromAbc(abcText) {
  if (typeof abcText !== "string") return null;
  const lines = execAll(F_FIELD, abcText).map((m) => m[1].trim());
  const url = firstYoutubeUrl(parseInspirationLinks(lines.join("\n")));
  return url ? extractYouTubeId(url) : null;
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
