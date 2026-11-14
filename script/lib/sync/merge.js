/*
   The sync merge (docs/device-sync-plan.md, WBS 5.2–5.3). Pure: two sync
   documents in, one out; the result doesn't depend on which is "local".

   Document: { format, device, setlists: [{ id, name, desc, metaAt, orderAt,
   updatedAt, songs: [row] }], forms: [{ file, raw, at }], spaces: [{ code,
   label, labelAt, name, author, at, shared, sharedAt, addedAt }], tomb:
   { setlists, rows, forms, spaces } }. A row is { id, updatedAt, file | divider, key?, note? }.

   Rules: setlist name/desc and each song form — newest stamp wins, tie to
   the larger device id. Rows merge by id: rows only one side has are kept
   unless a tombstone is at least as new as the row; a row's own fields are
   newest-wins; the order comes from the side whose `orderAt` is newer, with
   rows only the other side has placed after the row they followed there.
   A tombstone at least as new as an item deletes it; a newer edit beats it.
   Shared spaces merge by code, each of label / profile (name + author id) /
   shared song files as a group by its own stamp; only `addedAt` (not a
   rename) beats a tombstone, so leaving a space on one device sticks.
*/
import { pruneTombstones, rowTombstoneKey } from "./clock.js";

function byId(items, key) {
  const map = {};
  items.forEach((item) => { map[item[key]] = item; });
  return map;
}

// The side that wins a comparison: the larger stamp, ties to the larger device id.
function firstWins(stampA, deviceA, stampB, deviceB) {
  return stampA !== stampB ? stampA > stampB : deviceA >= deviceB;
}

export function maxTomb(a, b) {
  const out = { ...a };
  Object.keys(b).forEach((key) => {
    out[key] = Math.max(out[key] === undefined ? -Infinity : out[key], b[key]);
  });
  return out;
}

function mergeTombs(a, b) {
  return {
    setlists: maxTomb(a.setlists, b.setlists),
    rows: maxTomb(a.rows, b.rows),
    forms: maxTomb(a.forms, b.forms),
    spaces: maxTomb(a.spaces || {}, b.spaces || {}),
  };
}

function isDeleted(tombs, key, at) {
  return tombs[key] !== undefined && tombs[key] >= at;
}

function pickRow(rowA, rowB, devA, devB) {
  if (!rowA || !rowB) return rowA || rowB;
  const [win, lose] = firstWins(rowA.updatedAt, devA, rowB.updatedAt, devB) ? [rowA, rowB] : [rowB, rowA];
  return { ...lose, ...win }; // fields only the losing copy knows (a newer app's) stay
}

function mergeRows(a, b, ctx) {
  const rowsA = byId(a.songs, "id");
  const rowsB = byId(b.songs, "id");
  const alive = (row) => {
    return row && !isDeleted(ctx.tomb.rows, rowTombstoneKey(a.id, row.id), row.updatedAt);
  };
  const resolve = (id) => {
    const row = pickRow(rowsA[id], rowsB[id], ctx.devA, ctx.devB);
    return alive(row) ? row : null;
  };
  const aLeads = firstWins(a.orderAt, ctx.devA, b.orderAt, ctx.devB);
  const [lead, other] = aLeads ? [a.songs, b.songs] : [b.songs, a.songs];
  const result = lead.map((row) => { return resolve(row.id); }).filter(Boolean);
  const placed = byId(result, "id");
  let anchor = null; // id of the last `other` row now in the result
  other.forEach((row) => {
    if (placed[row.id]) {
      anchor = row.id;
      return;
    }
    const resolved = resolve(row.id);
    if (!resolved) return;
    const at = anchor === null ? 0 : result.findIndex((r) => { return r.id === anchor; }) + 1;
    result.splice(at, 0, resolved);
    placed[row.id] = resolved;
    anchor = row.id;
  });
  return result;
}

function mergeSetlist(a, b, ctx) {
  if (!a || !b) {
    const only = a || b;
    const songs = only.songs.filter((row) => {
      return !isDeleted(ctx.tomb.rows, rowTombstoneKey(only.id, row.id), row.updatedAt);
    });
    return { ...only, songs };
  }
  const metaFromA = firstWins(a.metaAt, ctx.devA, b.metaAt, ctx.devB);
  const orderFromA = firstWins(a.orderAt, ctx.devA, b.orderAt, ctx.devB);
  const meta = metaFromA ? a : b;
  const base = orderFromA ? a : b;
  const merged = {
    ...(base === a ? b : a),
    ...base,
    ...meta,
    name: meta.name,
    desc: meta.desc,
    metaAt: Math.max(a.metaAt, b.metaAt),
    orderAt: Math.max(a.orderAt, b.orderAt),
    songs: mergeRows(a, b, ctx),
  };
  merged.updatedAt = Math.max(a.updatedAt, b.updatedAt, merged.songs.reduce((m, r) => { return Math.max(m, r.updatedAt); }, 0));
  return merged;
}

// `ctx` is { tomb, devA, devB }; the band space merges its setlists with this too.
export function mergeSetlists(a, b, ctx) {
  const mapA = byId(a.setlists, "id");
  const mapB = byId(b.setlists, "id");
  const ids = Object.keys({ ...mapA, ...mapB });
  return ids.map((id) => {
    const merged = mergeSetlist(mapA[id], mapB[id], ctx);
    return isDeleted(ctx.tomb.setlists, id, merged.updatedAt) ? null : merged;
  }).filter(Boolean).sort((x, y) => { return x.id.localeCompare(y.id); });
}

function pickForm(fa, fb, ctx) {
  return firstWins(fa.at, ctx.devA, fb.at, ctx.devB) ? fa : fb;
}

function mergeForms(a, b, ctx) {
  const mapA = byId(a.forms, "file");
  const mapB = byId(b.forms, "file");
  return Object.keys({ ...mapA, ...mapB }).map((file) => {
    const fa = mapA[file];
    const fb = mapB[file];
    const form = fa && fb ? pickForm(fa, fb, ctx) : fa || fb;
    return isDeleted(ctx.tomb.forms, file, form.at) ? null : form;
  }).filter(Boolean).sort((x, y) => { return x.file.localeCompare(y.file); });
}

// One field group of a shared space (label, profile, shared set) follows its
// own stamp: the side with the newer one supplies all of the group.
function pickGroup(sa, sb, ctx, stampKey) {
  return firstWins(sa[stampKey], ctx.devA, sb[stampKey], ctx.devB) ? sa : sb;
}

function mergeSpace(sa, sb, ctx) {
  if (!sa || !sb) return sa || sb;
  const label = pickGroup(sa, sb, ctx, "labelAt");
  const profile = pickGroup(sa, sb, ctx, "at");
  const shared = pickGroup(sa, sb, ctx, "sharedAt");
  return {
    ...sb,
    ...sa,
    code: sa.code,
    label: label.label,
    labelAt: Math.max(sa.labelAt, sb.labelAt),
    name: profile.name,
    author: profile.author,
    at: Math.max(sa.at, sb.at),
    shared: shared.shared,
    sharedAt: Math.max(sa.sharedAt, sb.sharedAt),
    addedAt: Math.max(sa.addedAt, sb.addedAt),
  };
}

// Shared spaces by code; a tombstone at least as new as `addedAt` removes one
// (leaving beats a later rename; joining again is a newer `addedAt`).
function mergeSpaces(a, b, ctx) {
  const mapA = byId(a.spaces || [], "code");
  const mapB = byId(b.spaces || [], "code");
  return Object.keys({ ...mapA, ...mapB }).map((code) => {
    const space = mergeSpace(mapA[code], mapB[code], ctx);
    return isDeleted(ctx.tomb.spaces, code, space.addedAt) ? null : space;
  }).filter(Boolean).sort((x, y) => { return x.code.localeCompare(y.code); });
}

// `now` only decides which old tombstones are dropped.
export function mergeDocs(a, b, now) {
  const tomb = pruneTombstones(mergeTombs(a.tomb, b.tomb), now === undefined ? Date.now() : now);
  const ctx = { tomb, devA: a.device || "", devB: b.device || "" };
  return {
    ...b,
    ...a,
    format: Math.max(a.format, b.format),
    device: a.device,
    setlists: mergeSetlists(a, b, ctx),
    forms: mergeForms(a, b, ctx),
    spaces: mergeSpaces(a, b, ctx),
    tomb,
  };
}
