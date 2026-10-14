import { takeEarlyRequest } from "../../lib/core/early-requests.js";

/*
  Fetch a static asset (ABC file, setlist .txt, index manifest) as text.

  Kept as XHR rather than fetch() so a `file://` open of the built site still
  works: XHR reports status 0 for a successful local-file read, which we treat
  as OK. `onError`, when given, is called with the HTTP status for a genuine
  failure (e.g. a setlist referencing an .abc that no longer exists).

  When the page's <head> already started this file (lib/core/early-requests.js:
  the catalog indexes, a deep-linked song), that request is adopted instead of
  sending a second one — still answered asynchronously, even if it's done.
*/
export function readFile(path, onLoad, onError) {
  const early = takeEarlyRequest(window, path);
  if (early) {
    const settleEarly = () => settle(early, onLoad, onError);
    if (early.readyState === 4) setTimeout(settleEarly, 0);
    else early.addEventListener("loadend", settleEarly);
    return;
  }
  const request = new XMLHttpRequest();
  request.onreadystatechange = () => {
    if (request.readyState === 4) settle(request, onLoad, onError);
  };
  request.open("GET", path, true);
  request.send(null);
}

function settle(request, onLoad, onError) {
  // A failed HTTP request also lands here with status 0; only a genuine
  // `file:` read reports 0 on success, so accept 0 only in that case.
  const localFileRead = request.status === 0
    && window.location.protocol === "file:";
  if (request.status === 200 || localFileRead) {
    onLoad(request.responseText);
  } else if (onError) {
    onError(request.status);
  }
}
