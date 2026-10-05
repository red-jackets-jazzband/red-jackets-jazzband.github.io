import { byId, el, qsa } from "../../lib/core/dom.js";
import {
  extractKeyFromAbc, setlistTransposeSteps, formatSetlistKeyLabel,
  resolvedSetlistKeyName, tempoBpmFromAbc,
} from "../../lib/music/music-theory.js";

/*
  The read-only key/bpm badge on every setlist row (band or personal): the
  tune's actual resulting key — its own K: plus the row's override — and its
  native tempo, which need the tune's own .abc, so each file is fetched once
  (createSetlistKeys keeps the cache for the life of the setlist view) and
  every rendered row's badge refreshes in place once it lands.
*/
export function createSetlistKeys(ctx) {
  // A song's own written key (its K: field) and native tempo (its Q: field),
  // fetched once per file (one XHR covers both) and kept for the life of
  // this view — every open setlist's key display (band badge or personal key
  // picker) reads off the cached key rather than the raw override, so
  // "F, +2" shows as the real resulting key ("G") instead of a semitone
  // count. undefined = not yet requested, null = fetched but no K:/Q: found.
  const nativeKeyCache = {};
  const nativeBpmCache = {};
  const pendingKeyFetches = new Set();

  function resolveNativeKey(file) {
    if (Object.prototype.hasOwnProperty.call(nativeKeyCache, file) || pendingKeyFetches.has(file)) return;
    pendingKeyFetches.add(file);
    const settle = (key, bpm) => {
      nativeKeyCache[file] = key;
      nativeBpmCache[file] = bpm;
      pendingKeyFetches.delete(file);
      updateKeyDisplays();
    };
    ctx.readFile(
      `/songs/${file}`,
      (text) => settle(extractKeyFromAbc(text), tempoBpmFromAbc(text)),
      () => settle(null, null),
    );
  }

  // What a row's key control should currently show, given what's known about
  // the song's own key so far. `disabled` covers both "still loading" and
  // "the tune's key couldn't be read at all" — a personal setlist's picker
  // can't offer a meaningful palette without a native key to diff against.
  function keyDisplayInfo(song) {
    const known = Object.prototype.hasOwnProperty.call(nativeKeyCache, song.file);
    const nativeKey = known ? nativeKeyCache[song.file] : undefined;
    if (!known) return { disabled: true, text: "", isTransposed: false };
    if (!nativeKey) {
      const fallback = formatSetlistKeyLabel(song.key);
      return { disabled: true, text: fallback, isTransposed: Boolean(fallback) };
    }
    return {
      disabled: false,
      text: resolvedSetlistKeyName(song.key, nativeKey),
      isTransposed: setlistTransposeSteps(song.key, nativeKey) !== 0,
    };
  }

  // Refresh every currently-rendered row's key control from the cache/song
  // data, without a full re-render — called once a fetch settles, and safe to
  // call any other time too (e.g. nothing to do if nothing's changed).
  function updateKeyDisplays() {
    const listEl = byId("songList");
    if (!listEl) return;
    qsa(".setlist-song-row", listEl).forEach((row) => {
      const song = ctx.state.currentOpenSongs
        && ctx.state.currentOpenSongs[Number(row.dataset.setlistIndex)];
      if (song) applyKeyDisplay(row, song);
    });
  }

  function applyBadgeDisplay(badge, song) {
    const info = keyDisplayInfo(song);
    const keyEl = badge.querySelector(".setlist-song-key-badge-key");
    keyEl.textContent = info.text;
    badge.classList.toggle("is-transposed", info.isTransposed);

    // The tune's own native bpm (Q: field) — read-only everywhere, same as
    // the key, since a setlist has no per-song tempo override to resolve.
    const bpmEl = badge.querySelector(".setlist-song-key-badge-bpm");
    const bpm = Object.prototype.hasOwnProperty.call(nativeBpmCache, song.file)
      ? nativeBpmCache[song.file]
      : null;
    bpmEl.textContent = bpm ? String(bpm) : "";
    bpmEl.hidden = !bpm;
  }

  function applyKeyDisplay(row, song) {
    const badge = row.querySelector(".setlist-song-key-badge");
    if (badge) applyBadgeDisplay(badge, song);
  }

  // Every row's key is read-only here, band setlist or personal — the same
  // badge either way, so a personal setlist's list looks and reads like a
  // band one. A personal setlist's per-song override is still editable, but
  // only via the Key stepper above the sheet while that song is open
  // (initTransposeWriteBack below), not from the list itself. The tune's
  // native bpm sits just underneath, small, the same caption treatment the
  // Inspiration panel's A/B loop-marker buttons use for their own timestamp.
  function keyBadge(song) {
    const badge = el("span", { class: "setlist-song-key-badge" }, [
      el("span", { class: "setlist-song-key-badge-key" }),
      el("span", { class: "setlist-song-key-badge-bpm", hidden: true }),
    ]);
    resolveNativeKey(song.file);
    applyBadgeDisplay(badge, song);
    return badge;
  }

  return { keyBadge, updateKeyDisplays };
}
