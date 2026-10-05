import { parseSetlistFile, serializeSetlistFile, isSetlistDivider } from "./setlist-format.js";

const STORAGE_KEY = "rj.setlists.v1";

function safeGetItem(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function parseStoredList(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readStorage(storage) {
  if (!storage) return [];
  const raw = safeGetItem(storage, STORAGE_KEY);
  if (!raw) return [];
  const parsed = parseStoredList(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function writeStorage(storage, list) {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (_e) {
    // storage unavailable/full — the change just won't persist.
  }
}

function generateId() {
  // Not crypto.randomUUID() — Safari 15.4+ only (see CLAUDE.md's Browser
  // support section), and this codebase's floor is Safari 12. Nothing here
  // needs cryptographic randomness, just a locally-unique id for a personal
  // setlist stored in this one browser's localStorage — timestamp plus a
  // random suffix is plenty.
  // Not a security context — sonarjs flags Math.random() as a
  // pseudo-random-number hotspot regardless of use.
  // eslint-disable-next-line sonarjs/pseudo-random
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function findEntry(list, id) {
  return list.find((entry) => {
    return entry.id === id;
  });
}

export function listPersonalSetlists(storage) {
  return readStorage(storage);
}

export function getPersonalSetlist(storage, id) {
  return findEntry(readStorage(storage), id) || null;
}

function createEntry(storage, data) {
  const list = readStorage(storage);
  const entry = {
    id: generateId(),
    name: data.name,
    desc: data.desc || "",
    songs: data.songs ? data.songs.slice() : [],
  };
  list.push(entry);
  writeStorage(storage, list);
  return entry;
}

export function createPersonalSetlist(storage, name) {
  return createEntry(storage, { name, desc: "", songs: [] });
}

export function deletePersonalSetlist(storage, id) {
  const list = readStorage(storage).filter((entry) => {
    return entry.id !== id;
  });
  writeStorage(storage, list);
}

export function renamePersonalSetlist(storage, id, name) {
  const list = readStorage(storage);
  const entry = findEntry(list, id);
  if (entry) entry.name = name;
  writeStorage(storage, list);
}

// Blanks an entry's desc — used to drop a hidden marker (see the guided
// tour's demo-setlist marker) once whatever set it no longer applies,
// without touching anything a visitor can see or set themselves.
export function clearPersonalSetlistMarker(storage, id) {
  const list = readStorage(storage);
  const entry = findEntry(list, id);
  if (entry) entry.desc = "";
  writeStorage(storage, list);
}

export function addSongToPersonalSetlist(storage, id, song) {
  const list = readStorage(storage);
  const entry = findEntry(list, id);
  if (entry) entry.songs.push(song);
  writeStorage(storage, list);
}

export function removeSongFromPersonalSetlist(storage, id, index) {
  const list = readStorage(storage);
  const entry = findEntry(list, id);
  if (entry) entry.songs.splice(index, 1);
  writeStorage(storage, list);
}

// Appends a set divider ("break") to the end of the list. Its label is left
// blank — the UI shows an auto "Set N" caption until one is typed in.
export function addDividerToPersonalSetlist(storage, id) {
  const list = readStorage(storage);
  const entry = findEntry(list, id);
  if (entry) entry.songs.push({ divider: "" });
  writeStorage(storage, list);
}

export function updateDividerLabelInPersonalSetlist(storage, id, index, label) {
  const list = readStorage(storage);
  const entry = findEntry(list, id);
  if (entry && isSetlistDivider(entry.songs[index])) entry.songs[index].divider = label;
  writeStorage(storage, list);
}

export function updateSongKeyInPersonalSetlist(storage, id, index, key) {
  const list = readStorage(storage);
  const entry = findEntry(list, id);
  if (entry && entry.songs[index]) entry.songs[index].key = key;
  writeStorage(storage, list);
}

// A per-song note — printed-setlist-only, e.g. who takes the solo. Sanitized
// on the way in (see sanitizeNote below), the one place this ever gets set
// from the UI, so every read of it is already clean.
export function updateSongNoteInPersonalSetlist(storage, id, index, note) {
  const list = readStorage(storage);
  const entry = findEntry(list, id);
  const song = entry && entry.songs[index];
  if (song) song.note = sanitizeNote(note);
  writeStorage(storage, list);
}

/*
   Reorders the whole `songs` array (items and dividers alike) to match
   `order`, a permutation of its indices — `order[k]` is the current index
   of the item that should end up at position `k`. This is what both the
   drag-to-reorder and the keyboard nudge produce: the UI works out the new
   arrangement, then hands the finished permutation here. No-op unless
   `order` is a genuine permutation of exactly `0..songs.length-1`.
*/
export function setPersonalSetlistOrder(storage, id, order) {
  const list = readStorage(storage);
  const entry = findEntry(list, id);
  if (entry) {
    const songs = entry.songs;
    const seen = {};
    const valid = Array.isArray(order) && order.length === songs.length &&
      order.every((i) => {
        if (!Number.isInteger(i) || i < 0 || i >= songs.length || seen[i]) return false;
        seen[i] = true;
        return true;
      });
    if (valid) {
      entry.songs = order.map((i) => { return songs[i]; });
    }
  }
  writeStorage(storage, list);
}

// Clones a band setlist's songs into a new, independent personal entry —
// editing the copy never touches the original band .txt file (which is
// static and read-only anyway).
export function copyBandSetlistToPersonal(storage, bandSetlist) {
  return createEntry(storage, {
    name: bandSetlist.name,
    desc: bandSetlist.desc || "",
    songs: bandSetlist.songs,
  });
}

// desc is free text a visitor can read on a printed booklet cover page — a
// legitimate one is real multi-line prose (so "\n" is fine) but never
// contains any other control character, so one that does is an app-internal
// flag (e.g. the guided tour's own demo-setlist marker) that must never leak
// into a downloaded file, or survive back out of one: discarded whole rather
// than stripped down to whatever readable text was riding along with it.
// Applied at both ends of the .txt boundary — on export so a marker never
// reaches the file in the first place, and on import too, so a file
// downloaded before this existed can't carry one in.
function sanitizeDesc(desc) {
  const value = String(desc || "").replace(/\r\n?/g, "\n");
  // eslint-disable-next-line no-control-regex -- detecting an internal marker is the point
  return /[\u0000-\u0009\u000b-\u001f]/.test(value) ? "" : value;
}

// A per-song note has no internal-marker convention to guard (unlike desc
// above) — it's just stray-byte hygiene, so offending characters are
// stripped rather than nuking the whole note. "\r\n"/"\r" (a note typed or
// pasted on Windows) is normalized to a plain "\n" rather than stripped, so
// line breaks survive.
function sanitizeNote(note) {
  const value = String(note || "").replace(/\r\n?/g, "\n");
  // eslint-disable-next-line no-control-regex -- stripping stray control bytes, not detecting a marker
  return value.replace(/[\u0000-\u0009\u000b-\u001f]/g, "");
}

function sanitizeSongs(songs) {
  return (songs || []).map((item) => {
    if (isSetlistDivider(item) || !item.note) return item;
    return { ...item, note: sanitizeNote(item.note) };
  });
}

// `songName(file)`, when given, resolves each song's real current title for
// the exported file's link text (see serializeSetlistFile) — the caller's
// own live song index, not something this storage module has access to.
export function exportPersonalSetlistText(storage, id, songName) {
  const entry = getPersonalSetlist(storage, id);
  return entry
    ? serializeSetlistFile(
      { ...entry, desc: sanitizeDesc(entry.desc), songs: sanitizeSongs(entry.songs) },
      { songName },
    )
    : null;
}

// Imports a setlist .txt (this device's own export, or one carried over
// from another device) as a new personal entry. `fallbackName` is used
// when the file has no "# name," comment line (e.g. hand-edited).
export function importPersonalSetlistText(storage, text, fallbackName) {
  const parsed = parseSetlistFile(text);
  return createEntry(storage, {
    name: parsed.name || fallbackName,
    desc: sanitizeDesc(parsed.desc),
    songs: sanitizeSongs(parsed.songs),
  });
}
