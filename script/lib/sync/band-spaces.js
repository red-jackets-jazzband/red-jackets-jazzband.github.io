/*
   The shared spaces a device is in, carried by its personal sync document
   (docs/device-sync-plan.md, "Spaces follow the devices"), so a device that
   joins the personal vault ends up in the same spaces — same code, label,
   display name and author id (one person is one member, not one per device)
   and the same song forms shared. One entry per space, keyed by its code:
     { code, label, labelAt, name, author, at, shared: [files], sharedAt, addedAt }
   `at` is the profile's own stamp; the other stamps live in rj.sync.meta
   (meta.spaces[code]), and lib/sync/doc.js sets them by comparing with the last
   synced snapshot, as it does for song forms. This is the bridge between
   band-store.js's local keys and doc.js / merge.js / validate.js; it uses the
   store's quiet internals, so applying a download never notifies the sync.
*/
import { observeStamp } from "./clock.js";
import { stamp } from "./validate.js";
import { MAX_BANDS, addToList, bandKeys, cleanName, connectedBands, dropBand, listBands, listSharedSetlists, newBandId, readProfile, relabel, sharedFiles, storedCode, writeJson } from "./band-store.js";

const sortedFiles = (storage, id) => {
  return sharedFiles(storage, id).sort((a, b) => { return a.localeCompare(b); });
};

// The spaces this device is in, as document entries (stamps from `meta`).
export function readLocalSpaces(storage, meta) {
  const out = [];
  connectedBands(storage).forEach((band) => {
    const code = storedCode(storage, band.id);
    if (code === null) return;
    const profile = readProfile(storage, band.id);
    const stamps = meta.spaces[code] || {};
    out.push({
      code,
      label: band.label,
      labelAt: stamp(stamps.labelAt),
      name: profile.name,
      author: profile.author,
      at: profile.at,
      shared: sortedFiles(storage, band.id),
      sharedAt: stamp(stamps.sharedAt),
      addedAt: stamp(stamps.addedAt),
    });
  });
  return out;
}

function sameList(a, b) {
  return a.length === b.length && a.every((item, i) => { return item === b[i]; });
}

// Brings a space this device already has up to the merged entry.
function updateSpace(storage, band, space) {
  if (space.label && band.label !== space.label) relabel(storage, band.id, cleanName(space.label));
  const profile = readProfile(storage, band.id);
  if (profile.author !== space.author || profile.name !== cleanName(space.name) || profile.at !== space.at) {
    writeJson(storage, bandKeys(band.id).profile, { author: space.author, name: cleanName(space.name), at: space.at });
  }
  if (!sameList(sortedFiles(storage, band.id), space.shared)) {
    const map = {};
    space.shared.forEach((file) => { map[file] = true; });
    writeJson(storage, bandKeys(band.id).shared, map);
  }
}

// Joins, on this device, a space another device is in. The code is written
// here and the space's own first sync (band.js) does the rest, as for a join;
// one that has since been deleted is found gone then and drops out again.
function addSpace(storage, space) {
  const id = newBandId();
  const keys = bandKeys(id);
  const shared = {};
  space.shared.forEach((file) => { shared[file] = true; });
  writeJson(storage, keys.profile, { author: space.author, name: cleanName(space.name), at: space.at });
  writeJson(storage, keys.shared, shared);
  try {
    storage.setItem(keys.code, space.code);
  } catch {
    return;
  }
  addToList(storage, id, space.label);
}

// Writes the merged `spaces` into this device: spaces gone from the list
// (left on another device) are left here too, keeping their setlists as
// personal ones; new ones are joined (up to MAX_BANDS); the rest follow the
// entry. Returns whether setlists were copied out of a space (the caller then
// has local changes to upload). meta.spaces gets the stamps of the entries now
// present, so the snapshot taken next sees exactly what is here.
export function applyLocalSpaces(storage, spaces, meta) {
  const want = new Set(spaces.map((space) => { return space.code; }));
  const here = new Map();
  connectedBands(storage).forEach((band) => {
    const code = storedCode(storage, band.id);
    if (code !== null) here.set(code, band);
  });
  let copied = false;
  here.forEach((band, code) => {
    if (want.has(code)) return;
    const had = listSharedSetlists(storage, band.id).length > 0;
    if (dropBand(storage, band.id)) {
      here.delete(code);
      copied = copied || had;
    }
  });
  spaces.forEach((space) => {
    const band = here.get(space.code);
    if (band) updateSpace(storage, band, space);
    else if (listBands(storage).length < MAX_BANDS) addSpace(storage, space);
  });
  // Every stamp received counts as seen, so a later local edit is stamped above it.
  spaces.forEach((space) => {
    [space.at, space.addedAt, space.labelAt, space.sharedAt].forEach((at) => { observeStamp(meta, at); });
  });
  const stamps = {};
  readLocalSpaces(storage, { spaces: {} }).forEach((local) => {
    const entry = spaces.find((space) => { return space.code === local.code; });
    const old = meta.spaces[local.code] || {};
    const from = entry || old;
    stamps[local.code] = { addedAt: stamp(from.addedAt), labelAt: stamp(from.labelAt), sharedAt: stamp(from.sharedAt) };
  });
  meta.spaces = stamps;
  return copied;
}
