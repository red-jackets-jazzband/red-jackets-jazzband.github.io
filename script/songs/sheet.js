import { byId, el, qsa } from "../lib/dom.js";
import { extractWordsTables, extractPartOrderRows, parseFormStep } from "../lib/words-table.js";
import { offsetForInstrument, changeClefForInstrument } from "../lib/instruments.js";
import { parseChordScheme, computeChordOffset } from "../lib/chords.js";
import { convertChordsToRoman } from "../lib/music-theory.js";
import { buildCompingTune } from "../lib/comping.js";
import {
  buildSoloTune, cancelSolo, composeSolo, hasSoloTake, SOLO_PROGRAMS,
} from "../lib/solo.js";
import {
  injectMixerAudio, resolveGchordPattern, parseVoiceList, resolveMixerVoices, isCompingLabel,
} from "../lib/audio-mix.js";
import { defaultVoiceProgram } from "../lib/gm-voices.js";
import { renderChordTable, scanRepeatBoundaries, fitChordTable, fitSongForms } from "./chord-table.js";
import { stylePartMarkers, applyCompingColors, applySplitCompingColors } from "./sheet-decorations.js";
import { updateIrealProLink } from "./irealpro-link.js";
import { updateInspirationExtLinks } from "./inspiration-links.js";
import { parseInspirationLinks, firstYoutubeUrl, firstSpotifyUrl, firstSoundcloudUrl } from "../lib/inspiration-links.js";

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
    document.fonts.ready.then(() => stylePartMarkers(notationEl));
  }
}

function updateInstrumentFooter() {
  const select = byId("instrument");
  const footer = byId("instrumentText");
  if (select && footer) {
    footer.innerHTML = select.options[select.selectedIndex].text.toLowerCase();
  }
}

// Voices that carry their own clef/transpose/name are left untouched — the
// instrument's clef and offset must not be applied on top.
function hasInstrumentVoices(text) {
  return text.split("\n").some((line) => {
    if (!/^V:\d+/.test(line)) return false;
    return line.includes("clef=") || line.includes("transpose=") || line.includes("name=");
  });
}

function buildComping(abcText, compingValue, parts) {
  const concertSong = parseTune(abcText, 0);
  // Unlike the chord table's scheme, this must have one entry per physical
  // bar exactly as printed — including a second-ending's own bars — or the
  // comping voice runs out of bars (and falls silent) the moment the melody
  // reaches such an ending. See parseChordScheme's doc comment.
  const concertChords = parseChordScheme(concertSong, { includeAlternateEndings: true });
  return buildCompingTune(abcText, concertChords, concertSong, compingValue, parts);
}

// The advanced drawer's pick in `selectId` ("comping" / "solo"), or "off" for a
// booklet, a chordless tune or a closed drawer.
function advancedRequest(selectId, isBooklet, chords) {
  if (isBooklet || chords.length === 0) return "off";
  const menu = byId("sheetmenu");
  if (!menu || !menu.classList.contains("show-advanced")) return "off";
  const select = byId(selectId);
  return select ? select.value : "off";
}

/*
  Resolve the transposition. `visual` shifts both the printed notation and
  (folded with the instrument's own offset) is what ABCjs engraves; `audio`
  is the pre-instrument value handed to the synth as midiTranspose so every
  instrument's part still sounds at the same concert pitch. Also stamps the
  K: line's clef for a bass-clef instrument. A booklet render ignores the
  Key stepper — its transposition comes only from the setlist's own override.
*/
function resolveTranspose(text, instrumentValue, extraTransposeSteps, isBooklet) {
  const stepper = byId("transpose");
  const stepperSteps = !isBooklet && stepper !== null ? Number(stepper.value) : 0;
  const audio = stepperSteps + extraTransposeSteps;
  if (hasInstrumentVoices(text)) return { abcText: text, visual: audio, audio };
  return {
    abcText: changeClefForInstrument(instrumentValue, text),
    visual: audio + offsetForInstrument(instrumentValue),
    audio,
  };
}

/*
  Live sheet only: when a comping pattern is picked, generate a second
  block-chord staff from the tune in concert pitch and inject it, so the one
  visualTranspose below moves melody + comping together. Returns the (maybe
  augmented) ABC, the notehead colour palette and whether it took.
*/
function applyComping(abcText, chords, isBooklet) {
  const compingValue = advancedRequest("comping", isBooklet, chords);
  if (compingValue !== "off") {
    const comping = buildComping(abcText, compingValue, splitCompingParts());
    if (comping) {
      return { renderText: comping.abc, palette: comping.palette, parts: comping.parts || null, active: true };
    }
  }
  return { renderText: abcText, palette: null, parts: null, active: false };
}

// The chord tones (indices into R / 3 / 5) the Split button left selected, or
// null while Comping is one block-chord staff. The state lives on the
// buttons next to the Comping dropdown (songs/selects.js).
function splitCompingParts() {
  const split = byId("compingSplitBtn");
  if (!split || split.getAttribute("aria-pressed") !== "true") return null;
  const parts = [];
  document.querySelectorAll(".comping-part-btn").forEach((btn) => {
    if (btn.getAttribute("aria-pressed") === "true") parts.push(Number(btn.dataset.part));
  });
  return parts.length ? parts : null;
}

/*
  Live sheet only: when a solo style is picked, evolve a line over the same
  concert-pitch chords and append it as one more staff after Comping (when
  that is on), so the one visualTranspose still moves everything together.
  Returns the render text, and `program` (the style's General MIDI
  instrument) when it took, null otherwise. A take that hasn't been evolved yet
  isn't waited for: `compose` starts it in the background and the sheet shows
  without the solo until it's ready (then re-renders).
*/
function applySolo(renderText, abcText, chords, isBooklet, compose) {
  if (isBooklet) return { renderText, program: null }; // never touches the live job
  const style = advancedRequest("solo", isBooklet, chords);
  if (style === "off") {
    cancelSolo();
    compose(null);
    return { renderText, program: null };
  }
  const concertSong = parseTune(abcText, 0);
  const concertChords = parseChordScheme(concertSong, { includeAlternateEndings: true });
  if (!hasSoloTake(concertChords, concertSong, style)) {
    compose({ chords: concertChords, song: concertSong, style });
    return { renderText, program: null };
  }
  cancelSolo(); // a job for the previous song must not re-render over this one
  compose(null);
  const solo = buildSoloTune(renderText, concertChords, concertSong, style);
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

/*
  The sheet: the on-screen lead-sheet reader, and the same engraving pipeline
  reused to fill each song block of a print booklet.

  render(text, { transposeSemitones })   open a song fresh (resets tempo,
                                         seeds the Key stepper — the mixer's
                                         levels are sticky across songs)
  rerender()                             re-engrave the current song in place
                                         (instrument / key / tempo / comping
                                         change) — reads the Key stepper live
  renderFromFile(path)                   fetch an .abc then render() it
  renderIntoBooklet(text, targets)       engrave one song into booklet cells
                                         (fixed width, no audio, no links)
*/
export function createSheet(ctx) {
  // A muted Bass/Chords channel is just its fader forced to 0 — see
  // lib/audio-mix.js. (Every other voice's mute goes through computeVoicesOff
  // in audio-player.js instead — see lib/audio-mix.js's own doc comment for
  // why Bass/Chords aren't handled the same way.)
  function effectiveMixerPercent(channel) {
    const m = ctx.state.mixer;
    return m[`${channel}Muted`] ? 0 : m[`${channel}Volume`];
  }

  // null (the Voice picker left un-overridden) has to become undefined, not
  // pass through as null — injectMixerAudio's own default parameters only
  // kick in for undefined, so a stored null would otherwise reach ABCjs as
  // a literal "%%MIDI program null".
  function mixerProgram(channel) {
    const value = ctx.state.mixer[`${channel}Program`];
    return value === null ? undefined : value;
  }

  // Builds the id -> program map injectMixerAudio needs to stamp each of the
  // tune's resolved voices (lib/audio-mix.js's resolveMixerVoices — always
  // at least one). A null program in ctx.state.mixerVoices (the Voice picker
  // left un-overridden) resolves to a guess from the voice's own name
  // (lib/gm-voices.js's guessGmProgram) rather than one flat default, since a
  // chart can mix several different real instruments on one page.
  function voiceProgramMap() {
    const map = new Map();
    ctx.state.mixerVoices.forEach((v) => {
      map.set(v.id, v.program === null ? defaultVoiceProgram(v) : v.program);
    });
    return map;
  }

  // Builds the id -> 0-100 volume percent map injectMixerAudio needs to stamp
  // each resolved voice's %%MIDI beat line (lib/audio-mix.js's
  // beatStressLine) — the fader's real, working per-voice volume control.
  // Every voice in ctx.state.mixerVoices already carries a numeric `volume`
  // (songs/mixer.js's syncVoices seeds it at 100 for a voice with no
  // persisted level yet), so there's no null-coalescing needed here the way
  // voiceProgramMap needs for its own null sentinel.
  function voiceVolumeMap() {
    const map = new Map();
    ctx.state.mixerVoices.forEach((v) => {
      map.set(v.id, v.volume);
    });
    return map;
  }

  // Live sheet only (kept out of engrave() itself so its own branches don't
  // push engrave's cyclomatic complexity over the lint gate): resolve the
  // tune's own voice declarations (lib/audio-mix.js's parseVoiceList) plus
  // whether Comping is on into the Mixer's one flat voice list
  // (resolveMixerVoices) and hand it to the Mixer. Reads the raw `text`
  // param, never the transpose-adjusted `abcText`, so a prior comping/
  // instrument pass can't be mistaken for a second declaration of a voice.
  function syncInstrumentVoices(text, comping, soloProgram, isBooklet) {
    if (isBooklet) return;
    ctx.state.instrumentVoices = resolveMixerVoices(parseVoiceList(text), comping.active, soloProgram, comping.parts);
    ctx.mixer.syncVoices(ctx.state.instrumentVoices);
  }

  // The comping voice is the "Comping" entry resolveMixerVoices resolved
  // (Solo, when on, comes after it) -- its own `index` is that voice's 0-indexed ABCjs voice number
  // (V:2 for an ordinary tune, or one past however many voices a chart like
  // honky_tonk_town_riffs.abc already declares). Only called once comping is
  // known active and syncInstrumentVoices has run, so
  // ctx.state.instrumentVoices reflects this same render.
  function compingVoiceIndex() {
    return ctx.state.instrumentVoices.find((v) => isCompingLabel(v.label)).index;
  }

  function colorComping(notationEl, comping) {
    if (!comping.active) return;
    if (comping.parts) applySplitCompingColors(notationEl, comping.parts, compingVoiceIndex());
    else applyCompingColors(notationEl, comping.palette, compingVoiceIndex());
  }

  // Live sheet only: stamp the mixer's Bass/Chords levels and every
  // resolved voice's Voice + Volume into the ABC text before it's parsed, so
  // the one visualObj that gets rendered is exactly what plays — see
  // lib/audio-mix.js.
  function resolveRenderText(comping, hasChords, isBooklet) {
    if (isBooklet) return comping.renderText;
    return injectMixerAudio(comping.renderText, {
      hasChords,
      bassPercent: effectiveMixerPercent("bass"),
      bassProgram: mixerProgram("bass"),
      chordsPercent: effectiveMixerPercent("chords"),
      chordsProgram: mixerProgram("chords"),
      gchordPattern: resolveGchordPattern(ctx.state.gchordPattern),
      voicePrograms: voiceProgramMap(),
      voiceVolumes: voiceVolumeMap(),
    });
  }

  // What the live sheet is showing, for everything that reacts to it (audio,
  // Mixer, rerender()). Booklet renders — a setlist's print pages, built in the
  // background as soon as a setlist opens — must never write these: rerender()
  // re-engraves currentSongText, so a booklet write would swap the last booklet
  // song onto the live sheet the next time the drawer, comping or instrument
  // changed.
  function recordLiveText(isBooklet, abcText, audioTranspose) {
    if (isBooklet) return;
    ctx.audio.transposeSemitones = audioTranspose;
    ctx.state.currentSongText = abcText;
  }

  function recordLiveTune(isBooklet, song, comping, solo) {
    if (isBooklet) return;
    ctx.audio.chordOffset = computeChordOffset(song);
    ctx.state.compingActive = comping.active;
    ctx.state.soloActive = solo.program !== null;
  }

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
        ctx.sheet.rerender();
      },
    });
  }

  // Show the sheet screen and refresh the prev / next chevrons for this song.
  function activateSheet() {
    document.body.classList.add("rj-sheet-active");
    if (ctx.swipeNav) ctx.swipeNav.updateButtons();
  }

  function engrave(text, opts) {
    const {
      notationId, chordId, titleId,
      titlePrefix = "", addLink = false, isBooklet = false, extraTransposeSteps = 0,
    } = opts;

    updateInstrumentFooter();

    const instrumentValue = byId("instrument").value;
    const { abcText, visual, audio } = resolveTranspose(
      text, instrumentValue, extraTransposeSteps, isBooklet,
    );
    recordLiveText(isBooklet, abcText, audio);

    const song = parseTune(abcText, visual);
    const chords = parseChordScheme(song);
    const displayChords = instrumentValue === "concert_+_roman"
      ? convertChordsToRoman(chords)
      : chords;
    const comping = applyComping(abcText, chords, isBooklet);
    const solo = applySolo(comping.renderText, abcText, chords, isBooklet, composeSoloTake);
    recordLiveTune(isBooklet, song, comping, solo);
    syncInstrumentVoices(text, comping, solo.program, isBooklet);

    const renderText = resolveRenderText({ ...comping, renderText: solo.renderText }, chords.length > 0, isBooklet);

    if (addLink) {
      const inspirationLinks = parseInspirationLinks(song.metaText.url);
      ctx.inspiration.updateLink({
        youtube: firstYoutubeUrl(inspirationLinks),
        spotify: firstSpotifyUrl(inspirationLinks),
        soundcloud: firstSoundcloudUrl(inspirationLinks),
      }, song.metaText.title);
      updateInspirationExtLinks(inspirationLinks);
      updateIrealProLink(song, chords);
    }

    // #rjSheet / #notation start display:none until a song is active; that must
    // flip before ABCjs measures the container ("responsive: resize" reads its
    // width at render time; a display:none box measures 0).
    if (!isBooklet) activateSheet();

    const notationEl = byId(notationId);
    notationEl.classList.toggle("comping-active", comping.active);

    const { abcText: renderTextNoTables } = extractWordsTables(renderText);
    const visualObjs = ABCJS.renderAbc(notationId, TIGHT_HEADER_SPACING + renderTextNoTables, abcParams(visual));

    colorComping(notationEl, comping);

    notationEl.querySelectorAll(".abcjs-title, .abcjs-part-order").forEach((node) => {
      node.setAttribute("display", "none");
    });
    stylePartMarkersWhenReady(notationEl);

    const chordEl = byId(chordId);
    renderChordTable(displayChords, chordEl);
    // The form strip stands in for the header's printed part order: a W: table wins, else the P: order becomes the strip.
    const { tables } = extractWordsTables(abcText);
    const orderRows = extractPartOrderRows(abcText);
    renderWordsTables(chordEl, tables.length === 0 && orderRows ? [{ header: null, rows: orderRows }] : tables);
    if (!isBooklet) {
      fitLiveChordGrid(chordId);
      ctx.audio.setRepeatBoundaries(scanRepeatBoundaries(chordEl));
      ctx.state.hasChords = chords.length > 0;
      ctx.mixer.refresh();
    }

    byId(titleId).textContent = titlePrefix + song.metaText.title;

    if (!isBooklet && visualObjs && visualObjs.length > 0) {
      ctx.audio.initForTune(visualObjs[0]);
      ctx.audio.setupNotationClickHandler();
      ctx.audio.updateTempoLabel();
    }

    extractLyrics(notationEl);
  }

  function render(text, { transposeSemitones = 0 } = {}) {
    const stepper = byId("transpose");
    if (stepper) stepper.value = transposeSemitones || 0;
    ctx.state.tempoOverrideBpm = null;
    engrave(text, { ...LIVE_TARGETS, addLink: true });
  }

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
    rerender() {
      if (ctx.state.currentSongText !== undefined) {
        engrave(ctx.state.currentSongText, { ...LIVE_TARGETS, addLink: true });
      }
    },
    renderFromFile(path) {
      ctx.readFile(`/songs/${path}`, (text) => render(text));
    },
    renderIntoBooklet(text, targets) {
      engrave(text, { ...targets, isBooklet: true });
    },
  };
}
