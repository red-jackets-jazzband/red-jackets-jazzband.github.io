import { byId } from "../lib/dom.js";
import { offsetForInstrument, changeClefForInstrument } from "../lib/instruments.js";
import { parseChordScheme, computeChordOffset } from "../lib/chords.js";
import { convertChordsToRoman } from "../lib/music-theory.js";
import { buildCompingTune } from "../lib/comping.js";
import { renderChordTable, scanRepeatBoundaries, fitChordTable } from "./chord-table.js";
import { stylePartMarkers, applyCompingColors } from "./sheet-decorations.js";
import { updateIrealProLink } from "./irealpro-link.js";

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
  fitChordTable(byId(chordId));
  if (document.fonts && document.fonts.status !== "loaded") {
    document.fonts.ready.then(() => fitChordTable(byId(chordId)));
  }
}

/*
  The sheet: the on-screen lead-sheet reader, and the same engraving pipeline
  reused to fill each song block of a print booklet.

  render(text, { transposeSemitones })   open a song fresh (resets tempo + the
                                         mute-melody toggle, seeds the Key
                                         stepper)
  rerender()                             re-engrave the current song in place
                                         (instrument / key / tempo / comping
                                         change) — reads the Key stepper live
  renderFromFile(path)                   fetch an .abc then render() it
  renderIntoBooklet(text, targets)       engrave one song into booklet cells
                                         (fixed width, no audio, no links)
*/
export function createSheet(ctx) {
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
    return Boolean(text.match(/^V:\d+.*(clef=|transpose=|name=)/gm));
  }

  function buildComping(abcText, compingValue) {
    const concertSong = parseTune(abcText, 0);
    const concertChords = parseChordScheme(concertSong);
    return buildCompingTune(abcText, concertChords, concertSong, compingValue);
  }

  function compingRequest(isBooklet, chords) {
    if (isBooklet || chords.length === 0) return "off";
    const menu = byId("sheetmenu");
    if (!menu || !menu.classList.contains("show-advanced")) return "off";
    const select = byId("comping");
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
    const compingValue = compingRequest(isBooklet, chords);
    if (compingValue !== "off") {
      const comping = buildComping(abcText, compingValue);
      if (comping) return { renderText: comping.abc, palette: comping.palette, active: true };
    }
    return { renderText: abcText, palette: null, active: false };
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
    if (!isBooklet) ctx.audio.transposeSemitones = audio;
    ctx.state.currentSongText = abcText;

    const song = parseTune(abcText, visual);
    const chords = parseChordScheme(song);
    const displayChords = instrumentValue === "concert_+_roman"
      ? convertChordsToRoman(chords, song)
      : chords;
    ctx.audio.chordOffset = computeChordOffset(song);

    const comping = applyComping(abcText, chords, isBooklet);
    ctx.state.compingActive = comping.active;

    if (addLink) {
      ctx.inspiration.updateLink(song.metaText.url, song.metaText.title);
      updateIrealProLink(song, chords);
    }

    // #rjSheet / #notation start display:none until a song is active; that must
    // flip before ABCjs measures the container ("responsive: resize" reads its
    // width at render time; a display:none box measures 0).
    if (!isBooklet) document.body.classList.add("rj-sheet-active");

    const notationEl = byId(notationId);
    notationEl.classList.toggle("comping-active", comping.active);

    const visualObjs = ABCJS.renderAbc(notationId, comping.renderText, abcParams(visual));

    if (comping.active) applyCompingColors(notationEl, comping.palette);

    notationEl.querySelectorAll(".abcjs-title").forEach((node) => {
      node.setAttribute("display", "none");
    });
    stylePartMarkers(notationEl);

    const chordEl = byId(chordId);
    renderChordTable(displayChords, chordEl);
    if (!isBooklet) {
      fitLiveChordGrid(chordId);
      ctx.audio.setRepeatBoundaries(scanRepeatBoundaries(chordEl));
    }

    byId(titleId).innerHTML = titlePrefix + song.metaText.title;

    if (!isBooklet && visualObjs && visualObjs.length > 0) {
      ctx.audio.initForTune(visualObjs[0]);
      ctx.audio.setupNotationClickHandler();
      ctx.audio.updateTempoLabel();
    }

    extractLyrics(notationEl);
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

  function render(text, { transposeSemitones = 0 } = {}) {
    const stepper = byId("transpose");
    if (stepper) stepper.value = transposeSemitones || 0;
    ctx.state.tempoOverrideBpm = null;
    ctx.audio.melodOff = false;
    engrave(text, { ...LIVE_TARGETS, addLink: true });
  }

  // Rotating a phone (or any resize) changes the space the grid has; re-fit the
  // live chord table so it scales back up when it now fits, or further down when
  // it doesn't.
  let refitTimer;
  window.addEventListener("resize", () => {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => fitChordTable(byId("chordtable")), 150);
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
