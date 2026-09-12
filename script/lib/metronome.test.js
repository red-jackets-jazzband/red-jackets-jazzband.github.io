import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beatsPerMeasure, hasBackbeat, introDelaySeconds, isBackbeat, nextBeatIndex,
  pickupStartBeatIndex, scheduleClicks,
} from "./metronome.js";

test("beatsPerMeasure reads simple meters straight from the numerator", () => {
  assert.equal(beatsPerMeasure([{ num: 4, den: 4 }]), 4);
  assert.equal(beatsPerMeasure([{ num: 3, den: 4 }]), 3);
  assert.equal(beatsPerMeasure([{ num: 2, den: 2 }]), 2);
});

test("beatsPerMeasure divides a compound (x/8, multiple of 3) meter into dotted-quarter beats", () => {
  assert.equal(beatsPerMeasure([{ num: 6, den: 8 }]), 2);
  assert.equal(beatsPerMeasure([{ num: 9, den: 8 }]), 3);
  assert.equal(beatsPerMeasure([{ num: 12, den: 8 }]), 4);
});

test("beatsPerMeasure leaves a non-compound x/8 meter as one click per numerator", () => {
  assert.equal(beatsPerMeasure([{ num: 5, den: 8 }]), 5);
  assert.equal(beatsPerMeasure([{ num: 7, den: 8 }]), 7);
  // multiple of 3 but below the compound-meter threshold (< 6) — not divided
  assert.equal(beatsPerMeasure([{ num: 3, den: 8 }]), 3);
});

test("beatsPerMeasure never divides by 3 for a non-x/8 meter, even at a multiple of 3 >= 6", () => {
  assert.equal(beatsPerMeasure([{ num: 9, den: 4 }]), 9);
  assert.equal(beatsPerMeasure([{ num: 6, den: 4 }]), 6);
});

test("beatsPerMeasure sums an additive meter's terms", () => {
  assert.equal(beatsPerMeasure([{ num: 3, den: 8 }, { num: 2, den: 8 }]), 5);
});

test("beatsPerMeasure falls back to 4/4 for missing/empty/zero meter data", () => {
  assert.equal(beatsPerMeasure(undefined), 4);
  assert.equal(beatsPerMeasure(null), 4);
  assert.equal(beatsPerMeasure([]), 4);
  assert.equal(beatsPerMeasure([{ num: 0, den: 4 }]), 4);
});

test("hasBackbeat is true only for a multiple-of-4 measure", () => {
  assert.equal(hasBackbeat(4), true);
  assert.equal(hasBackbeat(8), true);
  assert.equal(hasBackbeat(12), true);
  assert.equal(hasBackbeat(3), false);
  assert.equal(hasBackbeat(5), false);
  assert.equal(hasBackbeat(0), false);
  assert.equal(hasBackbeat(-4), false);
  assert.equal(hasBackbeat(Number.NaN), false);
  assert.equal(hasBackbeat(Number.POSITIVE_INFINITY), false);
});

test("isBackbeat accents beats 2 & 4 (indices 1 & 3) in a 4-beat measure", () => {
  assert.equal(isBackbeat(0, 4), false);
  assert.equal(isBackbeat(1, 4), true);
  assert.equal(isBackbeat(2, 4), false);
  assert.equal(isBackbeat(3, 4), true);
});

test("isBackbeat repeats the 2-&-4 pattern every 4 beats for a longer multiple-of-4 measure", () => {
  assert.equal(isBackbeat(5, 8), true); // 5 % 4 === 1
  assert.equal(isBackbeat(7, 8), true); // 7 % 4 === 3
  assert.equal(isBackbeat(4, 8), false); // 4 % 4 === 0
});

test("isBackbeat never accents a meter that isn't a multiple of 4 beats", () => {
  assert.equal(isBackbeat(1, 3), false);
  assert.equal(isBackbeat(3, 3), false);
  assert.equal(isBackbeat(1, 5), false);
  assert.equal(isBackbeat(1, 2), false);
});

test("isBackbeat never accents a degenerate zero/negative/non-finite beatsInMeasure", () => {
  assert.equal(isBackbeat(1, 0), false);
  assert.equal(isBackbeat(1, -4), false);
  assert.equal(isBackbeat(1, Number.NaN), false);
  assert.equal(isBackbeat(1, Number.POSITIVE_INFINITY), false);
});

test("introDelaySeconds multiplies bars by the measure length in seconds", () => {
  assert.equal(introDelaySeconds(2, 4, 0.5), 4); // 2 bars * 4 beats/bar * 0.5s/beat
  assert.equal(introDelaySeconds(1, 3, 0.25), 0.75);
});

test("introDelaySeconds is 0 for a tune with no intro (the common case)", () => {
  assert.equal(introDelaySeconds(0, 4, 0.5), 0);
});

test("introDelaySeconds falls back to 0 for degenerate/missing inputs rather than blocking the click track", () => {
  assert.equal(introDelaySeconds(undefined, 4, 0.5), 0);
  assert.equal(introDelaySeconds(null, 4, 0.5), 0);
  assert.equal(introDelaySeconds(-1, 4, 0.5), 0);
  assert.equal(introDelaySeconds(Number.NaN, 4, 0.5), 0);
  assert.equal(introDelaySeconds(2, 0, 0.5), 0);
  assert.equal(introDelaySeconds(2, Number.NaN, 0.5), 0);
  assert.equal(introDelaySeconds(2, 4, 0), 0);
  assert.equal(introDelaySeconds(2, 4, -1), 0);
});

test("introDelaySeconds swaps the first intro bar's length for the pickup's real (shorter) length", () => {
  // 1 pickup beat + 1 full 4-beat bar = 5 beats, not 2*4 = 8.
  assert.equal(introDelaySeconds(2, 4, 0.5, 1), 2.5);
  // A single-bar intro that's entirely the pickup: just the pickup's length.
  assert.equal(introDelaySeconds(1, 4, 0.5, 1), 0.5);
});

test("introDelaySeconds ignores a degenerate/missing pickupBeats, falling back to the plain full-bar count", () => {
  assert.equal(introDelaySeconds(2, 4, 0.5), 4); // no 4th argument at all
  assert.equal(introDelaySeconds(2, 4, 0.5, 0), 4);
  assert.equal(introDelaySeconds(2, 4, 0.5, -1), 4);
  assert.equal(introDelaySeconds(2, 4, 0.5, Number.NaN), 4);
});

test("pickupStartBeatIndex phases the clock so N pickup beats later lands back on beat index 0", () => {
  assert.equal(pickupStartBeatIndex(1, 4), 3); // 1-beat pickup: starts on beat 4
  assert.equal(pickupStartBeatIndex(2, 4), 2); // 2-beat pickup: starts on beat 3
  assert.equal(pickupStartBeatIndex(3, 4), 1); // 3-beat pickup: starts on beat 2
});

test("pickupStartBeatIndex is 0 for no pickup, and for a pickup that's a whole number of full measures", () => {
  assert.equal(pickupStartBeatIndex(0, 4), 0);
  assert.equal(pickupStartBeatIndex(4, 4), 0);
  assert.equal(pickupStartBeatIndex(8, 4), 0);
});

test("pickupStartBeatIndex rounds a fractional pickup to the nearest whole beat", () => {
  assert.equal(pickupStartBeatIndex(0.9, 4), 3); // rounds up to 1 beat -> same as pickupStartBeatIndex(1, 4)
});

test("pickupStartBeatIndex falls back to 0 for degenerate/missing inputs", () => {
  assert.equal(pickupStartBeatIndex(undefined, 4), 0);
  assert.equal(pickupStartBeatIndex(null, 4), 0);
  assert.equal(pickupStartBeatIndex(-1, 4), 0);
  assert.equal(pickupStartBeatIndex(Number.NaN, 4), 0);
  assert.equal(pickupStartBeatIndex(1, 0), 0);
  assert.equal(pickupStartBeatIndex(1, Number.NaN), 0);
});

test("nextBeatIndex wraps at the end of the measure", () => {
  assert.equal(nextBeatIndex(0, 4), 1);
  assert.equal(nextBeatIndex(3, 4), 0);
  assert.equal(nextBeatIndex(2, 3), 0);
});

test("nextBeatIndex guards a degenerate zero/negative beatsInMeasure", () => {
  assert.equal(nextBeatIndex(0, 0), 0);
  assert.equal(nextBeatIndex(0, -1), 0);
});

test("scheduleClicks returns every click inside the lookahead window, advancing the clock", () => {
  const result = scheduleClicks({
    currentTime: 10,
    nextNoteTime: 10,
    beatIndex: 0,
    beatsInMeasure: 4,
    secondsPerBeat: 0.5,
    scheduleAheadSeconds: 1.1,
  });
  // 10, 10.5, 11, 11.5 all fall inside [10, 11.1) -> wait, 11.5 doesn't (< 11.1 fails)
  assert.deepEqual(result.clicks.map((c) => c.time), [10, 10.5, 11]);
  assert.deepEqual(result.clicks.map((c) => c.accent), [false, true, false]);
  assert.equal(result.nextNoteTime, 11.5);
  assert.equal(result.beatIndex, 3);
});

test("scheduleClicks returns nothing and holds the clock when the window is empty", () => {
  const result = scheduleClicks({
    currentTime: 10,
    nextNoteTime: 10.6,
    beatIndex: 2,
    beatsInMeasure: 4,
    secondsPerBeat: 0.5,
    scheduleAheadSeconds: 0.1,
  });
  assert.deepEqual(result.clicks, []);
  assert.equal(result.nextNoteTime, 10.6);
  assert.equal(result.beatIndex, 2);
});

test("scheduleClicks schedules nothing for a non-positive secondsPerBeat instead of looping forever", () => {
  const result = scheduleClicks({
    currentTime: 0,
    nextNoteTime: 0,
    beatIndex: 0,
    beatsInMeasure: 4,
    secondsPerBeat: 0,
    scheduleAheadSeconds: 100,
  });
  assert.deepEqual(result.clicks, []);
  assert.equal(result.nextNoteTime, 0);
  assert.equal(result.beatIndex, 0);
});

test("scheduleClicks carries the backbeat pattern correctly across a measure boundary", () => {
  const result = scheduleClicks({
    currentTime: 0,
    nextNoteTime: 0,
    beatIndex: 3, // beat 4, the last beat of the measure
    beatsInMeasure: 4,
    secondsPerBeat: 1,
    scheduleAheadSeconds: 2.5,
  });
  // beat 3 (accent) at t=0, wraps to beat 0 (no accent) at t=1, beat 1 (accent) at t=2
  assert.deepEqual(result.clicks, [
    { time: 0, accent: true },
    { time: 1, accent: false },
    { time: 2, accent: true },
  ]);
  assert.equal(result.beatIndex, 2);
});

test("scheduleClicks catches up a clock left far behind currentTime (e.g. a throttled backgrounded tab) instead of flooding every missed beat", () => {
  const result = scheduleClicks({
    currentTime: 10,
    nextNoteTime: 0, // 10 seconds / 20 beats behind
    beatIndex: 0,
    beatsInMeasure: 4,
    secondsPerBeat: 0.5,
    scheduleAheadSeconds: 0.1,
  });
  // Exactly one click at the first beat on/after currentTime, not 20.
  assert.deepEqual(result.clicks, [{ time: 10, accent: false }]);
  assert.equal(result.nextNoteTime, 10.5);
  assert.equal(result.beatIndex, 1);
});

test("scheduleClicks's catch-up preserves the beat-index/accent phase, not just the clock", () => {
  const result = scheduleClicks({
    currentTime: 10,
    nextNoteTime: 0.1, // 9.9s behind == 19.8 beats, rounds up to 20
    beatIndex: 1, // already on the backbeat
    beatsInMeasure: 4,
    secondsPerBeat: 0.5,
    scheduleAheadSeconds: 1,
  });
  // beatIndex 1 + 20 missed beats wraps back to 1 (same phase) at t=10.1
  assert.deepEqual(result.clicks, [
    { time: 10.1, accent: true },
    { time: 10.6, accent: false },
  ]);
  assert.equal(result.beatIndex, 3);
});

test("scheduleClicks's catch-up falls back to a single-beat measure for a degenerate beatsInMeasure", () => {
  const result = scheduleClicks({
    currentTime: 10,
    nextNoteTime: 0,
    beatIndex: 0,
    beatsInMeasure: Number.NaN,
    secondsPerBeat: 0.5,
    scheduleAheadSeconds: 0.1,
  });
  assert.deepEqual(result.clicks, [{ time: 10, accent: false }]);
  assert.equal(result.beatIndex, 0);
});

test("scheduleClicks falls back to a single-beat measure for a zero beatsInMeasure, wrapping the beat index instead of leaving it NaN", () => {
  const result = scheduleClicks({
    currentTime: 10,
    nextNoteTime: 0,
    beatIndex: 0,
    beatsInMeasure: 0,
    secondsPerBeat: 0.5,
    scheduleAheadSeconds: 0.1,
  });
  assert.deepEqual(result.clicks, [{ time: 10, accent: false }]);
  assert.equal(result.beatIndex, 0);
});

test("scheduleClicks excludes a click that falls exactly on the lookahead horizon", () => {
  const result = scheduleClicks({
    currentTime: 0,
    nextNoteTime: 0,
    beatIndex: 0,
    beatsInMeasure: 4,
    secondsPerBeat: 0.5,
    scheduleAheadSeconds: 1, // horizon = 1, exactly the third click's time
  });
  assert.deepEqual(result.clicks.map((c) => c.time), [0, 0.5]);
});
