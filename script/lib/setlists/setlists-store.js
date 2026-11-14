import { parseSetlistFile, serializeSetlistFile, isSetlistDivider } from "./setlist-format.js";
import { notifyLocalChange } from "../sync/changes.js";
import { addTombstone, nextStamp, rowTombstoneKey } from "../sync/clock.js";

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

// Sync bookkeeping (docs/device-sync-plan.md, WBS 4): every setlist carries
// `metaAt` (name/desc), `orderAt` (which rows, in what order) and `updatedAt`
// (the newest of everything); every row an `id` and its own `updatedAt`.
// A delete leaves a tombstone in rj.sync.meta. Entries written before this
// existed get ids and stamp 0 on first read (a real edit anywhere beats them).
function migrateRow(row) {
  let changed = false;
  if (typeof row.id !== "string" || !row.id) {
    row.id = generateId();
    changed = true;
  }
  if (!Number.isFinite(row.updatedAt)) {
    row.updatedAt = 0;
    changed = true;
  }
  return changed;
}

function migrateEntry(entry) {
  let changed = false;
  ["metaAt", "orderAt", "updatedAt"].forEach((field) => {
    if (!Number.isFinite(entry[field])) {
      entry[field] = 0;
      changed = true;
    }
  });
  if (!Array.isArray(entry.songs)) {
    entry.songs = [];
    changed = true;
  }
  return entry.songs.map(migrateRow).some(Boolean) || changed;
}

function isEntryObject(entry) {
  return Boolean(entry) && typeof entry === "object" && !Array.isArray(entry);
}

function readStorage(storage) {
  if (!storage) return [];
  const raw = safeGetItem(storage, STORAGE_KEY);
  if (!raw) return [];
  const parsed = parseStoredList(raw);
  if (!Array.isArray(parsed)) return [];
  if (parsed.filter(isEntryObject).map(migrateEntry).some(Boolean)) writeStorage(storage, parsed, true);
  return parsed;
}

// Whether the list was saved (a full or unavailable storage returns false).
function writeStorage(storage, list, silent) {
  if (!storage) return false;
  let saved = true;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (_e) {
    // storage unavailable/full — the change just won't persist.
    saved = false;
  }
  if (!silent) notifyLocalChange();
  return saved;
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

function stampRow(row, at) {
  return { ...row, id: generateId(), updatedAt: at };
}

function createEntryChecked(storage, data) {
  const list = readStorage(storage);
  const at = nextStamp(storage);
  const entry = {
    id: generateId(),
    name: data.name,
    desc: data.desc || "",
    songs: data.songs ? data.songs.map((row) => { return stampRow(row, at); }) : [],
    metaAt: at,
    orderAt: at,
    updatedAt: at,
  };
  list.push(entry);
  return { entry, saved: writeStorage(storage, list) };
}

function createEntry(storage, data) {
  return createEntryChecked(storage, data).entry;
}

export function createPersonalSetlist(storage, name) {
  return createEntry(storage, { name, desc: "", songs: [] });
}

export function deletePersonalSetlist(storage, id) {
  const list = readStorage(storage);
  if (findEntry(list, id)) addTombstone(storage, "setlists", id, nextStamp(storage));
  writeStorage(storage, list.filter((entry) => {
    return entry.id !== id;
  }));
}

// Finds the entry, runs `change(entry, at)` with a fresh stamp, bumps the
// entry's `updatedAt` and saves. A missing id changes nothing.
function mutate(storage, id, change) {
  const list = readStorage(storage);
  const entry = findEntry(list, id);
  if (entry) {
    const at = nextStamp(storage);
    change(entry, at);
    entry.updatedAt = at;
    writeStorage(storage, list);
  }
}

export function renamePersonalSetlist(storage, id, name) {
  mutate(storage, id, (entry, at) => {
    entry.name = name;
    entry.metaAt = at;
  });
}

// Blanks an entry's desc — used to drop a hidden marker (see the guided
// tour's demo-setlist marker) once whatever set it no longer applies,
// without touching anything a visitor can see or set themselves.
export function clearPersonalSetlistMarker(storage, id) {
  mutate(storage, id, (entry, at) => {
    entry.desc = "";
    entry.metaAt = at;
  });
}

export function addSongToPersonalSetlist(storage, id, song) {
  mutate(storage, id, (entry, at) => {
    entry.songs.push(stampRow(song, at));
    entry.orderAt = at;
  });
}

// Insert a song or a set divider at `index` (clamped to the list), shifting
// everything after it down — how a set is split between two songs, or a
// song lands at the end of a particular set rather than the whole list.
export function insertItemInPersonalSetlist(storage, id, index, item) {
  mutate(storage, id, (entry, at) => {
    entry.songs.splice(Math.max(0, Math.min(index, entry.songs.length)), 0, stampRow(item, at));
    entry.orderAt = at;
  });
}

export function removeSongFromPersonalSetlist(storage, id, index) {
  mutate(storage, id, (entry, at) => {
    entry.songs.splice(index, 1).forEach((row) => {
      addTombstone(storage, "rows", rowTombstoneKey(id, row.id), at);
    });
    entry.orderAt = at;
  });
}

// Appends a set divider ("break") to the end of the list. Its label is left
// blank — the UI shows an auto "Set N" caption until one is typed in.
export function addDividerToPersonalSetlist(storage, id) {
  mutate(storage, id, (entry, at) => {
    entry.songs.push(stampRow({ divider: "" }, at));
    entry.orderAt = at;
  });
}

export function updateDividerLabelInPersonalSetlist(storage, id, index, label) {
  mutate(storage, id, (entry, at) => {
    const row = entry.songs[index];
    if (isSetlistDivider(row)) {
      row.divider = label;
      row.updatedAt = at;
    }
  });
}

export function updateSongKeyInPersonalSetlist(storage, id, index, key) {
  mutate(storage, id, (entry, at) => {
    const row = entry.songs[index];
    if (row) {
      row.key = key;
      row.updatedAt = at;
    }
  });
}

// A per-song note — printed-setlist-only, e.g. who takes the solo. Sanitized
// on the way in (see sanitizeNote below), the one place this ever gets set
// from the UI, so every read of it is already clean.
export function updateSongNoteInPersonalSetlist(storage, id, index, note) {
  mutate(storage, id, (entry, at) => {
    const row = entry.songs[index];
    if (row) {
      row.note = sanitizeNote(note);
      row.updatedAt = at;
    }
  });
}

function isPermutation(order, length) {
  const seen = {};
  return Array.isArray(order) && order.length === length &&
    order.every((i) => {
      if (!Number.isInteger(i) || i < 0 || i >= length || seen[i]) return false;
      seen[i] = true;
      return true;
    });
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
  const entry = getPersonalSetlist(storage, id);
  if (!entry || !isPermutation(order, entry.songs.length)) return;
  mutate(storage, id, (target, at) => {
    const songs = target.songs;
    target.songs = order.map((i) => { return songs[i]; });
    target.orderAt = at;
  });
}

// Clones a band setlist's songs into a new, independent personal entry —
// editing the copy never touches the original band .txt file (which is
// static and read-only anyway).
// Like copyBandSetlistToPersonal, but null when the copy couldn't be saved.
export function tryCopyBandSetlistToPersonal(storage, bandSetlist) {
  const { entry, saved } = createEntryChecked(storage, {
    name: bandSetlist.name,
    desc: bandSetlist.desc || "",
    songs: bandSetlist.songs,
  });
  return saved ? entry : null;
}

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

// Replaces the whole stored list — what the device-sync merge writes back
// (lib/sync/doc.js). Not for ordinary edits: those go through the mutators
// above, which stamp.
export function replacePersonalSetlists(storage, list) {
  writeStorage(storage, list, true);
}
