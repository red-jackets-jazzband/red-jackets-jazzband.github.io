/*
   Pairing QR (docs/device-sync-plan.md, WBS 7.3): the pairing link and the
   drawing arithmetic for the vendored qrcode-generator's module matrix. The
   code sits after the `#`, so it never reaches a server.
*/

// The page's own address with `#<key>=<code>` as its whole hash (`sync` for
// the personal vault, `band` for the band space).
export function pairingUrl(pageUrl, code, key = "sync") {
  return `${String(pageUrl).split("#")[0]}#${key}=${encodeURIComponent(code)}`;
}

/*
  One SVG path for every dark module of a `count` × `count` matrix, shifted by
  the quiet zone (4 modules, the QR standard's minimum), plus the viewBox size.
*/
export function qrPath(isDark, count, margin = 4) {
  const parts = [];
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (isDark(row, col)) parts.push(`M${col + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return { d: parts.join(""), size: count + margin * 2 };
}
