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

// Case-insensitive substring match on the song name. An empty/blank query
// returns every song unchanged.
export function filterSongsByQuery(songs, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return songs;
  return songs.filter((song) => song.name.toLowerCase().includes(q));
}

// The .abc filename's basename, used both as the #s= hash and as the
// anchor id a search result links to (song_title in the pre-redesign code).
export function songTitleSlug(song) {
  return song.file ? song.file.split(".")[0] : "";
}
