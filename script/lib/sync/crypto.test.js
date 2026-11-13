import { test } from "node:test";
import assert from "node:assert/strict";
import { generateCode, parseCode, formatCode, deriveVault, encrypt, decrypt } from "./crypto.js";

test("a generated code parses back, in any case, with or without dashes", () => {
  const code = generateCode();
  assert.match(code, /^([A-Z2-7]{4}-){6}[A-Z2-7]{3}$/);
  const plain = parseCode(code);
  assert.equal(plain.length, 27);
  assert.equal(formatCode(plain), code);
  assert.equal(parseCode(code.toLowerCase().replace(/-/g, " ")), plain);
});

test("codes are random", () => {
  assert.notEqual(generateCode(), generateCode());
});

test("a mistyped code fails the check character", () => {
  const plain = parseCode(generateCode());
  const swapped = (plain[0] === "A" ? "B" : "A") + plain.slice(1);
  assert.equal(parseCode(swapped), null);
  assert.equal(parseCode(plain.slice(1)), null);
  assert.equal(parseCode(""), null);
  assert.equal(parseCode(undefined), null);
  assert.equal(parseCode(`${plain.slice(0, 26)}!`), null);
});

test("vault id is 64 hex and differs from the key's source; same code, same id", async () => {
  const plain = parseCode(generateCode());
  const a = await deriveVault(plain);
  const b = await deriveVault(plain);
  assert.match(a.id, /^[0-9a-f]{64}$/);
  assert.equal(a.id, b.id);
  assert.notEqual((await deriveVault(parseCode(generateCode()))).id, a.id);
});

test("encrypt / decrypt round-trip, fresh IV each time, wrong key and tampering fail", async () => {
  const mine = await deriveVault(parseCode(generateCode()));
  const other = await deriveVault(parseCode(generateCode()));
  const one = await encrypt(mine.key, "héllo ♭ setlist");
  const two = await encrypt(mine.key, "héllo ♭ setlist");
  assert.notEqual(one.iv, two.iv);
  assert.equal(await decrypt(mine.key, one), "héllo ♭ setlist");
  await assert.rejects(decrypt(other.key, one));
  await assert.rejects(decrypt(mine.key, { ...one, ct: two.ct }));
  await assert.rejects(decrypt(mine.key, { v: 2 }));
  await assert.rejects(decrypt(mine.key, null));
});
