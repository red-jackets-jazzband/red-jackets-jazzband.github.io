// Markdown-style pipe tables inside W: (words) lines.
//
// abcjs prints W: lines as plain proportional-font text, so a table written
// there would show its literal `|` characters. A run of consecutive W: lines
// that each start with `|` is therefore pulled out of the ABC handed to the
// renderer and returned as rows of cells, for the sheet to draw as a real
// <table>. Every W: line that isn't part of such a run is left alone.

const WORDS_PREFIX = "W:";

// "| a | b |" -> ["a", "b"]; null when the line isn't a table row.
function splitRow(line) {
  if (!line.startsWith(WORDS_PREFIX)) return null;
  const body = line.slice(WORDS_PREFIX.length).trim();
  if (!body.startsWith("|")) return null;
  const inner = body.endsWith("|") && body.length > 1 ? body.slice(1, -1) : body.slice(1);
  return inner.split("|").map((cell) => cell.trim());
}

// The `|---|---|` separator row under a header.
function isSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => cell.length > 0 && cell.replace(/[-:]/g, "") === "");
}

// Reads every table out of `abcText`. Returns the text with the table lines
// removed and the tables found: `{ header: string[] | null, rows: string[][] }`.
// A table has a header only when its second row is a `---` separator.
export function extractWordsTables(abcText) {
  const kept = [];
  const tables = [];
  let current = null;
  for (const line of abcText.split("\n")) {
    const cells = splitRow(line.trimEnd());
    if (cells === null) {
      current = null;
      kept.push(line);
    } else {
      if (current === null) {
        current = { header: null, rows: [] };
        tables.push(current);
      }
      if (isSeparator(cells) && current.rows.length === 1 && current.header === null) {
        current.header = current.rows.pop();
      } else if (!isSeparator(cells)) {
        current.rows.push(cells);
      }
    }
  }
  return { abcText: kept.join("\n"), tables };
}

// Turns a table on its side: each original column becomes a row, so the
// steps of a form read left to right. A header column becomes the row labels.
// Returns `{ labels: string[] | null, rows: string[][] }`.
export function transposeTable({ header, rows }) {
  const all = header ? [header, ...rows] : rows;
  const width = all.reduce((max, row) => Math.max(max, row.length), 0);
  const columns = [];
  for (let c = 0; c < width; c++) {
    columns.push(all.map((row) => (c < row.length ? row[c] : "")));
  }
  if (!header) return { labels: null, rows: columns };
  return { labels: columns.map((column) => column[0]), rows: columns.map((column) => column.slice(1)) };
}

const NO_REPEAT = " no repeat";

// "Verse 2x" -> { name: "Verse", repeat: "2x" }, "A no repeat" -> { name: "A", repeat: "no repeat" }:
// a repeat note at the end of a part cell is drawn after the part box, not in it.
function splitPartRepeat(part) {
  if (part.endsWith(NO_REPEAT)) return { name: part.slice(0, -NO_REPEAT.length), repeat: NO_REPEAT.trim() };
  const cut = part.lastIndexOf(" ");
  const last = part.slice(cut + 1);
  const isCount = cut > 0 && last.length > 1 && last.endsWith("x") && Number.isInteger(Number(last.slice(0, -1)));
  return isCount ? { name: part.slice(0, cut), repeat: last } : { name: part, repeat: "" };
}

// One row of a form table -> a step of the form: `[number, text]` or
// `[number, part, text]`. The text is `;`-separated: the first piece is what
// plays (`lead`), pieces starting with `+` are instruments joining in
// (`adds`), anything else is an aside (`notes`).
export function parseFormStep(cells) {
  const number = cells[0] || "";
  const { name: part, repeat: partRepeat } = splitPartRepeat(cells.length > 2 ? cells[1] : "");
  const text = cells.slice(cells.length > 2 ? 2 : 1).join(" ");
  const pieces = text.split(";").map((piece) => piece.trim()).filter(Boolean);
  let lead = pieces.length > 0 && !pieces[0].startsWith("+") ? pieces.shift() : "";
  // A count on the lead text ("Collective 2x") belongs in the arrow too, when the part cell had none.
  let repeat = partRepeat;
  if (repeat === "") {
    const split = splitPartRepeat(lead);
    lead = split.name;
    repeat = split.repeat;
  }
  const adds = pieces.filter((piece) => piece.startsWith("+")).map((piece) => piece.slice(1).trim());
  const notes = pieces.filter((piece) => !piece.startsWith("+"));
  return { number, part, repeat, lead, adds, notes };
}

// The part order written as a `P:` field in the tune header (before `K:`),
// e.g. `P:Intro A C A B B B A Intro`, as one form-table row per part:
// `[number, part, ""]`. Null when the header has none (a `P:` after `K:` is a
// part marker in the music, not an order).
export function extractPartOrderRows(abcText) {
  for (const line of abcText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("K:")) return null;
    if (trimmed.startsWith("P:")) {
      const parts = trimmed.slice(2).split(/\s+/).filter(Boolean);
      return parts.length > 1 ? parts.map((part, i) => [String(i + 1), part, ""]) : null;
    }
  }
  return null;
}
