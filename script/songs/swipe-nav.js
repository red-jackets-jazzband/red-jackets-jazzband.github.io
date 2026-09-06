import { byId } from "../lib/dom.js";
import { classifySwipe } from "../lib/swipe.js";

/*
  Mobile swipe navigation for the open sheet. A horizontal flick across the
  sheet steps to the next / previous song — the touch equivalent of the
  Up/Down arrow keys — through an open setlist's songs (Setlists tab) or
  through the sidebar's library list (Library tab). Swipe left for the next
  song, right for the previous.
*/
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
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
    }, { passive: true });

    sheet.addEventListener("touchend", (e) => {
      const from = start;
      start = null;
      if (!from || e.changedTouches.length !== 1) return;
      // A flick that begins on the control bar belongs to the steppers /
      // transport / dropdowns there, not to us.
      if (e.target.closest && e.target.closest("#sheetmenu")) return;
      const t = e.changedTouches[0];
      const dir = classifySwipe(from, { x: t.clientX, y: t.clientY, t: Date.now() });
      if (dir === "left") step(1);
      else if (dir === "right") step(-1);
    }, { passive: true });
  }

  return { init };
}
