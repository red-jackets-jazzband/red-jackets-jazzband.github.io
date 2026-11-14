/*
   Validation of a decrypted sync document (docs/device-sync-plan.md, WBS 5.5,
   5.7). Anyone holding the code can write a valid blob, so nothing here is
   trusted: a song `file` becomes a fetch path, `desc` and notes are drawn on
   the page. Invalid items are dropped, never written anywhere. Fields this
   version doesn't know are kept (an older app copy must not strip newer
   data), and a newer `format` is download-only.
*/
import { readStoredForm } from "../music/song-form.js";
import { parseCode } from "./crypto.js";

export const FORMAT = 1;

const ID = /^[\w-]{1,64}$/;
const SONG_FILE = /^[a-z0-9][\w.-]{0,100}\.abc$/i;

export function isSongFile(value) {
  return typeof value === "string" && SONG_FILE.test(value);
}

const FORM_KEY = /^[\w.-]{1,120}$/;
const MAX_ROWS = 500;
export const MAX_SETLISTS = 100;
const MAX_FORMS = 200;
export const MAX_SPACES = 8; // must equal band-store.js MAX_BANDS (this is the lower layer; a test checks it)
const LIMITS = { name: 200, desc: 5000, note: 2000, divider: 200, key: 20, form: 20000 };

const CONTROL = /[\u0000-\u0009\u000b-\u001f]/; // eslint-disable-line no-control-regex -- detecting internal markers is the point
const CONTROL_ALL = /[\u0000-\u0009\u000b-\u001f]/g; // eslint-disable-line no-control-regex -- stripping stray control bytes

// The guided tour's demo setlist carries a control-character marker in desc;
// it is never synced (and never accepted from a vault).
export function hasInternalMarker(desc) {
  return CONTROL.test(String(desc || ""));
}

export function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isId(value) {
  return typeof value === "string" && ID.test(value);
}

export function stamp(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function text(value, max) {
  return typeof value === "string" && value.length <= max;
}

function cleanRow(row) {
  if (!isObject(row) || !isId(row.id)) return null;
  const hasFile = typeof row.file === "string";
  const hasDivider = typeof row.divider === "string";
  if (hasFile === hasDivider) return null;
  if (hasFile && !SONG_FILE.test(row.file)) return null;
  if (hasDivider && !text(row.divider, LIMITS.divider)) return null;
  if (row.key !== undefined && !text(row.key, LIMITS.key)) return null;
  if (row.note !== undefined && !text(row.note, LIMITS.note)) return null;
  const out = { ...row, updatedAt: stamp(row.updatedAt) };
  if (typeof out.note === "string") out.note = out.note.replace(/\r\n?/g, "\n").replace(CONTROL_ALL, "");
  return out;
}

export function cleanSetlist(entry) {
  if (!isObject(entry) || !isId(entry.id) || !text(entry.name, LIMITS.name)) return null;
  if (!Array.isArray(entry.songs) || entry.songs.length > MAX_ROWS) return null;
  const desc = text(entry.desc, LIMITS.desc) && !hasInternalMarker(entry.desc) ? entry.desc : "";
  const seen = {};
  const songs = entry.songs.map(cleanRow).filter((row) => {
    if (!row || seen[row.id]) return false;
    seen[row.id] = true;
    return true;
  });
  return {
    ...entry,
    desc,
    songs,
    metaAt: stamp(entry.metaAt),
    orderAt: stamp(entry.orderAt),
    updatedAt: stamp(entry.updatedAt),
  };
}

function cleanForm(form) {
  if (!isObject(form) || typeof form.file !== "string" || !SONG_FILE.test(form.file)) return null;
  if (!text(form.raw, LIMITS.form) || !readStoredForm(form.raw)) return null;
  return { ...form, at: stamp(form.at) };
}

// A shared space a device is in, as the personal vault carries it so the
// device's other devices join it too: { code, label, name, author, at,
// labelAt, addedAt, shared: [song files], sharedAt }. The code is the secret
// that opens the space; this document is encrypted under the personal code.
const SPACE_NAME = 40;

function cleanSpace(space) {
  if (!isObject(space)) return null;
  const code = parseCode(space.code);
  if (code === null || !isId(space.author)) return null;
  const label = typeof space.label === "string" ? space.label.slice(0, SPACE_NAME) : "";
  const name = typeof space.name === "string" ? space.name.slice(0, SPACE_NAME) : "";
  const shared = Array.isArray(space.shared) ? space.shared.filter(isSongFile).slice(0, MAX_FORMS) : [];
  return {
    ...space,
    code,
    label,
    name,
    shared: [...new Set(shared)].sort((a, b) => { return a.localeCompare(b); }),
    at: stamp(space.at),
    labelAt: stamp(space.labelAt),
    addedAt: stamp(space.addedAt),
    sharedAt: stamp(space.sharedAt),
  };
}

export function cleanTombs(tomb) {
  const out = { setlists: {}, rows: {}, forms: {}, spaces: {} };
  if (!isObject(tomb)) return out;
  Object.keys(out).forEach((kind) => {
    const source = isObject(tomb[kind]) ? tomb[kind] : {};
    Object.keys(source).forEach((key) => {
      if (FORM_KEY.test(key.replace("/", "_")) && Number.isFinite(source[key])) out[kind][key] = source[key];
    });
  });
  return out;
}

export function cleanList(list, max, clean) {
  return (Array.isArray(list) ? list : []).slice(0, max).map((item) => { return clean(item); }).filter(Boolean);
}

export function uniqueBy(items, field) {
  const seen = {};
  return items.filter((item) => {
    if (seen[item[field]]) return false;
    seen[item[field]] = true;
    return true;
  });
}

// → { ok: true, doc } | { ok: false, newer: true } (a newer format: download
// only) | { ok: false, newer: false } (not a sync document at all).
export function validateDoc(raw) {
  if (!isObject(raw) || !Number.isInteger(raw.format) || raw.format < 1) return { ok: false, newer: false };
  if (raw.format > FORMAT) return { ok: false, newer: true };
  return {
    ok: true,
    doc: {
      ...raw,
      format: FORMAT,
      device: typeof raw.device === "string" ? raw.device.slice(0, 64) : "",
      setlists: uniqueBy(cleanList(raw.setlists, MAX_SETLISTS, cleanSetlist), "id"),
      forms: uniqueBy(cleanList(raw.forms, MAX_FORMS, cleanForm), "file"),
      spaces: uniqueBy(cleanList(raw.spaces, MAX_SPACES, cleanSpace), "code"),
      tomb: cleanTombs(raw.tomb),
    },
  };
}
