import { byId, downloadBlob } from "../lib/dom.js";
import { encodeMp3 } from "../lib/mp3-encode.js";

const IDLE_ICON = '<span class="fa-solid fa-file-audio" aria-hidden="true"></span>';
const BUSY_ICON = '<span class="fa-solid fa-spinner fa-spin" aria-hidden="true"></span>';

// "basin_street.abc" -> "basin_street.mp3" — keeps the exported file's name
// in step with the source ABC rather than re-deriving one from the title.
function mp3Filename(songFile) {
  return `${String(songFile || "song").replace(/\.abc$/i, "")}.mp3`;
}

async function exportMp3(ctx, btn) {
  const built = ctx.audio.buildExportOptions();
  if (!built) return;

  // Captured before the first await: if a newer render supersedes this one
  // while synth.init()/prime() are in flight (the user switches songs, or
  // re-renders the same one via Key/Tempo/Comping), the download must still
  // be named after *this* export's song, and the button must be left alone
  // for whichever render owns it now rather than being stomped back to idle.
  const song = ctx.state.currentSongFile;
  const generation = ctx.audio.renderGeneration;

  btn.disabled = true;
  btn.innerHTML = BUSY_ICON;
  try {
    const synth = new ABCJS.synth.CreateSynth();
    await synth.init(built);
    await synth.prime();
    const buffer = synth.audioBuffers && synth.audioBuffers[0];
    if (!buffer) throw new Error("No audio rendered for this tune");
    const mp3 = encodeMp3(buffer, { repeatCount: built.repeatCount, restartFraction: built.restartFraction });
    downloadBlob(mp3Filename(song), new Blob([mp3], { type: "audio/mpeg" }));
  } catch (err) {
    console.warn("MP3 export failed:", err);
  } finally {
    if (ctx.audio.renderGeneration === generation) {
      btn.disabled = false;
      btn.innerHTML = IDLE_ICON;
    }
  }
}

/*
  Wire the action cluster's Export MP3 button, next to Print / iRealPro: it
  renders the current sheet — key, tempo, instrument, Mixer levels, all baked
  into the visualObj the same way the live player reads them (see
  audio-player.js's buildExportOptions) — through a fresh, offline
  ABCJS.synth.CreateSynth(), which always renders exactly one playthrough.
  encodeMp3 (lib/mp3-encode.js) takes that single render straight through to
  the vendored lamejs encoder, looping it into the Repeat stepper's own count
  itself as it streams — skipping the tune's pickup on every pass but the
  first, same as the live practice loop — rather than this file first
  building a second, repeated copy of the raw audio. The button is
  enabled/disabled alongside Play/Stop/Mixer in audio-player.js's
  setButtonsDisabled, since export needs the same audio-capable tune.
*/
export function initMp3Export(ctx) {
  const btn = byId("exportMp3Btn");
  if (!btn) return;
  btn.addEventListener("click", () => exportMp3(ctx, btn));
}
