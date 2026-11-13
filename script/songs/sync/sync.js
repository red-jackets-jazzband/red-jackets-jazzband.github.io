import { byId, clear, loadScriptOnce, on } from "../../lib/core/dom.js";
import { hashWithoutSync, syncCodeFromHash } from "../../lib/core/song-hash.js";
import { tl } from "../../lib/core/i18n.js";
import { createSyncEngine, CODE_KEY } from "../../lib/sync/engine.js";
import { formatCode } from "../../lib/sync/crypto.js";
import { onLocalChange } from "../../lib/sync/changes.js";
import { holdLease, releaseLease } from "../../lib/sync/lease.js";
import { createLiveChannel } from "../../lib/sync/live.js";
import { pairingUrl, qrPath } from "../../lib/sync/qr.js";
import { afterPageLoad } from "../core/after-load.js";

/*
  Device sync (docs/device-sync-plan.md): opt-in, off by default — until the
  visitor connects, this makes no request at all. Once connected it syncs when
  it matters (page load, page shown again, back online, the Setlists tab opened
  — at most every PULL_GAP_MS) and uploads once, UPLOAD_DELAY_MS after a burst
  of local edits ends. No timer polling. One tab per device runs the cycles
  (lib/sync/lease.js); the others redraw from the `storage` event.
*/
const UPLOAD_DELAY_MS = 3000;
const PULL_GAP_MS = 30000;
const LEASE_RENEW_MS = 5000;
const QR_SRC = "/script/qrcode-generator-2.0.4-min.js";
const SVG_NS = "http://www.w3.org/2000/svg";
const DIRTY_KEY = "rj.sync.dirty";
const WATCHED_KEYS = new Set(["rj.setlists.v1", "rj.sync.meta"]);

function statusText(result, time) {
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

function clockTime() {
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

function hideQr() {
  const box = byId("syncQrBox");
  const toggle = byId("syncQrToggle");
  if (box) box.hidden = true;
  if (toggle) {
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = tl("sync_qr_show", "Show QR code");
  }
}

function closeDialog() {
  const overlay = byId("syncModal");
  if (overlay) overlay.hidden = true;
}

export function createSync(ctx) {
  const tabId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); // eslint-disable-line sonarjs/pseudo-random -- a lease id, not a secret
  let engine = null;
  const flags = { busy: false, acting: false, leaseTimer: null };
  let uploadTimer = null;
  let changeGen = 0; // counts local edits; a cycle that began before one can't clear "dirty"
  let lastPull = 0;
  let lastResult = { status: "off" };
  let live = null;
  // Read at creation, before navigation's own hash rewriting can drop it.
  const pairingCode = syncCodeFromHash(window.location.hash);

  const storage = () => { return ctx.storage(); };
  const getEngine = () => {
    if (!engine) engine = createSyncEngine({ storage: storage(), fetchFn: (...args) => { return window.fetch(...args); } });
    return engine;
  };
  const connected = () => { return Boolean(storage()) && getEngine().code() !== null; };

  function setDirty(on_) {
    try {
      // A new value each time, so other tabs get a `storage` event for every edit.
      if (on_) storage().setItem(DIRTY_KEY, String(Date.now()) + ":" + changeGen);
      else storage().removeItem(DIRTY_KEY);
    } catch (_e) {
      // storage unavailable — the next page load syncs anyway.
    }
  }

  function redraw() {
    if (ctx.state.activeTab === "setlists") {
      if (ctx.state.setlistsView === "home") ctx.setlistHome.render();
      else if (ctx.state.currentPersonalId) ctx.setlistView.refreshOpenPersonal();
    }
    if (ctx.songForm) ctx.songForm.refresh();
  }

  // A pushed version newer than ours: pull now.
  function onPushed(version) {
    if (version > getEngine().knownVersion()) { lastPull = 0; settle(run()); }
  }

  function openSocket() {
    return getEngine().liveUrl().then((url) => { return url ? new window.WebSocket(url) : null; });
  }

  // Open only in the visible tab that holds the lease; closed otherwise.
  function syncLive() {
    const wanted = connected() && !document.hidden && typeof window.WebSocket === "function"
      && holdLease(storage(), tabId, Date.now());
    if (wanted && !live) {
      live = createLiveChannel({ connect: openSocket, onVersion: onPushed });
      settle(live.start());
    } else if (!wanted && live) {
      live.stop();
      live = null;
    }
  }

  // The lease is renewed only while connected; a never-connected page has no timer at all.
  function syncLeaseTimer(isOn) {
    if (isOn && !flags.leaseTimer) {
      flags.leaseTimer = setInterval(() => { if (!flags.busy) { holdLease(storage(), tabId, Date.now()); syncLive(); } }, LEASE_RENEW_MS);
    } else if (!isOn && flags.leaseTimer) {
      clearInterval(flags.leaseTimer);
      flags.leaseTimer = null;
    }
  }

  // Show the pairing QR; the generator loads on first use (and is precached for offline).
  function toggleQr() {
    const box = byId("syncQrBox");
    if (!box) return Promise.resolve();
    if (!box.hidden) { hideQr(); return Promise.resolve(); }
    const code = getEngine().code();
    if (!code) return Promise.resolve();
    const ready = typeof qrcode === "undefined" ? loadScriptOnce(QR_SRC) : Promise.resolve();
    return ready.then(() => {
      drawQr(byId("syncQr"), pairingUrl(window.location.href, formatCode(code)));
      box.hidden = false;
      const toggle = byId("syncQrToggle");
      toggle.setAttribute("aria-expanded", "true");
      toggle.textContent = tl("sync_qr_hide", "Hide QR code");
    });
  }

  function render() {
    const code = connected() ? getEngine().code() : null;
    syncLeaseTimer(Boolean(code));
    syncLive();
    const shown = lastResult;
    const line = byId("syncStatus");
    if (line) line.textContent = statusText(shown, clockTime());
    const codeBox = byId("syncCodeBox");
    if (codeBox) codeBox.hidden = !code;
    if (!code) hideQr();
    const setup = byId("syncSetup");
    if (setup) setup.hidden = Boolean(code);
    const codeEl = byId("syncCode");
    if (codeEl) codeEl.textContent = code ? formatCode(code) : "";
  }

  function finish(result, gen) {
    lastResult = result;
    if (result.status === "ok") {
      if (gen === changeGen) setDirty(false);
      else uploadSoon(); // edited while the cycle ran: it isn't in what was sent
    }
    if (result.changed) redraw(); // whatever the upload did, storage changed
    render();
    return result;
  }

  async function run() {
    if (!connected() || flags.busy || !holdLease(storage(), tabId, Date.now())) return null;
    flags.busy = true;
    lastPull = Date.now();
    const gen = changeGen;
    lastResult = { status: "working" };
    render();
    return getEngine().sync().then((result) => {
      flags.busy = false;
      return finish(result, gen);
    }, () => {
      flags.busy = false;
      return finish({ status: "error" }, gen);
    });
  }

  // Fire-and-forget with a catch: a failing step shows as "Sync failed".
  function settle(promise) {
    promise.catch(() => { lastResult = { status: "error" }; render(); });
  }

  // One upload UPLOAD_DELAY_MS from now (the tab holding the lease does the work).
  function uploadSoon() {
    if (!connected()) return;
    changeGen += 1;
    clearTimeout(uploadTimer);
    uploadTimer = setTimeout(() => { settle(run()); }, UPLOAD_DELAY_MS);
  }

  function scheduleUpload() {
    if (!connected()) return;
    uploadSoon();
    setDirty(true);
  }

  const MANAGEMENT_BUTTONS = ["syncConnect", "syncJoin", "syncNow", "syncDisconnect", "syncDelete", "syncNewCode"];

  // While one of these actions is on the wire, the others can't be started.
  function lockManagement(locked) {
    flags.acting = locked;
    MANAGEMENT_BUTTONS.forEach((id) => {
      const button = byId(id);
      if (button) button.disabled = locked;
    });
  }

  function pullIfStale() {
    if (connected() && Date.now() - lastPull > PULL_GAP_MS) settle(run());
  }

  async function action(work, confirmText) {
    if (flags.acting || flags.busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    const gen = changeGen;
    lastResult = { status: "working" };
    lockManagement(true);
    flags.busy = true; // no sync cycle runs meanwhile
    render();
    const result = await work().catch(() => { return { status: "error" }; });
    flags.busy = false; // eslint-disable-line require-atomic-updates -- one action at a time (flags.acting)
    lockManagement(false);
    if (result.status === "ok") lastPull = Date.now();
    finish(result, gen);
  }

  function initDialog() {
    const overlay = byId("syncModal");
    if (!overlay) return;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeDialog(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeDialog(); });
    on("syncClose", "click", closeDialog);
    on("syncDone", "click", closeDialog);
    on("syncConnect", "click", () => { settle(action(() => getEngine().connect())); });
    const join = () => { settle(action(() => getEngine().join(byId("syncCodeInput").value))); };
    on("syncJoin", "click", join);
    on("syncCodeInput", "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); join(); } });
    on("syncQrToggle", "click", () => { settle(toggleQr()); });
    on("syncNow", "click", () => { lastPull = 0; settle(run()); });
    on("syncDisconnect", "click", () => {
      if (flags.acting) return;
      getEngine().disconnect();
      lastResult = { status: "off" };
      render();
    });
    on("syncDelete", "click", () => {
      settle(action(() => getEngine().deleteServerCopy(),
        tl("sync_delete_confirm", "Delete the server copy? Your other devices will be disconnected; the setlists on each device stay.")));
    });
    on("syncNewCode", "click", () => {
      settle(action(() => getEngine().newCode(),
        tl("sync_new_code_confirm", "Make a new code? Your other devices are disconnected until you enter it there.")));
    });
  }

  // A pairing link (#sync=<code>): take the code out of the address bar at once,
  // then join after a confirmation (WBS 7.2). Already connected: just strip it.
  function takePairingLink() {
    const code = pairingCode;
    if (code === null) return;
    const rest = hashWithoutSync(window.location.hash);
    window.history.replaceState(null, "", window.location.pathname + window.location.search + (rest ? `#${rest}` : ""));
    if (connected() || !storage()) return;
    if (window.confirm(tl("sync_pair_confirm", "Connect this device to the sync from the link you opened? Your setlists and song forms will be merged with the ones already synced."))) {
      settle(action(() => { return getEngine().join(code); }));
    }
  }

  function openDialog() {
    const overlay = byId("syncModal");
    if (!overlay) return;
    render();
    overlay.hidden = false;
    const first = byId(connected() ? "syncNow" : "syncConnect");
    if (first) first.focus();
  }

  return {
    open: openDialog,

    isConnected: connected,

    init() {
      initDialog();
      on("syncBtn", "click", () => { openDialog(); });
      takePairingLink();
      onLocalChange(scheduleUpload);
      // Another tab (or a sync in it) wrote storage: redraw from it.
      window.addEventListener("storage", (e) => {
        if (e.key === null || WATCHED_KEYS.has(e.key) || (e.key || "").startsWith("rj.songForm.")) redraw();
        // An edit in another tab: if this tab holds the lease, it uploads it.
        if (e.key === DIRTY_KEY && e.newValue) uploadSoon();
        if (e.key === CODE_KEY) render();
      });
      document.addEventListener("visibilitychange", () => { syncLive(); if (!document.hidden) pullIfStale(); });
      window.addEventListener("online", () => { lastPull = 0; settle(run()); });
      window.addEventListener("pagehide", () => {
        if (live) live.stop();
        live = null;
        releaseLease(storage(), tabId);
      });
      ctx.store.subscribe("nav", () => { if (ctx.state.activeTab === "setlists") pullIfStale(); });
      if (!connected()) return Promise.resolve();
      syncLeaseTimer(true);
      return afterPageLoad().then(() => { lastPull = 0; return run(); }).then(() => undefined);
    },
  };
}
