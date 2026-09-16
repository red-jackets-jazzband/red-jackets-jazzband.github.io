import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeMp3 } from "./mp3-encode.js";
import { createLamejsStub, withLamejs } from "../../../tests/helpers/stubs.js";

function fakeAudioBuffer({ sampleRate = 44100, channels }) {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    getChannelData: (c) => Float32Array.from(channels[c]),
  };
}

test("encodeMp3 always builds a fixed 44.1kHz/192kbps stereo encoder", () => {
  const stub = createLamejsStub();
  const buffer = fakeAudioBuffer({ channels: [[0, 1, -1, 2, -2]] });
  withLamejs(stub, () => encodeMp3(buffer));

  assert.deepEqual(stub.calls.constructed, [{ channels: 2, sampleRate: 44100, kbps: 192 }]);
});

test("encodeMp3 duplicates a mono source across both channels and converts float samples to clamped 16-bit PCM", () => {
  const stub = createLamejsStub();
  const buffer = fakeAudioBuffer({ channels: [[0, 1, -1, 2, -2]] });
  withLamejs(stub, () => encodeMp3(buffer));

  assert.equal(stub.calls.encodeBuffer.length, 1);
  const expected = [0, 0x7fff, -0x8000, 0x7fff, -0x8000];
  assert.deepEqual(Array.from(stub.calls.encodeBuffer[0].left), expected);
  assert.deepEqual(Array.from(stub.calls.encodeBuffer[0].right), expected);
});

test("encodeMp3 keeps a stereo source's two channels distinct", () => {
  const stub = createLamejsStub();
  const buffer = fakeAudioBuffer({ channels: [[1, -1], [-1, 1]] });
  withLamejs(stub, () => encodeMp3(buffer));

  assert.deepEqual(Array.from(stub.calls.encodeBuffer[0].left), [0x7fff, -0x8000]);
  assert.deepEqual(Array.from(stub.calls.encodeBuffer[0].right), [-0x8000, 0x7fff]);
});

test("encodeMp3 resamples a source rendered at a different sample rate up to 44.1kHz", () => {
  const stub = createLamejsStub();
  // Exactly half of TARGET_SAMPLE_RATE, so the linearly-interpolated result
  // is easy to hand-verify: [0, 1] at 22050Hz -> [0, 0.5, 1, 1] at 44100Hz.
  const buffer = fakeAudioBuffer({ sampleRate: 22050, channels: [[0, 1]] });
  withLamejs(stub, () => encodeMp3(buffer));

  assert.deepEqual(Array.from(stub.calls.encodeBuffer[0].left), [0, 16383, 0x7fff, 0x7fff]);
});

test("encodeMp3 chunks a long buffer into multiple encodeBuffer calls and concatenates the output with the flush tail", () => {
  const stub = createLamejsStub();
  const buffer = fakeAudioBuffer({ channels: [new Array(1152 + 10).fill(0)] });
  const result = withLamejs(stub, () => encodeMp3(buffer));

  assert.equal(stub.calls.encodeBuffer.length, 2);
  assert.equal(stub.calls.encodeBuffer[0].left.length, 1152);
  assert.equal(stub.calls.encodeBuffer[1].left.length, 10);
  // The stub hands back one byte per encodeBuffer call ([1], [2]) plus the
  // flush's own [0xff] tail — encodeMp3 must keep that order when concatenating.
  assert.deepEqual(Array.from(new Uint8Array(result)), [1, 2, 0xff]);
});

test("encodeMp3 skips a call whose encoder output was empty", () => {
  const stub = createLamejsStub();
  stub.Mp3Encoder = function Mp3Encoder(channels, sampleRate, kbps) {
    stub.calls.constructed.push({ channels, sampleRate, kbps });
    this.encodeBuffer = () => Int8Array.from([]);
    this.flush = () => Int8Array.from([7]);
  };
  const buffer = fakeAudioBuffer({ channels: [[0, 0]] });
  const result = withLamejs(stub, () => encodeMp3(buffer));

  assert.deepEqual(Array.from(new Uint8Array(result)), [7]);
});

test("encodeMp3 with repeatCount 1 (or 0, or omitted) encodes a single playthrough", () => {
  const buffer = fakeAudioBuffer({ channels: [[0, 1, -1]] });
  for (const repeatCount of [1, 0, undefined]) {
    const stub = createLamejsStub();
    withLamejs(stub, () => encodeMp3(buffer, { repeatCount }));
    assert.equal(stub.calls.encodeBuffer.length, 1);
  }
});

// These three exercise repeatAudioBuffer's old job — respecting the Repeat
// stepper's count for MP3 export — now folded straight into encodeMp3 (see
// its own doc comment): the render is resampled/converted once, then fed
// into the *same* encoder session once per repeat as a subarray view, rather
// than first concatenating a repeatCount-times-longer buffer. Asserting on
// stub.calls.encodeBuffer (one call per segment, since every fixture here is
// well under the 1152-sample chunk size) is what proves that: a single
// concatenated buffer would instead show up as one call per SAMPLES_PER_ENCODE
// chunk of the *whole* looped length, not one call per playthrough.
test("encodeMp3 feeds the full render into the same encoder session once per repeat when restartFraction is 0", () => {
  const stub = createLamejsStub();
  const buffer = fakeAudioBuffer({ channels: [[0, 1, -1]] });
  withLamejs(stub, () => encodeMp3(buffer, { repeatCount: 3, restartFraction: 0 }));

  const onePass = [0, 0x7fff, -0x8000];
  assert.equal(stub.calls.encodeBuffer.length, 3); // one call per playthrough
  stub.calls.encodeBuffer.forEach((call) => assert.deepEqual(Array.from(call.left), onePass));
});

test("encodeMp3 skips the pickup on every repeat pass but the first, per restartFraction", () => {
  const stub = createLamejsStub();
  // A 4-sample render with a 2-sample pickup -> restartFraction 0.5.
  const buffer = fakeAudioBuffer({ channels: [[0, 1, -1, 0]] });
  withLamejs(stub, () => encodeMp3(buffer, { repeatCount: 3, restartFraction: 0.5 }));

  assert.equal(stub.calls.encodeBuffer.length, 3);
  assert.deepEqual(Array.from(stub.calls.encodeBuffer[0].left), [0, 0x7fff, -0x8000, 0]); // full first pass
  assert.deepEqual(Array.from(stub.calls.encodeBuffer[1].left), [-0x8000, 0]); // pickup skipped
  assert.deepEqual(Array.from(stub.calls.encodeBuffer[2].left), [-0x8000, 0]); // pickup skipped
});

test("encodeMp3 clamps an out-of-range restartFraction instead of producing garbage", () => {
  const buffer = fakeAudioBuffer({ channels: [[0, 1, -1, 0]] });

  const negative = createLamejsStub();
  withLamejs(negative, () => encodeMp3(buffer, { repeatCount: 2, restartFraction: -1 }));
  // Clamps to 0 (no skip) -> the repeat pass is a full playthrough too.
  assert.deepEqual(Array.from(negative.calls.encodeBuffer[1].left), [0, 0x7fff, -0x8000, 0]);

  const tooLarge = createLamejsStub();
  withLamejs(tooLarge, () => encodeMp3(buffer, { repeatCount: 2, restartFraction: 1.5 }));
  // Clamps to 1 -> the repeat pass's tail is empty, so it contributes no call at all.
  assert.equal(tooLarge.calls.encodeBuffer.length, 1);
});
