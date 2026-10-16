import { test } from "node:test";
import assert from "node:assert/strict";
import { installHintFor, iosVersion, isAppleMobile } from "./install-hint.js";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1";
const IPAD_OLD = "Mozilla/5.0 (iPad; CPU OS 12_5_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1";
const MAC_SAFARI_18 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const MAC_SAFARI_16 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const MAC_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";

test("an iPhone or old iPad gets the Home Screen instructions, in any browser", () => {
  assert.equal(installHintFor({ userAgent: IPHONE_SAFARI }), "ios");
  assert.equal(installHintFor({ userAgent: IPHONE_CHROME }), "ios");
  assert.equal(installHintFor({ userAgent: IPAD_OLD }), "ios");
});

test("an iPadOS 13+ iPad, which reports itself as a Mac, is told apart by its touch points", () => {
  const env = { userAgent: MAC_SAFARI_18, platform: "MacIntel", maxTouchPoints: 5 };
  assert.equal(isAppleMobile(env), true);
  assert.equal(installHintFor(env), "ios");
  assert.equal(isAppleMobile({ userAgent: MAC_SAFARI_18, platform: "MacIntel", maxTouchPoints: 0 }), false);
});

test("Mac Safari 17+ gets the Add to Dock instructions; older Safari and other Mac browsers none", () => {
  assert.equal(installHintFor({ userAgent: MAC_SAFARI_18, platform: "MacIntel", maxTouchPoints: 0 }), "mac");
  assert.equal(installHintFor({ userAgent: MAC_SAFARI_16, platform: "MacIntel" }), null);
  assert.equal(installHintFor({ userAgent: MAC_CHROME, platform: "MacIntel" }), null);
  assert.equal(installHintFor({ userAgent: MAC_FIREFOX, platform: "MacIntel" }), null);
});

test("nothing for non-Apple browsers, or an app that's already installed", () => {
  assert.equal(installHintFor({ userAgent: ANDROID_CHROME }), null);
  assert.equal(installHintFor({ userAgent: IPHONE_SAFARI, standalone: true }), null);
});

test("another browser on iOS before 16.4 can't add to the Home Screen, so it gets no steps", () => {
  const chromeIos15 = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1";
  const chromeIos164 = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1";
  assert.deepEqual(iosVersion(chromeIos15), [15, 7]);
  assert.equal(installHintFor({ userAgent: chromeIos15 }), null);
  assert.equal(installHintFor({ userAgent: chromeIos164 }), "ios");
  // Safari itself could always do it, however old.
  assert.equal(installHintFor({ userAgent: IPAD_OLD }), "ios");
});
