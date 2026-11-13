/*
   Sync metadata (rj.sync.meta) and the timestamp rule — docs/device-sync-plan.md,
   WBS 4.5. Everything is plain storage access, no DOM, so the setlists store,
   the song-form editor and the merge can all share it.

   Stored shape (JSON): { v, deviceId, maxStamp, forms, tomb }
     deviceId  random per device; breaks ties between equal stamps
     maxStamp  the highest stamp this device has made or seen
     forms     { <song file>: updatedAt } for own song forms (a form's own
               storage key stays exactly what older app copies expect)
     tomb      { setlists: { id: at }, rows: { "<setlist>/<row>": at },
                 forms: { file: at } } — deletions, pruned after 180 days
*/

export const META_KEY = "rj.sync.meta";
export const TOMBSTONE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function randomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => { return b.toString(16).padStart(2, "0"); }).join("");
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectOr(value) {
  return isObject(value) ? value : {};
}

function normalizeMeta(raw) {
  const meta = isObject(raw) ? raw : {};
  const tomb = objectOr(meta.tomb);
  return {
    ...meta,
    v: 1,
    deviceId: typeof meta.deviceId === "string" && meta.deviceId ? meta.deviceId : "",
    maxStamp: Number.isFinite(meta.maxStamp) ? meta.maxStamp : 0,
    forms: objectOr(meta.forms),
    tomb: {
      setlists: objectOr(tomb.setlists),
      rows: objectOr(tomb.rows),
      forms: objectOr(tomb.forms),
    },
  };
}

function readRaw(storage) {
  if (!storage) return null;
  try {
    return storage.getItem(META_KEY);
  } catch {
    return null;
  }
}

export function writeMeta(storage, meta) {
  if (!storage) return;
  try {
    storage.setItem(META_KEY, JSON.stringify(meta));
  } catch (_e) {
    // storage unavailable/full — stamps just restart from the clock next time.
  }
}

// Reads the metadata, creating (and saving) the device id on first use.
export function readMeta(storage) {
  const meta = normalizeMeta(parseJson(readRaw(storage)));
  if (!meta.deviceId) {
    meta.deviceId = randomId();
    writeMeta(storage, meta);
  }
  return meta;
}

// max(clock, highest stamp seen + 1): an edit can never lose to a stamp this
// device has already seen, however far behind its clock is.
export function stampAfter(meta, now) {
  const stamp = Math.max(now, meta.maxStamp + 1);
  meta.maxStamp = stamp;
  return stamp;
}

export function nextStamp(storage, now) {
  const meta = readMeta(storage);
  const stamp = stampAfter(meta, now === undefined ? Date.now() : now);
  writeMeta(storage, meta);
  return stamp;
}

// Records stamps seen in downloaded data so the next local stamp is above them.
export function observeStamp(meta, stamp) {
  if (Number.isFinite(stamp) && stamp > meta.maxStamp) meta.maxStamp = stamp;
}

export function rowTombstoneKey(setlistId, rowId) {
  return `${setlistId}/${rowId}`;
}

// kind: "setlists" | "rows" | "forms"
export function addTombstone(storage, kind, key, at) {
  const meta = readMeta(storage);
  meta.tomb[kind][key] = at;
  writeMeta(storage, meta);
}

export function setFormStamp(storage, file, at) {
  const meta = readMeta(storage);
  meta.forms[file] = at;
  delete meta.tomb.forms[file];
  writeMeta(storage, meta);
}

export function pruneTombstones(tomb, now) {
  const kept = {};
  Object.keys(tomb).forEach((kind) => {
    kept[kind] = {};
    Object.keys(tomb[kind]).forEach((key) => {
      if (now - tomb[kind][key] <= TOMBSTONE_MAX_AGE_MS) kept[kind][key] = tomb[kind][key];
    });
  });
  return kept;
}
