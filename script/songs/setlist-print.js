import { byId, el, clear } from "../lib/dom.js";
import { walkSetlist } from "../lib/setlist-walk.js";
import { extractKeyFromAbc, setlistTransposeSteps, formatSetlistKeyLabel } from "../lib/music-theory.js";
import {
  instrumentTransposes, instrumentLabel, exportInstrumentLine, resolvedExportSongMeta,
} from "../lib/export-meta.js";
import { clearBookletPrintState, printWithTitle } from "./sheet-controls.js";

const PRINT_MODES = ["setlist", "chordbook", "songbook"];
const PRINT_MODE_LABELS = { setlist: "Setlist", chordbook: "Chordbook", songbook: "Songbook" };

const bookletSetHeading = (text) =>
  el("div", { class: "setlist-booklet-set-heading pageBreakBefore", text });

/*
  Printing an open setlist. One hidden container (#setlistPrintBooklet) holds
  everything; a <body> class picks which of the three printed forms shows:
    "Print setlist"   -> the numbered stage list only (no song files fetched)
    "Print chordbook"  -> every song's title + chord grid (staves hidden in CSS)
    "Print songbook"   -> every song's title + chords + staff notation
  Chordbook and songbook share the exact same stacked DOM.
*/
export function createSetlistPrint(ctx) {
  const instrument = () => (byId("instrument") ? byId("instrument").value : "concert_pitch");

  // Each buildBooklet() clears #setlistPrintBooklet and recreates its per-song
  // ids, while the .abc reads that fill them are async. `bookletSeq` lets a
  // callback from a superseded build bail instead of writing stale content
  // into the new ids; `pendingReads` / `onBookletReady` let print() wait until
  // every read for the current build has landed.
  let bookletSeq = 0;
  let pendingReads = 0;
  let totalReads = 0;
  let onBookletReady = null;
  let waitingMode = null;

  // While a "Print …" click is held waiting for the booklet's song reads to
  // land, a small line under the buttons counts them in so the wait doesn't
  // look like a dead click.
  function setPrintProgress(mode) {
    const node = byId("setlistPrintStatus");
    if (!node) return;
    if (mode === null || totalReads === 0) {
      node.hidden = true;
      node.textContent = "";
      return;
    }
    const done = totalReads - pendingReads;
    const label = (PRINT_MODE_LABELS[mode] || "Songbook").toLowerCase();
    node.textContent = `Preparing the ${label} — ${done} of ${totalReads} songs ready…`;
    node.hidden = false;
  }

  function readSettled(seq) {
    if (seq !== bookletSeq) return;
    pendingReads -= 1;
    if (onBookletReady) {
      if (pendingReads === 0) {
        const ready = onBookletReady;
        onBookletReady = null;
        ready();
      } else {
        setPrintProgress(waitingMode);
      }
    }
  }

  // ---- "Print setlist": the numbered stage list ----------------------

  function stageTable(songs) {
    const showInstr = instrumentTransposes(instrument());
    const columns = ["num", "song", "concert", ...(showInstr ? ["instr"] : []), "tempo"];
    const headings = {
      num: "", song: "", concert: "Concert", instr: instrumentLabel(instrument()), tempo: "bpm",
    };

    const headRow = el("tr", {}, columns.map((col) =>
      el("th", { class: `stage-c-${col}`, text: headings[col] })));
    const tbody = el("tbody");

    const setRow = (label) => el("tr", { class: "setlist-stage-set-row" },
      el("th", { text: label, attrs: { colspan: String(columns.length) } }));

    walkSetlist(songs).entries.forEach((entry) => {
      if (entry.kind === "set-heading") {
        tbody.append(setRow(entry.label));
        return;
      }
      const cells = [
        el("td", { class: "stage-c-num", text: `${entry.displayNumber}.` }),
        el("td", { class: "stage-c-song", text: ctx.songName(entry.item.file) }),
        el("td", {
          class: "stage-c-concert",
          id: `setlistStageConcert-${entry.songCount}`,
          text: formatSetlistKeyLabel(entry.item.key),
        }),
      ];
      if (showInstr) {
        cells.push(el("td", { class: "stage-c-instr", id: `setlistStageInstr-${entry.songCount}` }));
      }
      cells.push(el("td", { class: "stage-c-tempo", id: `setlistStageTempo-${entry.songCount}` }));
      tbody.append(el("tr", {}, cells));
    });

    return el("table", { class: "setlist-stage-table" }, [
      el("thead", {}, headRow),
      tbody,
    ]);
  }

  function appendStageList(container, songs) {
    container.append(el("div", { class: "setlist-stage-list" }, stageTable(songs)));
  }

  // ---- front matter for the chordbook / songbook forms ---------------

  function frontMatter(name, songs) {
    const index = el("div", { class: "setlist-booklet-index" });
    let ol = el("ol");

    const { entries } = walkSetlist(songs);
    if (entries[0] && entries[0].kind === "set-heading" && entries[0].index === undefined) {
      index.append(el("div", { class: "setlist-booklet-index-heading", text: "Set 1" }));
    }
    index.append(ol);

    entries.forEach((entry) => {
      if (entry.kind === "set-heading" && entry.index !== undefined) {
        index.append(el("div", { class: "setlist-booklet-index-heading", text: entry.label }));
        ol = el("ol");
        index.append(ol);
        return;
      }
      if (entry.kind !== "song") return;
      ol.append(el("li", { value: entry.displayNumber }, [
        el("span", { class: "setlist-booklet-index-name", text: ctx.songName(entry.item.file) }),
        el("span", { class: "setlist-booklet-index-key", id: `setlistIndexKey-${entry.songCount}` }),
      ]));
    });

    const when = new Date().toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric",
    });

    return el("div", { class: "setlist-booklet-frontmatter" }, [
      el("h1", { class: "setlist-booklet-fm-title", text: name }),
      el("div", { class: "setlist-booklet-fm-sub", id: "setlistBookletFmSub", text: "Songbook" }),
      el("div", { class: "setlist-booklet-fm-meta" }, [
        el("div", { text: exportInstrumentLine(instrument()) }),
        el("div", { text: when }),
      ]),
      index,
    ]);
  }

  // ---- per-song meta, filled once each .abc has loaded --------------

  function fillSongMeta(n, meta) {
    const set = (id, value) => {
      const node = byId(id);
      if (node) node.textContent = value || "";
    };
    set(`setlistStageConcert-${n}`, meta.concert);
    set(`setlistStageInstr-${n}`, meta.instrument);
    set(`setlistStageTempo-${n}`, meta.bpm ? String(meta.bpm) : "");
    set(`setlistIndexKey-${n}`, meta.instrument);
  }

  // ---- the cover page (personal setlist `desc`) --------------------

  function coverPage(name, desc) {
    return el("div", { class: "bookContent hideOnScreen setlist-cover" }, [
      el("h1", { text: name }),
      el("p", { text: desc }),
      el("img", { src: "/images/songbook_qr.png", height: 100, width: 100 }),
    ]);
  }

  // ---- one engraved song block ------------------------------------

  function songBlock(entry, seq) {
    const n = entry.songCount;
    const block = el("div", { class: "setlist-booklet-song" }, [
      el("div", { id: `setlistPrintTitle-${n}`, class: "songtitle" }),
      el("div", { id: `setlistPrintChord-${n}`, class: "chordtable" }),
      el("div", { id: `setlistPrintNotation-${n}`, class: "notation" }),
    ]);
    if (!entry.followsHeading) block.classList.add("pageBreakBefore");

    pendingReads += 1;
    ctx.readFile(`/songs/${entry.item.file}`, (text) => {
      if (seq === bookletSeq) {
        const extra = setlistTransposeSteps(entry.item.key, extractKeyFromAbc(text));
        ctx.sheet.renderIntoBooklet(text, {
          notationId: `setlistPrintNotation-${n}`,
          chordId: `setlistPrintChord-${n}`,
          titleId: `setlistPrintTitle-${n}`,
          titlePrefix: `${entry.displayNumber}. `,
          extraTransposeSteps: extra,
        });
        fillSongMeta(n, resolvedExportSongMeta(text, entry.item, instrument()));
      }
      readSettled(seq);
    }, (status) => {
      console.warn(`Setlist references a missing song file: ${entry.item.file} (status ${status})`);
      readSettled(seq);
    });

    return block;
  }

  function buildBooklet(name, songs, desc) {
    const container = byId("setlistPrintBooklet");
    if (!container) return;
    bookletSeq += 1;
    const seq = bookletSeq;
    pendingReads = 0;
    clear(container);

    container.append(el("div", { class: "setlist-view-title", text: name }));
    if (desc) container.append(coverPage(name, desc));
    container.append(frontMatter(name, songs));

    walkSetlist(songs).entries.forEach((entry) => {
      if (entry.kind === "set-heading") container.append(bookletSetHeading(entry.label));
      else container.append(songBlock(entry, seq));
    });
    totalReads = pendingReads;

    // Appended after the (hidden-in-setlist-mode) chart stack: for "Print
    // setlist" the stack collapses and this lands right under the front matter.
    appendStageList(container, songs);

    // A rebuild (e.g. instrument change) with a print still queued: keep
    // counting against the fresh read total, or release the print now if the
    // rebuilt booklet has nothing to load.
    if (onBookletReady && pendingReads === 0) {
      const ready = onBookletReady;
      onBookletReady = null;
      ready();
    } else if (onBookletReady) {
      setPrintProgress(waitingMode);
    }
  }

  function print(mode) {
    // The booklet's charts/keys/tempos are filled by async .abc reads; hold
    // the print dialog until they've all landed or it prints half-empty pages,
    // showing a "3 of 12 songs ready" line under the buttons while we wait.
    if (pendingReads > 0) {
      waitingMode = mode;
      onBookletReady = () => print(mode);
      setPrintProgress(mode);
      return;
    }
    setPrintProgress(null);
    waitingMode = null;
    clearBookletPrintState();
    const sub = byId("setlistBookletFmSub");
    if (sub) sub.textContent = PRINT_MODE_LABELS[mode] || "Songbook";
    document.body.classList.add("export-booklet-mode");
    PRINT_MODES.forEach((m) => document.body.classList.toggle(`export-mode-${m}`, m === mode));
    window.addEventListener("afterprint", function restore() {
      document.body.classList.remove("export-booklet-mode");
      PRINT_MODES.forEach((m) => document.body.classList.remove(`export-mode-${m}`));
      window.removeEventListener("afterprint", restore);
    });
    // Name the print for its "Save as PDF" filename / page header, e.g.
    // "Setlist 2026 — Chordbook".
    const name = ctx.state.currentOpenSetlistName;
    printWithTitle([name, PRINT_MODE_LABELS[mode]].filter(Boolean).join(" — "));
  }

  return { buildBooklet, print, PRINT_MODES };
}
