import { byId, on } from "../lib/dom.js";
import { GM_VOICES } from "../lib/gm-voices.js";
import { parseSongIndex } from "../lib/song-index.js";
import { STANDARD_SOUNDFONT_URL, HIGH_QUALITY_SOUNDFONT_URL } from "./audio-player.js";

const SW_URL = "/sw.js";
const SW_SCOPE = "/songs/";
const TOUR_LANGS = ["en", "nl", "de", "fr"];

// The 12 semitones of a chromatic octave, sharps only (no need to spell both
// enharmonic names — a soundfont has one sample per pitch regardless of how
// a tune spells it). ABCJS's own note range spans C,, (lowest) to c''' or
// higher; a bare accidental-free run (the original shape here) only ever
// warms the seven natural pitches, silently leaving every sharp/flat sample
// unfetched until a song that actually uses one happens to be played.
const CHROMATIC_STEPS = ["C", "^C", "D", "^D", "E", "F", "^F", "G", "^G", "A", "^A", "B"];

function chromaticOctave(octaveMark, lower, barEnd = "|") {
  const steps = lower ? CHROMATIC_STEPS : CHROMATIC_STEPS.map((step) => step.toLowerCase());
  const notes = steps.map((step) => step + octaveMark).join(" ");
  return `${notes} ${barEnd}`;
}

// A wide chromatic run, six full octaves (C,, to b''') covering the full
// practical range any curated GM instrument (lib/gm-voices.js) could ever be
// asked to play, every semitone included. There's no API that enumerates a
// soundfont's own sample files — ABCJS's synth just XHRs whichever exact
// note it's told to play, from static/script/abcjs_midi_6.7.0-min.js's own
// per-instrument loader — so rendering this once per instrument through the
// real synth, letting the service worker cache every request as it flies by
// (see sw.js's "soundfont" strategy), is the only way to warm the full set
// ahead of time rather than only after a song that happens to use that exact
// note has been played.
export const WIDE_RANGE_ABC = [
  "X:1", "T:", "M:12/4", "L:1/4", "K:C",
  chromaticOctave(",,", true),
  chromaticOctave(",", true),
  chromaticOctave("", true),
  chromaticOctave("", false),
  chromaticOctave("'", false),
  chromaticOctave("''", false, "|]"),
].join("\n");

function setStatus(text) {
  const node = byId("offlineStatus");
  if (!node) return;
  node.textContent = text;
  node.hidden = !text;
}

function serviceWorkerSupported() {
  return "serviceWorker" in navigator;
}

function registerServiceWorker() {
  if (!serviceWorkerSupported()) return Promise.resolve(false);
  return navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, type: "module" })
    .then(() => true)
    .catch(() => false);
}

const CONTROLLER_WAIT_MS = 10000;

// navigator.serviceWorker.ready only promises the registration has *an*
// active worker — not that it has claimed *this* page yet. On a first-ever
// visit, this page loaded before any worker existed, so it stays
// uncontrolled until the newly-activated worker's clients.claim() (sw.js's
// own activate handler) reaches it, which happens slightly later and fires
// a "controllerchange" event here. Fetching the library before that leaves
// every request bypassing the worker entirely — nothing gets cached.
//
// Bounded, not indefinite: a forced/hard reload (Shift+Reload in Chrome, or
// DevTools' "Bypass for network") explicitly skips the service worker for
// that one navigation — the registration stays active, but since no new
// install/activate cycle runs, clients.claim() never fires and
// "controllerchange" never arrives here. Waiting forever in that case would
// leave the download silently stuck (and `downloading` never reset) rather
// than telling the visitor what to do about it.
function waitForController() {
  if (navigator.serviceWorker.controller) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onControllerChange = () => {
      clearTimeout(timer);
      resolve(true);
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange, { once: true });
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      resolve(false);
    }, CONTROLLER_WAIT_MS);
  });
}

// Fetches every path in turn (not in parallel — a rehearsal-room connection
// is exactly the kind that chokes on a hundred-odd concurrent requests),
// reporting (done, total) after each one lands or fails, and returning how
// many failed. A missing/flaky individual file (a network error, or a
// non-2xx response — fetch() only rejects on the former, so both are
// checked) is skipped, not fatal — anyone downloading over a spotty
// connection gets everything that *did* land, and the caller reports the
// count of what didn't rather than silently claiming everything succeeded.
async function fetchAll(paths, onProgress) {
  let failures = 0;
  for (let i = 0; i < paths.length; i += 1) {
    try {
      const response = await fetch(paths[i]);
      if (!response.ok) failures += 1;
    } catch {
      failures += 1;
    }
    onProgress(i + 1, paths.length);
  }
  return failures;
}

// Resolves to whether the sample-warming failed outright (init() itself
// rejecting — a malformed soundFontUrl, the browser refusing the request
// entirely). Only init() is needed here — it's the step that walks the
// rendered tune for its distinct pitches and XHRs each one's sample (see its
// own doc comment where it's called), which is all sample-*warming* needs.
// prime() is a separate, later step that renders those loaded samples into
// a real output AudioBuffer — many seconds of audio per instrument at this
// run's default tempo — pure wasted CPU/memory here, since nothing ever
// plays or reads that buffer.
//
// Confirmed empirically (a real browser, every sample request forced to
// fail): a *individual* missing/unreachable sample is invisible here.
// init()'s own promise resolves normally — not rejected, and its resolved
// value's own `error`/`loaded` report is empty too — regardless of how many
// of the tune's samples actually failed to load; ABCJS only ever surfaces
// that per-note failure as a console.error (an internal debugCallback log),
// never through this promise. So this can only catch a catastrophic,
// whole-instrument failure, never a handful of missing accidentals — a real
// gap, but one with no stable API to close from the caller's side.
function warmInstrument(program, soundFontUrl) {
  const visualObj = ABCJS.renderAbc("*", WIDE_RANGE_ABC, { visualTranspose: 0 })[0];
  const synth = new ABCJS.synth.CreateSynth();
  return synth.init({ visualObj, options: { soundFontUrl, program } })
    .then(() => false)
    .catch(() => true); // one missing instrument shouldn't abort the whole run
}

async function warmSoundfont(highQualityAudio, onProgress) {
  const soundFontUrl = highQualityAudio ? HIGH_QUALITY_SOUNDFONT_URL : STANDARD_SOUNDFONT_URL;
  let failures = 0;
  for (let i = 0; i < GM_VOICES.length; i += 1) {
    if (await warmInstrument(GM_VOICES[i].value, soundFontUrl)) failures += 1;
    onProgress(i + 1, GM_VOICES.length);
  }
  return failures;
}

async function fetchIndex(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return parseSongIndex(await response.text());
}

async function runDownload(ctx) {
  setStatus("Getting ready…");
  const registered = await registerServiceWorker();
  if (!registered) {
    setStatus("Offline mode isn't supported in this browser.");
    return;
  }
  await navigator.serviceWorker.ready;
  if (!(await waitForController())) {
    setStatus("Reload this page normally (not a forced/hard reload) to enable offline mode.");
    return;
  }

  let songs;
  let setlists;
  try {
    [songs, setlists] = await Promise.all([
      fetchIndex("/songs/index_of_songs.txt"),
      fetchIndex("/setlists/index_of_setlists.txt"),
    ]);
  } catch {
    setStatus("Couldn't reach the song library — try again when you're back online.");
    return;
  }

  let failures = 0;
  failures += await fetchAll(
    songs.map((s) => `/songs/${s.file}`),
    (done, total) => setStatus(`Songs: ${done} of ${total}`),
  );
  failures += await fetchAll(
    setlists.map((s) => `/setlists/${s.file}`),
    (done, total) => setStatus(`Setlists: ${done} of ${total}`),
  );
  await fetchAll(TOUR_LANGS.map((lang) => `/tour/tour.${lang}.md`), () => {});

  failures += await warmSoundfont(
    ctx.state.highQualityAudio,
    (done, total) => setStatus(`Sounds: ${done} of ${total}`),
  );

  setStatus(downloadStatus(failures));
}

function downloadStatus(failures) {
  if (failures === 0) return "Available offline.";
  const noun = failures === 1 ? "item" : "items";
  return `Available offline (${failures} ${noun} couldn't be downloaded — try again for full coverage).`;
}

/*
  "Download for offline" (#offlineBtn, songs.md): registers the service
  worker (see sw.js), then works through the whole library in three passes —
  every song/setlist/tour-copy file, then a full-range render of every
  curated Mixer instrument (lib/gm-voices.js's GM_VOICES) against the
  currently-selected soundfont set — reporting progress into #offlineStatus
  as it goes.

  Feature-detected: on a browser with no serviceWorker support (or none for
  module workers specifically — sw.js is a real ES module), #offlineBtn
  simply doesn't do anything meaningful to warm, and says so, rather than
  pretending it worked.

  runDownload() catches its own expected failure points (an unreachable
  index, a missing individual file) and turns each into a status message
  rather than a rejection — but downloadForOffline() still catches here too,
  as a last resort: an uncaught rejection reaching this click handler would
  otherwise leave "Getting ready…" stuck on screen with no way to tell
  what happened, on top of the unhandled-rejection console noise.
*/
export function createOffline(ctx) {
  let downloading = false;

  function downloadForOffline() {
    if (downloading) return Promise.resolve();
    downloading = true;
    return runDownload(ctx)
      .catch(() => setStatus("Couldn't finish downloading — try again when you're back online."))
      .finally(() => { downloading = false; });
  }

  function init() {
    const btn = byId("offlineBtn");
    if (!btn) return;
    if (!serviceWorkerSupported()) {
      btn.hidden = true;
      return;
    }
    on("offlineBtn", "click", downloadForOffline);
    registerServiceWorker();
  }

  return { init, downloadForOffline };
}
