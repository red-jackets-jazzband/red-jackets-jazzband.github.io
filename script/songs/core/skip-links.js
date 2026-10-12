import { qsa } from "../../lib/core/dom.js";

/*
  The header's skip links ("Skip to content", "Skip to the sheet music";
  markup in layouts/partials/intro.html). A plain in-page link would replace
  the URL hash, and on /songs/ the hash is the deep link (#s=…, #sl=…), so
  here a skip link moves focus to its target itself and leaves the URL alone.
  Each target carries tabindex="-1", so focus() lands on it.
*/
export function initSkipLinks() {
  qsa(".rj-skip-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href") || "";
      const target = href.startsWith("#") ? document.getElementById(href.slice(1)) : null;
      if (!target) return;
      e.preventDefault();
      target.focus();
    });
  });
}
