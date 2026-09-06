// Playback-tempo maths for the sheet's Tempo stepper. The stepper holds a real
// bpm value; ABCjs's SynthController wants a "warp" percentage of the tune's
// own engraved Q: tempo. Musicians think in bpm, so the UI works in bpm and
// this converts at the edge. All pure — the DOM/SynthController wiring lives in
// songs/audio-player.js and songs/sheet-controls.js.

export const DEFAULT_BPM = 120;
export const TEMPO_STEP = 4;
export const TEMPO_MIN_BPM = 40;
export const TEMPO_MAX_BPM = 320;

export function clampBpm(bpm) {
  return Math.max(TEMPO_MIN_BPM, Math.min(TEMPO_MAX_BPM, bpm));
}

// The bpm to display / step from. `override` is the stepper's own value, or
// null/undefined meaning "follow the tune" — then fall back to the tune's
// native Q: tempo, or DEFAULT_BPM for a tune with no Q: field.
export function resolveBpm(override, nativeQpm) {
  if (override !== null && override !== undefined) return override;
  return nativeQpm || DEFAULT_BPM;
}

// Next stepper value after nudging by `delta` bpm, clamped to the allowed range.
export function stepBpm(override, nativeQpm, delta) {
  return clampBpm(resolveBpm(override, nativeQpm) + delta);
}

// SynthController.setWarp() percentage: 100 = play at the tune's own tempo.
// A null/undefined override means no change (100%).
export function bpmToWarpPercent(override, nativeQpm) {
  if (override === null || override === undefined) return 100;
  const native = nativeQpm || DEFAULT_BPM;
  return Math.max(1, Math.round((override / native) * 100));
}
