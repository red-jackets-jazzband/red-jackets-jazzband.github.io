/*
  How many bars a tune's intro takes, for the Repeat stepper: a practice
  loop plays the intro the first time only and every later pass starts at
  the part after it (Paul Barbarin's Second Line: the two-bar `P:Intro`
  isn't played again).

    introBarCount(visualObj) -> number of bars before the second part, or 0

  An intro is the tune's first `P:` part when its title says "intro"
  (`P:Intro`, `P:intro`, `P:Sous Intro`) and it opens the tune — no note
  before it — and another part follows it. Read from the first voice of the
  parsed tune; a bar counts once it holds a note or rest, so a line that
  starts with a bar line (`|:` after a `||`) doesn't count an empty bar.
  The count is the measure index the audio's timing map gives that next
  part's first bar (a pickup is bar 0 there too).
*/

const INTRO_TITLE = /\bintro\b/i;

function firstVoice(line) {
  const staff = line && line.staff && line.staff[0];
  return (staff && staff.voices && staff.voices[0]) || [];
}

// The first voice's elements across every printed line, in order.
function voiceElements(visualObj) {
  const lines = (visualObj && visualObj.lines) || [];
  return lines.reduce((all, line) => all.concat(firstVoice(line)), []);
}

// The index of the part after an intro that opens the tune, or -1.
function partAfterIntro(elements) {
  const first = elements.findIndex((el) => el.el_type === "part" || el.el_type === "note");
  if (first < 0 || elements[first].el_type !== "part") return -1;
  if (!INTRO_TITLE.test(elements[first].title || "")) return -1;
  return elements.findIndex((el, i) => i > first && el.el_type === "part");
}

export function introBarCount(visualObj) {
  const elements = voiceElements(visualObj);
  const end = partAfterIntro(elements);
  if (end < 0) return 0;
  let bars = 0;
  let barHasNotes = false;
  for (const el of elements.slice(0, end)) {
    if (el.el_type === "note") {
      barHasNotes = true;
    } else if (el.el_type === "bar" && barHasNotes) {
      bars += 1;
      barHasNotes = false;
    }
  }
  return bars + (barHasNotes ? 1 : 0);
}
