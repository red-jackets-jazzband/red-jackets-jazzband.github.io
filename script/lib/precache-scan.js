// Pure text-scanning helpers the service worker's own install step (sw.js)
// uses to discover which stylesheet, script and webfont URLs the /songs/ app
// shell actually needs precached — none of this can be a static list, since
// split.css is served from a build-time-fingerprinted URL (see head.html's
// `resources.Get | minify | fingerprint`) and the entry module script pulls
// in the rest of its own dependency graph via `import`. Plain indexOf/char
// scans, not a delimiter-spanning regex (see CLAUDE.md's "Regexes that scan
// for a closing delimiter" note), since these walk real but arbitrary-length
// HTML/CSS/JS text.

// Every <link rel="stylesheet" href="..."> in a page's HTML — the site's own
// fingerprinted stylesheet and any cross-origin one (Font Awesome, from
// cdnjs) alike.
export function findStylesheetHrefs(html) {
  return collectTagAttr(html, "<link", (tag) => (tag.includes('rel="stylesheet"') ? attrValue(tag, "href") : null));
}

// Every <script src="..."> in a page's HTML — both the classic vendored
// bundles (ABCJS/Tonal/lamejs) and the type="module" entry point.
export function findScriptSrcs(html) {
  return collectTagAttr(html, "<script", (tag) => attrValue(tag, "src"));
}

function collectTagAttr(html, tagStartMarker, extract) {
  const values = [];
  let searchFrom = 0;
  for (;;) {
    const tagStart = html.indexOf(tagStartMarker, searchFrom);
    if (tagStart === -1) break;
    const tagEnd = html.indexOf(">", tagStart);
    if (tagEnd === -1) break;
    searchFrom = tagEnd + 1;
    const value = extract(html.slice(tagStart, tagEnd));
    if (value) values.push(value);
  }
  return values;
}

function attrValue(tag, name) {
  const marker = `${name}="`;
  const valueStart = tag.indexOf(marker);
  if (valueStart === -1) return null;
  const start = valueStart + marker.length;
  const end = tag.indexOf('"', start);
  return end === -1 ? null : tag.slice(start, end);
}

// Every url(...) reference in a CSS file's text — @font-face's own `src`
// rules, in practice. Handles a bare, single- or double-quoted url() alike.
export function findCssUrls(css) {
  const urls = [];
  let searchFrom = 0;
  for (;;) {
    const open = css.indexOf("url(", searchFrom);
    if (open === -1) break;
    const close = css.indexOf(")", open + 4);
    if (close === -1) break;
    searchFrom = close + 1;
    const url = unquote(css.slice(open + 4, close).trim());
    if (url) urls.push(url);
  }
  return urls;
}

function unquote(value) {
  const quoted = value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
  return quoted ? value.slice(1, -1) : value;
}

// Every static `import ... from "..."` specifier in an ES module's source.
// This codebase only ever uses static "import from" (no dynamic import(),
// no "export ... from" re-exports — true of the whole static/script/ tree
// today), so that's the only form worth recognising. A multi-line import
// clause (`import {\n  a,\n} from "./x.js";`, used throughout this codebase)
// is handled by buffering lines from the "import" keyword through the
// statement's own terminating ";" before extracting the specifier.
export function findModuleImports(js) {
  const specifiers = [];
  let buffer = null;
  for (const line of js.split("\n")) {
    if (buffer === null) {
      if (!startsWithImportKeyword(line.trimStart())) continue;
      buffer = line;
    } else {
      buffer += `\n${line}`;
    }
    if (!buffer.includes(";")) continue;
    const specifier = importSpecifier(buffer);
    if (specifier) specifiers.push(specifier);
    buffer = null;
  }
  return specifiers;
}

function startsWithImportKeyword(line) {
  if (!line.startsWith("import")) return false;
  const next = line[6];
  return next === " " || next === "{" || next === '"' || next === "'";
}

function importSpecifier(statement) {
  const marker = "from ";
  const fromIdx = statement.indexOf(marker);
  // A bare side-effect import (`import "./x.js";`) has no "from" clause —
  // its specifier follows the "import" keyword directly instead.
  const afterKeyword = fromIdx === -1 ? statement.indexOf("import") + "import".length : fromIdx + marker.length;
  return quotedSpecifierAt(statement, afterKeyword);
}

function quotedSpecifierAt(statement, start) {
  let i = start;
  while (statement[i] === " ") i += 1;
  const quote = statement[i];
  if (quote !== '"' && quote !== "'") return null;
  const end = statement.indexOf(quote, i + 1);
  return end === -1 ? null : statement.slice(i + 1, end);
}
