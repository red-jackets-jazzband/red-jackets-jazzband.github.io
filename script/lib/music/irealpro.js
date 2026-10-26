import { BREAK_CHORD } from "./chords.js";

// The tune's time signature as iReal Pro's header writes it ("44", "22").
// abcjs gives M:C and M:C| as a named type with no numbers (no `value`), so
// those are spelled out here; a missing meter reads as 4/4.
function irealTimeSignature(meter) {
  if (meter && meter.type === "cut_time") return "22";
  const v = meter && meter.value && meter.value[0];
  return v ? String(v.num) + String(v.den) : "44";
}

// Builds an irealbook:// URL from a parsed abcjs tune and its chord-per-measure
// array (the same array that feeds the on-page chord table).
export function irealProFromAbc(song, chords) {
  const staff = song.lines[0].staff[0];
  const key = staff.key.root + staff.key.acc;
  const timeSignature = irealTimeSignature(staff.meter);

  const title = song.metaText.title;
  const composer = song.metaText.composer !== undefined ? song.metaText.composer : "Unknown";
  const style = "Second Line";

  const irealProHeader = title + "=" + composer + "=" + style + "=" + key + "=n=T" + timeSignature;
  let irealProText = "";
  for (const [i, chord] of chords.entries()) {
    // A measure carrying `part` (an ABC P: field's title, e.g. "Chorus") is
    // the first measure of that section — iReal Pro's own rehearsal-mark
    // token is "*" plus exactly one word character, drawn as a boxed letter
    // right before the barline of the measure it labels, so a multi-letter
    // title is reduced to its first letter the same way the on-screen chord
    // table already badges it (chord-table.js's partBadgeText).
    if (chord.part !== undefined) {
      irealProText += "*" + chord.part.trim().charAt(0).toUpperCase();
    }

    if (chord.leftRepeat !== undefined) {
      irealProText += "{";
    } else if (chord.doubeThinBarLeft !== undefined) {
      irealProText += "[";
    } else if (i === 0) {
      irealProText += "|";
    }

    const cell = chord.text.toString().replace(/,/g, " ,");
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

    if (chord.rightRepeat !== undefined) {
      irealProText += "}";
    } else if (chord.doubeThinBarRight !== undefined) {
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
