import { byId, qsa } from "../../lib/core/dom.js";

/*
  Reordering an open personal setlist's rows by pointer drag (the drag
  handle; a pointer-events drag, so it works on touch too). The row moves
  among its siblings live and the numbers follow (renumberOpen); on drop the
  rows' data-setlist-index values, read back in DOM order, are handed to
  `onReorder(personalId, order)` to persist.
*/
function setRowDragTranslate(row, y) {
  row.style.transform = y === 0 ? "" : `translateY(${y}px)`;
}

// Only songs drag: a set's heading belongs to its container and stays put.
export function draggableRows() {
  const listEl = byId("songList");
  return listEl ? Array.from(listEl.querySelectorAll(".setlist-song-row")) : [];
}

// The full item order as the DOM now shows it, ready for
// setPersonalSetlistOrder: each set container's heading (when it has one,
// i.e. a divider item) followed by its songs, containers top to bottom.
export function currentOrder() {
  const listEl = byId("songList");
  const order = [];
  if (!listEl) return order;
  qsa(".setlist-set", listEl).forEach((set) => {
    const heading = set.querySelector(".setlist-divider-row[data-setlist-index]");
    if (heading) order.push(Number(heading.dataset.setlistIndex));
    qsa(".setlist-song-row", set).forEach((row) => order.push(Number(row.dataset.setlistIndex)));
  });
  return order;
}

// Rewrite the number badges / "Set N" placeholders straight from current DOM
// order — used mid-drag, before any re-render. Numbers restart in every set.
export function renumberOpen() {
  const listEl = byId("songList");
  if (!listEl) return;
  qsa(".setlist-set", listEl).forEach((set, i) => {
    qsa(".setlist-song-row", set).forEach((row, n) => {
      const numEl = row.querySelector(".setlist-song-number");
      if (numEl) numEl.textContent = String(n + 1);
    });
    const input = set.querySelector(".setlist-divider-row[data-setlist-index] .setlist-divider-input");
    if (input) input.placeholder = `Set ${i + 1}`;
  });
}

// Where a dragged row goes for pointer height `y`: the set box under (or
// nearest to) the pointer, and the sibling to insert before inside it.
function dropTarget(dragged, y) {
  const sets = qsa(".setlist-set", byId("songList"));
  if (sets.length === 0) return null;
  const set = sets.find((candidate) => y < candidate.getBoundingClientRect().bottom)
    || sets[sets.length - 1];
  const others = qsa(".setlist-song-row", set).filter((r) => r !== dragged);
  const before = others.find((r) => {
    const box = r.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
  return { set, anchor: before || set.querySelector(".setlist-set-add") };
}

export function createRowDrag({ onReorder }) {
  let rowDrag = null;

  function begin(e, handle, row, personalId) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    rowDrag = { personalId, row, moved: false, pointerStartY: e.clientY, translateY: 0 };
    row.classList.add("setlist-row-dragging");
    document.body.classList.add("setlist-dragging");
    setRowDragTranslate(row, 0);
    try {
      handle.setPointerCapture(e.pointerId);
    } catch {
      // pointer capture is a nice-to-have; the window listeners still fire.
    }
    window.addEventListener("pointermove", onRowDragMove);
    window.addEventListener("pointerup", endRowDrag, { once: true });
    window.addEventListener("pointercancel", endRowDrag, { once: true });
  }

  function onRowDragMove(e) {
    if (!rowDrag) return;
    const dragged = rowDrag.row;
    rowDrag.translateY = e.clientY - rowDrag.pointerStartY;
    setRowDragTranslate(dragged, rowDrag.translateY);

    const target = dropTarget(dragged, e.clientY);
    if (!target) return;
    const { set, anchor } = target;
    if (anchor !== dragged && (dragged.nextSibling !== anchor || dragged.parentNode !== set)) {
      // Reordering relocates the row within its parent, which would otherwise
      // make it jump by a row's height (its untransformed layout position
      // moves, but the pointer-following translateY doesn't know that yet).
      // Re-anchor the translate to the row's new resting spot so it keeps
      // reading as "still under the pointer" instead of snapping.
      const visualTop = dragged.getBoundingClientRect().top;
      setRowDragTranslate(dragged, 0);
      set.insertBefore(dragged, anchor);
      const restingTop = dragged.getBoundingClientRect().top;
      rowDrag.translateY = visualTop - restingTop;
      rowDrag.pointerStartY = e.clientY;
      setRowDragTranslate(dragged, rowDrag.translateY);
      rowDrag.moved = true;
      renumberOpen();
    }
  }

  function endRowDrag() {
    window.removeEventListener("pointermove", onRowDragMove);
    if (!rowDrag) return;
    const drag = rowDrag;
    rowDrag = null;
    drag.row.classList.remove("setlist-row-dragging");
    document.body.classList.remove("setlist-dragging");
    setRowDragTranslate(drag.row, 0);
    if (!drag.moved) return;
    onReorder(drag.personalId, currentOrder());
  }

  return { begin };
}
