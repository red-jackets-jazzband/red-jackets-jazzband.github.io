import { byId, el, qsa } from "../../lib/core/dom.js";
import { extractWordsTables, parseFormStep } from "../../lib/music/words-table.js";
import { historyParagraphs, stripHistory } from "../../lib/music/history.js";
import { findInstrument } from "../../lib/music/instruments.js";
import {
  buildRenderPlan, effectiveSheetSettings, mixRenderText,
} from "../../lib/music/render-plan.js";
import {
  buildSoloTune, cancelSolo, composeSolo, hasSoloTake, SOLO_PROGRAMS,
} from "../../lib/music/solo.js";
import { parseVoiceList, resolveMixerVoices, isCompingLabel } from "../../lib/audio/audio-mix.js";
import { parseInspirationLinks } from "../../lib/media/inspiration-links.js";
import { renderChordTable, scanRepeatBoundaries, fitChordTable, fitSongForms } from "./chord-table.js";
import { stylePartMarkers, applyCompingColors, applySplitCompingColors } from "./decorations.js";
import { updateIrealProLink } from "./irealpro-link.js";
import { decorateLayers } from "../layers/overlays.js";
import { RENDER, isRenderWrite } from "../core/state.js";

const LIVE_TARGETS = { notationId: "notation", chordId: "chordtable", titleId: "songtitle" };

// The full font map handed to ABCjs — every text role set to the MuseJazz face.
const JAZZ_FONTS = [
  "annotationfont italic", "composerfont", "footerfont", "gchordfont", "headerfont",
  "historyfont", "infofont", "measurefont", "partsfont italic", "repeatfont",
  "subtitlefont", "tabgracefont", "tablabelfont", "tabnumberfont", "tempofont",
  "textfont", "titlefont 4", "tripletfont", "vocalfont", "voicefont", "wordsfont",
].reduce((fonts, spec) => {
  const [role, ...rest] = spec.split(" ");
  fonts[role] = ["MuseJazzText", ...rest].join(" ");
  return fonts;
}, {});

// The title and part order are hidden (the page draws its own), so the vertical gaps ABCjs reserves
// around them are only dead white between the form strip and the composer/style line. These are
// file-header directives; ABCjs ignores the same keys in the `format` render option.
const TIGHT_HEADER_SPACING = "%%titlespace 0\n%%composerspace 0\n%%musicspace 0\n%%titlefont MuseJazzText 1\n";

function abcParams(visualTranspose) {
  return {
    visualTranspose,
    // The booklet renders the same way as the live sheet: engrave at a wide
    // 1000 staff, then "resize" scales each line to its container (the
    // off-screen #setlistPrintBooklet is a fixed 718px, ~the portrait
    // printable width), shrinking a dense tune vertically too so it lands on
    // one page instead of spilling onto a second. "resize" also gives every
    // line an aspect-ratio wrapper box, so its height stays in step with the
    // scaled svg (a plain fixed-width render bakes a now-too-tall px height
    // per line). Chordbook still hides .notation with `display: none
    // !important`, which beats resize's inline styles.
    responsive: "resize",
    staffwidth: 1000,
    paddingTop: 0,
    paddingBottom: 0,
    add_classes: true,
    jazzchords: true,
    oneSvgPerLine: true,
    format: JAZZ_FONTS,
  };
}

function parseTune(text, visualTranspose) {
  return ABCJS.parseOnly(text, { visualTranspose })[0];
}

// Fit the live chord grid to its container now, and again once MuseJazzText
// has loaded — the first render can measure the grid under a wider fallback
// face, which inflates its natural width and over-shrinks the fit.
function fitLiveChordGrid(chordId) {
  const fit = () => {
    fitChordTable(byId(chordId));
    fitSongForms(byId(chordId));
  };
  fit();
  if (document.fonts && document.fonts.status !== "loaded") {
    // Fit even if the font load fails: the fallback face is still better than no fit.
    document.fonts.ready.then(fit, fit);
  }
}

// Box the part markers now, and again once MuseJazzText has loaded — the
// first render can measure a marker's box under a fallback face (undersized,
// clipping the glyph's ascender through the top edge).
function stylePartMarkersWhenReady(notationEl) {
  stylePartMarkers(notationEl);
  if (document.fonts && document.fonts.status !== "loaded") {
    document.fonts.ready.then(() => stylePartMarkers(notationEl)).catch(() => false); // never rejects
  }
}

// The instrument's name under the chart (printed, so a part reads as e.g.
// "trumpet").
function updateInstrumentFooter(instrument) {
  const footer = byId("instrumentText");
  const found = findInstrument(instrument);
  if (footer && found) footer.textContent = found.label.toLowerCase();
}

/*
  Live sheet only: when a solo style is picked, evolve a line over the same
  concert-pitch chords and append it as one more staff after Comping (when
  that is on), so the one visualTranspose still moves everything together.
  Returns the render text, and `program` (the style's General MIDI
  instrument) when it took, null otherwise. A take that hasn't been evolved
  yet isn't waited for: `compose` starts it in the background and the sheet
  shows without the solo until it's ready (then re-renders).
*/
function applySolo(renderText, plan, style, compose) {
  if (style === "off") {
    cancelSolo();
    compose(null);
    return { renderText, program: null };
  }
  const { song, chords } = plan.concert;
  if (!hasSoloTake(chords, song, style)) {
    compose({ chords, song, style });
    return { renderText, program: null };
  }
  cancelSolo(); // a job for the previous song must not re-render over this one
  compose(null);
  const solo = buildSoloTune(renderText, chords, song, style);
  return solo ? { renderText: solo.abc, program: SOLO_PROGRAMS[style] } : { renderText, program: null };
}

// The "Composing solo… 42%" readout next to the Solo dropdown (#soloStatus).
function showSoloStatus(fraction) {
  const status = byId("soloStatus");
  if (!status) return;
  status.textContent = fraction === null ? "" : `Composing solo… ${Math.round(fraction * 100)}%`;
}

// Shade of the `index`th of `count` kinds of step in the form strip: very light grey to light grey (dark text on top, to save ink).
function stepShade(index, count) {
  const level = Math.round(225 - (count > 1 ? (index / (count - 1)) * 60 : 0));
  return `rgb(${level}, ${level}, ${level})`;
}

// A step's share of the strip's width: what its arrow needs for the number, part box and repeat
// note, plus a bonus growing with its text length.
function stepWeight(step) {
  const text = [step.lead, ...step.adds, ...step.notes].join(" ");
  const arrow = step.number.length + step.part.length + step.repeat.length + 8;
  // Square root: a long text earns more room, but not so much that its neighbours get squeezed.
  return arrow + 4 * Math.sqrt(text.length);
}

// One step of the form strip: an arrow with the step number and part box,
// and below it what plays (underlined), who joins (+), and any asides.
function formStep(step, shade) {
  const arrow = el("div", { class: "songForm-arrow", style: { backgroundColor: shade } }, [
    el("span", { class: "songForm-num", text: step.number }),
    ...step.part.split(" ").filter(Boolean).map((name) => el("span", { class: name === "..." ? "songForm-part songForm-part--more" : "songForm-part", text: name })),
    step.repeat ? el("span", { class: "songForm-repeat", text: step.repeat }) : null,
  ]);
  return el("li", { class: "songForm-step", style: { flex: `${stepWeight(step)} 1 0` } }, [
    arrow,
    step.lead ? el("div", { class: "songForm-lead", text: step.lead }) : null,
    ...step.adds.map((add) => el("div", { class: "songForm-add", text: `+ ${add}` })),
    step.notes.length > 0 ? el("div", { class: "songForm-note", text: step.notes.join(" · ") }) : null,
  ]);
}

// Arrow colour per step: the same part (every A, every Intro) always gets the same shade, so a
// repeated part reads at a glance. Steps without a part each count as their own kind.
function stepShades(steps) {
  const kinds = [];
  const kindOf = steps.map((step, i) => {
    const key = step.part || `#${i}`;
    if (!kinds.includes(key)) kinds.push(key);
    return kinds.indexOf(key);
  });
  return kindOf.map((kind) => stepShade(kind, kinds.length));
}

// Draw the tables written as `W:| a | b |` lines as a strip of arrows, one per form step, just below
// the chord table, replacing whatever an earlier render of this sheet left there.
function renderWordsTables(chordEl, tables) {
  qsa(".songForm", chordEl.parentNode).forEach((old) => old.remove());
  let anchor = chordEl;
  tables.forEach((source) => {
    const steps = source.rows.map(parseFormStep);
    const shades = stepShades(steps);
    const form = el("ol", { class: "songForm" }, steps.map((step, i) => formStep(step, shades[i])));
    anchor.after(form);
    anchor = form;
  });
}

// Move W: lyric SVGs out of the notation container so the printer can
// paginate between them.
function extractLyrics(notationEl) {
  const lyricsEl = byId("lyrics");
  if (!lyricsEl) return;
  lyricsEl.innerHTML = "";
  let moved = false;
  notationEl.querySelectorAll("svg").forEach((svg) => {
    if (svg.querySelector(".abcjs-unaligned-words")) {
      lyricsEl.appendChild(svg);
      moved = true;
    }
  });
  lyricsEl.style.display = moved ? "" : "none";
}

// Colour the comping staff's noteheads. The comping voice is the "Comping"
// entry resolveMixerVoices resolved (Solo, when on, comes after it); its
// `index` is its ABCjs voice number.
function colorComping(notationEl, comping, voices) {
  if (!comping.active) return;
  const voiceIndex = voices.find((v) => isCompingLabel(v.label)).index;
  if (comping.parts) applySplitCompingColors(notationEl, comping.parts, voiceIndex);
  else applyCompingColors(notationEl, comping.palette, voiceIndex);
}

// Engrave `renderText` (the plan's tune, maybe augmented) plus the chord
// table, form strip and title into `targets`. Shared by live and booklet.
function paint(plan, renderText, targets, { titlePrefix = "", voices = [] } = {}) {
  const notationEl = byId(targets.notationId);
  notationEl.classList.toggle("comping-active", plan.comping.active);

  // H: text is shown behind the drawer's History button (history.js), not
  // printed at the foot of the sheet.
  const { abcText: renderTextNoTables } = extractWordsTables(stripHistory(renderText));
  const visualObjs = ABCJS.renderAbc(
    targets.notationId, TIGHT_HEADER_SPACING + renderTextNoTables, abcParams(plan.visualTranspose),
  );

  colorComping(notationEl, plan.comping, voices);
  decorateLayers(notationEl, visualObjs && visualObjs[0], plan); // NOSONAR

  notationEl.querySelectorAll(".abcjs-title, .abcjs-part-order").forEach((node) => {
    node.setAttribute("display", "none");
  });
  stylePartMarkersWhenReady(notationEl);

  const chordEl = byId(targets.chordId);
  renderChordTable(plan.displayChords, chordEl);
  // The form strip stands in for the header's printed part order.
  renderWordsTables(chordEl, plan.wordsTables);

  byId(targets.titleId).textContent = titlePrefix + plan.song.metaText.title;
  return { visualObj: visualObjs && visualObjs.length > 0 ? visualObjs[0] : null, chordEl, notationEl };
}

/*
  The sheet: the on-screen lead-sheet reader, and the same engraving pipeline
  reused to fill each song block of a print booklet. The transformation itself
  is lib/music/render-plan.js; this file draws a plan and, for the live
  sheet, publishes what it drew to the store's `tune` slice
  (songs/sheet/state.js) — audio, the Mixer, Inspiration and the tour react
  to that, the sheet never calls them.

  render(text, { transposeSemitones })   open a song fresh (a new song: the
                                         Key stepper is seeded, the tempo
                                         resets — the Mixer is sticky)
  rerender()                             re-engrave the current song in place
  renderFromFile(path)                   fetch an .abc then render() it
  renderIntoBooklet(text, targets)       engrave one song into booklet cells
                                         (fixed width, no audio, no links,
                                         never touches the store)

  rerender() also runs by itself whenever a setting that changes the drawing
  or the synth's input changes in the store (the `settings` slice, or the
  Mixer's render-affecting keys) — so a control only has to write the store.
*/
// Mixer keys that change the render text or the synth's construction
// (soundfont, swing, voicesOff), i.e. need a re-engrave. mixerVoices is
// written by the render itself (syncVoices) as well as by the Mixer.
const MIXER_RENDER_KEYS = new Set(["mixer", "gchordPattern", "swing", "highQualityAudio", "mixerVoices"]);

/*
  Call `rerender` whenever a store change needs the live sheet re-engraved:
  any `settings` change, a render-affecting Mixer key, or a Layers panel
  switch (the `layers` slice's activeLayers) — except writes a
  render makes itself (tagged RENDER: the Key stepper seeded by render(), the
  Mixer's voice list), which must not loop back. Exported so a test double of
  the sheet re-renders on exactly the same changes (tests/helpers/ctx.js).
*/
export function subscribeRerender(store, rerender) {
  const offSettings = store.subscribe("settings", (_settings, _changed, _name, meta) => {
    if (!isRenderWrite(meta)) rerender();
  });
  const offMixer = store.subscribe("mixer", (_mixer, changed, _name, meta) => {
    if (!isRenderWrite(meta) && changed.some((key) => MIXER_RENDER_KEYS.has(key))) rerender();
  });
  const offLayers = store.subscribe("layers", (_layers, changed) => {
    if (changed.includes("activeLayers")) rerender();
  });
  return () => {
    offSettings();
    offMixer();
    offLayers();
  };
}

export function createSheet(ctx) {
  let songSerial = 0;

  // Start (or keep running) the background evolution of the solo take the
  // render just asked for; null clears the readout. When it's done the sheet
  // re-renders and the take is picked up from the cache.
  function composeSoloTake(request) {
    if (request === null) {
      showSoloStatus(null);
      return;
    }
    composeSolo(request.chords, request.song, request.style, {
      onProgress: showSoloStatus,
      onDone: () => {
        showSoloStatus(null);
        rerender();
      },
    });
  }

  // Show the sheet screen and refresh the prev / next chevrons for this song.
  function activateSheet() {
    document.body.classList.add("rj-sheet-active");
    if (ctx.swipeNav) ctx.swipeNav.updateButtons();
  }

  function renderLive(text, { fresh = false } = {}) {
    const settingsState = ctx.store.get("settings");
    updateInstrumentFooter(settingsState.instrument);
    const settings = effectiveSheetSettings(settingsState, { layers: ctx.store.get("layers").activeLayers });
    const plan = buildRenderPlan(text, settings, { parse: parseTune });

    // Like comping, a solo needs chords to play over.
    const soloStyle = plan.hasChords ? settings.solo : "off";
    const solo = applySolo(plan.comping.renderText, plan, soloStyle, composeSoloTake);
    // The Mixer's voice list is an input to this very render: the tune's
    // own voices (read from the raw text, never the transposed/augmented
    // one) plus Comping/Solo, materialised by the Mixer with each voice's
    // persisted Mute/Voice/Volume before the levels are stamped in.
    const voices = resolveMixerVoices(parseVoiceList(text), plan.comping.active, solo.program, plan.comping.parts);
    ctx.mixer.syncVoices(voices);
    const renderText = mixRenderText(solo.renderText, ctx.store.get("mixer"), plan.hasChords);

    if (fresh) songSerial += 1;
    updateIrealProLink(plan.song, plan.chords);

    // #rjSheet / #notation start display:none until a song is active; that
    // must flip before ABCjs measures the container ("responsive: resize"
    // reads its width at render time; a display:none box measures 0).
    activateSheet();
    const { visualObj, chordEl, notationEl } = paint(plan, renderText, LIVE_TARGETS, { voices });
    fitLiveChordGrid(LIVE_TARGETS.chordId);
    // Live sheet only: #lyrics belongs to it. A booklet song keeps its lyrics
    // in its own print block (moving them here used to wipe the live song's
    // lyrics and leave every booklet song without its own).
    extractLyrics(notationEl);

    ctx.store.set("tune", {
      currentSongText: plan.abcText,
      songSerial,
      title: plan.song.metaText.title,
      inspirationLinks: parseInspirationLinks(plan.song.metaText.url),
      history: historyParagraphs(plan.song.metaText.history),
      hasChords: plan.hasChords,
      compingActive: plan.comping.active,
      soloActive: solo.program !== null,
      instrumentVoices: voices,
      audioTranspose: plan.audioTranspose,
      chordOffset: plan.chordOffset,
      repeatBoundaries: scanRepeatBoundaries(chordEl),
      visualObj,
    });
  }

  function rerender() {
    if (ctx.state.currentSongText !== undefined) renderLive(ctx.state.currentSongText);
  }

  function render(text, { transposeSemitones = 0 } = {}) {
    ctx.store.set("settings", { transpose: transposeSemitones || 0 }, RENDER);
    renderLive(text, { fresh: true });
  }

  // A control only writes the store; anything that changes what's drawn or
  // played re-engraves here.
  subscribeRerender(ctx.store, rerender);

  // Rotating a phone (or any resize) changes the space the grid has; re-fit the
  // live chord table so it scales back up when it now fits, or further down when
  // it doesn't.
  let refitTimer;
  window.addEventListener("resize", () => {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => {
      fitChordTable(byId("chordtable"));
      fitSongForms(byId("chordtable"));
    }, 150);
  });

  return {
    render,
    rerender,
    renderFromFile(path) {
      ctx.readFile(`/songs/${path}`, (text) => render(text));
    },
    renderIntoBooklet(text, targets) {
      const { titlePrefix = "", extraTransposeSteps = 0, ...ids } = targets;
      const settings = effectiveSheetSettings(ctx.store.get("settings"), { booklet: true });
      const plan = buildRenderPlan(text, settings, { parse: parseTune, extraTransposeSteps });
      paint(plan, plan.abcText, ids, { titlePrefix });
    },
  };
}
