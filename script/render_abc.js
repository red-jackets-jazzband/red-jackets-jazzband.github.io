function renderSong(path)
{
    readFile(path, renderAbcFile)
}

function renderAbcFile(text)
{
    var song = string_to_abc_tune(text)
    var chords = parse_chord_scheme(song)
    ABCJS.renderAbc('notation', text, { responsive: "resize",
                                        format: {
					     vocalfont: "MuseJazzText", 
					     headerfont: "MuseJazzText"
					} );

    create_chord_table(chords);
}

function readFile(file, callback)
{
    var f = new XMLHttpRequest();
    f.open("GET", file, false);
    f.onreadystatechange = function ()
    {
        if(f.readyState === 4)
        {
            if(f.status === 200 || f.status == 0)
            {
                var res= f.responseText;
                callback(res);
            }
        }
    }
    f.send(null);
}

function parse_songlist(data) {
    var songs = data.split('\n');
    var number_of_songs = songs.length - 1;

    var div = document.getElementById('songslist');

    for (var i = 0; i < number_of_songs; i++) {
        var song_name = songs[i].split(",")[0];
        var song_path = songs[i].split(",")[1];

        div.innerHTML += "<a href=\"#\" onclick=\"renderSong('" + song_path + "')\" >" + song_name +"</a> | "
    }
}


function string_to_abc_tune(text) {
    var tunes = ABCJS.parseOnly(text);
    return tunes[0]
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
    };

/*
   Funcion: parse_chord_scheme
   Reads the chords from the song in abcjs intermediate format into a list per measure with the chords
   Returns:
       chords - A list of lists with the chords per measure
*/
function parse_chord_scheme(song) {
    var chords = [];
    var current_measure = [];

    var parsed_first_bar = false;
    var parsed_valid_chord = false;
    var did_not_parse_chord_in_this_measure = true;

    for (var i = 0; i < song.lines.length; i++) {

        var line = song.lines[i].staff[0].voices[0];

        for (var line_idx = 0; line_idx < line.length; line_idx++) {

            var element = line[line_idx];

            if (element.el_type === "bar") {

                if (did_not_parse_chord_in_this_measure && parsed_first_bar) {
                    current_measure.push(" % ");
                }

                if (current_measure.length > 0) {
                    chords.push(current_measure.slice(0));
                    current_measure = [];
                }

                did_not_parse_chord_in_this_measure = true;
                parsed_first_bar = true;
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


function create_chord_table(chords) {
    var table = document.createElement("TABLE");
    table.border = "1";

    var cols = 4;
    if (chords.length > (4 * 4)) {
        cols = 8;
    }
    var rows = Math.ceil(chords.length / cols);

    for (var y = 0; y < rows; y++) {
        row = table.insertRow(-1);
        for (var x = 0; x < cols; x++) {
            var chord_idx = x + y * cols;
	    if(chord_idx < chords.length) {
                var cell = row.insertCell(-1);
                cell.innerHTML = chords[chord_idx];
	    }
        }
    }

    var chordtable = document.getElementById("chordtable");
    chordtable.innerHTML = "";
    chordtable.appendChild(table);
}

function loadSongs() {
    readFile('index_of_songs.txt', parse_songlist)
}

window[ addEventListener ? 'addEventListener' : 'attachEvent' ]( addEventListener ? 'load' : 'onload', loadSongs )

