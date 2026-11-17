// Parses the "Name,file.abc" per-line index format shared by
// index_of_songs.txt / index_of_songbook.txt / (later) index_of_setlists.txt.
export function parseSongIndex(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const parts = line.split(",");
      return { name: parts[0], file: parts[1] };
    })
    .filter((song) => song.name && song.file);
}

// Groups songs alphabetically by the first letter of their name, sorted by
// letter. Used for the library's grouped list / letter scroll rail.
export function groupSongsByLetter(songs) {
  const groups = new Map();
  for (const song of songs) {
    const letter = (song.name.charAt(0) || "#").toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(song);
  }
  return Array.from(groups.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((letter) => ({ letter, items: groups.get(letter) }));
}

// Lower-case, accent-free, punctuation-free form of a title or query
// ("Ain't my fault" → "aint my fault"), so apostrophes, hyphens and accents
// never stand between a visitor and a match. An apostrophe inside a word is
// dropped, not turned into a space, so "It's" stays the one word "its".
export function normalizeSearch(text) {
  return (text || "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Optimal-string-alignment distance (insert/delete/substitute/swap of two
// neighbours) — a swapped pair of letters is the commonest typo.
function editDistance(a, b) {
  const rows = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push([i]);
  }
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = best;
    }
  }
  return rows[a.length][b.length];
}

// How many typos a query word of this length may carry: none when it is
// short (too many false hits), one up to six letters, two beyond.
function allowedTypos(length) {
  if (length < 4) return 0;
  return length < 7 ? 1 : 2;
}

// A typo-tolerant match of one query word against one title word: the word,
// or its same-length beginning (so a half-typed word still counts).
function fuzzyWordMatch(token, word) {
  const max = allowedTypos(token.length);
  if (max === 0) return false;
  return editDistance(token, word) <= max || editDistance(token, word.slice(0, token.length)) <= max;
}

// 0 = the query is in the title as typed (spaces ignored too, "allofme"),
// 1 = every query word is in some title word, 2 = every query word is close
// to some title word, -1 = no match.
function matchRank(name, q, qCompact, tokens) {
  const title = normalizeSearch(name);
  if (title.includes(q) || title.split(" ").join("").includes(qCompact)) return 0;
  const words = title.split(" ");
  if (tokens.every((t) => words.some((w) => w.includes(t)))) return 1;
  if (tokens.every((t) => words.some((w) => w.includes(t) || fuzzyWordMatch(t, w)))) return 2;
  return -1;
}

// Fuzzy match on the song name: case, accents and punctuation don't matter,
// words may come in any order or be half-typed, and a small typo is
// forgiven. Exact matches come first. An empty/blank query returns every song
// unchanged; a query with text but nothing searchable in it ("東京", "!!!")
// matches nothing, like any other query that finds no song.
export function filterSongsByQuery(songs, query) {
  const q = normalizeSearch(query);
  if (!q) return (query || "").trim() ? [] : songs;
  const qCompact = q.split(" ").join("");
  const tokens = q.split(" ");
  const ranked = [];
  songs.forEach((song, index) => {
    const rank = matchRank(song.name, q, qCompact, tokens);
    if (rank >= 0) ranked.push({ song, rank, index });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map((entry) => entry.song);
}

// The .abc filename's basename, used both as the #s= hash and as the
// anchor id a search result links to (song_title in the pre-redesign code).
export function songTitleSlug(song) {
  return song.file ? song.file.split(".")[0] : "";
}
