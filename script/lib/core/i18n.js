/*
  UI strings for the /songs/ page's JavaScript.

  The page's markup is translated by Hugo (i18n/<lang>.toml); the strings JS
  builds at runtime go through here. layouts/shortcodes/songs-app.html embeds
  the current language's table as <script type="application/json" id="rjI18n">
  { "lang": "nl", "messages": { "js_<key>": "…" } }, so there is no extra
  request and it keeps working offline from the cached page.

  `tl(key, english, params)` — the second argument is the
  English text, which is both the fallback (jsdom tests and any key a
  translation lacks) and what scripts/lint-i18n.js checks i18n/en.toml
  against. `{name}` placeholders are filled from `params`. Keys are written
  without the `js_` prefix the toml files carry.
*/

const PREFIX = "js_";

let messages = null;
let language = "en";

function readEmbedded() {
  // lib/ modules also run under plain Node (tests, lint scripts): no document.
  const node = typeof document === "undefined" ? null : document.getElementById("rjI18n");
  if (!node) return { lang: "en", messages: {} };
  try {
    return JSON.parse(node.textContent);
  } catch {
    return { lang: "en", messages: {} };
  }
}

function ensureLoaded() {
  if (messages) return;
  const data = readEmbedded();
  messages = data.messages && typeof data.messages === "object" ? data.messages : {};
  language = typeof data.lang === "string" ? data.lang : "en";
}

/** Replace the table (tests, and anything that wants to switch language). */
export function setMessages(table, lang) {
  messages = table || {};
  language = lang || "en";
}

/** Forget the table so the next lookup re-reads the page's embedded one. */
export function resetMessages() {
  messages = null;
  language = "en";
}

/** The page's language code: "en", "nl", "de" or "fr". */
export function pageLanguage() {
  ensureLoaded();
  return language;
}

function fill(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (
    // Object.hasOwn() is Safari 15.4+; this page supports Safari 12.
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole // NOSONAR
  ));
}

export function tl(key, english, params) {
  ensureLoaded();
  const found = messages[PREFIX + key];
  return fill(typeof found === "string" && found !== "" ? found : english, params);
}

/** "A, B and C" / "A, B or C" in the page's language. */
export function listOf(names, conjunction) {
  if (names.length < 2) return names.join("");
  const head = names.slice(0, -1).join(", ");
  const last = names[names.length - 1];
  return conjunction === "or"
    ? tl("list_or", "{head} or {last}", { head, last })
    : tl("list_and", "{head} and {last}", { head, last });
}
