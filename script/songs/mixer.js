import {
  byId, el, on, clear,
} from "../lib/dom.js";
import { readPref, writePref, PREF_KEYS } from "../lib/preferences.js";
import { GM_VOICES, guessGmProgram } from "../lib/gm-voices.js";
import { GCHORD_PATTERNS, DEFAULT_GCHORD_PATTERN_VALUE, DEFAULT_PROGRAM } from "../lib/audio-mix.js";

// Full re-engrave (the only way to change what plays — see sheet.js /
// lib/audio-mix.js) is too heavy to run on every "input" tick of a dragged
// slider, so it's debounced; a mute click or a slider release applies at once.
const APPLY_DEBOUNCE_MS = 220;
const REPOSITION_MARGIN = 8;

// Bass/Chords are the only fixed channels left — ABCjs's own auto-
// accompaniment, generated from the tune's chord symbols, with a real
// working volume fader (see lib/audio-mix.js's file doc comment for why
// they're different from every other voice below). Muted by default so no
// song suddenly grows a new backing band the first time this ships.
const CHANNELS = ["bass", "chords"];
const DEFAULT_MUTED = { bass: true, chords: true };

// Both remaining fixed channels need the tune to have chord symbols at all
// to do anything — read from ctx.state, kept in sync by sheet.js on every
// render.
const GATE_STATE_KEY = { bass: "hasChords", chords: "hasChords" };

// Swing isn't a channel either (no mute/Voice, no CHANNELS entry) — a single
// tune-wide fader next to Pattern, feeding ABCjs's own `swing` synth option
// (see lib/audio-mix.js's percentToAbcjsSwing doc comment) rather than
// anything baked into the ABC text. No gate: it's audible on any tune with
// eighth notes, chords or not.
const SWING_DEFAULT_PERCENT = 0;

// Voice strips (see syncVoices) have no established colour coding the way
// Bass/Chords do — this just cycles a handful of distinct swatch colours
// (split.css) by list position so 2-4 voices on one tune (Trumpet +
// Sousaphone, or an ordinary tune's Melody + Comping) are still visually
// distinguishable at a glance.
const VOICE_SWATCH_CLASSES = [
  "mixer-swatch--voice-0", "mixer-swatch--voice-1", "mixer-swatch--voice-2", "mixer-swatch--voice-3",
];

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
// each group first appears. There's no leading "Default" placeholder —
// a channel left un-overridden (ctx.state.mixer.<channel>Program /
// v.program still null) is displayed pre-selected on whichever real
// instrument it's actually playing (see resolveEffectiveProgram), so the
// picker always shows the sound in effect and never the word "Default".
function buildVoiceOptions(select) {
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

// One <option> per GCHORD_PATTERNS entry, in the order they're declared
// there (Default first) — no grouping, no leading blank option, since every
// entry (including "Default") is itself a meaningful choice here, unlike the
// Voice pickers, which never show the word "Default" at all (see
// resolveEffectiveProgram).
function buildGchordPatternOptions(select) {
  GCHORD_PATTERNS.forEach((p) => {
    select.append(el("option", { value: p.value, text: p.label.toUpperCase() }));
  });
}

/*
  The sheet toolbar's Mixer button (#mixerBtn) and its popover/bottom-sheet
  panel (#mixerPanel): two fixed channels, Bass and Chords — ABCjs's own
  auto-accompaniment, generated from the tune's chord symbols — each a mute
  button, a real 0-100 volume fader and a Voice picker (a GM instrument
  select, see lib/gm-voices.js). Left un-overridden, it shows pre-selected on
  the channel's own built-in program (DEFAULT_PROGRAM) rather than a
  "Default" placeholder — see resolveEffectiveProgram. Values are sticky
  across songs (persisted like the instrument/comping choices, see
  lib/preferences.js). Gated on hasChords
  (updateGate): a gated channel with nothing to mix hides its whole strip.

  Above Bass/Chords sits the tune's own voice list — #mixerVoicesSection/
  #mixerVoicesList, built dynamically by syncVoices() below rather than
  content/songs.md's fixed markup, since the count and names vary per song.
  This is the one generalisation everything else here builds on: a tune is
  always N voices — its own melody line for an ordinary tune, or however
  many named staves a chart like a Rebirth Brass Band tune's Trumpet +
  Sousaphone declares (lib/audio-mix.js's parseVoiceList) — plus Comping
  appended as voice N+1 whenever its pattern picker is on. There is no
  separate "Melody channel" or "Comping channel" any more; resolveMixerVoices
  (lib/audio-mix.js) resolves each one's display name (a real name="..." if
  the ABC has one, else "Melody"/"Melody 1"/"Melody 2".../"Comping" — see its
  own doc comment) and sheet.js hands the result to syncVoices() on every
  render. Every row is the same shape: Mute + Voice picker real (read by
  sheet.js at render time via lib/audio-mix.js's injectMixerAudio, and Mute
  via audio-player.js's computeVoicesOff — see lib/audio-mix.js's doc comment
  for why not volume too), fader `disabled` (`.mixer-strip--volume-locked`).
  Persisted by a slug of the voice's own resolved name, not by song + numeric
  id, so e.g. every "Sousaphone" part across every song on this site — or
  every song's own "Comping" voice — shares one sticky Mute/Voice choice.

  Below Bass/Chords sits a third fixed control: the Pattern picker
  (#mixerGchordPatternSelect, ctx.state.gchordPattern), which chooses the
  rhythm the Bass/Chords auto-accompaniment plays via %%MIDI gchord (see
  lib/audio-mix.js's GCHORD_PATTERNS/resolveGchordPattern and sheet.js's
  resolveRenderText). It gates on hasChords the same way Bass/Chords do
  (updatePatternGate), since a pattern picked for an accompaniment that
  isn't playing has nothing to audibly change.

  Next comes Swing (#mixerSwingRange, ctx.state.swing): a tune-wide 0-100
  fader, same look and drag/release behaviour as a channel volume fader but
  ungated (there's no "no swing to mix" state — it's audible on any tune).
  It maps onto ABCjs's own `swing` synth init option (lib/audio-mix.js's
  percentToAbcjsSwing) rather than a %%MIDI text directive, so
  audio-player.js's synthParams reads ctx.state.swing directly instead of
  going through sheet.js's injectMixerAudio.

  At the bottom of the panel, Metronome and Quality share one row
  (#mixerStripMetronome / #mixerStripQuality, each a plain
  .mixer-toggle-item) — neither has a fader or Voice picker to wrap onto a
  second line, so they sit side by side instead of stacking like every
  strip above them.
*/
function readoutText(percent, muted) {
  return muted ? "Muted" : `${percent}%`;
}

// A Voice picker's stored program is `null` until a listener explicitly
// overrides it (see mixerProgram/voiceProgramMap in sheet.js, which resolve
// that same null the same way at render time) — this is only about what the
// <select> should show meanwhile: whichever real instrument is actually
// sounding, never a placeholder "Default" entry.
function resolveEffectiveProgram(program, fallbackProgram) {
  return program === null ? fallbackProgram : program;
}

// A slug of a voice's own resolved display name (lib/audio-mix.js's
// resolveMixerVoices — "Melody", "Trumpet", "Comping", ...), for both its DOM
// id and its localStorage key — lowercased, non-alphanumerics collapsed to
// one hyphen, trimmed. Falls back to "voice" for a name that's entirely
// punctuation/whitespace (never happens in practice — every resolved label
// is already alphanumeric).
function voiceSlug(label) {
  // Non-alphanumeric runs already collapse to exactly one hyphen above, so a
  // leading/trailing run leaves at most one hyphen to strip on each end —
  // no `+` needed, which sidesteps sonarjs/super-linear-regex entirely.
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-/, "").replace(/-$/, "");
  return slug || "voice";
}

// Two voices in the same tune whose names slug to the same string (e.g. two
// parts both literally named "Trumpet") would otherwise collide on both DOM
// id and localStorage key — number the second and later ones so each still
// gets its own row and its own sticky preference.
function dedupeVoiceSlugs(voices) {
  const seen = new Map();
  return voices.map((v) => {
    const base = voiceSlug(v.label);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { ...v, slug: count === 1 ? base : `${base}-${count}` };
  });
}

function voiceMutedKey(slug) {
  return `rj.mixerVoice.${slug}.muted`;
}
function voiceProgramKey(slug) {
  return `rj.mixerVoice.${slug}.program`;
}

// A stable signature for the current tune's resolved voice list — cheap to
// compare so syncVoices() below can skip rebuilding the panel's DOM on every
// rerender (a mute/Voice change, a Key/Tempo edit, ...) and only do it when
// the set of voices actually changed (a different song opened, or Comping
// toggled on/off — resolveMixerVoices appends/drops the extra entry).
function voiceListSignature(voices) {
  return voices.map((v) => `${v.id}|${v.label}`).join("|");
}

// One channel strip for one of the tune's resolved voices (lib/audio-mix.js's
// resolveMixerVoices — an ordinary tune's Melody, a chart's own named staves,
// or Comping), built with `el()` rather than static markup since the count
// and labels vary per song. Returns the strip plus the sub-elements
// rebuildVoiceStrips/updateVoiceRowVisual need.
function buildVoiceStrip(voice) {
  const swatchClass = VOICE_SWATCH_CLASSES[voice.index % VOICE_SWATCH_CLASSES.length];
  const fill = el("div", { class: "mixer-fader-fill" });
  const range = el("input", {
    type: "range",
    min: "0",
    max: "100",
    value: "100",
    disabled: true,
    title: "Volume control isn't available for this voice yet — use Mute",
    attrs: { "aria-label": `${voice.label} volume` },
  });
  const readout = el("span", { class: "mixer-readout", text: "—" });
  const muteIcon = el("span", { class: "fa-solid fa-volume-high", attrs: { "aria-hidden": "true" } });
  const muteBtn = el("button", {
    type: "button",
    class: "mixer-mute-btn",
    attrs: {
      "aria-pressed": "false", title: `Mute ${voice.label}`, "aria-label": `Mute ${voice.label}`,
    },
  }, muteIcon);
  const select = el("select", {
    class: "mixer-voice-select",
    attrs: { "aria-label": `${voice.label} voice` },
  });
  buildVoiceOptions(select);

  const strip = el("div", {
    id: `mixerVoiceStrip-${voice.slug}`,
    class: "mixer-strip mixer-strip--volume-locked mixer-strip--voice",
  }, [
    el("span", { class: `mixer-swatch ${swatchClass}`, attrs: { "aria-hidden": "true" } }),
    el("span", { class: "mixer-strip-label", text: voice.label, attrs: { title: voice.label } }),
    el("div", { class: "mixer-fader-track" }, [fill, range]),
    readout,
    muteBtn,
    select,
  ]);

  return {
    strip, readout, muteBtn, muteIcon, select,
  };
}

// Only touches its own argument (v.slug/v.muted/v.program) and the module-
// level key builders — no ctx, so it belongs at module scope rather than
// nested inside createMixer.
function persistVoiceState(v) {
  writePref(voiceMutedKey(v.slug), v.muted ? "1" : "0");
  writePref(voiceProgramKey(v.slug), v.program === null ? "" : String(v.program));
}

// Same reasoning as persistVoiceState above: only reads its own destructured
// argument, no ctx or other createMixer-local state.
function updateVoiceRowVisual({
  v, readout, muteBtn, muteIcon,
}) {
  readout.textContent = v.muted ? "Muted" : "—";
  muteBtn.classList.toggle("is-muted", v.muted);
  muteBtn.setAttribute("aria-pressed", v.muted ? "true" : "false");
  muteIcon.classList.toggle("fa-volume-xmark", v.muted);
  muteIcon.classList.toggle("fa-volume-high", !v.muted);
  const label = `${v.muted ? "Unmute" : "Mute"} ${v.label}`;
  muteBtn.title = label;
  muteBtn.setAttribute("aria-label", label);
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
    writePref(PREF_KEYS.mixerSwing, String(ctx.state.swing));
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

  // { v, readout, muteBtn, muteIcon, select } per row currently in
  // #mixerVoicesList, in the same order as ctx.state.mixerVoices (whose
  // entries these closures share by reference — mutating v.muted/v.program
  // below mutates the exact object sheet.js reads back out of ctx.state).
  let voiceRows = [];
  let voiceListSig = "";

  function rebuildVoiceStrips() {
    const container = byId("mixerVoicesList");
    if (!container) return;
    clear(container);
    voiceRows = ctx.state.mixerVoices.map((v) => {
      const row = buildVoiceStrip(v);
      container.append(row.strip);
      row.select.value = String(resolveEffectiveProgram(v.program, guessGmProgram(v.label)));
      row.select.addEventListener("change", () => {
        v.program = Number(row.select.value);
        persistVoiceState(v);
        ctx.sheet.rerender();
      });
      on(row.muteBtn, "click", () => {
        v.muted = !v.muted;
        updateVoiceRowVisual({ v, ...row });
        persistVoiceState(v);
        ctx.sheet.rerender();
      });
      const built = { v, ...row };
      // A voice can start pre-muted (a persisted rj.mixerVoice.<slug>.muted
      // pref from an earlier song) — reflect that on the freshly built row
      // immediately, rather than leaving it looking unmuted until the next
      // refresh() call happens to run.
      updateVoiceRowVisual(built);
      return built;
    });
  }

  // Called by sheet.js on every render with the tune's fully resolved voice
  // list (lib/audio-mix.js's resolveMixerVoices — always at least one entry:
  // an ordinary tune's own implicit Melody, a chart's own named voices, plus
  // Comping appended when it's on). Skips the rebuild below when the voice
  // set is unchanged from last time (a mute/Voice/Key/Tempo change
  // re-renders the same song repeatedly) so a mute click doesn't wipe out
  // its own strip's mid-interaction focus.
  function syncVoices(voices) {
    const sig = voiceListSignature(voices);
    if (sig === voiceListSig) return;
    voiceListSig = sig;
    const withSlugs = dedupeVoiceSlugs(voices);
    ctx.state.mixerVoices = withSlugs.map((v) => {
      const muted = readPref(voiceMutedKey(v.slug)) === "1";
      const storedProgram = readPref(voiceProgramKey(v.slug));
      const program = storedProgram === null || storedProgram === "" ? null : Number(storedProgram);
      return { ...v, muted, program };
    });
    rebuildVoiceStrips();
  }

  function updateStripVisual(channel) {
    const m = ctx.state.mixer;
    const percent = m[`${channel}Volume`];
    const muted = m[`${channel}Muted`];
    const ids = elementIds(channel);

    const fill = byId(ids.fill);
    if (fill) fill.style.width = `${percent}%`;

    const readout = byId(ids.readout);
    if (readout) readout.textContent = readoutText(percent, muted);

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

  // Bass/Chords need chord symbols at all to do anything — hide the whole
  // strip otherwise (is-inactive's CSS), rather than a fader that silently
  // does nothing. The `disabled` property is toggled in step with the class
  // too, so a hidden control can't be reached even if something (e.g. a
  // screen reader's DOM-order navigation) ignores the display:none.
  function updateGate(channel) {
    const gateKey = GATE_STATE_KEY[channel];
    const inactive = !ctx.state[gateKey];
    const ids = elementIds(channel);
    const strip = byId(ids.strip);
    if (strip) strip.classList.toggle("is-inactive", inactive);
    const range = byId(ids.range);
    if (range) range.disabled = inactive;
    const muteBtn = byId(ids.muteBtn);
    if (muteBtn) muteBtn.disabled = inactive;
    const select = byId(ids.voiceSelect);
    if (select) select.disabled = inactive;
  }

  // The Pattern picker isn't a channel (no volume/mute/CHANNELS entry — same
  // idea as Metronome next to it), but it does gate on hasChords like Bass/
  // Chords: picking a pattern for an auto-accompaniment that isn't playing
  // does nothing audible, so it's hidden the same way rather than left live.
  function updatePatternGate() {
    const inactive = !ctx.state.hasChords;
    const strip = byId("mixerStripPattern");
    if (strip) strip.classList.toggle("is-inactive", inactive);
    const select = byId("mixerGchordPatternSelect");
    if (select) select.disabled = inactive;
  }

  // Quality is a third non-channel control, next to Metronome: a real toggle
  // (songs/audio-player.js's synthParams reads ctx.state.highQualityAudio to
  // pick FatBoy vs the much richer/heavier MusyngKite soundfont) rather than
  // a per-channel Voice choice, so it lives here rather than in gm-voices.js.
  // No gate — switching soundfonts is always meaningful, tune or no chords.
  function updateQualityToggleVisual() {
    const btn = byId("mixerHighQualityToggleBtn");
    if (!btn) return;
    const enabled = ctx.state.highQualityAudio;
    btn.classList.toggle("is-active", enabled);
    btn.setAttribute("aria-pressed", enabled ? "true" : "false");
    const icon = btn.querySelector(".fa-solid");
    if (icon) {
      icon.classList.toggle("fa-toggle-on", enabled);
      icon.classList.toggle("fa-toggle-off", !enabled);
    }
    const label = `${enabled ? "Disable" : "Enable"} high quality audio`;
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  // Swing's own fader/readout, mirroring updateStripVisual's fill+readout
  // pair but without a channel's mute/gate concerns.
  function updateSwingVisual() {
    const percent = ctx.state.swing;
    const fill = byId("mixerSwingFill");
    if (fill) fill.style.width = `${percent}%`;
    const readout = byId("mixerSwingReadout");
    if (readout) readout.textContent = percent === 0 ? "Off" : `${percent}%`;
  }

  function refresh() {
    CHANNELS.forEach((channel) => {
      updateStripVisual(channel);
      updateGate(channel);
    });
    updatePatternGate();
    updateQualityToggleVisual();
    updateSwingVisual();
    voiceRows.forEach(updateVoiceRowVisual);
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
      select.value = String(resolveEffectiveProgram(program, DEFAULT_PROGRAM[channel]));
      select.addEventListener("change", () => {
        ctx.state.mixer[`${channel}Program`] = Number(select.value);
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

  function wirePattern() {
    const select = byId("mixerGchordPatternSelect");
    if (!select) return;
    buildGchordPatternOptions(select);
    select.value = ctx.state.gchordPattern;
    select.addEventListener("change", () => {
      ctx.state.gchordPattern = select.value;
      writePref(PREF_KEYS.mixerGchordPattern, select.value);
      ctx.sheet.rerender();
    });
  }

  // Same drag-to-adjust shape as a channel fader (scheduleApply while
  // dragging, applyNow on release) — reuses clampPercent since Swing shares
  // the same 0-100 domain as a volume fader.
  function wireSwing() {
    const range = byId("mixerSwingRange");
    if (!range) return;
    range.value = String(ctx.state.swing);
    range.addEventListener("input", () => {
      ctx.state.swing = clampPercent(range.value);
      updateSwingVisual();
      scheduleApply();
    });
    range.addEventListener("change", applyNow);
  }

  // A plain preference flip, applied at once like Pattern — full re-engrave
  // is the only way to hand the new soundFontUrl to a fresh SynthController
  // (see audio-player.js's initForTune), so there's nothing to debounce here.
  function wireQuality() {
    on("mixerHighQualityToggleBtn", "click", () => {
      ctx.state.highQualityAudio = !ctx.state.highQualityAudio;
      writePref(PREF_KEYS.highQualityAudio, ctx.state.highQualityAudio ? "1" : "0");
      updateQualityToggleVisual();
      ctx.sheet.rerender();
    });
  }

  function init() {
    CHANNELS.forEach(wireStrip);
    wirePattern();
    wireQuality();
    wireSwing();

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
    syncVoices,
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

// ctx.state.gchordPattern's initial value, seeded from the persisted pref —
// falls back to DEFAULT_GCHORD_PATTERN_VALUE both when nothing's stored yet
// and when a stored value no longer matches a GCHORD_PATTERNS entry (a
// pattern renamed/removed since it was saved).
export function loadGchordPatternState() {
  const stored = readPref(PREF_KEYS.mixerGchordPattern);
  const isValid = GCHORD_PATTERNS.some((p) => p.value === stored);
  return isValid ? stored : DEFAULT_GCHORD_PATTERN_VALUE;
}

// ctx.state.highQualityAudio's initial value, seeded from the persisted
// pref — off by default, same reasoning as DEFAULT_MUTED's Bass/Chords:
// nothing should suddenly start fetching ~5x-bigger soundfont files the
// first time this ships.
export function loadHighQualityAudioState() {
  return readPref(PREF_KEYS.highQualityAudio) === "1";
}

// ctx.state.swing's initial value, seeded from the persisted pref — off
// (straight eighths) by default, same reasoning as every other new control
// here: nothing should suddenly sound different the first time this ships.
export function loadSwingState() {
  const stored = readPref(PREF_KEYS.mixerSwing);
  const n = Number(stored);
  // clampPercent's own not-a-number fallback is 100 — right for a volume
  // fader's "missing means full volume" default, wrong here: a corrupted
  // rj.mixerSwing value should fall back to off, not maximum swing.
  return stored === null || !Number.isFinite(n) ? SWING_DEFAULT_PERCENT : clampPercent(n);
}
