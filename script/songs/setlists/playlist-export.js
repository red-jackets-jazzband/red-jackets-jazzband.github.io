import { byId, clear, el } from "../../lib/core/dom.js";
import {
  buildSoundiizPayload, soundiizShareUrl, SOUNDIIZ_ENDPOINT,
} from "../../lib/setlists/setlist-listen.js";
import { tl } from "../../lib/core/i18n.js";

/*
  The Listen group's "Export" button: saves the open setlist as a playlist
  on the visitor's own streaming account (Spotify, Apple Music, YouTube
  Music, Deezer, TIDAL, … — they pick on Soundiiz's side), through Soundiiz's
  public Playlist Import API (see lib/setlists/setlist-listen.js). The click
  POSTs the tracklist — each song pinned to its own Spotify track, else
  YouTube video, else SoundCloud track, else just its title — and sends the
  visitor to the temporary import page Soundiiz answers with, where they sign
  in and save it.

  The new tab is opened synchronously inside the click, *before* the request,
  and only pointed at Soundiiz once the reply lands: a window.open() made
  after an await is no longer a user gesture, and popup blockers (Safari's
  above all) would swallow it.
*/

const BUSY_TEXT = tl("soundiiz_busy", "Sending the setlist to Soundiiz…");
const FAIL_TEXT = tl("soundiiz_fail", "Couldn’t reach Soundiiz — try again in a moment.");

// How long to wait for Soundiiz before giving up: a request that never
// settles would otherwise leave the button busy and the blank tab open.
const REQUEST_TIMEOUT_MS = 15000;

function setStatus(children) {
  const node = byId("listenStatus");
  if (!node) return;
  clear(node);
  if (!children) {
    node.hidden = true;
    return;
  }
  node.append(...[children].flat());
  node.hidden = false;
}

// Rejects if `promise` hasn't settled within `ms`. A plain race against a
// timer rather than an AbortController, which Safari 12.0 doesn't have; the
// abandoned request is simply ignored.
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => { reject(new Error(`No reply from Soundiiz within ${ms} ms`)); }, ms);
  });
  const settle = () => { clearTimeout(timer); };
  return Promise.race([promise, deadline]).then((value) => {
    settle();
    return value;
  }, (err) => {
    settle();
    throw err;
  });
}

function requestShareUrl(payload) {
  return fetch(SOUNDIIZ_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  })
    .then((response) => response.json())
    .then((reply) => {
      const url = soundiizShareUrl(reply);
      if (!url) throw new Error("Soundiiz did not return an import link");
      return url;
    });
}

// A blank tab to steer once the reply lands, cut loose from this page
// (window.open's "noopener" feature would hand back null, leaving nothing to
// steer). Null when a popup blocker refused it.
function openPendingTab() {
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  return tab;
}

// Called with print.js's listen-change payload; enabled once there's at
// least one song to send (every song counts — one with no link still goes
// over by title).
export function updateExportButton(songs) {
  const btn = byId("listenExportBtn");
  if (!btn) return;
  const ready = songs.some((song) => song && song.title); // NOSONAR: `?.` is a SyntaxError on Safari 12 (see Browser support)
  btn.disabled = !ready;
  btn.title = ready
    ? tl("soundiiz_export_title", "Export this setlist as a playlist to Spotify, Apple Music, YouTube Music… (via Soundiiz)")
    : tl("soundiiz_export_none", "No songs in this setlist");
  setStatus(null);
}

export function createPlaylistExport(ctx, options = {}) {
  const timeoutMs = options.timeoutMs || REQUEST_TIMEOUT_MS;
  let busy = false;

  function payload() {
    const print = ctx.setlistPrint;
    return buildSoundiizPayload(print.getListenTitle(), print.getListenSongs());
  }

  function send() {
    const body = payload();
    if (busy || !body) return;
    busy = true;
    const tab = openPendingTab();
    setStatus(BUSY_TEXT);
    const done = () => { busy = false; };
    withDeadline(requestShareUrl(body), timeoutMs)
      .then((url) => {
        if (tab) {
          tab.location.replace(url);
          setStatus(null);
        } else {
          setStatus(el("a", { href: url, target: "_blank", rel: "noopener", text: tl("soundiiz_open", "Open the playlist on Soundiiz") }));
        }
      })
      .catch((err) => {
        console.warn("Soundiiz import failed:", err);
        if (tab) tab.close();
        setStatus(FAIL_TEXT);
      })
      .then(done, done);
  }

  function init() {
    const btn = byId("listenExportBtn");
    if (btn) btn.addEventListener("click", send);
  }

  return { init, update: updateExportButton, send };
}
