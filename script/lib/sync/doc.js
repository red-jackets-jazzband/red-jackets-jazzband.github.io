/*
   Between local storage and a sync document (docs/device-sync-plan.md, WBS
   5.1, 5.4, 4.6): `buildLocalDoc` reads setlists, own song forms, the shared
   spaces this device is in (see band-spaces.js) and the sync metadata into a
   document (leaving out the guided tour's demo setlist, and
   stamping what an older app copy changed without stamping, found by
   comparing with the last-synced snapshot); `applyDoc` writes a merged
   document back and saves it as the new snapshot. Both are synchronous, so
   the engine builds, merges and applies with no gap an edit could fall into.
*/
import { listPersonalSetlists, replacePersonalSetlists } from "../setlists/setlists-store.js";
import { songFormPrefKey } from "../core/preferences.js";
import { applyLocalSpaces, readLocalSpaces } from "./band-spaces.js";
import { notifyLocalChange } from "./changes.js";
import { FORMAT, hasInternalMarker } from "./validate.js";
import { observeStamp, readMeta, rowTombstoneKey, stampAfter, writeMeta } from "./clock.js";

const FORM_PREFIX = songFormPrefKey("");

function safe(read) {
  try {
    return read();
  } catch {
    return null;
  }
}

function formFiles(storage) {
  const files = [];
  const count = safe(() => { return storage.length; });
  for (let i = 0; i < (Number.isInteger(count) ? count : 0); i++) {
    const key = safe(() => { return storage.key(i); });
    if (typeof key === "string" && key.startsWith(FORM_PREFIX)) files.push(key.slice(FORM_PREFIX.length));
  }
  return files;
}

function rowContent(row) {
  return JSON.stringify(Object.keys(row).filter((key) => {
    return key !== "id" && key !== "updatedAt";
  }).sort((a, b) => { return a.localeCompare(b); }).map((key) => { return [key, row[key]]; }));
}

function rowIds(entry) {
  return entry.songs.map((r) => { return r.id; }).join();
}

function byId(items) {
  const map = {};
  items.forEach((item) => { map[item.id] = item; });
  return map;
}

// A tombstone older than the item it now deletes is stale (a newer edit
// restored the item); a new deletion needs a stamp beyond the item's own.
function recordDeletion(tombs, key, itemAt, bump) {
  if (tombs[key] === undefined || tombs[key] < itemAt) tombs[key] = Math.max(bump(), itemAt + 1);
}

// Stamps `entry` where it differs from `old` (its snapshot) without a newer stamp.
function detectSetlist(entry, old, meta, now, tomb) {
  const bump = () => { return stampAfter(meta, now); };
  if ((entry.name !== old.name || entry.desc !== old.desc) && entry.metaAt <= old.metaAt) entry.metaAt = bump();
  const oldRows = byId(old.songs);
  const gone = old.songs.filter((row) => {
    return !entry.songs.some((r) => { return r.id === row.id; });
  });
  if ((rowIds(entry) !== rowIds(old)) && entry.orderAt <= old.orderAt) entry.orderAt = bump();
  entry.songs.forEach((row) => {
    const was = oldRows[row.id];
    if (was && rowContent(row) !== rowContent(was) && row.updatedAt <= was.updatedAt) row.updatedAt = bump();
  });
  gone.forEach((row) => {
    recordDeletion(tomb.rows, rowTombstoneKey(entry.id, row.id), row.updatedAt, bump);
  });
  entry.updatedAt = Math.max(entry.updatedAt, entry.metaAt, entry.orderAt, ...entry.songs.map((r) => { return r.updatedAt; }));
}

function detectSetlists(setlists, snap, meta, now) {
  const old = byId(snap.setlists);
  setlists.forEach((entry) => {
    if (old[entry.id]) detectSetlist(entry, old[entry.id], meta, now, meta.tomb);
  });
  const here = byId(setlists);
  snap.setlists.forEach((entry) => {
    if (!here[entry.id]) recordDeletion(meta.tomb.setlists, entry.id, entry.updatedAt, () => { return stampAfter(meta, now); });
  });
}

function detectForms(forms, snap, meta, now) {
  const old = {};
  snap.forms.forEach((form) => { old[form.file] = form; });
  forms.forEach((form) => {
    const was = old[form.file];
    if (was && was.raw !== form.raw && form.at <= was.at) form.at = stampAfter(meta, now);
    // Recreated by an app copy that doesn't stamp, after its deletion synced.
    const deletedAt = meta.tomb.forms[form.file];
    if (!was && deletedAt !== undefined && form.at <= deletedAt) form.at = stampAfter(meta, now);
  });
  snap.forms.forEach((form) => {
    const still = forms.some((f) => { return f.file === form.file; });
    if (!still) recordDeletion(meta.tomb.forms, form.file, form.at, () => { return stampAfter(meta, now); });
  });
}

// A space is stamped where it is new (`addedAt`), or its label / shared files
// differ from the snapshot's without a newer stamp; one gone since the
// snapshot gets a tombstone. A space joined again after a deletion is newer.
function detectSpaces(spaces, snap, meta, now) {
  const bump = () => { return stampAfter(meta, now); };
  const old = {};
  (snap.spaces || []).forEach((space) => { old[space.code] = space; });
  spaces.forEach((space) => {
    const was = old[space.code];
    if (!space.addedAt) space.addedAt = bump();
    if (!space.labelAt || (was && was.label !== space.label && space.labelAt <= was.labelAt)) space.labelAt = bump();
    if (!space.sharedAt || (was && !sameFiles(was.shared, space.shared) && space.sharedAt <= was.sharedAt)) space.sharedAt = bump();
    const deletedAt = meta.tomb.spaces[space.code];
    if (!was && deletedAt !== undefined && space.addedAt <= deletedAt) space.addedAt = bump();
    meta.spaces[space.code] = { addedAt: space.addedAt, labelAt: space.labelAt, sharedAt: space.sharedAt };
  });
  (snap.spaces || []).forEach((was) => {
    if (!spaces.some((space) => { return space.code === was.code; })) {
      recordDeletion(meta.tomb.spaces, was.code, was.addedAt, bump);
      delete meta.spaces[was.code];
    }
  });
}

function sameFiles(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((file, i) => { return file === b[i]; });
}

function validSnapshot(snap) {
  return Boolean(snap) && Array.isArray(snap.setlists) && Array.isArray(snap.forms);
}

export function buildLocalDoc(storage, now) {
  const clock = now === undefined ? Date.now() : now;
  const meta = readMeta(storage);
  const setlists = JSON.parse(JSON.stringify(listPersonalSetlists(storage)))
    .filter((entry) => { return !hasInternalMarker(entry.desc); });
  const forms = formFiles(storage).map((file) => {
    const raw = safe(() => { return storage.getItem(songFormPrefKey(file)); });
    return { file, raw: typeof raw === "string" ? raw : "", at: meta.forms[file] || 0 };
  }).filter((form) => { return form.raw; });
  const spaces = readLocalSpaces(storage, meta);
  const snap = validSnapshot(meta.snapshot) ? meta.snapshot : { setlists: [], forms: [], spaces: [] };
  if (snap === meta.snapshot) {
    detectSetlists(setlists, snap, meta, clock);
    detectForms(forms, snap, meta, clock);
  }
  detectSpaces(spaces, snap, meta, clock);
  writeMeta(storage, meta);
  return { format: FORMAT, device: meta.deviceId, setlists, forms, spaces, tomb: JSON.parse(JSON.stringify(meta.tomb)) };
}

function applyForms(storage, doc, meta) {
  const keep = {};
  doc.forms.forEach((form) => {
    keep[form.file] = true;
    meta.forms[form.file] = form.at;
    observeStamp(meta, form.at);
    if (safe(() => { return storage.getItem(songFormPrefKey(form.file)); }) !== form.raw) {
      safe(() => { return storage.setItem(songFormPrefKey(form.file), form.raw); });
    }
  });
  formFiles(storage).filter((file) => { return !keep[file]; }).forEach((file) => {
    safe(() => { return storage.removeItem(songFormPrefKey(file)); });
    delete meta.forms[file];
  });
}

export function applyDoc(storage, doc) {
  const meta = readMeta(storage);
  const demos = listPersonalSetlists(storage).filter((entry) => { return hasInternalMarker(entry.desc); });
  replacePersonalSetlists(storage, [...doc.setlists, ...demos]);
  doc.setlists.forEach((entry) => {
    [entry.metaAt, entry.orderAt, entry.updatedAt].forEach((at) => { observeStamp(meta, at); });
    entry.songs.forEach((row) => { observeStamp(meta, row.updatedAt); });
  });
  applyForms(storage, doc, meta);
  // Spaces last: leaving one copies its setlists into the personal ones just written.
  const copied = applyLocalSpaces(storage, doc.spaces || [], meta);
  meta.tomb = doc.tomb;
  Object.keys(doc.tomb).forEach((kind) => {
    Object.keys(doc.tomb[kind]).forEach((key) => { observeStamp(meta, doc.tomb[kind][key]); });
  });
  // What is here now, which can differ from the document (a space skipped
  // because this device is already in the most it can be; one that wouldn't
  // leave): a space missing from the snapshot is not taken for a deletion.
  meta.snapshot = { ...doc, spaces: readLocalSpaces(storage, meta) };
  writeMeta(storage, meta);
  // The copies made on leaving aren't in what was just sent: upload them.
  if (copied) notifyLocalChange();
}
