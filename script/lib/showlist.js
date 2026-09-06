// Parsing for the agenda page's show list (static/agenda/shows.txt). Each line
// is "YYYY/MM/DD,Name,Location", with an optional "-D" on the date for a
// multi-day event ("2022/05/06-7" → the 6th to the 7th). Pure; the table
// rendering lives in agenda-page.js.

export function parseShowLine(line) {
  const [dateText = "", name = "", location = ""] = String(line).split(",");
  const [start, lastDay] = dateText.split("-");
  return {
    name,
    location,
    date: new Date(Date.parse(start)),
    lastDay: lastDay === undefined ? "" : `-${lastDay}`,
  };
}

export function parseShowList(text) {
  return String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseShowLine);
}

// "20/6/2026", or "6-7/5/2022" for a multi-day event. Day and month are not
// zero-padded — matches the historic agenda table.
export function formatShowDate(show) {
  const d = show.date;
  return `${d.getDate()}${show.lastDay}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

const MONTHS = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  nl: ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"],
  de: ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sep.", "Okt.", "Nov.", "Dez."],
};

// "20 Jun 2026", or "6-7 May 2022" for a multi-day event. Used by the redesigned
// agenda list, where the date sits in its own column rather than a slash string.
// `lang` picks the month names ("en" | "nl" | "de"), defaulting to English.
export function formatShowDateLong(show, lang = "en") {
  const d = show.date;
  const months = MONTHS[lang] || MONTHS.en;
  const day = `${d.getDate()}${show.lastDay}`;
  return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// A show is "upcoming" from the start of its (first) day onwards.
export function isUpcoming(show, now = new Date()) {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return show.date >= midnight;
}

// Partition a show list into upcoming and past, each keeping the source order
// (shows.txt is maintained newest-first). The agenda renders them as two
// separate blocks: upcoming loud, past quiet.
export function splitShows(shows, now = new Date()) {
  const upcoming = [];
  const past = [];
  for (const show of shows) {
    (isUpcoming(show, now) ? upcoming : past).push(show);
  }
  return { upcoming, past };
}
