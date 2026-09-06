// Entry point for /agenda/ (and /nl/agenda/, /de/agenda/): fills the upcoming
// and past show blocks from static/agenda/shows.txt. Upcoming shows are shown
// loud; the archive is a quiet, year-grouped list under a tally line.
import { byId } from "./lib/dom.js";
import {
  parseShowList,
  formatShowDateLong,
  splitShows,
} from "./lib/showlist.js";

// The Split theme always stamps <html lang="en-US">, so read the language off
// the URL prefix instead (/nl/agenda/, /de/agenda/).
function pageLang() {
  const first = window.location.pathname.split("/").filter(Boolean)[0];
  return first === "nl" || first === "de" ? first : "en";
}

function showRow(show, variant, lang) {
  const row = document.createElement("div");
  row.className = `rj-show rj-show--${variant}`;

  const date = document.createElement("span");
  date.className = "rj-show-date";
  date.textContent = formatShowDateLong(show, lang);

  const name = document.createElement("span");
  name.className = "rj-show-name";
  name.textContent = show.name;

  const loc = document.createElement("span");
  loc.className = "rj-show-loc";
  loc.textContent = show.location;

  row.append(date, name, loc);
  return row;
}

function render(shows) {
  const upcomingBox = byId("agendaUpcoming");
  const pastBox = byId("agendaPast");
  const count = byId("agendaEarlierCount");
  if (!upcomingBox || !pastBox) return;

  const lang = pageLang();
  const { upcoming, past } = splitShows(shows);

  upcoming.forEach((show) => upcomingBox.append(showRow(show, "next", lang)));
  upcomingBox.hidden = upcoming.length === 0;

  let year = null;
  past.forEach((show) => {
    const showYear = show.date.getFullYear();
    if (showYear !== year) {
      year = showYear;
      const head = document.createElement("div");
      head.className = "rj-agenda-year";
      head.textContent = String(showYear);
      pastBox.append(head);
    }
    pastBox.append(showRow(show, "past", lang));
  });
  if (count) count.textContent = String(shows.length);
}

async function loadShows() {
  if (!byId("agendaUpcoming")) return;
  try {
    const response = await fetch("/agenda/shows.txt");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(parseShowList(await response.text()));
  } catch (err) {
    console.warn("Could not load the show list:", err);
  }
}

window.addEventListener("load", loadShows);
