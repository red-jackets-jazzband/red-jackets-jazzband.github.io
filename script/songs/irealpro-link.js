import { byId, el } from "../lib/dom.js";
import { irealProFromAbc } from "../lib/irealpro.js";

/*
  Keep the sheet's iReal Pro button in sync with the current tune: an icon-only
  link in the action cluster that opens the chart in iReal Pro (iOS / Android /
  macOS / Windows). Only shown for tunes that actually have a chord scheme to
  hand over — removed again for tunes without one.
*/
export function updateIrealProLink(song, chords) {
  let link = byId("iRealPro");

  if (chords.length === 0) {
    if (link) link.remove();
    return;
  }

  const url = irealProFromAbc(song, chords);
  if (link) {
    link.href = url;
    return;
  }

  link = el("a", {
    id: "iRealPro",
    class: "sheet-icon-btn",
    href: url,
    title: "Open in iReal Pro",
    html: '<img src="/images/irealpro_mark_white.webp" alt="" aria-hidden="true" class="irealpro-logo">',
    attrs: { "aria-label": "Open in iReal Pro" },
  });
  const actions = byId("sheetActions");
  if (actions) actions.append(link);
}
