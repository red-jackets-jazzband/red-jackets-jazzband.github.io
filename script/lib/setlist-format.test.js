import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSetlistFile, serializeSetlistFile } from "./setlist-format.js";

const BASIN_STREET = "basin_street.abc";

test("parseSetlistFile reads name, desc, and songs with optional key overrides", () => {
  const text = [
    "# name,Zeeland Jazz 2026",
    "# desc,Our main summer set.",
    `${BASIN_STREET},C`,
    "auld_lang_syne.abc,",
    "aint_my_fault.abc,Am",
  ].join("\n");

  const setlist = parseSetlistFile(text);
  assert.equal(setlist.name, "Zeeland Jazz 2026");
  assert.equal(setlist.desc, "Our main summer set.");
  assert.deepEqual(setlist.songs, [
    { file: BASIN_STREET, key: "C" },
    { file: "auld_lang_syne.abc", key: "" },
    { file: "aint_my_fault.abc", key: "Am" },
  ]);
});

test("parseSetlistFile works with no name/desc comments at all", () => {
  const setlist = parseSetlistFile(`${BASIN_STREET},\n`);
  assert.equal(setlist.name, null);
  assert.equal(setlist.desc, null);
  assert.deepEqual(setlist.songs, [{ file: BASIN_STREET, key: "" }]);
});

test("parseSetlistFile skips blank lines and unrecognized comment lines", () => {
  const text = `# some other comment\n\n${BASIN_STREET},\n\n`;
  const setlist = parseSetlistFile(text);
  assert.deepEqual(setlist.songs, [{ file: BASIN_STREET, key: "" }]);
});

test("parseSetlistFile splits the list into sets on '# break' lines", () => {
  const text = [
    "# name,Festival night",
    `${BASIN_STREET},C`,
    "# break",
    "tiger_rag.abc,",
    "# break,Encores",
    "indiana.abc,",
  ].join("\n");

  const setlist = parseSetlistFile(text);
  assert.deepEqual(setlist.songs, [
    { file: BASIN_STREET, key: "C" },
    { divider: "" },
    { file: "tiger_rag.abc", key: "" },
    { divider: "Encores" },
    { file: "indiana.abc", key: "" },
  ]);
});

test("serializeSetlistFile writes set dividers back as '# break' lines and round-trips", () => {
  const original = {
    name: "Three sets",
    desc: "",
    songs: [
      { file: "a.abc", key: "" },
      { divider: "" },
      { file: "b.abc", key: "Bb" },
      { divider: "Last set" },
      { file: "c.abc", key: "" },
    ],
  };
  const text = serializeSetlistFile(original);
  assert.match(text, /\n# break\n/);
  assert.match(text, /\n# break,Last set\n/);
  assert.deepEqual(parseSetlistFile(text).songs, original.songs);
});

test("serializeSetlistFile round-trips through parseSetlistFile", () => {
  const original = {
    name: "Rehearsal Tuesday",
    desc: "",
    songs: [
      { file: BASIN_STREET, key: "Bb" },
      { file: "tiger_rag.abc", key: "" },
    ],
  };
  const text = serializeSetlistFile(original);
  const parsed = parseSetlistFile(text);
  assert.equal(parsed.name, original.name);
  assert.deepEqual(parsed.songs, original.songs);
});
