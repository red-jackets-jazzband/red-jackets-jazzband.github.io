"use strict";

function readFile(file, callback) {
    var f = new XMLHttpRequest();
    f.open("GET", file, false);
    f.onreadystatechange = function () {
        if (f.readyState === 4) {
            if (f.status === 200 || f.status === 0) {
                var res = f.responseText;
                callback(res);
            }
        }
    };
    f.send(null);
}

function render_show(show) {
    var table = document.getElementById("showTable");

    var now = new Date();

    var show_date_text = show.split(",")[0];
    var last_day = show_date_text.split("-")[1];
    last_day = last_day === undefined? "" : "-" + last_day;
    var show_date = new Date(Date.parse(show_date_text.split("-")[0]));

    var show_name = show.split(",")[1];
    var show_loc = show.split(",")[2];

    var topRow = table.insertRow(-1);
    if (show_date > now) {
        topRow.classList.add('upcomingShow');
    }

    var dateCell = topRow.insertCell(-1);
    dateCell.innerHTML = show_date.getDate() + last_day + "/" + show_date.getMonth() + "/" + show_date.getFullYear();
    dateCell.classList.add('dateCell');

    var nameCell = topRow.insertCell(-1);
    nameCell.innerHTML = show_name;
    nameCell.classList.add('nameCell');

    var bottomRow = table.insertRow(-1);
    if (show_date > now) {
        bottomRow.classList.add('upcomingShow');
    }
    bottomRow.insertCell(-1);
    var locationCell = bottomRow.insertCell(-1);
    locationCell.innerHTML = show_loc;
}

function parse_showlist(data) {
    var shows = data.split('\n');
    shows.forEach(render_show);
}

function loadShows() {
    readFile('shows.txt', parse_showlist);
}

window[ addEventListener? 'addEventListener' : 'attachEvent']( addEventListener? 'load' : 'onload', loadShows);
