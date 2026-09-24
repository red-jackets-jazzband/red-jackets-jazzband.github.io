import { humanizeSongFile } from "./filename.js";

// True for a setlist item that is a set divider ("break") rather than a song.
export function isSetlistDivider(item) {
  return Boolean(item) && item.divider !== undefined && item.file === undefined;
}

const SONGS_PATH_PREFIX = "/songs/";

// The pre-conversion song line: "<file>.abc" optionally followed by
// ",<key>" — still read (see the doc comment below) so an old export still
// imports, but never written.
const SONG_LINE_RE = /^[^,]+\.abc(?:\s*,.*)?$/i;

/*
  Setlist files are small markdown documents, leaning on standard markdown
  constructs (headings, a link list, a blockquote) rather than inventing
  project-specific syntax, so a plain markdown viewer (GitHub, a text editor
  with preview) renders something reasonable too:

    # Setlist 2026

    Optional free-text intro/notes for the printed cover page. Can span
    multiple lines and paragraphs.

    ## Set 1
    - [Bourbon Street Parade](/songs/bourbon_street_parade.abc)
    - [Five Foot Two](/songs/five_foot_two.abc?key=Bb)
      > Ben solos the 2nd chorus, watch the key change into the outro.

    ## Set 2
    ...

  - The first "# <text>" line (a single #, not ##) is the setlist title.
  - Any other line before the first "##" heading or song line is free-text
    description, paragraphs kept apart by blank lines.
  - "## <text>" (or bare "##") splits the list into sets — the same role the
    old "# break,<label>" comment line played. Set 1 is everything before the
    first one.
  - A song is a markdown list item linking to its own real, resolvable path:
    "- [<title>](/songs/<file>.abc)", with an optional "?key=<value>" query
    param overriding its key (a signed semitone integer or a key name — same
    as before, just moved from a bare CSV column into a real URL param). The
    link text is cosmetic, filled in with the song's current title purely so
    the raw file reads well on its own; the app always resolves the display
    name live from its own song index instead of trusting it.
  - One or more "> <text>" lines directly under a song's list item (indented
    to nest under it, though the indentation is cosmetic — reading only
    checks for a "> " prefix, not its depth) attach as that song's note (a
    printed-setlist-only aside, e.g. who solos) — multi-line, joined by "\n";
    a bare ">" is a blank line inside the note. A "> " line anywhere else
    (nothing to attach to) is dropped.

  For backward compatibility with files exported before this format existed,
  older forms are still read (but never written): the very first markdown
  conversion's bare "<file>.abc,<key>" song line (no "- [...]" link), and
  before that, single-line "#"-prefixed comments — a bare "#" line only
  becomes the title the first time one hasn't been found yet, so wherever the
  OLD forms below appear, they're matched first:
    "# name,<Display Name>", "# desc,<text>", "# break" / "# break,<label>".
*/
function parseOldComment(line) {
  const commentBody = line.slice(1).trim();
  const commaIdx = commentBody.indexOf(",");
  const key = (commaIdx === -1 ? commentBody : commentBody.slice(0, commaIdx)).trim().toLowerCase();
  const value = commaIdx === -1 ? "" : commentBody.slice(commaIdx + 1).trim();
  return { key, value, hasComma: commaIdx !== -1 };
}

// Parses a leading "[text](target)" off `line` — a plain indexOf scan, not a
// delimiter-spanning regex (see the "Regexes that scan for a closing
// delimiter" note in CLAUDE.md), since this walks over arbitrary song
// titles. Returns null when `line` doesn't start with one.
function parseMarkdownLink(line) {
  if (line.charAt(0) !== "[") return null;
  const closeBracket = line.indexOf("](", 1);
  if (closeBracket === -1) return null;
  const closeParen = line.indexOf(")", closeBracket + 2);
  if (closeParen === -1) return null;
  return { target: line.slice(closeBracket + 2, closeParen) };
}

// "/songs/<file>.abc?key=<value>" (or a bare "<file>.abc?key=<value>", read
// leniently) -> { file, key }.
function songFromLinkTarget(target) {
  const qIdx = target.indexOf("?");
  const path = qIdx === -1 ? target : target.slice(0, qIdx);
  const file = path.startsWith(SONGS_PATH_PREFIX) ? path.slice(SONGS_PATH_PREFIX.length) : path;
  const key = qIdx === -1 ? "" : (new URLSearchParams(target.slice(qIdx + 1)).get("key") || "");
  return file ? { file, key } : null;
}

// The old bare "<file>.abc,<key>" song line (no markdown link) — still read
// for backward compatibility, see the doc comment above.
function songFromOldLine(line) {
  const parts = line.split(",");
  const file = parts[0] ? parts[0].trim() : "";
  const key = parts[1] !== undefined ? parts[1].trim() : "";
  return file ? { file, key } : null;
}

function isSongListItem(line) {
  return line.slice(0, 2) === "- ";
}

// The one place a line is decided to actually BE a song (new-style link or
// the old bare CSV line) — content-validated both ways, not just a shape
// sniff, and reused everywhere a line needs classifying (the header/list
// phase transition below, and actually pushing the song), so those two
// questions can never disagree with each other. A "- " line that fails to
// parse as a real link (e.g. ordinary desc prose that happens to start with
// a markdown bullet, like "- Bring your own stand.") returns null here
// rather than being treated as a malformed song — the caller decides what to
// do with that (desc text in the header, a warning in the list body — see
// parseSetlistFile), but it's never silently promoted into a fake song entry
// the way an unvalidated fallback to songFromOldLine would.
function songFromLine(line) {
  if (isSongListItem(line)) {
    const link = parseMarkdownLink(line.slice(2).trim());
    return link ? songFromLinkTarget(link.target) : null;
  }
  return SONG_LINE_RE.test(line) ? songFromOldLine(line) : null;
}

// One line of a "># text" note continuation: drop the leading "># " marker
// and at most one following space (so "> Ben solos" -> "Ben solos", and a
// bare ">" -> "", a blank line inside the note).
function noteContinuationText(line) {
  return line.slice(1).replace(/^ /, "");
}

function isDividerLine(line) {
  return line.slice(0, 2) === "##";
}

export function parseSetlistFile(text) {
  let name = null;
  let legacyDesc = null;
  const descLines = [];
  const songs = [];
  const warnings = [];
  let inHeader = true;
  let lastSongItem = null;

  function pushDivider(label) {
    songs.push({ divider: label });
    lastSongItem = null;
  }

  // Tries to read `line` as a song; returns whether it succeeded, so a
  // caller can tell "this line is a song" apart from "this line is
  // something else" (desc prose in the header, an unrecognized line once
  // the list has started — see handleHeaderLine/handleListLine).
  function tryPushSong(line) {
    const item = songFromLine(line);
    if (!item) return false;
    songs.push(item);
    lastSongItem = item;
    return true;
  }

  function attachNote(line) {
    if (!lastSongItem) return; // nothing to attach a stray "> " line to
    const noteLine = noteContinuationText(line);
    lastSongItem.note = lastSongItem.note ? `${lastSongItem.note}\n${noteLine}` : noteLine;
  }

  // Old-style "#"-prefixed comment, valid in either phase. Returns true once
  // it recognizes (and handles) the line.
  function handleOldComment(line) {
    const { key, value, hasComma } = parseOldComment(line);
    if (key === "break") {
      pushDivider(value);
      return true;
    }
    if (hasComma && key === "name") {
      name = value;
      return true;
    }
    if (hasComma && key === "desc") {
      legacyDesc = value;
      return true;
    }
    return false;
  }

  function handleHeaderLine(line) {
    if (line.length === 0) {
      if (descLines.length && descLines.at(-1) !== "") descLines.push("");
      return;
    }
    if (isDividerLine(line)) {
      inHeader = false;
      pushDivider(line.slice(2).trim());
      return;
    }
    if (line.charAt(0) === "#") {
      if (handleOldComment(line)) return;
      // A lone "#" line: the new-style title, the first time one shows up.
      // Anything after that is ignored, same as an unrecognized comment
      // always was.
      if (name === null) name = line.slice(1).trim();
      return;
    }
    if (line.charAt(0) === ">") return; // nothing to attach to yet
    // A line only ends the header/starts the song list once it actually
    // parses as a song — never on a shape sniff alone (a desc paragraph
    // starting with a literal "- ", e.g. "- Bring your own stand.", stays
    // desc text instead of derailing everything after it into the list
    // phase — see tryPushSong's own doc comment / songFromLine's).
    if (!tryPushSong(line)) {
      descLines.push(line);
      return;
    }
    inHeader = false;
  }

  function handleListLine(line) {
    if (line.length === 0) return;
    if (isDividerLine(line)) {
      pushDivider(line.slice(2).trim());
      return;
    }
    if (line.charAt(0) === "#") {
      handleOldComment(line);
      return;
    }
    if (line.charAt(0) === ">") {
      attachNote(line);
      return;
    }
    // Once inside the song list, a line that doesn't parse as a song is
    // dropped rather than silently turned into a bogus one (the old
    // behavior here — an unconditional fallback to the bare-CSV reader,
    // which accepts any non-empty string as a "file" — is exactly how a
    // stray line of prose became a fake, 404-ing song entry).
    if (!tryPushSong(line)) warnings.push(`Unrecognized line: "${line}"`);
  }

  text.split("\n").forEach((rawLine) => {
    const line = rawLine.trim();
    if (inHeader) handleHeaderLine(line);
    else handleListLine(line);
  });

  while (descLines.length && descLines.at(-1) === "") descLines.pop();
  let desc = descLines.length ? descLines.join("\n") : null;
  if (legacyDesc !== null) desc = legacyDesc;

  return { name, desc, songs, warnings };
}

// encodeURIComponent leaves "(" and ")" unescaped — they're in its own
// "unreserved" set — but parseMarkdownLink reads a link's target back with a
// plain indexOf scan for the closing ")", so an unescaped one inside the
// value (e.g. a hand-typed key override like "Bb (capo 2)") would be read as
// the link's OWN closing paren and truncate everything after it. Escaping
// them by hand on top of encodeURIComponent keeps the value's own parens out
// of that scan entirely; URLSearchParams#get decodes "%28"/"%29" back to
// "("/")" on the way in, same as any other percent-escape, so nothing needs
// to change on the reading side.
function encodeQueryValue(value) {
  return encodeURIComponent(value).replace(/[()]/g, (c) => `%${c.codePointAt(0).toString(16)}`);
}

function linkTarget(file, key) {
  const query = key ? `?key=${encodeQueryValue(key)}` : "";
  return `${SONGS_PATH_PREFIX}${file}${query}`;
}

// Serializes back to the new markdown format (see the doc comment above) —
// the one format this ever writes, even when reading a file that used an
// older syntax. Shared verbatim by band setlists (committed to the repo) and
// personal setlists (localStorage -> downloadable .txt export/import).
// `songName(file)`, when given, resolves a song's real current title for its
// link text (the app's own song index — never available inside this pure
// module itself); without it, the title is guessed from the filename, same
// fallback the app itself uses for a song missing from that index.
/** @param {{ songName?: (file: string) => string }} [options] */
export function serializeSetlistFile(setlist, options = {}) {
  const { songName } = options;
  const title = (file) => (songName ? songName(file) : humanizeSongFile(file));
  const lines = [];
  if (setlist.name) lines.push(`# ${setlist.name}`);
  if (setlist.desc) {
    lines.push("");
    setlist.desc.split("\n").forEach((l) => lines.push(l));
  }

  const songs = setlist.songs || [];
  if (lines.length && songs.length) lines.push("");
  songs.forEach((item) => {
    if (isSetlistDivider(item)) {
      // A blank line ahead of every "Set N" heading but the first (which
      // already has one from the header-to-list blank above) — reads better,
      // and a blank line ahead of an ATX heading is normal markdown style.
      if (lines.length && lines.at(-1) !== "") lines.push("");
      lines.push(item.divider ? `## ${item.divider}` : "##");
      return;
    }
    lines.push(`- [${title(item.file)}](${linkTarget(item.file, item.key)})`);
    if (item.note) item.note.split("\n").forEach((l) => lines.push(`  > ${l}`));
  });
  return `${lines.join("\n")}\n`;
}
