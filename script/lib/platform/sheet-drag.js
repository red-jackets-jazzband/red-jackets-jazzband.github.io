// Pure decision for dragging a bottom sheet down to dismiss it, or up by its
// tab to open it (the Layers panel, songs/layers/sheet-drag.js). Given how far
// it was pulled (`dy`, px), how long the gesture took (`dt`, ms) and the
// sheet's height, decide whether it should go or spring back.

// px or less of travel is a tap on the handle rather than a pull.
export const TAP_DISTANCE = 6;

const DEFAULTS = {
  tapDistance: TAP_DISTANCE, // a tap on the handle closes too
  closeFraction: 0.3, // pulled past this share of the sheet's height
  flickSpeed: 0.5, // px/ms — a quick flick closes it from much less
  flickDistance: 24, // ...but only past this much travel
};

// Past `closeFraction` of the height, or a quick enough flick.
function pulledFarEnough(dy, dt, height, { closeFraction, flickSpeed, flickDistance }) {
  if (height > 0 && dy >= height * closeFraction) return true;
  return dy >= flickDistance && dy / Math.max(dt, 1) >= flickSpeed;
}

export function shouldDismissSheet(dy, dt, height, opts = {}) {
  const options = { ...DEFAULTS, ...opts };
  if (dy <= options.tapDistance) return dy >= 0 && dt < 300;
  return pulledFarEnough(dy, dt, height, options);
}

// The other way round: the closed sheet pulled up by its tab (`dy`, px pulled
// up). It opens past the same share of its height, or on a quick flick; a tap
// is left to the tab's own click.
export function shouldOpenSheet(dy, dt, height, opts = {}) {
  const options = { ...DEFAULTS, ...opts };
  return dy > options.tapDistance && pulledFarEnough(dy, dt, height, options);
}
