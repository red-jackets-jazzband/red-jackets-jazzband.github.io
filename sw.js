// Service worker for /songs/ — the one page on the site worth working
// offline (see CLAUDE.md's "Offline / PWA" section). Registered from
// songs/offline.js with an explicit `{ scope: "/songs/" }` even though this
// file lives at the site root (so it can be registered at all with that
// scope, since a worker's own default scope is only its containing
// directory) — every other page on the site is untouched by it.
//
// A module worker (this file uses a real `import`, not `importScripts`) so
// the request-classification rules live in one place (lib/sw-routing.js,
// unit-tested the normal way) rather than being duplicated here by hand.
// Module service workers aren't universally supported yet (notably older
// Safari) — on a browser that can't load this file at all, /songs/ simply
// works the same as it always did, online-only, same as before this existed.
import { classifyRequest } from "./script/lib/sw-routing.js";
import {
  findStylesheetHrefs, findCssUrls, findScriptSrcs, findModuleImports,
} from "./script/lib/precache-scan.js";

// Bump on any change to this file or to what it should cache, so activate()
// clears out whatever the previous version left behind instead of it
// lingering forever.
const CACHE_VERSION = "v1";
// Every cache this worker owns is named under this prefix, and activate()'s
// cleanup only ever deletes caches under it — CacheStorage is shared across
// the whole origin, not partitioned per script/scope, so an unprefixed
// "delete anything not in CURRENT_CACHES" would also delete a cache some
// other, unrelated feature on this origin created.
const CACHE_PREFIX = "rj-songs-";
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const SOUNDFONT_CACHE = `${CACHE_PREFIX}soundfont-${CACHE_VERSION}`;
const FONT_AWESOME_CACHE = `${CACHE_PREFIX}font-awesome-${CACHE_VERSION}`;
const CURRENT_CACHES = new Set([SHELL_CACHE, SOUNDFONT_CACHE, FONT_AWESOME_CACHE]);

// A deliberately small precache — just enough that a fresh install has an
// offline fallback immediately, before the user has ever visited /songs/.
// The song/setlist library and the rest of the app shell are cached the
// normal way the first time they're actually requested (cacheFirstRevalidate
// below), which happens within the first few seconds of any real visit
// anyway; songs/offline.js's explicit "Download library for offline" action
// covers the rest (the whole song/setlist list, warmed proactively) and the
// soundfont samples (which nothing short of actually rendering audio can
// discover the URLs for — see that file's own doc comment).
const PRECACHE_URLS = ["/songs/", "/manifest.webmanifest"];

// A page's own <head>/<body> — its stylesheet(s), the webfonts they declare
// via @font-face, and its own <script> tags (including, for the type="module"
// entry point, everything it statically imports) — is requested once, during
// that page's *own* initial load, before any service worker can ever be
// controlling it (a worker never controls the very page load that installs
// it — that's the standard SW lifecycle, not a bug here). So unlike
// everything else "shell"-classified, those requests are never passively
// caught by the fetch handler below on a first visit; they have to be
// fetched here, explicitly, at install time — otherwise a first-ever visit
// that goes offline before a second navigation would have a cached /songs/
// page with no stylesheet, no fonts and no JavaScript to run it. None of
// this can be a static list: split.css is served from a build-time-
// fingerprinted URL (head.html's `resources.Get | minify | fingerprint`), so
// its exact filename can't be hardcoded here, and the module entry point's
// own dependency graph shifts as the app's modules change — both are
// discovered by scanning the already-precached /songs/ page's own markup
// instead (findStylesheetHrefs/findScriptSrcs), same for the cross-origin
// Font Awesome stylesheet. Each stylesheet found is then scanned in turn
// (findCssUrls) for the webfont files its own @font-face rules point at, and
// each module script is scanned (findModuleImports) for the modules it
// imports, recursively — so this all stays in sync with the app's actual
// source automatically rather than needing separate hardcoded file lists.
function targetCacheFor(url) {
  const kind = classifyRequest({
    pathname: url.pathname,
    origin: url.origin,
    sameOrigin: url.origin === self.location.origin,
    mode: "cors",
  });
  return kind === "font-awesome" ? FONT_AWESOME_CACHE : SHELL_CACHE;
}

// `required`: a same-origin asset (our own stylesheet, our own fonts, our
// own scripts and everything they import) is required — the app genuinely
// can't run offline without it, so a failure here rejects, which rejects
// the whole precacheShell() chain and fails installation; the browser
// retries installing this same worker version on a later registration
// attempt instead of activating an incomplete one that looks done but
// silently can't run. A cross-origin asset (Font Awesome's stylesheet and
// its webfonts, from cdnjs) is optional — a missing icon font is a real but
// survivable degradation, not worth failing the whole install over, so a
// failure there is swallowed instead.
function precacheUrl(absoluteUrl, required) {
  const attempt = fetch(absoluteUrl).then((response) => {
    if (!response.ok) throw new Error(`${absoluteUrl}: ${response.status}`);
    return caches.open(targetCacheFor(new URL(absoluteUrl)))
      .then((cache) => cache.put(absoluteUrl, response.clone()))
      .then(() => response);
  });
  return required ? attempt : attempt.catch(() => null);
}

function precacheStylesheetAndFonts(href) {
  const absoluteHref = new URL(href, self.location.origin).href;
  const required = new URL(absoluteHref).origin === self.location.origin;
  return precacheUrl(absoluteHref, required).then((response) => {
    if (!response) return null;
    return response.clone().text().then((css) => Promise.all(
      findCssUrls(css)
        // A url() reference isn't always a real network resource — split.css's
        // hand-drawn dropdown chevron (see its own comment) is an inline
        // `url("data:image/svg+xml,...")`, already fully self-contained in the
        // stylesheet's own bytes. Cache.put() rejects a data: request outright
        // ("Request scheme 'data' is unsupported"), and there'd be nothing
        // worth fetching/caching there anyway.
        .filter((url) => !url.startsWith("data:"))
        .map((url) => precacheUrl(new URL(url, absoluteHref).href, required)),
    ));
  });
}

// A same-origin <script>'s own src, plus — for a type="module" entry point —
// every module it statically imports, recursively (findModuleImports scans
// the fetched source text the same way findCssUrls scans a stylesheet's).
// `seen` de-dupes across the whole recursive walk (many modules share
// imports like lib/dom.js) so each file is fetched once. A classic,
// non-module script (ABCJS/Tonal/lamejs) has no import statements to find,
// so this is a one-step fetch for those. Every script this app serves is
// same-origin, so this is always `required` (see precacheUrl's own doc
// comment) — a missing script/module means the app can't run at all.
function precacheScriptAndImports(src, seen) {
  const absoluteSrc = new URL(src, self.location.origin).href;
  if (seen.has(absoluteSrc)) return Promise.resolve(null);
  seen.add(absoluteSrc);
  return precacheUrl(absoluteSrc, true).then((response) => {
    if (!response) return null;
    return response.clone().text().then((js) => Promise.all(
      findModuleImports(js).map((spec) => precacheScriptAndImports(new URL(spec, absoluteSrc).href, seen)),
    ));
  });
}

function precacheShell() {
  return caches.open(SHELL_CACHE)
    .then((cache) => cache.addAll(PRECACHE_URLS).then(() => cache.match("/songs/")))
    .then((shellPage) => shellPage.text())
    .then((html) => {
      const seenScripts = new Set();
      return Promise.all([
        ...findStylesheetHrefs(html).map(precacheStylesheetAndFonts),
        ...findScriptSrcs(html).map((src) => precacheScriptAndImports(src, seenScripts)),
      ]);
    });
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.has(name))
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

// Fetches, and — for a genuinely successful response — writes it into the
// cache before resolving, returning the response either way. The write is
// chained into the returned promise rather than fired-and-forgotten inside
// the .then(): both cacheFirstRevalidate and cacheFirstOnly below hand this
// promise to something that ends the worker's extended lifetime the instant
// it resolves (event.waitUntil() on one path, event.respondWith() on the
// other) — if the cache.put() weren't part of what's being waited on, the
// worker would be free to be killed right after the response is handed
// back, potentially aborting the write before it finishes and silently
// dropping the update.
function fetchAndCache(request, cache) {
  return fetch(request).then((response) => {
    const stored = response.ok ? cache.put(request, response.clone()) : Promise.resolve();
    return stored.then(() => response);
  });
}

// Cache-first, but always also refetches in the background and updates the
// cache — an offline visit is instant even off a stale copy, and the next
// visit (online) picks up whatever changed (a new/edited song, a setlist
// update, a code fix) without needing a whole new CACHE_VERSION. The
// revalidation fetch/cache-write is handed to event.waitUntil() even on a
// cache hit (where it isn't part of the value returned to the page) — the
// worker is otherwise free to be killed the instant this promise resolves,
// which could abort that background fetch or its cache.put before either
// finishes and silently drop the update.
function cacheFirstRevalidate(request, cacheName, event) {
  return caches.open(cacheName).then((cache) => cache.match(request).then((cached) => {
    const revalidate = fetchAndCache(request, cache).catch(() => cached);
    if (cached) {
      event.waitUntil(revalidate);
      return cached;
    }
    return revalidate;
  }));
}

// Same shape, but never refetches once cached — for content that's
// immutable once published (an audio sample, a webfont file), so there's
// nothing to ever catch up on. No event.waitUntil() needed here the way
// cacheFirstRevalidate's cache-hit path needs one: on a miss, the fetch (and
// now its chained cache write) is already the exact promise handed to
// event.respondWith(), so the worker's extended lifetime already covers it.
function cacheFirstOnly(request, cacheName) {
  return caches.open(cacheName).then((cache) => cache.match(request).then((cached) => (
    cached || fetchAndCache(request, cache)
  )));
}

// A page load: prefer a live network response (so a content/code update is
// seen immediately when online), falling back to whatever's cached for that
// exact URL, and finally to the precached /songs/ shell — so a reload while
// offline never just shows the browser's own "no internet" page. Only a
// genuinely successful response is cached: an HTTP error response would
// otherwise overwrite a previously-cached, working page with a 404/500, and
// the next offline reload would serve that broken response as if it were
// the real fallback. The cache write itself goes through event.waitUntil()
// for the same early-termination reason cacheFirstRevalidate's does above.
function navigate(request, event) {
  return fetch(request).then((response) => {
    if (response.ok) {
      event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(request, response.clone())));
    }
    return response;
  }).catch(() => caches.match(request).then((cached) => cached || caches.match("/songs/")));
}

const STRATEGIES = {
  navigate,
  shell: (request, event) => cacheFirstRevalidate(request, SHELL_CACHE, event),
  soundfont: (request) => cacheFirstOnly(request, SOUNDFONT_CACHE),
  "font-awesome": (request) => cacheFirstOnly(request, FONT_AWESOME_CACHE),
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const kind = classifyRequest({
    pathname: url.pathname,
    origin: url.origin,
    sameOrigin: url.origin === self.location.origin,
    mode: request.mode,
  });
  const strategy = STRATEGIES[kind];
  if (strategy) event.respondWith(strategy(request, event));
});
