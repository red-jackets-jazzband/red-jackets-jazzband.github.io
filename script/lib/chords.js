// Split into a base-chord pattern and a bass-note pattern (tested separately
// around any "/" bass annotation) rather than one combined regex — same
// grammar, but keeps each pattern's branching complexity in check.
const VALID_CHORD_BASE = /^[A-Ga-g]([#♯b♭])?(maj|m|min|dim|aug|sus|add)?(Ø)?(\d)?([#♯b♭])?(\d)?$/;
const VALID_CHORD_BASS = /^[A-Ga-g]([#♯b♭])?(\d)?$/;

function isValidChordName(name) {
  const slash = name.indexOf("/");
  if (slash === -1) return VALID_CHORD_BASE.test(name);
  return VALID_CHORD_BASE.test(name.slice(0, slash)) && VALID_CHORD_BASS.test(name.slice(slash + 1));
}

// Synonyms abcjs's own bundled accompaniment engine (breakSynonyms, in the
// midi player) recognizes as "no chord" — silencing the auto-generated
// Bass/Chords accompaniment for that bar — when written with a position
// prefix ("^N.C.") so abcjs doesn't parse it as a literal (and unparseable)
// chord name. Matched here the same way, case-insensitively, so the chord
// table and comping generator agree with abcjs on what counts as a break.
const BREAK_CHORD_NAMES = new Set(["break", "(break)", "no chord", "n.c.", "tacet"]);

// The single display form every break synonym above normalizes to.
export const BREAK_CHORD = "N.C.";

function isBreakChordName(name) {
  return BREAK_CHORD_NAMES.has(name.toLowerCase());
}

// Replaces the sharp and flat signs with the official unicode chars.
export function replaceAccidentalWithUtf8Char(note) {
  return note.replace("b ", "♭").replace("#", "♯").replace("dim", "Ø");
}

// Reads the chords from an abcjs tune (parsed intermediate format) into a
// list of measures, each `{ text: [chordStrings...], leftRepeat?, part?, ... }`.
// `part` (an ABC `P:` field's title, e.g. "A") is set on the first measure of
// that section — the chord table boxes it there — and is otherwise absent.
//
// By default, measures inside a second-or-later ("[2", "[3", ...) repeat
// ending are dropped: the chord table (and its repeat-boundary highlighting)
// wants the scheme's one canonical pass, not a tag/outro ending's extra bars
// thrown in on top — that's what lets a blues head with a coda still
// simplify down to a clean 12-bar grid. `includeAlternateEndings: true`
// keeps every measure instead, one entry per physical bar exactly as
// printed — buildCompingTune needs that full count, or the comping voice
// runs out of bars (and falls silent) the moment the melody enters such an
// ending, e.g. happy_feet_blues's part C outro.
// Walks one voice's elements, accumulating measures the same way the old
// single-function parser did — split into small methods purely to keep each
// piece's own branching shallow; the state (and the order it's touched in)
// is unchanged from before.
class ChordSchemeParser {
  constructor(includeAlternateEndings) {
    this.includeAlternateEndings = includeAlternateEndings;
    this.chords = [];
    this.currentMeasure = { text: [] };
    this.parsedValidChord = false;
    this.didNotParseChordInThisMeasure = true;
    this.inAlternativeEnding = false;
    this.noteOrRestInMeasure = false;
  }

  get skipEnding() {
    return this.inAlternativeEnding && !this.includeAlternateEndings;
  }

  applyBarShape(element) {
    if (element.type === "bar_left_repeat") {
      this.currentMeasure.leftRepeat = true;
    } else if (element.type === "bar_right_repeat") {
      this.currentMeasure.rightRepeat = true;
    } else if (element.type === "bar_thin_thin") {
      if (this.noteOrRestInMeasure && this.parsedValidChord) {
        this.currentMeasure.doubeThinBarRight = true;
      } else {
        this.currentMeasure.doubeThinBarLeft = true;
      }
    }
  }

  updateEndingState(element) {
    if (element.startEnding !== undefined) {
      if (element.startEnding > 1) this.inAlternativeEnding = true;
    } else if (element.endEnding !== undefined && this.inAlternativeEnding) {
      this.inAlternativeEnding = false;
    }
  }

  flushMeasure() {
    if (this.didNotParseChordInThisMeasure && this.parsedValidChord && this.noteOrRestInMeasure) {
      this.currentMeasure.text.push(" % ");
    }
    if (this.currentMeasure.text.length > 0) {
      this.chords.push(this.currentMeasure);
      this.currentMeasure = { text: [] };
      this.noteOrRestInMeasure = false;
    }
    this.didNotParseChordInThisMeasure = true;
  }

  handleBar(element) {
    this.applyBarShape(element);
    this.updateEndingState(element);
    if (!this.skipEnding) this.flushMeasure();
  }

  handleChord(element) {
    if (this.skipEnding || element.chord === undefined) return;
    const rawName = element.chord[0].name;
    if (isValidChordName(rawName)) {
      this.currentMeasure.text.push(replaceAccidentalWithUtf8Char(rawName));
      this.didNotParseChordInThisMeasure = false;
      this.parsedValidChord = true;
    } else if (isBreakChordName(rawName)) {
      this.currentMeasure.text.push(BREAK_CHORD);
      this.didNotParseChordInThisMeasure = false;
      this.parsedValidChord = true;
    }
  }

  /*
    A new named part is always a hard boundary — musically it can never be a
    continuation of an still-open numbered ending from the previous section,
    even when the token stream says otherwise. abcjs can carry a repeat's
    `inAlternativeEnding` state right through a part boundary: e.g. Bei Mir
    bist du Schön's intro closes its own second ending on the *Chorus's*
    first bar (a bare pickup note before the Chorus's own barline), so the
    "part" element for "Chorus" arrives while the parser still thinks it's
    inside the intro's dropped ending — silently discarding the marker
    (confirmed by rendering the real ABC file: the Chorus badge just never
    appeared). Forcibly closing the ending here, and flushing whatever was
    still pending from it as its own (untagged) measure first, keeps that
    leftover content correctly attributed to the old section instead of
    being mislabeled as the new part's own first bar.
  */
  handlePart(element) {
    this.inAlternativeEnding = false;
    this.flushMeasure();
    // "P: Chorus" (a space after the colon) parses with that leading space
    // still in the title.
    this.currentMeasure.part = element.title.trim();
  }

  handleElement(element) {
    if (element.el_type === "note") this.noteOrRestInMeasure = true;
    if (element.el_type === "part") this.handlePart(element);
    if (element.el_type === "bar") this.handleBar(element);
    this.handleChord(element);
  }

  finish() {
    // An ABC body that ends without a closing barline never reaches the bar
    // flush above, so the final measure's chords are still sitting unpushed
    // in currentMeasure — flush them here or the chord table (and comping)
    // loses the last bar.
    if (!this.skipEnding && this.currentMeasure.text.length > 0) {
      this.chords.push(this.currentMeasure);
    }
    // Prevent returning only % % % % % ....
    return this.parsedValidChord ? this.chords : [];
  }
}

// Reads the chords from an abcjs tune (parsed intermediate format) into a
// list of measures, each `{ text: [chordStrings...], leftRepeat?, ... }`.
//
// By default, measures inside a second-or-later ("[2", "[3", ...) repeat
// ending are dropped: the chord table (and its repeat-boundary highlighting)
// wants the scheme's one canonical pass, not a tag/outro ending's extra bars
// thrown in on top — that's what lets a blues head with a coda still
// simplify down to a clean 12-bar grid. `includeAlternateEndings: true`
// keeps every measure instead, one entry per physical bar exactly as
// printed — buildCompingTune needs that full count, or the comping voice
// runs out of bars (and falls silent) the moment the melody enters such an
// ending, e.g. happy_feet_blues's part C outro.
export function parseChordScheme(song, { includeAlternateEndings = false } = {}) {
  const parser = new ChordSchemeParser(includeAlternateEndings);
  for (const line of song.lines) {
    // Subtitle is added to song.lines, don't break when line has no staff
    if (line.staff === undefined) continue;
    for (const element of line.staff[0].voices[0]) {
      parser.handleElement(element);
    }
  }
  return parser.finish();
}

// Checks if it is a 12-bar blues scheme, if so, and every repeat is
// identical, collapses it down to just the 12 bars.
export function simplifyBlues(chords) {
  return simplifySong(chords, 12);
}

// Checks if `chords` is `count` bars repeated N times with identical
// content each time, and if so collapses it down to just `count` bars.
//
// This intentionally collapses away a later repeat's own part marker too
// (e.g. Happy Feet Blues' A/B/C are the same 12-bar blues played three
// times with different melodies each time — a single 12-bar grid is the
// useful chart, not the same scheme shown three times over just because
// each pass has its own part letter). Since `chords` is always the tune's
// whole displayed scheme (renderChordTable never calls this on a slice), a
// successful collapse always means the *entire* chart is now this one
// repeated block, so whatever part marker(s) survived the collapse — even
// the first repeat's own — no longer distinguish anything and are dropped
// too (e.g. Just a Closer Walk With Thee's Verse/Chorus, which share
// identical chords: collapsing them left a lone "V" badge that looked like
// it labelled only the Verse, when it's really standing in for both).
// Are two measures' chord texts identical, chord for chord?
function chordTextsEqual(first, second) {
  if (first.length !== second.length) {
    return false;
  }
  for (let c = 0; c < first.length; c++) {
    if (first[c] !== second[c]) {
      return false;
    }
  }
  return true;
}

// Is `chords` really just its first `count` measures, repeated `repeats`
// times with identical content each time?
function chordsRepeat(chords, count, repeats) {
  for (let i = 0; i < count; i++) {
    const first = chords[i].text;
    for (let r = 1; r < repeats; r++) {
      const second = chords[i + count * r].text;
      if (!chordTextsEqual(first, second)) {
        return false;
      }
    }
  }
  return true;
}

export function simplifySong(chords, count) {
  if (chords.length === 0 || chords.length % count !== 0) {
    return chords;
  }

  const repeats = chords.length / count;
  if (repeats === 1) return chords;

  if (!chordsRepeat(chords, count, repeats)) {
    return chords;
  }

  // It's a scheme that repeats! Dump any bars, repeats or part markers.
  for (let c = 0; c < count; c++) {
    delete chords[c].leftRepeat;
    delete chords[c].rightRepeat;
    delete chords[c].doubeThinBarLeft;
    delete chords[c].doubeThinBarRight;
    delete chords[c].part;
  }

  return chords.slice(0, count);
}

// Counts how many measures precede the first chord annotation. Used to
// align _abcMeasureIdx (which counts from measure 0 including intros) with
// chord table cell indices (which start at the first chord measure).
export function computeChordOffset(song) {
  if (!song.lines) return 0;
  let measureCount = 0;
  let hasNotesInMeasure = false;
  for (let i = 0; i < song.lines.length; i++) {
    const line = song.lines[i];
    if (!line.staff || !line.staff[0] || !line.staff[0].voices) continue;
    const voice = line.staff[0].voices[0] || [];
    for (let j = 0; j < voice.length; j++) {
      const el = voice[j];
      if (el.chord && el.chord.length > 0 && isValidChordName(el.chord[0].name)) {
        return measureCount;
      }
      if (el.el_type === "note") hasNotesInMeasure = true;
      if (el.el_type === "bar") {
        if (hasNotesInMeasure) measureCount++;
        hasNotesInMeasure = false;
      }
    }
  }
  return 0;
}
