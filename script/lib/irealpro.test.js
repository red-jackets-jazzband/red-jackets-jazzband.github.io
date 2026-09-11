import { test } from "node:test";
import assert from "node:assert/strict";
import { irealProFromAbc } from "./irealpro.js";
import { BREAK_CHORD } from "./chords.js";

function baseSong(overrides = {}) {
  return {
    lines: [
      {
        staff: [
          {
            key: { root: "B", acc: "b" },
            meter: { value: [{ num: "4", den: "4" }] },
          },
        ],
      },
    ],
    metaText: { title: "Basin Street Blues" },
    ...overrides,
  };
}

test("irealProFromAbc builds an irealbook:// URL with header info", () => {
  const song = baseSong();
  const chords = [{ text: ["Bb"] }, { text: ["F7"] }];
  const url = irealProFromAbc(song, chords);
  assert.match(url, /^irealbook:\/\//);
  const decoded = decodeURIComponent(url.replace("irealbook://", ""));
  assert.match(decoded, /^Basin Street Blues=Unknown=Second Line=Bb=n=T44/);
});

test("irealProFromAbc uses the composer when present, else defaults to Unknown", () => {
  const withComposer = baseSong({ metaText: { title: "T", composer: "Jelly Roll Morton" } });
  const url = irealProFromAbc(withComposer, [{ text: ["C"] }]);
  assert.match(decodeURIComponent(url), /Jelly Roll Morton/);

  const withoutComposer = baseSong({ metaText: { title: "T" } });
  const url2 = irealProFromAbc(withoutComposer, [{ text: ["C"] }]);
  assert.match(decodeURIComponent(url2), /=Unknown=/);
});

test("irealProFromAbc converts special chord characters for the iRealPro chord text", () => {
  const song = baseSong();
  const chords = [{ text: ["Cm7"] }, { text: ["DØ"] }];
  const url = irealProFromAbc(song, chords);
  const decoded = decodeURIComponent(url);
  // m -> -, Ø -> h
  assert.match(decoded, /C-7/);
  assert.match(decoded, /Dh/);
});

test("irealProFromAbc translates a break (\"N.C.\") measure to iRealPro's own \"n\" no-chord token", () => {
  const song = baseSong();
  const chords = [{ text: ["F7"] }, { text: [BREAK_CHORD] }, { text: ["Bb"] }];
  const decoded = decodeURIComponent(irealProFromAbc(song, chords));
  const body = decoded.split("=T44")[1];
  assert.doesNotMatch(body, /N\.C\./);
  assert.match(body, /\|F7 {3}\|n {3}\|Bb {3}Z/);
});

test("irealProFromAbc translates a break sharing a measure with a real chord", () => {
  const song = baseSong();
  const chords = [{ text: ["F7", BREAK_CHORD] }];
  const decoded = decodeURIComponent(irealProFromAbc(song, chords));
  const body = decoded.split("=T44")[1];
  assert.doesNotMatch(body, /N\.C\./);
  assert.match(body, /F7 ,n/);
});
