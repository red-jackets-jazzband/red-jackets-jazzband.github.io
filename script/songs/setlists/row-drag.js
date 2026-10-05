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

export function draggableRows() {
  const listEl = byId("songList");
  return listEl
    ? Array.from(listEl.querySelectorAll(".setlist-song-row, .setlist-divider-row"))
    : [];
}

// Rewrite the number badges / "Set N" placeholders straight from current DOM
// order — used mid-drag, before any re-render. Mirrors walkSetlist: numbers
// restart each set when the list has any dividers, else run 1..n.
export function renumberOpen() {
  const listEl = byId("songList");
  if (!listEl) return;
  const rows = qsa(".setlist-song-row, .setlist-divider-row, .setlist-set-heading", listEl);
  const hasDividers = listEl.querySelector(".setlist-divider-row, .setlist-set-heading") != null;
  let n = 0;
  let songInSet = 0;
  let setNumber = 1;
  rows.forEach((row) => {
    if (row.classList.contains("setlist-song-row")) {
      n += 1;
      songInSet += 1;
      const numEl = row.querySelector(".setlist-song-number");
      if (numEl) numEl.textContent = String(hasDividers ? songInSet : n);
      return;
    }
    songInSet = 0;
    if (row.classList.contains("setlist-divider-row")) {
      setNumber += 1;
      const input = row.querySelector(".setlist-divider-input");
      if (input) input.placeholder = `Set ${setNumber}`;
    }
  });
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

    const others = draggableRows().filter((r) => r !== dragged);
    if (others.length === 0) return;

    let before = null;
    for (const other of others) {
      const box = other.getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) {
        before = other;
        break;
      }
    }
    const anchor = before || others[others.length - 1].nextSibling;
    if (anchor !== dragged && dragged.nextSibling !== anchor) {
      // Reordering relocates the row within its parent, which would otherwise
      // make it jump by a row's height (its untransformed layout position
      // moves, but the pointer-following translateY doesn't know that yet).
      // Re-anchor the translate to the row's new resting spot so it keeps
      // reading as "still under the pointer" instead of snapping.
      const visualTop = dragged.getBoundingClientRect().top;
      setRowDragTranslate(dragged, 0);
      dragged.parentNode.insertBefore(dragged, anchor);
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
    onReorder(drag.personalId, draggableRows().map((r) => Number(r.dataset.setlistIndex)));
  }

  return { begin };
}
