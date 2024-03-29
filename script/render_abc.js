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

  if (text.search(/\[V:.*\]/g) == -1) {
    text = change_cleff_for_instrument(instrumentSelect.value, text);
    transpose_steps += offset_for_instrument(instrumentSelect.value);
  }

  window.current_song = text;
  var song = string_to_abc_tune(text, transpose_steps);
  var chords = parse_chord_scheme(song);

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

  ABCJS.renderAbc(notationElt, text, abcParams);

  /* Hide title below chord table */
  document
    .getElementById(notationElt)
    .querySelectorAll(".abcjs-title")
    .forEach(function(el) {
      el.setAttribute("display", "none");
    });

  var chordtable = document.getElementById(chordTableElt);
  create_chord_table(chords, chordtable);

  /* Add own title, above chordTable */
  var songtitle = document.getElementById(songTitleElt);
  songtitle.innerHTML = titlePrefix.concat(song.metaText.title);
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
      "')\" >" +
      song_name +
      "</a>"
    );
  }

  return "";
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

  if (chords.length % count != 0) {
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
      link.innerHTML = " | inspiration";
      link.href = url;
      link.target = "_blank";
      link.id = "inspirationLink";
      var menu = document.getElementById("sheetmenu");
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

  var couldHaveIrealPro = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (couldHaveIrealPro && (chords.length > 0)) {
    var url = irealProFromAbc(song, chords);
    var link = document.getElementById("iRealPro");
    if (link !== null) {
      link.href = url;
    } else {
      var link = document.createElement("A");
      link.innerHTML = " | irealpro";
      link.href = url
      link.target = "_blank";
      link.id = "iRealPro";
      var menu = document.getElementById("sheetmenu");
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

  var irealProText = 'irealbook://' + title + '=' + composer + '=' + style + '=' + key + '=n=T' + num + denom;
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

  return irealProText;
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
    option.value = instruments[i].toLowerCase().replace(" ", "_");
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