import { parseSongsParams } from "./song-hash.js";

/*
  The files a /songs/ visit needs first, started from the page's <head>
  (static/script/early-requests.js, inlined by layouts/partials/head.html)
  instead of only once the app's scripts have downloaded and run — that wait
  used to put one more round trip between the page and the sheet. The app's
  readFile (songs/core/read-file.js) adopts a request started here rather
  than sending its own.

  Which files: the two catalog indexes, and the song a `#s=` link opens.
  A setlist link's file isn't guessed: a personal setlist's id names no file.
*/
export const EARLY_REQUESTS_KEY = "rjEarlyRequests";

export function earlyRequestPaths(hash) {
  const { song } = parseSongsParams(hash);
  const paths = ["/songs/index_of_songs.txt", "/setlists/index_of_setlists.txt"];
  if (song) paths.push(`/songs/${song}.abc`);
  return paths;
}

// Start each request (`send(path)` returns the in-flight request) and park it
// on `win` for readFile to pick up.
export function startEarlyRequests(win, send) {
  const requests = {};
  earlyRequestPaths(win.location.hash).forEach((path) => {
    requests[path] = send(path);
  });
  win[EARLY_REQUESTS_KEY] = requests;
}

// The request started early for `path`, at most once (a later read of the
// same file fetches it afresh), or null.
export function takeEarlyRequest(win, path) {
  const requests = win[EARLY_REQUESTS_KEY];
  if (!requests || !requests[path]) return null;
  const request = requests[path];
  delete requests[path];
  return request;
}
