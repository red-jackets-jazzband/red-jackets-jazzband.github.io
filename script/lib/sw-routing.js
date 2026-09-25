// Pure request-classification for the service worker (static/sw.js) — kept
// here, not in the worker itself, so it's unit-testable the normal way (the
// worker's own caches/fetch calls aren't, the same reason mp3-export.js's
// byte-pushing lives in lib/mp3-encode.js rather than the DOM module).
// The worker calls classifyRequest() for every fetch and switches on the
// result; this file has no opinion on *how* each kind is cached, only
// *which kind* a given request is.

const SOUNDFONT_ORIGIN = "https://gleitz.github.io";
const FONT_AWESOME_ORIGIN = "https://cdnjs.cloudflare.com";

// Same-origin paths worth caching for offline use — the /songs/ app shell
// (its JS, its one stylesheet at its build-time-fingerprinted URL, and the
// site's own self-hosted webfonts split.css's @font-face rules point at —
// Montserrat/Lora/JetBrainsMono for the UI, Saniretro/AkuraPopo/MuseJazzText
// for the print/booklet titling), its data (song/setlist/tour text), and its
// own icons/manifest. Everything else same-origin (other language pages,
// /agenda/, ...) is out of scope: this PWA is /songs/ only, matching its
// manifest's own start_url/scope.
const CACHEABLE_PATH_PREFIXES = [
  "/songs/", "/script/", "/setlists/", "/tour/", "/css/", "/fonts/",
  "/images/icons/", "/manifest.webmanifest",
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
    "font-awesome" - the icon font CSS/webfont from cdnjs; same treatment as
                  a soundfont sample, for the same reason.
    null        - don't touch it; let the browser handle the request as it
                  normally would (no caching, no offline fallback).
*/
export function classifyRequest({
  pathname, origin, sameOrigin, mode,
}) {
  if (mode === "navigate") return sameOrigin ? "navigate" : null;
  if (sameOrigin) return isCacheablePath(pathname) ? "shell" : null;
  if (origin === SOUNDFONT_ORIGIN) return "soundfont";
  if (origin === FONT_AWESOME_ORIGIN) return "font-awesome";
  return null;
}
