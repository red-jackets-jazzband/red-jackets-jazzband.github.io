// Splits a printed setlist index into a fixed number of side-by-side columns
// ourselves, in JS, instead of leaning on CSS multi-column layout.
//
// A CSS `columns` layout balances column heights by re-flowing the browser's
// own text layout, and in Chromium that balancing can silently misalign the
// columns' own top edges when the content includes `break-inside: avoid`
// groups (confirmed empirically: a "Set N" heading straight after the front
// matter can render 10-20px lower than one starting the next column over,
// even though both are literally the first child of their column). Doing the
// split ourselves trades the browser's finer height-balancing for a layout
// that's simply incapable of misaligning: each column becomes an ordinary
// block of stacked content, so its top is always flush with the others'.
//
// entries: a walkSetlist().entries array.
// hasDividers: walkSetlist().hasDividers — when true, a "Set N" (its heading
//   plus every song under it) is one indivisible chunk that must land whole
//   in one column; when false there are no sets to keep together, so every
//   song is its own splittable chunk, same as the old per-<li> behaviour.
// Returns an array of exactly `columnCount` columns; each column is an array
// of groups `{ heading: string|null, entries: [song entry, ...] }`, in
// reading order, ready to render as an optional heading + one <ol>.
export function splitIndexIntoColumns(entries, hasDividers, columnCount) {
  const chunks = hasDividers ? chunksBySet(entries) : chunksBySong(entries);
  const columns = packByWeight(chunks, columnCount);
  return columns.map(mergeHeadinglessRuns);
}

function chunksBySet(entries) {
  const chunks = [];
  let current = null;
  entries.forEach((entry) => {
    if (entry.kind === "set-heading") {
      current = { heading: entry.label, entries: [] };
      chunks.push(current);
      return;
    }
    if (entry.kind !== "song") return;
    if (!current) {
      current = { heading: null, entries: [] };
      chunks.push(current);
    }
    current.entries.push(entry);
  });
  return chunks;
}

function chunksBySong(entries) {
  return entries.filter((entry) => entry.kind === "song")
    .map((entry) => ({ heading: null, entries: [entry] }));
}

const chunkWeight = (chunk) => (chunk.heading ? 1 : 0) + chunk.entries.length;

// Greedily fills each column up to its fair share (total weight / columns),
// only moving on to the next column once the current chunk would overshoot
// it — the same heuristic a text justifier uses to balance line lengths.
function packByWeight(chunks, columnCount) {
  const total = chunks.reduce((sum, chunk) => sum + chunkWeight(chunk), 0);
  const target = columnCount > 0 ? total / columnCount : 0;

  const columns = [];
  let column = [];
  let columnWeight = 0;
  let remainingColumns = columnCount;

  chunks.forEach((chunk) => {
    const weight = chunkWeight(chunk);
    // Only move on early if doing so leaves this column CLOSER to its fair
    // share than cramming the chunk in would — otherwise a single oversized
    // early chunk (e.g. a big first set) strands every column after it.
    const overshootIfAdded = columnWeight + weight - target;
    const undershootIfNot = target - columnWeight;
    const shouldStartNewColumn = column.length > 0 && remainingColumns > 1
      && overshootIfAdded > undershootIfNot;
    if (shouldStartNewColumn) {
      columns.push(column);
      column = [];
      columnWeight = 0;
      remainingColumns -= 1;
    }
    column.push(chunk);
    columnWeight += weight;
  });
  columns.push(column);
  while (columns.length < columnCount) columns.push([]);
  return columns;
}

// An undivided list's chunks are one song each (so packByWeight is free to
// split between any two of them); stitch consecutive headingless chunks
// back into a single group per column so they print as one continuous <ol>.
function mergeHeadinglessRuns(column) {
  return column.reduce((groups, chunk) => {
    const prev = groups[groups.length - 1];
    if (prev && prev.heading == null && chunk.heading == null) {
      prev.entries.push(...chunk.entries);
    } else {
      groups.push({ heading: chunk.heading, entries: [...chunk.entries] });
    }
    return groups;
  }, []);
}
