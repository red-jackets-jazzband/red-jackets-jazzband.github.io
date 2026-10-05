import { safeStorage } from "../../lib/core/preferences.js";
import { humanizeSongFile } from "../../lib/core/filename.js";
import { readFile } from "./read-file.js";
import { createAppStore, bindAppPrefs } from "./state.js";
import { FEATURES } from "./features.js";

/*
  Composition root for the songs page. Builds the store (core/state.js) and
  one shared `ctx` — the store, its flat `ctx.state` view, a few shared
  services, and every feature's api by name — then creates and starts the
  features in core/features.js's order.
*/
function createApp() {
  const store = createAppStore();
  bindAppPrefs(store);
  const ctx = {
    store,
    state: store.state,
    readFile,
    storage: safeStorage,
    // A song's display name from the index, or one made up from its filename.
    songName(file) {
      const match = store.get("catalog").allSongs.find((song) => song.file === file);
      return match ? match.name : humanizeSongFile(file);
    },
  };
  FEATURES.forEach((feature) => {
    if (feature.create) ctx[feature.name] = feature.create(ctx);
  });

  // Each init is isolated: a thrown error in one (an unsupported API on a
  // given browser, a malformed song) used to abort every later one silently,
  // including the tour's — so the "?" tour button would simply never appear,
  // with nothing in the UI to explain why. Now a failure stays local to
  // whatever broke, and lands in the console instead of vanishing.
  return {
    start() {
      FEATURES.forEach((feature) => {
        if (!feature.init) return;
        try {
          feature.init(ctx);
        } catch (error) {
          console.error(error);
        }
      });
    },
  };
}

export function start() {
  createApp().start();
}
