/*
  Drag-to-dismiss for the Layers bottom sheet (below 1024px). The little bar
  at the sheet's top (.rj-layers-grip) and the header row under it are the
  handle: pulling down moves the sheet — and the pill riding its top edge —
  with the finger through --rj-layers-drag on <body>; letting go past a third
  of the way, or in a quick flick, closes it, otherwise it springs back. A tap
  closes it only on the bar itself (a tap on the header's empty space does
  nothing). The decision itself is lib/platform/sheet-drag.js.

  Pointer Events where the browser has them; Safari 12 has none, so it gets
  the same gesture from touch events (and, since it has no `touch-action`
  for this, cancels the scroll itself while a pull is under way).
*/
import { shouldDismissSheet, TAP_DISTANCE } from "../../lib/platform/sheet-drag.js";

const DOCKED = "(max-width: 1024px)";
const DRAG_VAR = "--rj-layers-drag";
const CONTROLS = "button, a, input, select";

function isDocked() {
  return Boolean(window.matchMedia) && window.matchMedia(DOCKED).matches; // NOSONAR
}

function setOffset(px) {
  document.body.style.setProperty(DRAG_VAR, `${px}px`);
}

function clearOffset() {
  document.body.style.removeProperty(DRAG_VAR);
  document.body.classList.remove("rj-layers-dragging");
}

function firstTouch(event) {
  return event.changedTouches[0];
}

// `handles` are the elements a drag may start on (`grip` among them is the
// one a tap closes from); `panel` is what moves.
export function initSheetDrag(panel, handles, grip, onDismiss) {
  let drag = null;

  function begin(id, y, t, handle, target) {
    if (!isDocked() || target.closest(CONTROLS)) return false;
    drag = { id, startY: y, startT: t, fromGrip: handle === grip };
    document.body.classList.add("rj-layers-dragging");
    return true;
  }

  function track(id, y) {
    if (!drag || id !== drag.id) return;
    setOffset(Math.max(0, y - drag.startY));
  }

  function finish(id, y, t, cancelled) {
    if (!drag || id !== drag.id) return;
    const { startY, startT, fromGrip } = drag;
    drag = null;
    const dy = y - startY;
    const tap = dy <= TAP_DISTANCE;
    const dismiss = !cancelled && (!tap || fromGrip) && shouldDismissSheet(dy, t - startT, panel.offsetHeight);
    clearOffset();
    if (dismiss) onDismiss();
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (begin(event.pointerId, event.clientY, event.timeStamp, event.currentTarget, event.target)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function onPointerEnd(event) {
    finish(event.pointerId, event.clientY, event.timeStamp, event.type === "pointercancel");
  }

  function onTouchStart(event) {
    const touch = firstTouch(event);
    begin(touch.identifier, touch.clientY, event.timeStamp, event.currentTarget, event.target);
  }

  function onTouchMove(event) {
    if (!drag) return;
    track(firstTouch(event).identifier, firstTouch(event).clientY);
    if (event.cancelable) event.preventDefault(); // no scrolling under the pull
  }

  function onTouchEnd(event) {
    const touch = firstTouch(event);
    finish(touch.identifier, touch.clientY, event.timeStamp, event.type === "touchcancel");
  }

  handles.forEach((handle) => {
    if (window.PointerEvent) {
      handle.addEventListener("pointerdown", onPointerDown);
      handle.addEventListener("pointermove", (event) => track(event.pointerId, event.clientY));
      handle.addEventListener("pointerup", onPointerEnd);
      handle.addEventListener("pointercancel", onPointerEnd);
    } else {
      handle.addEventListener("touchstart", onTouchStart, { passive: true });
      handle.addEventListener("touchmove", onTouchMove, { passive: false });
      handle.addEventListener("touchend", onTouchEnd);
      handle.addEventListener("touchcancel", onTouchEnd);
    }
  });
}
