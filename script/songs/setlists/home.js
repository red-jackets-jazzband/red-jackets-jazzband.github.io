import { byId, el, clear } from "../../lib/core/dom.js";
import { listPersonalSetlists, deletePersonalSetlist } from "../../lib/setlists/setlists-store.js";
import { songCountLabel, countSetlistSongs } from "./data.js";
import { listBands, listSharedSetlists, bandSetlistStorage } from "../../lib/sync/band-store.js";
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
  The Setlists-tab home view: "From the band" (read-only, committed to the
  repo), "Yours" (personal, in localStorage) and, for every shared space this
  device is in, a shelf named after the space (editable by everyone in the space, synced
  through it). Yours and each Shared shelf end with their own "New setlist"
  button that opens the create modal, aimed at that shelf.
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

  function sharedRow(band, entry) {
    return setlistRow(
      entry.name,
      countSetlistSongs(entry.songs),
      () => ctx.setlistView.openShared(band.id, entry.id),
      () => {
        if (!window.confirm(tl("setlist_delete_shared_confirm", "Delete “{name}” for everyone in “{space}”? This can't be undone.", { name: entry.name, space: band.label }))) return;
        deletePersonalSetlist(bandSetlistStorage(ctx.storage(), band.id), entry.id);
        ctx.nav.forgetPersonal(entry.id);
        render();
      },
    ).row;
  }

  function sharedShelf(listEl, band) {
    listEl.append(heading(band.label));
    const entries = listSharedSetlists(ctx.storage(), band.id);
    if (entries.length === 0) listEl.append(emptyRow(tl("setlists_none_shared", "Nothing shared in this space yet.")));
    else entries.forEach((entry) => listEl.append(sharedRow(band, entry)));
    listEl.append(newSetlistButton(band.id));
  }

  function newSetlistButton(bandId = null) {
    return el("button", {
      type: "button",
      class: "rj-library-new-setlist-btn",
      on: { click: () => ctx.setlistModal.open(bandId) },
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

    const bands = listBands(ctx.storage());
    bands.forEach((band) => sharedShelf(listEl, band));
  }

  function show() {
    ctx.nav.leaveSetlist();
    // Pick up what the others changed since this device last looked.
    if (ctx.band && ctx.band.pullIfStale) ctx.band.pullIfStale(); // NOSONAR: no ?. on Safari 12
    const tools = byId("setlistTools");
    if (tools) tools.hidden = true;
    render();
  }

  return { render, show };
}
