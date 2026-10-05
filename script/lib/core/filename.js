// Turn an ABC filename into a readable title — the fallback for a setlist that
// references a song not in the library index (so it has no registered name).
// "some_old-song.abc" -> "Some Old Song".
export function humanizeSongFile(file) {
  return String(file || "")
    .replace(/\.abc$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
