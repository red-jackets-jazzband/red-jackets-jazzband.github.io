/*
  Fetch a static asset (ABC file, setlist .txt, index manifest) as text.

  Kept as XHR rather than fetch() so a `file://` open of the built site still
  works: XHR reports status 0 for a successful local-file read, which we treat
  as OK. `onError`, when given, is called with the HTTP status for a genuine
  failure (e.g. a setlist referencing an .abc that no longer exists).
*/
export function readFile(path, onLoad, onError) {
  const request = new XMLHttpRequest();
  request.onreadystatechange = () => {
    if (request.readyState !== 4) return;
    // A failed HTTP request also lands here with status 0; only a genuine
    // `file:` read reports 0 on success, so accept 0 only in that case.
    const localFileRead = request.status === 0
      && window.location.protocol === "file:";
    if (request.status === 200 || localFileRead) {
      onLoad(request.responseText);
    } else if (onError) {
      onError(request.status);
    }
  };
  request.open("GET", path, true);
  request.send(null);
}
