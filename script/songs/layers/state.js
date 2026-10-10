/*
  The Layers panel's store slice (see songs/core/state.js):

  - `activeLayers`: { <layer id>: bool } for every lib/music/layers.js
    layer, each persisted under its own rj.layer.<id> key, so a returning
    visitor gets the same sheet. Written by the panel; the sheet re-renders
    on it (subscribeRerender in sheet/sheet.js).
  - `layersOpen`: whether the panel is showing. Not sticky: the panel
    starts closed on every visit, so the sheet looks as it always did.
*/
import { layerPrefKey } from "../../lib/core/preferences.js";
import { boolPref, objectPref } from "../../lib/core/persisted.js";
import { LAYER_IDS } from "../../lib/music/layers.js";

const layerFields = {};
LAYER_IDS.forEach((id) => {
  layerFields[id] = boolPref(layerPrefKey(id), false);
});

export const LAYERS_SLICE = {
  name: "layers",
  initial: {
    layersOpen: false,
  },
  prefs: {
    activeLayers: objectPref(layerFields),
  },
};
