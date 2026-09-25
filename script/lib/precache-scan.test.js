import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findStylesheetHrefs, findScriptSrcs, findCssUrls, findModuleImports,
} from "./precache-scan.js";

test("finds a same-origin fingerprinted stylesheet href", () => {
  const html = '<head><link rel="stylesheet" href="/css/split.min.abc123.css" integrity="sha384-x"></head>';
  assert.deepEqual(findStylesheetHrefs(html), ["/css/split.min.abc123.css"]);
});

test("finds multiple stylesheet links, ignoring non-stylesheet links", () => {
  const html = [
    '<link rel="icon" href="/favicon.ico">',
    '<link rel="stylesheet" href="/css/split.min.abc123.css">',
    '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css">',
  ].join("\n");
  assert.deepEqual(findStylesheetHrefs(html), [
    "/css/split.min.abc123.css",
    "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css",
  ]);
});

test("returns nothing when there are no stylesheet links", () => {
  assert.deepEqual(findStylesheetHrefs("<head><title>x</title></head>"), []);
});

test("ignores a link tag with rel before href with no closing '>' left dangling", () => {
  assert.deepEqual(findStylesheetHrefs('<link rel="stylesheet" href="/a.css"'), []);
});

test("finds every <script src> in a page, classic and module alike", () => {
  const html = [
    '<script src="/script/abcjs_midi_6.7.0-min.js" type="text/javascript" defer></script>',
    '<script src="/script/tonal.4.6.9-min.js" type="text/javascript" defer></script>',
    '<script type="module" src="/script/songs-page.js"></script>',
  ].join("\n");
  assert.deepEqual(findScriptSrcs(html), [
    "/script/abcjs_midi_6.7.0-min.js",
    "/script/tonal.4.6.9-min.js",
    "/script/songs-page.js",
  ]);
});

test("ignores an inline script with no src", () => {
  assert.deepEqual(findScriptSrcs('<script>console.log("hi")</script>'), []);
});

test("finds a bare, unquoted url()", () => {
  assert.deepEqual(findCssUrls("@font-face { src: url(/fonts/Lora-latin.woff2) format('woff2'); }"), [
    "/fonts/Lora-latin.woff2",
  ]);
});

test("finds double- and single-quoted url() alike, and strips the quotes", () => {
  const css = `
    @font-face { src: url("/fonts/Montserrat-latin.woff2") format("woff2"); }
    @font-face { src: url('/fonts/Saniretro.woff') format('woff'); }
  `;
  assert.deepEqual(findCssUrls(css), ["/fonts/Montserrat-latin.woff2", "/fonts/Saniretro.woff"]);
});

test("resolves relative webfont paths the same as any other url()", () => {
  const css = "@font-face { src: url(../webfonts/fa-solid-900.woff2) format('woff2'); }";
  assert.deepEqual(findCssUrls(css), ["../webfonts/fa-solid-900.woff2"]);
});

// A url() reference isn't always a real, fetchable network resource — an
// inline data: URI (split.css's hand-drawn dropdown chevron background-image,
// for one) is already fully self-contained in the stylesheet's own bytes.
// findCssUrls stays a plain, general scanner and returns it like any other
// url() value, unfiltered — deciding which of its results are worth actually
// fetching (never a data: URI — sw.js's own precacheStylesheetAndFonts skips
// those, since Cache.put() rejects that request scheme outright) is the
// caller's job, not this pure scanner's.
test("returns a data: URI verbatim, same as any other url() value", () => {
  const css = "select { background-image: url(\"data:image/svg+xml,%3Csvg%3E%3C/svg%3E\"); }";
  assert.deepEqual(findCssUrls(css), ["data:image/svg+xml,%3Csvg%3E%3C/svg%3E"]);
});

test("returns nothing when a css file has no url() references", () => {
  assert.deepEqual(findCssUrls("body { color: red; }"), []);
});

test("finds a single-line import specifier", () => {
  const js = 'import { byId, qsa } from "../lib/dom.js";\n';
  assert.deepEqual(findModuleImports(js), ["../lib/dom.js"]);
});

test("finds a multi-line import specifier", () => {
  const js = [
    "import {",
    "  createOffline,",
    "  somethingElse,",
    '} from "./offline.js";',
    "",
  ].join("\n");
  assert.deepEqual(findModuleImports(js), ["./offline.js"]);
});

test("finds several imports, including a bare side-effect import", () => {
  const js = [
    'import "./polyfill.js";',
    'import defaultExport from "./default.js";',
    'import { a, b } from "./named.js";',
  ].join("\n");
  assert.deepEqual(findModuleImports(js), ["./polyfill.js", "./default.js", "./named.js"]);
});

test("ignores an identifier that merely starts with the word 'import'", () => {
  assert.deepEqual(findModuleImports('const importantValue = "from nowhere";'), []);
});

test("ignores a commented-out import", () => {
  assert.deepEqual(findModuleImports('// import { x } from "./x.js";'), []);
});

test("returns nothing for a module with no imports", () => {
  assert.deepEqual(findModuleImports("export function foo() { return 1; }"), []);
});
