// The tune's H: (history) field.
//
// abcjs would print H: text at the foot of the engraved sheet; the site shows
// it behind a History button in the More-controls drawer instead, so the
// lines are taken out of the text handed to the renderer. abcjs joins
// repeated H: lines with "\n", one paragraph per line (it has no `+:`
// continuation support, and a blank line would end the header).

const HISTORY_PREFIX = "H:";

// `abcText` without its H: lines.
export function stripHistory(abcText) {
  return abcText
    .split("\n")
    .filter((line) => !line.startsWith(HISTORY_PREFIX))
    .join("\n");
}

// metaText.history -> its non-empty paragraphs ([] when the tune has none).
export function historyParagraphs(history) {
  if (typeof history !== "string") return [];
  return history.split("\n").map((p) => p.trim()).filter((p) => p.length > 0);
}
