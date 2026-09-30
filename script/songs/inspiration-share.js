// The Inspiration panel's copy-link plumbing: a tick flash on the share button
// once a copy lands, and the execCommand/prompt fallbacks for browsers that
// deny or lack the async Clipboard API. Pure DOM, no panel state.

// Doesn't touch the panel/ctx state, so it lives at module scope rather than
// nested inside createInspiration.
function runExecCopy(url) {
  const ta = document.createElement("textarea");
  ta.value = url;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  // finally, not a trailing statement: a throwing select()/execCommand must
  // not leave ta stuck in the document.
  try {
    ta.select();
    // execCommand is deprecated in favour of the async Clipboard API, but
    // that's exactly why this fallback (for browsers that deny or lack it)
    // still has to call it. NOSONAR: intentional legacy-fallback use.
    return document.execCommand("copy"); // NOSONAR
  } finally {
    ta.remove();
  }
}

// Old-style copy via a throwaway textarea + execCommand, for browsers that
// deny or lack the async Clipboard API. Returns whether it took.
function execCopy(url) {
  try {
    return runExecCopy(url);
  } catch {
    return false;
  }
}

export function fallbackCopy(url, btn) {
  if (execCopy(url)) flashShareBtn(btn);
  else window.prompt("Copy this link:", url);
}

export function flashShareBtn(btn) {
  if (!btn) return;
  const icon = btn.querySelector("span");
  if (!icon || btn.dataset.flashing) return;
  const original = icon.className;
  btn.dataset.flashing = "1";
  icon.className = "fa-solid fa-check";
  btn.classList.add("copied");
  setTimeout(() => {
    icon.className = original;
    btn.classList.remove("copied");
    delete btn.dataset.flashing;
  }, 1400);
}
