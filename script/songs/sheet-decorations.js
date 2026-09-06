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

/*
  Colour the comping voice's chord noteheads by chord-tone function. `palette`
  (from buildCompingTune) has one ["R","3","5"] entry per chord onset in the
  comping voice, bottom-to-top. ABCjs only exposes a notehead's *vertical*
  position within its chord (.abcjs-chord-pos-N), and voice-leading means
  position != function, so we zip the rendered onsets against the palette
  instead of using CSS. Inline fills survive ABCjs's resize handler (it rescales
  the viewBox, it doesn't re-render) and are re-applied on every full re-render.
  The stacked "R / 3 / 5" voice label is tinted to match.
*/
export function applyCompingColors(container, palette) {
  if (!container || !palette || !palette.length) return;
  const groups = container.querySelectorAll("g.abcjs-note.abcjs-v1");
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
      const fn = order[parseInt(match[1], 10) - 1];
      if (fn && COMPING_FN_FILL[fn]) mark.style.fill = COMPING_FN_FILL[fn];
    });
  });

  const label = container.querySelector("text.abcjs-voice-name.abcjs-v1");
  if (label) {
    const tspans = label.querySelectorAll("tspan");
    ["R", "3", "5"].forEach((fn, i) => {
      if (tspans[i]) tspans[i].style.fill = COMPING_FN_FILL[fn];
    });
  }
}
