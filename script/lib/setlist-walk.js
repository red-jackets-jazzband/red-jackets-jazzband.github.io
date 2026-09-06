import { isSetlistDivider } from "./setlist-format.js";

// One traversal of a setlist's items, producing the ordering and numbering that
// the open-setlist list, the drag renumberer, the printed stage list, the
// booklet body and the booklet index all need. Before this, each of those had
// its own near-identical hand-rolled loop.
//
// A setlist can be split into sets by "break" dividers: set 1 before the first
// break, set 2 after it, and so on. When there is at least one break, song
// numbers restart at 1 in each set and a "Set N" heading precedes each block;
// with no breaks, numbering is a single flat 1..n.
//
// Returns { hasDividers, entries }. Each entry is one of:
//   { kind: "set-heading", label, setNumber, index?, item? }
//       index/item are absent for the implicit leading "Set 1".
//   { kind: "song", item, index, songCount, displayNumber, setNumber,
//     songInSet, followsHeading }
//       index      - position in the original items array
//       songCount  - 1..N across the whole list (drives element ids)
//       displayNumber - what to show before the title (per-set when split)
//       followsHeading - true when this song sits directly under a heading
//         (the booklet uses it to keep the pair on one page)
export function walkSetlist(songs) {
  const items = Array.isArray(songs) ? songs : [];
  const hasDividers = items.some(isSetlistDivider);
  const entries = [];

  let setNumber = 1;
  let songInSet = 0;
  let songCount = 0;
  let afterHeading = false;

  const leadWithHeading = hasDividers && !(items.length > 0 && isSetlistDivider(items[0]));
  if (leadWithHeading) {
    entries.push({ kind: "set-heading", label: "Set 1", setNumber: 1 });
    afterHeading = true;
  }

  items.forEach((item, index) => {
    if (isSetlistDivider(item)) {
      setNumber += 1;
      songInSet = 0;
      afterHeading = true;
      entries.push({
        kind: "set-heading",
        label: item.divider || `Set ${setNumber}`,
        setNumber,
        index,
        item,
      });
      return;
    }
    songCount += 1;
    songInSet += 1;
    entries.push({
      kind: "song",
      item,
      index,
      songCount,
      displayNumber: hasDividers ? songInSet : songCount,
      setNumber,
      songInSet,
      followsHeading: afterHeading,
    });
    afterHeading = false;
  });

  return { hasDividers, entries };
}
