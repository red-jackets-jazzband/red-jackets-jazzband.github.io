/*
   The band space (docs/device-sync-plan.md, phase 2): a second vault, with its
   own code, that holds only what a member chose to share — for now, song-form
   versions, each under its author's name. Same server, same encryption, same
   engine (createVaultEngine); this file is the band space's "codec".

   Document: { format, device, members: [{ author, name, at }],
               versions: [{ file, author, raw, at }],
               setlists: [setlist as in the personal vault],
               tomb: { versions: { "<file>/<author>": at },
                       setlists: { id: at }, rows: { "<setlist>/<row>": at } } }

   Shared setlists belong to the space, not to a member: anyone in it can
   create, edit and delete one, and they merge exactly like the personal
   vault's (rows by id, newest edit wins; lib/sync/merge.js's mergeSetlists).
   Each space's setlists are kept locally in the same shape as personal ones,
   under their own keys (rj.band.<id>.setlists, with the deletion tombstones
   and stamp clock in rj.band.<id>.meta), so the setlists store's own
   functions edit them through bandSetlistStorage().

   Only an author changes their own versions — enforced by the app (the UI
   offers no edit of anyone else's), not the server: names and authorship are
   labels among bandmates, not a login. Everything downloaded is validated like
   any decrypted data.

   A device can be in several band spaces. Each has a local id (random, never
   sent anywhere) and a label only this device sees; rj.band.list holds
   [{ id, label }], and every other key is scoped by that id:
   rj.band.<id>.code / .oldcode (the vault), .state ({ version, pending,
   snapshot }, the engine's bookkeeping), .profile ({ author, name, at } — the
   name and author id are per band, so one band can't tell it is the same
   person as in another), .shared ({ <file>: true }: own song forms shared
   with that band), .setlists/.meta (its shared setlists and their tombstones)
   and .doc (the last merged document — where other members'
   versions are read from). An own version's `raw` is always the song form's
   own stored value (rj.songForm.<file>).
*/
import { tl } from "../core/i18n.js";
import { songFormPrefKey } from "../core/preferences.js";
import { readStoredForm } from "../music/song-form.js";
import { deletePersonalSetlist, listPersonalSetlists, replacePersonalSetlists, tryCopyBandSetlistToPersonal } from "../setlists/setlists-store.js";
import { canonical } from "./engine.js";
import { META_KEY, nextStamp, observeStamp, pruneTombstones, readMeta, stampAfter, writeMeta } from "./clock.js";
import { maxTomb, mergeSetlists } from "./merge.js";
import { MAX_SETLISTS, cleanList, cleanSetlist, cleanTombs, isId, isObject, isSongFile, stamp, text, uniqueBy } from "./validate.js";

export const BAND_FORMAT = 2;
const SETLISTS_KEY = "rj.setlists.v1"; // the personal store's key, which a scoped storage redirects
const LIST_KEY = "rj.band.list";
export const MAX_BANDS = 8;
const FIELDS = ["code", "oldcode", "state", "profile", "shared", "doc"];
const MAX_MEMBERS = 60;
const MAX_VERSIONS = 400;
const NAME_MAX = 40;
const FORM_MAX = 20000;

const CONTROL_ALL = /[\u0000-\u001f\u007f]/g; // eslint-disable-line no-control-regex -- stripping control bytes from a display name

function readJson(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key));
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (_e) {
    // storage unavailable or full — the band space just won't survive a reload.
  }
}

export function versionKey(file, author) {
  return `${file}/${author}`;
}

export function emptyBandDoc() {
  return { format: BAND_FORMAT, device: "", members: [], versions: [], setlists: [], tomb: { versions: {}, setlists: {}, rows: {} } };
}

export function cleanName(name) {
  return String(name === undefined || name === null ? "" : name).replace(CONTROL_ALL, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

// ---- the list of band spaces ---------------------------------------------

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

function randomHex(bytes) {
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

export function registerBand(storage, id, label) {
  const list = listBands(storage).filter((band) => { return band.id !== id; });
  list.push({ id, label: cleanName(label) || defaultBandLabel(list.length + 1) });
  writeList(storage, list);
}

export function renameBand(storage, id, label) {
  const name = cleanName(label);
  if (!name) return;
  writeList(storage, listBands(storage).map((band) => { return band.id === id ? { id, label: name } : band; }));
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

// ---- local profile, shares, cached document ------------------------------

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
}

// A song form that no longer exists can't stay shared with any band.
export function unshareEverywhere(storage, file) {
  listBands(storage).forEach((band) => { if (isShared(storage, band.id, file)) setShared(storage, band.id, file, false); });
}

export function readBandDoc(storage, id) {
  const checked = validateBandDoc(readJson(storage, bandKeys(id).doc));
  return checked.ok ? checked.doc : emptyBandDoc();
}

function versionsIn(storage, band, file) {
  const doc = readBandDoc(storage, band.id);
  const me = readProfile(storage, band.id).author;
  const names = {};
  doc.members.forEach((member) => { names[member.author] = member.name; });
  return doc.versions
    .filter((v) => { return v.file === file && v.author !== me; })
    .map((v) => {
      return { band: band.id, bandLabel: band.label, author: v.author, name: names[v.author] || "", rounds: readStoredForm(v.raw).rounds, raw: v.raw, at: v.at };
    });
}

// Other members' versions of a song across every band space joined, newest
// first: [{ band, bandLabel, author, name, rounds, raw, at }].
export function versionsOf(storage, file) {
  const out = [];
  connectedBands(storage).forEach((band) => { out.push(...versionsIn(storage, band, file)); });
  return out.sort((a, b) => { return b.at - a.at; });
}

// ---- shared setlists -----------------------------------------------------

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

// ---- validation ----------------------------------------------------------

function cleanMember(member) {
  if (!isObject(member) || !isId(member.author)) return null;
  return { ...member, name: cleanName(member.name), at: stamp(member.at) };
}

function cleanVersion(version) {
  if (!isObject(version) || !isSongFile(version.file) || !isId(version.author)) return null;
  if (!text(version.raw, FORM_MAX) || !readStoredForm(version.raw)) return null;
  return { ...version, at: stamp(version.at) };
}

function cleanBandTombs(tomb) {
  const out = { versions: {}, ...cleanTombs(tomb) };
  delete out.forms;
  const source = isObject(tomb) && isObject(tomb.versions) ? tomb.versions : {};
  Object.keys(source).forEach((key) => {
    const slash = key.lastIndexOf("/");
    if (slash > 0 && isSongFile(key.slice(0, slash)) && isId(key.slice(slash + 1)) && Number.isFinite(source[key])) {
      out.versions[key] = source[key];
    }
  });
  return out;
}

function uniqueVersions(versions) {
  return uniqueBy(versions.map((v) => { return { ...v, key: versionKey(v.file, v.author) }; }), "key")
    .map((v) => { const { key: _key, ...rest } = v; return rest; }); // eslint-disable-line no-unused-vars -- drops the helper field
}

// → { ok, doc } | { ok: false, newer } like validateDoc (a newer format is download-only).
export function validateBandDoc(raw) {
  if (!isObject(raw) || !Number.isInteger(raw.format) || raw.format < 1) return { ok: false, newer: false };
  if (raw.format > BAND_FORMAT) return { ok: false, newer: true };
  // A band document always has members and versions; a personal vault's
  // document (a Devices code typed into the Shared tab) has neither, and must
  // not be upgraded and written back as a band's.
  if (!Array.isArray(raw.members) || !Array.isArray(raw.versions)) return { ok: false, newer: false };
  return {
    ok: true,
    doc: {
      ...raw,
      format: BAND_FORMAT,
      device: typeof raw.device === "string" ? raw.device.slice(0, 64) : "",
      members: uniqueBy(cleanList(raw.members, MAX_MEMBERS, cleanMember), "author"),
      versions: uniqueVersions(cleanList(raw.versions, MAX_VERSIONS, cleanVersion)),
      setlists: uniqueBy(cleanList(raw.setlists, MAX_SETLISTS, cleanSetlist), "id"),
      tomb: cleanBandTombs(raw.tomb),
    },
  };
}

// ---- merge ---------------------------------------------------------------

function firstWins(stampA, deviceA, stampB, deviceB) {
  return stampA !== stampB ? stampA > stampB : deviceA >= deviceB;
}

function mergeMembers(a, b) {
  const byAuthor = {};
  const take = (member, device) => {
    const held = byAuthor[member.author];
    if (!held || firstWins(member.at, device, held.member.at, held.device)) byAuthor[member.author] = { member, device };
  };
  a.members.forEach((m) => { take(m, a.device || ""); });
  b.members.forEach((m) => { take(m, b.device || ""); });
  return Object.keys(byAuthor).sort((x, y) => { return x.localeCompare(y); }).map((k) => { return byAuthor[k].member; });
}

function mergeVersions(a, b, tomb) {
  const best = {};
  const take = (version, device) => {
    const key = versionKey(version.file, version.author);
    const held = best[key];
    if (!held || firstWins(version.at, device, held.version.at, held.device)) best[key] = { version, device };
  };
  a.versions.forEach((v) => { take(v, a.device || ""); });
  b.versions.forEach((v) => { take(v, b.device || ""); });
  return Object.keys(best).filter((key) => {
    const at = tomb.versions[key];
    return at === undefined || at < best[key].version.at;
  }).sort((x, y) => { return x.localeCompare(y); }).map((key) => { return best[key].version; });
}

function mergedTombs(a, b, now) {
  const tombs = {};
  ["versions", "setlists", "rows"].forEach((kind) => { tombs[kind] = maxTomb(a.tomb[kind] || {}, b.tomb[kind] || {}); });
  return pruneTombstones(tombs, now === undefined ? Date.now() : now);
}

// Pure and symmetric. `now` only decides which old tombstones are dropped.
export function mergeBandDocs(a, b, now) {
  const tomb = mergedTombs(a, b, now);
  const ctx = { tomb, devA: a.device || "", devB: b.device || "" };
  return {
    ...b,
    ...a,
    format: Math.max(a.format, b.format),
    device: a.device,
    members: mergeMembers(a, b),
    versions: mergeVersions(a, b, tomb),
    setlists: mergeSetlists({ setlists: a.setlists || [] }, { setlists: b.setlists || [] }, ctx),
    tomb,
  };
}

// ---- local ↔ document ----------------------------------------------------

function ownFormRaw(storage, file) {
  try {
    const raw = storage.getItem(songFormPrefKey(file));
    return typeof raw === "string" && readStoredForm(raw) ? raw : null;
  } catch {
    return null;
  }
}

function ownVersions(storage, id, cached, author, stampNew) {
  const before = {};
  cached.versions.forEach((v) => { if (v.author === author) before[v.file] = v; });
  const now = [];
  sharedFiles(storage, id).forEach((file) => {
    const raw = ownFormRaw(storage, file);
    if (raw === null) return;
    const old = before[file];
    now.push({ file, author, raw, at: old && old.raw === raw ? old.at : stampNew() }); // NOSONAR: no ?. on Safari 12
  });
  return now;
}

// The document for this device: the cached band doc with this member's own
// shared versions brought up to date (an edited one is stamped, an unshared or
// deleted one gets a tombstone) and their name.
export function buildBandDoc(storage, id, now) {
  const clock = now === undefined ? Date.now() : now;
  const cached = readBandDoc(storage, id);
  const profile = readProfile(storage, id);
  const meta = readMeta(storage);
  const mine = ownVersions(storage, id, cached, profile.author, () => { return stampAfter(meta, clock); });
  const tomb = { versions: { ...cached.tomb.versions }, setlists: {}, rows: {} };
  const keep = new Set(mine.map((v) => { return v.file; }));
  cached.versions.forEach((v) => {
    if (v.author !== profile.author || keep.has(v.file)) return;
    const key = versionKey(v.file, v.author);
    if (tomb.versions[key] === undefined || tomb.versions[key] < v.at) tomb.versions[key] = Math.max(stampAfter(meta, clock), v.at + 1);
  });
  const members = cached.members.filter((m) => { return m.author !== profile.author; });
  if (profile.name) members.push({ author: profile.author, name: profile.name, at: profile.at });
  writeMeta(storage, meta);
  const versions = cached.versions.filter((v) => { return v.author !== profile.author; }).concat(mine);
  const shared = bandSetlistStorage(storage, id);
  const device = readMeta(shared).deviceId; // this space's own, so spaces can't be linked by it
  const setlists = JSON.parse(JSON.stringify(listPersonalSetlists(shared))); // NOSONAR: structuredClone is Safari 15.4+
  const sharedTomb = readMeta(shared).tomb;
  tomb.setlists = { ...sharedTomb.setlists };
  tomb.rows = { ...sharedTomb.rows };
  return { format: BAND_FORMAT, device, members, versions, setlists, tomb };
}

// Writes the merged setlists, their tombstones and the newest stamp seen back
// into the space's own setlist storage.
function applySharedSetlists(storage, id, doc) {
  const shared = bandSetlistStorage(storage, id);
  const meta = readMeta(shared);
  replacePersonalSetlists(shared, doc.setlists);
  doc.setlists.forEach((entry) => {
    [entry.metaAt, entry.orderAt, entry.updatedAt].forEach((at) => { observeStamp(meta, at); });
    entry.songs.forEach((row) => { observeStamp(meta, row.updatedAt); });
  });
  meta.tomb = { setlists: doc.tomb.setlists, rows: doc.tomb.rows, forms: {} };
  Object.keys(meta.tomb).forEach((kind) => {
    Object.keys(meta.tomb[kind]).forEach((key) => { observeStamp(meta, meta.tomb[kind][key]); });
  });
  writeMeta(shared, meta);
}

// Saves the merged document as the cache and as the new snapshot.
export function applyBandDoc(storage, id, doc) {
  const meta = readMeta(storage);
  doc.members.forEach((m) => { observeStamp(meta, m.at); });
  doc.versions.forEach((v) => { observeStamp(meta, v.at); });
  writeMeta(storage, meta);
  applySharedSetlists(storage, id, doc);
  const keys = bandKeys(id);
  writeJson(storage, keys.doc, doc);
  writeJson(storage, keys.state, { ...readJson(storage, keys.state), snapshot: doc });
}

function bandContent(doc) {
  return canonical({ members: doc.members, versions: doc.versions, setlists: doc.setlists || [], tomb: doc.tomb });
}

function sameBandContent(a, b) {
  if (!a || !b || !Array.isArray(a.members) || !Array.isArray(b.members)) return false;
  return bandContent(a) === bandContent(b);
}

// The codec for one band space (see PERSONAL_CODEC in engine.js).
export function bandCodec(id) {
  const keys = bandKeys(id);
  return {
    codeKey: keys.code,
    oldCodeKey: keys.oldCode,
    build: (storage, now) => { return buildBandDoc(storage, id, now); },
    apply: (storage, doc) => { applyBandDoc(storage, id, doc); },
    merge: mergeBandDocs,
    validate: validateBandDoc,
    same: sameBandContent,
    readState(storage) {
      const state = readJson(storage, keys.state) || {};
      return { version: Number.isInteger(state.version) ? state.version : 0, pending: state.pending === true, snapshot: state.snapshot };
    },
    writeState(storage, patch) {
      const state = readJson(storage, keys.state) || {};
      if (patch.version !== undefined) state.version = patch.version;
      if (patch.pending !== undefined) state.pending = patch.pending;
      writeJson(storage, keys.state, state);
    },
  };
}

// Copies a space's setlists into personal ones. Each copy made is noted in the
// space's own `copied` key, so a retry after a failure skips it instead of
// duplicating it (that note can fail to save too when storage is full, so the
// copies made in this attempt are also removed again, best effort).
function copySetlistsToPersonal(storage, id) {
  const key = bandKeys(id).copied;
  const done = new Set(readJsonArray(storage, key));
  const made = [];
  for (const entry of listSharedSetlists(storage, id)) {
    if (!done.has(entry.id)) {
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
export function forgetBand(storage, id, { keepSetlists = true } = {}) {
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
