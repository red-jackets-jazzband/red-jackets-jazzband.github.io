import { byId, el, on } from "../lib/dom.js";
import { readPref, writePref, PREF_KEYS } from "../lib/preferences.js";
import { GM_VOICES } from "../lib/gm-voices.js";

// Full re-engrave (the only way to change what plays — see sheet.js /
// lib/audio-mix.js) is too heavy to run on every "input" tick of a dragged
// slider, so it's debounced; a mute click or a slider release applies at once.
const APPLY_DEBOUNCE_MS = 220;
const REPOSITION_MARGIN = 8;

// Bass/Chords are ABCjs's own auto-accompaniment (independent of the site's
// notated Comping voice) — muted by default so no song suddenly grows a new
// backing band the first time this ships. Melody/Comping keep the old
// mute-melody precedent of starting unmuted.
const CHANNELS = ["melody", "bass", "chords", "comping"];
const DEFAULT_MUTED = { melody: false, bass: true, chords: true, comping: false };

// Melody/Comping don't have a real, working volume fader — see
// lib/audio-mix.js's doc comment for why (their Voice picker and Mute are
// both real). Their range is `disabled` in the markup (content/songs.md);
// this set just controls what the readout says while that holds, so it
// doesn't show a percentage for a slider that can't move.
const VOLUME_LOCKED = new Set(["melody", "comping"]);

// A channel with no gate (melody) is always mixable; bass/chords need the
// tune to have chord symbols at all, comping needs its pattern turned on —
// both read from ctx.state, kept in sync by sheet.js on every render.
const GATE_STATE_KEY = { melody: null, bass: "hasChords", chords: "hasChords", comping: "compingActive" };

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function cap(channel) {
  return channel[0].toUpperCase() + channel.slice(1);
}

function elementIds(channel) {
  const c = cap(channel);
  return {
    range: `mixer${c}Range`,
    fill: `mixer${c}Fill`,
    readout: `mixer${c}Readout`,
    muteBtn: `mixer${c}MuteBtn`,
    strip: `mixerStrip${c}`,
    voiceSelect: `mixer${c}VoiceSelect`,
  };
}

function volumeKey(channel) {
  return PREF_KEYS[`mixer${cap(channel)}Volume`];
}
function mutedKey(channel) {
  return PREF_KEYS[`mixer${cap(channel)}Muted`];
}
function programKey(channel) {
  return PREF_KEYS[`mixer${cap(channel)}Program`];
}

// One <option> per GM_VOICES entry, grouped into <optgroup>s in the order
// each group first appears, plus a leading "Default" option (empty value)
// for "don't override — use this channel's own built-in program", same
// convention as the Instrument / Comping dropdowns in selects.js.
function buildVoiceOptions(select) {
  select.append(el("option", { value: "", text: "DEFAULT" }));
  const groups = new Map();
  for (const voice of GM_VOICES) {
    if (!groups.has(voice.group)) {
      const optgroup = el("optgroup", { label: voice.group.toUpperCase() });
      groups.set(voice.group, optgroup);
      select.append(optgroup);
    }
    groups.get(voice.group).append(el("option", { value: String(voice.value), text: voice.label.toUpperCase() }));
  }
}

/*
  The sheet toolbar's Mixer button (#mixerBtn) and its popover/bottom-sheet
  panel (#mixerPanel): four channels — Melody, Bass, Chords (the latter two
  ABCjs's own auto-accompaniment, generated from the tune's chord symbols)
  and Comping (this site's notated root/3rd/5th voice, as one bus) — each a
  mute button, a 0-100 volume fader and a Voice picker (a GM instrument
  select — see lib/gm-voices.js — defaulting to "Default", i.e. that
  channel's own built-in program). Values are sticky across songs (persisted
  like the instrument / comping choices, see lib/preferences.js).

  Every channel's Mute and Voice are real, read by sheet.js at render time
  (lib/audio-mix.js's injectMixerAudio; Melody/Comping's Mute instead goes
  through audio-player.js's computeVoicesOff — see lib/audio-mix.js's doc
  comment for why the two channel groups use different mechanisms). Only
  Bass/Chords' *volume* fader is real, where a muted channel is just its
  fader value read as 0 (see sheet.js's effectiveMixerPercent); Melody/
  Comping's fader is `disabled` in the markup instead of pretending to work.
  This module only owns the panel's DOM and ctx.state.mixer, so it's still
  tracking Melody/Comping's fader value (sticky, ready for whenever that's
  fixed for real) even while that one control is locked.
*/
function readoutText(channel, percent, muted) {
  if (muted) return "Muted";
  if (VOLUME_LOCKED.has(channel)) return "—";
  return `${percent}%`;
}

// A fixed-position popover attached flush under the button on desktop —
// same idea as the Instrument <select>'s native dropdown sitting right
// against the field it belongs to, not floating apart from it. The same
// element becomes a bottom sheet under the 1024px breakpoint (CSS
// !important overrides these inline coordinates there) — see split.css.
function positionPanel() {
  const btn = byId("mixerBtn");
  const panel = byId("mixerPanel");
  if (!btn || !panel) return;
  const rect = btn.getBoundingClientRect();
  panel.style.top = `${rect.bottom}px`;
  panel.style.right = `${Math.max(REPOSITION_MARGIN, window.innerWidth - rect.right)}px`;
}

export function createMixer(ctx) {
  let open = false;
  let applyTimer = null;

  function persist() {
    const m = ctx.state.mixer;
    CHANNELS.forEach((channel) => {
      writePref(volumeKey(channel), String(m[`${channel}Volume`]));
      writePref(mutedKey(channel), m[`${channel}Muted`] ? "1" : "0");
      const program = m[`${channel}Program`];
      writePref(programKey(channel), program === null ? "" : String(program));
    });
  }

  function commit() {
    applyTimer = null;
    persist();
    ctx.sheet.rerender();
  }

  function scheduleApply() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(commit, APPLY_DEBOUNCE_MS);
  }

  function applyNow() {
    clearTimeout(applyTimer);
    applyTimer = null;
    persist();
    ctx.sheet.rerender();
  }

  function updateStripVisual(channel) {
    const m = ctx.state.mixer;
    const percent = m[`${channel}Volume`];
    const muted = m[`${channel}Muted`];
    const ids = elementIds(channel);

    const fill = byId(ids.fill);
    if (fill) fill.style.width = `${percent}%`;

    const readout = byId(ids.readout);
    if (readout) readout.textContent = readoutText(channel, percent, muted);

    const muteBtn = byId(ids.muteBtn);
    if (muteBtn) {
      muteBtn.classList.toggle("is-muted", muted);
      muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
      const icon = muteBtn.querySelector(".fa-solid");
      if (icon) icon.classList.toggle("fa-volume-xmark", muted);
      if (icon) icon.classList.toggle("fa-volume-high", !muted);
      const label = `${muted ? "Unmute" : "Mute"} ${channel}`;
      muteBtn.title = label;
      muteBtn.setAttribute("aria-label", label);
    }
  }

  // A gated channel (Bass/Chords need chords at all; Comping needs its
  // pattern on) only means anything once the current tune actually qualifies
  // — dim it and swap in an explainer otherwise, rather than a fader that
  // silently does nothing. `is-inactive`'s CSS (pointer-events: none) only
  // stops mouse interaction; a keyboard or assistive-technology user could
  // still Tab to and operate a dimmed control, so the actual `disabled`
  // property is toggled here too, in step with the class. Melody/Comping's
  // fader is `disabled` unconditionally already (VOLUME_LOCKED) — leave that
  // alone rather than re-enabling it the moment Comping's gate opens.
  function updateGate(channel) {
    const gateKey = GATE_STATE_KEY[channel];
    if (!gateKey) return;
    const inactive = !ctx.state[gateKey];
    const ids = elementIds(channel);
    const strip = byId(ids.strip);
    if (strip) strip.classList.toggle("is-inactive", inactive);
    const range = byId(ids.range);
    if (range && !VOLUME_LOCKED.has(channel)) range.disabled = inactive;
    const muteBtn = byId(ids.muteBtn);
    if (muteBtn) muteBtn.disabled = inactive;
    const select = byId(ids.voiceSelect);
    if (select) select.disabled = inactive;
  }

  function refresh() {
    CHANNELS.forEach((channel) => {
      updateStripVisual(channel);
      updateGate(channel);
    });
  }

  function wireStrip(channel) {
    const ids = elementIds(channel);
    const range = byId(ids.range);
    if (range) {
      range.value = String(ctx.state.mixer[`${channel}Volume`]);
      range.addEventListener("input", () => {
        ctx.state.mixer[`${channel}Volume`] = clampPercent(range.value);
        updateStripVisual(channel);
        scheduleApply();
      });
      range.addEventListener("change", applyNow);
    }
    on(ids.muteBtn, "click", () => {
      const key = `${channel}Muted`;
      ctx.state.mixer[key] = !ctx.state.mixer[key];
      updateStripVisual(channel);
      applyNow();
    });

    const select = byId(ids.voiceSelect);
    if (select) {
      buildVoiceOptions(select);
      const program = ctx.state.mixer[`${channel}Program`];
      select.value = program === null ? "" : String(program);
      select.addEventListener("change", () => {
        ctx.state.mixer[`${channel}Program`] = select.value === "" ? null : Number(select.value);
        applyNow();
      });
    }
  }

  function setOpen(next) {
    open = next;
    const panel = byId("mixerPanel");
    const backdrop = byId("mixerBackdrop");
    const btn = byId("mixerBtn");
    // #mixerPanel is a native <dialog>: its `open` attribute is what the
    // browser's own dialog:not([open]) { display: none } rule keys off, so
    // this toggles that directly rather than the generic `hidden` attribute.
    if (panel) panel.open = open;
    if (backdrop) backdrop.hidden = !open;
    if (btn) {
      btn.classList.toggle("active", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (open) {
      refresh();
      positionPanel();
    }
  }

  // The mobile bottom-sheet has a dimming #mixerBackdrop to tap; the desktop
  // popover doesn't (split.css hides it above 1024px), so a plain click
  // anywhere outside the panel and its own toggle button closes it there —
  // same expectation as a native <select> dropdown or any other popover.
  function closeOnOutsideClick(e) {
    if (!open) return;
    const panel = byId("mixerPanel");
    const btn = byId("mixerBtn");
    if (panel?.contains(e.target)) return;
    if (btn?.contains(e.target)) return;
    setOpen(false);
  }

  function init() {
    CHANNELS.forEach(wireStrip);

    on("mixerCloseBtn", "click", () => setOpen(false));
    on("mixerBackdrop", "click", () => setOpen(false));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && open) setOpen(false);
    });
    document.addEventListener("click", closeOnOutsideClick);
    window.addEventListener("resize", () => {
      if (open) positionPanel();
    });
    // The sheet's own content column scrolls internally (.split-content's
    // overflow: auto), not the window — its scroll event doesn't bubble, so
    // this has to listen in the capture phase to still catch it and keep the
    // fixed-position panel glued under the button as it moves.
    window.addEventListener("scroll", () => {
      if (open) positionPanel();
    }, true);

    refresh();
  }

  return {
    init,
    refresh,
    toggle() {
      setOpen(!open);
    },
  };
}

// The mixer's initial ctx.state.mixer slice, seeded from persisted prefs —
// built here (not inline in app.js) so the persistence/defaulting logic
// lives next to the module that owns the rest of this state.
export function loadMixerState() {
  const state = {};
  CHANNELS.forEach((channel) => {
    const storedVolume = readPref(volumeKey(channel));
    state[`${channel}Volume`] = storedVolume === null ? 100 : clampPercent(storedVolume);
    const storedMuted = readPref(mutedKey(channel));
    state[`${channel}Muted`] = storedMuted === null ? DEFAULT_MUTED[channel] : storedMuted === "1";
    const storedProgram = readPref(programKey(channel));
    state[`${channel}Program`] = storedProgram === null || storedProgram === "" ? null : Number(storedProgram);
  });
  return state;
}
