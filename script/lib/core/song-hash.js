// The songs page is shareable by URL hash. `/songs/#s=<title-slug>` opens that
// lead sheet on load, and picking a song from the Library list pushes the same
// hash. An open setlist adds `sl=<setlist-id>`, and the Inspiration player's
// "copy link" button adds `a=`/`b=` loop markers plus `i=1`. Pure parsing /
// building here; the render + navigation calls live in songs/app.js.

export function parseQueryString(queryString) {
  const params = {};
  for (const pair of String(queryString).split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = eq === -1 ? pair : pair.slice(0, eq);
    params[key] = eq === -1 ? "" : pair.slice(eq + 1);
  }
  return params;
}

// The `.abc` filename referenced by a location hash like "#s=basin_street", or
// null when the hash carries no `s` parameter.
export function songFileFromHash(hash) {
  const slug = parseSongsParams(hash).song;
  return slug ? `${slug}.abc` : null;
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch (_e) {
    return value;
  }
}

// A finite, non-negative number, or null.
function seconds(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// One decimal place, trailing zero trimmed: 12 -> "12", 12.34 -> "12.3".
function formatSeconds(n) {
  return String(Math.round(n * 10) / 10);
}

/*
  Parse a songs-page hash (or query string — the leading "#"/"?" is optional)
  into a normalized descriptor:
    { song, setlist, a, b, inspiration }
  `song` / `setlist` are decoded slugs or null; `a` / `b` are seconds or null;
  `inspiration` is true when the Inspiration panel should open on load (an
  explicit `i=1`, or implied by an `a`/`b` marker).
*/
export function parseSongsParams(raw) {
  const p = parseQueryString(String(raw).replace(/^[#?]/, ""));
  const a = seconds(p.a);
  const b = seconds(p.b);
  return {
    song: p.s ? decode(p.s) : null,
    setlist: p.sl ? decode(p.sl) : null,
    a,
    b,
    inspiration: p.i === "1" || a !== null || b !== null,
  };
}

/*
  Build a songs-page hash (without the leading "#") from a descriptor. Order is
  stable: setlist, song, then the Inspiration bits. Omits anything empty.
*/
export function buildSongsHash({
  song = null, setlist = null, a = null, b = null, inspiration = false,
} = {}) {
  const parts = [];
  if (setlist) parts.push(`sl=${encodeURIComponent(setlist)}`);
  if (song) parts.push(`s=${encodeURIComponent(song)}`);
  const aa = seconds(a);
  const bb = seconds(b);
  if (inspiration && aa === null && bb === null) parts.push("i=1");
  if (aa !== null) parts.push(`a=${formatSeconds(aa)}`);
  if (bb !== null) parts.push(`b=${formatSeconds(bb)}`);
  return parts.join("&");
}
