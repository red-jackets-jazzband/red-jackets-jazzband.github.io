/*
  One practice rhythm cell (PRACTICE_RHYTHMS in practice.js: eight eighths of
  `x` onset, `-` hold, `.` rest, a trailing `>` tie over the bar line) as the
  notes and rests a 4/4 bar would print. A note or rest never starts a value
  the beat grid doesn't allow there — off the beat only an eighth, on beat 2
  or 4 at most a quarter, on beat 3 at most a half, nothing crosses the middle
  of the bar unless it starts on beat 1 — so a longer sound is split into
  tied pieces (Charleston: dotted quarter, eighth, half rest; a note on the
  "and" of 1 held to beat 3: eighth tied to a quarter).

  Each event is { pos, len, rest, dotted, tie, beam }: `pos`/`len` in
  eighths, `tie` true when it's tied to the next note (or, for the last one,
  over the bar line), `beam` true when it's an eighth beamed to the next
  eighth of the same beat.
*/

const BAR = 8;
// The values a note may start at each position, longest first.
const NOTE_LENGTHS = { 0: [8, 6, 4, 3, 2, 1], 4: [4, 3, 2, 1], 2: [2, 1], 6: [2, 1] };
const REST_LENGTHS = { 0: [8, 4, 2, 1], 4: [4, 2, 1], 2: [2, 1], 6: [2, 1] };

function pieces(pos, len, table) {
  const out = [];
  let at = pos;
  let left = len;
  while (left > 0) {
    const allowed = table[at] || [1];
    const size = allowed.find((n) => n <= left);
    out.push({ pos: at, len: size });
    at += size;
    left -= size;
  }
  return out;
}

// The cell's sounds and silences, in eighths: { pos, len, rest }.
function runs(body) {
  const out = [];
  [...body].forEach((mark, i) => {
    const last = out[out.length - 1];
    if (mark === "x") out.push({ pos: i, len: 1, rest: false });
    else if (mark === "-" && last && !last.rest) last.len += 1;
    else if (last && last.rest) last.len += 1;
    else out.push({ pos: i, len: 1, rest: true });
  });
  return out;
}

export function notateRhythm(cell) {
  const body = cell.slice(0, BAR);
  const events = [];
  for (const run of runs(body)) {
    const parts = pieces(run.pos, run.len, run.rest ? REST_LENGTHS : NOTE_LENGTHS);
    parts.forEach((part, i) => {
      events.push({
        pos: part.pos,
        len: part.len,
        rest: run.rest,
        dotted: part.len === 3 || part.len === 6,
        tie: !run.rest && i < parts.length - 1,
        beam: false,
      });
    });
  }
  const last = events[events.length - 1];
  if (cell.endsWith(">") && last && !last.rest) last.tie = true;
  events.forEach((event, i) => {
    const next = events[i + 1];
    event.beam = Boolean(next) && !event.rest && !next.rest && event.len === 1 && next.len === 1
      && event.pos % 2 === 0 && next.pos === event.pos + 1;
  });
  return events;
}
