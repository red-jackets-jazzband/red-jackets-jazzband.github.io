/*
  Dragging the Layers bottom sheet (below 1024px). The little bar at the
  sheet's top (.rj-layers-grip), the header row under it and the Layers tab
  riding the sheet's top edge are the handles: pulling down moves the sheet —
  and the tab with it — with the finger through --rj-layers-drag on <body>;
  letting go past a third of the way, or in a quick flick, closes it,
  otherwise it springs back. A tap closes it only on the bar itself (a tap on
  the header's empty space does nothing; a tap on the tab is its own click).

  The tab works the other way round too: while the sheet is closed, pulling
  the tab up draws the sheet up out of the bottom edge under the finger, and
  letting go past a third of its height (or on a flick) opens it, otherwise
  it slides back down. The click a drag on the tab ends in is swallowed, so a
  pull never doubles as a tap. The decisions are lib/platform/sheet-drag.js.

  Pointer Events where the browser has them; Safari 12 has none, so it gets
  the same gesture from touch events (and, since it has no `touch-action`
  for this, cancels the scroll itself while a pull is under way).
*/
import { shouldDismissSheet, shouldOpenSheet, TAP_DISTANCE } from "../../lib/platform/sheet-drag.js";

const DOCKED = "(max-width: 1024px)";
const DRAG_VAR = "--rj-layers-drag";
const DRAGGING = "rj-layers-dragging";
const CONTROLS = "button, a, input, select";
// split.css's slide transition on the sheet, plus a little slack.
const SLIDE_MS = 200;
// A click this long after a drag on the tab ended is a new one, not its tail.
const CLICK_TAIL_MS = 500;

function isDocked() {
  return Boolean(window.matchMedia) && window.matchMedia(DOCKED).matches; // NOSONAR
}

function setOffset(px) {
  document.body.style.setProperty(DRAG_VAR, `${px}px`);
}

function clearOffset() {
  document.body.style.removeProperty(DRAG_VAR);
  document.body.classList.remove(DRAGGING);
}

function firstTouch(event) {
  return event.changedTouches[0];
}

/*
  `handles` are the elements on the sheet a drag may start on (`grip` among
  them is the one a tap closes from); `panel` is what moves.
  `options.tab` is the Layers tab; `isOpen()` reads the store, `onDismiss()`
  and `onOpen()` write it, and `reveal(bool)` shows or hides the sheet without
  touching the store (for an opening pull, before it's decided). Returns
  `{ consumeClick }`: true once for the click that ends a drag on the tab.
*/
export function initSheetDrag(panel, handles, grip, onDismiss, options = {}) {
  const { tab = null, isOpen = () => true, onOpen = () => {}, reveal = () => {} } = options;
  let drag = null;
  let swallowClick = false;
  let swallowTimer = null;
  let slideTimer = null;

  function swallowNextClick() {
    swallowClick = true;
    clearTimeout(swallowTimer);
    swallowTimer = setTimeout(() => {
      swallowClick = false;
    }, CLICK_TAIL_MS);
  }

  function consumeClick() {
    const swallowed = swallowClick;
    swallowClick = false;
    return swallowed;
  }

  function begin(id, y, t, handle, target) {
    // A new touch: whatever click the last drag would have ended in is gone
    // (a touch drag usually ends in none at all).
    swallowClick = false;
    const fromTab = handle === tab;
    if (!isDocked() || (!fromTab && target.closest(CONTROLS))) return false;
    // A sheet still sliding back from the last pull settles at once, so this
    // gesture starts from a clean state.
    settleSlideBack();
    drag = { id, startY: y, startT: t, fromGrip: handle === grip, fromTab, opening: fromTab && !isOpen(), moved: false };
    document.body.classList.add(DRAGGING);
    return true;
  }

  // The closed sheet follows the finger up from below the bottom edge.
  function trackOpening(y) {
    const up = drag.startY - y;
    if (!drag.moved) {
      if (up <= TAP_DISTANCE) return;
      drag.moved = true;
      reveal(true);
    }
    setOffset(Math.max(0, panel.offsetHeight - up));
  }

  function track(id, y) {
    if (!drag || id !== drag.id) return;
    if (drag.opening) {
      trackOpening(y);
      return;
    }
    const dy = y - drag.startY;
    if (dy > TAP_DISTANCE) drag.moved = true;
    setOffset(Math.max(0, dy));
  }

  // The end of a slide back: drop the offset and hide the sheet again —
  // when its timer fires, or straight away when a new gesture cuts it short.
  function settleSlideBack() {
    if (slideTimer === null) return;
    clearTimeout(slideTimer);
    slideTimer = null;
    document.body.style.removeProperty(DRAG_VAR);
    if (!isOpen()) reveal(false);
  }

  // Not opened after all: slide back down, then hide.
  function slideBack() {
    settleSlideBack();
    document.body.classList.remove(DRAGGING);
    setOffset(panel.offsetHeight);
    slideTimer = setTimeout(settleSlideBack, SLIDE_MS);
  }

  function finishOpening({ startY, startT, moved }, y, t, cancelled) {
    if (!moved) {
      clearOffset();
      return;
    }
    swallowNextClick();
    if (!cancelled && shouldOpenSheet(startY - y, t - startT, panel.offsetHeight)) {
      clearOffset();
      onOpen();
    } else {
      slideBack();
    }
  }

  function finish(id, y, t, cancelled) {
    if (!drag || id !== drag.id) return;
    const ended = drag;
    drag = null;
    if (ended.opening) {
      finishOpening(ended, y, t, cancelled);
      return;
    }
    const dy = y - ended.startY;
    const tap = dy <= TAP_DISTANCE;
    // A tap on the tab is left to its click, which toggles the sheet.
    const tapCloses = ended.fromGrip && !ended.fromTab;
    if (ended.fromTab && ended.moved) swallowNextClick();
    const dismiss = !cancelled && (!tap || tapCloses) && shouldDismissSheet(dy, t - ended.startT, panel.offsetHeight);
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

  [...handles, tab].filter(Boolean).forEach((handle) => {
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

  return { consumeClick };
}
