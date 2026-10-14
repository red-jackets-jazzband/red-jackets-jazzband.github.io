/*
  Call `go` once, as soon as `font` (a CSS font shorthand such as
  "16px MuseJazzText") has loaded — or failed to, or `timeoutMs` has passed,
  whichever comes first. `fonts` is the page's FontFaceSet (document.fonts);
  without one (an old browser, jsdom) `go` runs straight away.

  Used to hold the sheet's first engraving until its text face is in: ABCjs
  measures chord symbols and annotations as it lays the chart out, so
  engraving under the fallback face spaces the chart for the wrong font.
  The timeout keeps a slow or blocked font from holding up the sheet.
*/
export function whenFontReady(fonts, font, timeoutMs, go) {
  let called = false;
  const once = () => {
    if (called) return;
    called = true;
    go();
  };
  if (!fonts || typeof fonts.load !== "function") {
    once();
    return;
  }
  if (typeof fonts.check === "function" && fonts.check(font)) {
    once();
    return;
  }
  setTimeout(once, timeoutMs);
  fonts.load(font).then(once, once);
}
