import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../tests/helpers/dom.js";
import { createPanelSizer, PANEL_WIDTHS } from "./panel.js";
import { PREF_KEYS, readPref } from "../../lib/core/preferences.js";

const PANEL_HTML = '<div id="p"></div><button id="inspirationSizeBtn"><span></span></button>';

test("cyclePanelSize steps through the presets, wraps round and persists each width", () => {
  const page = mountPage({ html: PANEL_HTML });
  try {
    window.innerWidth = 1600;
    const panel = document.getElementById("p");
    const sizer = createPanelSizer();
    sizer.setPanelWidth(panel, PANEL_WIDTHS[0], false);
    assert.equal(panel.style.width, `${PANEL_WIDTHS[0]}px`);

    sizer.cyclePanelSize(panel);
    assert.equal(panel.style.width, `${PANEL_WIDTHS[1]}px`);
    assert.equal(readPref(PREF_KEYS.inspirationWidth), String(PANEL_WIDTHS[1]));

    for (let i = 2; i < PANEL_WIDTHS.length; i += 1) sizer.cyclePanelSize(panel);
    sizer.cyclePanelSize(panel);
    assert.equal(panel.style.width, `${PANEL_WIDTHS[0]}px`);
  } finally {
    page.cleanup();
  }
});

test("setPanelWidth clamps to the viewport and flips the size button's icon at the widest preset", () => {
  const page = mountPage({ html: PANEL_HTML });
  try {
    window.innerWidth = 500;
    const panel = document.getElementById("p");
    const sizer = createPanelSizer();
    sizer.setPanelWidth(panel, 5000, false);
    assert.equal(panel.style.width, "484px");
    sizer.setPanelWidth(panel, 10, false);
    assert.equal(panel.style.width, "240px");

    window.innerWidth = 1600;
    sizer.setPanelWidth(panel, PANEL_WIDTHS[PANEL_WIDTHS.length - 1], false);
    assert.match(document.querySelector("#inspirationSizeBtn span").className, /down-left-and-up-right/);
  } finally {
    page.cleanup();
  }
});

test("readStoredWidth falls back to the first preset when nothing valid is stored", () => {
  const page = mountPage({ html: PANEL_HTML });
  try {
    assert.equal(createPanelSizer().readStoredWidth(), PANEL_WIDTHS[0]);
  } finally {
    page.cleanup();
  }
});
