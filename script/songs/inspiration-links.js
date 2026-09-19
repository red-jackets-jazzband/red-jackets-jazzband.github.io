import { byId, el } from "../lib/dom.js";
import { firstLinkPerType, OTHER_LINK_TYPE } from "../lib/inspiration-links.js";

const BUTTON_ID_PREFIX = "inspirationExtLink-";

const LINK_META = {
  // SecondHandSongs tracks a song's own history of cover/original versions —
  // there's no brand glyph for it in Font Awesome's free set, so this reads
  // as "history" rather than a lookalike brand mark.
  secondhandsongs: { icon: "fa-solid fa-clock-rotate-left", label: "View on SecondHandSongs" },
  [OTHER_LINK_TYPE]: { icon: "fa-solid fa-link", label: "More inspiration" },
};

/*
  Icon-only external links in the Inspiration pill (#inspirationSlot, next to
  the "Inspiration" button, kept separate from the Print/Export MP3/iReal Pro
  pill in #sheetActions) for a tune's F: field references that aren't one of
  the three sources the docked panel itself can embed — SecondHandSongs, or
  anything else a URL classifies as. Each just opens the target site in a new
  tab. YouTube, Spotify and SoundCloud are excluded here: they get the docked
  panel in inspiration.js instead (a full LoopTube toolbar for YouTube's
  IFrame API, plain embedded players for Spotify and SoundCloud — see its own
  doc comment). Rebuilt on every render from the current tune's `links`
  (already parsed by sheet.js's engrave() via lib/inspiration-links.js),
  same as irealpro-link.js's updateIrealProLink.
*/
export function updateInspirationExtLinks(links) {
  const slot = byId("inspirationSlot");
  if (!slot) return;
  slot.querySelectorAll(`[id^="${BUTTON_ID_PREFIX}"]`).forEach((node) => node.remove());

  const extLinks = firstLinkPerType(links).filter(
    (link) => link.type !== "youtube" && link.type !== "spotify" && link.type !== "soundcloud",
  );
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
