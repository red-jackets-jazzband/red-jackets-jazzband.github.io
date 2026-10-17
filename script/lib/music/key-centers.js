/*
  The "Key centres" layer's music: which key the tune is in, stretch by
  stretch, read off its first voice's key signatures (the header's K: and
  every K: change after it, such as a part in the parallel minor). Nothing
  is guessed from the chords: a chart that changes key says so with a K:.

    keyCenters(song) -> [{ name, root, minor, startNote, endNote, startChar }]
    keyCenterText(stretch) / parseKeyCenterText(text)
                       the stretch's label as the annotation the layer
                       writes ("F minor", behind an invisible marker), and
                       back (null for any other annotation)
    keyCenterShades(stretches)
                       one shade index per stretch: per key, in order of
                       first appearance

  One entry per stretch, in tune order, covering every note of the first
  voice: `startNote`/`endNote` are indices into its notes (rests included,
  as abcjs lists them; `startChar` the first one's source offset), `root`
  the tonic (0-11), `name` its spelling ("B♭", "F♯") and `minor` whether
  it is a minor key. A modal key (Dorian, Mixolydian...) counts as major:
  the layer names a tonic, not a mode.
*/
import { keyRoot } from "./chord-symbol.js";
import { walkMelody } from "./melody-walk.js";
import { tl } from "../core/i18n.js";

const MINOR_MODES = new Set(["m", "min", "minor", "aeo", "aeolian"]);
const ACCIDENT_GLYPH = { "#": "\u266F", b: "\u266D", sharp: "\u266F", flat: "\u266D" };

function signatureKey(key) {
  const root = keyRoot(key);
  if (root === null) return null;
  const name = key.root + (ACCIDENT_GLYPH[key.acc] || "");
  return { root, minor: MINOR_MODES.has(String(key.mode || "").toLowerCase()), name };
}

export function keyCenters(song) {
  const stretches = [];
  let index = 0;
  walkMelody(song, (el, state) => {
    if (el.el_type !== "note") return;
    const n = index;
    index += 1;
    const key = signatureKey(state.key);
    if (key === null) return;
    const last = stretches[stretches.length - 1];
    if (last && last.endNote === n - 1 && last.root === key.root && last.minor === key.minor) {
      last.endNote = n;
      return;
    }
    stretches.push({ ...key, startNote: n, endNote: n, startChar: el.startChar });
  });
  return stretches;
}

// U+2060 WORD JOINER: invisible if nothing restyles it, and tells the
// overlay this label from a chart's own annotation.
const MARK = "\u2060";

export function keyCenterLabel(stretch) {
  return stretch.minor
    ? tl("layer_key_centers_minor", "{key} minor", { key: stretch.name })
    : tl("layer_key_centers_major", "{key} major", { key: stretch.name });
}

export function keyCenterText(stretch) {
  return MARK + keyCenterLabel(stretch);
}

export function parseKeyCenterText(text) {
  return text.startsWith(MARK) ? text.slice(MARK.length) : null;
}

export const KEY_SHADES = 5;

export function keyCenterShades(stretches) {
  const keys = [];
  return stretches.map((stretch) => {
    const id = `${stretch.root}${stretch.minor ? "m" : ""}`;
    if (!keys.includes(id)) keys.push(id);
    return keys.indexOf(id) % KEY_SHADES;
  });
}
