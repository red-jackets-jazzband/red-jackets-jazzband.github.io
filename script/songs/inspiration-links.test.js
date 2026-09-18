import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { updateInspirationExtLinks } from "./inspiration-links.js";
import { parseInspirationLinks } from "../lib/inspiration-links.js";

function inDom(fn) {
  const page = mountPage();
  try {
    return fn(page);
  } finally {
    page.cleanup();
  }
}

const LINKS = parseInspirationLinks([
  "https://www.youtube.com/watch?v=Skl3M9sPGyc",
  "https://open.spotify.com/track/abc",
  "https://soundcloud.com/someone/a-track",
  "https://secondhandsongs.com/work/12345",
].join("\n"));

test("updateInspirationExtLinks creates a button per non-YouTube link, in order", () => {
  inDom(() => {
    updateInspirationExtLinks(LINKS);
    const slot = document.getElementById("inspirationSlot");
    const ids = [...slot.querySelectorAll('[id^="inspirationExtLink-"]')].map((n) => n.id);
    assert.deepEqual(ids, [
      "inspirationExtLink-spotify",
      "inspirationExtLink-soundcloud",
      "inspirationExtLink-secondhandsongs",
    ]);
  });
});

test("updateInspirationExtLinks never puts a link in the #sheetActions export pill", () => {
  inDom(() => {
    updateInspirationExtLinks(LINKS);
    const sheetActions = document.getElementById("sheetActions");
    assert.equal(sheetActions.querySelectorAll('[id^="inspirationExtLink-"]').length, 0);
  });
});

test("updateInspirationExtLinks skips the YouTube link (handled by the docked panel instead)", () => {
  inDom(() => {
    updateInspirationExtLinks(LINKS);
    assert.equal(document.getElementById("inspirationExtLink-youtube"), null);
  });
});

test("updateInspirationExtLinks opens each link in a new tab without leaking window.opener", () => {
  inDom(() => {
    updateInspirationExtLinks(LINKS);
    const spotify = document.getElementById("inspirationExtLink-spotify");
    assert.equal(spotify.getAttribute("href"), "https://open.spotify.com/track/abc");
    assert.equal(spotify.target, "_blank");
    assert.equal(spotify.rel, "noopener noreferrer");
  });
});

test("updateInspirationExtLinks clears stale buttons on re-render for a tune with fewer links", () => {
  inDom(() => {
    updateInspirationExtLinks(LINKS);
    updateInspirationExtLinks(parseInspirationLinks("https://open.spotify.com/track/xyz"));
    const slot = document.getElementById("inspirationSlot");
    const ids = [...slot.querySelectorAll('[id^="inspirationExtLink-"]')].map((n) => n.id);
    assert.deepEqual(ids, ["inspirationExtLink-spotify"]);
    assert.equal(
      document.getElementById("inspirationExtLink-spotify").getAttribute("href"),
      "https://open.spotify.com/track/xyz",
    );
  });
});

test("updateInspirationExtLinks removes every button for a tune with no other links", () => {
  inDom(() => {
    updateInspirationExtLinks(LINKS);
    updateInspirationExtLinks([]);
    const slot = document.getElementById("inspirationSlot");
    assert.equal(slot.querySelectorAll('[id^="inspirationExtLink-"]').length, 0);
  });
});
