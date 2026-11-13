/*
   Sync code, vault id and encryption (docs/device-sync-plan.md, WBS 3).

   A sync code is 128 random bits written as 26 base32 characters plus one
   check character, shown in groups of four ("RJ7K-Q2MD-…"). The vault id and
   the AES-GCM key are derived from it with SHA-256 under different prefixes,
   so the server only ever sees the id. Only `crypto.subtle.digest`, AES-GCM
   and `getRandomValues` are used — all Safari 11+.
*/

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DATA_CHARS = 26;
const CODE_CHARS = DATA_CHARS + 1;
const GROUP = 4;
const IV_BYTES = 12;
const ID_PREFIX = "rj-sync-id";
const KEY_PREFIX = "rj-sync-key";

function subtle() {
  return crypto.subtle;
}

function utf8(text) {
  return new TextEncoder().encode(text);
}

function toBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  bytes.forEach((byte) => {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  });
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function checkChar(data) {
  let sum = 0;
  Array.from(data).forEach((char, i) => { sum += ALPHABET.indexOf(char) * (i + 1); });
  return ALPHABET[sum % 32];
}

function groups(text) {
  const parts = [];
  for (let i = 0; i < text.length; i += GROUP) parts.push(text.slice(i, i + GROUP));
  return parts.join("-");
}

// A fresh code, in its displayed form.
export function generateCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const data = toBase32(bytes).slice(0, DATA_CHARS);
  return groups(data + checkChar(data));
}

// Normalises what a person typed or scanned: case, dashes and spaces ignored,
// 0 read as O and 1 as I. Returns the 27 plain characters, or null when the
// length, an unknown character or the check character is wrong.
export function parseCode(input) {
  const plain = String(input || "").toUpperCase().replace(/[\s-]/g, "").replace(/0/g, "O").replace(/1/g, "I");
  if (plain.length !== CODE_CHARS) return null;
  if (!Array.from(plain).every((char) => { return ALPHABET.includes(char); })) return null;
  return checkChar(plain.slice(0, DATA_CHARS)) === plain[DATA_CHARS] ? plain : null;
}

export function formatCode(plain) {
  return groups(plain);
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), (b) => { return b.toString(16).padStart(2, "0"); }).join("");
}

function toBase64(bytes) {
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCodePoint(b); });
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  Array.from(binary).forEach((char, i) => { bytes[i] = char.codePointAt(0); });
  return bytes;
}

// { id, key }: the 64-hex vault id the server sees and the AES-GCM CryptoKey.
export async function deriveVault(plainCode) {
  const idDigest = await subtle().digest("SHA-256", utf8(ID_PREFIX + plainCode));
  const keyDigest = await subtle().digest("SHA-256", utf8(KEY_PREFIX + plainCode));
  const key = await subtle().importKey("raw", keyDigest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return { id: hex(idDigest), key };
}

// Text → the envelope { v, iv, ct } (base64), with a fresh IV every time.
export async function encrypt(key, plaintext) {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, utf8(plaintext));
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
}

// The envelope back to text; rejects on a wrong key, tampering or a bad envelope.
export async function decrypt(key, envelope) {
  if (!envelope || envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.ct !== "string") {
    throw new Error("Not a sync envelope");
  }
  const plain = await subtle().decrypt({ name: "AES-GCM", iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.ct));
  return new TextDecoder().decode(plain);
}
