/*
   The band spaces' local storage layer (docs/device-sync-plan.md, phase 2): no
   document model and no network, only what this device keeps in localStorage.

   A device can be in several band spaces. Each has a local id (random, never
   sent anywhere) and a label only this device sees; rj.band.list holds
   [{ id, label }], and every other key is scoped by that id:
   rj.band.<id>.code / .oldcode (the vault), .state ({ version, pending,
   snapshot }, the engine's bookkeeping), .profile ({ author, name, at }),
   .shared ({ <file>: true }: own song forms shared with that band),
   .setlists/.meta (its shared setlists and their tombstones) and .doc (the
   last merged document, read by lib/sync/band-vault.js).

   Layering: this file knows keys, the list, the profile, the share switches,
   the shared-setlist storage view and leaving a space. band-vault.js (the
   document, merge and engine codec) and band-spaces.js (carrying the list in
   the personal vault) build on it. The functions a person's own edit calls
   (register, rename, name, share, forget) tell the personal sync
   (changes.js), which carries the spaces to the device's other devices; the
   "quiet" internals exported for band-spaces.js (addToList, relabel, dropBand,
   writeJson) do not, so applying a download doesn't upload it again.
*/
import { tl } from "../core/i18n.js";
import { deletePersonalSetlist, listPersonalSetlists, tryCopyBandSetlistToPersonal } from "../setlists/setlists-store.js";
import { canonical } from "./canonical.js";
import { notifyLocalChange } from "./changes.js";
import { parseCode } from "./crypto.js";
import { META_KEY, nextStamp, readMeta, stampAfter, writeMeta } from "./clock.js";
import { isId, isObject, isSongFile, stamp } from "./validate.js";

const SETLISTS_KEY = "rj.setlists.v1"; // the personal store's key, which a scoped storage redirects

const LIST_KEY = "rj.band.list";

export const MAX_BANDS = 8;

const FIELDS = ["code", "oldcode", "state", "profile", "shared", "doc"];

const NAME_MAX = 40;

const CONTROL_ALL = /[\u0000-\u001f\u007f]/g; // eslint-disable-line no-control-regex -- stripping control bytes from a display name

export function readJson(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (_e) {
    // storage unavailable or full — the band space just won't survive a reload.
  }
}

export function cleanName(name) {
  return String(name === undefined || name === null ? "" : name).replace(CONTROL_ALL, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

export function bandKeys(id) {
  const key = (field) => { return `rj.band.${id}.${field}`; };
  return {
    code: key("code"), oldCode: key("oldcode"), state: key("state"), profile: key("profile"), shared: key("shared"), doc: key("doc"),
    setlists: key("setlists"), meta: key("meta"), copied: key("copied"),
  };
}

// The label a new band space starts with: "My Band", then "My Band 2", ...
export function defaultBandLabel(n) {
  return n === 1 ? tl("band_default_first", "My Band") : tl("band_default_label", "My Band {n}", { n });
}

export function randomHex(bytes) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => { return b.toString(16).padStart(2, "0"); }).join("");
}

// A fresh local id for a band space about to be started or joined.
export function newBandId() {
  return randomHex(4);
}

function readList(storage) {
  try {
    const list = JSON.parse(storage.getItem(LIST_KEY));
    if (!Array.isArray(list)) return null;
    return list.filter((band) => { return isObject(band) && isId(band.id); }).map((band) => {
      return { id: band.id, label: cleanName(band.label) };
    }).slice(0, MAX_BANDS);
  } catch {
    return null;
  }
}

function writeList(storage, list) {
  try {
    storage.setItem(LIST_KEY, JSON.stringify(list));
  } catch (_e) {
    // storage unavailable or full — the list just won't survive a reload.
  }
}

const legacyKey = (field) => { return `rj.band.${field}`; };

function hasLegacy(storage) {
  try {
    return FIELDS.some((field) => { return storage.getItem(legacyKey(field)) !== null; });
  } catch {
    return false;
  }
}

function moveLegacyField(storage, field, to) {
  try {
    const value = storage.getItem(legacyKey(field));
    if (value !== null) storage.setItem(to, value);
    storage.removeItem(legacyKey(field));
  } catch (_e) {
    // storage unavailable — nothing to move.
  }
}

// An earlier build held one band space under rj.band.<field>: move it under an id.
function migrateLegacy(storage) {
  if (!hasLegacy(storage)) return [];
  const id = newBandId();
  const keys = bandKeys(id);
  const target = { code: keys.code, oldcode: keys.oldCode, state: keys.state, profile: keys.profile, shared: keys.shared, doc: keys.doc };
  FIELDS.forEach((field) => { moveLegacyField(storage, field, target[field]); });
  const list = [{ id, label: defaultBandLabel(1) }];
  writeList(storage, list);
  return list;
}

// [{ id, label }] in joining order.
export function listBands(storage) {
  if (!storage) return [];
  return readList(storage) || migrateLegacy(storage);
}

export function addToList(storage, id, label) {
  const list = listBands(storage).filter((band) => { return band.id !== id; });
  list.push({ id, label: cleanName(label) || defaultBandLabel(list.length + 1) });
  writeList(storage, list);
}

// The local-edit functions below (register, rename, name, share, forget) tell
// the personal sync (changes.js), which carries the spaces to the device's
// other devices; the personal vault applying a download uses the quiet
// internals instead, so it doesn't upload what it just downloaded.
// Joining stamps the space's `addedAt` anew, so a join after a leave (before
// the personal sync has seen the leave, so no tombstone was recorded here) is
// still newer than any tombstone another device has uploaded since.
function stampJoin(storage, id) {
  const code = storedCode(storage, id);
  if (code === null) return; // not connected yet: the next document build stamps it
  const meta = readMeta(storage);
  meta.spaces[code] = { ...meta.spaces[code], addedAt: stampAfter(meta, Date.now()) };
  writeMeta(storage, meta);
}

export function registerBand(storage, id, label) {
  addToList(storage, id, label);
  stampJoin(storage, id);
  notifyLocalChange();
}

export function relabel(storage, id, name) {
  writeList(storage, listBands(storage).map((band) => { return band.id === id ? { id, label: name } : band; }));
}

export function renameBand(storage, id, label) {
  const name = cleanName(label);
  if (!name) return;
  relabel(storage, id, name);
  notifyLocalChange();
}

export function bandConnected(storage, id) {
  try {
    return Boolean(storage) && Boolean(storage.getItem(bandKeys(id).code));
  } catch {
    return false;
  }
}

// The band spaces this device is currently in.
export function connectedBands(storage) {
  return listBands(storage).filter((band) => { return bandConnected(storage, band.id); });
}

// { author, name, at }; the author id is made on first use.
export function readProfile(storage, id) {
  const stored = readJson(storage, bandKeys(id).profile) || {};
  const profile = {
    author: isId(stored.author) ? stored.author : randomHex(8),
    name: cleanName(stored.name),
    at: stamp(stored.at),
  };
  if (stored.author !== profile.author) writeJson(storage, bandKeys(id).profile, profile);
  return profile;
}

export function setDisplayName(storage, id, name, now) {
  const profile = readProfile(storage, id);
  profile.name = cleanName(name);
  profile.at = nextStamp(storage, now);
  writeJson(storage, bandKeys(id).profile, profile);
  notifyLocalChange();
  return profile;
}

export function sharedFiles(storage, id) {
  const stored = readJson(storage, bandKeys(id).shared) || {};
  return Object.keys(stored).filter((file) => { return stored[file] === true && isSongFile(file); });
}

export function isShared(storage, id, file) {
  return sharedFiles(storage, id).includes(file);
}

export function setShared(storage, id, file, on) {
  const stored = readJson(storage, bandKeys(id).shared) || {};
  if (on) stored[file] = true;
  else delete stored[file];
  writeJson(storage, bandKeys(id).shared, stored);
  notifyLocalChange();
}

// A song form that no longer exists can't stay shared with any band.
export function unshareEverywhere(storage, file) {
  listBands(storage).forEach((band) => { if (isShared(storage, band.id, file)) setShared(storage, band.id, file, false); });
}

// A view of `storage` in which the setlists store (and the stamp clock and
// tombstones next to it) live under this band space's own keys, so every
// function of setlists-store.js works on the space's setlists unchanged.
// null when there is no storage.
export function bandSetlistStorage(storage, id) {
  if (!storage) return null;
  const keys = bandKeys(id);
  const redirects = { [SETLISTS_KEY]: keys.setlists, [META_KEY]: keys.meta };
  const redirect = (key) => { return redirects[key] || key; };
  return {
    getItem: (key) => { return storage.getItem(redirect(key)); },
    setItem: (key, value) => { storage.setItem(redirect(key), value); },
    removeItem: (key) => { storage.removeItem(redirect(key)); },
  };
}

// The setlists shared in band space `id`, as setlist entries.
export function listSharedSetlists(storage, id) {
  return storage ? listPersonalSetlists(bandSetlistStorage(storage, id)) : [];
}

// The band space (of those joined) that holds setlist `setlistId`, or null.
export function findSharedSetlistBand(storage, setlistId) {
  const band = connectedBands(storage).find((b) => {
    return listSharedSetlists(storage, b.id).some((entry) => { return entry.id === setlistId; });
  });
  return band ? band.id : null;
}

// Copies a space's setlists into personal ones. Each copy made is noted in the
// space's own `copied` key, so a retry after a failure skips it instead of
// duplicating it (that note can fail to save too when storage is full, so the
// copies made in this attempt are also removed again, best effort).
// What makes two setlists "the same" for that purpose: name, text and songs.
function setlistShape(entry) {
  return canonical([entry.name, entry.desc || "", entry.songs.map((row) => {
    return [row.file || "", row.divider === undefined ? "" : row.divider, row.key || "", row.note || ""];
  })]);
}

// A copy identical to a personal setlist already here is skipped: when a
// device leaves a space its copies sync to the others, which leave it too.
function copySetlistsToPersonal(storage, id) {
  const key = bandKeys(id).copied;
  const done = new Set(readJsonArray(storage, key));
  const have = new Set(listPersonalSetlists(storage).map(setlistShape));
  const made = [];
  for (const entry of listSharedSetlists(storage, id)) {
    if (have.has(setlistShape(entry))) {
      done.add(entry.id);
    } else if (!done.has(entry.id)) {
      const copy = tryCopyBandSetlistToPersonal(storage, entry);
      if (copy === null) {
        made.forEach((item) => { deletePersonalSetlist(storage, item.id); done.delete(item.from); });
        writeJsonArray(storage, key, [...done]);
        return false;
      }
      made.push({ id: copy.id, from: entry.id });
      done.add(entry.id);
      writeJsonArray(storage, key, [...done]);
    }
  }
  return true;
}

function readJsonArray(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeJsonArray(storage, key, list) {
  try {
    storage.setItem(key, JSON.stringify(list));
  } catch (_e) {
    // storage full — a retry may duplicate a copy rather than lose one.
  }
}

// Leaving a band space: forget its code and what came from it, and drop it
// from the list. Own song forms stay (they were only ever copied), and so do
// the space's setlists, as personal ones — leaving never loses a setlist. If a
// copy can't be saved (storage full) nothing is removed and this returns
// false, so the setlists are still in the space. `keepSetlists: false` is for
// a join that failed halfway: what it downloaded is dropped, not promoted.
export function dropBand(storage, id, { keepSetlists = true } = {}) {
  const keys = bandKeys(id);
  if (keepSetlists && !copySetlistsToPersonal(storage, id)) return false;
  [keys.code, keys.state, keys.doc, keys.shared, keys.profile, keys.setlists, keys.meta, keys.copied].forEach((key) => {
    try {
      storage.removeItem(key);
    } catch (_e) {
      // storage unavailable — nothing to forget.
    }
  });
  const list = readList(storage);
  if (list) writeList(storage, list.filter((band) => { return band.id !== id; }));
  return true;
}

export function forgetBand(storage, id, options) {
  const done = dropBand(storage, id, options);
  if (done) notifyLocalChange();
  return done;
}

// A device's spaces ride in its personal sync document, so a device that joins
// that vault ends up in the same spaces — same code, same label, same name
// and author id (so one person is one member, not one per device) and the same
// song forms shared. One entry per space, keyed by its code:
//   { code, label, labelAt, name, author, at, shared: [files], sharedAt, addedAt }
// `at` is the profile's own stamp; the other stamps live in rj.sync.meta
// (meta.spaces[code]) and lib/sync/doc.js sets them by comparing with the last
// synced snapshot, as it does for song forms.

export function storedCode(storage, id) {
  try {
    return parseCode(storage.getItem(bandKeys(id).code));
  } catch {
    return null;
  }
}
