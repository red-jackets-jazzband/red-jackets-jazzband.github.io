// Guided-tour copy: parsing of static/tour/tour.{en,nl,de,fr}.md, the English-is-
// canonical merge for translations, and the display-language choice. Pure text
// in, plain objects out — songs/tour.js owns fetching and all DOM work.
//
// File format (see static/tour/tour.en.md for the real thing):
//
//   # ui                    <- `key: value` UI strings
//   next: Next
//
//   # basics: Basics        <- a chapter: `# id: Title`
//   setup: showLibrary      <- chapter metadata (English file only): setup actions
//                              every step of the chapter inherits
//   ## search: Find a song  <- a step:    `## id: Title`
//   target: #songSearch     <- step metadata (English file only), directly under the heading
//   setup: openDrawer       <- comma-separated actions, added to the chapter's own
//   interactive: true
//                           <- blank line, then the body: paragraphs, `- ` bullets
//   Type part of a **title**.
//
// The English file is canonical for structure (targets, setup, interactive); a
// translation only repeats ids + titles + bodies, in the same order.

/**
 * @typedef {{ type: "text" | "strong" | "em" | "code", text: string }} InlineToken
 * @typedef {{ list: boolean, tokens: InlineToken[] }} TourBlock
 * @typedef {{
 *   id: string, title: string, targets: string[], setup: string[],
 *   interactive: boolean, body: TourBlock[],
 * }} TourStep
 * @typedef {{ id: string, title: string, setup: string[], steps: TourStep[] }} TourChapter
 * @typedef {{ ui: Record<string, string>, chapters: TourChapter[] }} TourContent
 */

export const TOUR_LANGS = ["en", "nl", "de", "fr"];

const META_KEYS = new Set(["target", "setup", "interactive"]);
const UI_SECTION = "ui";
const LIST_MARKER = "- ";

// Longest marker first, so `**` is never read as two `*`.
/** @type {[string, "strong" | "code" | "em"][]} */
const INLINE_MARKERS = [
  ["**", "strong"],
  ["`", "code"],
  ["*", "em"],
];

export function isTourLang(value) {
  return TOUR_LANGS.includes(value);
}

/*
  Which language the tour opens in: an explicit earlier choice, else the URL
  prefix (/nl/…, /de/…, /fr/… — the site's own convention, since the theme always
  stamps <html lang="en-US">), else the first browser language we translate,
  else English.
*/
export function resolveTourLang(saved, pathname, navigatorLanguages) {
  if (isTourLang(saved)) return saved;
  const first = String(pathname || "").split("/").find(Boolean);
  if (isTourLang(first)) return first;
  for (const tag of navigatorLanguages || []) {
    const base = String(tag).slice(0, 2).toLowerCase();
    if (isTourLang(base)) return base;
  }
  return "en";
}

// `{n}`-style placeholders in a UI string ("Step {n} of {total}").
export function formatTourString(template, values = {}) {
  let out = String(template ?? "");
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}

// One inline marker at `i`: the token it opens plus where the scan resumes, or
// null when there's no closing marker (then the char is just literal text).
function readMarker(text, i) {
  for (const [marker, type] of INLINE_MARKERS) {
    if (!text.startsWith(marker, i)) continue;
    const close = text.indexOf(marker, i + marker.length);
    if (close > i + marker.length) {
      return { token: { type, text: text.slice(i + marker.length, close) }, next: close + marker.length };
    }
  }
  return null;
}

/**
 * `**bold**`, `*italic*`, `` `code` `` → tokens; anything else is plain text.
 * A plain char walk (no delimiter-scanning regex) so hostile text can't go
 * quadratic — see CLAUDE.md's super-linear-regex note.
 * @param {string} text
 * @returns {InlineToken[]}
 */
export function tokenizeInline(text) {
  /** @type {InlineToken[]} */
  const tokens = [];
  let buffer = "";
  let i = 0;
  while (i < text.length) {
    const found = readMarker(text, i);
    if (found) {
      if (buffer) tokens.push({ type: "text", text: buffer });
      buffer = "";
      tokens.push(found.token);
      i = found.next;
    } else {
      buffer += text[i];
      i += 1;
    }
  }
  if (buffer) tokens.push({ type: "text", text: buffer });
  return tokens;
}

/**
 * Body lines → blocks: each `- ` line is its own list item; other consecutive
 * lines join into one paragraph; a blank line ends a paragraph.
 * @param {string[]} lines
 * @returns {TourBlock[]}
 */
export function parseBody(lines) {
  /** @type {TourBlock[]} */
  const blocks = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ list: false, tokens: tokenizeInline(paragraph.join(" ")) });
    paragraph = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (line.startsWith(LIST_MARKER)) {
      flush();
      blocks.push({ list: true, tokens: tokenizeInline(line.slice(LIST_MARKER.length).trim()) });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

// "id: Some title" → { key: "id", value: "Some title" }; no colon → key only.
function splitKeyValue(text) {
  const at = text.indexOf(":");
  if (at < 0) return { key: text.trim(), value: "" };
  return { key: text.slice(0, at).trim(), value: text.slice(at + 1).trim() };
}

function splitList(value) {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function parseMeta(line) {
  const { key, value } = splitKeyValue(line);
  const name = key.toLowerCase();
  return line.includes(":") && META_KEYS.has(name) ? { name, value } : null;
}

function applyMeta(step, { name, value }) {
  if (name === "target") {
    step.targets = splitList(value);
  } else if (name === "setup") {
    step.setup = splitList(value);
  } else {
    step.interactive = value.toLowerCase() === "true";
  }
}

// One line inside a step: metadata while still directly under the heading,
// otherwise (after the first body line) plain body text.
function addStepLine(step, line) {
  if (!step.bodyStarted) {
    const meta = parseMeta(line);
    if (meta) {
      applyMeta(step, meta);
      return;
    }
    if (!line.trim()) return;
    step.bodyStarted = true;
  }
  step.bodyLines.push(line);
}

function finishStep(step) {
  return {
    id: step.id,
    title: step.title,
    targets: step.targets,
    setup: step.setup,
    interactive: step.interactive,
    body: parseBody(step.bodyLines),
  };
}

function newStep(headingText) {
  const { key, value } = splitKeyValue(headingText);
  return {
    id: key, title: value || key, targets: [], setup: [], interactive: false, bodyStarted: false, bodyLines: [],
  };
}

function startStepHeading(state, headingText) {
  state.step = state.chapter ? newStep(headingText) : null;
  if (state.step) state.chapter.steps.push(state.step);
}

function startChapterHeading(state, headingText) {
  const { key, value } = splitKeyValue(headingText);
  state.step = null;
  state.inUi = key === UI_SECTION;
  state.chapter = state.inUi ? null : { id: key, title: value || key, setup: [], steps: [] };
  if (state.chapter) state.rawChapters.push(state.chapter);
}

// A line under a chapter heading but before its first step: only `setup:` means anything.
function addChapterMeta(chapter, line) {
  const meta = parseMeta(line);
  if (meta?.name === "setup") chapter.setup = splitList(meta.value);
}

function consumeLine(state, line) {
  if (line.startsWith("## ")) {
    startStepHeading(state, line.slice(3));
  } else if (line.startsWith("# ")) {
    startChapterHeading(state, line.slice(2));
  } else if (state.step) {
    addStepLine(state.step, line);
  } else if (state.inUi && line.includes(":")) {
    const { key, value } = splitKeyValue(line);
    state.ui[key] = value;
  } else if (state.chapter) {
    addChapterMeta(state.chapter, line);
  }
}

/**
 * @param {string} text  a whole tour.<lang>.md file
 * @returns {TourContent}
 */
export function parseTourMarkdown(text) {
  const state = { ui: {}, rawChapters: [], inUi: false, chapter: null, step: null };
  for (const line of String(text ?? "").split(/\r?\n/)) consumeLine(state, line);
  return {
    ui: state.ui,
    chapters: state.rawChapters.map((raw) => ({
      id: raw.id,
      title: raw.title,
      setup: raw.setup,
      steps: raw.steps.map(finishStep),
    })),
  };
}

/**
 * Overlay a translation onto the English structure: ids, order, targets, setup
 * and interactive always come from `base`; the overlay only supplies titles,
 * bodies and UI strings, and any it lacks fall back to English.
 * @param {TourContent} base
 * @param {TourContent | null | undefined} overlay
 * @returns {TourContent}
 */
export function mergeTourLang(base, overlay) {
  if (!overlay) return base;
  const translatedSteps = new Map();
  const translatedChapters = new Map();
  for (const chapter of overlay.chapters) {
    translatedChapters.set(chapter.id, chapter);
    // Step ids are only unique within their chapter ("open" is in several).
    for (const step of chapter.steps) translatedSteps.set(`${chapter.id}/${step.id}`, step);
  }
  return {
    ui: { ...base.ui, ...overlay.ui },
    chapters: base.chapters.map((chapter) => ({
      ...chapter,
      title: translatedChapters.get(chapter.id)?.title || chapter.title,
      steps: chapter.steps.map((step) => {
        const translated = translatedSteps.get(`${chapter.id}/${step.id}`);
        if (!translated) return step;
        return {
          ...step,
          title: translated.title || step.title,
          body: translated.body.length ? translated.body : step.body,
        };
      }),
    })),
  };
}

/**
 * Chapters flattened to one ordered step list, each step tagged with where it
 * sits, so the tour can walk Back/Next across chapter boundaries.
 * @param {TourContent} content
 */
export function flattenTourSteps(content) {
  return content.chapters.flatMap((chapter, chapterIndex) => chapter.steps.map((step, stepIndex) => ({
    ...step,
    // The chapter's own setup first (e.g. "open the demo song"), then the step's.
    setup: [...new Set([...chapter.setup, ...step.setup])],
    chapterId: chapter.id,
    chapterIndex,
    chapterTitle: chapter.title,
    stepIndex,
    chapterStepCount: chapter.steps.length,
  })));
}

function structureIds(content) {
  return content.chapters
    .map((c) => `${c.id}[${c.steps.map((s) => s.id).join(",")}]`)
    .join(" | ");
}

// Every problem that makes `other` an unusable translation of `base`: missing
// or extra or reordered chapters/steps, and missing UI keys or empty copy.
// Empty list = fine. (The content test runs this over the real files.)
export function tourStructureProblems(base, other) {
  const problems = [];
  for (const key of Object.keys(base.ui)) {
    if (!other.ui[key]) problems.push(`missing ui string "${key}"`);
  }
  const expected = structureIds(base);
  const actual = structureIds(other);
  if (expected !== actual) {
    problems.push(`chapter/step ids differ: ${actual} (expected ${expected})`);
    return problems;
  }
  other.chapters.forEach((chapter) => {
    if (!chapter.title) problems.push(`chapter ${chapter.id} has no title`);
    for (const step of chapter.steps) {
      if (!step.title) problems.push(`step ${chapter.id}/${step.id} has no title`);
      if (!step.body.length) problems.push(`step ${chapter.id}/${step.id} has no body`);
    }
  });
  return problems;
}
