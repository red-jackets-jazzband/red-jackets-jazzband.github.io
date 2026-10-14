// Inlined into the /songs/ page's <head> (layouts/partials/head.html, bundled
// by Hugo's js.Build): start the first files the app will read before its
// scripts have even downloaded. See lib/core/early-requests.js.
import { startEarlyRequests } from "./lib/core/early-requests.js";

startEarlyRequests(window, (path) => {
  const request = new XMLHttpRequest();
  request.open("GET", path, true);
  request.send(null);
  return request;
});
