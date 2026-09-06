import { test } from "node:test";
import assert from "node:assert/strict";
import { irealProFromAbc } from "./irealpro.js";

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
