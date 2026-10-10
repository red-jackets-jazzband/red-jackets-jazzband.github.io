/*
  The geometry behind what the Layers panel draws onto the engraved sheet —
  pure arithmetic over numbers and plain objects, so it is tested without a
  DOM (songs/layers/overlays/ does the drawing with it):

    unionOf(boxes)               the box round several { x, y, width, height }
    barPath(bar, open)           the rounded highlighter bar as a closed
                                 outline plus the edge to stroke ({ fill, edge })
    keepBelow(bar, minY)         slide a bar's top down to minY, keeping its
                                 bottom edge's extra height
    progressionShades(matches)   one shade class per progression name, with a
                                 lighter tint when the same one repeats
    growViewBox(view, tops, pad) the viewBox that also takes in chord letters
                                 sticking out above it, or null
*/

const BAR_RADIUS = 4;

// split.css's rj-layer-prog--0 .. --4: amber, apricot, rose, butter, clay.
const BAND_SHADES = 5;

// The union of `boxes` as { x1, y1, x2, y2 }.
export function unionOf(boxes) {
  return {
    x1: Math.min(...boxes.map((box) => box.x)),
    y1: Math.min(...boxes.map((box) => box.y)),
    x2: Math.max(...boxes.map((box) => box.x + box.width)),
    y2: Math.max(...boxes.map((box) => box.y + box.height)),
  };
}

/*
  The outline of a bar from (x1, y1) to (x2, y2), rounded at its corners. A
  side that is `open` (the progression carries on past the line's end, or
  came in from before its start) has square corners and no edge there.
  Returns the closed outline to fill and the visible edge to stroke (several
  subpaths when a side is open), so an open side has colour but no border.
*/
export function barPath({ x1, y1, x2, y2 }, open) {
  const r = BAR_RADIUS;
  const rl = open.left ? 0 : r;
  const rr = open.right ? 0 : r;
  // [command, visible]; every command ends at its last pair of numbers.
  const segs = [[`L${x2 - rr} ${y2}`, true]];
  if (rr > 0) segs.push([`Q${x2} ${y2} ${x2} ${y2 - rr}`, true]);
  segs.push([`L${x2} ${y1 + rr}`, !open.right]);
  if (rr > 0) segs.push([`Q${x2} ${y1} ${x2 - rr} ${y1}`, true]);
  segs.push([`L${x1 + rl} ${y1}`, true]);
  if (rl > 0) segs.push([`Q${x1} ${y1} ${x1} ${y1 + rl}`, true]);
  segs.push([`L${x1} ${y2 - rl}`, !open.left]);
  if (rl > 0) segs.push([`Q${x1} ${y2} ${x1 + rl} ${y2}`, true]);
  return outlinePaths(`${x1 + rl} ${y2}`, segs);
}

// The same segments as a closed outline and as a stroke that skips the
// invisible ones (starting a new subpath after each gap).
function outlinePaths(start, segs) {
  const fill = `M${start} ${segs.map(([cmd]) => cmd).join(" ")} Z`;
  const edge = [];
  let from = start;
  let drawing = false;
  segs.forEach(([cmd, visible]) => {
    const to = cmd.slice(1).trim().split(/\s+/).slice(-2).join(" ");
    if (visible && !drawing) edge.push(`M${from}`);
    if (visible) edge.push(cmd);
    drawing = visible;
    from = to;
  });
  return { fill, edge: edge.join(" ") };
}

// The printed line's svg clips whatever sits above its viewBox, and a chord
// row can sit within a few pixels of it: slide the bar's top down to `minY`
// and let the bottom take the height that would otherwise be cut off.
export function keepBelow(bar, minY) {
  if (bar.y1 >= minY) return;
  bar.y2 += minY - bar.y1;
  bar.y1 = minY;
}

/*
  One shade per progression *name*, in order of first appearance — the same
  idea as the form strip's arrows (sheet.js's stepShades): every Salty Dog
  on the page wears the same tone, a Georgia next to it a different one.
  The same progression twice in a row (Honky Tonk Town's two eight-bar
  choruses of Four-Leaf, with no chord between) would read as one long
  band, so every second one of such a run gets the `rj-layer-prog-alt`
  tint — lighter, same hue — to show where one ends and the next begins.
*/
export function progressionShades(progressions) {
  const names = [];
  let previous = null;
  let alt = false;
  return progressions.map((match) => {
    if (!names.includes(match.name)) names.push(match.name);
    const touches = previous !== null && previous.name === match.name && previous.endNote >= match.startNote;
    alt = touches && !alt;
    previous = match;
    const shade = `rj-layer-prog--${names.indexOf(match.name) % BAND_SHADES}`;
    return alt ? `${shade} rj-layer-prog-alt` : shade;
  });
}

/*
  A printed line's svg clips whatever sits above its viewBox, and the chord
  row can stick out of the one ABCjs chose by a few pixels (the tops of the
  letters, "decapitated"). Given the viewBox as { x, y, width, height } and
  the top of every chord symbol, returns the viewBox grown upward to take
  them in with `headroom` to spare — same width, so nothing rescales, the
  line just gets taller — or null when nothing sticks out.
*/
export function growViewBox(view, chordTops, headroom) {
  if (!view || view.height === 0 || chordTops.length === 0) return null;
  const top = Math.min(...chordTops) - headroom;
  if (top >= view.y) return null;
  return { x: view.x, y: top, width: view.width, height: view.height + view.y - top };
}
