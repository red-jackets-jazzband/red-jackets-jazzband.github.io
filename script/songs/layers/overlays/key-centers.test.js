import { test } from "node:test";
import assert from "node:assert/strict";
import ABCJS from "abcjs";
import { mountPage } from "../../../../../tests/helpers/dom.js";
import { keyCenterText, keyCenters } from "../../../lib/music/key-centers.js";
import { drawKeyCenters } from "./key-centers.js";

/*
  The tune parsed, drawn the way the tints care about: one svg per printed
  line with its staff, and a group per note and bar line laid out left to
  right 40 units apart (data-box stands in for getBBox). Each stretch's
  first note carries its name annotation, as the layer writes it.
*/
function mount(abc) {
  const song = ABCJS.parseOnly(abc)[0];
  const starts = new Map(keyCenters(song).map((s) => [s.startNote, keyCenterText(s)]));
  const page = mountPage({ html: "" });
  page.window.Element.prototype.getBBox = function getBBox() {
    const data = this.getAttribute("data-box");
    if (data === null) return { x: 0, y: 0, width: 0, height: 0 };
    const [x, y, width, height] = data.split(",").map(Number);
    return { x, y, width, height };
  };
  const doc = page.document;
  const svgNS = "http://www.w3.org/2000/svg";
  let note = 0;
  song.lines.forEach((line) => {
    const svg = doc.createElementNS(svgNS, "svg");
    const staff = doc.createElementNS(svgNS, "path");
    staff.setAttribute("class", "abcjs-staff");
    staff.setAttribute("data-box", "0,60,1000,40");
    svg.append(staff);
    doc.body.append(svg);
    line.staff[0].voices[0].forEach((el, i) => {
      if (el.el_type !== "note" && el.el_type !== "bar") return;
      const group = doc.createElementNS(svgNS, "g");
      group.setAttribute("data-box", `${40 + i * 40},60,${el.el_type === "bar" ? 2 : 10},40`);
      if (el.el_type === "note") {
        if (starts.has(note)) {
          const text = doc.createElementNS(svgNS, "text");
          text.setAttribute("class", "abcjs-annotation");
          text.textContent = starts.get(note);
          group.append(text);
        }
        note += 1;
      }
      svg.append(group);
      el.abselem = { elemset: [group] };
    });
  });
  return { song, svgs: [...doc.querySelectorAll("svg")], page };
}

const bands = (svg) => [...svg.querySelectorAll("rect.rj-layer-key-band")];

test("one key edge to edge; a key change splits the tint at its bar line, one shade per key, behind the notation", () => {
  const { song, svgs, page } = mount('X:1\nM:4/4\nL:1/4\nK:Fm\n"Fm" F G A B | c4 |]\n');
  try {
    drawKeyCenters(song);
    const [band] = bands(svgs[0]);
    assert.equal(bands(svgs[0]).length, 1);
    assert.equal(band.getAttribute("x"), "0", "a whole line in one key runs edge to edge");
    assert.equal(band.getAttribute("width"), "1000");
    assert.equal(svgs[0].firstElementChild, band, "first in the svg: the notation draws over it");
    const label = svgs[0].querySelector(".rj-layer-key-label");
    assert.equal(label.textContent, "F minor");
    assert.ok(label.classList.contains("rj-layer-key--0"));
  } finally {
    page.cleanup();
  }
  const two = mount('X:1\nM:4/4\nL:1/4\nK:Fm\n"Fm" F G A B | [K:F] "F" F G A B |]\n');
  try {
    drawKeyCenters(two.song);
    const [second, first] = bands(two.svgs[0]);
    assert.ok(first.classList.contains("rj-layer-key--0"));
    assert.ok(second.classList.contains("rj-layer-key--1"));
    const split = Number(first.getAttribute("x")) + Number(first.getAttribute("width"));
    assert.equal(split, Number(second.getAttribute("x")), "the tints meet");
    // The bar line before the key change is element 4 (x 200, 2 wide).
    assert.equal(split, 201, "on the bar line");
    const labels = [...two.svgs[0].querySelectorAll(".rj-layer-key-label")].map((t) => t.textContent);
    assert.deepEqual(labels, ["F minor", "F major"]);
  } finally {
    two.page.cleanup();
  }
});

test("a stretch running over a line break is open to both staff edges", () => {
  const { song, svgs, page } = mount('X:1\nM:4/4\nL:1/4\nK:C\n"C" C D E F |\nG A B c |]\n');
  try {
    drawKeyCenters(song);
    assert.equal(svgs.length, 2);
    svgs.forEach((svg) => assert.equal(bands(svg)[0].getAttribute("width"), "1000"));
    assert.equal(svgs[1].querySelectorAll(".rj-layer-key-label").length, 0, "named once, where it starts");
  } finally {
    page.cleanup();
  }
});
