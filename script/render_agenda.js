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

function parse_show_line(show) {

    var show_date_text = show.split(",")[0];
    var last_day = show_date_text.split("-")[1];

    return {
        name: show.split(",")[1],
        location: show.split(",")[2],
        date: new Date(Date.parse(show_date_text.split("-")[0])),
        last_day: last_day === undefined? "" : "-" + last_day
    };
}

function render_show(show) {
    var table = document.getElementById("showTable");

    var now = new Date();
    /* Don't care about time */
    now.setHours(0,0,0,0);

    show = parse_show_line(show);

    var topRow = table.insertRow(-1);
    if (show.date >= now) {
        topRow.classList.add('upcomingShow');
    }

    var dateCell = topRow.insertCell(-1);
    dateCell.innerHTML = show.date.getDate() + show.last_day + "/" + (show.date.getMonth() + 1) + "/" + show.date.getFullYear();
    dateCell.classList.add('dateCell');

    var nameCell = topRow.insertCell(-1);
    nameCell.innerHTML = show.name;
    nameCell.classList.add('nameCell');

    var bottomRow = table.insertRow(-1);
    if (show.date >= now) {
        bottomRow.classList.add('upcomingShow');
    }
    bottomRow.insertCell(-1);
    var locationCell = bottomRow.insertCell(-1);
    locationCell.innerHTML = show.location;
}

function parse_showlist(data) {
    var shows = data.split('\n');
    shows.forEach(render_show);
}

function loadShows() {
    readFile('shows.txt', parse_showlist);
}

window[ addEventListener? 'addEventListener' : 'attachEvent']( addEventListener? 'load' : 'onload', loadShows);
