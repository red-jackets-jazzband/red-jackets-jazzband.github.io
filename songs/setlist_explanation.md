# Setlist 2026 — Column Explanation

## Title
The name of the song as used within the band. May differ slightly from the official title (e.g. "Joe Avery" for what is officially "Second Line (Joe Avery Blues)").

---

## Key
Format: `Concert pitch key - Bb instrument key`

The two keys are the same song, written for two groups of players:

- **Left of the dash** — the key for concert-pitch instruments (trombone, sousaphone, baritone sax, piano, guitar)
- **Right of the dash** — the key for Bb-transposing instruments (trumpet, clarinet, tenor sax), which sound a whole tone lower than written

Examples:
| CSV value | Concert key | Bb instruments play |
|-----------|-------------|---------------------|
| `F - G` | F major | G major |
| `Bb - C` | Bb major | C major |
| `Eb - F` | Eb major | F major |
| `Ab - Bb` | Ab major | Bb major |
| `Gm - Am` | G minor | A minor |

---

## Tempo
Describes the physical context of performance, not a BPM marking:

| Value | Meaning |
|-------|---------|
| `Lopen` | Walking — played while the band marches or parades |
| `Staan` | Standing — played while the band stands in place |

---

## Intro
How the song starts. Written in shorthand; refers to what the rhythm section and/or lead voices do before the main melody enters.

Common patterns:

| Value | Meaning |
|-------|---------|
| `Roll-off` | Standard snare drum roll that counts the band in |
| `Roll-off + Trumpet Call` | Roll-off followed by a short trumpet fanfare |
| `Trumpet Call` | Trumpet plays a signal figure alone before the band enters |
| `March` | Rhythm section establishes a marching beat before melody |
| `Dirge` | Slow, funeral-march style intro (used for slow processionals) |
| `Bas intro` | Bass (sousaphone) plays alone before the band enters |
| `Bas+ banjo` | Bass and banjo together open the song |
| `Rhythm intro` | Full rhythm section (drum, bass, banjo) plays an intro pattern |
| `Sax/Bas intro` | Saxophone and bass open together |
| `Vamp op F, inval Trompet` | Band vamps on a chord until the trumpet signals entry |
| `Trompet (allen)` | All players join only on trumpet's cue |

When a specific lick or pattern is written out (e.g. `"Intro blok A drum & banjo, laatste maten Bas"`), it describes which sections of the arrangement carry the intro and who drops out or enters last.

---

## Outro
How the song ends. Shorthand for the ending convention agreed on by the band. Empty means the ending is straightforward (last bar, no special treatment).

Common patterns:

| Value | Meaning |
|-------|---------|
| `blues-end` | Ends with a standard blues turnaround figure |
| `Laatste 4 maten 3x` | Repeat the last 4 bars three times before stopping |
| `Laatste 2 maten 3x=2e pp` | Last 2 bars repeated three times; second repeat played very softly |
| `Laatste maat herhalen` | Repeat the final bar |
| `loopje g, little chromatic ending` | Short connecting lick in G, then a descending chromatic run to finish |
| `chaplin slotnoot es e` | Charlie Chaplin–style ending; last note Eb then E natural |
| `In B, chaplin slotnoot es e` | Same Chaplin ending but transposed to B |
| `Break in g, laatste 4 slow` | Break figure in G, then last 4 bars at half tempo |
| `Hele noot aanhouden, riet loopje` | Hold a whole note, then a reed instrument (clarinet/sax) plays a short tag |
| `Alleen laatste keer laatste maat Am kort a-e-a` | Only on the final repeat: last bar is Am, cut short with notes A-E-A |
| `A7 en d7 3x, blues-end` | A7 and D7 chords repeated three times, then blues ending |
| `egeg(2x), e fis d-intro` | Specific lick used as both outro and the opening intro figure |
| `gacac(2x), g3 naar c lopen` | Outro riff notated in solfège, repeated twice then walk to C |
| `Klarinet aankijken` | Cue the clarinet player by eye for the ending |
| `Laatste 2 maten omhoog, Klarinet aankijken` | Last 2 bars played up an octave; watch the clarinet for the cut-off |
| `kort` | Short ending — do not extend or repeat |

---

## ABC
The filename of the ABC notation file for this song, located in the same directory (`static/songs/`). Opening the file in the website's song viewer renders the sheet music with transposition, chord symbols, and audio playback.

Empty when no ABC file exists for that song.

---

## Songform
The musical form of the main chorus or head, derived from analysis of the ABC file. This tells players how many times through the form equals one chorus and whether there is a bridge or contrasting section.

| Form | Description |
|------|-------------|
| `12b Blues` | 12-bar blues: I(4)–IV(2)–I(2)–V–IV–I, the core form for improvised solos |
| `8b Blues` | 8-bar blues variant: I(2)–IV(2)–I–V–I(2) |
| `16b AB` | 16 bars in two 8-bar halves; one pass through is one chorus |
| `16b Multi-strain` | 16 or more bars with three or more distinct melodic strains (march/ragtime style) |
| `32b AABA` | Classic 32-bar pop/jazz form: A(8)–A(8)–B bridge(8)–A(8) |
| `32b ABAC` | 32-bar form where A alternates with two different contrasting sections |
| `32b AB` | Two distinct 16-bar sections played once each; no bridge |
| `32b Multi-strain` | Four or more distinct sections that do not follow an AABA or AB repeat pattern |
| `Intro-Verse-Chorus` | Song with a clearly separate verse and chorus; the written form uses D.S. or similar markers to structure the repeat |

Empty when no ABC file is available.

---

## Empty rows
Blank rows (all fields empty) are used as visual dividers between sets or medleys.
