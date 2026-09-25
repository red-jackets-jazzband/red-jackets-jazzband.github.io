import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRequest } from "./sw-routing.js";

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
    "/images/icons/icon-512.png", "/manifest.webmanifest",
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

test("a Font Awesome asset is classified 'font-awesome'", () => {
  assert.equal(
    classify("/ajax/libs/font-awesome/6.7.2/css/all.min.css", FONT_AWESOME_ORIGIN, "cors"),
    "font-awesome",
  );
});

test("an unrelated cross-origin request is left alone", () => {
  assert.equal(classify("/track", "https://example-analytics.com", "cors"), null);
});
