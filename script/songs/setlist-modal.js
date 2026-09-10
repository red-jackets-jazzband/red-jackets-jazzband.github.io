import { byId, qsa, clear, on } from "../lib/dom.js";
import { parseSetlistFile } from "../lib/setlist-format.js";
import {
  listPersonalSetlists, getPersonalSetlist, createPersonalSetlist, copyBandSetlistToPersonal,
} from "../lib/setlists-store.js";

/*
  The "New setlist" modal (#setlistModal): a name plus one of three starting
  points — Empty, Remix a setlist (clone a band or personal one), or Upload a
  .txt export. Created setlists are always personal and always editable, and a
  created one opens straight away in the sheet.
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

  function setChoice(next) {
    choice = next;
    qsa(".rj-modal-choice", byId("setlistModalChoices")).forEach((btn) => {
      const selected = btn.dataset.choice === next;
      btn.classList.toggle("active", selected);
      btn.setAttribute("aria-checked", selected ? "true" : "false");
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
      group.label = "From the band";
      ctx.state.setlistIndex.forEach((entry) => {
        group.append(sourceOption(`band:${entry.file}`, entry.name));
      });
      select.append(group);
    }
    const mine = listPersonalSetlists(ctx.storage());
    if (mine.length) {
      const group = document.createElement("optgroup");
      group.label = "Yours";
      mine.forEach((entry) => group.append(sourceOption(`mine:${entry.id}`, entry.name)));
      select.append(group);
    }
    if (!select.options.length) {
      const opt = sourceOption("", "No setlists to remix");
      opt.disabled = true;
      select.append(opt);
    }
  }

  function open() {
    const overlay = byId("setlistModal");
    if (!overlay) return;
    const nameInput = byId("setlistModalName");
    const fileInput = byId("setlistModalFile");
    if (nameInput) nameInput.value = "";
    if (fileInput) fileInput.value = "";
    populateSources();
    setChoice("empty");
    overlay.hidden = false;
    if (nameInput) nameInput.focus();
  }

  function openCreated(entry) {
    closeModal();
    ctx.setlistView.openPersonal(entry.id);
  }

  function createFromUpload(name) {
    const fileInput = byId("setlistModalFile");
    const file = fileInput && fileInput.files[0];
    if (!file) {
      if (fileInput) fileInput.click();
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseSetlistFile(String(reader.result));
      openCreated(copyBandSetlistToPersonal(ctx.storage(), {
        name: name || parsed.name || file.name.replace(/\.txt$/i, ""),
        desc: parsed.desc,
        songs: parsed.songs,
      }));
    };
    reader.readAsText(file);
  }

  function createFromRemix(name) {
    const source = byId("setlistModalSource").value;
    if (!source) return;
    if (source.startsWith("mine:")) {
      const src = getPersonalSetlist(ctx.storage(), source.slice(5));
      if (!src) return;
      openCreated(copyBandSetlistToPersonal(ctx.storage(), {
        name: name || `${src.name} copy`,
        desc: src.desc,
        songs: src.songs,
      }));
      return;
    }
    const bandFile = source.slice(5); // "band:"
    ctx.setlistData.loadBand(bandFile, (parsed) => {
      openCreated(copyBandSetlistToPersonal(ctx.storage(), {
        name: name || parsed.name || bandFile.replace(/\.txt$/i, ""),
        desc: parsed.desc,
        songs: parsed.songs,
      }));
    });
  }

  function create() {
    const name = (byId("setlistModalName").value || "").trim();
    if (choice === "upload") createFromUpload(name);
    else if (choice === "remix") createFromRemix(name);
    else openCreated(createPersonalSetlist(ctx.storage(), name || "New setlist"));
  }

  function init() {
    const overlay = byId("setlistModal");
    if (!overlay) return;

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) closeModal();
    });
    on("setlistModalClose", "click", closeModal);
    on("setlistModalCancel", "click", closeModal);
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
