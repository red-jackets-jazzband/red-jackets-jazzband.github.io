import { parseSongIndex } from "../lib/song-index.js";
import { parseSetlistFile, isSetlistDivider } from "../lib/setlist-format.js";

// "song" | "songs" for a count.
export function songCountLabel(n) {
  return `${n} ${n === 1 ? "song" : "songs"}`;
}

// Song items only — set dividers ("breaks") don't count toward the total.
export function countSetlistSongs(items) {
  return (items || []).filter((item) => !isSetlistDivider(item)).length;
}

/*
  Shared setlist data access: the band-setlist fetch/parse cache (the home
  shelf asks every band setlist for its song count on each render, and opening
  one asks again) and a guard that the song index is loaded before a personal
  setlist tries to resolve its song names.
*/
export function createSetlistData(ctx) {
  const bandCache = {};

  return {
    loadBand(file, onLoad, onError) {
      if (bandCache[file]) {
        onLoad(bandCache[file]);
        return;
      }
      ctx.readFile(`/setlists/${file}`, (text) => {
        bandCache[file] = parseSetlistFile(text);
        onLoad(bandCache[file]);
      }, onError);
    },

    ensureSongsLoaded(callback, onError) {
      if (ctx.state.allSongsLoaded) {
        callback();
        return;
      }
      ctx.readFile("/songs/index_of_songs.txt", (data) => {
        ctx.state.allSongs = parseSongIndex(data);
        ctx.state.allSongsLoaded = true;
        callback();
      }, (status) => {
        if (onError) onError(status);
      });
    },
  };
}
