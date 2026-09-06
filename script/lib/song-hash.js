// The songs page is shareable by URL hash: `/songs/#s=<title-slug>` opens that
// lead sheet on load, and picking a song from the Library list pushes the same
// hash. Pure parsing here; the render call lives in songs/app.js.

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
  const slug = parseQueryString(String(hash).replace(/^[#?]/, "")).s;
  return slug ? `${slug}.abc` : null;
}
