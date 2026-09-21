import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flattenTourSteps,
  formatTourString,
  mergeTourLang,
  parseBody,
  parseTourMarkdown,
  resolveTourLang,
  tokenizeInline,
  tourStructureProblems,
} from "./tour-content.js";

const SAMPLE = `# ui
next: Next
step: Step {n} of {total}

# basics: Basics
setup: showLibrary

## search: Find a song
target: #songSearch, #songRail
setup: openDemoSong, openDrawer
interactive: true

Type a **title**, or press \`/\`.
Second line of the same paragraph.

- one
- two

## print: Print it
target: #printLink
Just a body, no blank line after the metadata.

# mixer: Mixer

## open: Open the mixer
target: #mixerBtn
Body.

## print: Mixer print
target: #mixerBtn
Also body.
`;

test("tokenizeInline handles bold, italic, code and literal text", () => {
  assert.deepEqual(tokenizeInline("a **b** c *d* `e`"), [
    { type: "text", text: "a " },
    { type: "strong", text: "b" },
    { type: "text", text: " c " },
    { type: "em", text: "d" },
    { type: "text", text: " " },
    { type: "code", text: "e" },
  ]);
});

test("tokenizeInline treats an unclosed or empty marker as literal text", () => {
  assert.deepEqual(tokenizeInline("2 * 3"), [{ type: "text", text: "2 * 3" }]);
  assert.deepEqual(tokenizeInline("a **** b"), [{ type: "text", text: "a **** b" }]);
  assert.deepEqual(tokenizeInline("**open"), [{ type: "text", text: "**open" }]);
  assert.deepEqual(tokenizeInline(""), []);
});

test("tokenizeInline reads ** as strong, never two em markers", () => {
  assert.deepEqual(tokenizeInline("Press **/** now"), [
    { type: "text", text: "Press " },
    { type: "strong", text: "/" },
    { type: "text", text: " now" },
  ]);
});

test("parseBody joins a paragraph's lines, splits on blank lines and lists each bullet", () => {
  const blocks = parseBody(["one", "two", "", "- a", "- b", "after"]);
  assert.deepEqual(blocks.map((b) => [b.list, b.tokens.map((t) => t.text).join("")]), [
    [false, "one two"],
    [true, "a"],
    [true, "b"],
    [false, "after"],
  ]);
});

test("parseTourMarkdown reads ui strings, chapters, steps, metadata and body", () => {
  const content = parseTourMarkdown(SAMPLE);
  assert.deepEqual(content.ui, { next: "Next", step: "Step {n} of {total}" });
  assert.deepEqual(content.chapters.map((c) => c.id), ["basics", "mixer"]);
  const [search, print] = content.chapters[0].steps;
  assert.equal(search.id, "search");
  assert.equal(search.title, "Find a song");
  assert.deepEqual(search.targets, ["#songSearch", "#songRail"]);
  assert.deepEqual(search.setup, ["openDemoSong", "openDrawer"]);
  assert.equal(search.interactive, true);
  assert.equal(search.body.length, 3);
  assert.equal(search.body[0].list, false);
  assert.equal(search.body[1].list, true);
  assert.deepEqual(print.setup, []);
  assert.deepEqual(content.chapters[0].setup, ["showLibrary"]);
  assert.deepEqual(content.chapters[1].setup, []);
  assert.equal(print.interactive, false);
  assert.equal(print.body[0].tokens[0].text, "Just a body, no blank line after the metadata.");
});

test("a body line that looks like metadata is body text once the body has started", () => {
  const content = parseTourMarkdown("# c: C\n## s: S\ntarget: #a\nHello\ntarget: #b\n");
  const [step] = content.chapters[0].steps;
  assert.deepEqual(step.targets, ["#a"]);
  assert.equal(step.body[0].tokens[0].text, "Hello target: #b");
});

test("parseTourMarkdown tolerates CRLF, empty input and stray headings", () => {
  assert.deepEqual(parseTourMarkdown(""), { ui: {}, chapters: [] });
  assert.deepEqual(parseTourMarkdown(null), { ui: {}, chapters: [] });
  const content = parseTourMarkdown("## orphan: No chapter\r\nbody\r\n# c: C\r\n## s: S\r\ntext\r\n");
  assert.deepEqual(content.chapters.map((c) => c.id), ["c"]);
  assert.equal(content.chapters[0].steps[0].body[0].tokens[0].text, "text");
});

test("mergeTourLang keeps English structure and takes translated copy, falling back per step", () => {
  const base = parseTourMarkdown(SAMPLE);
  const nl = parseTourMarkdown("# ui\nnext: Volgende\n\n# basics: Basis\n## search: Zoek een nummer\nNL tekst\n");
  const merged = mergeTourLang(base, nl);
  assert.equal(merged.ui.next, "Volgende");
  assert.equal(merged.ui.step, "Step {n} of {total}");
  assert.equal(merged.chapters[0].title, "Basis");
  assert.equal(merged.chapters[1].title, "Mixer");
  const [search, print] = merged.chapters[0].steps;
  assert.equal(search.title, "Zoek een nummer");
  assert.deepEqual(search.targets, ["#songSearch", "#songRail"]);
  assert.deepEqual(search.setup, ["openDemoSong", "openDrawer"]);
  assert.equal(search.body[0].tokens[0].text, "NL tekst");
  assert.equal(print.title, "Print it");
  assert.equal(mergeTourLang(base, null), base);
});

test("mergeTourLang matches steps by chapter and id, so a repeated step id can't cross chapters", () => {
  const base = parseTourMarkdown(SAMPLE);
  const nl = parseTourMarkdown("# basics: B\n## print: Basis print\nNL basis\n\n# mixer: M\n## print: Mixer print NL\nNL mixer\n");
  const merged = mergeTourLang(base, nl);
  assert.equal(merged.chapters[0].steps[1].title, "Basis print");
  assert.equal(merged.chapters[1].steps[1].title, "Mixer print NL");
  assert.equal(merged.chapters[1].steps[1].body[0].tokens[0].text, "NL mixer");
  assert.equal(merged.chapters[1].steps[0].title, "Open the mixer");
});

test("flattenTourSteps tags each step with its chapter position", () => {
  const flat = flattenTourSteps(parseTourMarkdown(SAMPLE));
  assert.deepEqual(flat.map((s) => [s.id, s.chapterId, s.chapterIndex, s.stepIndex, s.chapterStepCount]), [
    ["search", "basics", 0, 0, 2],
    ["print", "basics", 0, 1, 2],
    ["open", "mixer", 1, 0, 2],
    ["print", "mixer", 1, 1, 2],
  ]);
  // A chapter's setup is inherited by its steps, ahead of the step's own.
  assert.deepEqual(flat[0].setup, ["showLibrary", "openDemoSong", "openDrawer"]);
  assert.deepEqual(flat[1].setup, ["showLibrary"]);
  assert.deepEqual(flat[2].setup, []);
  assert.equal(flat.length, 4);
});

test("resolveTourLang: saved choice beats URL prefix beats browser language beats English", () => {
  assert.equal(resolveTourLang("de", "/nl/songs/", ["nl-NL"]), "de");
  assert.equal(resolveTourLang(null, "/nl/songs/", ["de-DE"]), "nl");
  assert.equal(resolveTourLang(null, "/songs/", ["es-ES", "de-AT", "nl"]), "de");
  assert.equal(resolveTourLang(null, "/songs/", ["fr-FR"]), "fr");
  assert.equal(resolveTourLang(null, "/songs/", ["es-ES"]), "en");
  assert.equal(resolveTourLang("xx", "/songs/", undefined), "en");
  assert.equal(resolveTourLang(null, undefined, ["NL-be"]), "nl");
});

test("formatTourString fills {placeholders}", () => {
  assert.equal(formatTourString("Step {n} of {total}", { n: 2, total: 5 }), "Step 2 of 5");
  assert.equal(formatTourString("no placeholders"), "no placeholders");
  assert.equal(formatTourString(undefined), "");
});

test("tourStructureProblems flags missing ui keys, reordered ids and empty copy", () => {
  const base = parseTourMarkdown(SAMPLE);
  assert.deepEqual(tourStructureProblems(base, parseTourMarkdown(SAMPLE)), []);

  const missingUi = parseTourMarkdown(SAMPLE.replace("next: Next\n", ""));
  assert.match(tourStructureProblems(base, missingUi)[0], /missing ui string "next"/);

  const reordered = parseTourMarkdown(SAMPLE.replace("## print: Print it", "## printing: Print it"));
  assert.match(tourStructureProblems(base, reordered).join("\n"), /ids differ/);

  const emptyBody = parseTourMarkdown(SAMPLE.replace("Body.\n", ""));
  assert.match(tourStructureProblems(base, emptyBody).join("\n"), /step mixer\/open has no body/);
});
