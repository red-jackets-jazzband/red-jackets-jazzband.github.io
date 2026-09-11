// Print-only title page for the "Print songbook" export, styled after the
// physical N.O.A.D.S. songbook's own cover (static/images/songbook_cover.svg).
// The instrument silhouettes + big sax stay a vendored background image
// (songbook_cover_bg.svg — the same artwork with its text stripped out); the
// masthead/subtitle/name and the instrument badge are real text in the two
// vendored display fonts (Saniretro, Akura Popo — see split.css @font-face),
// so a non-N.O.A.D.S. setlist can read "Red Jackets" / its own name instead.

const SVGNS = "http://www.w3.org/2000/svg";

// The SVG's viewBox is 210x297 user units over a 210mm x 297mm page, i.e. one
// unit is one mm — so every coordinate below is copied straight from the
// original artwork's own <text>/<tspan> x/y/font-size attributes.
const PAGE_WIDTH_MM = 210;
const PAGE_HEIGHT_MM = 297;

// Fit-to-width targets (mm): rather than a fixed font-size (only right for
// the two strings the original artwork was hand-fitted to), every title-page
// string is scaled so its rendered width matches these — which reproduces
// the original "N.O.A.D.S." / "streetclassics" sizing exactly (that's what
// their own x/font-size values already work out to) while still scaling
// sensibly for "Red Jackets" or an arbitrary setlist name. Capped so a very
// short string doesn't blow up to an absurd size.
const TITLE_TARGET_WIDTH_MM = 188.6;
const TITLE_MAX_FONT_MM = 75;
const NAME_TARGET_WIDTH_MM = 187.2;
const NAME_MAX_FONT_MM = 55;

function svgEl(tag, attrs) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

// Scale a single-line <text>'s font-size so its rendered width matches
// `targetWidth` (mm), capped at `maxFont`. No-op if the node isn't laid out
// yet (jsdom, a detached node, or one not yet attached to the document —
// getBBox() reports a zero-width box until the element is actually part of
// the rendered tree) — it keeps its placeholder size.
export function fitTextWidth(textEl, targetWidth, maxFont) {
  let bbox;
  try {
    bbox = textEl.getBBox();
  } catch {
    return;
  }
  if (!bbox?.width) return;
  const current = Number.parseFloat(textEl.getAttribute("font-size"));
  const fitted = (targetWidth / bbox.width) * current;
  textEl.setAttribute("font-size", String(Math.min(fitted, maxFont)));
}

/*
  Fits the title/name text of an already-*attached* title page (see
  buildTitlePage below — its own construction happens before the caller
  appends it to the live #setlistPrintBooklet, so fitting can't happen there:
  getBBox() needs the element actually in the rendered document). Fits now,
  and again once Saniretro/AkuraPopo are confirmed loaded. Returns a promise
  that resolves once that final refit has happened (or immediately, in an
  environment with no FontFaceSet), so a caller — setlist-print.js's
  buildBooklet — can hold a print until the real fonts are in and measured,
  the same way it already holds for the per-song .abc reads.

  The first render can measure under a fallback face (narrower or wider than
  the real one), which throws off the fit computed from it — same issue as
  sheet.js's fitLiveChordGrid for the live chord grid's MuseJazzText, but
  that one's own fix (checking `document.fonts.status !== "loaded"` before
  awaiting `document.fonts.ready`) isn't safe to copy here: MuseJazzText is
  already in use elsewhere on the page by the time that check runs, so its
  loading state is already reflected in `document.fonts`. Saniretro/AkuraPopo
  are used nowhere else, so THIS getBBox() call can be the very first thing
  that ever asks for them — and a browser doesn't necessarily flip
  `document.fonts.status` to "loading" synchronously within the same task
  that triggered the fetch, so that check can read "loaded" (nothing pending
  *yet*) a tick before the real load actually starts, and the async refit
  then never gets scheduled at all. Requesting both faces explicitly via
  `document.fonts.load()` and awaiting that sidesteps the race entirely.
*/
export function fitTitlePage(page) {
  const title = page.querySelector(".setlist-titlepage-title");
  const name = page.querySelector(".setlist-titlepage-name");
  const refit = () => {
    fitTextWidth(title, TITLE_TARGET_WIDTH_MM, TITLE_MAX_FONT_MM);
    fitTextWidth(name, NAME_TARGET_WIDTH_MM, NAME_MAX_FONT_MM);
  };
  refit();
  if (document.fonts?.load) {
    return Promise.all([
      document.fonts.load("16px Saniretro"),
      document.fonts.load("16px AkuraPopo"),
    ]).then(refit, refit);
  }
  return Promise.resolve();
}

/*
  Builds the (print-only) title page. `isNoads` picks the original branding
  ("N.O.A.D.S." / "streetclassics") vs. the generic one ("Red Jackets" / the
  setlist's own name) for every other setlist; `instrumentText` fills the
  bottom-right badge, echoing the old standalone Songbook page's own
  black-box-white-MuseJazzText instrument label.

  Returns a detached node — the caller must append it to the live
  #setlistPrintBooklet, then call fitTitlePage(page) to size its title/name
  text. Fitting can't happen in here: it needs getBBox(), which only reports
  real geometry once the element is part of the rendered document.
*/
export function buildTitlePage({ isNoads, setlistName, instrumentText }) {
  const svg = svgEl("svg", {
    class: "setlist-titlepage-art",
    viewBox: `0 0 ${PAGE_WIDTH_MM} ${PAGE_HEIGHT_MM}`,
  });
  svg.append(svgEl("image", {
    href: "/images/songbook_cover_bg.svg",
    "xlink:href": "/images/songbook_cover_bg.svg",
    x: "0",
    y: "0",
    width: String(PAGE_WIDTH_MM),
    height: String(PAGE_HEIGHT_MM),
    preserveAspectRatio: "none",
  }));

  const title = svgEl("text", {
    class: "setlist-titlepage-title",
    x: "11.698378",
    y: "53.873695",
    "font-size": "64.419",
  });
  title.textContent = isNoads ? "N.O.A.D.S." : "Red Jackets";
  svg.append(title);

  const subtitle = svgEl("text", {
    class: "setlist-titlepage-sub",
    x: "30.383289",
    y: "79.431496",
    "font-size": "32.286",
  });
  subtitle.textContent = "songbook";
  svg.append(subtitle);

  const name = svgEl("text", {
    class: "setlist-titlepage-name",
    x: "13.751066",
    y: "277.76501",
    "font-size": "38.197",
  });
  name.textContent = isNoads ? "streetclassics" : setlistName;
  svg.append(name);

  const url = svgEl("text", {
    class: "setlist-titlepage-url",
    x: "78.279869",
    y: "288.03326",
    "font-size": "7.068",
  });
  url.textContent = "www.redjackets.nl";
  svg.append(url);

  const badge = document.createElement("div");
  badge.className = "setlist-titlepage-instrument";
  badge.textContent = instrumentText;

  const page = document.createElement("div");
  page.className = "setlist-titlepage";
  page.append(svg, badge);
  return page;
}
