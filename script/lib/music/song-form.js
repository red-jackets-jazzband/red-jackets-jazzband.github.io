import { parseFormStep } from "./words-table.js";

/*
  A song form as a list of rounds, for the form editor (songs/sheet/song-form.js).

  The band's form is the tune's `W:| n | parts | text |` table (words-table.js);
  a visitor's own version is the same kind of table, kept in their browser.
  Here both are rounds:

    { parts: ["A", "B", "..."], repeat: "2x", lead: "Vocals", note: "riff: ...; +Banjo" }

  `parts` are the part names in the round's part cell, "..." (MORE: "as long as
  it takes") always last and at most once; `repeat` is a count written after
  them ("2x", "no repeat"), kept as it was; `lead` is what plays and `note` the
  rest of the text, `;`-separated as the table writes it. Every edit returns a
  new list and leaves the old one as it was.
*/

export const MORE = "...";

// One table row -> a round.
export function roundFromCells(cells) {
  const step = parseFormStep(cells);
  return {
    parts: step.part.split(" ").filter(Boolean),
    repeat: step.repeat,
    lead: step.lead,
    note: [...step.adds.map((add) => `+${add}`), ...step.notes].join("; "),
  };
}

// Every row of every table, as rounds (a tune normally has one form table).
export function roundsFromTables(tables) {
  const rounds = [];
  tables.forEach((table) => table.rows.forEach((cells) => rounds.push(roundFromCells(cells))));
  return rounds;
}

// A `|` would end the table cell early, so typed text can't carry one.
function cellText(text) {
  return text.split("|").join("/").trim();
}

function partCell(round) {
  return [...round.parts, round.repeat].filter(Boolean).join(" ");
}

function roundText(round) {
  return [cellText(round.lead), cellText(round.note)].filter(Boolean).join("; ");
}

// Rounds -> table rows `[number, parts, text]`, numbered from 1.
export function roundsToRows(rounds) {
  return rounds.map((round, i) => [String(i + 1), partCell(round), roundText(round)]);
}

// The form as the `W:` lines a song's .abc file carries.
export function formText(rounds) {
  return roundsToRows(rounds).map((cells) => `W:| ${cells.join(" | ")} |`).join("\n");
}

// Whether two rounds read the same once written out.
export function sameRound(a, b) {
  if (!a || !b) return false;
  return partCell(a) === partCell(b) && roundText(a) === roundText(b);
}

export function sameForm(a, b) {
  return a.length === b.length && a.every((round, i) => sameRound(round, b[i]));
}

/*
  The part names a round can be given: the tune's own `P:` parts, in the order
  the music marks them, then any other name the band's form uses ("Intro",
  "Riff"). "..." isn't one: it has its own button.
*/
export function partChoices(abcText, rounds) {
  const names = [];
  const add = (name) => {
    if (name && name !== MORE && !names.includes(name)) names.push(name);
  };
  let inBody = false;
  (abcText || "").split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("K:")) inBody = true;
    else if (inBody && trimmed.startsWith("P:")) add(trimmed.slice(2).trim());
  });
  rounds.forEach((round) => round.parts.forEach(add));
  return names;
}

// A fresh copy of the rounds, safe to change.
export function cloneRounds(rounds) {
  return rounds.map((round) => ({ ...round, parts: round.parts.slice() }));
}

// "..." to the end, and only once.
function tidyParts(parts) {
  const plain = parts.filter((part) => part !== MORE);
  return plain.length < parts.length ? [...plain, MORE] : plain;
}

function changeRound(rounds, index, change) {
  const next = cloneRounds(rounds);
  change(next[index]);
  next[index].parts = tidyParts(next[index].parts);
  return next;
}

// Add a part to round `index`: at the end, but before a "...".
export function addPart(rounds, index, name) {
  return changeRound(rounds, index, (round) => {
    const more = round.parts.indexOf(MORE);
    if (name === MORE || more < 0) round.parts.push(name);
    else round.parts.splice(more, 0, name);
  });
}

export function removePart(rounds, index, partIndex) {
  return changeRound(rounds, index, (round) => {
    round.parts.splice(partIndex, 1);
  });
}

export function removeRepeat(rounds, index) {
  return setRepeat(rounds, index, "");
}

// The count written after a round's parts: "2x", "3x", ..., or "" for none.
export function setRepeat(rounds, index, repeat) {
  return changeRound(rounds, index, (round) => {
    round.repeat = repeat;
  });
}

// The counts the editor offers for a round.
export const REPEAT_CHOICES = ["2x", "3x", "4x", "5x", "6x", "8x"];

const COUNT = /^(\d{1,2})x$/i;
// "AABA" or "abac": a run of letters A-D in one case, a form written the way
// a reader says it. "Head", "Bad" or "Intro" stay one name.
const LETTERS = /^(?:[A-D]{2,}|[a-d]{2,})$/;

function typedToken(token, typed) {
  const count = COUNT.exec(token);
  if (count) {
    typed.repeat = Number(count[1]) > 1 ? `${Number(count[1])}x` : "";
  } else {
    // "A..." is A, then as long as it takes; "..." inside a name stays put.
    let name = token;
    if (name.endsWith(MORE)) name = name.slice(0, -MORE.length);
    else if (name.endsWith("…")) name = name.slice(0, -1);
    if (LETTERS.test(name)) typed.parts.push(...name.toUpperCase().split(""));
    else if (name) typed.parts.push(name);
    if (name !== token) typed.parts.push(MORE);
  }
}

// What separates typed parts: any white space (a tab, a no-break space), a comma or a |.
const SEPARATORS = /[\s|,]+/;

/*
  Parts typed into a round's part field, for a form whose parts the music
  doesn't mark: "A A B A", "AABA" and "aaba" all give A A B A, "Intro Verse"
  two parts, "..." or "…" as long as it takes, and a count ("2x") the round's
  repeat. `repeat` is null when nothing typed was a count.
*/
export function parseTypedParts(text) {
  const typed = { parts: [], repeat: null };
  (text || "").split(SEPARATORS)
    .filter(Boolean)
    .forEach((token) => typedToken(token, typed));
  return typed;
}

// Add whatever `text` types to round `index`: its parts at the end (before a
// "..."), a count as its repeat.
export function addTypedParts(rounds, index, text) {
  const typed = parseTypedParts(text);
  let next = rounds;
  typed.parts.forEach((name) => {
    next = addPart(next, index, name);
  });
  if (typed.repeat !== null) next = setRepeat(next, index, typed.repeat);
  return next;
}

// `field` is "lead" or "note".
export function setText(rounds, index, field, value) {
  return changeRound(rounds, index, (round) => {
    round[field] = value;
  });
}

/*
  Move part `from.part` of round `from.round` to round `toRound`, before its
  part `toPart` (null: at the end). Within one round the part takes the
  target's place, so dragging A onto B in "A B" gives "B A". A "..." dropped
  on a round that has one already is left where it was.
*/
export function movePart(rounds, from, toRound, toPart) {
  const name = rounds[from.round].parts[from.part];
  if (name === undefined) return rounds;
  if (name === MORE && toRound !== from.round && rounds[toRound].parts.includes(MORE)) return rounds;
  const next = cloneRounds(rounds);
  next[from.round].parts.splice(from.part, 1);
  const target = next[toRound].parts;
  target.splice(toPart === null ? target.length : toPart, 0, name);
  next[from.round].parts = tidyParts(next[from.round].parts);
  next[toRound].parts = tidyParts(target);
  return next;
}

// Move round `from` so it ends up at position `to`.
export function moveRound(rounds, from, to) {
  if (from === to || to < 0 || to >= rounds.length) return rounds;
  const next = cloneRounds(rounds);
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function duplicateRound(rounds, index) {
  const next = cloneRounds(rounds);
  next.splice(index + 1, 0, cloneRounds([rounds[index]])[0]);
  return next;
}

export function deleteRound(rounds, index) {
  const next = cloneRounds(rounds);
  next.splice(index, 1);
  return next;
}

// A new last round playing `parts` (the song's parts once through).
export function addRound(rounds, parts) {
  return [...cloneRounds(rounds), { parts: parts.slice(), repeat: "", lead: "", note: "" }];
}

/*
  A visitor's own form as stored in their browser:
  `{"show":"mine"|"band","rows":[["1","A B","Collective"], ...]}`: the rows
  are table rows, the same cells a song's W: lines hold. Null for anything
  unreadable.
*/
function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function readStoredForm(raw) {
  const data = raw ? parseJson(raw) : null;
  if (!data || !Array.isArray(data.rows)) return null;
  const rows = data.rows.filter((cells) => Array.isArray(cells) && cells.every((cell) => typeof cell === "string"));
  return { show: data.show === "band" ? "band" : "mine", rounds: rows.map(roundFromCells) };
}

export function writeStoredForm(rounds, show) {
  return JSON.stringify({ show, rows: roundsToRows(rounds) });
}
