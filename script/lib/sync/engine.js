/*
   The sync engine (docs/device-sync-plan.md, WBS 6.2, 6.3, 6.5): connect,
   join, and the pull → merge → push cycle against the vault server. No DOM;
   `fetch`, storage and the clock are injected so tests drive it with stubs.

   Local storage stays the working copy: every step builds the local document,
   merges and writes back synchronously (lib/sync/doc.js), so an edit can't
   fall between the read and the write. Results are plain `{ status }` objects:
     ok · offline · notFound ("No sync found for this code") · gone ("stopped or
     replaced") · tooLarge · limited · newerFormat · badCode · error
*/
import { decrypt, deriveVault, encrypt, generateCode, parseCode } from "./crypto.js";
import { applyDoc, buildLocalDoc } from "./doc.js";
import { mergeDocs } from "./merge.js";
import { readMeta, writeMeta } from "./clock.js";
import { validateDoc } from "./validate.js";

// What differs between vaults: where the code lives, how the document is built
// from / applied to storage, merged and validated, and where the engine keeps
// its bookkeeping. The personal vault's is below; the band space has its own
// (lib/sync/band-vault.js).
export const PERSONAL_CODEC = {
  codeKey: "rj.sync.code",
  oldCodeKey: "rj.sync.oldcode",
  build: buildLocalDoc,
  apply: applyDoc,
  merge: mergeDocs,
  validate: validateDoc,
  same: (a, b) => { return sameContent(a, b); },
  // { version, pending, snapshot }
  readState(storage) {
    const meta = readMeta(storage);
    return { version: meta.syncVersion || 0, pending: Boolean(meta.syncPending), snapshot: meta.snapshot };
  },
  writeState(storage, patch) {
    const meta = readMeta(storage);
    if (patch.version !== undefined) meta.syncVersion = patch.version;
    if (patch.pending !== undefined) meta.syncPending = patch.pending;
    writeMeta(storage, meta);
  },
};

export const SYNC_URL = "https://rj-sync.redjackets.workers.dev";
export const CODE_KEY = "rj.sync.code";
// The code of a replaced vault whose server copy couldn't be deleted yet.
export const OLD_CODE_KEY = "rj.sync.oldcode";
export const MAX_BODY_BYTES = 64 * 1024;
const MAX_ATTEMPTS = 3;

function readCode(storage, key) {
  try {
    return parseCode(storage.getItem(key));
  } catch {
    return null;
  }
}

function writeCode(storage, key, code) {
  try {
    if (code) storage.setItem(key, code);
    else storage.removeItem(key);
  } catch (_e) {
    // storage unavailable — sync just won't survive a reload.
  }
}

// `pending` marks a merged copy the server may not have yet (a PUT is in
// flight or failed); a later cycle must not take "nothing changed" for "sent".
// JSON with sorted keys, so two documents compare by content, not key order.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join()}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort((a, b) => { return a.localeCompare(b); }).map((key) => {
      return `${JSON.stringify(key)}:${canonical(value[key])}`;
    }).join()}}`;
  }
  return JSON.stringify(value);
}

function contentOf(doc) {
  return canonical({ setlists: doc.setlists, forms: doc.forms, tomb: doc.tomb });
}

// Same setlists, forms and tombstones (the `device` that merged last is no content).
function sameContent(a, b) {
  if (!a || !b || !Array.isArray(a.setlists) || !Array.isArray(b.setlists)) return false;
  return contentOf(a) === contentOf(b);
}

const STATUS_BY_HTTP = { 404: "notFound", 410: "gone", 413: "tooLarge", 429: "limited" };

function failure(response) {
  return { status: STATUS_BY_HTTP[response.status] || "error", http: response.status };
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function decryptDoc(codec, vault, blob) {
  try {
    return codec.validate(JSON.parse(await decrypt(vault.key, blob)));
  } catch {
    return null;
  }
}

// The remote copy as a validated document ({ doc }), or a result object.
async function open(codec, vault, body) {
  if (!body || !body.blob) return { status: "error" };
  const checked = await decryptDoc(codec, vault, body.blob);
  if (!checked) return { status: "badCode" }; // wrong key or tampered
  if (checked.ok) return { doc: checked.doc };
  return { status: checked.newer ? "newerFormat" : "error" };
}

export function createVaultEngine({ storage, fetchFn, baseUrl = SYNC_URL, now = Date.now, codec }) {
  const { codeKey, oldCodeKey } = codec;
  const setVersion = (version) => { codec.writeState(storage, { version, pending: false }); };
  const markPending = () => { codec.writeState(storage, { pending: true }); };
  const readOldCode = () => { return readCode(storage, oldCodeKey); };
  const writeOldCode = (code) => { writeCode(storage, oldCodeKey, code); };
  const knownVersion = () => { return codec.readState(storage).version; };
  const request = async (vaultId, init) => {
    try {
      return await fetchFn(`${baseUrl}/v1/vault/${vaultId}`, init);
    } catch {
      return null; // offline or blocked
    }
  };

  const push = async (vault, doc, expected) => {
    const blob = await encrypt(vault.key, JSON.stringify(doc));
    const body = JSON.stringify({ expected, blob });
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return { status: "tooLarge" };
    const response = await request(vault.id, { method: "PUT", body });
    if (!response) return { status: "offline" };
    if (response.status === 409) return { conflict: await readJson(response) };
    if (!response.ok) return failure(response);
    const { version } = await readJson(response);
    return { version };
  };

  // GET with the known version: { doc, version } (doc null on 304) or a result.
  const pull = async (vault, known) => {
    const headers = known ? { "If-None-Match": `"${known}"` } : {};
    const response = await request(vault.id, { method: "GET", headers });
    if (!response) return { status: "offline" };
    if (response.status === 304) return { doc: null, version: known };
    if (!response.ok) return failure(response);
    const body = await readJson(response);
    const remote = await open(codec, vault, body);
    return remote.doc ? { doc: remote.doc, version: body.version } : remote;
  };

  // Merge `remote` into local storage and push; on a conflict, merge the
  // newer copy the server returned and try again (up to MAX_ATTEMPTS). A
  // result identical to what the server has is not pushed: every save is
  // broadcast, so a needless one would make devices answer each other forever.
  const merge = async (vault, remote, attempt, changedBefore = false) => {
    const before = codec.readState(storage);
    const local = codec.build(storage, now());
    const merged = remote.doc ? codec.merge(local, remote.doc, now()) : local;
    codec.apply(storage, merged);
    // `changed`: this cycle wrote something into storage (so the page redraws, upload or not).
    const changed = changedBefore || !codec.same(local, merged);
    const serverHas = remote.doc ? codec.same(merged, remote.doc) : !before.pending && codec.same(merged, before.snapshot);
    if (serverHas) {
      setVersion(remote.version);
      return { status: "ok", version: remote.version, changed };
    }
    markPending();
    const pushed = await push(vault, merged, remote.version);
    if (pushed.version) {
      setVersion(pushed.version);
      return { status: "ok", version: pushed.version, changed };
    }
    if (!pushed.conflict) return { ...pushed, changed };
    if (attempt >= MAX_ATTEMPTS) return { status: "error", reason: "conflict", changed };
    const newer = await open(codec, vault, pushed.conflict);
    if (!newer.doc) return { ...newer, changed };
    return merge(vault, { doc: newer.doc, version: pushed.conflict.version }, attempt + 1, changed);
  };

  const exchange = async (vault, known) => {
    const remote = await pull(vault, known);
    return remote.status ? remote : merge(vault, remote, 1);
  };

  // DELETE the replaced vault; true once it is gone (or never was).
  const dropOldVault = async () => {
    const code = readOldCode();
    if (!code) return true;
    const response = await request((await deriveVault(code)).id, { method: "DELETE" });
    const gone = Boolean(response) && (response.ok || response.status === 404 || response.status === 410);
    if (gone) writeOldCode(null);
    return gone;
  };

  const activeVault = async () => {
    const code = readCode(storage, codeKey);
    return code ? { code, ...(await deriveVault(code)) } : null;
  };

  return {
    code: () => { return readCode(storage, codeKey); },
    knownVersion,

    // The push channel's address (WBS 6.7), or null when not connected.
    async liveUrl() {
      const vault = await activeVault();
      return vault ? `${baseUrl.replace(/^http/, "ws")}/v1/vault/${vault.id}/live` : null;
    },

    // First device: make a code, create the vault from what's stored here.
    async connect() {
      const code = parseCode(generateCode());
      const vault = await deriveVault(code);
      const pushed = await push(vault, codec.build(storage, now()), 0);
      if (!pushed.version) return pushed.status ? pushed : { status: "error" };
      writeCode(storage, codeKey, code);
      setVersion(pushed.version);
      codec.apply(storage, codec.build(storage, now()));
      return { status: "ok", code };
    },

    // Further device: never creates a vault (an unknown code answers notFound).
    async join(input) {
      const code = parseCode(input);
      if (!code) return { status: "badCode" };
      const result = await exchange({ code, ...(await deriveVault(code)) }, 0);
      if (result.status === "ok") writeCode(storage, codeKey, code);
      return result.status === "ok" ? { ...result, code } : result;
    },

    // One cycle for a connected device.
    async sync() {
      const vault = await activeVault();
      if (!vault) return { status: "disconnected" };
      await dropOldVault();
      const result = await exchange(vault, knownVersion());
      if (result.status === "gone" || result.status === "notFound") writeCode(storage, codeKey, null);
      return result;
    },

    disconnect() {
      writeCode(storage, codeKey, null);
    },

    async deleteServerCopy() {
      const vault = await activeVault();
      if (!vault) return { status: "disconnected" };
      const response = await request(vault.id, { method: "DELETE" });
      if (!response) return { status: "offline" };
      if (!response.ok && response.status !== 404) return failure(response);
      writeCode(storage, codeKey, null);
      return { status: "ok" };
    },

    // Moves the data to a fresh vault and marks the old one deleted. The old
    // vault is merged first (another device may have saved since this one
    // last looked), and a failed delete is reported and retried later.
    async newCode() {
      const old = await activeVault();
      if (!old) return { status: "disconnected" };
      const synced = await exchange(old, knownVersion());
      if (synced.status !== "ok") return synced;
      const result = await this.connect();
      if (result.status !== "ok") return result;
      writeOldCode(old.code);
      const cleaned = await dropOldVault();
      return cleaned ? result : { ...result, status: "oldKept" };
    },
  };
}

export function createSyncEngine(options) {
  return createVaultEngine({ ...options, codec: PERSONAL_CODEC });
}
