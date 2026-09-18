import { byId, el } from "../lib/dom.js";
import { firstLinkPerType, OTHER_LINK_TYPE } from "../lib/inspiration-links.js";

const BUTTON_ID_PREFIX = "inspirationExtLink-";

const LINK_META = {
  spotify: { icon: "fa-brands fa-spotify", label: "Listen on Spotify" },
  soundcloud: { icon: "fa-brands fa-soundcloud", label: "Listen on SoundCloud" },
  // SecondHandSongs tracks a song's own history of cover/original versions —
  // there's no brand glyph for it in Font Awesome's free set, so this reads
  // as "history" rather than a lookalike brand mark.
  secondhandsongs: { icon: "fa-solid fa-clock-rotate-left", label: "View on SecondHandSongs" },
  [OTHER_LINK_TYPE]: { icon: "fa-solid fa-link", label: "More inspiration" },
};

/*
  Icon-only external links in the Inspiration pill (#inspirationSlot, next to
  the YouTube "Inspiration" button, kept separate from the Print/Export
  MP3/iReal Pro pill in #sheetActions) for a tune's non-YouTube F: field
  references — Spotify, SoundCloud, SecondHandSongs, or anything else a URL
  classifies as. Each just opens the target site in a new tab; only a
  YouTube reference gets the docked LoopTube player in inspiration.js, since
  that's the one platform with an embeddable IFrame API this project drives
  directly. Rebuilt on every render from the current tune's `links` (already
  parsed by sheet.js's engrave() via lib/inspiration-links.js), same as
  irealpro-link.js's updateIrealProLink.
*/
export function updateInspirationExtLinks(links) {
  const slot = byId("inspirationSlot");
  if (!slot) return;
  slot.querySelectorAll(`[id^="${BUTTON_ID_PREFIX}"]`).forEach((node) => node.remove());

  const extLinks = firstLinkPerType(links).filter((link) => link.type !== "youtube");
  for (const link of extLinks) {
    const meta = LINK_META[link.type];
    slot.append(el("a", {
      id: `${BUTTON_ID_PREFIX}${link.type}`,
      class: "sheet-icon-btn",
      href: link.url,
      target: "_blank",
      rel: "noopener noreferrer",
      title: meta.label,
      html: `<span class="${meta.icon}" aria-hidden="true"></span>`,
      attrs: { "aria-label": meta.label },
    }));
  }
}
