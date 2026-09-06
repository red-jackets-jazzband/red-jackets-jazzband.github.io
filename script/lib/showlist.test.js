import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseShowLine,
  parseShowList,
  formatShowDate,
  formatShowDateLong,
  isUpcoming,
  splitShows,
} from "./showlist.js";

test("parseShowLine reads date, name and location", () => {
  const show = parseShowLine("2026/06/20,ZeelandJazz 2026,Middelburg");
  assert.equal(show.name, "ZeelandJazz 2026");
  assert.equal(show.location, "Middelburg");
  assert.equal(show.lastDay, "");
  assert.equal(show.date.getFullYear(), 2026);
  assert.equal(show.date.getMonth(), 5);
  assert.equal(show.date.getDate(), 20);
});

test("parseShowLine reads a multi-day range as a trailing -D", () => {
  const show = parseShowLine("2022/05/06-7,Jazzfest Gronau,Gronau (DE)");
  assert.equal(show.lastDay, "-7");
  assert.equal(show.date.getDate(), 6);
});

test("parseShowList skips blank lines", () => {
  const shows = parseShowList("2026/06/20,A,X\n\n  \n2025/09/20,B,Y\n");
  assert.equal(shows.length, 2);
  assert.equal(shows[0].name, "A");
  assert.equal(shows[1].name, "B");
});

test("formatShowDate is unpadded d/m/yyyy, with the range suffix", () => {
  assert.equal(formatShowDate(parseShowLine("2026/06/20,A,X")), "20/6/2026");
  assert.equal(formatShowDate(parseShowLine("2022/05/06-7,A,X")), "6-7/5/2022");
});

test("formatShowDateLong is 'd Mon yyyy', keeping the range suffix", () => {
  assert.equal(formatShowDateLong(parseShowLine("2026/06/20,A,X")), "20 Jun 2026");
  assert.equal(formatShowDateLong(parseShowLine("2022/05/06-7,A,X")), "6-7 May 2022");
});

test("formatShowDateLong localises the month name", () => {
  assert.equal(formatShowDateLong(parseShowLine("2026/03/20,A,X"), "nl"), "20 mrt 2026");
  assert.equal(formatShowDateLong(parseShowLine("2026/03/20,A,X"), "de"), "20 März 2026");
  assert.equal(formatShowDateLong(parseShowLine("2026/03/20,A,X"), "fr"), "20 Mar 2026");
});

test("splitShows partitions into upcoming and past, keeping source order", () => {
  const now = new Date("2026-06-15T12:00:00");
  const shows = parseShowList(
    "2026/06/20,Next,X\n2026/06/10,Just gone,Y\n2025/09/20,Older,Z\n",
  );
  const { upcoming, past } = splitShows(shows, now);
  assert.deepEqual(upcoming.map((s) => s.name), ["Next"]);
  assert.deepEqual(past.map((s) => s.name), ["Just gone", "Older"]);
});

test("isUpcoming compares against the start of today", () => {
  const now = new Date("2026-06-15T12:00:00");
  assert.equal(isUpcoming(parseShowLine("2026/06/20,A,X"), now), true);
  assert.equal(isUpcoming(parseShowLine("2026/06/15,A,X"), now), true);
  assert.equal(isUpcoming(parseShowLine("2026/06/14,A,X"), now), false);
});
