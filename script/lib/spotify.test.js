import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSpotifyItem, spotifyEmbedUrl, spotifyEmbedHeight } from "./spotify.js";

const TRACK_URL = "https://open.spotify.com/track/2EYjaK8Koe0q7PcK1MlB4S";

test("extractSpotifyItem handles a plain track link", () => {
  assert.deepEqual(extractSpotifyItem(TRACK_URL), { type: "track", id: "2EYjaK8Koe0q7PcK1MlB4S" });
});

test("extractSpotifyItem handles a locale-prefixed link", () => {
  assert.deepEqual(
    extractSpotifyItem("https://open.spotify.com/intl-de/track/2EYjaK8Koe0q7PcK1MlB4S"),
    { type: "track", id: "2EYjaK8Koe0q7PcK1MlB4S" },
  );
});

test("extractSpotifyItem handles album/playlist/episode/show/artist links", () => {
  assert.equal(extractSpotifyItem("https://open.spotify.com/album/2EYjaK8Koe0q7PcK1MlB4S").type, "album");
  assert.equal(extractSpotifyItem("https://open.spotify.com/playlist/2EYjaK8Koe0q7PcK1MlB4S").type, "playlist");
  assert.equal(extractSpotifyItem("https://open.spotify.com/episode/2EYjaK8Koe0q7PcK1MlB4S").type, "episode");
  assert.equal(extractSpotifyItem("https://open.spotify.com/show/2EYjaK8Koe0q7PcK1MlB4S").type, "show");
  assert.equal(extractSpotifyItem("https://open.spotify.com/artist/2EYjaK8Koe0q7PcK1MlB4S").type, "artist");
});

test("extractSpotifyItem trims surrounding whitespace and ignores a trailing ?si= param", () => {
  assert.deepEqual(
    extractSpotifyItem(` ${TRACK_URL}?si=abc123 `),
    { type: "track", id: "2EYjaK8Koe0q7PcK1MlB4S" },
  );
});

test("extractSpotifyItem accepts the legacy play.spotify.com host", () => {
  assert.equal(extractSpotifyItem("https://play.spotify.com/track/2EYjaK8Koe0q7PcK1MlB4S").type, "track");
});

test("extractSpotifyItem returns null for a non-Spotify url", () => {
  assert.equal(extractSpotifyItem("https://example.com/song.mp3"), null);
});

test("extractSpotifyItem rejects lookalike hostnames that merely contain spotify.com", () => {
  assert.equal(extractSpotifyItem("https://notspotify.com/track/2EYjaK8Koe0q7PcK1MlB4S"), null);
  assert.equal(extractSpotifyItem("https://open.spotify.com.evil.example/track/2EYjaK8Koe0q7PcK1MlB4S"), null);
});

test("extractSpotifyItem rejects an unrecognized content type or malformed id", () => {
  assert.equal(extractSpotifyItem("https://open.spotify.com/user/someone"), null);
  assert.equal(extractSpotifyItem("https://open.spotify.com/track/tooshort"), null);
});

test("extractSpotifyItem returns null for non-string input", () => {
  assert.equal(extractSpotifyItem(undefined), null);
});

test("spotifyEmbedUrl builds a dark-themed embed url", () => {
  assert.equal(
    spotifyEmbedUrl(TRACK_URL),
    "https://open.spotify.com/embed/track/2EYjaK8Koe0q7PcK1MlB4S?utm_source=generator&theme=0",
  );
});

test("spotifyEmbedUrl returns null for an unrecognized url", () => {
  assert.equal(spotifyEmbedUrl("https://example.com/song.mp3"), null);
});

test("spotifyEmbedHeight is compact for a track/episode, tall for album/playlist/show/artist", () => {
  assert.equal(spotifyEmbedHeight("track"), 152);
  assert.equal(spotifyEmbedHeight("episode"), 152);
  assert.equal(spotifyEmbedHeight("album"), 352);
  assert.equal(spotifyEmbedHeight("playlist"), 352);
  assert.equal(spotifyEmbedHeight("show"), 352);
  assert.equal(spotifyEmbedHeight("artist"), 352);
});
