// Entry point for /songs/. ABCjs and Tonal are classic `defer` scripts ahead
// of this module (see layouts/shortcodes/songs-app.html), and deferred and
// module scripts run in document order, so their globals are ready here.
// Starts at DOMContentLoaded rather than `load`, which would also wait for
// every image, the icon font and any iframe — seconds on a slow device or
// connection, for nothing the sheet needs.
import { start } from "./songs/core/app.js";

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
