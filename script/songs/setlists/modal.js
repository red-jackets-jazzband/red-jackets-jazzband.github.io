import { byId, qsa, clear, on } from "../../lib/core/dom.js";
import { parseSetlistFile } from "../../lib/setlists/setlist-format.js";
import {
  listPersonalSetlists, getPersonalSetlist, copyBandSetlistToPersonal,
} from "../../lib/setlists/setlists-store.js";
import { bandSetlistStorage, connectedBands, listSharedSetlists } from "../../lib/sync/band-store.js";
import { tl } from "../../lib/core/i18n.js";

/*
  The "New setlist" modal (#setlistModal): a name plus one of three starting
  points — Empty, Remix a setlist (clone a band or personal one), or Upload a
  .txt export. Created setlists are always editable and open straight away in
  the sheet: personal ones, or — when the modal was opened from a Shared shelf
  (`open(bandId)`) — shared ones, created in that band space.
*/
function sourceOption(value, label) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  return opt;
}

function closeModal() {
  const overlay = byId("setlistModal");
  if (overlay) overlay.hidden = true;
}

export function createSetlistModal(ctx) {
  let choice = "empty"; // "empty" | "remix" | "upload"
  let targetBand = null; // the band space a new setlist is created in; null = personal

  function setChoice(next) {
    choice = next;
    qsa(".rj-modal-choice", byId("setlistModalChoices")).forEach((btn) => {
      const selected = btn.dataset.choice === next;
      btn.classList.toggle("active", selected);
      btn.setAttribute("aria-pressed", selected ? "true" : "false");
    });
    const remix = byId("setlistModalRemix");
    const upload = byId("setlistModalUpload");
    if (remix) remix.hidden = next !== "remix";
    if (upload) upload.hidden = next !== "upload";
  }

  function populateSources() {
    const select = byId("setlistModalSource");
    if (!select) return;
    clear(select);

    if (ctx.state.setlistIndex.length) {
      const group = document.createElement("optgroup");
      group.label = tl("setlists_from_band", "From the band");
      ctx.state.setlistIndex.forEach((entry) => {
        group.append(sourceOption(`band:${entry.file}`, entry.name));
      });
      select.append(group);
    }
    const mine = listPersonalSetlists(ctx.storage());
    if (mine.length) {
      const group = document.createElement("optgroup");
      group.label = tl("setlists_yours", "Yours");
      mine.forEach((entry) => group.append(sourceOption(`mine:${entry.id}`, entry.name)));
      select.append(group);
    }
    const bands = connectedBands(ctx.storage());
    bands.forEach((band) => {
      const entries = listSharedSetlists(ctx.storage(), band.id);
      if (!entries.length) return;
      const group = document.createElement("optgroup");
      group.label = band.label;
      entries.forEach((entry) => group.append(sourceOption(`shared:${band.id}:${entry.id}`, entry.name)));
      select.append(group);
    });
    if (!select.options.length) {
      const opt = sourceOption("", tl("modal_no_remix", "No setlists to remix"));
      opt.disabled = true;
      select.append(opt);
    }
  }

  // Each creation is a job that remembers where it was started (the band space
  // or personal) and which opening of the modal it belongs to: a file read or a
  // band-file fetch that finishes after the modal was closed, or reopened on
  // another shelf, is dropped instead of landing in the wrong place.
  let generation = 0;
  const startJob = () => { return { band: targetBand, ticket: generation }; };

  function dismiss() {
    generation += 1;
    closeModal();
  }

  function showTarget() {
    const note = byId("setlistModalTarget");
    if (!note) return;
    const band = targetBand ? connectedBands(ctx.storage()).find((b) => { return b.id === targetBand; }) : null;
    note.hidden = !band;
    note.textContent = band ? tl("setlist_modal_shared_note", "Shared with everyone in “{space}”.", { space: band.label }) : "";
  }

  // `bandId`: create the setlist in that shared space instead of as a personal one.
  function open(bandId = null) {
    const overlay = byId("setlistModal");
    if (!overlay) return;
    generation += 1;
    targetBand = bandId && connectedBands(ctx.storage()).some((b) => { return b.id === bandId; }) ? bandId : null;
    showTarget();
    const nameInput = byId("setlistModalName");
    const fileInput = byId("setlistModalFile");
    if (nameInput) nameInput.value = "";
    if (fileInput) fileInput.value = "";
    populateSources();
    setChoice("empty");
    overlay.hidden = false;
    if (nameInput) nameInput.focus();
  }

  // Stores `data` as a new setlist where the job was started and opens it.
  function place(job, data) {
    if (job.ticket !== generation) return;
    const storage = job.band ? bandSetlistStorage(ctx.storage(), job.band) : ctx.storage();
    const entry = copyBandSetlistToPersonal(storage, data);
    dismiss(); // also ends any other creation still pending from this opening
    if (job.band) ctx.setlistView.openShared(job.band, entry.id);
    else ctx.setlistView.openPersonal(entry.id);
  }

  function createFromUpload(name, job) {
    const fileInput = byId("setlistModalFile");
    const file = fileInput && fileInput.files[0];
    if (!file) {
      if (fileInput) fileInput.click();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      // readAsText() below always yields a string; anything else reads as empty.
      const parsed = parseSetlistFile(typeof reader.result === "string" ? reader.result : "");
      place(job, {
        name: name || parsed.name || file.name.replace(/\.txt$/i, ""),
        desc: parsed.desc,
        songs: parsed.songs,
      });
    };
    reader.readAsText(file); // NOSONAR: Blob#text() is Safari 14+, FileReader is the Safari 12 spelling
  }

  // A "mine:<id>" or "shared:<band>:<id>" option's setlist, or null.
  function findSource(source) {
    if (source.startsWith("mine:")) return getPersonalSetlist(ctx.storage(), source.slice(5));
    const rest = source.slice(7); // "shared:"
    const colon = rest.indexOf(":");
    if (colon < 0) return null;
    return getPersonalSetlist(bandSetlistStorage(ctx.storage(), rest.slice(0, colon)), rest.slice(colon + 1));
  }

  function createFromRemix(name, job) {
    const source = byId("setlistModalSource").value;
    if (!source) return;
    if (source.startsWith("mine:") || source.startsWith("shared:")) {
      const src = findSource(source);
      if (!src) return;
      place(job, {
        name: name || `${src.name} copy`,
        desc: src.desc,
        songs: src.songs,
      });
      return;
    }
    const bandFile = source.slice(5); // "band:"
    ctx.setlistData.loadBand(bandFile, (parsed) => {
      place(job, {
        name: name || parsed.name || bandFile.replace(/\.txt$/i, ""),
        desc: parsed.desc,
        songs: parsed.songs,
      });
    });
  }

  function create() {
    const name = (byId("setlistModalName").value || "").trim();
    const job = startJob();
    if (choice === "upload") createFromUpload(name, job);
    else if (choice === "remix") createFromRemix(name, job);
    else place(job, { name: name || tl("setlist_new_default", "New setlist"), desc: "", songs: [] });
  }

  function init() {
    const overlay = byId("setlistModal");
    if (!overlay) return;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) dismiss();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) dismiss();
    });
    on("setlistModalClose", "click", dismiss);
    on("setlistModalCancel", "click", dismiss);
    on("setlistModalCreate", "click", create);

    qsa(".rj-modal-choice", byId("setlistModalChoices")).forEach((btn) => {
      btn.addEventListener("click", () => setChoice(btn.dataset.choice));
    });

    on("setlistModalName", "keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        create();
      }
    });
    on("setlistModalFile", "change", () => {
      if (byId("setlistModalFile").files[0]) setChoice("upload");
    });
  }

  return { init, open };
}
