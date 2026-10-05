// String.prototype.matchAll (Safari 13+) isn't available on Safari 12 — see
// CLAUDE.md's browser-support note. This is its manual equivalent: every
// match of a global regex against `str`, in order, as a plain array of the
// same match objects `regex.exec` returns (capture groups, `.index`, ...).
//
// A global regex is stateful (`exec` advances its own `lastIndex` between
// calls), so `regex` is reset to 0 first — callers can safely pass a shared,
// module-level regex without it carrying leftover position from an earlier
// call the way a raw `exec` loop would.
export function execAll(regex, str) {
  regex.lastIndex = 0;
  const matches = [];
  let match = regex.exec(str);
  while (match !== null) {
    matches.push(match);
    // A zero-width match (an empty capture with no consumed characters)
    // would otherwise re-match at the same lastIndex forever.
    if (match[0] === "") regex.lastIndex += 1;
    match = regex.exec(str);
  }
  return matches;
}
