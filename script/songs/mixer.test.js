import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import {
  createMixer, loadMixerState, loadGchordPatternState, loadHighQualityAudioState, loadSwingState,
} from "./mixer.js";
import { GM_VOICES, guessGmProgram } from "../lib/gm-voices.js";
import { GCHORD_PATTERNS, DEFAULT_PROGRAM } from "../lib/audio-mix.js";

const ARIA_PRESSED = "aria-pressed";
const TRUMPET_STRIP_ID = "mixerVoiceStrip-trumpet";
const SOUSAPHONE_STRIP_ID = "mixerVoiceStrip-sousaphone";
const VOICE_ROWS_SELECTOR = "#mixerVoicesList .mixer-strip--voice";

function setup(mixerState = {}, stateOverrides = {}) {
  const page = mountPage();
  const rerenders = [];
  const ctx = makeCtx({
    state: {
      hasChords: true,
      mixer: {
        bassVolume: 100, chordsVolume: 100, bassMuted: false, chordsMuted: false,
        bassProgram: null, chordsProgram: null,
        ...mixerState,
      },
      ...stateOverrides,
    },
    sheet: { rerender: () => rerenders.push(1) },
  });
  const mixer = createMixer(ctx);
  mixer.init();
  return { page, ctx, mixer, rerenders, cleanup: page.cleanup };
}

test("init seeds both Bass/Chords range inputs from ctx.state.mixer", () => {
  const { cleanup } = setup({ bassVolume: 40, chordsVolume: 50 });
  try {
    assert.equal(document.getElementById("mixerBassRange").value, "40");
    assert.equal(document.getElementById("mixerChordsRange").value, "50");
  } finally {
    cleanup();
  }
});

test("mixer.toggle() opens and closes the panel, updating the button and aria state", () => {
  const { mixer, cleanup } = setup();
  try {
    const btn = document.getElementById("mixerBtn");
    const panel = document.getElementById("mixerPanel");
    const backdrop = document.getElementById("mixerBackdrop");
    assert.equal(panel.open, false);

    mixer.toggle();
    assert.equal(panel.open, true);
    assert.equal(backdrop.hidden, false);
    assert.equal(btn.classList.contains("active"), true);
    assert.equal(btn.getAttribute("aria-expanded"), "true");

    mixer.toggle();
    assert.equal(panel.open, false);
    assert.equal(btn.classList.contains("active"), false);
    assert.equal(btn.getAttribute("aria-expanded"), "false");
  } finally {
    cleanup();
  }
});

test("Escape closes an open panel; the backdrop and close button do too", () => {
  const { mixer, cleanup } = setup();
  try {
    mixer.toggle();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(document.getElementById("mixerPanel").open, false);

    mixer.toggle();
    document.getElementById("mixerBackdrop").dispatchEvent(new window.Event("click"));
    assert.equal(document.getElementById("mixerPanel").open, false);

    mixer.toggle();
    document.getElementById("mixerCloseBtn").dispatchEvent(new window.Event("click"));
    assert.equal(document.getElementById("mixerPanel").open, false);
  } finally {
    cleanup();
  }
});

test("a click outside the panel closes it; clicking inside it or its own button doesn't", () => {
  const { mixer, cleanup } = setup();
  try {
    mixer.toggle();
    assert.equal(document.getElementById("mixerPanel").open, true);

    document.getElementById("mixerBassRange").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(document.getElementById("mixerPanel").open, true);

    document.getElementById("mixerBtn").dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(document.getElementById("mixerPanel").open, true);

    document.body.dispatchEvent(new window.Event("click", { bubbles: true }));
    assert.equal(document.getElementById("mixerPanel").open, false);
  } finally {
    cleanup();
  }
});

test("positionPanel clamps the right offset to REPOSITION_MARGIN instead of letting it go negative", () => {
  const { mixer, cleanup } = setup();
  try {
    const btn = document.getElementById("mixerBtn");
    const panel = document.getElementById("mixerPanel");
    const originalInnerWidth = window.innerWidth;
    // window.innerWidth - rect.right would be negative here without the clamp
    Object.defineProperty(window, "innerWidth", { value: 100, configurable: true });
    btn.getBoundingClientRect = () => ({
      top: 40, bottom: 60, left: 10, right: 300, width: 290, height: 20,
    });
    mixer.toggle();
    assert.equal(panel.style.right, "8px"); // REPOSITION_MARGIN, not a negative value

    // comfortably inside the viewport — the unclamped, computed value applies
    Object.defineProperty(window, "innerWidth", { value: 500, configurable: true });
    btn.getBoundingClientRect = () => ({
      top: 40, bottom: 60, left: 10, right: 110, width: 100, height: 20,
    });
    mixer.toggle();
    mixer.toggle();
    assert.equal(panel.style.right, "390px"); // 500 - 110
    Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true });
  } finally {
    cleanup();
  }
});

test("scrolling recomputes the panel's position so it stays glued under the button", () => {
  const { mixer, cleanup } = setup();
  try {
    const btn = document.getElementById("mixerBtn");
    const panel = document.getElementById("mixerPanel");
    btn.getBoundingClientRect = () => ({
      top: 40, bottom: 60, left: 10, right: 110, width: 100, height: 20,
    });
    mixer.toggle();
    assert.equal(panel.style.top, "60px");

    // .split-content scrolls internally, not the window — its scroll event
    // doesn't bubble, so the listener has to be capture-phase to still see
    // it. Dispatching straight on window would pass even for a bubble-phase
    // listener (window is the target either way), so dispatch a
    // non-bubbling scroll from a descendant instead — only a capture-phase
    // listener on window can observe that.
    btn.getBoundingClientRect = () => ({
      top: -20, bottom: 0, left: 10, right: 110, width: 100, height: 20,
    });
    panel.dispatchEvent(new window.Event("scroll", { bubbles: false }));
    assert.equal(panel.style.top, "0px");
  } finally {
    cleanup();
  }
});

function dragFaderDebounces(t, {
  rangeId, readoutId, fillId, storageKey, value, getValue,
}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ctx, rerenders, cleanup } = setup();
  try {
    const range = document.getElementById(rangeId);
    range.value = String(value);
    range.dispatchEvent(new window.Event("input"));

    assert.equal(getValue(ctx), value);
    assert.equal(document.getElementById(readoutId).textContent, `${value}%`);
    assert.equal(document.getElementById(fillId).style.width, `${value}%`);
    assert.equal(rerenders.length, 0); // debounced, not yet applied

    t.mock.timers.tick(300);
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem(storageKey), String(value));
  } finally {
    window.localStorage.clear();
    cleanup();
  }
}

function releaseFaderAppliesImmediately({
  rangeId, storageKey, value,
}) {
  const { rerenders, cleanup } = setup();
  try {
    const range = document.getElementById(rangeId);
    range.value = String(value);
    range.dispatchEvent(new window.Event("input"));
    range.dispatchEvent(new window.Event("change"));
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem(storageKey), String(value));
  } finally {
    window.localStorage.clear();
    cleanup();
  }
}

test("dragging a fader updates its readout live, and re-renders only once settled", (t) => {
  dragFaderDebounces(t, {
    rangeId: "mixerBassRange",
    readoutId: "mixerBassReadout",
    fillId: "mixerBassFill",
    storageKey: "rj.mixerBassVolume",
    value: 42,
    getValue: (ctx) => ctx.state.mixer.bassVolume,
  });
});

test("releasing a fader (change) applies immediately without waiting for the debounce", () => {
  releaseFaderAppliesImmediately({ rangeId: "mixerBassRange", storageKey: "rj.mixerBassVolume", value: 10 });
});

test("the Bass mute button flips state, updates the button (icon + label included) and re-renders at once", () => {
  const { ctx, rerenders, cleanup } = setup();
  try {
    const btn = document.getElementById("mixerBassMuteBtn");
    const icon = btn.querySelector(".fa-solid");
    btn.dispatchEvent(new window.Event("click"));
    assert.equal(ctx.state.mixer.bassMuted, true);
    assert.equal(btn.classList.contains("is-muted"), true);
    assert.equal(btn.getAttribute(ARIA_PRESSED), "true");
    assert.equal(icon.classList.contains("fa-volume-xmark"), true);
    assert.equal(icon.classList.contains("fa-volume-high"), false);
    assert.equal(btn.title, "Unmute bass");
    assert.equal(btn.getAttribute("aria-label"), "Unmute bass");
    assert.equal(document.getElementById("mixerBassReadout").textContent, "Muted");
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem("rj.mixerBassMuted"), "1");

    btn.dispatchEvent(new window.Event("click"));
    assert.equal(ctx.state.mixer.bassMuted, false);
    assert.equal(btn.classList.contains("is-muted"), false);
    assert.equal(btn.getAttribute(ARIA_PRESSED), "false");
    assert.equal(icon.classList.contains("fa-volume-xmark"), false);
    assert.equal(icon.classList.contains("fa-volume-high"), true);
    assert.equal(btn.title, "Mute bass");
    assert.equal(rerenders.length, 2);
    assert.equal(window.localStorage.getItem("rj.mixerBassMuted"), "0");
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

function inactiveFlags() {
  return ["Bass", "Chords"].map(
    (cap) => document.getElementById(`mixerStrip${cap}`).classList.contains("is-inactive"),
  );
}

test("refresh() gates Bass/Chords on hasChords", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    ctx.state.hasChords = false;
    mixer.refresh();
    assert.deepEqual(inactiveFlags(), [true, true]);

    ctx.state.hasChords = true;
    mixer.refresh();
    assert.deepEqual(inactiveFlags(), [false, false]);
  } finally {
    cleanup();
  }
});

test("a gated channel's controls get the disabled property too, not just dimmed CSS — a keyboard/AT user can't reach them either", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    ctx.state.hasChords = false;
    mixer.refresh();
    assert.equal(document.getElementById("mixerBassRange").disabled, true);
    assert.equal(document.getElementById("mixerBassMuteBtn").disabled, true);
    assert.equal(document.getElementById("mixerBassVoiceSelect").disabled, true);

    ctx.state.hasChords = true;
    mixer.refresh();
    assert.equal(document.getElementById("mixerBassRange").disabled, false);
    assert.equal(document.getElementById("mixerBassMuteBtn").disabled, false);
    assert.equal(document.getElementById("mixerBassVoiceSelect").disabled, false);
  } finally {
    cleanup();
  }
});

test("refresh() redraws each strip's fill/readout/mute button and the Quality toggle from current state, not just the gates", () => {
  const { ctx, mixer, cleanup } = setup({ bassVolume: 20 });
  try {
    // Mutate state directly (bypassing the input handlers) and confirm
    // refresh() alone picks it up.
    ctx.state.mixer.bassVolume = 77;
    ctx.state.mixer.chordsMuted = true;
    ctx.state.highQualityAudio = true;
    mixer.refresh();
    assert.equal(document.getElementById("mixerBassFill").style.width, "77%");
    assert.equal(document.getElementById("mixerBassReadout").textContent, "77%");
    assert.equal(document.getElementById("mixerChordsReadout").textContent, "Muted");
    assert.equal(document.getElementById("mixerHighQualityToggleBtn").classList.contains("is-active"), true);
  } finally {
    cleanup();
  }
});

test("dragging a fader repeatedly before it settles still applies only once (the pending apply is cancelled and rescheduled, not stacked)", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ctx, rerenders, cleanup } = setup();
  try {
    const range = document.getElementById("mixerBassRange");
    for (const value of [10, 20, 30]) {
      range.value = String(value);
      range.dispatchEvent(new window.Event("input"));
    }
    t.mock.timers.tick(300);
    assert.equal(rerenders.length, 1); // not 3
    assert.equal(ctx.state.mixer.bassVolume, 30);
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("releasing a fader (change) right after dragging it cancels the pending debounced apply instead of double-applying", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { rerenders, cleanup } = setup();
  try {
    const range = document.getElementById("mixerBassRange");
    range.value = "15";
    range.dispatchEvent(new window.Event("input"));
    range.value = "25";
    range.dispatchEvent(new window.Event("change"));
    assert.equal(rerenders.length, 1);
    t.mock.timers.tick(300);
    assert.equal(rerenders.length, 1); // the cancelled debounce never fires a second apply
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("init seeds each Voice select's value from ctx.state.mixer, not just its channel default", () => {
  const { cleanup } = setup({ bassProgram: 33, chordsProgram: 0 });
  try {
    assert.equal(document.getElementById("mixerBassVoiceSelect").value, "33");
    // GM program 0 is falsy but not null — must still seed as "0", not fall through to the channel default
    assert.equal(document.getElementById("mixerChordsVoiceSelect").value, "0");
  } finally {
    cleanup();
  }
});

test("init seeds an un-overridden Voice select on the channel's own built-in program, never a blank Default", () => {
  const { cleanup } = setup({ bassProgram: null, chordsProgram: null });
  try {
    assert.equal(document.getElementById("mixerBassVoiceSelect").value, String(DEFAULT_PROGRAM.bass));
    assert.equal(document.getElementById("mixerChordsVoiceSelect").value, String(DEFAULT_PROGRAM.chords));
  } finally {
    cleanup();
  }
});

test("Escape does nothing while the panel is already closed, and a non-Escape key doesn't close it while open", () => {
  const { mixer, cleanup } = setup();
  try {
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(document.getElementById("mixerPanel").open, false); // no-op, not an error

    mixer.toggle();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(document.getElementById("mixerPanel").open, true);
  } finally {
    cleanup();
  }
});

test("resizing the window recomputes the panel's position while open, and is a no-op while closed", () => {
  const { mixer, cleanup } = setup();
  try {
    const btn = document.getElementById("mixerBtn");
    const panel = document.getElementById("mixerPanel");
    btn.getBoundingClientRect = () => ({
      top: 5, bottom: 25, left: 0, right: 50, width: 50, height: 20,
    });
    window.dispatchEvent(new window.Event("resize"));
    assert.equal(panel.style.top, ""); // closed — the resize listener didn't touch it

    mixer.toggle();
    btn.getBoundingClientRect = () => ({
      top: 100, bottom: 120, left: 0, right: 50, width: 50, height: 20,
    });
    window.dispatchEvent(new window.Event("resize"));
    assert.equal(panel.style.top, "120px");
  } finally {
    cleanup();
  }
});

test("loadMixerState defaults Bass/Chords to full volume, muted, every Voice on Default", () => {
  const page = mountPage();
  try {
    assert.deepEqual(loadMixerState(), {
      bassVolume: 100, chordsVolume: 100,
      bassMuted: true, chordsMuted: true,
      bassProgram: null, chordsProgram: null,
    });
  } finally {
    page.cleanup();
  }
});

test("loadMixerState reads back persisted, clamped values and a chosen program", () => {
  const page = mountPage();
  try {
    window.localStorage.setItem("rj.mixerBassVolume", "150"); // clamped
    window.localStorage.setItem("rj.mixerChordsVolume", "20");
    window.localStorage.setItem("rj.mixerBassMuted", "0"); // explicit opt-in override
    window.localStorage.setItem("rj.mixerChordsProgram", "0"); // GM 0 is falsy — must not read back as null
    assert.deepEqual(loadMixerState(), {
      bassVolume: 100, chordsVolume: 20,
      bassMuted: false, chordsMuted: true,
      bassProgram: null, chordsProgram: 0,
    });
  } finally {
    window.localStorage.clear();
    page.cleanup();
  }
});

test("loadMixerState reads an explicitly-persisted empty-string program back as Default (null), not GM program 0", () => {
  const page = mountPage();
  try {
    window.localStorage.setItem("rj.mixerBassProgram", "");
    assert.equal(loadMixerState().bassProgram, null);
  } finally {
    window.localStorage.clear();
    page.cleanup();
  }
});

test("init populates every Voice select from GM_VOICES, grouped, with no Default option", () => {
  const { cleanup } = setup();
  try {
    const select = document.getElementById("mixerBassVoiceSelect");
    assert.equal(select.options.length, GM_VOICES.length); // no leading Default placeholder
    assert.equal([...select.options].some((o) => o.value === ""), false);
    // one <optgroup> per distinct group, not one per voice
    const distinctGroups = [...new Set(GM_VOICES.map((v) => v.group))];
    const optgroups = [...select.querySelectorAll("optgroup")];
    assert.equal(optgroups.length, distinctGroups.length);
    assert.deepEqual(optgroups.map((g) => g.label), distinctGroups.map((g) => g.toUpperCase()));
    assert.equal(select.querySelector(`optgroup[label="${GM_VOICES[0].group.toUpperCase()}"] option`).text, GM_VOICES[0].label.toUpperCase());
  } finally {
    cleanup();
  }
});

test("choosing a Voice persists the GM program and re-renders immediately", () => {
  const { ctx, rerenders, cleanup } = setup();
  try {
    const select = document.getElementById("mixerBassVoiceSelect");
    select.value = "33";
    select.dispatchEvent(new window.Event("change"));
    assert.equal(ctx.state.mixer.bassProgram, 33);
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem("rj.mixerBassProgram"), "33");
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("init populates the Pattern select with every GCHORD_PATTERNS entry, seeded from ctx.state.gchordPattern", () => {
  const { cleanup } = setup();
  try {
    const select = document.getElementById("mixerGchordPatternSelect");
    assert.equal(select.options.length, GCHORD_PATTERNS.length);
    assert.equal(select.options[0].value, "default");
    assert.equal(select.options[0].text, GCHORD_PATTERNS[0].label.toUpperCase());
    assert.equal(select.value, "jazz"); // ctx.state.gchordPattern from the test helper
  } finally {
    cleanup();
  }
});

test("choosing a Pattern persists it and re-renders immediately", () => {
  const { ctx, rerenders, cleanup } = setup();
  try {
    const select = document.getElementById("mixerGchordPatternSelect");
    select.value = "waltz";
    select.dispatchEvent(new window.Event("change"));
    assert.equal(ctx.state.gchordPattern, "waltz");
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem("rj.mixerGchordPattern"), "waltz");
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("refresh() gates the Pattern picker on hasChords, same as Bass/Chords", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    ctx.state.hasChords = false;
    mixer.refresh();
    assert.equal(document.getElementById("mixerStripPattern").classList.contains("is-inactive"), true);
    assert.equal(document.getElementById("mixerGchordPatternSelect").disabled, true);

    ctx.state.hasChords = true;
    mixer.refresh();
    assert.equal(document.getElementById("mixerStripPattern").classList.contains("is-inactive"), false);
    assert.equal(document.getElementById("mixerGchordPatternSelect").disabled, false);
  } finally {
    cleanup();
  }
});

test("init seeds the Swing range from ctx.state.swing and shows Off at 0", () => {
  const { cleanup } = setup();
  try {
    assert.equal(document.getElementById("mixerSwingRange").value, "0");
    assert.equal(document.getElementById("mixerSwingReadout").textContent, "Off");
  } finally {
    cleanup();
  }
});

test("init seeds the Swing range, readout, and fill from a non-default ctx.state.swing", () => {
  const { cleanup } = setup({}, { swing: 40 });
  try {
    assert.equal(document.getElementById("mixerSwingRange").value, "40");
    assert.equal(document.getElementById("mixerSwingReadout").textContent, "40%");
    assert.equal(document.getElementById("mixerSwingFill").style.width, "40%");
  } finally {
    cleanup();
  }
});

test("dragging the Swing fader updates its readout live, and re-renders only once settled", (t) => {
  dragFaderDebounces(t, {
    rangeId: "mixerSwingRange",
    readoutId: "mixerSwingReadout",
    fillId: "mixerSwingFill",
    storageKey: "rj.mixerSwing",
    value: 40,
    getValue: (ctx) => ctx.state.swing,
  });
});

test("releasing the Swing fader (change) applies immediately without waiting for the debounce", () => {
  releaseFaderAppliesImmediately({ rangeId: "mixerSwingRange", storageKey: "rj.mixerSwing", value: 60 });
});

test("loadSwingState defaults to 0 (off), reads back a persisted, clamped value", () => {
  const page = mountPage();
  try {
    assert.equal(loadSwingState(), 0);
    window.localStorage.setItem("rj.mixerSwing", "150"); // clamped
    assert.equal(loadSwingState(), 100);
  } finally {
    window.localStorage.clear();
    page.cleanup();
  }
});

test("loadSwingState falls back to off on a corrupted (non-numeric) stored value", () => {
  const page = mountPage();
  try {
    window.localStorage.setItem("rj.mixerSwing", "invalid");
    assert.equal(loadSwingState(), 0);
  } finally {
    window.localStorage.clear();
    page.cleanup();
  }
});

test("clicking the Quality toggle flips ctx.state.highQualityAudio, persists it, updates the button, and re-renders at once", () => {
  const { ctx, rerenders, cleanup } = setup();
  try {
    const btn = document.getElementById("mixerHighQualityToggleBtn");
    assert.equal(btn.classList.contains("is-active"), false);

    btn.dispatchEvent(new window.Event("click"));
    assert.equal(ctx.state.highQualityAudio, true);
    assert.equal(btn.classList.contains("is-active"), true);
    assert.equal(btn.getAttribute(ARIA_PRESSED), "true");
    assert.equal(btn.querySelector(".fa-solid").classList.contains("fa-toggle-on"), true);
    assert.equal(btn.title, "Disable high quality audio");
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem("rj.highQualityAudio"), "1");

    btn.dispatchEvent(new window.Event("click"));
    assert.equal(ctx.state.highQualityAudio, false);
    assert.equal(btn.classList.contains("is-active"), false);
    assert.equal(btn.getAttribute(ARIA_PRESSED), "false");
    assert.equal(btn.querySelector(".fa-solid").classList.contains("fa-toggle-on"), false);
    assert.equal(btn.querySelector(".fa-solid").classList.contains("fa-toggle-off"), true);
    assert.equal(btn.title, "Enable high quality audio");
    assert.equal(rerenders.length, 2);
    assert.equal(window.localStorage.getItem("rj.highQualityAudio"), "0");
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("loadHighQualityAudioState defaults to off, and reflects a persisted '1'", () => {
  const page = mountPage();
  try {
    assert.equal(loadHighQualityAudioState(), false);
    window.localStorage.setItem("rj.highQualityAudio", "1");
    assert.equal(loadHighQualityAudioState(), true);
  } finally {
    window.localStorage.clear();
    page.cleanup();
  }
});

test("loadGchordPatternState defaults to 'jazz', reads back a persisted choice, and falls back on a stale one", () => {
  const page = mountPage();
  try {
    assert.equal(loadGchordPatternState(), "jazz");

    window.localStorage.setItem("rj.mixerGchordPattern", "waltz");
    assert.equal(loadGchordPatternState(), "waltz");

    window.localStorage.setItem("rj.mixerGchordPattern", "not-a-real-pattern");
    assert.equal(loadGchordPatternState(), "jazz");
  } finally {
    window.localStorage.clear();
    page.cleanup();
  }
});

// The resolved voice list a Trumpet+Sousaphone chart (no Comping) hands to
// syncVoices — see lib/audio-mix.js's resolveMixerVoices, which is what
// actually produces this shape in the real app; mixer.js itself is agnostic
// to where the list came from.
const FUNKIN_VOICES = [
  { id: "1", index: 0, label: "Trumpet" },
  { id: "2", index: 1, label: "Sousaphone" },
];

test("before any song is open, the voices list is empty (no strips)", () => {
  const { cleanup } = setup();
  try {
    assert.equal(document.getElementById("mixerVoicesSection").hidden, false);
    assert.equal(document.querySelectorAll(VOICE_ROWS_SELECTOR).length, 0);
  } finally {
    cleanup();
  }
});

test("syncVoices builds one strip per resolved voice, titled from its label, same shape as Bass/Chords minus a working fader", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    mixer.syncVoices(FUNKIN_VOICES);

    const rows = document.querySelectorAll(VOICE_ROWS_SELECTOR);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, TRUMPET_STRIP_ID);
    assert.equal(rows[0].querySelector(".mixer-strip-label").textContent, "Trumpet");
    assert.equal(rows[1].id, SOUSAPHONE_STRIP_ID);
    assert.equal(rows[1].querySelector(".mixer-strip-label").textContent, "Sousaphone");
    // Mute + Voice picker real, fader locked (same reasoning as Melody/Comping before this generalisation).
    assert.equal(rows[0].querySelector('input[type="range"]').disabled, true);
    assert.equal(rows[0].querySelector(".mixer-voice-select").disabled, false);

    assert.deepEqual(ctx.state.mixerVoices.map((v) => [v.id, v.label, v.muted, v.program]), [
      ["1", "Trumpet", false, null],
      ["2", "Sousaphone", false, null],
    ]);
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("a single resolved voice (an ordinary tune's own 'Melody') still gets one strip, same as any other voice", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    mixer.syncVoices([{ id: "1", index: 0, label: "Melody" }]);
    const rows = document.querySelectorAll(VOICE_ROWS_SELECTOR);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "mixerVoiceStrip-melody");
    assert.equal(rows[0].querySelector(".mixer-strip-label").textContent, "Melody");
    assert.equal(ctx.state.mixerVoices[0].label, "Melody");
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("a Comping voice appended after the tune's own voices gets its own strip, same shape as any other", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    mixer.syncVoices([...FUNKIN_VOICES, { id: "3", index: 2, label: "Comping" }]);
    const rows = document.querySelectorAll(VOICE_ROWS_SELECTOR);
    assert.equal(rows.length, 3);
    assert.equal(rows[2].id, "mixerVoiceStrip-comping");
    assert.equal(rows[2].querySelector(".mixer-strip-label").textContent, "Comping");
    assert.equal(ctx.state.mixerVoices[2].label, "Comping");
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("two voices that slug to the same name get disambiguated ids/keys", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    mixer.syncVoices([
      { id: "1", index: 0, label: "Trumpet" },
      { id: "2", index: 1, label: "Trumpet" },
    ]);
    assert.deepEqual(ctx.state.mixerVoices.map((v) => v.slug), ["trumpet", "trumpet-2"]);
    assert.ok(document.getElementById(TRUMPET_STRIP_ID));
    assert.ok(document.getElementById("mixerVoiceStrip-trumpet-2"));
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("syncVoices skips rebuilding the panel when the voice list hasn't actually changed", () => {
  const { mixer, cleanup } = setup();
  try {
    mixer.syncVoices(FUNKIN_VOICES);
    const stripBefore = document.getElementById(TRUMPET_STRIP_ID);
    // A fresh array with the same ids/labels (as a rerender would produce).
    mixer.syncVoices([
      { id: "1", index: 0, label: "Trumpet" },
      { id: "2", index: 1, label: "Sousaphone" },
    ]);
    assert.equal(document.getElementById(TRUMPET_STRIP_ID), stripBefore);
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("syncVoices rebuilds when the voice list actually changes (a different song opened)", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    mixer.syncVoices(FUNKIN_VOICES);
    mixer.syncVoices([{ id: "1", index: 0, label: "Root" }, { id: "2", index: 1, label: "Third" }, { id: "3", index: 2, label: "Fifth" }]);
    assert.equal(document.getElementById(TRUMPET_STRIP_ID), null);
    assert.equal(document.querySelectorAll(VOICE_ROWS_SELECTOR).length, 3);
    assert.deepEqual(ctx.state.mixerVoices.map((v) => v.label), ["Root", "Third", "Fifth"]);
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("a voice row's mute button toggles state, updates its own row (icon/label/readout), persists under a slug key and re-renders", () => {
  const { ctx, mixer, rerenders, cleanup } = setup();
  try {
    mixer.syncVoices(FUNKIN_VOICES);
    const muteBtn = document.querySelector(`#${SOUSAPHONE_STRIP_ID} .mixer-mute-btn`);
    const icon = muteBtn.querySelector(".fa-solid");

    muteBtn.dispatchEvent(new window.Event("click"));
    assert.equal(ctx.state.mixerVoices[1].muted, true);
    assert.equal(muteBtn.classList.contains("is-muted"), true);
    assert.equal(muteBtn.getAttribute(ARIA_PRESSED), "true");
    assert.equal(icon.classList.contains("fa-volume-xmark"), true);
    assert.equal(muteBtn.title, "Unmute Sousaphone");
    assert.equal(document.querySelector(`#${SOUSAPHONE_STRIP_ID} .mixer-readout`).textContent, "Muted");
    assert.equal(window.localStorage.getItem("rj.mixerVoice.sousaphone.muted"), "1");
    assert.equal(rerenders.length, 1);

    // Muting one voice leaves the other alone.
    assert.equal(ctx.state.mixerVoices[0].muted, false);

    muteBtn.dispatchEvent(new window.Event("click"));
    assert.equal(ctx.state.mixerVoices[1].muted, false);
    assert.equal(window.localStorage.getItem("rj.mixerVoice.sousaphone.muted"), "0");
    assert.equal(rerenders.length, 2);
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("a voice row's Voice picker sets that voice's program, persists it under a slug key and re-renders", () => {
  const { ctx, mixer, rerenders, cleanup } = setup();
  try {
    mixer.syncVoices(FUNKIN_VOICES);
    const select = document.querySelector(`#${TRUMPET_STRIP_ID} .mixer-voice-select`);
    // Un-overridden, the Trumpet voice's own picker pre-selects its guessed program, not a blank Default.
    assert.equal(select.value, String(guessGmProgram("Trumpet")));
    select.value = "58"; // Tuba
    select.dispatchEvent(new window.Event("change"));
    assert.equal(ctx.state.mixerVoices[0].program, 58);
    assert.equal(window.localStorage.getItem("rj.mixerVoice.trumpet.program"), "58");
    assert.equal(rerenders.length, 1);
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("syncVoices seeds each voice's mute/program from its own persisted rj.mixerVoice.<slug> prefs, and reflects a pre-muted voice on the freshly built row", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    window.localStorage.setItem("rj.mixerVoice.sousaphone.muted", "1");
    window.localStorage.setItem("rj.mixerVoice.sousaphone.program", "58");
    mixer.syncVoices(FUNKIN_VOICES);
    assert.equal(ctx.state.mixerVoices[1].muted, true);
    assert.equal(ctx.state.mixerVoices[1].program, 58);
    assert.equal(document.querySelector(`#${SOUSAPHONE_STRIP_ID} .mixer-voice-select`).value, "58");
    const muteBtn = document.querySelector(`#${SOUSAPHONE_STRIP_ID} .mixer-mute-btn`);
    assert.equal(muteBtn.classList.contains("is-muted"), true);
    assert.equal(document.querySelector(`#${SOUSAPHONE_STRIP_ID} .mixer-readout`).textContent, "Muted");
    // The other voice, with no persisted prefs, keeps the plain defaults.
    assert.equal(ctx.state.mixerVoices[0].muted, false);
    assert.equal(ctx.state.mixerVoices[0].program, null);
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("refresh() also redraws voice rows from current state (not just Bass/Chords)", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    mixer.syncVoices(FUNKIN_VOICES);
    ctx.state.mixerVoices[1].muted = true;
    mixer.refresh();
    const muteBtn = document.querySelector(`#${SOUSAPHONE_STRIP_ID} .mixer-mute-btn`);
    assert.equal(muteBtn.classList.contains("is-muted"), true);
    assert.equal(document.querySelector(`#${SOUSAPHONE_STRIP_ID} .mixer-readout`).textContent, "Muted");
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});
