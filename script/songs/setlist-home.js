import { byId, el, clear } from "../lib/dom.js";
import { listPersonalSetlists, deletePersonalSetlist } from "../lib/setlists-store.js";
import { songCountLabel, countSetlistSongs } from "./setlist-data.js";

const emptyRow = (text) => el("div", { class: "song-list-empty", text });

const heading = (text) => el("div", { class: "song-list-letter", text });

/*
  The Setlists-tab home view: two shelves — "From the band" (read-only,
  committed to the repo) and "Yours" (personal, in localStorage) — ending with
  a single "New setlist" button that opens the create modal.
*/
export function createSetlistHome(ctx) {
  function setlistRow(title, count, onOpen, onDelete) {
    const meta = el("span", { class: "setlist-row-meta" });
    if (count != null) meta.textContent = songCountLabel(count);

    const row = el("div", { class: "song-list-item setlist-row" }, [
      el("button", { type: "button", class: "setlist-row-main", text: title, on: { click: onOpen } }),
      meta,
    ]);

    if (onDelete) {
      row.append(el("button", {
        type: "button",
        class: "setlist-row-delete",
        title: "Delete setlist",
        html: '<span class="fa-solid fa-trash-can" aria-hidden="true"></span>',
        attrs: { "aria-label": `Delete setlist “${title}”` },
        on: {
          click(e) {
            e.stopPropagation();
            onDelete();
          },
        },
      }));
    }
    return { row, meta };
  }

  function bandRow(entry) {
    const built = setlistRow(entry.name, null, () => ctx.setlistView.openBand(entry.file, entry.name));
    ctx.setlistData.loadBand(entry.file, (parsed) => {
      built.meta.textContent = songCountLabel(countSetlistSongs(parsed.songs));
    });
    return built.row;
  }

  function personalRow(entry) {
    return setlistRow(
      entry.name,
      countSetlistSongs(entry.songs),
      () => ctx.setlistView.openPersonal(entry.id),
      () => {
        if (!window.confirm(`Delete “${entry.name}”? This can't be undone.`)) return;
        deletePersonalSetlist(ctx.storage(), entry.id);
        if (ctx.state.currentPersonalId === entry.id) ctx.state.currentPersonalId = null;
        render();
      },
    ).row;
  }

  function newSetlistButton() {
    return el("button", {
      type: "button",
      class: "rj-library-new-setlist-btn",
      html: '<span class="fa-solid fa-plus" aria-hidden="true"></span><span>New setlist</span>',
      on: { click: () => ctx.setlistModal.open() },
    });
  }

  function render() {
    const listEl = byId("songList");
    if (!listEl) return;
    clear(listEl);

    listEl.append(heading("From the band"));
    if (ctx.state.setlistIndex.length === 0) {
      listEl.append(emptyRow("No setlists published yet."));
    } else {
      ctx.state.setlistIndex.forEach((entry) => listEl.append(bandRow(entry)));
    }

    listEl.append(heading("Yours"));
    const mine = listPersonalSetlists(ctx.storage());
    if (mine.length === 0) {
      listEl.append(emptyRow("No personal setlists yet on this device."));
    } else {
      mine.forEach((entry) => listEl.append(personalRow(entry)));
    }
    listEl.append(newSetlistButton());
  }

  function show() {
    ctx.state.setlistsView = "home";
    ctx.state.currentPersonalId = null;
    ctx.state.currentSetlistId = null;
    // The open-setlist position pointer is meaningless once no setlist is open;
    // the song itself may still be on the sheet, so currentSongFile stays.
    ctx.state.currentSetlistSongIndex = null;
    ctx.state.currentOpenSongs = null;
    const tools = byId("setlistTools");
    if (tools) tools.hidden = true;
    render();
    if (ctx.syncHash) ctx.syncHash();
  }

  return { render, show };
}
