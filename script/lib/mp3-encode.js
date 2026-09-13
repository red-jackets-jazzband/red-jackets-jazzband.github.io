// Encode a rendered audio buffer as an MP3 file, for the sheet's "Export
// MP3" button (songs/mp3-export.js). Takes anything duck-typed like a Web
// Audio AudioBuffer — numberOfChannels, sampleRate, length and
// getChannelData() — so this stays pure and testable without a real
// AudioContext (jsdom has none) or the real encoder (a vendored classic
// script, static/script/lamejs-1.2.1-min.js, that only exists as the global
// `lamejs` in a browser). Returns an ArrayBuffer; the caller wraps it in a
// Blob for download.
//
// The output is always a fixed 44.1kHz/192kbps stereo file — resampled up
// from whatever rate ABCjs's offline synth actually rendered at (empirically
// 32kHz, undocumented and not configurable via CreateSynth's options) and
// widened to stereo (the mono case just duplicates the one channel), rather
// than passing the synth's own native format straight through.

const SAMPLES_PER_ENCODE = 1152; // one MPEG-1 Layer III frame's worth of PCM samples
const TARGET_SAMPLE_RATE = 44100;
const KBPS = 192;

// Float sample (nominally -1..1, clamped) -> signed 16-bit PCM.
function toPcm16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

function toPcm16Array(channelData) {
  const pcm = new Int16Array(channelData.length);
  for (let i = 0; i < channelData.length; i += 1) pcm[i] = toPcm16(channelData[i]);
  return pcm;
}

// Linear-interpolation resample to TARGET_SAMPLE_RATE — good enough for a
// reference export, not a mastering-grade resampler.
function resample(channelData, fromRate) {
  if (fromRate === TARGET_SAMPLE_RATE) return channelData;
  const ratio = fromRate / TARGET_SAMPLE_RATE;
  const newLength = Math.round(channelData.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const srcPos = i * ratio;
    const index = Math.floor(srcPos);
    const frac = srcPos - index;
    const a = channelData[index] ?? 0;
    const b = channelData[index + 1] ?? a;
    result[i] = a + (b - a) * frac;
  }
  return result;
}

function concatChunks(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    result.set(chunks[i], offset);
    offset += chunks[i].length;
  }
  return result;
}

export function encodeMp3(audioBuffer) {
  const { numberOfChannels, sampleRate } = audioBuffer;
  const stereo = numberOfChannels >= 2;
  const left = toPcm16Array(resample(audioBuffer.getChannelData(0), sampleRate));
  const right = stereo ? toPcm16Array(resample(audioBuffer.getChannelData(1), sampleRate)) : left;

  const encoder = new lamejs.Mp3Encoder(2, TARGET_SAMPLE_RATE, KBPS);
  const chunks = [];
  for (let i = 0; i < left.length; i += SAMPLES_PER_ENCODE) {
    const leftChunk = left.subarray(i, i + SAMPLES_PER_ENCODE);
    const rightChunk = right.subarray(i, i + SAMPLES_PER_ENCODE);
    const encoded = encoder.encodeBuffer(leftChunk, rightChunk);
    if (encoded.length > 0) chunks.push(encoded);
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(flushed);

  return concatChunks(chunks).buffer;
}
