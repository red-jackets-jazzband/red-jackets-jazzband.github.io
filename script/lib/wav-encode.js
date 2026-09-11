// Encode a rendered audio buffer as a 16-bit PCM WAV file, for the sheet's
// "Export WAV" button (songs/wav-export.js). Takes anything duck-typed like a
// Web Audio AudioBuffer — numberOfChannels, sampleRate, length and
// getChannelData() — so this stays pure and testable without a real
// AudioContext (jsdom has none). Returns an ArrayBuffer; the caller wraps it
// in a Blob for download.

const BYTES_PER_SAMPLE = 2;
const PCM_FORMAT = 1;
const HEADER_SIZE = 44;

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.codePointAt(i));
}

// Float sample (nominally -1..1, clamped) -> signed 16-bit PCM.
function toPcm16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
}

export function encodeWav(audioBuffer) {
  const { numberOfChannels, sampleRate, length } = audioBuffer;
  const channels = [];
  for (let c = 0; c < numberOfChannels; c += 1) channels.push(audioBuffer.getChannelData(c));

  const blockAlign = numberOfChannels * BYTES_PER_SAMPLE;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(HEADER_SIZE + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, PCM_FORMAT, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = HEADER_SIZE;
  for (let i = 0; i < length; i += 1) {
    for (let c = 0; c < numberOfChannels; c += 1) {
      view.setInt16(offset, toPcm16(channels[c][i]), true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return buffer;
}
