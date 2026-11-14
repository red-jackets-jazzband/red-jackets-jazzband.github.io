/*
  What the two panels of the Connect devices dialog share (#syncModal): the
  personal sync (sync.js) and the shared spaces (band.js) are separate
  features that reach each other only through `ctx`, so the helpers both draw
  with live here instead of one feature importing the other's module.
*/
import { byId, clear, loadScriptOnce } from "../../lib/core/dom.js";
import { tl } from "../../lib/core/i18n.js";
import { qrPath } from "../../lib/sync/qr.js";

const QR_SRC = "/script/qrcode-generator-2.0.4-min.js";
const SVG_NS = "http://www.w3.org/2000/svg";

export function statusText(result, time) {
  switch (result.status) {
    case "ok": return tl("sync_ok", "Synced {time}", { time });
    case "working": return tl("sync_working", "Syncing…");
    case "offline": return tl("sync_offline", "Offline — will sync when you're back online");
    case "notFound": return tl("sync_not_found", "No sync found for this code");
    case "oldKept": return tl("sync_old_kept", "New code made, but the old sync couldn't be deleted yet — we'll retry");
    case "gone": return tl("sync_gone", "This sync was stopped or replaced");
    case "tooLarge": return tl("sync_too_large", "Too much to sync — remove some setlists or song forms");
    case "limited": return tl("sync_limited", "Too many new syncs right now — try again later");
    case "newerFormat": return tl("sync_newer", "This page is out of date — reload it to sync");
    case "badCode": return tl("sync_bad_code", "That code isn't right — check it and try again");
    case "off": return tl("sync_off", "Not connected");
    default: return tl("sync_error", "Sync failed — will try again");
  }
}

export function clockTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

// The pairing QR as SVG children: a white plate (the quiet zone) and one path.
function drawQr(svg, url) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const { d, size } = qrPath((row, col) => { return qr.isDark(row, col); }, qr.getModuleCount());
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  clear(svg);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#1b1b1b");
  svg.append(path);
}

// Draws `url` as a QR code into `svg`; the generator loads on first use (and is precached for offline).
export function renderQr(svg, url) {
  const ready = typeof qrcode === "undefined" ? loadScriptOnce(QR_SRC) : Promise.resolve();
  return ready.then(() => { drawQr(svg, url); });
}

// A status row (`rowId`: the status line and its "Sync now" button) takes up no room
// while it has nothing to say: no text and no button. Set from script, not
// with CSS :has() (Safari 15.4+: an older browser drops the whole rule and
// shows an empty row).
export function updateStatusRow(rowId, statusId, buttonId) {
  const row = byId(rowId);
  const line = byId(statusId);
  const button = byId(buttonId);
  if (row && line) row.hidden = line.textContent === "" && (!button || button.hidden);
}
