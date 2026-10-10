import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../../../tests/helpers/dom.js";
import { drawProgressions } from "./progression-bands.js";

const BAND = "path.rj-layer-prog-band";
const URL_SD = "https://playing-traditional-jazz.blogspot.com/2013/06/salty-dog-chord-progression.html";

/*
  A printed line as ABCjs would draw it, as far as the bands care: a staff,
  and one group per note holding that note's chord symbol (and, on the
  progression's first note, its label annotation).
*/
function lineSvg(notes) {
  const groups = notes.map((note, i) => {
    const x = 40 + i * 80;
    const label = note.label ? `<text class="abcjs-annotation" data-box="${x - 30},60,60,10">${note.label}</text>` : "";
    return `<g data-note="${note.id}"><path class="abcjs-notehead" data-box="${x},70,8,6"/>`
      + `<text class="abcjs-chord" data-box="${x},40,24,14">${note.chord}</text>${label}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg"><path class="abcjs-staff" data-box="10,60,700,40"/>${groups.join("")}</svg>`;
}

function mountLines(lines) {
  const page = mountPage({ html: lines.map(lineSvg).join("") });
  page.window.Element.prototype.getBBox = function getBBox() {
    const data = this.getAttribute("data-box");
    if (data === null) return { x: 0, y: 0, width: 0, height: 0 };
    const [x, y, width, height] = data.split(",").map(Number);
    return { x, y, width, height };
  };
  const byId = (id) => page.document.querySelector(`g[data-note="${id}"]`);
  const visualObj = {
    lines: lines.map((notes) => ({
      staff: [{ voices: [notes.map((n) => ({ el_type: "note", abselem: { elemset: [byId(n.id)] } }))] }],
    })),
  };
  return { page, visualObj, svgs: [...page.document.querySelectorAll("svg")] };
}

const match = (extra) => ({
  id: "salty-dog", name: "Salty Dog", url: URL_SD, startNote: 0, endNote: 4, chordNotes: [0, 1, 2, 3], lineStarts: [0], ...extra,
});

test("a progression's chords sit on one bar in its shade, behind the notation", () => {
  const { page, visualObj, svgs } = mountLines([[
    { id: "a", chord: "G7", label: "Salty Dog progression" }, { id: "b", chord: "C7" }, { id: "c", chord: "F7" }, { id: "d", chord: "Bb" },
  ]]);
  try {
    drawProgressions(visualObj, [match()]);
    const [svg] = svgs;
    const bands = [...svg.querySelectorAll(BAND)];
    assert.equal(bands.length, 2, "the outline to fill and the edge to stroke");
    bands.forEach((band) => assert.ok(band.classList.contains("rj-layer-prog--0")));
    assert.equal(svg.firstElementChild, bands[0], "first in the svg: the notation draws over it");
    const chords = [...svg.querySelectorAll(".abcjs-chord")];
    chords.forEach((c) => {
      assert.ok(c.classList.contains("rj-layer-prog-text"));
      assert.ok(c.classList.contains("rj-layer-prog--0"));
    });
  } finally {
    page.cleanup();
  }
});

test("the name is written in two lines in the bar and links to the blog post", () => {
  const { page, visualObj, svgs } = mountLines([[
    { id: "a", chord: "G7", label: "Salty Dog progression" }, { id: "b", chord: "C7" }, { id: "c", chord: "F7" }, { id: "d", chord: "Bb" },
  ]]);
  try {
    drawProgressions(visualObj, [match()]);
    const link = svgs[0].querySelector("a.rj-layer-prog-link");
    assert.equal(link.getAttribute("href"), URL_SD);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.deepEqual([...link.querySelectorAll("text")].map((t) => t.textContent), ["Salty Dog", "progression"]);
  } finally {
    page.cleanup();
  }
});

test("a progression running onto the next line is one bar per line, named once", () => {
  const { page, visualObj, svgs } = mountLines([
    [{ id: "a", chord: "G7", label: "Salty Dog progression" }, { id: "b", chord: "C7" }],
    [{ id: "c", chord: "F7" }, { id: "d", chord: "Bb" }],
  ]);
  try {
    drawProgressions(visualObj, [match()]);
    svgs.forEach((svg) => assert.equal(svg.querySelectorAll(BAND).length, 2, "a bar on each line"));
    assert.equal(page.document.querySelectorAll("a.rj-layer-prog-link").length, 1, "the name is only on the first line");
    // The open sides run out to the staff's edge (10 .. 710).
    const [firstEdge] = svgs[0].querySelectorAll(BAND);
    assert.match(firstEdge.getAttribute("d"), /710/, "the first line's bar runs out to the right edge");
    const secondFill = svgs[1].querySelectorAll(BAND)[1];
    assert.match(secondFill.getAttribute("d"), /10/, "the second line's bar comes in from the left edge");
  } finally {
    page.cleanup();
  }
});

test("two progressions sharing a chord each get a bar and their own shade", () => {
  const { page, visualObj, svgs } = mountLines([[
    { id: "a", chord: "C", label: "Georgia progression" }, { id: "b", chord: "E7" }, { id: "c", chord: "A7" },
    { id: "d", chord: "D7" }, { id: "e", chord: "G7" }, { id: "f", chord: "C" },
  ]]);
  try {
    drawProgressions(visualObj, [
      { id: "georgia", name: "Georgia", url: "u1", startNote: 0, endNote: 3, chordNotes: [0, 1, 2], lineStarts: [0] },
      { id: "salty-dog", name: "Salty Dog", url: "u2", startNote: 2, endNote: 6, chordNotes: [2, 3, 4, 5], lineStarts: [0] },
    ]);
    const svg = svgs[0];
    const shades = new Set([...svg.querySelectorAll(BAND)].map((p) => [...p.classList].find((c) => c.startsWith("rj-layer-prog--"))));
    assert.deepEqual([...shades].sort(), ["rj-layer-prog--0", "rj-layer-prog--1"]);
    assert.equal(svg.querySelectorAll(BAND).length, 4);
    const shared = svg.querySelector('g[data-note="c"] .abcjs-chord');
    assert.ok(shared.classList.contains("rj-layer-prog--0") && shared.classList.contains("rj-layer-prog--1"), "the shared chord wears both");
  } finally {
    page.cleanup();
  }
});

test("a match whose notes aren't on the sheet draws nothing", () => {
  const { page, visualObj, svgs } = mountLines([[{ id: "a", chord: "G7" }]]);
  try {
    drawProgressions(visualObj, [match({ startNote: 5, endNote: 9, chordNotes: [5, 6] })]);
    assert.equal(svgs[0].querySelectorAll(BAND).length, 0);
  } finally {
    page.cleanup();
  }
});
