/*
  Drag and drop in the song form editor (song-form.js): a round by its grip,
  a part chip within its round or onto another round. Pointer events where
  the browser has them; Safari 12 has none (13+), so there it's mouse and
  touch events instead, the same drag either way.

  The editor marks its cards `.songForm-card[data-round]` and its chips
  `.songForm-chip[data-part]`; a drop hands `onDrop(source, target)` plain
  numbers: source `{ kind: "round", round }` or `{ kind: "part", round, part }`,
  target `{ round, part }` (part null: the round itself).
*/

// A press only becomes a drag once the pointer has moved this far, so a tap
// on a chip stays a tap (it removes the part).
const DRAG_THRESHOLD_PX = 6;
const DROP_CLASSES = ["is-drop-before", "is-drop-after", "is-drop-into"];

// The event names for this browser: pointer events, or mouse and touch.
function eventNames() {
  if (typeof window.PointerEvent === "function") {
    return { start: ["pointerdown"], move: ["pointermove"], end: ["pointerup", "pointercancel"] };
  }
  return { start: ["mousedown", "touchstart"], move: ["mousemove", "touchmove"], end: ["mouseup", "touchend", "touchcancel"] };
}

// Where a pointer, mouse or touch event happened.
function pointOf(e) {
  let source = e;
  if (e.touches && e.touches.length > 0) source = e.touches[0];
  else if (e.changedTouches && e.changedTouches.length > 0) source = e.changedTouches[0];
  return { x: source.clientX, y: source.clientY };
}

// The card or chip under the pointer for a drag of `kind`.
function targetAt(x, y, kind) {
  const hit = document.elementFromPoint(x, y);
  const card = hit ? hit.closest(".songForm-card") : null;
  if (!card) return null;
  const round = Number(card.dataset.round);
  const chip = kind === "part" ? hit.closest(".songForm-chip[data-part]") : null;
  if (chip && chip.closest(".songForm-card") === card) return { round, part: Number(chip.dataset.part), node: chip };
  return { round, part: null, node: card };
}

// Which side of the target the gold line goes on, or a ring round a whole
// card a part is dropped into; null where a drop would change nothing.
function dropClass(source, target) {
  if (source.kind === "round") {
    if (target.round === source.round) return null;
    return target.round < source.round ? "is-drop-before" : "is-drop-after";
  }
  if (target.part === null) return target.round === source.round ? null : "is-drop-into";
  if (target.round !== source.round) return "is-drop-before";
  if (target.part === source.part) return null;
  return target.part < source.part ? "is-drop-before" : "is-drop-after";
}

export function createFormDrag({ onDrop }) {
  let drag = null;
  // Set when a drag ends, so the click the browser sends after it isn't
  // also taken as a tap on the chip.
  let swallowClick = false;
  const names = { move: [], end: [] };

  function mark(target) {
    if (drag.marked) drag.marked.classList.remove(...DROP_CLASSES);
    drag.marked = null;
    drag.target = null;
    const cls = target ? dropClass(drag.source, target) : null;
    if (!cls) return;
    target.node.classList.add(cls);
    drag.marked = target.node;
    drag.target = target;
  }

  function onMove(e) {
    if (!drag) return;
    // A touch on a chip or grip moves the chip, never the page.
    if (e.cancelable && e.type === "touchmove") e.preventDefault();
    const point = pointOf(e);
    drag.point = point;
    if (!drag.active) {
      if (Math.abs(point.x - drag.x) < DRAG_THRESHOLD_PX && Math.abs(point.y - drag.y) < DRAG_THRESHOLD_PX) return;
      drag.active = true;
      drag.node.classList.add("is-dragging");
      document.body.classList.add("songForm-dragging");
    }
    e.preventDefault();
    mark(targetAt(point.x, point.y, drag.source.kind));
  }

  function stopListening() {
    names.move.forEach((name) => window.removeEventListener(name, onMove));
    names.end.forEach((name) => window.removeEventListener(name, end));
  }

  function end() {
    stopListening();
    if (!drag) return;
    const done = drag;
    drag = null;
    if (!done.active) return;
    swallowClick = true;
    setTimeout(() => {
      swallowClick = false;
    }, 0);
    done.node.classList.remove("is-dragging");
    document.body.classList.remove("songForm-dragging");
    if (done.marked) done.marked.classList.remove(...DROP_CLASSES);
    if (done.target) onDrop(done.source, { round: done.target.round, part: done.target.part });
  }

  function begin(e, node, source, grab) {
    if (drag || (e.button !== undefined && e.button !== 0)) return;
    // A grip has nothing to click: keep the press from selecting text or
    // scrolling. A chip's tap must still click.
    if (grab) e.preventDefault();
    const point = pointOf(e);
    drag = { node, source, x: point.x, y: point.y, active: false, marked: null, target: null };
    const events = eventNames();
    names.move = events.move;
    names.end = events.end;
    events.move.forEach((name) => window.addEventListener(name, onMove, { passive: false }));
    events.end.forEach((name) => window.addEventListener(name, end));
  }

  return {
    /*
      Make `handle` start a drag of `source`; `node()` is what's dragged (the
      handle's card, or the chip itself). `grab`: the handle does nothing
      else, so a press on it is the drag's alone.
    */
    bind(handle, node, source, { grab = false } = {}) {
      eventNames().start.forEach((name) => {
        handle.addEventListener(name, (e) => begin(e, node(), source, grab), { passive: !grab });
      });
    },
    // True (once) when the click being handled ended a drag.
    clickWasDrag() {
      return swallowClick;
    },
  };
}
