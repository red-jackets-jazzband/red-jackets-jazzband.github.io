"use strict";

var current_song = null;
var transpose_halfsteps = 0;

function renderSong(path)
{
    document.getElementById("transpose").value = 0;
    readFile(path, renderAbcFile);
}

function rerenderFile()
{
    var transposeInput = document.getElementById("transpose");

    if(window.current_song !== undefined) {
        renderAbcFile(window.current_song, transposeInput.valueAsNumber);
    }
}

/*
   Funcion: renderAbcFile
   Render a song from a abc text
   Parameters:
       text - String containing (valid) abc file
       transpose_steps - Number of halfsteps to transpose
*/
function renderAbcFile(text, transpose_steps)
{
    if (transpose_steps === undefined) {
      transpose_steps = 0;
    }
    window.current_song = text;
    var song = string_to_abc_tune(text, transpose_steps);
    var chords = parse_chord_scheme(song);

    var abcParams = { visualTranspose: transpose_steps,
                                    responsive: "resize",
                                    paddingTop: 0,
                                    paddingBottom: 0,
                                    add_classes: true,
                                        format: {
                         headerfont: "MuseJazzText",
                         gchordfont: "MuseJazzText",
                         infofont: "MuseJazzText",
                         composerfont: "MuseJazzText",
                         titlefont: "MuseJazzText 18 bold",
                         vocalfont: "MuseJazzText",
                         partsfont: "MuseJazzText",
                         tempofont: "MuseJazzText"
                    }
                      } ;

    ABCJS.renderAbc('notation', text, abcParams);

    /* Hide title below chord table */
    document.getElementById("notation").querySelectorAll(".abcjs-title").forEach((el) => {
        el.setAttribute("display", "none");
    });

    create_chord_table(chords);

    /* Add own title, above chordTable */
    var songtitle = document.getElementById("songtitle");
    songtitle.innerHTML = song.metaText.title;
}

/*
   Funcion: readFile
   Read a file from an address
   Parameters:
       file - Path to file to read
       callback - Function to call with data if loaded succesfully
*/
function readFile(file, callback)
{
    var f = new XMLHttpRequest();
    f.open("GET", file, false);
    f.onreadystatechange = function () {
        if(f.readyState === 4) {
            if(f.status === 200 || f.status === 0) {
                callback(f.responseText);
            }
        }
    };
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
    var song_title = song_path? song_path.split(".")[0] : "";

    if(song_title != "") {
        return "<a href=\"#s=" + song_title + "\" onclick=\"renderSong('" + song_path + "')\" >" + song_name +"</a>";
    }

    return "";
}

function string_to_abc_tune(text, transpose_steps) {
    var tunes = ABCJS.parseOnly(text, {visualTranspose:transpose_steps});
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
        return note.replace("b ", "♭")
                   .replace("#", "♯");
    }

/*
   Funcion: parse_chord_scheme
   Reads the chords from the song in abcjs intermediate format into a list per measure with the chords
   Returns:
       chords - A list of lists with the chords per measure
*/
function parse_chord_scheme(song) {
    var chords = [];
    var current_measure = [];

    var parsed_valid_chord = false;
    var did_not_parse_chord_in_this_measure = true;

    for (var i = 0; i < song.lines.length; i+=1) {

        var line = song.lines[i].staff[0].voices[0];

        for (var line_idx = 0; line_idx < line.length; line_idx+=1) {

            var element = line[line_idx];

            if (element.el_type === "bar") {

                if (did_not_parse_chord_in_this_measure && parsed_valid_chord) {
                    current_measure.push(" % ");
                }

                if (current_measure.length > 0) {
                    chords.push(current_measure.slice(0));
                    current_measure = [];
                }

                did_not_parse_chord_in_this_measure = true;
            }

            if (element.chord !== undefined) {
                var chord = replace_accidental_with_utf8_char(element.chord[0].name);
                current_measure.push(chord);
                did_not_parse_chord_in_this_measure = false;
                parsed_valid_chord = true;
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
   Funcion: create_chord_table
   Create a table from a list of chords
   Returns:
       chords - A list of lists with the chords per measure
*/
function create_chord_table(chords) {
    var table = document.createElement("TABLE");
    table.border = "1";

    var cols = 4;
    if (chords.length > (4 * 4)) {
        cols = 8;
    }
    var rows = Math.ceil(chords.length / cols);

    for (var y = 0; y < rows; y++) {
        var row = table.insertRow(-1);
        for (var x = 0; x < cols; x++) {
            var chord_idx = x + y * cols;
            if(chord_idx < chords.length) {
                var cell = row.insertCell(-1);
                cell.innerHTML = chords[chord_idx];
                cell.classList.add('chordCell');
            }
        }
    }

    var chordtable = document.getElementById("chordtable");
    chordtable.innerHTML = "";
    chordtable.appendChild(table);
}

/*
   Funcion: parse_song_from_hash
   Parse which song os the currently selected song and render that (usefull for sharing)
   Returns:
       hash - Hash of the window.location
*/
function parse_song_from_hash(hash) {
    const hash2Obj = hash.split("#")[1].split("&")
                         .map(v => v.split("="))
                         .reduce( (pre, [key, value]) => ({ ...pre, [key]: value }), {} );

    renderSong(hash2Obj["s"] + ".abc");
}

function loadSongs() {
    readFile('index_of_songs.txt', createAllDropdowns);

    if(window.location.hash) {
        parse_song_from_hash(window.location.hash);
    }
}

function createAllDropdowns(data) {
    var songs = data.split('\n');

    var songMap = createMapFromSongList(songs);

    for (var letter in songMap) {
        createLetterDropDown(letter, songMap[letter]);
    }
}

function createMapFromSongList(songList) {

    var songMap = {};
    var i = 0;
    for(; i < songList.length; ++i) {
        if (songMap[songList[i].charAt(0)] === undefined)
        {
            songMap[songList[i].charAt(0)] = [songList[i]];
        }
        else
        {
            songMap[songList[i].charAt(0)].push(songList[i]);
        }
    }

    return songMap;
}

function createLetterDropDown(letter, songs) {

    var div = document.createElement("DIV");
    div.classList.add('dropdown');

    var btn = document.createElement("BUTTON");
    btn.classList.add('dropbtn');
    btn.innerText = letter;
    div.appendChild(btn);

    var contentDiv = document.createElement("DIV");
    contentDiv.classList.add('dropdown-content');

    var i;
    for (i = 0; i < songs.length; i++) { 
        contentDiv.innerHTML += create_song_link_text(songs[i]);
    }

    div.appendChild(contentDiv);


    var abc_menu = document.getElementById("abc_menu");
    abc_menu.appendChild(div);
}

window[ addEventListener ? 'addEventListener' : 'attachEvent' ]( addEventListener ? 'load' : 'onload', loadSongs );

