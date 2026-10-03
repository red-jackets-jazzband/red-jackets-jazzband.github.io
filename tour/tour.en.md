# ui
next: Next
back: Back
skip: Skip tour
done: Done
progress: {chapter} · {n}/{total}
chapters: Chapters
language: Language
close: Close the tour
loading: Loading…
helpLabel: Take the tour
chapterDone: {chapter}: done ✓
chapterNext: Next up: **{next}**. Press **Next** when you're ready.
topicBasics: Find a song, open its lead sheet, play it and print it.
topicAdjust: Change the key and tempo, loop a passage, export an MP3.
topicInspiration: Listen to recordings alongside the sheet and loop a phrase.
topicMixer: Set the level of bass, chords and each part.
topicSetlists: Build, order and print setlists for a gig.
topicComping: Add a written-out accompaniment staff.
topicsIntro: The tour has six topics, taken one at a time. Each one is ticked off when you finish it, and the dots at the bottom show where you are. You can click a topic to jump straight to it:

# basics: The basics

## welcome: Welcome to the songs page
setup: showLibrary
This is where the tunes the Red Jackets play (or have played, or might play) are kept. You can search them, print them and transpose them.

Use **Next** and **Back**, or the **←** and **→** keys. **Esc** closes the tour at any point, and the **?** button starts it again.

## search: Find a song
setup: showLibrary
target: #songSearch
interactive: true
Type part of a title and the list gets shorter as you go. Click this box, then use **↑** **↓** and **Enter** to open a song. The **A–Z** strip beside the list jumps to a letter.

## open: Your lead sheet
setup: openDemoSong
target: .rj-sheet-paper
Picking a song opens it here. For the tour we've opened *Bourbon Street Parade*. The chord table comes first, with the full notation below it. On a phone the sheet fills the screen, and the **‹ Songs** button at the top takes you back to the list.

## instrument: Read your own part
setup: openDemoSong
target: #instrument
interactive: true
Pick your instrument and the whole sheet is transposed for it. The choices are concert pitch, Concert + Roman (concert pitch with Roman numerals added to the chord table), alto sax, B♭ clarinet or trumpet, tenor sax, trombone (bass clef) or sousaphone (bass clef). The page remembers your choice. Playback always sounds at concert pitch, whichever part is on screen.

## play: Listen along
setup: openDemoSong
target: .sheet-transport
interactive: true
It helps to hear a tune before you play it. **Play** starts it and the notes light up on the sheet as they sound. **Stop** ends it. While a sheet is open, the **Spacebar** also toggles play and pause.

## print: Take it to the gig
setup: openDemoSong
target: #printLink
interactive: true
**Print** turns the chart into a clean page for a stand or a folder. In the print dialog you can choose *Save as PDF* if you want a digital copy instead. Setlists have their own print buttons, which come later in the tour.

# adjust: Play it your way
setup: openDemoSong

## key: Change the key
target: #keyStepper
interactive: true
A tune doesn't always sit well in the printed key. The **−** and **+** buttons shift it by **semitones**. The notation and the sound change together, so they always match. If you save the song in a personal setlist, the new key stays with it.

## tempo: Practise at your own pace
target: #tempoStepper
interactive: true
The tempo is in **beats per minute**, starting from the tune's own marking. Slow it down to learn a tricky passage, then bring it back up.

## more: Loop a passage
setup: openDrawer
target: #repeatStepper
interactive: true
Restarting a passage by hand gets tedious. The small arrow at the bottom of the toolbar opens **More controls**, where the **Repeat** stepper plays the tune up to 20 times in a row. After the first pass it skips the lead-in bar. The comping picker is in here too.

## irealpro: Bring a backing band
target: #iRealPro
For tunes with chords, this button sends the chart to the **iReal Pro** app on your phone, which can play it back with a backing band.

## mp3: Make a practice recording
target: #exportMp3Btn
Renders what you're hearing right now into an **.mp3** file. Instrument, key, tempo, comping, mixer settings and repeat count are all included, so you can use it as a practice track.

## fullscreen: Read it up close
target: #sheetFullscreenBtn
Gives the whole screen to the sheet and, if your browser allows it, keeps the screen awake while you read. Pinch to zoom still works on a phone.

# inspiration: Listen and practise
setup: openDemoSong

## button: Hear other versions
target: #inspirationLink
interactive: true
If a song has reference recordings, an **Inspiration** button appears. It opens a floating player next to your sheet, so you can hear how other bands played the tune.

## panel: Keep listening while you browse
setup: openInspiration
target: #inspirationPanel
interactive: true
The player keeps going while you look at other songs, and only closes when you close it. Drag its **header** to move it and its **left edge** to resize it, or use the resize button to step between sizes.

## tabs: Compare recordings
setup: openInspiration
target: #inspirationTabs
interactive: true
This song has more than one recording. Use the tabs to switch between them. Only one plays at a time.

## loop: Loop a phrase
setup: openInspiration
target: #inspirationLoopBar
interactive: true
Instead of rewinding by hand, you can let a phrase repeat on its own. Play the video, press **A** where the phrase starts and **B** where it ends, and it loops. Drag the **A** and **B** handles on the timeline to adjust them, and **✕** clears them.

## zoom: Place your loop precisely
setup: openInspiration
target: .inspiration-loop-overview-row
interactive: true
The strip above shows the whole recording. Use the **+** and **−** buttons, or drag the highlighted window or its edges, to zoom the timeline below. That makes it easier to put the **A** and **B** markers in the right place.

## speed: Slow it down
setup: openInspiration
target: #inspirationLoopSpeed
interactive: true
Lower the **speed** (or raise it) to learn a fast line at a pace you can manage, then play along.

## share: Share your loop
setup: openInspiration
target: #inspirationShareBtn
interactive: true
Copies a link to this song **and** your A–B loop. If you send it to a bandmate, they get the same sheet with the video already set to your phrase.

# mixer: Set the levels

## open: Make your own mix
setup: openMixer
target: #mixerPanel
The **Mixer** controls the level of everything you hear. On desktop it's a small panel under its button, and on a phone it slides up from the bottom.

## accompaniment: Add bass and chords
setup: openMixer
target: #mixerSectionAccompaniment
interactive: true
The **auto-accompaniment** plays a bass line and chords based on the chord symbols. Both start **muted**, so nothing changes until you switch them on. Each has a **mute** button, a **volume** fader and a **voice** picker, and the **accompaniment pattern** picker sets the style.

## voices: Mix each part separately
setup: openMixer
target: #mixerVoicesSection
interactive: true
Each melody line in the song gets its own mute, volume and instrument. A tune with a trumpet and a sousaphone shows both side by side. Your settings are kept for every other song that has a voice with the same name.

## extras: Adjust the feel
setup: openMixer
target: #mixerStripSwing
interactive: true
The **swing** fader loosens up straight eighth notes. The **drum** button switches on a metronome click, and the **wave** button raises the sound quality.

# setlists: Setlists and printing

## shelf: Browse setlists
setup: showSetlists
target: #songList
The **Setlists** tab lists the band's own setlists, which are read-only, and **Yours** underneath. Yours are stored in this browser only.

## new: Make your own setlist
setup: showSetlists
target: .rj-library-new-setlist-btn
**New setlist** can start from scratch, from a copy of an existing setlist (a **remix**), or from a **.txt** file you upload. We'll build one from scratch, a step at a time.

## create: Start from scratch
setup: createDemoSetlist
target: #setlistTitleRow
interactive: true
Choosing *Empty* opens a blank setlist, ready for songs. We've called this one *Tour setlist*. You can rename yours at any time by double-clicking the name or its pencil.

## addsong: Add a song
setup: createDemoSetlist
target: .rj-library-add-song-field
interactive: true
Search for a title in the box at the bottom of the list, then press **Enter** or click a match to add it.

## addsong2: Add another
setup: createDemoSetlist, addDemoSong1
target: .rj-library-add-song-field
interactive: true
Add a second song the same way. The list grows downward, with one row per song.

## reorder: Set the running order
setup: createDemoSetlist, addDemoSong1, addDemoSong2
target: #songList
interactive: true
Drag a song's **⋮⋮** handle up or down to move it. With a row focused, **Alt** + **↑** **↓** moves it one place at a time from the keyboard.

## break: Split into sets
setup: createDemoSetlist, addDemoSong1, addDemoSong2
target: .setlist-divider-input, .rj-library-add-break
interactive: true
**Add a set break** starts a new set, for example to split a gig into Set 1 and Set 2. Type a label, or leave it blank to get an automatic "Set 2".

## note: Add a note for the band
setup: createDemoSetlist, addDemoSong1, addDemoSong2, revealDemoNote
target: .setlist-song-note-add
interactive: true
Click **+ note** under a song to write something down for the gig, such as who takes the solo, a key change or a reminder. It appears on the printed setlist and stage list, but not on the song's own sheet.

## open: Play through the set
setup: openDemoSetlist
target: #openSetlistTools
Opening a setlist puts its songs in order in the sidebar, split into **sets**. Click a song to open it in the same interactive sheet, or use **↑** **↓** (or swipe on a phone) to step through the list. **Listen** opens the setlist's songs on YouTube.

## print: Print for the gig
setup: openDemoSetlist
target: .rj-library-print-group
interactive: true
- **Setlist**: a large numbered list of titles to put on stage.
- **Chordbook**: every song's title and chord grid.
- **Songbook**: every song with its chords and full notation.

## exports: Take a setlist elsewhere
setup: createDemoSetlist, addDemoSong1, addDemoSong2
target: #setlistExportBtn
A personal setlist can be exported as a **.txt** file and imported again on another device. It's the setlist version of the Print, MP3 and iReal Pro exports you've seen for a single song.

# comping: Comping
setup: openDemoSong

## pick: Add your own accompaniment
setup: openDrawer, compingUnsplit
target: #compingSlot
interactive: true
Comping is a chord accompaniment written out as a second staff under the melody. Pick a **pattern** from the list, such as Charleston, clave or walking steps, and listen to it.

## notation: Read the colours
setup: openDrawer, compingOn, compingUnsplit
target: #notation
Each hit is a three-note chord, and the colour shows the role of each note: **black** is the root, **gold** the third and **magenta** the fifth. The three lines move smoothly from chord to chord, which makes them easier to follow.

## split: Split it into voices
setup: openDrawer, compingOn, compingUnsplit
target: #compingSplitBtn
interactive: true
The **Split** button next to the pattern list turns the single three-note staff into one staff per chord tone, so the root, the third and the fifth each get their own line. That's useful when each player in the band takes one note of the chord.

## parts: Choose which voices to show
setup: openDrawer, compingOn, compingSplit
target: #compingParts
interactive: true
The **R**, **3** and **5** buttons choose which of the split staves are drawn. You could show only the third and the fifth, for example, and print just those. At least one always stays on.

## mixer: Add comping to the mix
setup: openDrawer, compingOn, compingSplit, openMixer
target: #mixerVoicesSection
interactive: true
With comping on, it appears in the mixer as its own **Comping** voice. You can mute it, change its level or give it another instrument. If you split it, each chord tone gets its own strip (**Comping R**, **Comping 3**, **Comping 5**), so you can mute the third or give the fifth a different instrument.

## done: That's the tour
setup: showLibrary
target: #tourBtn
That's the end of the tour. You can run it again with this **?** button, and the tour's corner lets you pick another language.
