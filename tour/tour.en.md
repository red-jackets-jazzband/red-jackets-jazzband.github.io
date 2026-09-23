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

# basics: The basics

## welcome: Welcome to the songs page
setup: showLibrary
target: #libraryTabs
Every tune the Red Jackets have played, still play, or might play next lives here — search it, print it, transpose it, and make it yours. This quick tour walks through finding a song, playing and printing it, transposing it, practising along with a recording, mixing your own sound, and building setlists with comping.

Use **Next** and **Back**, or the **←** and **→** keys. **Esc** gets you out any time, and the **?** button brings the tour back whenever you like.

## search: Find a song
setup: showLibrary
target: #songSearch
interactive: true
Type part of a title and the list narrows as you go. Press **/** anywhere to jump straight to this box, then **↑** **↓** and **Enter** to open a song. In a hurry? The **A–Z** strip beside the list jumps straight to a letter.

## open: Your lead sheet
setup: openDemoSong
target: .rj-sheet-paper
Pick a song and it opens right here — we've cued up *Bourbon Street Parade* for the tour. Chord table first, then the full notation below it. On a phone the sheet takes over the whole screen; a **back** button brings you home to the list.

## instrument: Read your own part
setup: openDemoSong
target: #instrument
interactive: true
No mental transposition required. Pick your instrument and watch the whole sheet transpose to fit: concert pitch, Concert + Roman (concert pitch with a Roman numeral analysis added to the chord table), alto sax, B♭ clarinet or trumpet, tenor sax, trombone (bass clef) or sousaphone (bass clef). The page remembers your choice for next time, and playback always sounds at concert pitch, whatever part is on screen.

## play: Listen along
setup: openDemoSong
target: .sheet-transport
interactive: true
Hearing a tune before you pick up your horn always helps. Hit **Play** and the notes light up on the sheet as they sound; **Stop** ends it. Or just tap the **Spacebar** any time a sheet is open — play, pause, done.

## print: Take it to the gig
setup: openDemoSong
target: #printLink
interactive: true
For a stand or a folder, get it on paper. **Print** turns the chart into a clean page — or choose *Save as PDF* in the dialog to keep a digital copy instead. Setlists get their own print buttons; more on that later.

# adjust: Play it your way
setup: openDemoSong

## key: Find your key
target: #keyStepper
interactive: true
Not every tune sits right in the printed key. The **−** and **+** buttons nudge it by **semitones** — notation and sound move together, so what you play and what you hear always agree. Save it in a personal setlist and the new key travels with that song.

## tempo: Practise at your own pace
target: #tempoStepper
interactive: true
The tempo's in real **beats per minute**, starting from the tune's own marking. Slow it right down to learn a tricky passage, then bring it back up to speed.

## more: Loop a tricky passage
setup: openDrawer
target: #repeatStepper
interactive: true
Repeating a passage by hand breaks your flow. The small arrow at the bottom of the toolbar opens **More controls**, where the **Repeat** stepper plays the tune up to 20 times in a row — skipping the lead-in bar after the first pass, so the loop stays tidy. The comping picker lives here too.

## irealpro: Bring a backing band
target: #iRealPro
For any tune with chords, this button hands the chart to the **iReal Pro** app on your phone, so you've got a backing band in your pocket.

## mp3: Make a practice recording
target: #exportMp3Btn
Renders exactly what you're hearing right now into an **.mp3** — instrument, key, tempo, comping, mixer settings and repeat count, all baked in. A practice track to take home with you.

## fullscreen: Read it up close
target: #sheetFullscreenBtn
Gives the whole screen to the sheet, and — where your browser allows — keeps the screen awake while you read. Chart looking dense? **Pinch to zoom** still works on a phone.

# inspiration: Listen and practise
setup: openDemoSong

## button: Hear other versions
target: #inspirationLink
interactive: true
Want to hear how other bands played this tune? When a song has reference recordings, an **Inspiration** button shows up — open it for a floating player right alongside your sheet.

## panel: Keep listening while you browse
setup: openInspiration
target: #inspirationPanel
interactive: true
The player keeps going while you browse other songs — it only closes when you close it. Drag its **header** to move it around, its **left edge** to resize it, or use the resize button to jump between sizes.

## tabs: Compare recordings
setup: openInspiration
target: #inspirationTabs
interactive: true
This song has more than one recording — switch between the tabs to compare them. Only one plays at a time.

## loop: Loop a phrase
setup: openInspiration
target: #inspirationLoopBar
interactive: true
Get a tricky phrase to loop on its own, instead of scrubbing back by hand over and over. Play the video, press **A** where the phrase starts and **B** where it ends, and it repeats endlessly. Drag the **A** and **B** handles on the timeline to fine-tune, and **✕** clears them.

## zoom: Place your loop precisely
setup: openInspiration
target: .inspiration-loop-overview-row
interactive: true
The strip above is the whole recording. Use the **+** and **−** buttons, or drag the highlighted window or its edges, to zoom the timeline below — makes placing your **A** and **B** markers far more precise.

## speed: Slow it down
setup: openInspiration
target: #inspirationLoopSpeed
interactive: true
Step the **speed** down — or up — to learn a fast line at your own pace, then play along.

## share: Share your loop
setup: openInspiration
target: #inspirationShareBtn
interactive: true
Copies a link to this song **and** your A–B loop. Send it to a bandmate and they land on the same sheet, video already set to your phrase.

# mixer: Balance your sound
setup: openDemoSong

## open: Shape your own mix
setup: openMixer
target: #mixerPanel
The **Mixer** is your mixing desk for everything you hear — a small panel under its button on desktop, a sheet sliding up from the bottom on a phone.

## accompaniment: Bring in bass and chords
setup: openMixer
target: #mixerSectionAccompaniment
interactive: true
Give the tune a backing band of its own: the **auto-accompaniment** plays a bass line and chords straight off the chord symbols. Both start **muted**, so nothing changes until you switch them on — each gets a **mute** button, a **volume** fader and a **voice** picker, and the **accompaniment pattern** picker sets the style.

## voices: Mix every part separately
setup: openMixer
target: #mixerVoicesSection
interactive: true
Each melody line in the song gets its own mute, volume and instrument — a tune with a trumpet and a sousaphone shows both, side by side. Set them once and your choices carry over to every other song with a voice of the same name.

## extras: Dial in the feel
setup: openMixer
target: #mixerStripSwing
interactive: true
Loosen up straight eighth notes with the **swing** fader, switch on a click with the **drum** metronome, or bump up the sound quality with the **wave** button.

# setlists: Setlists and printing

## shelf: Browse setlists
setup: showSetlists
target: #songList
The **Setlists** tab lists the band's own setlists — read-only — and **Yours** underneath. Yours live in this browser only, ready whenever you need them.

## new: Make your own setlist
setup: showSetlists
target: .rj-library-new-setlist-btn
**New setlist** starts from scratch, from a copy of any existing setlist (a **remix**), or from a **.txt** file you upload. Let's build one from scratch, step by step.

## create: Start from scratch
setup: createDemoSetlist
target: #setlistTitleRow
interactive: true
Starting from *Empty* opens a blank setlist right away, ready for songs — we've called this one *Tour setlist*. Double-click a name (or its pencil) any time to rename yours.

## addsong: Add a song
setup: createDemoSetlist
target: .rj-library-add-song-field
interactive: true
Search a title in the box at the foot of the list, then press **Enter** — or click a match — to add it.

## addsong2: Add another
setup: createDemoSetlist, addDemoSong1
target: .rj-library-add-song-field
interactive: true
Add a second song the same way. The list grows downward, one row per song, ready to put in order.

## reorder: Set the running order
setup: createDemoSetlist, addDemoSong1, addDemoSong2
target: #songList
interactive: true
Drag a song's **⋮⋮** handle up or down to move it. With a row focused, **Alt** + **↑** **↓** nudges it one slot at a time from the keyboard instead.

## break: Split into sets
setup: createDemoSetlist, addDemoSong1, addDemoSong2
target: .setlist-divider-input, .rj-library-add-break
interactive: true
**Add a set break** starts a new set — handy for splitting a gig into Set 1, Set 2 and so on. Type a label, or leave it blank for an automatic "Set 2".

## open: Run through the set
setup: openDemoSetlist
target: #openSetlistTools
Opening a setlist lines its songs up in the sidebar, split into **sets**. Click one to open it in the same interactive sheet, or use **↑** **↓** (or swipe on a phone) to step through the whole list. **Listen** opens the setlist's songs on YouTube.

## print: Print for the gig
setup: openDemoSetlist
target: .rj-library-print-group
interactive: true
- **Setlist**: a big numbered list of titles to put on stage.
- **Chordbook**: every song's title and chord grid.
- **Songbook**: every song with its chords and full notation.

## exports: Take a setlist anywhere
setup: createDemoSetlist, addDemoSong1, addDemoSong2
target: #setlistExportBtn
A personal setlist can also be exported as a **.txt** file and imported again on another device — the setlist equivalent of the Print, MP3 and iReal Pro exports you already know from a single song.

# comping: Comping
setup: openDemoSong

## pick: Add your own accompaniment
setup: openDrawer
target: #compingSlot
interactive: true
Comping is a chord accompaniment written right out as a second staff under the melody. Pick a **pattern** from the list — Charleston, clave, walking steps and more — and hear it come alive.

## notation: Read the colours
setup: openDrawer, compingOn
target: #notation
Each hit is a three-note chord, and the colour tells you each note's role: **black** is the root, **gold** the third, **magenta** the fifth. The three lines move smoothly from chord to chord, so your eye never loses the thread.

## mixer: Blend comping into the mix
setup: openDrawer, compingOn, openMixer
target: #mixerVoicesSection
interactive: true
With comping on, it joins the mixer as its own **Comping** voice — mute it, turn it up, or hand it a different instrument.

## done: That's the tour
setup: showLibrary
target: #tourBtn
That's the tour! Replay it any time with this **?** button, and pick another language from the tour's corner whenever you like.
