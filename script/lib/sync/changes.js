/*
   A one-way "something local changed" signal for device sync: the setlists
   store and the song-form editor call `notifyLocalChange()` after a user edit,
   and the sync feature listens (songs/sync/sync.js) to upload a few seconds
   later. A merge writing synced data back does not notify — that would just
   upload what was downloaded.
*/
const listeners = [];

export function onLocalChange(listener) {
  listeners.push(listener);
}

export function notifyLocalChange() {
  listeners.forEach((listener) => { listener(); });
}
