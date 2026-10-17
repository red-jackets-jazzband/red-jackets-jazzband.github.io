/*
  The "Roman numerals" layer's music: each chord symbol of the first voice
  as its Roman numeral in the key in force there (a mid-tune K: change is
  followed), through the same chordToRomanNumeral the Roman chord table
  uses — so G7 in C is V7, Dm7 is ii7, B♭ is ♭VII, and Em in Am is v.

    chordNumerals(song)   [{ el, name, numeral }], in tune order

  N.C., anything else that isn't a chord symbol, and every chord of a tune
  with no key are left out.
*/
import { chordName, keyRoot, parseChordSymbol } from "./chord-symbol.js";
import { walkMelody } from "./melody-walk.js";
import { chordToRomanNumeral } from "./music-theory.js";

const KEY_ACC = { sharp: "#", flat: "b" };

function keyName(key) {
  return key.root + (KEY_ACC[key.acc] || key.acc || "");
}

export function chordNumerals(song) {
  const out = [];
  walkMelody(song, (el, state) => {
    const name = chordName(el);
    if (name === null || parseChordSymbol(name) === null || keyRoot(state.key) === null) return;
    const numeral = chordToRomanNumeral(name, keyName(state.key), state.key.mode || "");
    if (numeral && numeral !== name) out.push({ el, name, numeral });
  });
  return out;
}
