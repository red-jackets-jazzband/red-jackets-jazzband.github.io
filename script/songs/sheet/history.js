import { byId, clear, el, on, setHidden } from "../../lib/core/dom.js";

/*
  The History button in the More-controls drawer (#historyBtn) and the panel
  it opens on the sheet paper (#songHistory), showing the tune's H: text
  (lib/music/history.js; sheet.js keeps it off the engraved sheet and
  publishes it as `tune.history`). The button only shows for a tune that has
  history. Open/closed is plain view state, not a store slice: it closes
  again whenever another song is opened.
*/
function fill(paragraphs) {
  const panel = byId("songHistory");
  if (!panel) return;
  clear(panel);
  panel.append(...paragraphs.map((text) => el("p", { textContent: text })));
}

export function createSongHistory(ctx) {
  let open = false;

  function draw() {
    const btn = byId("historyBtn");
    const panel = byId("songHistory");
    if (!btn || !panel) return;
    const hasHistory = ctx.state.history.length > 0;
    const shown = open && hasHistory;
    setHidden(btn, !hasHistory);
    setHidden(panel, !shown);
    btn.classList.toggle("active", shown);
    btn.setAttribute("aria-expanded", String(shown));
  }

  function setOpen(next) {
    open = Boolean(next);
    draw();
  }

  ctx.store.subscribe("tune", (tune, changed) => {
    if (changed.includes("songSerial")) open = false;
    if (changed.includes("history")) fill(tune.history);
    draw();
  });

  return {
    setOpen,
    init() {
      on("historyBtn", "click", () => setOpen(!open));
      fill(ctx.state.history);
      draw();
    },
  };
}
