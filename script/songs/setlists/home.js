import { byId, el, clear } from "../../lib/core/dom.js";
import { listPersonalSetlists, deletePersonalSetlist } from "../../lib/setlists/setlists-store.js";
import { songCountLabel, countSetlistSongs } from "./data.js";
import { tl } from "../../lib/core/i18n.js";

const emptyRow = (text) => el("div", { class: "song-list-empty", text });

const heading = (text) => el("div", { class: "song-list-letter", text });

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
      title: tl("setlist_delete", "Delete setlist"),
      html: '<span class="fa-solid fa-trash-can" aria-hidden="true"></span>',
      attrs: { "aria-label": tl("setlist_delete_named", "Delete setlist “{name}”", { name: title }) },
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

/*
  The Setlists-tab home view: two shelves — "From the band" (read-only,
  committed to the repo) and "Yours" (personal, in localStorage) — ending with
  a single "New setlist" button that opens the create modal.
*/
export function createSetlistHome(ctx) {
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
        if (!window.confirm(tl("setlist_delete_confirm", "Delete “{name}”? This can't be undone.", { name: entry.name }))) return;
        deletePersonalSetlist(ctx.storage(), entry.id);
        ctx.nav.forgetPersonal(entry.id);
        render();
      },
    ).row;
  }

  function newSetlistButton() {
    return el("button", {
      type: "button",
      class: "rj-library-new-setlist-btn",
      on: { click: () => ctx.setlistModal.open() },
    }, [
      el("span", { class: "fa-solid fa-plus", attrs: { "aria-hidden": "true" } }),
      el("span", { text: tl("setlist_new", "New setlist") }),
    ]);
  }

  function render() {
    const listEl = byId("songList");
    if (!listEl) return;
    clear(listEl);

    listEl.append(heading(tl("setlists_from_band", "From the band")));
    if (ctx.state.setlistIndex.length === 0) {
      listEl.append(emptyRow(tl("setlists_none_published", "No setlists published yet.")));
    } else {
      ctx.state.setlistIndex.forEach((entry) => listEl.append(bandRow(entry)));
    }

    listEl.append(heading(tl("setlists_yours", "Yours")));
    const mine = listPersonalSetlists(ctx.storage());
    if (mine.length === 0) {
      listEl.append(emptyRow(tl("setlists_none_personal", "No personal setlists yet on this device.")));
    } else {
      mine.forEach((entry) => listEl.append(personalRow(entry)));
    }
    listEl.append(newSetlistButton());
  }

  function show() {
    ctx.nav.leaveSetlist();
    const tools = byId("setlistTools");
    if (tools) tools.hidden = true;
    render();
  }

  return { render, show };
}
