/*
  Chord symbols and keys as the Layers modules read them — nothing in here
  knows about a particular progression or layer:

    parseChordSymbol(name)   { root: 0-11, quality } or null
    splitChordSymbol(name)   { root, rest } (what follows the root, up to a
                             slash bass) or null
    chordName(el)            the chord symbol an abcjs element carries
    keyRoot(key)             the key's tonic as a pitch class, or null

  quality is "maj" | "min" | "dom" | "dim" | "hdim" | "aug" — a chord's
  function, not its spelling: B♭, B♭6 and B♭maj7 are all "maj"; B♭7, B♭9
  and B♭13 "dom"; an altered or bare 7 over a minor chord stays "min".
*/

import { noteChroma } from "./note-name.js";

const LETTERS = "ABCDEFG";
const ACCIDENTAL_CHARS = "#♯b♭";
// How abcjs spells a key's accidental ("sharp", "flat") or leaves it as typed.
const KEY_ACC = { sharp: "#", flat: "b" };

/*
  A chord symbol as { root: 0-11, quality: "maj" | "min" | "dom" | "dim" |
  "hdim" | "aug" }, or null when it isn't one (N.C., an annotation...). The
  bass note after a slash doesn't change the function (B♭/D is still I).
*/
export function parseChordSymbol(name) {
  const split = splitChordSymbol(name);
  return split === null ? null : { root: split.root, quality: chordQuality(split.rest) };
}

/*
  A chord symbol cut into its root (0-11) and what follows it up to a slash
  bass ("m7b5" in "Bm7b5/F"), or null when it isn't a chord. A "b" followed
  by a 5 is the chord's flat five, not a flat root.
*/
export function splitChordSymbol(name) {
  if (typeof name !== "string" || name.length === 0 || !LETTERS.includes(name[0])) return null;
  let i = 1;
  while (i < name.length && ACCIDENTAL_CHARS.includes(name[i]) && !name.startsWith("b5", i)) i += 1;
  const slash = name.indexOf("/", i);
  return { root: noteChroma(name.slice(0, i)), rest: slash === -1 ? name.slice(i) : name.slice(i, slash) };
}

function hasSeventhOrMore(rest) {
  return ["7", "9", "11", "13"].some((n) => rest.includes(n));
}

function minorQuality(rest) {
  return rest.includes("7b5") || rest.includes("7♭5") || /ø/i.test(rest) ? "hdim" : "min";
}

const startsWithAny = (rest, prefixes) => prefixes.some((p) => rest.startsWith(p));

// Checked in order: "maj7" must win over "m", "m7b5" over plain minor.
const QUALITY_RULES = [
  [(rest) => startsWithAny(rest, ["maj", "Maj", "M", "Δ"]), () => "maj"],
  [(rest) => /^ø/i.test(rest), () => "hdim"],
  [(rest) => startsWithAny(rest, ["dim", "°", "o"]), () => "dim"],
  [(rest) => startsWithAny(rest, ["m", "-"]), minorQuality],
  [(rest) => startsWithAny(rest, ["+", "aug"]), (rest) => (hasSeventhOrMore(rest) ? "dom" : "aug")],
];

function chordQuality(rest) {
  const rule = QUALITY_RULES.find(([applies]) => applies(rest));
  if (rule) return rule[1](rest);
  return hasSeventhOrMore(rest) && !rest.startsWith("6") ? "dom" : "maj";
}

// The chord symbol an abcjs element carries, if any (annotations have a
// position of their own; a chord symbol's is "default").
export function chordName(el) {
  if (!el.chord) return null;
  const symbol = el.chord.find((c) => c.position === "default" || c.position === undefined);
  return symbol ? symbol.name : null;
}

// The key's tonic as a pitch class 0-11 (minor and modal keys included),
// or null for a tune with no key.
export function keyRoot(key) {
  if (!key || typeof key.root !== "string" || !LETTERS.includes(key.root)) return null;
  return noteChroma(key.root + (KEY_ACC[key.acc] || key.acc || ""));
}
