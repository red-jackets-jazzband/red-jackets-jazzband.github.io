import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { pairingUrl, qrPath } from "./qr.js";

test("pairingUrl replaces any hash with the sync code", () => {
  assert.equal(pairingUrl("https://x.test/songs/#s=a", "RJ7K-Q2MD"), "https://x.test/songs/#sync=RJ7K-Q2MD");
  assert.equal(pairingUrl("https://x.test/nl/songs/", "AB CD"), "https://x.test/nl/songs/#sync=AB%20CD");
  assert.equal(pairingUrl("https://x.test/songs/", "AB", "band"), "https://x.test/songs/#band=AB");
});

test("qrPath draws each dark module inside a quiet zone", () => {
  const dark = new Set(["0,0", "1,2"]);
  const { d, size } = qrPath((r, c) => { return dark.has(`${r},${c}`); }, 3);
  assert.equal(size, 11);
  assert.equal(d, "M4 4h1v1h-1zM6 5h1v1h-1z");
});

test("the vendored generator yields a matrix qrPath can draw", () => {
  const context = {};
  // Our own vendored file, run in an empty context: the point of this test.
  vm.runInNewContext( // eslint-disable-line sonarjs/code-eval -- NOSONAR
    readFileSync(new URL("../../qrcode-generator-2.0.4-min.js", import.meta.url), "utf8"), context);
  const qr = context.qrcode(0, "M");
  qr.addData("https://www.redjackets.nl/songs/#sync=RJ7K-Q2MD-AAAA-BBBB-CCCC-DDDD-EEEE-F");
  qr.make();
  const count = qr.getModuleCount();
  assert.ok(count >= 21 && count <= 57);
  const { d } = qrPath((r, c) => { return qr.isDark(r, c); }, count);
  assert.ok(d.length > 100);
});
