import { test } from "node:test";
import assert from "node:assert/strict";
import { extractYouTubeId, youtubeEmbedUrl } from "./youtube.js";

const SHORT_URL = "https://youtu.be/AqL60Xv_Sbc";

test("extractYouTubeId handles watch?v= urls", () => {
  assert.equal(extractYouTubeId("https://www.youtube.com/watch?v=q3HADwaCnkE"), "q3HADwaCnkE");
});

test("extractYouTubeId handles watch?v= urls with trailing params", () => {
  assert.equal(
    extractYouTubeId("https://www.youtube.com/watch?v=Kso7bHUq9A8&list=RDKso7bHUq9A8"),
    "Kso7bHUq9A8",
  );
});

test("extractYouTubeId handles youtu.be short links", () => {
  assert.equal(extractYouTubeId(SHORT_URL), "AqL60Xv_Sbc");
});

test("extractYouTubeId trims surrounding whitespace", () => {
  assert.equal(extractYouTubeId(" https://youtu.be/T5YViTLS00Q "), "T5YViTLS00Q");
});

test("extractYouTubeId handles /embed/ urls", () => {
  assert.equal(extractYouTubeId("https://www.youtube.com/embed/q3HADwaCnkE"), "q3HADwaCnkE");
});

test("extractYouTubeId returns null for non-YouTube urls", () => {
  assert.equal(extractYouTubeId("https://example.com/song.mp3"), null);
});

test("extractYouTubeId rejects lookalike hostnames that merely contain youtube.com", () => {
  assert.equal(extractYouTubeId("https://notyoutube.com/watch?v=q3HADwaCnkE"), null);
  assert.equal(extractYouTubeId("https://youtube.com.evil.example/watch?v=q3HADwaCnkE"), null);
  assert.equal(extractYouTubeId("https://evil.example/?u=https://www.youtube.com/watch?v=q3HADwaCnkE"), null);
});

test("extractYouTubeId returns null for non-string input", () => {
  assert.equal(extractYouTubeId(undefined), null);
});

test("youtubeEmbedUrl builds a privacy-enhanced embed url", () => {
  assert.equal(
    youtubeEmbedUrl("https://www.youtube.com/watch?v=q3HADwaCnkE"),
    "https://www.youtube-nocookie.com/embed/q3HADwaCnkE?rel=0",
  );
});

test("youtubeEmbedUrl adds autoplay=1 when requested", () => {
  assert.equal(
    youtubeEmbedUrl(SHORT_URL, true),
    "https://www.youtube-nocookie.com/embed/AqL60Xv_Sbc?rel=0&autoplay=1",
  );
});

test("youtubeEmbedUrl returns null for an unrecognized url", () => {
  assert.equal(youtubeEmbedUrl("https://example.com/song.mp3"), null);
});

test("youtubeEmbedUrl adds the JS API params when jsApi is set", () => {
  assert.equal(
    youtubeEmbedUrl(SHORT_URL, { autoplay: true, jsApi: true }),
    "https://www.youtube-nocookie.com/embed/AqL60Xv_Sbc?rel=0&autoplay=1&enablejsapi=1&playsinline=1&controls=0",
  );
});

test("youtubeEmbedUrl appends an encoded origin when given", () => {
  assert.equal(
    youtubeEmbedUrl(SHORT_URL, { jsApi: true, origin: "https://www.redjackets.nl" }),
    "https://www.youtube-nocookie.com/embed/AqL60Xv_Sbc?rel=0&enablejsapi=1&playsinline=1&controls=0&origin=https%3A%2F%2Fwww.redjackets.nl",
  );
});

test("youtubeEmbedUrl hides native controls only in jsApi mode", () => {
  assert.equal(
    youtubeEmbedUrl(SHORT_URL, { autoplay: true }),
    "https://www.youtube-nocookie.com/embed/AqL60Xv_Sbc?rel=0&autoplay=1",
  );
});
