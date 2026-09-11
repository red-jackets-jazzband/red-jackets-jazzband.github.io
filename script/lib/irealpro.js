import { BREAK_CHORD } from "./chords.js";

// Builds an irealbook:// URL from a parsed abcjs tune and its chord-per-measure
// array (the same array that feeds the on-page chord table).
export function irealProFromAbc(song, chords) {
  const key = song.lines[0].staff[0].key.root + song.lines[0].staff[0].key.acc;
  const num = song.lines[0].staff[0].meter.value[0].num;
  const denom = song.lines[0].staff[0].meter.value[0].den;

  const title = song.metaText.title;
  const composer = song.metaText.composer !== undefined ? song.metaText.composer : "Unknown";
  const style = "Second Line";

  const irealProHeader = title + "=" + composer + "=" + style + "=" + key + "=n=T" + num + denom;
  let irealProText = "";
  for (let i = 0; i < chords.length; i++) {
    if (chords[i].leftRepeat !== undefined) {
      irealProText += "{";
    } else if (chords[i].doubeThinBarLeft !== undefined) {
      irealProText += "[";
    } else if (i === 0) {
      irealProText += "|";
    }

    const cell = chords[i].text.toString().replace(/,/g, " ,");
    const spaceCount = ((cell || "").match(/ /g) || []).length;
    irealProText += cell;

    switch (spaceCount) {
      case 0:
        irealProText += "   ";
        break;
      case 1:
        irealProText += " ";
        break;
      default:
        break;
    }

    if (chords[i].rightRepeat !== undefined) {
      irealProText += "}";
    } else if (chords[i].doubeThinBarRight !== undefined) {
      irealProText += "ZY|";
    } else {
      irealProText += "|";
    }
  }

  // iReal Pro's own no-chord token is a single "n" (the format's fixed "n"
  // in the header above is unrelated) — our own BREAK_CHORD display text
  // ("N.C.") isn't a chord iReal Pro can parse, so it's translated here the
  // same way "%" is translated to iReal Pro's "x" (repeat previous bar).
  const breakChordPattern = new RegExp(BREAK_CHORD.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`), "g");
  irealProText = irealProText
    .replace(breakChordPattern, "n")
    .replace(/Ø/g, "h")
    .replace(/m/g, "-")
    .replace(/%/g, "x ")
    .replace(/♭/g, "b")
    .replace(/♯/g, "#")
    .replace(/\|$/, "Z");

  return "irealbook://" + encodeURIComponent(irealProHeader) + encodeURIComponent(irealProText);
}
