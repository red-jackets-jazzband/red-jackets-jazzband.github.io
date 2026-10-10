/*
  Small SVG helpers the layer overlays share: measuring (a node that can't
  be laid out — jsdom, a hidden container — measures as null, never throws)
  and building elements.
*/

export const SVG_NS = "http://www.w3.org/2000/svg";

export function bboxOf(node) {
  try {
    return node.getBBox();
  } catch {
    return null; // not laid out (jsdom, a hidden container)
  }
}

export function svgEl(name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  Object.keys(attrs).forEach((key) => node.setAttribute(key, String(attrs[key])));
  return node;
}

export function noteGroup(el) {
  return el.abselem && el.abselem.elemset ? el.abselem.elemset[0] : null; // NOSONAR
}

// The chord symbols drawn with `el`.
export function chordTexts(el) {
  const group = noteGroup(el);
  return group ? [...group.querySelectorAll(".abcjs-chord")] : [];
}

// The horizontal middle of the noteheads drawn alongside `text`, or null.
export function noteheadCentre(text) {
  const group = text.parentNode;
  if (!group || typeof group.querySelectorAll !== "function") return null;
  let left = Infinity;
  let right = -Infinity;
  group.querySelectorAll(".abcjs-notehead").forEach((head) => {
    const box = bboxOf(head);
    if (!box) return;
    left = Math.min(left, box.x);
    right = Math.max(right, box.x + box.width);
  });
  return left <= right ? (left + right) / 2 : null;
}

// Where the svg's visible area starts (-Infinity when it can't be read).
export function viewTop(svg) {
  const box = svg.viewBox && svg.viewBox.baseVal; // NOSONAR
  return box ? box.y : -Infinity;
}
