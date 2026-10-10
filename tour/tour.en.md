# ui
next: Next
back: Back
skip: Maybe later
done: Done
progress: {chapter} · {n}/{total}
chapters: Chapters
language: Language
close: Close the tour
loading: Loading…
helpLabel: Take the tour
chapterDone: {chapter}: done ✓
chapterNext: Next up: **{next}**.
topicBasics: Find a song, open its lead sheet, play it and print it.
topicAdjust: Change the key and tempo, loop a passage, export an MP3.
topicInspiration: Listen to recordings alongside the sheet and loop a phrase.
topicMixer: Set the level of bass, chords and each part.
topicSetlists: Build, order and print setlists for a gig.
topicComping: Add a written-out accompaniment staff.
topicLayers: Show extra help on the sheet, like named progressions and fingerings.
topicsIntro: Seven short stops. Tap one to jump there:
railComping: Comp
railSetlists: Sets
railMixer: Mix
railInspiration: Play along
railAdjust: Your way
railBasics: Find it
railLayers: Layers
nextChapter: On to the next
start: Show me around

# basics: The basics

## welcome: Welcome to the songs page
setup: showLibrary
Every tune the Red Jackets play lives here. Find one, play it in your key, print it for the stand.

> Lost? The `fa-circle-question` button restarts this tour. Arrow keys step, `key:Esc` closes.

## search: Find a song
setup: showLibrary
target: #songSearch
interactive: true
Start typing a title and the list narrows as you go. Pick a tune to open its lead sheet. The letters beside the list jump straight to A, B, C…

> No mouse needed: `key:↑` `key:↓` and `key:Enter` open a song.

## open: Your lead sheet
setup: openDemoSong
target: .rj-sheet-paper
Picking a song opens it here. For the tour we've opened *Bill Bailey*. The chord table comes first, with the full notation below it.

## back: Back to the list
setup: openDemoSong
target: #sheetBackBtn
On a phone the sheet fills the whole screen, so the list is out of sight. The `tab:‹ Songs` button at the top takes you back to it.

## form: Follow the form
setup: openDemoSong
target: .songForm
The arrows under the chord table show the **form**: the order the parts are played. Same colour, same part. *2x* means repeated. A trailing `...` (as in `A` `B` `...` on the solos) repeats for as many choruses as there are soloists.

## instrument: Read your own part
setup: openDemoSong
target: #instrument
interactive: true
Pick your instrument and the sheet is transposed for it: concert, Concert + Roman numerals, alto sax, B♭ clarinet or trumpet, tenor sax, trombone or sousaphone (bass clef). Playback always sounds at concert pitch.

## play: Listen along
setup: openDemoSong
target: .sheet-transport
interactive: true
It helps to hear a tune before you play it. **Play** (`fa-play`) starts it and the notes light up on the sheet as they sound. **Stop** (`fa-stop`) ends it.

> The `key:Spacebar` also plays and pauses while a sheet is open.

## print: Take it to the gig
setup: openDemoSong
target: #printLink
interactive: true
**Print** (`fa-print`) turns the chart into a clean page for a stand or a folder. In the print dialog you can choose *Save as PDF* if you want a digital copy instead. Setlists have their own print buttons, which come later in the tour.

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
Restarting a passage by hand gets tedious. The small arrow at the bottom of the toolbar (`fa-angles-right`) opens **More controls**, where the **Repeat** stepper plays the tune up to 20 times in a row. After the first pass it skips the lead-in bar. The comping picker is in here too.

## irealpro: Bring a backing band
target: #iRealPro
For tunes with chords, this button sends the chart to the **iReal Pro** app on your phone, which can play it back with a backing band.

## mp3: Make a practice recording
target: #exportMp3Btn
`fa-file-audio` Renders what you're hearing right now into an **.mp3** file. Instrument, key, tempo, comping, mixer settings and repeat count are all included, so you can use it as a practice track.

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
The player keeps going while you look at other songs, and only closes when you close it. Drag its **header** to move it and its **left edge** to resize it, or use the resize button (`fa-up-right-and-down-left-from-center`) to step between sizes.

## tabs: Compare recordings
setup: openInspiration
target: #inspirationTabs
interactive: true
This song has more than one recording. Use the tabs to switch between them. Only one plays at a time.

## loop: Loop a phrase
setup: openInspiration
target: #inspirationLoopBar
interactive: true
Instead of rewinding by hand, you can let a phrase repeat on its own. Play the video, press `btn:A` where the phrase starts and `btn:B` where it ends, and it loops. Drag the **A** and **B** handles on the timeline to adjust them, and `fa-xmark` clears them.

## zoom: Place your loop precisely
setup: openInspiration
target: .inspiration-loop-overview-row
interactive: true
The strip above shows the whole recording. Use the `fa-magnifying-glass-plus` and `fa-magnifying-glass-minus` buttons, or drag the highlighted window or its edges, to zoom the timeline below. That makes it easier to put the **A** and **B** markers in the right place.

## speed: Slow it down
setup: openInspiration
target: #inspirationLoopSpeed
interactive: true
Lower the **speed** (or raise it) to learn a fast line at a pace you can manage, then play along.

## share: Share your loop
setup: openInspiration
target: #inspirationShareBtn
interactive: true
`fa-link` Copies a link to this song **and** your A–B loop. If you send it to a bandmate, they get the same sheet with the video already set to your phrase.

# mixer: Set the levels

## open: Make your own mix
setup: openMixer
target: #mixerPanel
The **Mixer** (`fa-sliders`) controls the level of everything you hear. On desktop it's a small panel under its button, and on a phone it slides up from the bottom.

## accompaniment: Add bass and chords
setup: openMixer
target: #mixerSectionAccompaniment
interactive: true
The **auto-accompaniment** plays a bass line and chords based on the chord symbols. Both start **muted**, so nothing changes until you switch them on. Each has a **mute** button (`fa-volume-high`), a **volume** fader and a **voice** picker, and the **accompaniment pattern** picker sets the style.

## voices: Mix each part separately
setup: openMixer
target: #mixerVoicesSection
interactive: true
Each melody line in the song gets its own mute, volume and instrument. A tune with a trumpet and a sousaphone shows both side by side. Your settings are kept for every other song that has a voice with the same name.

## extras: Adjust the feel
setup: openMixer
target: #mixerStripSwing
interactive: true
The **swing** fader loosens up straight eighth notes. The **drum** button (`fa-drum`) switches on a metronome click, and the **wave** button (`fa-wave-square`) raises the sound quality.

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
Choosing *Empty* opens a blank setlist, ready for songs. We've called this one *Tour setlist*. You can rename yours at any time by clicking the underlined name.

## addsong: Add a song
setup: createDemoSetlist
target: .rj-library-add-song-field
interactive: true
Search for a title in the `fa-plus` **Add song** row at the bottom of the list, then press `key:Enter` or click a match to add it.

## addsong2: Add another
setup: createDemoSetlist, addDemoSong1
target: .rj-library-add-song-field
interactive: true
Add a second song the same way. The field stays in place, so you can keep typing titles. The list grows downward, with one row per song.

## reorder: Set the running order
setup: createDemoSetlist, addDemoSong1, addDemoSong2
target: #songList
interactive: true
Drag a song's `fa-grip-vertical` handle up or down to move it where you want it.

> From the keyboard, `key:Alt` + `key:↑` `key:↓` moves a focused row one place.

## break: Split into sets
setup: createDemoSetlist, addDemoSong1, addDemoSong2
target: .setlist-divider-input, .rj-library-add-break
interactive: true
`btn:New set` starts a new set, for example to split a gig into Set 1 and Set 2. Each set gets its own box and its own `fa-plus` **Add song to set 2** row. Click a set's name to type a label, or leave it blank to get an automatic "Set 2".

## split: Split a set in two
setup: createDemoSetlist, addDemoSong1, addDemoSong2, unsplitDemoSetlist, revealDemoSplit
target: .setlist-split-btn
interactive: true
Already have a list and want to cut it in two? Hover between two songs and press the `fa-scissors` button. A new set starts there, with every song below the cut moving into it.

## merge: Join sets again
setup: createDemoSetlist, addDemoSong1, addDemoSong2, splitDemoSetlist
target: .setlist-set-merge
interactive: true
Changed your mind? The `fa-arrows-up-to-line` button on a set's top edge merges it into the set above. Its songs are kept, only the heading goes.

## note: Add a note for the band
setup: createDemoSetlist, addDemoSong1, addDemoSong2, revealDemoNote
target: .setlist-song-note-add
interactive: true
Click `btn:+ note` under a song to write something down for the gig, such as who takes the solo, a key change or a reminder. It appears on the printed setlist and stage list, but not on the song's own sheet.

## open: Play through the set
setup: openDemoSetlist
target: #songList
Now we've opened one of the band's own setlists. Open any setlist and its songs appear in order in the sidebar, split into **sets**. Click a song to open it in the same interactive sheet, or use `key:↑` `key:↓` (or swipe on a phone) to step through the list.

## print: Print for the gig
setup: openDemoSetlist
target: .rj-library-print-group
interactive: true
- **Setlist**: a large numbered list of titles to put on stage.
- **Chordbook**: every song's title and chord grid.
- **Songbook**: every song with its chords and full notation.

## listen: Listen to the whole set
setup: openDemoSetlist
target: #listenYoutubeBtn
The `fa-youtube` button under **Listen** opens every song in the setlist that has a YouTube link, one after the other, so you can hear the whole set before the gig. It's greyed out on this setlist because none of its songs have a link.

## exports: Take a setlist elsewhere
setup: createDemoSetlist, addDemoSong1, addDemoSong2
target: #setlistExportBtn
A personal setlist can be exported with the `fa-file-arrow-down` button as a **.txt** file and imported again on another device. It's the setlist version of the Print, MP3 and iReal Pro exports you've seen for a single song.

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
Each hit is a three-note chord, and the colour shows the role of each note: **black** is the root, `gold:gold` the third and `magenta:magenta` the fifth. The three lines move smoothly from chord to chord, which makes them easier to follow.

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

# layers: Layers
setup: openDemoSong

## open: Extra help on the sheet
setup: openDemoSong, openLayers
target: #layersPanel
The **Layers** tab on the right edge opens a panel of extras you can draw onto the lead sheet. Each one is a switch. With everything off the sheet is exactly the chart you know, and anything you switch on prints with it.

## progressions: Spot the named progressions
setup: openDemoSong, openLayers, layerProgressionsOn
target: .rj-layer-row[data-layer="progressions"]
interactive: true
Traditional jazz is built from a few stock chord patterns with names, like the **Salty Dog**, the **Four-Leaf** or the **Sunshine**. This layer finds them in the chords and labels them. Switch it on and off to compare.

## sheet: See them on the chart
setup: openDemoSong, layerProgressionsOn
target: .rj-layer-prog-band, #notation
Each progression gets a coloured bar behind its chords with its name in it, and the same progression always gets the same colour. Look at the last line of Bill Bailey for a Salty Dog.

## fingerings: Fingerings for brass
setup: openDemoSong, openLayers
target: .rj-layer-row[data-layer="fingerings"]
interactive: true
For **Trumpet**, **Trombone** and **Sousaphone** this writes the valve combination or slide position under every note. It's greyed out for other instruments, so pick a brass instrument under **Instrument** first.

## remember: Your choices stick
setup: openDemoSong, openLayers
target: #layersResetBtn
The layers you switch on are remembered on this device, so your next visit looks the same. **Reset all** switches every layer off at once. The panel itself always starts closed.

## done: That's the tour
setup: showLibrary
target: #tourBtn
That's the tour. The `fa-circle-question` button brings it back, and the menu at the top of the card changes language.

