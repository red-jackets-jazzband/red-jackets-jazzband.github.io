import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import {
  stylePartMarkers,
  applyCompingColors,
  COMPING_FN_FILL,
} from "./sheet-decorations.js";

function inDom(fn) {
  const page = mountPage({ html: "<div id='notation'></div>" });
  try {
    return fn(page.document.getElementById("notation"));
  } finally {
    page.cleanup();
  }
}

test("stylePartMarkers boxes each part marker exactly once", () => {
  inDom((container) => {
    container.innerHTML =
      "<svg><text class='abcjs-part'>A</text><text class='abcjs-part'>B</text></svg>";
    // jsdom has no layout, so getBBox is absent — patch a stub for the test.
    for (const t of container.querySelectorAll("text")) {
      t.getBBox = () => ({ x: 1, y: 2, width: 10, height: 8 });
    }
    stylePartMarkers(container);
    assert.equal(container.querySelectorAll("rect.abcjs-part-bg").length, 2);
    // idempotent — a resize re-run must not stack rectangles
    stylePartMarkers(container);
    assert.equal(container.querySelectorAll("rect.abcjs-part-bg").length, 2);
  });
});

test("stylePartMarkers tolerates a missing container and getBBox throwing", () => {
  assert.doesNotThrow(() => stylePartMarkers(null));
  inDom((container) => {
    container.innerHTML = "<svg><text class='abcjs-part'>A</text></svg>";
    container.querySelector("text").getBBox = () => {
      throw new Error("not laid out");
    };
    stylePartMarkers(container);
    assert.equal(container.querySelectorAll("rect").length, 0);
  });
});

test("applyCompingColors fills noteheads by chord-tone function", () => {
  inDom((container) => {
    container.innerHTML = `
      <g class="abcjs-note abcjs-v1">
        <path class="abcjs-chord-pos-1"></path>
        <path class="abcjs-chord-pos-2"></path>
        <path class="abcjs-chord-pos-3"></path>
      </g>
      <g class="abcjs-note abcjs-v1">
        <path class="abcjs-chord-pos-1"></path>
      </g>
      <text class="abcjs-voice-name abcjs-v1"><tspan>R</tspan><tspan>3</tspan><tspan>5</tspan></text>`;
    applyCompingColors(container, [["R", "3", "5"], ["5", "R", "3"]]);
    const first = container.querySelectorAll("g")[0].querySelectorAll("path");
    // jsdom normalises the hex/var() values, so compare relationally: the
    // three chord tones get three distinct fills, in R/3/5 order.
    const fills = [first[0].style.fill, first[1].style.fill, first[2].style.fill];
    assert.equal(new Set(fills).size, 3);
    assert.ok(fills.every(Boolean));
    const second = container.querySelectorAll("g")[1].querySelector("path");
    assert.equal(second.style.fill, fills[2]); // palette pos-1 here is "5"
    const tspans = container.querySelectorAll("tspan");
    assert.equal(tspans[0].style.fill, fills[0]);
    assert.equal(tspans[2].style.fill, fills[2]);
  });
});

test("applyCompingColors advances the palette only past chord groups", () => {
  inDom((container) => {
    container.innerHTML = `
      <g class="abcjs-note abcjs-v1"></g>
      <g class="abcjs-note abcjs-v1"><path class="abcjs-chord-pos-1"></path></g>`;
    applyCompingColors(container, [["R", "3", "5"]]);
    // The empty first group must not consume palette[0]; the real notehead does.
    assert.ok(container.querySelector("path").style.fill);
  });
});

test("COMPING_FN_FILL maps each chord-tone function to a distinct fill", () => {
  assert.deepEqual(Object.keys(COMPING_FN_FILL).sort(), ["3", "5", "R"]);
  assert.equal(new Set(Object.values(COMPING_FN_FILL)).size, 3);
});

test("applyCompingColors is a no-op without a palette", () => {
  inDom((container) => {
    assert.doesNotThrow(() => applyCompingColors(container, null));
    assert.doesNotThrow(() => applyCompingColors(container, []));
    assert.doesNotThrow(() => applyCompingColors(null, [["R"]]));
  });
});
