import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSoundCloudUrl, soundcloudEmbedUrl, SOUNDCLOUD_EMBED_HEIGHT } from "./soundcloud.js";

const TRACK_URL = "https://soundcloud.com/someone/a-track";

test("extractSoundCloudUrl accepts a plain track link", () => {
  assert.equal(extractSoundCloudUrl(TRACK_URL), TRACK_URL);
});

test("extractSoundCloudUrl accepts the m. and on. subdomains", () => {
  assert.equal(extractSoundCloudUrl("https://m.soundcloud.com/someone/a-track"), "https://m.soundcloud.com/someone/a-track");
  assert.equal(extractSoundCloudUrl("https://on.soundcloud.com/abc123"), "https://on.soundcloud.com/abc123");
});

test("extractSoundCloudUrl trims surrounding whitespace", () => {
  assert.equal(extractSoundCloudUrl(` ${TRACK_URL} `), TRACK_URL);
});

test("extractSoundCloudUrl rejects the bare homepage (no path)", () => {
  assert.equal(extractSoundCloudUrl("https://soundcloud.com"), null);
  assert.equal(extractSoundCloudUrl("https://soundcloud.com/"), null);
});

test("extractSoundCloudUrl returns null for a non-SoundCloud url", () => {
  assert.equal(extractSoundCloudUrl("https://example.com/track.mp3"), null);
});

test("extractSoundCloudUrl rejects lookalike hostnames that merely contain soundcloud.com", () => {
  assert.equal(extractSoundCloudUrl("https://notsoundcloud.com/someone/a-track"), null);
  assert.equal(extractSoundCloudUrl("https://soundcloud.com.evil.example/someone/a-track"), null);
});

test("extractSoundCloudUrl returns null for non-string input", () => {
  assert.equal(extractSoundCloudUrl(undefined), null);
});

test("soundcloudEmbedUrl builds a gold-accented embed url", () => {
  assert.equal(
    soundcloudEmbedUrl(TRACK_URL),
    "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fsomeone%2Fa-track&color=%23e29d0f&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false",
  );
});

test("soundcloudEmbedUrl returns null for an unrecognized url", () => {
  assert.equal(soundcloudEmbedUrl("https://example.com/track.mp3"), null);
});

test("SOUNDCLOUD_EMBED_HEIGHT is a fixed player height", () => {
  assert.equal(SOUNDCLOUD_EMBED_HEIGHT, 166);
});
