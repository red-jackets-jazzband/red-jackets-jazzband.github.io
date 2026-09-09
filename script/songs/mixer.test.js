import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPage } from "../../../tests/helpers/dom.js";
import { makeCtx } from "../../../tests/helpers/ctx.js";
import { createMixer, loadMixerState } from "./mixer.js";
import { GM_VOICES } from "../lib/gm-voices.js";

function setup(mixerState = {}) {
  const page = mountPage();
  const rerenders = [];
  const ctx = makeCtx({
    state: {
      compingActive: true,
      hasChords: true,
      mixer: {
        melodyVolume: 100, bassVolume: 100, chordsVolume: 100, compingVolume: 100,
        melodyMuted: false, bassMuted: false, chordsMuted: false, compingMuted: false,
        melodyProgram: null, bassProgram: null, chordsProgram: null, compingProgram: null,
        ...mixerState,
      },
    },
    sheet: { rerender: () => rerenders.push(1) },
  });
  const mixer = createMixer(ctx);
  mixer.init();
  return { page, ctx, mixer, rerenders, cleanup: page.cleanup };
}

test("init seeds all four range inputs from ctx.state.mixer", () => {
  const { cleanup } = setup({ melodyVolume: 30, bassVolume: 40, chordsVolume: 50, compingVolume: 60 });
  try {
    assert.equal(document.getElementById("mixerMelodyRange").value, "30");
    assert.equal(document.getElementById("mixerBassRange").value, "40");
    assert.equal(document.getElementById("mixerChordsRange").value, "50");
    assert.equal(document.getElementById("mixerCompingRange").value, "60");
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

test("dragging a fader updates its readout live, and re-renders only once settled", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { ctx, rerenders, cleanup } = setup();
  try {
    const range = document.getElementById("mixerBassRange");
    range.value = "42";
    range.dispatchEvent(new window.Event("input"));

    assert.equal(ctx.state.mixer.bassVolume, 42);
    assert.equal(document.getElementById("mixerBassReadout").textContent, "42%");
    assert.equal(document.getElementById("mixerBassFill").style.width, "42%");
    assert.equal(rerenders.length, 0); // debounced, not yet applied

    t.mock.timers.tick(300);
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem("rj.mixerBassVolume"), "42");
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("releasing a fader (change) applies immediately without waiting for the debounce", () => {
  const { rerenders, cleanup } = setup();
  try {
    const range = document.getElementById("mixerBassRange");
    range.value = "10";
    range.dispatchEvent(new window.Event("input"));
    range.dispatchEvent(new window.Event("change"));
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem("rj.mixerBassVolume"), "10");
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("the mute buttons flip state, update the button and re-render at once", () => {
  const { ctx, rerenders, cleanup } = setup();
  try {
    const btn = document.getElementById("mixerMelodyMuteBtn");
    btn.dispatchEvent(new window.Event("click"));
    assert.equal(ctx.state.mixer.melodyMuted, true);
    assert.equal(btn.classList.contains("is-muted"), true);
    assert.equal(btn.getAttribute("aria-pressed"), "true");
    assert.equal(document.getElementById("mixerMelodyReadout").textContent, "Muted");
    assert.equal(rerenders.length, 1);
    assert.equal(window.localStorage.getItem("rj.mixerMelodyMuted"), "1");

    btn.dispatchEvent(new window.Event("click"));
    assert.equal(ctx.state.mixer.melodyMuted, false);
    assert.equal(rerenders.length, 2);
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

test("Melody/Comping's fader is disabled (Voice picker isn't); their readout reads — until muted", () => {
  const { cleanup } = setup();
  try {
    for (const cap of ["Melody", "Comping"]) {
      assert.equal(document.getElementById(`mixer${cap}Range`).disabled, true);
      assert.equal(document.getElementById(`mixer${cap}VoiceSelect`).disabled, false);
      assert.equal(document.getElementById(`mixer${cap}Readout`).textContent, "—");
    }
    // Bass/Chords stay fully interactive.
    for (const cap of ["Bass", "Chords"]) {
      assert.equal(document.getElementById(`mixer${cap}Range`).disabled, false);
      assert.equal(document.getElementById(`mixer${cap}VoiceSelect`).disabled, false);
    }

    document.getElementById("mixerMelodyMuteBtn").dispatchEvent(new window.Event("click"));
    assert.equal(document.getElementById("mixerMelodyReadout").textContent, "Muted");
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});

function inactiveFlags() {
  return ["Bass", "Chords", "Comping", "Melody"].map(
    (cap) => document.getElementById(`mixerStrip${cap}`).classList.contains("is-inactive"),
  );
}

test("refresh() gates Bass/Chords on hasChords and Comping on compingActive, independently", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    ctx.state.hasChords = false;
    ctx.state.compingActive = true;
    mixer.refresh();
    // Melody has no gate — never dimmed.
    assert.deepEqual(inactiveFlags(), [true, true, false, false]);

    ctx.state.hasChords = true;
    ctx.state.compingActive = false;
    mixer.refresh();
    assert.deepEqual(inactiveFlags(), [false, false, true, false]);
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

test("Comping's gate never re-enables its permanently-locked fader", () => {
  const { ctx, mixer, cleanup } = setup();
  try {
    ctx.state.compingActive = true;
    mixer.refresh();
    // Voice/Mute follow the gate; the fader stays disabled regardless (VOLUME_LOCKED).
    assert.equal(document.getElementById("mixerCompingRange").disabled, true);
    assert.equal(document.getElementById("mixerCompingMuteBtn").disabled, false);
    assert.equal(document.getElementById("mixerCompingVoiceSelect").disabled, false);
  } finally {
    cleanup();
  }
});

test("loadMixerState defaults to full volume, Bass/Chords muted, every Voice on Default", () => {
  const page = mountPage();
  try {
    assert.deepEqual(loadMixerState(), {
      melodyVolume: 100, bassVolume: 100, chordsVolume: 100, compingVolume: 100,
      melodyMuted: false, bassMuted: true, chordsMuted: true, compingMuted: false,
      melodyProgram: null, bassProgram: null, chordsProgram: null, compingProgram: null,
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
      melodyVolume: 100, bassVolume: 100, chordsVolume: 20, compingVolume: 100,
      melodyMuted: false, bassMuted: false, chordsMuted: true, compingMuted: false,
      melodyProgram: null, bassProgram: null, chordsProgram: 0, compingProgram: null,
    });
  } finally {
    window.localStorage.clear();
    page.cleanup();
  }
});

test("init populates every Voice select from GM_VOICES, grouped, with a leading Default option", () => {
  const { cleanup } = setup();
  try {
    const select = document.getElementById("mixerMelodyVoiceSelect");
    assert.equal(select.options[0].value, "");
    assert.equal(select.options[0].text, "DEFAULT");
    assert.equal(select.options.length, GM_VOICES.length + 1); // Default + every curated GM voice
    assert.ok(select.querySelectorAll("optgroup").length > 1);
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

    select.value = "";
    select.dispatchEvent(new window.Event("change"));
    assert.equal(ctx.state.mixer.bassProgram, null);
    assert.equal(window.localStorage.getItem("rj.mixerBassProgram"), "");
  } finally {
    window.localStorage.clear();
    cleanup();
  }
});
