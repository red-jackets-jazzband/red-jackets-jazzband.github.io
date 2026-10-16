/*
  Which "install this app by hand" instructions a browser needs, if any.

  Apple's browsers never fire `beforeinstallprompt`, so a web page can't open
  an install dialog there: the visitor has to do it from the browser's own
  menus. On iPhone/iPad (Safari, and since iOS 16.4 every other browser too,
  all being WebKit; an older one keeps a plain download button) that's
  Share → "Add to Home Screen"; on a Mac, Safari 17+
  has File → "Add to Dock". Older Mac Safari, and Chrome/Edge/Firefox on a
  Mac, get nothing here (Chromium fires `beforeinstallprompt` itself).

  `standalone` is whether the page is already running as an installed app
  (`navigator.standalone` on iOS, `display-mode: standalone` elsewhere) —
  then there's nothing left to install.
*/

const MAC_SAFARI_MIN_VERSION = 17;
// Other iOS browsers only got "Add to Home Screen" in iOS 16.4.
const IOS_OTHER_BROWSER_MIN = [16, 4];
const IOS_OTHER_BROWSERS = ["CriOS/", "FxiOS/", "EdgiOS/", "OPiOS/", "GSA/"];
const OTHER_MAC_BROWSERS = ["Chrome/", "Chromium/", "Edg/", "Firefox/", "OPR/"];

/**
 * iPadOS 13+ reports itself as a Mac ("Macintosh" UA, platform "MacIntel");
 * only its touch points give it away.
 * @param {{ userAgent: string, platform?: string, maxTouchPoints?: number }} env
 */
export function isAppleMobile({ userAgent, platform = "", maxTouchPoints = 0 }) {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/**
 * The iOS version in an iPhone/iPad user agent ("OS 15_2 like Mac OS X"), as
 * [major, minor]; null when it doesn't say (an iPad asking for desktop sites).
 * @param {string} userAgent
 */
export function iosVersion(userAgent) {
  const match = /OS (\d+)_(\d+)/.exec(userAgent);
  return match ? [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)] : null;
}

/** @param {string} userAgent */
function canAddToHomeScreen(userAgent) {
  if (!IOS_OTHER_BROWSERS.some((marker) => userAgent.includes(marker))) return true;
  const version = iosVersion(userAgent);
  if (!version) return true;
  const [major, minor] = IOS_OTHER_BROWSER_MIN;
  return version[0] > major || (version[0] === major && version[1] >= minor);
}

/** @param {string} userAgent */
function safariVersion(userAgent) {
  const match = /Version\/(\d+)/.exec(userAgent);
  return match ? Number.parseInt(match[1], 10) : 0;
}

/** @param {string} userAgent */
function isMacSafari(userAgent) {
  if (!userAgent.includes("Macintosh") || !userAgent.includes("Safari/")) return false;
  return !OTHER_MAC_BROWSERS.some((marker) => userAgent.includes(marker));
}

/**
 * @param {{ userAgent: string, platform?: string, maxTouchPoints?: number, standalone?: boolean }} env
 * @returns {"ios" | "mac" | null}
 */
export function installHintFor(env) {
  if (env.standalone) return null;
  if (isAppleMobile(env)) return canAddToHomeScreen(env.userAgent) ? "ios" : null;
  if (isMacSafari(env.userAgent) && safariVersion(env.userAgent) >= MAC_SAFARI_MIN_VERSION) return "mac";
  return null;
}
