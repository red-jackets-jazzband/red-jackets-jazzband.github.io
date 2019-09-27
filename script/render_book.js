"use strict";

function renderBook() {
  document.getElementById("songs").innerHTML = "";
  document.getElementById("bookIndexList").innerHTML = "";

  var instrumentSelect = document.getElementById("instrument");
  var instrumentText = instrumentSelect.options[instrumentSelect.selectedIndex].text;
  document.getElementById("instrumentText").innerHTML = instrumentText.toLowerCase();
  document.getElementById("instrumentTextCover").innerHTML = instrumentText.toLowerCase();

  readFile("/songs/index_of_songbook.txt", renderAllSongs);
}

function renderAllSongs(data) {
  var songList = data.split("\n");

  var songsDiv = document.getElementById("songs");
  var index = document.getElementById("bookIndexList");

  /* Add each song to the book */
  var i = 0;
  for (; i < songList.length; ++i) {

    var song_parts = songList[i].split(",");
    var song_name = song_parts[0];
    var song_path = song_parts[1];
    var song_title = song_path ? song_path.split(".")[0] : "";

    /* Add to index */
    var indexItem = document.createElement("LI");
    var titlePrefix = String(i+1) + ". ";
    indexItem.innerHTML = titlePrefix + song_name;
    index.appendChild(indexItem);

    /* Add elements in book */
    var songTitleElt = document.createElement("DIV");
    songTitleElt.id = "songtitle-".concat(song_title);
    songTitleElt.classList.add("songtitle");
    songTitleElt.classList.add("pageBreakBefore");
    songsDiv.appendChild(songTitleElt);
    var chordTableElt = document.createElement("DIV");
    chordTableElt.id = "chordtable-".concat(song_title);
    chordTableElt.classList.add("chordtable");
    songsDiv.appendChild(chordTableElt);
    var notationElt = document.createElement("DIV");
    notationElt.id = "notation-".concat(song_title);
    notationElt.classList.add("notation");
    songsDiv.appendChild(notationElt);

    retrieveAndRenderSongForBook("/songs/" + song_path, notationElt.id, chordTableElt.id, songTitleElt.id, titlePrefix);
  }

}

function retrieveAndRenderSongForBook(song_path, notationElt, chordTableElt, songTitleElt, titlePrefix) {

  var f = new XMLHttpRequest();
  f.onreadystatechange = function() {
    if (f.readyState === 4) {
      if (f.status === 200 || f.status === 0) {
        renderAbcFile(f.responseText, notationElt, chordTableElt, songTitleElt, titlePrefix, false);
      }
    }
  };
  f.open("GET", song_path, true);
  f.send();
}