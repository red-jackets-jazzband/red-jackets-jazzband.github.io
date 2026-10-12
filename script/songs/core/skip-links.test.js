import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { initSkipLinks } from "./skip-links.js";

const HTML = `
  <a class="rj-skip-link" href="#content">Skip to content</a>
  <a class="rj-skip-link" href="#rjSheet">Skip to the sheet music</a>
  <a class="rj-skip-link" href="#nowhere">Broken</a>
  <div id="content" tabindex="-1"><div id="rjSheet" tabindex="-1"></div></div>`;

test("a skip link focuses its target and keeps the deep-link hash", () => {
  const page = mountPage({ html: HTML, url: "https://example.test/songs/#s=bill_bailey" });
  try {
    initSkipLinks();
    const [toContent, toSheet] = document.querySelectorAll(".rj-skip-link");
    toSheet.click();
    assert.equal(document.activeElement, document.getElementById("rjSheet"));
    toContent.click();
    assert.equal(document.activeElement, document.getElementById("content"));
    assert.equal(window.location.hash, "#s=bill_bailey");
  } finally {
    page.cleanup();
  }
});

test("a skip link whose target is missing is left to the browser", () => {
  const page = mountPage({ html: HTML });
  try {
    initSkipLinks();
    const broken = document.querySelectorAll(".rj-skip-link")[2];
    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    broken.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  } finally {
    page.cleanup();
  }
});
