import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSongIndex,
  groupSongsByLetter,
  filterSongsByQuery,
  songTitleSlug,
} from "./song-index.js";

test("parseSongIndex parses Name,file.abc lines and skips blanks", () => {
  const text = "Ain't my fault,aint_my_fault.abc\n\nAll of me,all_of_me.abc\n";
  const songs = parseSongIndex(text);
  assert.deepEqual(songs, [
    { name: "Ain't my fault", file: "aint_my_fault.abc" },
    { name: "All of me", file: "all_of_me.abc" },
  ]);
});

test("parseSongIndex drops lines missing a name or file", () => {
  const text = "Good Line,good.abc\nNoFileHere\n,missing_name.abc\n";
  assert.deepEqual(parseSongIndex(text), [{ name: "Good Line", file: "good.abc" }]);
});

test("groupSongsByLetter groups by first letter, sorted alphabetically", () => {
  const songs = [
    { name: "Basin Street Blues", file: "basin_street.abc" },
    { name: "All of me", file: "all_of_me.abc" },
    { name: "Auld Lang Syne", file: "auld_lang_syne.abc" },
  ];
  const groups = groupSongsByLetter(songs);
  assert.deepEqual(
    groups.map((g) => g.letter),
    ["A", "B"],
  );
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[1].items.length, 1);
});

test("filterSongsByQuery is a case-insensitive substring match, empty query returns all", () => {
  const songs = [
    { name: "Basin Street Blues", file: "basin_street.abc" },
    { name: "All of me", file: "all_of_me.abc" },
  ];
  assert.deepEqual(filterSongsByQuery(songs, "basin"), [songs[0]]);
  assert.deepEqual(filterSongsByQuery(songs, "BLUES"), [songs[0]]);
  assert.deepEqual(filterSongsByQuery(songs, "  "), songs);
  assert.deepEqual(filterSongsByQuery(songs, ""), songs);
  assert.deepEqual(filterSongsByQuery(songs, "xyz"), []);
});

test("filterSongsByQuery forgives typos, word order, punctuation and accents, best matches first", () => {
  const songs = [
    { name: "Basin Street Blues", file: "basin_street.abc" },
    { name: "Ain't my fault", file: "aint_my_fault.abc" },
    { name: "Café Blues", file: "cafe.abc" },
    { name: "Blue Moon", file: "blue_moon.abc" },
  ];
  assert.deepEqual(filterSongsByQuery(songs, "basn"), [songs[0]]);
  assert.deepEqual(filterSongsByQuery(songs, "bsain street"), [songs[0]]);
  assert.deepEqual(filterSongsByQuery(songs, "street basin"), [songs[0]]);
  assert.deepEqual(filterSongsByQuery(songs, "aint my"), [songs[1]]);
  assert.deepEqual(filterSongsByQuery(songs, "cafe"), [songs[2]]);
  assert.deepEqual(filterSongsByQuery(songs, "blue"), [songs[2], songs[3], songs[0]].sort((a, b) => songs.indexOf(a) - songs.indexOf(b)));
  assert.deepEqual(filterSongsByQuery(songs, "blus moon"), [songs[3]]);
  assert.deepEqual(filterSongsByQuery(songs, "xyz"), []);
});

test("filterSongsByQuery keeps an apostrophe word whole and matches nothing for an unsearchable query", () => {
  const songs = [
    { name: "It's Wonderful", file: "its_wonderful.abc" },
    { name: "All of me", file: "all_of_me.abc" },
  ];
  assert.deepEqual(filterSongsByQuery(songs, "its wonderful"), [songs[0]]);
  assert.deepEqual(filterSongsByQuery(songs, "wonderful its"), [songs[0]]);
  assert.deepEqual(filterSongsByQuery(songs, "wonderful it\u2019s"), [songs[0]]);
  assert.deepEqual(filterSongsByQuery(songs, "東京"), []);
  assert.deepEqual(filterSongsByQuery(songs, "!!!"), []);
  assert.deepEqual(filterSongsByQuery(songs, "   "), songs);
  assert.deepEqual(filterSongsByQuery(songs, undefined), songs);
});

test("songTitleSlug returns the .abc basename", () => {
  assert.equal(songTitleSlug({ file: "auld_lang_syne.abc" }), "auld_lang_syne");
  assert.equal(songTitleSlug({ file: "" }), "");
  assert.equal(songTitleSlug({}), "");
});
