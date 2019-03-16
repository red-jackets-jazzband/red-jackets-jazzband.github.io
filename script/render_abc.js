function renderAbcFile(text)
{
    ABCJS.renderAbc('notation', text);
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

        div.innerHTML += "<a href=\"#\" onclick=\"readFile('" + song_path + "', renderAbcFile)\" >" + song_name +"</a> | "
    }
}

function loadSongs() {
    readFile('_index_of_songs', parse_songlist)
}

window[ addEventListener ? 'addEventListener' : 'attachEvent' ]( addEventListener ? 'load' : 'onload', loadSongs )

