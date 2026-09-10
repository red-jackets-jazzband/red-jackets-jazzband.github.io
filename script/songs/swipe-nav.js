import { byId } from "../lib/dom.js";
import { classifySwipe } from "../lib/swipe.js";

/*
  Mobile swipe navigation for the open sheet. A horizontal flick across the
  sheet steps to the next / previous song — the touch equivalent of the
  Up/Down arrow keys — through an open setlist's songs (Setlists tab) or
  through the sidebar's library list (Library tab). Swipe left for the next
  song, right for the previous.
*/
// A touch that begins on the toolbar (Key / Tempo steppers, transport,
// dropdowns) or the "back to list" button belongs to that control, never to
// us — even a thumb-roll across the narrow − / + buttons drifts far enough
// sideways to read as a flick. Checked at touchstart, where the target is
// reliable: by touchend it can be wherever the finger lifted, or gone with
// the re-render a stepper tap kicks off. iOS Safari can hand us the button's
// text node ("−" / "+") as the target, so climb to its element first.
function startedOnControl(target) {
  const el = target && target.nodeType === 3 ? target.parentElement : target;
  return Boolean(el && el.closest && el.closest("#sheetmenu, #sheetBackBtn"));
}

export function createSwipeNav(ctx) {
  function step(dir) {
    if (ctx.state.activeTab === "setlists") {
      if (ctx.state.setlistsView === "open") ctx.setlistView.stepSong(dir);
      return;
    }
    ctx.library.stepLibrarySong(dir);
  }

  function init() {
    const sheet = byId("rjSheet");
    if (!sheet) return;
    let start = null;

    sheet.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) { start = null; return; }
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: Date.now(), onControl: startedOnControl(e.target) };
    }, { passive: true });

    sheet.addEventListener("touchend", (e) => {
      const from = start;
      start = null;
      if (!from || e.changedTouches.length !== 1) return;
      if (from.onControl) return;
      const t = e.changedTouches[0];
      const dir = classifySwipe(from, { x: t.clientX, y: t.clientY, t: Date.now() });
      if (dir === "left") step(1);
      else if (dir === "right") step(-1);
    }, { passive: true });
  }

  return { init };
}
