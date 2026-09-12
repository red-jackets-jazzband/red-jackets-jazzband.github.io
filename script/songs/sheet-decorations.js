// Post-render SVG touch-ups applied to a freshly engraved notation container.
// ABCjs rebuilds the SVG on every render, so these run again each time.

const SVGNS = "http://www.w3.org/2000/svg";

/*
  Draw a thin square outline around every part marker (an ABC `P:` field), so
  the black letter reads as a labelled section box. Skips markers already boxed
  (a resize re-run would otherwise stack rectangles).
*/
export function stylePartMarkers(container) {
  if (!container) return;
  const padX = 3;
  const padY = 1;
  container.querySelectorAll("text.abcjs-part").forEach((txt) => {
    const prev = txt.previousSibling;
    if (prev && prev.classList && prev.classList.contains("abcjs-part-bg")) return;
    let bbox;
    try {
      bbox = txt.getBBox();
    } catch {
      // getBBox throws for a not-yet-laid-out node — nothing to outline.
      return;
    }
    const rect = document.createElementNS(SVGNS, "rect");
    rect.setAttribute("class", "abcjs-part-bg");
    rect.setAttribute("x", bbox.x - padX);
    rect.setAttribute("y", bbox.y - padY);
    rect.setAttribute("width", bbox.width + 2 * padX);
    rect.setAttribute("height", bbox.height + 2 * padY);
    rect.setAttribute("fill", "none");
    rect.setAttribute("stroke", "#000");
    rect.setAttribute("stroke-width", "1");
    txt.parentNode.insertBefore(rect, txt);
  });
}

// Chord-tone function -> notehead fill for the comping voice.
export const COMPING_FN_FILL = {
  R: "#222222",
  3: "var(--rj-gold)",
  5: "var(--rj-hover)",
};

// "l{line}-m{measure}-n{note}" locating one chord onset. ABCjs numbers measures
// and notes *per staff line*, so the line class is part of the key. A note
// group carries `abcjs-l3 abcjs-m2 … abcjs-n0`; a tie carries its line as
// `abcjs-l3` and its start onset as `abcjs-start-m2-n0`.
function onsetKey(cls) {
  const l = /(?:^|\s)abcjs-l(\d+)(?:\s|$)/.exec(cls || "");
  const m = /(?:^|\s)abcjs-m(\d+)(?:\s|$)/.exec(cls || "");
  const n = /(?:^|\s)abcjs-n(\d+)(?:\s|$)/.exec(cls || "");
  return l && m && n ? `l${l[1]}-m${m[1]}-n${n[1]}` : null;
}

// The y of a tie/slur path's first point ("M x y C …") — bigger y sits lower.
function tieAnchorY(el) {
  const m = /^M\s*[-\d.]+\s+([-\d.]+)/.exec(el.getAttribute("d") || "");
  return m ? Number.parseFloat(m[1]) : null;
}

/*
  Colour the tie arcs to match their noteheads. A held comping chord draws one
  tie per chord tone, all sharing an `abcjs-start-m{M}-n{N}` class (the onset
  they leave) with no position class of their own — so we group the ties by
  that onset and, within a group, sort by the arc's y (top voice first) to line
  them up against the palette entry (bottom-to-top, so reversed). Normal ties
  are a filled crescent; a dotted tie is a stroked open path — colour whichever
  the arc uses.
*/
function colorCompingTies(container, orderByOnset, voiceClass) {
  const groups = new Map();
  container.querySelectorAll(`path.abcjs-tie.${voiceClass}`).forEach((tie) => {
    const cls = tie.getAttribute("class") || "";
    const start = /abcjs-start-m(\d+)-n(\d+)/.exec(cls);
    const line = /(?:^|\s)abcjs-l(\d+)(?:\s|$)/.exec(cls);
    if (!start || !line) return;
    const key = `l${line[1]}-m${start[1]}-n${start[2]}`;
    const order = orderByOnset.get(key);
    const y = tieAnchorY(tie);
    if (!order || y == null) return;
    if (!groups.has(key)) groups.set(key, { order, arcs: [] });
    groups.get(key).arcs.push({ tie, y });
  });
  groups.forEach(({ order, arcs }) => {
    const topDown = order.slice().reverse();
    arcs.sort((a, b) => a.y - b.y).forEach(({ tie }, i) => {
      const color = COMPING_FN_FILL[topDown[i]];
      if (!color) return;
      if (tie.getAttribute("fill") === "none") tie.style.stroke = color;
      else tie.style.fill = color;
    });
  });
}

/*
  Colour the comping voice's chord noteheads by chord-tone function. `palette`
  (from buildCompingTune) has one ["R","3","5"] entry per chord onset in the
  comping voice, bottom-to-top. ABCjs only exposes a notehead's *vertical*
  position within its chord (.abcjs-chord-pos-N), and voice-leading means
  position != function, so we zip the rendered onsets against the palette
  instead of using CSS. Inline fills survive ABCjs's resize handler (it rescales
  the viewBox, it doesn't re-render) and are re-applied on every full re-render.
  The tie arcs and the stacked "5 / 3 / R" voice label are tinted to match.

  `voiceIndex` is the comping voice's own 0-indexed ABCjs voice number
  (ABCjs's own ".abcjs-vN" class order, matching resolveMixerVoices' resolved
  voice list) — V:2 (index 1) for an ordinary one-voice tune, comping.js's
  default, but one past however many voices (N) a chart like honky_tonk_town_
  riffs.abc already declares of its own.
*/
export function applyCompingColors(container, palette, voiceIndex = 1) {
  if (!container || !palette || !palette.length) return;
  const voiceClass = `abcjs-v${voiceIndex}`;
  const groups = container.querySelectorAll(`g.abcjs-note.${voiceClass}`);
  const orderByOnset = new Map();
  let index = 0;
  groups.forEach((group) => {
    const marks = group.querySelectorAll('[class*="abcjs-chord-pos-"]');
    if (!marks.length) return;
    const order = palette[index];
    index += 1;
    if (!order) return;
    marks.forEach((mark) => {
      const match = /abcjs-chord-pos-(\d+)/.exec(mark.getAttribute("class"));
      if (!match) return;
      const fn = order[Number.parseInt(match[1], 10) - 1];
      if (fn && COMPING_FN_FILL[fn]) mark.style.fill = COMPING_FN_FILL[fn];
    });
    const key = onsetKey(group.getAttribute("class"));
    if (key) orderByOnset.set(key, order);
  });

  colorCompingTies(container, orderByOnset, voiceClass);

  const label = container.querySelector(`text.abcjs-voice-name.${voiceClass}`);
  if (label) {
    const tspans = label.querySelectorAll("tspan");
    ["5", "3", "R"].forEach((fn, i) => {
      if (tspans[i]) tspans[i].style.fill = COMPING_FN_FILL[fn];
    });
  }
}
