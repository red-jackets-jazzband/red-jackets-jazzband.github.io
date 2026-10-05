// Shared by comping.js (buildCompingTune) and audio-mix.js (resolveMixerVoices)
// so both always agree on which id a newly-appended voice gets -- kept in its
// own module, rather than one importing the other, so audio-mix.js doesn't
// pull comping.js (excluded from tsconfig.lib.json's type-check -- see its own
// file for why) into the checked program as a side effect of the import.

// The smallest positive integer id not already in `usedIds` -- starting the
// count at 1 and counting up past any collision, so this is the id's actual
// definition, not an approximation of it. For the common case (a tune's own
// ids are a contiguous "1".."N") that lands on N+1, same as a plain
// length+1 guess would. It only differs for a chart whose own ids are
// sparse (e.g. "1"/"3": the true smallest unused id is "2", not "4" — a
// length+1 guess starts at 3, collides, and only counts upward from there,
// so it can never find a gap below its own starting point) or non-numeric
// (e.g. "T"/"S" -- those never collide with a numeric guess at all, so this
// still lands on "1" here, same as if usedIds were empty).
export function nextVoiceId(usedIds) {
  const used = new Set(usedIds);
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}
