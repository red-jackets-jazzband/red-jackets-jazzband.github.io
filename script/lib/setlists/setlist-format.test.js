import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSetlistFile, serializeSetlistFile } from "./setlist-format.js";

const BASIN_STREET = "basin_street.abc";
const TIGER_RAG = "tiger_rag.abc";

// Regression: a desc paragraph that happens to start with a literal markdown
// bullet ("- Bring your own stand.", entirely natural to type in a format
// sold as "just markdown") must NOT be treated as a song and must NOT flip
// the parser into list mode — doing so used to also swallow every line after
// it into a silent "Unrecognized line" attempt, since the header/list-phase
// transition used to be a bare "starts with '- '" shape sniff rather than
// checking the line actually parses as a link.
test("a desc paragraph starting with a markdown bullet stays in desc, not a song", () => {
  const text = [
    "# Summer Gig",
    "",
    "Meet at 18:00.",
    "- Bring your own stand.",
    "See you there!",
    "",
    "- [Bourbon Street Parade](/songs/bourbon_street_parade.abc)",
  ].join("\n");

  const setlist = parseSetlistFile(text);
  assert.equal(setlist.desc, "Meet at 18:00.\n- Bring your own stand.\nSee you there!");
  assert.deepEqual(setlist.songs, [{ file: "bourbon_street_parade.abc", key: "" }]);
  assert.deepEqual(setlist.warnings, []);
});

// Regression: once inside the song list, a line that doesn't parse as a song
// must be dropped, not silently turned into a bogus song entry via the old
// bare-CSV fallback (which accepted any non-empty string as a "file") — and
// it's reported in `warnings` so a lint step (scripts/lint-setlists.js) can
// catch it instead of it only surfacing as a broken row on the live site.
test("an unparseable line inside the song list is dropped and reported, not faked into a song", () => {
  const text = [
    "# Gig",
    `- [Bourbon Street Parade](/songs/${BASIN_STREET})`,
    "oops a typo not a link",
    "## Set 2",
    `- [Tiger Rag](/songs/${TIGER_RAG})`,
  ].join("\n");

  const setlist = parseSetlistFile(text);
  assert.deepEqual(setlist.songs, [
    { file: BASIN_STREET, key: "" },
    { divider: "Set 2" },
    { file: TIGER_RAG, key: "" },
  ]);
  assert.deepEqual(setlist.warnings, ['Unrecognized line: "oops a typo not a link"']);
});

test("parseSetlistFile reads a '# title', free-text desc, and song links with optional ?key=", () => {
  const text = [
    "# Zeeland Jazz 2026",
    "",
    "Our main summer set.",
    "",
    `- [Basin Street Blues](/songs/${BASIN_STREET}?key=C)`,
    "- [Auld Lang Syne](/songs/auld_lang_syne.abc)",
    "- [Ain't My Fault](/songs/aint_my_fault.abc?key=Am)",
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

test("parseSetlistFile reads a bare filename (no /songs/ prefix) in a song link", () => {
  const setlist = parseSetlistFile(`- [Basin Street Blues](${BASIN_STREET}?key=Bb)`);
  assert.deepEqual(setlist.songs, [{ file: BASIN_STREET, key: "Bb" }]);
});

test("parseSetlistFile ignores a song link's own text — only the target matters", () => {
  const a = parseSetlistFile(`- [Whatever Title I Type](/songs/${BASIN_STREET})`);
  const b = parseSetlistFile(`- [](/songs/${BASIN_STREET})`);
  assert.deepEqual(a.songs, b.songs);
});

test("parseSetlistFile reads a song link whose title itself contains a ]", () => {
  const setlist = parseSetlistFile(`- [Tiger Rag [instrumental]](/songs/${TIGER_RAG})`);
  assert.deepEqual(setlist.songs, [{ file: TIGER_RAG, key: "" }]);
});

test("parseSetlistFile keeps blank-line-separated desc paragraphs apart", () => {
  const text = [
    "# Festival night",
    "",
    "First paragraph.",
    "Still the first paragraph.",
    "",
    "Second paragraph.",
    "",
    `- [Basin Street Blues](/songs/${BASIN_STREET})`,
  ].join("\n");

  const setlist = parseSetlistFile(text);
  assert.equal(setlist.desc, "First paragraph.\nStill the first paragraph.\n\nSecond paragraph.");
});

test("parseSetlistFile works with no name/desc at all", () => {
  const setlist = parseSetlistFile(`- [Basin Street Blues](/songs/${BASIN_STREET})\n`);
  assert.equal(setlist.name, null);
  assert.equal(setlist.desc, null);
  assert.deepEqual(setlist.songs, [{ file: BASIN_STREET, key: "" }]);
});

test("parseSetlistFile skips blank lines", () => {
  const text = `\n- [Basin Street Blues](/songs/${BASIN_STREET})\n\n`;
  const setlist = parseSetlistFile(text);
  assert.deepEqual(setlist.songs, [{ file: BASIN_STREET, key: "" }]);
});

test("parseSetlistFile splits the list into sets on '##' headings", () => {
  const text = [
    "# Festival night",
    `- [Basin Street Blues](/songs/${BASIN_STREET}?key=C)`,
    "##",
    `- [Tiger Rag](/songs/${TIGER_RAG})`,
    "## Encores",
    "- [Indiana](/songs/indiana.abc)",
  ].join("\n");

  const setlist = parseSetlistFile(text);
  assert.deepEqual(setlist.songs, [
    { file: BASIN_STREET, key: "C" },
    { divider: "" },
    { file: TIGER_RAG, key: "" },
    { divider: "Encores" },
    { file: "indiana.abc", key: "" },
  ]);
});

test("parseSetlistFile attaches indented '> ' lines right after a song link as its multi-line note", () => {
  const text = [
    "# Festival night",
    `- [Basin Street Blues](/songs/${BASIN_STREET}?key=C)`,
    "  > Ben solos 2nd chorus.",
    "  > Watch the key change into the outro.",
    `- [Tiger Rag](/songs/${TIGER_RAG})`,
  ].join("\n");

  const setlist = parseSetlistFile(text);
  assert.deepEqual(setlist.songs, [
    { file: BASIN_STREET, key: "C", note: "Ben solos 2nd chorus.\nWatch the key change into the outro." },
    { file: TIGER_RAG, key: "" },
  ]);
});

test("parseSetlistFile treats a bare '>' inside a note as a blank line", () => {
  const text = [`- [Basin Street Blues](/songs/${BASIN_STREET})`, "  > First part.", "  >", "  > Second part."]
    .join("\n");
  const setlist = parseSetlistFile(text);
  assert.equal(setlist.songs[0].note, "First part.\n\nSecond part.");
});

test("parseSetlistFile drops a '> ' line with nothing to attach to", () => {
  const text = [
    "# Title",
    "> stray, before any song",
    `- [Basin Street Blues](/songs/${BASIN_STREET})`,
    "## Set 2",
    "> also stray",
  ].join("\n");
  const setlist = parseSetlistFile(text);
  assert.deepEqual(setlist.songs, [{ file: BASIN_STREET, key: "" }, { divider: "Set 2" }]);
});

test("serializeSetlistFile writes songs as markdown links, set dividers as '##' headings, and round-trips", () => {
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
  assert.match(text, /^- \[A\]\(\/songs\/a\.abc\)$/m);
  assert.match(text, /^- \[B\]\(\/songs\/b\.abc\?key=Bb\)$/m);
  assert.match(text, /\n\n##\n/);
  assert.match(text, /\n\n## Last set\n/);
  assert.deepEqual(parseSetlistFile(text).songs, original.songs);
});

// Regression: encodeURIComponent leaves "(" and ")" unescaped (they're in
// its own "unreserved" set), but parseMarkdownLink finds a link's target by
// scanning for the first ")" — an unescaped one inside the key value would
// be read as the link's own closing paren and truncate the value.
test("serializeSetlistFile escapes parens in a key override so it round-trips through the link", () => {
  const original = { name: "", desc: "", songs: [{ file: "a.abc", key: "Bb (capo 2)" }] };
  const text = serializeSetlistFile(original);
  // The query value's own parens are percent-escaped, not literal — only the
  // link syntax's own structural "(" / ")" (wrapping the whole target)
  // survive as real characters.
  assert.match(text, /\?key=[^()\n]*%28[^()\n]*%29[^()\n]*\)/);
  assert.deepEqual(parseSetlistFile(text).songs, original.songs);
});

test("serializeSetlistFile uses the given songName resolver for a link's text, ignored on parse", () => {
  const text = serializeSetlistFile(
    { name: "", desc: "", songs: [{ file: "a.abc", key: "" }] },
    { songName: (file) => `Real Title for ${file}` },
  );
  assert.match(text, /^- \[Real Title for a\.abc\]\(\/songs\/a\.abc\)$/m);
  assert.deepEqual(parseSetlistFile(text).songs, [{ file: "a.abc", key: "" }]);
});

test("serializeSetlistFile falls back to a humanized filename with no songName resolver", () => {
  const text = serializeSetlistFile({ name: "", desc: "", songs: [{ file: "some_old-song.abc", key: "" }] });
  assert.match(text, /^- \[Some Old Song\]\(\/songs\/some_old-song\.abc\)$/m);
});

test("serializeSetlistFile indents a multi-line note under its song link and round-trips", () => {
  const original = {
    name: "Rehearsal Tuesday",
    desc: "Line one.\n\nLine two after a blank line.",
    songs: [
      { file: BASIN_STREET, key: "Bb", note: "Ben solos.\nWatch the turnaround." },
      { file: TIGER_RAG, key: "" },
    ],
  };
  const text = serializeSetlistFile(original);
  assert.match(text, /\n {2}> Ben solos\.\n {2}> Watch the turnaround\.\n/);
  const parsed = parseSetlistFile(text);
  assert.equal(parsed.name, original.name);
  assert.equal(parsed.desc, original.desc);
  assert.deepEqual(parsed.songs, original.songs);
});

test("serializeSetlistFile omits an empty name/desc/note the same as before", () => {
  const text = serializeSetlistFile({ name: "", desc: "", songs: [{ file: "a.abc", key: "" }] });
  assert.equal(text, "- [A](/songs/a.abc)\n");
});

// Files exported before this markdown-flavored format existed must still
// import cleanly — the parser reads the older syntaxes too, it just never
// writes them back out.
test("parseSetlistFile still reads the old '# name,'/'# desc,'/'# break' comment syntax and bare song lines", () => {
  const text = [
    "# name,Zeeland Jazz 2026",
    "# desc,Our main summer set.",
    `${BASIN_STREET},C`,
    "# break",
    `${TIGER_RAG},`,
    "# break,Encores",
    "indiana.abc,",
  ].join("\n");

  const setlist = parseSetlistFile(text);
  assert.equal(setlist.name, "Zeeland Jazz 2026");
  assert.equal(setlist.desc, "Our main summer set.");
  assert.deepEqual(setlist.songs, [
    { file: BASIN_STREET, key: "C" },
    { divider: "" },
    { file: TIGER_RAG, key: "" },
    { divider: "Encores" },
    { file: "indiana.abc", key: "" },
  ]);
});

test("parseSetlistFile still reads the first markdown conversion's bare '<file>.abc,<key>' song lines", () => {
  const text = ["# Festival night", `${BASIN_STREET},C`, "## Encores", `${TIGER_RAG},`].join("\n");
  const setlist = parseSetlistFile(text);
  assert.deepEqual(setlist.songs, [
    { file: BASIN_STREET, key: "C" },
    { divider: "Encores" },
    { file: TIGER_RAG, key: "" },
  ]);
});

test("a re-export of an old-format file switches it over to the new link syntax", () => {
  const oldText = ["# name,Old Export", "# desc,Some notes", `${BASIN_STREET},`].join("\n");
  const newText = serializeSetlistFile(parseSetlistFile(oldText));
  assert.match(newText, /^# Old Export\n/);
  assert.match(newText, /- \[Basin Street\]\(\/songs\/basin_street\.abc\)/);
  assert.equal(newText.includes("# name,"), false);
  assert.equal(newText.includes("# desc,"), false);
  assert.equal(newText.includes(`${BASIN_STREET},`), false);
});
