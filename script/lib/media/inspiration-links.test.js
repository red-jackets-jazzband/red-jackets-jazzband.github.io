import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyInspirationUrl, parseInspirationLinks, firstLinkPerType,
  firstYoutubeUrl, firstSpotifyUrl, firstSoundcloudUrl,
  OTHER_LINK_TYPE,
} from "./inspiration-links.js";

const YOUTUBE_URL = "https://youtu.be/aaa";
const SPOTIFY_URL = "https://open.spotify.com/track/1";
const SOUNDCLOUD_URL = "https://soundcloud.com/someone/a-track";

test("classifyInspirationUrl recognizes youtube hosts", () => {
  assert.equal(classifyInspirationUrl("https://www.youtube.com/watch?v=abc"), "youtube");
  assert.equal(classifyInspirationUrl("https://youtu.be/abc"), "youtube");
});

test("classifyInspirationUrl recognizes spotify, soundcloud and secondhandsongs", () => {
  assert.equal(classifyInspirationUrl("https://open.spotify.com/track/abc"), "spotify");
  assert.equal(classifyInspirationUrl("https://soundcloud.com/someone/a-track"), "soundcloud");
  assert.equal(classifyInspirationUrl("https://secondhandsongs.com/work/12345"), "secondhandsongs");
});

test("classifyInspirationUrl falls back to OTHER_LINK_TYPE for an unrecognized host", () => {
  assert.equal(classifyInspirationUrl("https://example.com/song"), OTHER_LINK_TYPE);
});

test("classifyInspirationUrl treats a lookalike hostname as OTHER_LINK_TYPE, not the real type", () => {
  assert.equal(classifyInspirationUrl("https://notyoutube.com/watch?v=abc"), OTHER_LINK_TYPE);
  assert.equal(classifyInspirationUrl("https://secondhandsongs.com.evil.example/x"), OTHER_LINK_TYPE);
});

test("classifyInspirationUrl rejects non-http(s) protocols and unparseable input", () => {
  assert.equal(classifyInspirationUrl("ftp://example.com/song.mp3"), null);
  assert.equal(classifyInspirationUrl("not a url"), null);
  assert.equal(classifyInspirationUrl(undefined), null);
});

test("parseInspirationLinks splits abcjs's newline-joined metaText.url", () => {
  const meta = [
    "https://www.youtube.com/watch?v=Skl3M9sPGyc",
    "https://open.spotify.com/track/abc",
    "https://secondhandsongs.com/work/12345",
  ].join("\n");
  assert.deepEqual(parseInspirationLinks(meta), [
    { url: "https://www.youtube.com/watch?v=Skl3M9sPGyc", type: "youtube" },
    { url: "https://open.spotify.com/track/abc", type: "spotify" },
    { url: "https://secondhandsongs.com/work/12345", type: "secondhandsongs" },
  ]);
});

test("parseInspirationLinks drops blank lines and unparseable entries", () => {
  const meta = "\n  \nhttps://open.spotify.com/track/abc\nnot a url\n";
  assert.deepEqual(parseInspirationLinks(meta), [
    { url: "https://open.spotify.com/track/abc", type: "spotify" },
  ]);
});

test("parseInspirationLinks returns an empty array for a tune with no F: field", () => {
  assert.deepEqual(parseInspirationLinks(undefined), []);
  assert.deepEqual(parseInspirationLinks(""), []);
});

test("firstLinkPerType keeps only the first link of each type, in order", () => {
  const links = [
    { url: YOUTUBE_URL, type: "youtube" },
    { url: SPOTIFY_URL, type: "spotify" },
    { url: "https://open.spotify.com/track/2", type: "spotify" },
    { url: "https://soundcloud.com/x/y", type: "soundcloud" },
  ];
  assert.deepEqual(firstLinkPerType(links), [
    { url: YOUTUBE_URL, type: "youtube" },
    { url: SPOTIFY_URL, type: "spotify" },
    { url: "https://soundcloud.com/x/y", type: "soundcloud" },
  ]);
});

test("firstYoutubeUrl returns the tune's YouTube link's url", () => {
  const links = [
    { url: SPOTIFY_URL, type: "spotify" },
    { url: YOUTUBE_URL, type: "youtube" },
  ];
  assert.equal(firstYoutubeUrl(links), YOUTUBE_URL);
});

test("firstYoutubeUrl returns undefined (not null) when there's no YouTube link", () => {
  assert.equal(firstYoutubeUrl([{ url: SPOTIFY_URL, type: "spotify" }]), undefined);
  assert.equal(firstYoutubeUrl([]), undefined);
});

test("firstSpotifyUrl returns the tune's Spotify link's url", () => {
  const links = [
    { url: YOUTUBE_URL, type: "youtube" },
    { url: SPOTIFY_URL, type: "spotify" },
  ];
  assert.equal(firstSpotifyUrl(links), SPOTIFY_URL);
});

test("firstSpotifyUrl returns undefined (not null) when there's no Spotify link", () => {
  assert.equal(firstSpotifyUrl([{ url: YOUTUBE_URL, type: "youtube" }]), undefined);
  assert.equal(firstSpotifyUrl([]), undefined);
});

test("firstSoundcloudUrl returns the tune's SoundCloud link's url", () => {
  const links = [
    { url: YOUTUBE_URL, type: "youtube" },
    { url: SOUNDCLOUD_URL, type: "soundcloud" },
  ];
  assert.equal(firstSoundcloudUrl(links), SOUNDCLOUD_URL);
});

test("firstSoundcloudUrl returns undefined (not null) when there's no SoundCloud link", () => {
  assert.equal(firstSoundcloudUrl([{ url: YOUTUBE_URL, type: "youtube" }]), undefined);
  assert.equal(firstSoundcloudUrl([]), undefined);
});
