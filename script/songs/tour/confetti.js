import { el } from "../../lib/core/dom.js";

/*
  A CSS-only confetti burst behind the last tour card: pieces are shot up and out
  of the card like from a cannon (a wide cone, mixed power), slow at the top,
  then glide loosely down past the bottom of the screen (no fade). Each piece
  is a plain <span> moved by two CSS *transitions* (see `.rj-confetti-piece` in
  split.css) — a fast rise, then a slow fall — each set inline from JS, so
  nothing relies on custom properties inside keyframes. Randomness is seeded, so the
  burst is the same every time.
  Safari-12 safe: no `inset`, no `gap`, no modern JS.
*/

const PIECES = 320;
const COLOURS = ["#e29d0f", "#CA486d", "#f3e9d2", "#4fb3bf", "#8fd16b"];
const FAN_DEG = 70; // half-width of the cone around straight up
const SEED = 20260;
const EXIT_MARGIN_PX = 60;
const RISE_EASING = "cubic-bezier(0.1, 0.8, 0.3, 1)";
const FALL_EASING = "cubic-bezier(0.35, 0, 0.8, 0.65)";

// Small seeded PRNG (mulberry32): the same burst every time, and — unlike a
// golden-ratio walk — no correlation between a piece's angle and its power,
// which is what made the first version fan out in a spiral.
function makeRandom(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

// One piece's whole flight, drawn up front: a cannon shot up and out of the
// card (angle inside a cone, a few hard shots among many gentle ones), then a
// loose, swaying fall past the bottom edge.
function planFlight(random, originY) {
  const angle = ((random() * 2 - 1) * FAN_DEG - 90) * (Math.PI / 180);
  const power = 80 + random() * random() * 560 + random() * 120;
  const apexX = Math.cos(angle) * power;
  const apexY = Math.sin(angle) * power;
  const fallTo = window.innerHeight - originY + EXIT_MARGIN_PX;
  return {
    apexX,
    apexY,
    endX: apexX + (random() - 0.5) * 320,
    endY: fallTo,
    riseMs: 450 + random() * 450,
    fallMs: 2600 + random() * 2600,
    turn: (random() - 0.5) * 1080,
    spin: (random() - 0.5) * 2200,
  };
}

function buildPiece(random, originX, originY) {
  const size = 6 + Math.floor(random() * 6);
  const piece = el("span", { class: "rj-confetti-piece" });
  piece.style.left = `${originX}px`;
  piece.style.top = `${originY}px`;
  piece.style.width = `${size}px`;
  piece.style.height = `${random() < 0.35 ? size : Math.round(size * 1.6)}px`;
  piece.style.backgroundColor = COLOURS[Math.floor(random() * COLOURS.length)];
  return piece;
}

function place(x, y, turn) {
  return `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) rotate(${Math.round(turn)}deg)`;
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function rise(piece, flight) {
  piece.style.transitionTimingFunction = RISE_EASING;
  piece.style.transitionDuration = `${flight.riseMs.toFixed(0)}ms`;
  piece.style.transform = place(flight.apexX, flight.apexY, flight.turn);
}

function fall(piece, flight) {
  piece.style.transitionTimingFunction = FALL_EASING;
  piece.style.transitionDuration = `${flight.fallMs.toFixed(0)}ms`;
  piece.style.transform = place(flight.endX, flight.endY, flight.turn + flight.spin);
}

// Fire confetti out of the `card` element, inside the tour `root` and
// underneath the card (replacing any burst still running); the layer removes
// itself when done. No-op for visitors
// who asked for reduced motion.
export function launchConfetti(root, card) {
  if (prefersReducedMotion()) return;
  const rect = card.getBoundingClientRect();
  const layer = el("div", { class: "rj-confetti" });
  layer.setAttribute("aria-hidden", "true");
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;
  const random = makeRandom(SEED);
  const shots = [];
  for (let i = 0; i < PIECES; i += 1) {
    const piece = buildPiece(random, originX, originY);
    shots.push({ piece, flight: planFlight(random, originY) });
    layer.append(piece);
  }
  // A revisit of the last step must start a fresh burst, not stack on a running one.
  root.querySelectorAll(".rj-confetti").forEach((old) => old.remove());
  card.before(layer);
  let longest = 0;
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
    shots.forEach(({ piece, flight }) => {
      rise(piece, flight);
      window.setTimeout(() => fall(piece, flight), flight.riseMs);
      longest = Math.max(longest, flight.riseMs + flight.fallMs);
    });
    window.setTimeout(() => layer.remove(), longest + 300);
  }));
}
