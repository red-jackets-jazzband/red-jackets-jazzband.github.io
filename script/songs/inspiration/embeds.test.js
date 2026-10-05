import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import {
  emptySources, resolveSources, defaultTab, sourcesKey, TAB_KEYS, updateTabButtonsUi, setExpandLink,
} from "./embeds.js";

const YT = "https://youtu.be/abcdefghijk";
const SPOTIFY = "https://open.spotify.com/track/2EYjaK8Koe0q7PcK1MlB4S";
const SOUNDCLOUD = "https://soundcloud.com/someone/a-track";

test("emptySources has every tab key unset", () => {
  assert.deepEqual(emptySources(), { youtube: null, spotify: null, soundcloud: null });
});

test("resolveSources keeps valid links and drops ones that don't parse for their service", () => {
  assert.deepEqual(
    resolveSources({ youtube: YT, spotify: "https://example.com/nope", soundcloud: SOUNDCLOUD }),
    { youtube: YT, spotify: null, soundcloud: SOUNDCLOUD },
  );
  assert.deepEqual(resolveSources({ youtube: "not a url" }), emptySources());
});

test("defaultTab prefers YouTube, then the first plain embed in TAB_KEYS order", () => {
  assert.equal(defaultTab({ youtube: YT, spotify: SPOTIFY }), "youtube");
  assert.equal(defaultTab({ youtube: null, spotify: null, soundcloud: SOUNDCLOUD }), "soundcloud");
  assert.equal(defaultTab({ youtube: null, spotify: SPOTIFY, soundcloud: SOUNDCLOUD }), TAB_KEYS[1]);
  assert.equal(defaultTab(emptySources()), undefined);
});

test("sourcesKey is stable per source triple and differs when any source differs", () => {
  const a = { youtube: YT, spotify: SPOTIFY, soundcloud: null };
  assert.equal(sourcesKey(a), sourcesKey({ ...a }));
  assert.notEqual(sourcesKey(a), sourcesKey({ ...a, spotify: null }));
});

test("updateTabButtonsUi marks only the chosen tab active and selected", () => {
  const page = mountPage({
    html: '<button id="inspirationTabYoutube"></button><button id="inspirationTabSpotify"></button><button id="inspirationTabSoundcloud"></button>',
  });
  try {
    updateTabButtonsUi("spotify");
    const state = (id) => {
      const btn = document.getElementById(id);
      return [btn.classList.contains("active"), btn.getAttribute("aria-selected")];
    };
    assert.deepEqual(state("inspirationTabYoutube"), [false, "false"]);
    assert.deepEqual(state("inspirationTabSpotify"), [true, "true"]);
    assert.deepEqual(state("inspirationTabSoundcloud"), [false, "false"]);
  } finally {
    page.cleanup();
  }
});

test("setExpandLink points the header link at the shown source, and tolerates its absence", () => {
  const page = mountPage({ html: '<a id="inspirationExpandBtn" href="#"></a>' });
  try {
    setExpandLink(SPOTIFY, "Spotify");
    const link = document.getElementById("inspirationExpandBtn");
    assert.equal(link.getAttribute("href"), SPOTIFY);
    assert.equal(link.title, "Open on Spotify");
    assert.equal(link.getAttribute("aria-label"), "Open on Spotify");
    link.remove();
    assert.doesNotThrow(() => setExpandLink(YT, "YouTube"));
  } finally {
    page.cleanup();
  }
});
