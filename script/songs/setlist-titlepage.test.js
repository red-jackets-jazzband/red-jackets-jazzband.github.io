import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { buildTitlePage, fitTitlePage, fitTextWidth } from "./setlist-titlepage.js";

const TITLE_SELECTOR = ".setlist-titlepage-title";
const NAME_SELECTOR = ".setlist-titlepage-name";

function inDom(fn) {
  const page = mountPage();
  try {
    return fn();
  } finally {
    page.cleanup();
  }
}

test("buildTitlePage renders the N.O.A.D.S. branding for the original songbook", () => {
  inDom(() => {
    const page = buildTitlePage({ isNoads: true, setlistName: "Anything", instrumentText: "bb clarinet" });
    assert.equal(page.className, "setlist-titlepage");
    assert.equal(page.querySelector(TITLE_SELECTOR).textContent, "N.O.A.D.S.");
    assert.equal(page.querySelector(".setlist-titlepage-sub").textContent, "songbook");
    assert.equal(page.querySelector(NAME_SELECTOR).textContent, "streetclassics");
    assert.equal(page.querySelector(".setlist-titlepage-url").textContent, "www.redjackets.nl");
    assert.equal(page.querySelector(".setlist-titlepage-instrument").textContent, "bb clarinet");
    const image = page.querySelector("image");
    assert.equal(image.getAttribute("href"), "/images/songbook_cover_bg.svg");
    assert.equal(image.getAttribute("xlink:href"), "/images/songbook_cover_bg.svg");
  });
});

test("buildTitlePage swaps in generic branding for any other setlist", () => {
  inDom(() => {
    const page = buildTitlePage({ isNoads: false, setlistName: "Summer Wedding 2026", instrumentText: "trumpet" });
    assert.equal(page.querySelector(TITLE_SELECTOR).textContent, "Red Jackets");
    assert.equal(page.querySelector(".setlist-titlepage-sub").textContent, "songbook");
    assert.equal(page.querySelector(NAME_SELECTOR).textContent, "Summer Wedding 2026");
  });
});

test("fitTitlePage fits the title/name text of an attached page (patched getBBox)", () => {
  inDom(() => {
    const page = buildTitlePage({ isNoads: false, setlistName: "Setlist 2026", instrumentText: "trumpet" });
    document.body.append(page); // must be attached before fitting — see buildTitlePage's own doc comment
    const title = page.querySelector(TITLE_SELECTOR);
    const name = page.querySelector(NAME_SELECTOR);
    title.getBBox = () => ({ width: 250 });
    name.getBBox = () => ({ width: 150 });
    fitTitlePage(page);
    assert.notEqual(title.getAttribute("font-size"), "64.419");
    assert.notEqual(name.getAttribute("font-size"), "38.197");
  });
});

test("fitTitlePage returns a promise that resolves once a delayed refit lands", async () => {
  // Not run through inDom(): that helper's cleanup() runs synchronously in a
  // `finally`, which would tear the jsdom window down before an awaited
  // callback here got to finish.
  const mounted = mountPage();
  try {
    const titlePage = buildTitlePage({ isNoads: false, setlistName: "Setlist 2026", instrumentText: "trumpet" });
    document.body.append(titlePage);
    const title = titlePage.querySelector(TITLE_SELECTOR);
    const name = titlePage.querySelector(NAME_SELECTOR);
    // The first getBBox() call (before fonts load) reports a fallback-face
    // measurement; a second, different one (after) simulates the real face
    // landing with different metrics — fitTitlePage's caller (setlist-print.js)
    // needs the returned promise to only resolve once *that* refit has run.
    let loaded = false;
    title.getBBox = () => ({ width: loaded ? 300 : 250 });
    name.getBBox = () => ({ width: loaded ? 200 : 150 });
    // Both the Saniretro and AkuraPopo load() calls resolve off this one
    // controllable promise — the point here is just "fonts still loading",
    // not distinguishing the two faces.
    let resolveFonts;
    const fontsPromise = new Promise((resolve) => { resolveFonts = resolve; });
    document.fonts = { load: () => fontsPromise };
    try {
      const fitted = fitTitlePage(titlePage);
      assert.equal(typeof fitted.then, "function", "returns a thenable");
      const beforeFontsLoaded = title.getAttribute("font-size");

      loaded = true;
      resolveFonts();
      await fitted;

      assert.notEqual(title.getAttribute("font-size"), beforeFontsLoaded, "refit after fonts landed");
    } finally {
      delete document.fonts;
    }
  } finally {
    mounted.cleanup();
  }
});

test("fitTitlePage is a no-op (keeps the placeholder size) before the page is attached", () => {
  inDom(() => {
    // mountPage's default getBBox stub reports a zero-width box, the same
    // shape a real browser reports for a not-yet-attached SVG node.
    const page = buildTitlePage({ isNoads: true, setlistName: "x", instrumentText: "" });
    fitTitlePage(page);
    assert.equal(page.querySelector(TITLE_SELECTOR).getAttribute("font-size"), "64.419");
    assert.equal(page.querySelector(NAME_SELECTOR).getAttribute("font-size"), "38.197");
  });
});

test("fitTextWidth shrinks font-size proportionally to hit the target width", () => {
  const el = {
    attrs: { "font-size": "64.419" },
    getBBox: () => ({ width: 300 }),
    getAttribute(name) { return this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; },
  };
  fitTextWidth(el, 150, 1000);
  // 150/300 * 64.419 = 32.2095
  assert.equal(Number.parseFloat(el.getAttribute("font-size")), 32.2095);
});

test("fitTextWidth caps the result so a very short string can't blow up", () => {
  const el = {
    attrs: { "font-size": "64.419" },
    getBBox: () => ({ width: 10 }), // tiny rendered width -> huge naive fit
    getAttribute(name) { return this.attrs[name]; },
    setAttribute(name, value) { this.attrs[name] = value; },
  };
  fitTextWidth(el, 188.6, 75);
  assert.equal(Number.parseFloat(el.getAttribute("font-size")), 75);
});

test("fitTextWidth leaves the placeholder size alone when not laid out", () => {
  const throwing = {
    getBBox() { throw new Error("not laid out"); },
    getAttribute: () => "64.419",
    setAttribute() { throw new Error("must not be called"); },
  };
  assert.doesNotThrow(() => fitTextWidth(throwing, 188.6, 75));

  const zeroWidth = {
    getBBox: () => ({ width: 0 }),
    getAttribute: () => "64.419",
    setAttribute() { throw new Error("must not be called"); },
  };
  assert.doesNotThrow(() => fitTextWidth(zeroWidth, 188.6, 75));
});
