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

   Where the local keys live is band-store.js; an own version's `raw` is always
   the song form's own stored value (rj.songForm.<file>). This file is the
   document model, its validation and merge, and the engine codec.
*/
import { songFormPrefKey } from "../core/preferences.js";
import { readStoredForm } from "../music/song-form.js";
import { listPersonalSetlists, replacePersonalSetlists } from "../setlists/setlists-store.js";
import { canonical } from "./canonical.js";
import { observeStamp, pruneTombstones, readMeta, stampAfter, writeMeta } from "./clock.js";
import { maxTomb, mergeSetlists } from "./merge.js";
import { MAX_SETLISTS, cleanList, cleanSetlist, cleanTombs, isId, isObject, isSongFile, stamp, text, uniqueBy } from "./validate.js";
import { bandKeys, bandSetlistStorage, cleanName, connectedBands, readJson, readProfile, sharedFiles, writeJson } from "./band-store.js";

export const BAND_FORMAT = 2;

const MAX_MEMBERS = 60;

const MAX_VERSIONS = 400;

const FORM_MAX = 20000;

export function versionKey(file, author) {
  return `${file}/${author}`;
}

export function emptyBandDoc() {
  return { format: BAND_FORMAT, device: "", members: [], versions: [], setlists: [], tomb: { versions: {}, setlists: {}, rows: {} } };
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
  delete out.spaces; // the personal vault's kind
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
