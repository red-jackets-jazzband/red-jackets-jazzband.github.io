import { byId, clear, el, on } from "../../lib/core/dom.js";
import { hashWithoutSync, syncCodeFromHash } from "../../lib/core/song-hash.js";
import { tl } from "../../lib/core/i18n.js";
import { createVaultEngine } from "../../lib/sync/engine.js";
import {
  MAX_BANDS, bandCodec, cleanName, connectedBands, defaultBandLabel, forgetBand, listBands, newBandId, readProfile, registerBand, renameBand, setDisplayName,
} from "../../lib/sync/band-vault.js";
import { formatCode, parseCode } from "../../lib/sync/crypto.js";
import { onLocalChange } from "../../lib/sync/changes.js";
import { pairingUrl } from "../../lib/sync/qr.js";
import { afterPageLoad } from "../core/after-load.js";
import { fallbackCopy, flashShareBtn } from "../inspiration/share.js";
import { clockTime, renderQr, statusText } from "./sync.js";

/*
  Band spaces (docs/device-sync-plan.md, phase 2): optional vaults, each with
  its own code, holding the song-form versions a member shares under their
  name and the setlists made in it (the Setlists tab's Shared shelf). A device can be in several (up to MAX_BANDS), each with its own name
  and a label only this device sees; the dialog's band tab shows one at a time,
  chosen from a row of chips, with "+" to start or join another. Like the
  personal sync it makes no request until a code exists, and it syncs every
  band it is in when it matters: page load, page shown again, back online, and
  UPLOAD_DELAY_MS after a local edit. (No push channel and no tab lease yet:
  two tabs just race, and the engine's conflict retry sorts that out.)
*/
const UPLOAD_DELAY_MS = 3000;
const PULL_GAP_MS = 30000;

function bandStatusText(result) {
  if (result.status === "needName") return tl("band_need_name", "Type your name first — your bandmates will see it");
  if (result.status === "pairHint") return tl("band_pair_hint", "Type your name, then press Join to enter this shared space");
  if (result.status === "off") return tl("band_off", "Not in a shared space");
  if (result.status === "already") return tl("band_already", "You are already in this shared space");
  if (result.status === "keepFailed") return tl("band_keep_failed", "Couldn't keep this space's setlists on this device (storage is full?). Nothing was removed.");
  return statusText(result, clockTime());
}

// The dialog has two tabs: this device's own sync, and the band space.
function showPanel(band) {
  const panels = [["syncPanelDevices", "syncTabDevices", !band], ["syncPanelBand", "syncTabBand", band]];
  panels.forEach(([panel, tab, shown]) => {
    const panelEl = byId(panel);
    if (panelEl) panelEl.hidden = !shown;
    const tabEl = byId(tab);
    if (tabEl) tabEl.setAttribute("aria-pressed", String(shown));
  });
}

// Copies `url`, flashing a tick on `button`.
function copyLink(url, button) {
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") {
    fallbackCopy(url, button);
    return;
  }
  clipboard.writeText(url).then(() => { flashShareBtn(button); }, () => { fallbackCopy(url, button); });
}

export function createBand(ctx) {
  const engines = new Map(); // band id → its sync engine
  const results = new Map(); // band id → the last result, for the status line
  const busy = new Set(); // ids with a sync or an action in flight
  const rerun = new Set(); // ids that were asked to sync while busy: once more when done
  let current = null; // the band id shown, or null while starting / joining another
  let draftResult = { status: "off" };
  let timer = null;
  let lastPull = 0;
  const qrFor = { id: null, code: null }; // the band and code the drawn QR belongs to
  // Read at creation, before navigation's own hash rewriting can drop it.
  const pairingCode = syncCodeFromHash(window.location.hash, "band");

  const storage = () => { return ctx.storage(); };
  const joined = () => { return connectedBands(storage()); };
  const engineFor = (id) => {
    if (!engines.has(id)) engines.set(id, createVaultEngine({ storage: storage(), fetchFn: (...args) => { return window.fetch(...args); }, codec: bandCodec(id) }));
    return engines.get(id);
  };
  const connected = () => { return joined().length > 0; };
  const currentBand = () => { return joined().find((band) => { return band.id === current; }) || null; };
  const resultFor = (id) => { return id === null ? draftResult : results.get(id) || { status: "off" }; };
  const setResult = (id, result) => {
    if (id === null) draftResult = result;
    else results.set(id, result);
  };

  const shareLink = (code) => { return pairingUrl(window.location.href, formatCode(code), "band"); };

  function sharePieces() {
    const link = shareLink(engineFor(current).code());
    return {
      link,
      subject: tl("band_share_subject", "Red Jackets shared space"),
      text: tl("band_share_text", "Join our shared space for song forms and setlists: {link}", { link }),
    };
  }

  function initShare() {
    const nativeShare = byId("bandShare");
    if (nativeShare && typeof navigator.share === "function") nativeShare.hidden = false;
    on("bandShare", "click", () => {
      const { link, subject, text } = sharePieces();
      // A dismissed share sheet rejects: nothing to report.
      navigator.share({ title: subject, text, url: link }).catch(() => undefined);
    });
    on("bandWhatsapp", "click", () => {
      window.open(`https://wa.me/?text=${encodeURIComponent(sharePieces().text)}`, "_blank", "noopener");
    });
    on("bandMail", "click", () => {
      const { subject, text } = sharePieces();
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    });
    on("bandCopyLink", "click", () => { copyLink(sharePieces().link, byId("bandCopyLink")); });
  }

  // The band this code already belongs to, if any.
  function bandWithCode(input) {
    const code = parseCode(input);
    return code ? joined().find((band) => { return engineFor(band.id).code() === code; }) || null : null;
  }

  // A band link (#band=<code>): take the code out of the address bar and open
  // the dialog on the band tab with it filled in; joining still needs a name.
  // A code of a band space already joined just shows that one.
  function takePairingLink() {
    if (pairingCode === null) return;
    const rest = hashWithoutSync(window.location.hash, "band");
    window.history.replaceState(null, "", window.location.pathname + window.location.search + (rest ? `#${rest}` : ""));
    if (!storage()) return;
    const known = bandWithCode(pairingCode);
    if (known) {
      current = known.id;
    } else {
      if (joined().length >= MAX_BANDS) return;
      current = null;
      const input = byId("bandCodeInput");
      if (input) input.value = pairingCode;
      draftResult = { status: "pairHint" };
    }
    showPanel(true);
    render();
    if (ctx.sync) ctx.sync.open();
    const name = byId("bandName");
    if (name && current === null) name.focus();
  }

  function chip(band) {
    return el("button", {
      class: "rj-band-chip",
      text: band.label,
      attrs: { type: "button", "aria-pressed": String(band.id === current), "data-band": band.id },
      on: { click: () => { select(band.id); } },
    });
  }

  // One chip per band space joined, and "+" for another.
  function renderChips(list) {
    const row = byId("bandTabs");
    if (!row) return;
    row.hidden = list.length === 0;
    clear(row);
    list.forEach((band) => { row.append(chip(band)); });
    if (list.length >= MAX_BANDS) return;
    row.append(el("button", {
      class: "rj-band-chip rj-band-chip-add",
      text: "+",
      attrs: {
        type: "button",
        id: "bandAdd",
        "aria-pressed": String(current === null),
        "aria-label": tl("band_add", "Start or join another shared space"),
        title: tl("band_add", "Start or join another shared space"),
      },
      on: { click: () => { startAnother(); } },
    }));
  }

  function renderQrFor(band, code) {
    if (!code) {
      qrFor.id = null;
      return;
    }
    if (qrFor.id === band && qrFor.code === code) return;
    qrFor.id = band;
    qrFor.code = code;
    renderQr(byId("bandQr"), shareLink(code)).catch(() => { qrFor.id = null; });
  }

  // The setup form or the box for the band shown, and what hangs off each.
  function renderBand(band) {
    const code = band ? engineFor(band.id).code() : null;
    const set = (id, hidden) => { const node = byId(id); if (node) node.hidden = hidden; };
    set("bandSetup", Boolean(band));
    set("bandBox", !band);
    set("bandNow", !band);
    set("bandFoot", !band);
    set("bandIntro", Boolean(band));
    set("bandLabelField", !band);
    const codeEl = byId("bandCode");
    if (codeEl) codeEl.textContent = code ? formatCode(code) : "";
    renderQrFor(band ? band.id : null, code);
  }

  // The name and label fields (left alone while being typed in).
  function renderFields(band) {
    const name = byId("bandName");
    if (name && storage() && name !== document.activeElement) name.value = band ? readProfile(storage(), band.id).name : "";
    const label = byId("bandLabel");
    if (label && label !== document.activeElement) label.value = band ? band.label : "";
  }

  function render() {
    const list = joined();
    if (current !== null && !list.some((band) => { return band.id === current; })) current = null;
    renderChips(list);
    const band = currentBand();
    renderBand(band);
    const status = byId("bandStatus");
    if (status) status.textContent = bandStatusText(resultFor(band ? band.id : null));
    renderFields(band);
  }

  function select(id) {
    current = id;
    render();
  }

  function startAnother() {
    current = null;
    draftResult = { status: "off" };
    const input = byId("bandCodeInput");
    if (input) input.value = "";
    render();
    const name = byId("bandName");
    if (name) name.focus();
  }

  // After the last band space goes, or the one shown does, show the first left.
  function showFirstLeft() {
    const first = joined()[0];
    current = first ? first.id : null;
  }

  // The Setlists tab's Shared shelves (or an open shared setlist) after the
  // space's setlists changed — a sync brought others' edits, or a space went.
  function refreshSetlists() {
    if (ctx.state.activeTab !== "setlists") return;
    if (ctx.state.setlistsView === "home") ctx.setlistHome.render();
    else if (ctx.state.currentPersonalId) ctx.setlistView.refreshOpenPersonal();
  }

  // Takes a space off this device, keeping its setlists as personal ones. False
  // (and nothing removed) when they couldn't be copied. A shared setlist open
  // from it is closed, since its storage is gone.
  function dropSpace(id) {
    if (!forgetBand(storage(), id)) return false;
    engines.delete(id);
    if (ctx.state.currentBandId === id) ctx.nav.leaveSetlist();
    return true;
  }

  function finish(id, result) {
    setResult(id, result);
    // The engine clears the code itself when the vault is gone; tidy what came from it.
    if ((result.status === "gone" || result.status === "notFound") && id !== null) {
      if (!dropSpace(id)) {
        // The space stays listed (its shelf too) for a retry; say why, where it will still show.
        if (current === id) showFirstLeft();
        draftResult = { status: "keepFailed" };
      } else if (current === id) {
        showFirstLeft();
        draftResult = result;
      }
    }
    if (result.changed && ctx.songForm) ctx.songForm.refresh();
    if (result.changed || result.status === "gone" || result.status === "notFound") refreshSetlists();
    render();
    return result;
  }

  async function run(id) {
    if (!joined().some((band) => { return band.id === id; })) return;
    if (busy.has(id)) {
      rerun.add(id); // an edit landed while a sync is in flight: sync again after it
      return;
    }
    busy.add(id);
    lastPull = Date.now();
    setResult(id, { status: "working" });
    render();
    const result = await engineFor(id).sync().catch(() => { return { status: "error" }; });
    busy.delete(id);
    finish(id, result);
    if (rerun.delete(id)) await run(id);
  }

  const runAll = () => { return Promise.all(joined().map((band) => { return run(band.id); })); };

  // Fire-and-forget with a catch: a failing step shows as "Sync failed".
  function settle(promise, id = current) {
    promise.catch(() => { setResult(id, { status: "error" }); render(); });
  }

  function uploadSoon() {
    if (!connected()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { settle(runAll()); }, UPLOAD_DELAY_MS);
  }

  async function action(id, work, confirmText) {
    if (busy.has(id)) return;
    if (confirmText && !window.confirm(confirmText)) return;
    busy.add(id);
    setResult(id, { status: "working" });
    render();
    const result = await work().catch(() => { return { status: "error" }; });
    busy.delete(id);
    if (result.status === "ok") lastPull = Date.now();
    finish(id, result);
    if (rerun.delete(id)) await run(id); // an edit came in while this action was on the wire
  }

  // `id` is a joined band, or a fresh one being started (not listed yet).
  function saveName(id) {
    const input = byId("bandName");
    if (!input || !storage()) return false;
    const name = cleanName(input.value);
    if (!name) return false;
    if (readProfile(storage(), id).name !== name) {
      setDisplayName(storage(), id, name);
      uploadSoon();
    }
    return true;
  }

  // Starting or joining a new band space: needs a name first; a failure
  // leaves nothing behind, a success lists it and shows it.
  function startOrJoin(work) {
    const id = newBandId();
    if (!saveName(id)) {
      forgetBand(storage(), id);
      draftResult = { status: "needName" };
      render();
      return;
    }
    const attempt = async () => {
      const result = await work(engineFor(id));
      if (result.status === "ok") {
        registerBand(storage(), id, defaultBandLabel(joined().length + 1));
        current = id;
        draftResult = { status: "off" };
      } else {
        forgetBand(storage(), id, { keepSetlists: false }); // a failed join: drop what it downloaded
        engines.delete(id);
      }
      return result;
    };
    // The draft isn't listed, so its result is the draft one, not a band's.
    settle(draftAction(attempt), null);
  }

  async function draftAction(attempt) {
    if (busy.has("draft")) return;
    busy.add("draft");
    draftResult = { status: "working" };
    render();
    const result = await attempt().catch(() => { return { status: "error" }; });
    busy.delete("draft");
    if (result.status === "ok") {
      lastPull = Date.now();
      results.set(current, result);
    } else {
      draftResult = result;
    }
    if (result.changed && ctx.songForm) ctx.songForm.refresh();
    // A new space gets its (maybe empty) shelf at once, changed or not.
    if (result.changed || result.status === "ok") refreshSetlists();
    render();
  }

  function joinFromInput() {
    const input = byId("bandCodeInput").value;
    const known = bandWithCode(input);
    if (known) {
      current = known.id;
      render();
      return;
    }
    startOrJoin((engine) => { return engine.join(input); });
  }

  function initDialog() {
    on("syncTabDevices", "click", () => { showPanel(false); });
    on("syncTabBand", "click", () => { showPanel(true); });
    on("bandName", "change", () => { if (current !== null) saveName(current); });
    on("bandLabel", "change", () => {
      if (current === null) return;
      renameBand(storage(), current, byId("bandLabel").value);
      render();
    });
    on("bandConnect", "click", () => { startOrJoin((engine) => { return engine.connect(); }); });
    on("bandJoin", "click", () => { joinFromInput(); });
    on("bandCodeInput", "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); joinFromInput(); } });
    on("bandNow", "click", () => { if (current !== null) settle(run(current)); });
    on("bandLeave", "click", () => {
      if (current === null) return;
      const id = current;
      if (!dropSpace(id)) {
        setResult(id, { status: "keepFailed" });
        render();
        return;
      }
      engineFor(id).disconnect();
      engines.delete(id);
      showFirstLeft();
      draftResult = { status: "off" };
      if (ctx.songForm) ctx.songForm.refresh();
      refreshSetlists();
      render();
    });
    on("bandDelete", "click", () => {
      const id = current;
      if (id === null) return;
      settle(action(id, async () => {
        const result = await engineFor(id).deleteServerCopy();
        if (result.status === "ok") {
          if (!dropSpace(id)) return { status: "keepFailed" };
          showFirstLeft();
          refreshSetlists();
        }
        return result;
      }, tl("band_delete_confirm", "Delete the shared space's server copy? Everyone is disconnected; the song forms and setlists on each device stay.")), id);
    });
  }

  // A space whose code is gone (the server copy was deleted) but whose setlists
  // couldn't be copied out is still listed: try again.
  function retryOrphans() {
    if (!storage()) return;
    const live = new Set(joined().map((band) => { return band.id; }));
    listBands(storage()).filter((band) => { return !live.has(band.id); }).forEach((band) => { dropSpace(band.id); });
  }

  function pullIfStale() {
    if (connected() && Date.now() - lastPull > PULL_GAP_MS) settle(runAll());
  }

  return {
    isConnected: connected,
    pullIfStale,

    init() {
      retryOrphans();
      showFirstLeft();
      initDialog();
      initShare();
      render();
      takePairingLink();
      onLocalChange(uploadSoon);
      document.addEventListener("visibilitychange", () => { if (!document.hidden) pullIfStale(); });
      window.addEventListener("online", () => { lastPull = 0; settle(runAll()); });
      if (!connected()) return Promise.resolve();
      return afterPageLoad().then(() => { return runAll(); }).then(() => undefined);
    },
  };
}
