import { notateRhythm } from "../../lib/music/rhythm-notation.js";

/*
  One practice rhythm cell drawn as a bar of rhythm notation on a single
  staff line (the practice panel's pattern choices and its preview): noteheads,
  stems, flags or beams, dots, rests and ties, spaced by time so a beat is
  always the same width. Everything is painted in currentColor; split.css
  picks the colour (gold, or dark on a selected choice).
*/

const SVG_NS = "http://www.w3.org/2000/svg";
const UNIT = 14;
const LEFT = 8;
const LINE_Y = 21;
const STEM_TOP = 7;
const STEM_DX = 3.2;
const WIDTH = LEFT + 7 * UNIT + 14;
const HEIGHT = 30;

function node(name, attrs) {
  const element = document.createElementNS(SVG_NS, name);
  for (const key of Object.keys(attrs)) element.setAttribute(key, String(attrs[key]));
  return element;
}

const stroked = (name, attrs, width) => node(name, { ...attrs, fill: "none", stroke: "currentColor", "stroke-width": width });

function notehead(cx, len) {
  if (len === 8) return stroked("ellipse", { cx, cy: LINE_Y, rx: 4, ry: 2.6 }, 1.6);
  const attrs = { cx, cy: LINE_Y, rx: 3.5, ry: 2.5, transform: `rotate(-20 ${cx} ${LINE_Y})` };
  return len >= 4 ? stroked("ellipse", attrs, 1.3) : node("ellipse", attrs);
}

function rest(x, len) {
  if (len === 8) return node("rect", { x: x - 3.5, y: LINE_Y, width: 7, height: 2.6 });
  if (len === 4) return node("rect", { x: x - 3.5, y: LINE_Y - 2.6, width: 7, height: 2.6 });
  if (len === 2) {
    return stroked("path", {
      d: `M${x - 1.4} 10.5 L${x + 2} 15 Q${x - 1.2} 17.2 ${x} 18.8 L${x + 2.2} 21.6 Q${x - 2.6} 20.4 ${x + 0.2} 25.5`,
      "stroke-linejoin": "round", "stroke-linecap": "round",
    }, 1.8);
  }
  const group = node("g", {});
  group.append(
    node("circle", { cx: x - 1.6, cy: 17.4, r: 1.5 }),
    stroked("path", { d: `M${x - 2.6} 18 Q${x} 19 ${x + 2.2} 16.2 L${x - 0.6} 25.5`, "stroke-linecap": "round" }, 1.1),
  );
  return group;
}

// A tie below the noteheads, from one note to the next (or off the right edge).
function tie(fromX, toX) {
  const a = fromX + 0.5;
  const b = toX - 0.5;
  const mid = (a + b) / 2;
  return node("path", { d: `M${a} ${LINE_Y + 3} Q${mid} ${LINE_Y + 9} ${b} ${LINE_Y + 3} Q${mid} ${LINE_Y + 7.2} ${a} ${LINE_Y + 3}Z` });
}

function drawNote(svg, event, cx, beamedFrom) {
  svg.append(notehead(cx, event.len));
  const stemX = cx + STEM_DX;
  if (event.len < 8) svg.append(stroked("line", { x1: stemX, y1: LINE_Y - 0.6, x2: stemX, y2: STEM_TOP }, 1.1));
  if (event.dotted) svg.append(node("circle", { cx: cx + 6.5, cy: LINE_Y - 2.6, r: 1.2 }));
  if (event.beam) {
    const endX = cx + UNIT + STEM_DX;
    svg.append(node("rect", { x: stemX - 0.55, y: STEM_TOP, width: endX - stemX + 1.1, height: 2.8 }));
  } else if (event.len === 1 && !beamedFrom) {
    svg.append(node("path", { d: `M${stemX} ${STEM_TOP} c0.6 3.2 5.2 4.2 4 9.4 c0.8 -4.2 -2.6 -5.4 -4 -6.2z` }));
  }
}

export function rhythmSvg(cell) {
  const svg = node("svg", { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, class: "practice-rhythm", "aria-hidden": "true", focusable: "false" });
  svg.append(node("line", { x1: 0, y1: LINE_Y, x2: WIDTH, y2: LINE_Y, stroke: "currentColor", "stroke-width": 0.8, opacity: 0.55 }));
  const events = notateRhythm(cell);
  events.forEach((event, i) => {
    const x = LEFT + event.pos * UNIT;
    if (event.rest) {
      svg.append(rest(x, event.len));
      return;
    }
    const previous = events[i - 1];
    drawNote(svg, event, x, Boolean(previous && previous.beam));
    if (event.tie) {
      const next = events[i + 1];
      svg.append(tie(x, next ? LEFT + next.pos * UNIT : WIDTH + 1.5));
    }
  });
  return svg;
}
