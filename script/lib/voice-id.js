// Shared by comping.js (buildCompingTune) and audio-mix.js (resolveMixerVoices)
// so both always agree on which id a newly-appended voice gets -- kept in its
// own module, rather than one importing the other, so audio-mix.js doesn't
// pull comping.js (excluded from tsconfig.lib.json's type-check -- see its own
// file for why) into the checked program as a side effect of the import.

// The smallest positive integer id not already in `usedIds` -- starting the
// guess at "one past however many voices there are" (right for the common
// case: a tune's own ids are a contiguous "1".."N", so N+1 is free), then
// counting up past any collision. Handles a chart whose own ids are sparse
// (e.g. "1"/"3", where a plain length+1 guess would land back on "3") or
// non-numeric (e.g. "T"/"S" -- those never collide with a numeric guess at
// all, so this returns the same length+1 guess as before for that case).
export function nextVoiceId(usedIds) {
  const used = new Set(usedIds);
  let n = usedIds.length + 1;
  while (used.has(String(n))) n++;
  return String(n);
}
