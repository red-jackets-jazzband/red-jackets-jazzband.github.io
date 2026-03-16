"use strict";

var current_song = null;
var transpose_halfsteps = 0;

/* Fix for IE that does not implement forEach
   see https://tips.tutorialhorizon.com/2017/01/06/object-doesnt-support-property-or-method-foreach/
*/
(function() {
  if (typeof NodeList.prototype.forEach === "function") return false;
  NodeList.prototype.forEach = Array.prototype.forEach;
})();

function renderSong(path) {
  document.getElementById("transpose").value = 0;
  audioPlayer.melodOff = false;
  readFile(path, renderAbcFile);
}

function rerenderFile() {
  if (window.current_song !== undefined) {
    renderAbcFile(window.current_song);
  }
}

function change_cleff_for_instrument(instrument, text) {
  switch (instrument) {
    case "sousaphone":
    case "trombone":
      text = text.replace(/(K:\s*\w+)/g, "$1 clef=bass middle=D");
      break;
    default:
      text = text.replace(/clef=bass\ middle=D/g, "");
      break;
  }

  return text;
}

function offset_for_instrument(instrument) {
  var steps = 0;

  switch (instrument) {
    case "alto_saxophone":
      steps = 9;
      break;
    case "tenor_saxophone":
    case "sousaphone":
    case "trumpet":
    case "clarinet_bb":
      steps = 2;
      break;
    default:
      steps = 0;
      break;
  }

  return steps;
}

/*
   Funcion: renderAbcFile
   Render a song from a abc text
   Parameters:
       text - String containing (valid) abc file
*/
function renderAbcFile(text, notationElt, chordTableElt, songTitleElt, titlePrefix, add_link) {

  notationElt = (typeof notationElt !== 'undefined') ?  notationElt : "notation";
  chordTableElt = (typeof chordTableElt !== 'undefined') ?  chordTableElt : "chordtable";
  songTitleElt = (typeof songTitleElt !== 'undefined') ?  songTitleElt : "songtitle";
  titlePrefix = (typeof titlePrefix !== 'undefined') ?  titlePrefix : "";
  add_link = (typeof add_link !== 'undefined') ?  add_link : true;

  var transpose_steps = document.getElementById("transpose");
  transpose_steps = (transpose_steps !== null) ? transpose_steps.value : 0;

  // Don't use valueAsNumber to let IE users also enjoy transposing
  transpose_steps = Number(transpose_steps);
  var instrumentSelect = document.getElementById("instrument");
  document.getElementById("instrumentText").innerHTML = instrumentSelect.options[instrumentSelect.selectedIndex].text.toLowerCase();

  // Check if there are voice definitions with instrument-related attributes
  const hasInstrumentVoices = text.match(/^V:\d+.*(clef=|transpose=|name=)/gm);

  if (!hasInstrumentVoices) {
    text = change_cleff_for_instrument(instrumentSelect.value, text);
    transpose_steps += offset_for_instrument(instrumentSelect.value);
  }

  window.current_song = text;
  var song = string_to_abc_tune(text, transpose_steps);
  var chords = parse_chord_scheme(song);
  var displayChords = (instrumentSelect.value === 'concert_+_roman')
    ? convertChordsToRoman(chords, song)
    : chords;
  audioPlayer.chordOffset = computeChordOffset(song);

  if (add_link) {
    add_inspiration_link(song.metaText.url);
    add_irealpro_link(song, chords);
  }

  var abcParams = {
    visualTranspose: transpose_steps,
    responsive: "resize",
    staffwidth:1000,
    paddingTop: 0,
    paddingBottom: 0,
    add_classes: true,
    jazzchords:true,
    oneSvgPerLine:false,
    format: {
      annotationfont: "MuseJazzText italic",
      composerfont: "MuseJazzText",
      footerfont: "MuseJazzText",
      gchordfont: "MuseJazzText",
      headerfont: "MuseJazzText",
      historyfont: "MuseJazzText",
      infofont: "MuseJazzText",
      measurefont: "MuseJazzText",
      partsfont: "MuseJazzText italic",
      repeatfont: "MuseJazzText",
      subtitlefont: "MuseJazzText",
      tabgracefont: "MuseJazzText",
      tablabelfont: "MuseJazzText",
      tabnumberfont: "MuseJazzText",
      tempofont: "MuseJazzText",
      textfont: "MuseJazzText",
      titlefont: "MuseJazzText 4",
      tripletfont: "MuseJazzText",
      vocalfont: "MuseJazzText",
      voicefont: "MuseJazzText",
      wordsfont: "MuseJazzText",
    }
  };

  var visualObjs = ABCJS.renderAbc(notationElt, text, abcParams);

  /* Hide title below chord table */
  document
    .getElementById(notationElt)
    .querySelectorAll(".abcjs-title")
    .forEach(function(el) {
      el.setAttribute("display", "none");
    });

  var chordtable = document.getElementById(chordTableElt);
  create_chord_table(displayChords, chordtable);

  /* Add own title, above chordTable */
  var songtitle = document.getElementById(songTitleElt);
  songtitle.innerHTML = titlePrefix.concat(song.metaText.title);

  /* Initialize audio player for the main songs page */
  if (notationElt === "notation" && visualObjs && visualObjs.length > 0) {
    initAudioForTune(visualObjs[0]);
    setupNotationClickHandler();
  }
}

/*
   Funcion: readFile
   Read a file from an address
   Parameters:
       file - Path to file to read
       callback - Function to call with data if loaded succesfully
*/
function readFile(file, callback) {
  var f = new XMLHttpRequest();
  f.onreadystatechange = function() {
    if (f.readyState === 4) {
      if (f.status === 200 || f.status === 0) {
        callback(f.responseText);
      }
    }
  };
  f.open("GET", file, true);
  f.send(null);
}

/*
   Funcion: create_song_link
   From a entry in index_of_songs.txt parse the fields and add link to page
   Parameters:
       song - A string containing line from index_of_songs.txt
*/
function create_song_link_text(song) {
  var song_parts = song.split(",");
  var song_name = song_parts[0];
  var song_path = song_parts[1];
  var song_title = song_path ? song_path.split(".")[0] : "";

  if (song_title != "") {
    return (
      '<a href="#s=' +
      song_title +
      '" onclick="renderSong(\'' +
      song_path +
      "'); closeDropdowns()\" >" +
      song_name +
      "</a>"
    );
  }

  return "";
}

function closeDropdowns() {
  var contents = document.querySelectorAll('.dropdown-content');
  contents.forEach(function(el) { el.style.display = 'none'; });
  setTimeout(function() {
    contents.forEach(function(el) { el.style.display = ''; });
  }, 300);
}

function string_to_abc_tune(text, transpose_steps) {
  var tunes = ABCJS.parseOnly(text, { visualTranspose: transpose_steps });
  return tunes[0];
}

/*
   Funcion: replace_accidental_with_utf8_char
   Replaces the sharp and flat signs with the official unicode chars
   Parameters:
       note - A string containing # or b signs
   Returns:
       note - with the b and # replaced
*/
function replace_accidental_with_utf8_char(note) {
  return note.replace("b ", "♭").replace("#", "♯").replace("dim", "Ø");
}

/*
   Funcion: parse_chord_scheme
   Reads the chords from the song in abcjs intermediate format into a list per measure with the chords
   Returns:
       chords - A list of lists with the chords per measure
*/
function parse_chord_scheme(song) {
  var chords = [];
  var current_measure = {};
  current_measure.text = [];

  var parsed_valid_chord = false;
  var did_not_parse_chord_in_this_measure = true;
  var in_alternative_ending = false;
  var note_or_rest_in_measure = false;

  for (var i = 0; i < song.lines.length; i += 1) {

    // Subtitle is added to song.lines, don't break when line has no staff
    if (song.lines[i].staff !== undefined) {
      var line = song.lines[i].staff[0].voices[0];

      for (var line_idx = 0; line_idx < line.length; line_idx += 1) {
        var element = line[line_idx];

        if (element.el_type === "note") {
          note_or_rest_in_measure = true;
        }

        if (element.el_type === "bar") {
          if (element.type === "bar_left_repeat") {
            current_measure.leftRepeat = true;
          }
          else if (element.type === "bar_right_repeat") {
            current_measure.rightRepeat = true;
          }
          else if (element.type === "bar_thin_thin") {
            if (note_or_rest_in_measure && parsed_valid_chord) {
              current_measure.doubeThinBarRight = true;
            } else {
              current_measure.doubeThinBarLeft = true;
            }
          }

          if (element.startEnding !== undefined) {
            if (element.startEnding > 1) {
              in_alternative_ending = true;
            }
          } else {
            if (element.endEnding !== undefined && in_alternative_ending) {
              in_alternative_ending = false;
            }
          }

          if (!in_alternative_ending) {
            if (did_not_parse_chord_in_this_measure &&
                parsed_valid_chord &&
                note_or_rest_in_measure) {
              current_measure.text.push(" % ");
            }

            if (current_measure.text.length > 0) {
              current_measure.text = current_measure.text.slice(0);

              chords.push(current_measure);
              current_measure = {};
              current_measure.text = [];
              note_or_rest_in_measure = false;
            }

            did_not_parse_chord_in_this_measure = true;
          }
        }

        if (!in_alternative_ending) {
          var validChord = /^[A-Ga-g]([#♯b♭])?(maj|m|min|dim|aug|sus|add)?(Ø)?(\d)?([#♯b♭])?(\d)?(\/[A-Ga-g]([#♯b♭])?(\d)?)?$/;

          if (element.chord !== undefined && validChord.test(element.chord[0].name)) {
            var chord = replace_accidental_with_utf8_char(element.chord[0].name);
            current_measure.text.push(chord);
            did_not_parse_chord_in_this_measure = false;
            parsed_valid_chord = true;
          }
        }
      }
    }
  }

  // Prevent returning only % % % % % ....
  if (!parsed_valid_chord) {
    chords = [];
  }
  return chords;
}


/*
   Funcion: simplify_blues
   Checks if it is a 12-bar blues scheme, if so, check if all chords are repeated, and just return the 12-bar blues.
   Returns:
       chords - A list of lists with the chords per measure
*/
function simplify_blues(chords) {
  return simplify_song(chords, 12)
}

/*
   Funcion: simplify_song
   Checks if it is a count-bar scheme, if so, check if all chords are repeated, and just return the 12-bar blues.
   Returns:
       chords - A list of lists with the chords per measure
*/
function simplify_song(chords, count) {

  if (chords.length === 0 || chords.length % count !== 0) {
    return chords;
  }

  var repeats = chords.length / count;

  // Check each measure in the blues
  for (var i = 0; i < count; i++) {
    var first = chords[i].text;

    for (var r = 1; r < repeats; r++) {
      var second = chords[i + count * r].text;

      // Are there the same amount of chords in the measure?
      if (first.length != second.length) {
        return chords;
      }

      for (var c = 0; c < first.length; c++) {
        if (first[c] !== second[c]) {
          return chords;
        }
      }
    }
  }

  // Its a scheme that repeats! Dump any bars or repeats
  for (var c = 0; c < count; c++) {
    if (chords[c].leftRepeat !== undefined) {
      delete chords[c].leftRepeat;
    }
    if (chords[c].rightRepeat !== undefined) {
      delete chords[c].rightRepeat;
    }
    if (chords[c].doubeThinBarLeft !== undefined) {
      delete chords[c].doubeThinBarLeft;
    }
    if (chords[c].doubeThinBarRight !== undefined) {
      delete chords[c].doubeThinBarRight;
    }
  }

  return chords.slice(0, count);
}

/*
  computeChordOffset: count how many measures precede the first chord annotation.
  Used to align _abcMeasureIdx (which counts from measure 0 including intros)
  with chord table cell indices (which start at the first chord measure).
*/
function computeChordOffset(song) {
  if (!song.lines) return 0;
  var validChord = /^[A-Ga-g]([#♯b♭])?(maj|m|min|dim|aug|sus|add)?(Ø)?(\d)?([#♯b♭])?(\d)?(\/[A-Ga-g]([#♯b♭])?(\d)?)?$/;
  var measureCount = 0;
  var hasNotesInMeasure = false;
  for (var i = 0; i < song.lines.length; i++) {
    var line = song.lines[i];
    if (!line.staff || !line.staff[0] || !line.staff[0].voices) continue;
    var voice = line.staff[0].voices[0] || [];
    for (var j = 0; j < voice.length; j++) {
      var el = voice[j];
      if (el.chord && el.chord.length > 0 && validChord.test(el.chord[0].name)) {
        return measureCount;
      }
      if (el.el_type === 'note') hasNotesInMeasure = true;
      if (el.el_type === 'bar') {
        if (hasNotesInMeasure) measureCount++;
        hasNotesInMeasure = false;
      }
    }
  }
  return 0;
}

// ============================================================
// Roman Numeral Conversion
// ============================================================

function noteChroma(noteName) {
  var normalized = noteName.replace(/♭/g, 'b').replace(/♯/g, '#');
  if (typeof Tonal !== 'undefined' && Tonal.Note) {
    try {
      var n = Tonal.Note.get(normalized);
      if (typeof n.chroma === 'number') return n.chroma;
    } catch(e) {}
  }
  var CHROMAS = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
  var letter = normalized[0].toUpperCase();
  var rest = normalized.slice(1);
  var c = (CHROMAS[letter] !== undefined) ? CHROMAS[letter] : 0;
  for (var i = 0; i < rest.length; i++) {
    if (rest[i] === 'b') c--;
    else if (rest[i] === '#') c++;
  }
  return ((c % 12) + 12) % 12;
}

function chordToRomanNumeral(chordStr, keyRoot, keyMode) {
  if (!chordStr || chordStr === ' % ') return chordStr;

  var match = chordStr.match(/^([A-G][♭♯b#]?)(.*)/);
  if (!match) return chordStr;
  var chordRoot = match[1];
  var suffix    = match[2] || '';

  var interval = ((noteChroma(chordRoot) - noteChroma(keyRoot)) + 12) % 12;
  var isMinorKey = keyMode && keyMode !== '' && keyMode !== 'major' && keyMode !== 'maj';

  var MAJOR_MAP = {0:[0,''],1:[1,'♭'],2:[1,''],3:[2,'♭'],4:[2,''],5:[3,''],
                   6:[3,'♯'],7:[4,''],8:[5,'♭'],9:[5,''],10:[6,'♭'],11:[6,'']};
  var MINOR_MAP = {0:[0,''],1:[1,'♭'],2:[1,''],3:[2,''],4:[2,'♯'],5:[3,''],
                   6:[4,'♭'],7:[4,''],8:[5,''],9:[5,'♯'],10:[6,''],11:[6,'♯']};

  var entry    = (isMinorKey ? MINOR_MAP : MAJOR_MAP)[interval] || [0,''];
  var ROMANS   = ['I','II','III','IV','V','VI','VII'];
  var romanBase  = ROMANS[entry[0]];
  var accidental = entry[1];

  var isMinorChord = /^(m|min|-)(?!aj)/i.test(suffix);
  var isHalfDim    = /^(Ø|ø|m7[b♭]5)/i.test(suffix);
  var isDim        = /^(°|dim)/i.test(suffix);
  var isAug        = /^(\+|aug)/i.test(suffix);
  var isMaj7       = /maj7|Δ/.test(suffix);
  var numExt       = (suffix.match(/\d+/) || [])[0] || '';

  var roman;
  if (isHalfDim)       roman = romanBase.toLowerCase() + 'ø7';
  else if (isDim)      roman = romanBase.toLowerCase() + '°';
  else if (isMinorChord) roman = romanBase.toLowerCase() + numExt;
  else if (isAug)      roman = romanBase + '+';
  else if (isMaj7)     roman = romanBase + 'maj7';
  else                 roman = romanBase + numExt;

  return accidental + roman;
}

function convertChordsToRoman(chords, song) {
  if (!chords || !chords.length || !song.lines || !song.lines[0]) return chords;

  // Build a per-line key map so key changes mid-song are handled
  var lineKeys = song.lines.map(function(line) {
    return (line.staff && line.staff[0] && line.staff[0].key) || null;
  });

  // Walk lines again to propagate: each line inherits the last known key
  var resolvedKeys = [];
  var lastKey = (lineKeys[0]) || {root:'C', acc:'', mode:''};
  for (var i = 0; i < lineKeys.length; i++) {
    if (lineKeys[i] && lineKeys[i].root) lastKey = lineKeys[i];
    resolvedKeys.push(lastKey);
  }

  // Count measures per line so we can map measure index → key
  var measureKeyMap = [];
  for (var li = 0; li < song.lines.length; li++) {
    var line = song.lines[li];
    if (!line.staff || !line.staff[0] || !line.staff[0].voices) continue;
    var voice   = line.staff[0].voices[0] || [];
    var lineKey = resolvedKeys[li];
    var currentKey = lineKey;
    for (var j = 0; j < voice.length; j++) {
      var el = voice[j];
      if (el.el_type === 'keySignature' && el.key && el.key.root) currentKey = el.key;
      if (el.el_type === 'bar') measureKeyMap.push(currentKey);
    }
  }

  return chords.map(function(measure, idx) {
    var key    = measureKeyMap[idx] || resolvedKeys[0] || {root:'C', acc:'', mode:''};
    var keyRoot = key.root + (key.acc || '');
    var keyMode = key.mode || '';
    var romanText = measure.text.map(function(chordStr) {
      return chordToRomanNumeral(chordStr, keyRoot, keyMode);
    });
    return Object.assign({}, measure, {text: romanText});
  });
}

/*
   Funcion: create_chord_table
   Create a table from a list of chords
   Returns:
       chords - A list of lists with the chords per measure
*/
function create_chord_table(chords, chordtable) {
  var table = document.createElement("TABLE");
  table.border = "1";

  chords = simplify_blues(chords);
  chords = simplify_song(chords, 8);

  var cols = 4;
  if (chords.length > 4 * 4) {
    cols = 8;
  }
  var rows = Math.ceil(chords.length / cols);

  for (var y = 0; y < rows; y++) {
    var row = table.insertRow(-1);
    for (var x = 0; x < cols; x++) {
      var chord_idx = x + y * cols;
      if (chord_idx < chords.length) {
        var cell = row.insertCell(-1);
        var chordDiv = document.createElement("DIV");
        chordDiv.classList.add("chordDiv");
        chordDiv.innerHTML = chords[chord_idx].text;
        cell.appendChild(chordDiv);
        cell.classList.add("chordCell");

        if (chords[chord_idx].doubeThinBarLeft !== undefined) {
          cell.classList.add("chordCellDoubleThinBarLeft");
        }
        if (chords[chord_idx].doubeThinBarRight !== undefined) {
          cell.classList.add("chordCellDoubleThinBarRight");
        }

        if (chords[chord_idx].rightRepeat !== undefined) {
          cell.classList.add("chordCellRightRepeat");
          var span = document.createElement("span");
          span.classList.add("chordRightRepeatSign");
          span.innerHTML = ":";
          chordDiv.appendChild(span);
        }
        if (chords[chord_idx].leftRepeat !== undefined) {
          cell.classList.add("chordCellLeftRepeat");
          var span = document.createElement("span");
          span.classList.add("chordLeftRepeatSign");
          span.innerHTML = ":";
          chordDiv.insertBefore(span, chordDiv.childNodes[0]);
        }
      }
    }
  }

  chordtable.innerHTML = "";
  chordtable.appendChild(table);
}

/*
   Funcion: add_inspiration_link
   Adds a link to the sheetmenu if anabc tune contains a F field
*/
function add_inspiration_link(url) {
  if (url !== undefined) {
    var link = document.getElementById("inspirationLink");
    if (link !== null) {
      link.href = url;
    } else {
      link = document.createElement("A");
      link.innerHTML = "inspiration";
      link.href = url;
      link.target = "_blank";
      link.id = "inspirationLink";
      var menu = document.getElementById("sheetmenu");
      menu.appendChild(document.createTextNode(" | "));
      menu.appendChild(link);
    }
  } else {
    var link = document.getElementById("inspirationLink");
    if (link !== null) {
      link.parentNode.removeChild(link);
    }
  }
}

/*
   Funcion: add_irealpro_link
   Adds a link to the sheetmenu for devices that could have irealpro
*/
function add_irealpro_link(song, chords) {

  var couldHaveIrealPro = /iPhone|iPad|iPod|Android|Macintosh/i.test(navigator.userAgent);
  if (couldHaveIrealPro && (chords.length > 0)) {
    var url = irealProFromAbc(song, chords);
    var link = document.getElementById("iRealPro");
    if (link !== null) {
      link.href = url;
    } else {
      var link = document.createElement("A");
      link.innerHTML = "irealpro";
      link.href = url
      /* link.target = "_blank"; */
      link.id = "iRealPro";
      var menu = document.getElementById("sheetmenu");
      menu.appendChild(document.createTextNode(" | "));
      menu.appendChild(link);
    }
  }
}

/*
   Funcion: irealProFromAbc
   Creates an irealpro compatible link from ABC
*/
function irealProFromAbc(song, chords) {

  var key = song.lines[0].staff[0].key.root + song.lines[0].staff[0].key.acc;
  var num = song.lines[0].staff[0].meter.value[0].num;
  var denom = song.lines[0].staff[0].meter.value[0].den;


  var title = song.metaText.title;
  var composer = (song.metaText.composer !== undefined) ? song.metaText.composer : "Unknown";
  var style = "Second Line";

  var irealProHeader = title + '=' + composer + '=' + style + '=' + key + '=n=T' + num + denom;
  var irealProText = '';
  for (var i = 0; i < chords.length; i++) {

    if (chords[i].leftRepeat !== undefined) {
      irealProText += '{';
    }
    else if (chords[i].doubeThinBarLeft !== undefined) {
      irealProText += '[';
    }
    else if (i == 0)
    {
      irealProText += '|';
    }

    var cell = chords[i].text.toString().replace(/,/g, ' ,');
    var spaceCount = ((cell || '').match(/\ /g) || []).length;
    irealProText += cell;

    switch(spaceCount) {
      case 0:
        irealProText += "   ";
        break;
      case 1:
        irealProText += " ";
        break;
      default:
        break;
    }

    if (chords[i].rightRepeat !== undefined) {
      irealProText += '}';
    }
    else if (chords[i].doubeThinBarRight !== undefined) {
      irealProText += 'ZY|';
    }
    else
    {
      irealProText += '|';
    }

  }

  irealProText = irealProText.replace(/Ø/g, 'h').replace(/m/g, '-').replace(/%/g, 'x ').replace(/♭/g, "b").replace(/♯/g, "#").replace(/\|$/,"Z");

  return 'irealbook://' + encodeURIComponent(irealProHeader) + encodeURIComponent(irealProText);
}


/*
   Funcion: parse_song_from_hash
   Parse which song os the currently selected song and render that (usefull for sharing)
   Returns:
       hash - Hash of the window.location
*/
function parse_song_from_hash(hash) {
  var hash2Obj = parseQueryString(hash.substring(1));

  renderSong(hash2Obj.s + ".abc");
}

function parseQueryString(queryString) {
  var params = {},
    queries,
    temp,
    i,
    l;
  // Split into key/value pairs
  queries = queryString.split("&");
  // Convert the array of strings into an object
  for (i = 0, l = queries.length; i < l; i++) {
    temp = queries[i].split("=");
    params[temp[0]] = temp[1];
  }
  return params;
}

function loadSongs() {
  createInstrumentDropdown();
  readFile("index_of_songs.txt", createAllDropdowns);

  if (window.location.hash) {
    parse_song_from_hash(window.location.hash);
  }
}

function createInstrumentDropdown() {
  var div = document.createElement("DIV");
  div.classList.add("dropdown");

  var select = document.createElement("SELECT");
  select.classList.add("dropbtn");
  select.innerText = "Instrument";
  select.id = "instrument";
  select.onchange = rerenderFile;
  div.appendChild(select);

  var instruments = [
    "Concert pitch",
    "Concert + Roman",
    "Alto Saxophone",
    "Clarinet Bb",
    "Sousaphone",
    "Tenor Saxophone",
    "Trombone",
    "Trumpet"
  ];
  var i;
  for (i = 0; i < instruments.length; i++) {
    var option = document.createElement("OPTION");
    option.innerHTML = instruments[i].toUpperCase();
    option.value = instruments[i].toLowerCase().replace(/ /g, '_');
    select.appendChild(option);
  }

  var abc_menu = document.getElementById("sheetmenu");
  abc_menu.appendChild(div);
}

function createAllDropdowns(data) {
  var songs = data.split("\n");

  var songMap = createMapFromSongList(songs);

  for (var letter in songMap) {
    createLetterDropDown(letter, songMap[letter]);
  }
}

function createMapFromSongList(songList) {
  var songMap = {};
  var i = 0;
  for (; i < songList.length; ++i) {
    if (songMap[songList[i].charAt(0)] === undefined) {
      songMap[songList[i].charAt(0)] = [songList[i]];
    } else {
      songMap[songList[i].charAt(0)].push(songList[i]);
    }
  }

  return songMap;
}

function createLetterDropDown(letter, songs) {
  var div = document.createElement("DIV");
  div.classList.add("dropdown");

  var btn = document.createElement("BUTTON");
  btn.classList.add("dropbtn");
  btn.innerText = letter;
  div.appendChild(btn);

  var contentDiv = document.createElement("DIV");
  contentDiv.classList.add("dropdown-content");

  var i;
  for (i = 0; i < songs.length; i++) {
    contentDiv.innerHTML += create_song_link_text(songs[i]);
  }

  div.appendChild(contentDiv);

  var abc_menu = document.getElementById("abc_menu");
  abc_menu.appendChild(div);
}

// ============================================================
// Audio Playback
// ============================================================

var audioPlayer = {
  synthController: null,
  isPlaying: false,
  totalMs: 0,
  currentVisualObj: null,
  melodOff: false
};

var audioParams = {
  soundFontUrl: "https://gleitz.github.io/midi-js-soundfonts/MusyngKite/",
  program: 56  // Trumpet (GM)
};

function currentAudioParams() {
  var params = Object.assign({}, audioParams);
  if (audioPlayer.melodOff) params.voicesOff = true;
  return params;
}

var lastHighlighted = [];
var lastHighlightedChordCell = null;

// Cursor control callbacks for ABCJS SynthController
var cursorControl = {
  onStart: function() {
    clearNoteHighlight();
  },
  onEvent: function(ev) {
    if (!ev || !ev.elements) return;
    clearNoteHighlight();

    // Highlight the notes at current position and cache them
    var newHighlighted = [];
    for (var i = 0; i < ev.elements.length; i++) {
      for (var j = 0; j < ev.elements[i].length; j++) {
        ev.elements[i][j].classList.add("abcjs-current-note");
        newHighlighted.push(ev.elements[i][j]);
      }
    }
    lastHighlighted = newHighlighted;

    // Highlight the matching chord table cell
    if (newHighlighted.length > 0 && newHighlighted[0]._abcMeasureIdx !== undefined) {
      var measureIdx = newHighlighted[0]._abcMeasureIdx;
      var offset = audioPlayer.chordOffset || 0;
      if (measureIdx >= offset) {
        var cells = document.querySelectorAll('#chordtable .chordCell');
        if (cells.length > 0) {
          var cellIdx = (measureIdx - offset) % cells.length;
          cells[cellIdx].classList.add('chordCell-playing');
          lastHighlightedChordCell = cells[cellIdx];
        }
      }
    }
  },
  onFinished: function() {
    audioPlayer.isPlaying = false;
    updatePlayButton();
    clearNoteHighlight();
  },
  onBeat: function() {}
};

function clearNoteHighlight() {
  for (var i = 0; i < lastHighlighted.length; i++) {
    lastHighlighted[i].classList.remove("abcjs-current-note");
  }
  lastHighlighted = [];
  if (lastHighlightedChordCell) {
    lastHighlightedChordCell.classList.remove('chordCell-playing');
    lastHighlightedChordCell = null;
  }
}

function updatePlayButton() {
  var btn = document.getElementById("playPauseBtn");
  if (!btn) return;
  if (audioPlayer.isPlaying) {
    btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    btn.title = "Pause";
    btn.classList.add("playing");
  } else {
    btn.innerHTML = '<i class="fa-solid fa-play"></i>';
    btn.title = "Play";
    btn.classList.remove("playing");
  }
}

function setPlayerButtonsDisabled(disabled) {
  var playBtn = document.getElementById("playPauseBtn");
  var stopBtn = document.getElementById("stopBtn");
  var melodyBtn = document.getElementById("melodyOffBtn");
  if (playBtn) playBtn.disabled = disabled;
  if (stopBtn) stopBtn.disabled = disabled;
  if (melodyBtn) melodyBtn.disabled = disabled;
}

function updateMelodyButton() {
  var btn = document.getElementById("melodyOffBtn");
  if (!btn) return;
  if (audioPlayer.melodOff) {
    btn.classList.add("active");
    btn.title = "Unmute melody";
  } else {
    btn.classList.remove("active");
    btn.title = "Mute melody";
  }
}

function toggleMelody() {
  audioPlayer.melodOff = !audioPlayer.melodOff;
  updateMelodyButton();
  rerenderFile();
}

function setAudioLoadingVisible(visible) {
  var label = document.getElementById("audioLoadingLabel");
  if (label) {
    if (visible) {
      label.classList.add("visible");
    } else {
      label.classList.remove("visible");
    }
  }
}

function playPause() {
  if (!audioPlayer.synthController) return;
  if (audioPlayer.isPlaying) {
    audioPlayer.synthController.pause();
    audioPlayer.isPlaying = false;
  } else {
    audioPlayer.synthController.play();
    audioPlayer.isPlaying = true;
  }
  updatePlayButton();
}

function stopAudio() {
  if (!audioPlayer.synthController || !audioPlayer.currentVisualObj) return;

  // Silence immediately
  try { audioPlayer.synthController.pause(); } catch(e) {}
  audioPlayer.isPlaying = false;
  updatePlayButton();
  clearNoteHighlight();
  setPlayerButtonsDisabled(true);

  // Re-call setTune() on the existing controller to fully reset its internal
  // state (midiBuffer + timingCallbacks) back to position 0. The soundfont
  // buffers are already decoded in the AudioContext so this is fast.
  var ctrl = audioPlayer.synthController;
  ctrl.setTune(audioPlayer.currentVisualObj, false, currentAudioParams())
    .then(function() {
      if (ctrl !== audioPlayer.synthController) return;
      clearNoteHighlight();
      setPlayerButtonsDisabled(false);
    })
    .catch(function(err) {
      console.warn("Stop reset failed:", err);
      if (ctrl !== audioPlayer.synthController) return;
      clearNoteHighlight();
      setPlayerButtonsDisabled(false);
    });
}

function initAudioForTune(visualObj) {
  if (!ABCJS.synth || typeof ABCJS.synth.supportsAudio !== "function" ||
      !ABCJS.synth.supportsAudio()) {
    return;
  }

  // Silence and discard the existing controller before loading a new tune
  if (audioPlayer.synthController) {
    try { audioPlayer.synthController.pause(); } catch(e) {}
    audioPlayer.synthController = null;
  }
  audioPlayer.isPlaying = false;
  audioPlayer.totalMs = 0;
  audioPlayer.currentVisualObj = visualObj;
  updatePlayButton();
  updateMelodyButton();
  setPlayerButtonsDisabled(true);
  setAudioLoadingVisible(true);

  // Show the inline player controls
  var controls = document.getElementById("audioControls");
  if (controls) controls.style.display = "";

  // Pre-compute note-to-time map for click-to-seek
  buildTimingMap(visualObj);

  // Fresh SynthController for every new tune
  audioPlayer.synthController = new ABCJS.synth.SynthController();
  audioPlayer.synthController.load("#abc-player-container", cursorControl, {
    displayLoop: false,
    displayRestart: false,
    displayPlay: false,
    displayProgress: false,
    displayWarp: false
  });

  var ctrl = audioPlayer.synthController;
  ctrl.setTune(visualObj, false, currentAudioParams())
    .then(function() {
      if (ctrl !== audioPlayer.synthController) return;
      setAudioLoadingVisible(false);
      setPlayerButtonsDisabled(false);
    })
    .catch(function(err) {
      console.warn("Audio could not load:", err);
      if (ctrl !== audioPlayer.synthController) return;
      setAudioLoadingVisible(false);
    });
}

/*
  buildTimingMap: Use ABCJS.TimingCallbacks to pre-compute the time (ms) for
  every note element in the SVG, stored as el._abcSeekMs. Also records the
  total song duration for fraction-based seeking.
*/
function buildTimingMap(visualObj) {
  if (typeof ABCJS.TimingCallbacks !== "function") return;
  try {
    var tc = new ABCJS.TimingCallbacks(visualObj, {
      eventCallback: function() { return true; },
      beatCallback: function() { return true; }
    });
    var timings = tc.noteTimings || [];
    var maxMs = 0;
    var measureIdx = 0;
    var seenFirstEvent = false;
    for (var i = 0; i < timings.length; i++) {
      var t = timings[i];
      if (t.type === "event" && t.elements && t.milliseconds !== undefined) {
        if (t.measureStart && seenFirstEvent) measureIdx++;
        seenFirstEvent = true;
        if (t.milliseconds > maxMs) maxMs = t.milliseconds;
        for (var v = 0; v < t.elements.length; v++) {
          for (var e = 0; e < t.elements[v].length; e++) {
            t.elements[v][e]._abcSeekMs = t.milliseconds;
            t.elements[v][e]._abcMeasureIdx = measureIdx;
          }
        }
      }
    }
    // Add a small buffer so the final note isn't at fraction=1 immediately
    audioPlayer.totalMs = maxMs + 500;
  } catch(e) {
    console.warn("buildTimingMap error:", e);
  }
}

/*
  seekToMs: Seek playback to a given millisecond offset.
*/
function seekToMs(ms) {
  var sc = audioPlayer.synthController;
  if (!sc || audioPlayer.totalMs <= 0) return;
  var fraction = Math.max(0, Math.min(1, ms / audioPlayer.totalMs));
  if (typeof sc.seek === "function") {
    sc.seek(fraction);
    if (audioPlayer.isPlaying && typeof sc.play === "function") {
      sc.play();
    }
  }
}

/*
  handleNotationClick: Walk up the DOM from the clicked element to find the
  nearest element tagged with _abcSeekMs and seek to that position.
*/
function handleNotationClick(e) {
  var notation = document.getElementById("notation");
  var el = e.target;
  while (el && el !== notation) {
    if (el._abcSeekMs !== undefined) {
      seekToMs(el._abcSeekMs);
      return;
    }
    el = el.parentElement;
  }
}

function setupNotationClickHandler() {
  var notation = document.getElementById("notation");
  if (!notation || notation._abcClickHandlerSet) return;
  notation._abcClickHandlerSet = true;
  notation.addEventListener("click", handleNotationClick);
}
