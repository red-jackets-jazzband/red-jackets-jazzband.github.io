import { test } from "node:test";
import assert from "node:assert/strict";
import { firstYoutubeIdFromAbc, buildYoutubePlaylistUrl } from "./setlist-listen.js";

test("firstYoutubeIdFromAbc reads the id off a watch?v= F: line", () => {
  const abc = "X:1\nT:Song\nF:https://www.youtube.com/watch?v=Skl3M9sPGyc\nK:Bb\nB2|";
  assert.equal(firstYoutubeIdFromAbc(abc), "Skl3M9sPGyc");
});

test("firstYoutubeIdFromAbc skips non-YouTube F: lines and picks the first YouTube one", () => {
  const abc = [
    "X:1", "T:Song",
    "F:https://open.spotify.com/track/1aMsRRHfNJdXJBSi4qcHNq",
    "F:https://youtu.be/Skl3M9sPGyc",
    "F:https://soundcloud.com/only-new-jazz-band/bourbon-street-parade",
    "K:Bb", "B2|",
  ].join("\n");
  assert.equal(firstYoutubeIdFromAbc(abc), "Skl3M9sPGyc");
});

test("firstYoutubeIdFromAbc returns null with no F: field, or no YouTube one", () => {
  assert.equal(firstYoutubeIdFromAbc("X:1\nT:Song\nK:Bb\nB2|"), null);
  assert.equal(
    firstYoutubeIdFromAbc("X:1\nT:Song\nF:https://open.spotify.com/track/xyz\nK:Bb\nB2|"),
    null,
  );
});

test("firstYoutubeIdFromAbc returns null for non-string input", () => {
  assert.equal(firstYoutubeIdFromAbc(undefined), null);
  assert.equal(firstYoutubeIdFromAbc(null), null);
});

test("buildYoutubePlaylistUrl joins ids in order into a watch_videos URL", () => {
  assert.equal(
    buildYoutubePlaylistUrl(["aaaaaaaaaaa", "bbbbbbbbbbb"]),
    "https://www.youtube.com/watch_videos?video_ids=aaaaaaaaaaa,bbbbbbbbbbb",
  );
});

test("buildYoutubePlaylistUrl dedupes repeats and drops falsy entries", () => {
  assert.equal(
    buildYoutubePlaylistUrl(["aaaaaaaaaaa", null, "bbbbbbbbbbb", "aaaaaaaaaaa"]),
    "https://www.youtube.com/watch_videos?video_ids=aaaaaaaaaaa,bbbbbbbbbbb",
  );
});

test("buildYoutubePlaylistUrl returns null with no usable ids", () => {
  assert.equal(buildYoutubePlaylistUrl([]), null);
  assert.equal(buildYoutubePlaylistUrl([null, undefined]), null);
});
