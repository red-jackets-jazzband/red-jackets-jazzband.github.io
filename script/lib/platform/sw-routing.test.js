import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRequest, fingerprintStem } from "./sw-routing.js";

const OWN_ORIGIN = "https://red-jackets-jazzband.github.io";
const SOUNDFONT_ORIGIN = "https://gleitz.github.io";
const FONT_AWESOME_ORIGIN = "https://cdnjs.cloudflare.com";

function classify(pathname, origin, mode) {
  return classifyRequest({
    pathname, origin, sameOrigin: origin === OWN_ORIGIN, mode,
  });
}

test("a navigation request to the app is classified 'navigate'", () => {
  assert.equal(classify("/songs/", OWN_ORIGIN, "navigate"), "navigate");
});

test("a cross-origin navigation is left alone", () => {
  assert.equal(classify("/", "https://example.com", "navigate"), null);
});

test("same-origin app shell/data paths are classified 'shell'", () => {
  for (const path of [
    "/songs/", "/songs/bourbon_street_parade.abc", "/songs/index_of_songs.txt",
    "/script/songs-page.js", "/script/songs/app.js", "/script/lib/setlist-format.js",
    "/setlists/setlist_2026.txt", "/tour/tour.en.md",
    "/css/split.min.abc12345.css", "/fonts/Montserrat-latin.woff2", "/fonts/Saniretro.woff",
    "/images/icons/icon-512.png", "/manifest.webmanifest", "/manifest.nl.webmanifest",
  ]) {
    assert.equal(classify(path, OWN_ORIGIN, "cors"), "shell", path);
  }
});

test("a same-origin path outside the /songs/ app is left alone", () => {
  for (const path of ["/", "/agenda/", "/band/", "/in-action/", "/nl/agenda/"]) {
    assert.equal(classify(path, OWN_ORIGIN, "cors"), null, path);
  }
});

test("a soundfont sample request is classified 'soundfont'", () => {
  assert.equal(
    classify("/midi-js-soundfonts/FatBoy/trumpet-mp3/C4.mp3", SOUNDFONT_ORIGIN, "cors"),
    "soundfont",
  );
});

// Font Awesome is self-hosted now (assets/css/icons.css); cdnjs is just
// another cross-origin host.
test("a cdnjs request is left alone", () => {
  assert.equal(
    classify("/ajax/libs/font-awesome/6.7.2/css/all.min.css", FONT_AWESOME_ORIGIN, "cors"),
    null,
  );
});

test("an unrelated cross-origin request is left alone", () => {
  assert.equal(classify("/track", "https://example-analytics.com", "cors"), null);
});

const HASH = "a".repeat(64);

test("fingerprintStem takes the content hash out of a fingerprinted file's path", () => {
  assert.equal(fingerprintStem(`/script/songs-app.${HASH}.js`), "/script/songs-app.js");
  assert.equal(fingerprintStem(`/css/split.min.${HASH}.css`), "/css/split.min.css");
});

test("fingerprintStem leaves every other path alone", () => {
  assert.equal(fingerprintStem("/script/songs-page.js"), null);
  assert.equal(fingerprintStem("/songs/bill_bailey.abc"), null);
  assert.equal(fingerprintStem(`/fonts/x.${HASH}.woff2`), null);
  assert.equal(fingerprintStem("/script/lib.short.js"), null);
  assert.equal(fingerprintStem("/noext"), null);
});
