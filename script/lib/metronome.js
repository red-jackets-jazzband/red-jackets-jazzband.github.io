// Pure metronome maths for the Mixer panel's metronome toggle (songs/
// metronome.js owns the Web Audio scheduling + DOM wiring; nothing here
// touches a timer, an AudioContext or the DOM, so it's plain unit-testable).

// Meter unknown/unparseable — most tunes on this site are straight 4/4.
const DEFAULT_BEATS_PER_MEASURE = 4;

/*
  How many clicks one measure gets, from abcjs's own
  `tune.lines[0].staff[0].meter.value` — an array of {num, den} terms (an
  additive meter like "3+2/8" splits across entries, so the numerators are
  summed). A compound meter (denominator 8, numerator a multiple of 3 — 6/8,
  9/8, 12/8) clicks once per dotted-quarter, not once per eighth note, so the
  count is divided by 3; anything else clicks once per the tune's own beat
  unit (whatever the Tempo stepper already means by "one beat" — see
  lib/tempo.js), i.e. once per numerator count.
*/
export function beatsPerMeasure(meterValue) {
  if (!Array.isArray(meterValue) || meterValue.length === 0) return DEFAULT_BEATS_PER_MEASURE;
  const numerator = meterValue.reduce((sum, term) => sum + (Number(term && term.num) || 0), 0);
  const denominator = Number(meterValue[0] && meterValue[0].den) || 4;
  if (numerator <= 0) return DEFAULT_BEATS_PER_MEASURE;
  if (denominator === 8 && numerator % 3 === 0 && numerator >= 6) return numerator / 3;
  return numerator;
}

/*
  Whether a measure of this size has a 2-&-4 to lean on at all: only a
  measure built from groups of 4 beats (4/4 and its multiples — 8/4, or 12/8
  read as 4 dotted-quarters). A 3/4 waltz or a 5/4 tune has no "beat 4", so
  those fall back to clicking every beat instead of forcing a backbeat that
  doesn't fit — see isBackbeat and songs/metronome.js's tick().
*/
export function hasBackbeat(beatsInMeasure) {
  return Number.isFinite(beatsInMeasure) && beatsInMeasure >= 4 && beatsInMeasure % 4 === 0;
}

/*
  The backbeat — beats 2 & 4 — is what this site's tunes want the metronome
  to lean on, not the usual downbeat: a hihat tick there gives a clearer feel
  to lock a swing/New-Orleans groove onto than a click that just booms on
  beat 1. beatIndex is 0-based.
*/
export function isBackbeat(beatIndex, beatsInMeasure) {
  if (!hasBackbeat(beatsInMeasure)) return false;
  const beatInGroup = beatIndex % 4;
  return beatInGroup === 1 || beatInGroup === 3;
}

/*
  How long (in seconds) the metronome should hold off before its first tick:
  a rubato/free intro with no chords under it (introBars — ctx.audio's
  chordOffset, the same "leading chordless bars" count comping.js already
  rests through) usually isn't in strict tempo, so a click ticking through it
  would just clash rather than help. A tune with no such intro (introBars 0,
  the common case) gets no delay at all. Degenerate/missing inputs (no meter
  info yet, say) fall back to no delay rather than silencing the click track
  outright.

  pickupBeats (ctx.audio's own pickup length, in beats — see
  pickupStartBeatIndex below) corrects for one wrinkle: chordOffset counts
  abcjs's own bars, and a tune's pickup/anacrusis is one such bar even though
  it's shorter than a full measure. Treating it as a full beatsInMeasure-long
  bar like the others would overcount the delay by the pickup's own
  shortfall, landing the first click late. Only the first intro bar can ever
  be the pickup, so only one bar's length is swapped out.
*/
export function introDelaySeconds(introBars, beatsInMeasure, secondsPerBeat, pickupBeats = 0) {
  if (!Number.isFinite(introBars) || introBars <= 0) return 0;
  if (!Number.isFinite(beatsInMeasure) || beatsInMeasure <= 0) return 0;
  if (!Number.isFinite(secondsPerBeat) || secondsPerBeat <= 0) return 0;
  const pickup = Number.isFinite(pickupBeats) && pickupBeats > 0 ? pickupBeats : 0;
  const introBeats = pickup > 0 ? pickup + (introBars - 1) * beatsInMeasure : introBars * beatsInMeasure;
  return introBeats * secondsPerBeat;
}

/*
  Which 0-based beat index the metronome's clock should start counting from,
  for a tune with a pickup/anacrusis (a partial measure before the first full
  bar) and no chordless intro to skip ahead of it (see introDelaySeconds —
  when there IS an intro to skip, skipping it always lands exactly on a bar
  line, so the clock resumes at index 0 regardless of any pickup). Without
  this, the clock's usual assumption — that beat index 0 starts counting
  right as Play begins — treats the tune's very first note as beat 1, when
  it's really already partway into a phantom measure the pickup borrows the
  tail end of. A whole number of pickup beats lands exactly back on index 0
  (no pickup, or a pickup that happens to be a full measure); a fractional
  pickup rounds to the nearest beat, since the clock only ticks on whole
  beats anyway.
*/
export function pickupStartBeatIndex(pickupBeats, beatsInMeasure) {
  if (!Number.isFinite(pickupBeats) || pickupBeats <= 0) return 0;
  if (!Number.isFinite(beatsInMeasure) || beatsInMeasure <= 0) return 0;
  const rounded = Math.round(pickupBeats) % beatsInMeasure;
  return rounded === 0 ? 0 : beatsInMeasure - rounded;
}

// The next 0-based beat index, wrapping at the end of the measure.
export function nextBeatIndex(beatIndex, beatsInMeasure) {
  const n = Math.max(1, beatsInMeasure);
  return (beatIndex + 1) % n;
}

/*
  The classic Web Audio "lookahead scheduler" step (see e.g. Chris Wilson's
  "A Tale of Two Clocks"): given where the running clock already got to
  (nextNoteTime, beatIndex), return every click that falls inside
  [nextNoteTime, currentTime + scheduleAheadSeconds) plus the clock's new
  position, without touching an actual timer or AudioContext — the caller
  (songs/metronome.js) turns each returned click into a real scheduled sound.
  secondsPerBeat <= 0 (a degenerate/garbage tempo) schedules nothing rather
  than looping forever.
*/
export function scheduleClicks({
  currentTime, nextNoteTime, beatIndex, beatsInMeasure, secondsPerBeat, scheduleAheadSeconds,
}) {
  if (secondsPerBeat <= 0) return { clicks: [], nextNoteTime, beatIndex };
  const beats = Number.isFinite(beatsInMeasure) && beatsInMeasure > 0 ? beatsInMeasure : 1;
  const horizon = currentTime + scheduleAheadSeconds;
  let time = nextNoteTime;
  let beat = beatIndex;

  /*
    A throttled timer — a backgrounded tab is the common case — can leave
    nextNoteTime long behind currentTime by the time this next runs. Jump
    straight to the first beat at/after currentTime instead of letting the
    loop below push one click per beat that's already gone by: every one of
    those would start "now" (a past `time` just means "as soon as possible"
    to Web Audio's own scheduling), so an unbridged gap would otherwise
    flood the page with a burst of near-simultaneous clicks.
  */
  if (time < currentTime) {
    const missedBeats = Math.ceil((currentTime - time) / secondsPerBeat);
    time += missedBeats * secondsPerBeat;
    beat = (beat + missedBeats) % beats;
  }

  const clicks = [];
  while (time < horizon) {
    clicks.push({ time, accent: isBackbeat(beat, beats) });
    time += secondsPerBeat;
    beat = nextBeatIndex(beat, beats);
  }
  return { clicks, nextNoteTime: time, beatIndex: beat };
}
