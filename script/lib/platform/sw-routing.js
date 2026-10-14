// Pure request-classification for the service worker (static/sw.js) — kept
// here, not in the worker itself, so it's unit-testable the normal way (the
// worker's own caches/fetch calls aren't, the same reason mp3-export.js's
// byte-pushing lives in lib/mp3-encode.js rather than the DOM module).
// The worker calls classifyRequest() for every fetch and switches on the
// result; this file has no opinion on *how* each kind is cached, only
// *which kind* a given request is.

const SOUNDFONT_ORIGIN = "https://gleitz.github.io";

// Same-origin paths worth caching for offline use — the /songs/ app shell
// (its JS, its one stylesheet at its build-time-fingerprinted URL, and the
// site's own self-hosted webfonts split.css's @font-face rules point at —
// Montserrat/Lora/JetBrainsMono for the UI, Saniretro/AkuraPopo/MuseJazzText
// for the print/booklet titling), its data (song/setlist/tour text), and its
// own icons/manifest. Everything else same-origin (/agenda/, ...) is out of
// scope: this PWA is the songs page only (its translated copies at /nl/songs/
// etc. are served by their own registration of the same worker, but they
// share these data/asset paths), matching its manifest's start_url/scope.
const CACHEABLE_PATH_PREFIXES = [
  "/songs/", "/script/", "/setlists/", "/tour/", "/css/", "/fonts/",
  "/images/icons/", "/manifest.",
];

function isCacheablePath(pathname) {
  return CACHEABLE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/*
  `request`: { pathname, origin, sameOrigin, mode } — sameOrigin and mode are
  handed in by the worker (from comparing request.url's origin to
  self.location.origin, and from request.mode) rather than recomputed here,
  so this stays a plain function over plain values.

  Returns one of:
    "navigate"  - an HTML page load; network-first, falling back to the
                  cached shell so a reload still works offline.
    "shell"     - same-origin app code/markup/data; cache-first, revalidated
                  in the background (a stale copy beats a broken page, but a
                  fresher one is picked up next time it's actually used).
    "soundfont" - an audio sample from the FatBoy/MusyngKite CDN; cache-first
                  only, never revalidated — samples never change once
                  published, so there's nothing to catch up on.
    null        - don't touch it; let the browser handle the request as it
                  normally would (no caching, no offline fallback).
*/
export function classifyRequest({
  pathname, origin, sameOrigin, mode,
}) {
  if (mode === "navigate") return sameOrigin ? "navigate" : null;
  if (sameOrigin) return isCacheablePath(pathname) ? "shell" : null;
  if (origin === SOUNDFONT_ORIGIN) return "soundfont";
  return null;
}

const HEX_64 = /^[0-9a-f]{64}$/;

/*
  The path a build-time-fingerprinted file has with its content hash taken
  out — "/script/songs-app.<64 hex>.js" -> "/script/songs-app.js",
  "/css/split.min.<64 hex>.css" -> "/css/split.min.css" — or null for a path
  that isn't one. Each deploy names these files anew, so the worker uses this
  to drop the copy a newer one has replaced, instead of keeping every
  version a visitor ever loaded.
*/
export function fingerprintStem(pathname) {
  const extAt = pathname.lastIndexOf(".");
  const hashAt = pathname.lastIndexOf(".", extAt - 1);
  if (extAt === -1 || hashAt === -1) return null;
  const ext = pathname.slice(extAt);
  if (ext !== ".js" && ext !== ".css") return null;
  if (!HEX_64.test(pathname.slice(hashAt + 1, extAt))) return null;
  return pathname.slice(0, hashAt) + ext;
}
