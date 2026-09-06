// Entry point for /songs/. ABCjs and Tonal are loaded as classic scripts
// before this module (see content/songs.md), so their globals are ready by the
// time `load` fires.
import { start } from "./songs/app.js";

window.addEventListener("load", start);
