import { test } from "node:test";
import assert from "node:assert/strict";
import {
  firstYoutubeIdFromAbc, buildYoutubePlaylistUrl, listenSourcesFromAbc, soundiizTrack,
  buildSoundiizPayload, soundiizShareUrl, SOUNDIIZ_MAX_TRACKS,
} from "./setlist-listen.js";

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

const SPOTIFY = "F:https://open.spotify.com/track/1aMsRRHfNJdXJBSi4qcHNq";
const YOUTUBE = "F:https://youtu.be/Skl3M9sPGyc";
const SOUNDCLOUD = "F:https://soundcloud.com/red-jackets-jazzband/04-love";
const abcWith = (...fields) => ["X:1", "T:Song", ...fields, "K:Bb", "B2|"].join("\n");

test("listenSourcesFromAbc reads a Spotify track, YouTube video and SoundCloud track off F: lines", () => {
  assert.deepEqual(listenSourcesFromAbc(abcWith(SOUNDCLOUD, YOUTUBE, SPOTIFY)), {
    youtubeId: "Skl3M9sPGyc",
    spotifyTrackId: "1aMsRRHfNJdXJBSi4qcHNq",
    soundcloudId: "red-jackets-jazzband/04-love",
  });
});

test("listenSourcesFromAbc ignores Spotify albums and SoundCloud sets/user pages", () => {
  const abc = abcWith(
    "F:https://open.spotify.com/album/1aMsRRHfNJdXJBSi4qcHNq",
    "F:https://soundcloud.com/red-jackets-jazzband/sets",
  );
  assert.deepEqual(listenSourcesFromAbc(abc), { youtubeId: null, spotifyTrackId: null, soundcloudId: null });
  assert.equal(listenSourcesFromAbc(abcWith("F:https://soundcloud.com/red-jackets-jazzband")).soundcloudId, null);
  assert.equal(listenSourcesFromAbc(undefined).youtubeId, null);
});

test("soundiizTrack prefers Spotify, then YouTube, then SoundCloud, always keeping the title", () => {
  const all = { spotifyTrackId: "sp", youtubeId: "yt", soundcloudId: "u/sc" };
  assert.deepEqual(soundiizTrack("A", all), { title: "A", platform: "spotify", id: "sp" });
  assert.deepEqual(soundiizTrack("A", { ...all, spotifyTrackId: null }), { title: "A", platform: "youtube", id: "yt" });
  assert.deepEqual(
    soundiizTrack("A", { spotifyTrackId: null, youtubeId: null, soundcloudId: "u/sc" }),
    { title: "A", platform: "soundcloud", id: "u/sc" },
  );
  assert.deepEqual(soundiizTrack("A", { spotifyTrackId: null, youtubeId: null, soundcloudId: null }), { title: "A" });
});

test("buildSoundiizPayload keeps setlist order, skips holes and folds repeats", () => {
  const none = { spotifyTrackId: null, youtubeId: null, soundcloudId: null };
  const songs = [];
  songs[0] = { title: "One", sources: { ...none, youtubeId: "yt" } };
  songs[2] = { title: "Two", sources: none };
  songs[3] = { title: "One", sources: { ...none, youtubeId: "yt" } };
  assert.deepEqual(buildSoundiizPayload("Gig", songs, "spotify"), {
    title: "Gig",
    sourceName: "Red Jackets Jazzband",
    destination: "spotify",
    tracklist: [{ title: "One", platform: "youtube", id: "yt" }, { title: "Two" }],
  });
  assert.equal(buildSoundiizPayload("Gig", [], "spotify"), null);
  const open = buildSoundiizPayload("Gig", songs);
  assert.equal(Object.hasOwn(open, "destination"), false);
});

test("buildSoundiizPayload caps the tracklist at the API's limit", () => {
  const songs = Array.from({ length: SOUNDIIZ_MAX_TRACKS + 5 }, (_, i) => ({ title: `S${i}`, sources: {} }));
  assert.equal(buildSoundiizPayload("Gig", songs, "spotify").tracklist.length, SOUNDIIZ_MAX_TRACKS);
});

test("soundiizShareUrl only accepts a successful reply pointing at a soundiiz.com import page", () => {
  const ok = "https://soundiiz.com/go/import-playlist/abc123";
  assert.equal(soundiizShareUrl({ status: "success", shareUrl: ok }), ok);
  assert.equal(soundiizShareUrl({ status: "error", shareUrl: ok }), null);
  assert.equal(soundiizShareUrl({ status: "success", shareUrl: "https://evil.example/go/import-playlist/x" }), null);
  assert.equal(soundiizShareUrl({ status: "success", shareUrl: "https://notsoundiiz.com/go/import-playlist/x" }), null);
  assert.equal(
    soundiizShareUrl({ status: "success", shareUrl: "https://www.soundiiz.com/go/import-playlist/x" }),
    "https://www.soundiiz.com/go/import-playlist/x",
  );
  assert.equal(soundiizShareUrl({ status: "success", shareUrl: "wss://soundiiz.com/go/import-playlist/x" }), null);
  assert.equal(soundiizShareUrl({ status: "success", shareUrl: "https://soundiiz.com/login" }), null);
  assert.equal(soundiizShareUrl({ status: "success", shareUrl: "not a url" }), null);
  assert.equal(soundiizShareUrl(null), null);
});
