const VALID_CHORD =
  /^[A-Ga-g]([#♯b♭])?(maj|m|min|dim|aug|sus|add)?(Ø)?(\d)?([#♯b♭])?(\d)?(\/[A-Ga-g]([#♯b♭])?(\d)?)?$/;

// Replaces the sharp and flat signs with the official unicode chars.
export function replaceAccidentalWithUtf8Char(note) {
  return note.replace("b ", "♭").replace("#", "♯").replace("dim", "Ø");
}

// Reads the chords from an abcjs tune (parsed intermediate format) into a
// list of measures, each `{ text: [chordStrings...], leftRepeat?, ... }`.
export function parseChordScheme(song) {
  let chords = [];
  let currentMeasure = { text: [] };

  let parsedValidChord = false;
  let didNotParseChordInThisMeasure = true;
  let inAlternativeEnding = false;
  let noteOrRestInMeasure = false;

  for (let i = 0; i < song.lines.length; i += 1) {
    // Subtitle is added to song.lines, don't break when line has no staff
    if (song.lines[i].staff !== undefined) {
      const line = song.lines[i].staff[0].voices[0];

      for (let lineIdx = 0; lineIdx < line.length; lineIdx += 1) {
        const element = line[lineIdx];

        if (element.el_type === "note") {
          noteOrRestInMeasure = true;
        }

        if (element.el_type === "bar") {
          if (element.type === "bar_left_repeat") {
            currentMeasure.leftRepeat = true;
          } else if (element.type === "bar_right_repeat") {
            currentMeasure.rightRepeat = true;
          } else if (element.type === "bar_thin_thin") {
            if (noteOrRestInMeasure && parsedValidChord) {
              currentMeasure.doubeThinBarRight = true;
            } else {
              currentMeasure.doubeThinBarLeft = true;
            }
          }

          if (element.startEnding !== undefined) {
            if (element.startEnding > 1) {
              inAlternativeEnding = true;
            }
          } else if (element.endEnding !== undefined && inAlternativeEnding) {
            inAlternativeEnding = false;
          }

          if (!inAlternativeEnding) {
            if (didNotParseChordInThisMeasure && parsedValidChord && noteOrRestInMeasure) {
              currentMeasure.text.push(" % ");
            }

            if (currentMeasure.text.length > 0) {
              currentMeasure.text = currentMeasure.text.slice(0);

              chords.push(currentMeasure);
              currentMeasure = { text: [] };
              noteOrRestInMeasure = false;
            }

            didNotParseChordInThisMeasure = true;
          }
        }

        if (!inAlternativeEnding) {
          if (element.chord !== undefined && VALID_CHORD.test(element.chord[0].name)) {
            const chord = replaceAccidentalWithUtf8Char(element.chord[0].name);
            currentMeasure.text.push(chord);
            didNotParseChordInThisMeasure = false;
            parsedValidChord = true;
          }
        }
      }
    }
  }

  // An ABC body that ends without a closing barline never reaches the bar
  // flush above, so the final measure's chords are still sitting unpushed in
  // currentMeasure — flush them here or the chord table (and comping) loses
  // the last bar.
  if (!inAlternativeEnding && currentMeasure.text.length > 0) {
    chords.push(currentMeasure);
  }

  // Prevent returning only % % % % % ....
  if (!parsedValidChord) {
    chords = [];
  }
  return chords;
}

// Checks if it is a 12-bar blues scheme, if so, and every repeat is
// identical, collapses it down to just the 12 bars.
export function simplifyBlues(chords) {
  return simplifySong(chords, 12);
}

// Checks if `chords` is `count` bars repeated N times with identical
// content each time, and if so collapses it down to just `count` bars.
export function simplifySong(chords, count) {
  if (chords.length === 0 || chords.length % count !== 0) {
    return chords;
  }

  const repeats = chords.length / count;

  // Check each measure in the scheme
  for (let i = 0; i < count; i++) {
    const first = chords[i].text;

    for (let r = 1; r < repeats; r++) {
      const second = chords[i + count * r].text;

      // Are there the same amount of chords in the measure?
      if (first.length !== second.length) {
        return chords;
      }

      for (let c = 0; c < first.length; c++) {
        if (first[c] !== second[c]) {
          return chords;
        }
      }
    }
  }

  // It's a scheme that repeats! Dump any bars or repeats.
  for (let c = 0; c < count; c++) {
    delete chords[c].leftRepeat;
    delete chords[c].rightRepeat;
    delete chords[c].doubeThinBarLeft;
    delete chords[c].doubeThinBarRight;
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
      if (el.chord && el.chord.length > 0 && VALID_CHORD.test(el.chord[0].name)) {
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
