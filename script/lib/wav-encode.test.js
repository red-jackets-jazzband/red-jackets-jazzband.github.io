import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeWav } from "./wav-encode.js";

function fakeAudioBuffer({ sampleRate = 44100, channels }) {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    getChannelData: (c) => Float32Array.from(channels[c]),
  };
}

function readAscii(view, offset, len) {
  let s = "";
  for (let i = 0; i < len; i += 1) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

test("encodeWav writes a valid RIFF/WAVE header for a mono buffer", () => {
  const buffer = encodeWav(fakeAudioBuffer({ sampleRate: 8000, channels: [[0, 0.5, -0.5]] }));
  const view = new DataView(buffer);

  assert.equal(readAscii(view, 0, 4), "RIFF");
  assert.equal(view.getUint32(4, true), 36 + 3 * 2); // 36 + dataSize
  assert.equal(readAscii(view, 8, 4), "WAVE");
  assert.equal(readAscii(view, 12, 4), "fmt ");
  assert.equal(view.getUint32(16, true), 16);
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 1); // channels
  assert.equal(view.getUint32(24, true), 8000); // sample rate
  assert.equal(view.getUint32(28, true), 8000 * 2); // byte rate (mono, 16-bit)
  assert.equal(view.getUint16(32, true), 2); // block align
  assert.equal(view.getUint16(34, true), 16); // bits per sample
  assert.equal(readAscii(view, 36, 4), "data");
  assert.equal(view.getUint32(40, true), 3 * 2);
  assert.equal(buffer.byteLength, 44 + 3 * 2);
});

test("encodeWav converts float samples to clamped 16-bit PCM", () => {
  const buffer = encodeWav(fakeAudioBuffer({ channels: [[0, 1, -1, 2, -2]] }));
  const view = new DataView(buffer);
  const sample = (i) => view.getInt16(44 + i * 2, true);

  assert.equal(sample(0), 0);
  assert.equal(sample(1), 0x7fff); // +1 -> max positive
  assert.equal(sample(2), -0x8000); // -1 -> max negative
  assert.equal(sample(3), 0x7fff); // out-of-range clamped the same as +1
  assert.equal(sample(4), -0x8000); // out-of-range clamped the same as -1
});

test("encodeWav interleaves multi-channel samples", () => {
  const buffer = encodeWav(fakeAudioBuffer({ channels: [[1, -1], [-1, 1]] }));
  const view = new DataView(buffer);
  const sample = (i) => view.getInt16(44 + i * 2, true);

  assert.equal(view.getUint16(22, true), 2); // channels
  assert.equal(sample(0), 0x7fff); // left[0]
  assert.equal(sample(1), -0x8000); // right[0]
  assert.equal(sample(2), -0x8000); // left[1]
  assert.equal(sample(3), 0x7fff); // right[1]
});
