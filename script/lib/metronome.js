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
  The backbeat — beats 2 & 4 — is what this site's tunes want the metronome
  to lean on, not the usual downbeat accent: a heavier click there gives a
  clearer feel to lock a swing/New-Orleans groove onto than a metronome that
  just booms on beat 1. That convention only means something for a measure
  built from groups of 4 beats (4/4 and its multiples — 8/4, or 12/8 read as
  4 dotted-quarters); a 3/4 waltz or a 5/4 tune has no "beat 4" to lean on,
  so those fall back to a plain, unaccented click on every beat rather than
  forcing an accent that doesn't fit. beatIndex is 0-based.
*/
export function isBackbeat(beatIndex, beatsInMeasure) {
  if (!Number.isFinite(beatsInMeasure) || beatsInMeasure < 4 || beatsInMeasure % 4 !== 0) {
    return false;
  }
  const beatInGroup = beatIndex % 4;
  return beatInGroup === 1 || beatInGroup === 3;
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
