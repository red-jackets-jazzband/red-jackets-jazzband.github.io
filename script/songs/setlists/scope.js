import { bandSetlistStorage } from "../../lib/sync/band-store.js";

/*
  Where the open setlist lives: a shared setlist sits in its band space's own
  setlist storage (lib/sync/band-store.js), a personal one in the page's
  storage. Both are edited by the same setlists-store functions, which only
  need to be handed the right one.
*/
export function setlistStorage(ctx) {
  const bandId = ctx.state.currentBandId;
  return bandId ? bandSetlistStorage(ctx.storage(), bandId) : ctx.storage();
}
