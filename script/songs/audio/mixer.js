import {
  byId, el, on, clear,
} from "../../lib/core/dom.js";
import { readPref, writePref } from "../../lib/core/preferences.js";
import { GM_VOICES, defaultVoiceProgram } from "../../lib/audio/gm-voices.js";
import { GCHORD_PATTERNS, DEFAULT_PROGRAM, isCompingLabel } from "../../lib/audio/audio-mix.js";
import { CHANNELS } from "./state.js";
import { RENDER } from "../core/state.js";

// A fader drag is committed to the store — and so re-engraved by the sheet,
// the only way to change what plays (see lib/audio/audio-mix.js) — only once
// it settles: too heavy to run on every "input" tick. A mute click or a
// slider release applies at once.
const APPLY_DEBOUNCE_MS = 220;
const REPOSITION_MARGIN = 8;

// Bass/Chords (ABCjs's auto-accompaniment) only play anything when the tune
// has chord symbols — read from ctx.state.hasChords, which sheet.js publishes
// on every live render. The tune's own voice channels aren't gated.
const GATE_STATE_KEY = { bass: "hasChords", chords: "hasChords" };

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
  render. Every row is the same shape and all three controls are real: Mute
  (audio-player.js's computeVoicesOff), Voice, and Volume (both read by
  sheet.js at render time via lib/audio-mix.js's injectMixerAudio — Voice as
  a per-voice %%MIDI program line, Volume as a per-voice %%MIDI beat line;
  see injectMixerAudio's and beatStressLine's own doc comments for why a
  fader wasn't possible until %%MIDI beat, not %%MIDI vol, turned out to
  scope a persistent level per voice). Persisted by a slug of the voice's own
  resolved name, not by song + numeric id, so e.g. every "Sousaphone" part
  across every song on this site — or every song's own "Comping" voice —
  shares one sticky Mute/Voice/Volume choice.

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
function voiceVolumeKey(slug) {
  return `rj.mixerVoice.${slug}.volume`;
}

// A stable signature for the current tune's resolved voice list — cheap to
// compare so syncVoices() below can skip rebuilding the panel's DOM on every
// rerender (a mute/Voice change, a Key/Tempo edit, ...) and only do it when
// the set of voices actually changed (a different song opened, or Comping
// toggled on/off — resolveMixerVoices appends/drops the extra entry).
function voiceListSignature(voices) {
  return voices.map((v) => `${v.id}|${v.label}|${v.fallbackProgram}`).join("|");
}

// Comping is always literally "Comping" (see resolveMixerVoices' own doc
// comment — never folded into the Melody-numbering scheme), so a plain label
// match is enough to give it its "fills" subtitle and the extra breathing
// room that sets it apart from the tune's own voices above it (split.css's
// .mixer-strip--comping).
const GENERATED_VOICE_SUBLABEL = { Comping: "fills", Solo: "improvised" };

function buildVoiceLabel(voice) {
  const nameSpan = el("span", { class: "mixer-strip-label", text: voice.label, attrs: { title: voice.label } });
  const sublabel = GENERATED_VOICE_SUBLABEL[isCompingLabel(voice.label) ? "Comping" : voice.label];
  if (sublabel === undefined) return nameSpan;
  return el("div", { class: "mixer-strip-label-wrap" }, [
    nameSpan,
    el("span", { class: "mixer-strip-sublabel", text: sublabel }),
  ]);
}

// One channel strip for one of the tune's resolved voices (lib/audio-mix.js's
// resolveMixerVoices — an ordinary tune's Melody, a chart's own named staves,
// or Comping), built with `el()` rather than static markup since the count
// and labels vary per song. Returns the strip plus the sub-elements
// rebuildVoiceStrips/updateVoiceRowVisual need. Element order (label, Voice,
// fader, readout, mute) matches the Bass/Chords/Swing strips in
// content/songs.md so the shared .mixer-strip grid (split.css) lines every
// row's columns up regardless of whether it's static markup or built here.
function buildVoiceStrip(voice) {
  const fill = el("div", { class: "mixer-fader-fill", style: { width: `${voice.volume}%` } });
  const range = el("input", {
    type: "range",
    min: "0",
    max: "100",
    value: String(voice.volume),
    attrs: { "aria-label": `${voice.label} volume` },
  });
  const readout = el("span", { class: "mixer-readout", text: `${voice.volume}%` });
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

  const stripClass = isCompingLabel(voice.label) ? "mixer-strip mixer-strip--voice mixer-strip--comping" : "mixer-strip mixer-strip--voice";
  const strip = el("div", {
    id: `mixerVoiceStrip-${voice.slug}`,
    class: stripClass,
  }, [
    buildVoiceLabel(voice),
    select,
    el("div", { class: "mixer-fader-track" }, [fill, range]),
    readout,
    muteBtn,
  ]);

  return {
    strip, fill, range, readout, muteBtn, muteIcon, select,
  };
}

// Only touches its own argument (v.slug/v.muted/v.program) and the module-
// level key builders — no ctx, so it belongs at module scope rather than
// nested inside createMixer.
function persistVoiceState(v) {
  writePref(voiceMutedKey(v.slug), v.muted ? "1" : "0");
  writePref(voiceProgramKey(v.slug), v.program === null ? "" : String(v.program));
  writePref(voiceVolumeKey(v.slug), String(v.volume));
}

// Same reasoning as persistVoiceState above: only reads its own destructured
// argument, no ctx or other createMixer-local state.
function updateVoiceRowVisual({
  v, strip, fill, readout, muteBtn, muteIcon,
}) {
  // .is-muted on the whole strip, not just the mute button — see
  // updateStripVisual's own comment (same reasoning, split.css greys the
  // fader for either kind of row the same way).
  // A voice silenced only because Solo took over (autoMuted) looks and acts
  // muted too, but isn't the listener's own persisted mute choice.
  const silent = v.muted || v.autoMuted;
  strip.classList.toggle("is-muted", silent);
  fill.style.width = `${v.volume}%`;
  readout.textContent = `${v.volume}%`;
  muteBtn.classList.toggle("is-muted", silent);
  muteBtn.setAttribute("aria-pressed", silent ? "true" : "false");
  muteIcon.classList.toggle("fa-volume-xmark", silent);
  muteIcon.classList.toggle("fa-volume-high", !silent);
  const label = `${silent ? "Unmute" : "Mute"} ${v.label}`;
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

  // Fader positions still being dragged, not yet committed to the store:
  // channel -> percent, "swing" -> percent, voice slug -> percent. A drag
  // only redraws its own strip (from the draft) while it moves; once it
  // settles (debounced) or is released, commitDrafts() writes every pending
  // draft to the store at once — so two faders dragged together (multi-touch
  // on the mobile bottom sheet) both land, and everything downstream of the
  // store (persistence, the re-engrave) runs once per gesture, not per tick.
  const drafts = new Map();

  const mixerState = () => ctx.state.mixer;
  const channelVolume = (channel) => (drafts.has(channel) ? drafts.get(channel) : mixerState()[`${channel}Volume`]);
  const swingValue = () => (drafts.has("swing") ? drafts.get("swing") : ctx.state.swing);
  const voiceWithDraft = (v) => (drafts.has(`voice:${v.slug}`) ? { ...v, volume: drafts.get(`voice:${v.slug}`) } : v);

  function setChannel(patch, meta) {
    ctx.store.set("mixer", { mixer: { ...mixerState(), ...patch } }, meta);
  }

  // Replace one voice's entry (by slug) in ctx.state.mixerVoices; voice
  // channels persist per voice name (dynamic keys, so outside the slice's
  // own pref schema) and are written here.
  function setVoice(slug, patch, meta) {
    const voices = ctx.state.mixerVoices.map((v) => (v.slug === slug ? { ...v, ...patch } : v));
    ctx.store.set("mixer", { mixerVoices: voices }, meta);
    const updated = voices.find((v) => v.slug === slug);
    if (updated) persistVoiceState(updated);
  }

  // `meta` tags the writes — RENDER when flushed from inside a render
  // (syncVoices), so they don't trigger a second one.
  function commitDrafts(meta) {
    if (drafts.size === 0) return;
    const pending = new Map(drafts);
    drafts.clear();
    ctx.store.batch(() => {
      const channelPatch = {};
      CHANNELS.forEach((channel) => {
        if (pending.has(channel)) channelPatch[`${channel}Volume`] = pending.get(channel);
      });
      if (Object.keys(channelPatch).length > 0) setChannel(channelPatch, meta);
      if (pending.has("swing")) ctx.store.set("mixer", { swing: pending.get("swing") }, meta);
      ctx.state.mixerVoices.forEach((v) => {
        const key = `voice:${v.slug}`;
        if (pending.has(key)) setVoice(v.slug, { volume: pending.get(key) }, meta);
      });
    });
  }

  function applyNow() {
    clearTimeout(applyTimer);
    applyTimer = null;
    commitDrafts();
  }

  function scheduleApply() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(applyNow, APPLY_DEBOUNCE_MS);
  }

  // { slug, strip, fill, readout, muteBtn, muteIcon, select } per row in
  // #mixerVoicesList, in the same order as ctx.state.mixerVoices. Rows look
  // their voice up by slug at event time: the store replaces voice objects
  // on every change, so a captured one would go stale.
  let voiceRows = [];
  let voiceListSig = "";
  // The listener brought the lead back while Solo plays. Kept here (not on the
  // voice object) so it survives voice-list changes such as toggling Comping;
  // cleared when Solo turns off or the tune's own voices change.
  let leadUnmuted = false;
  let ownVoicesSig = "";

  const voiceBySlug = (slug) => ctx.state.mixerVoices.find((v) => v.slug === slug);

  function drawVoiceRow(row) {
    const v = voiceBySlug(row.slug);
    if (v) updateVoiceRowVisual({ ...row, v: voiceWithDraft(v) });
  }

  function rebuildVoiceStrips() {
    const container = byId("mixerVoicesList");
    if (!container) return;
    clear(container);
    voiceRows = ctx.state.mixerVoices.map((v) => {
      const row = { slug: v.slug, ...buildVoiceStrip(v) };
      container.append(row.strip);
      row.select.value = String(resolveEffectiveProgram(v.program, defaultVoiceProgram(v)));
      row.select.addEventListener("change", () => {
        setVoice(v.slug, { program: Number(row.select.value) });
      });
      row.range.addEventListener("input", () => {
        drafts.set(`voice:${v.slug}`, clampPercent(row.range.value));
        drawVoiceRow(row);
        scheduleApply();
      });
      row.range.addEventListener("change", applyNow);
      on(row.muteBtn, "click", () => {
        const current = voiceBySlug(v.slug);
        if (!current) return;
        // Un-muting a lead that Solo silenced is a one-off override (this
        // song, until Solo changes); the persisted mute choice stays as it was.
        if (current.autoMuted) {
          leadUnmuted = true;
          setVoice(v.slug, { autoMuted: false });
        } else {
          setVoice(v.slug, { muted: !current.muted });
        }
        drawVoiceRow(row);
      });
      // A voice can start pre-muted (a persisted rj.mixerVoice.<slug>.muted
      // pref from an earlier song) — reflect that on the freshly built row
      // immediately, rather than leaving it looking unmuted until the next
      // refresh() call happens to run.
      drawVoiceRow(row);
      return row;
    });
  }

  // Called by sheet.js on every live render with the tune's fully resolved
  // voice list (lib/audio-mix.js's resolveMixerVoices — always at least one
  // entry: an ordinary tune's own implicit Melody, a chart's own named
  // voices, plus Comping appended when it's on) — this materialises it into
  // ctx.state.mixerVoices with each voice's persisted Mute/Voice/Volume, as
  // an input to the very render that called it. Skips the rebuild when the
  // voice set is unchanged from last time (a mute/Voice/Key/Tempo change
  // re-renders the same song repeatedly) so a mute click doesn't wipe out
  // its own strip's mid-interaction focus.
  function syncVoices(voices) {
    const sig = voiceListSignature(voices);
    if (sig === voiceListSig) return;
    voiceListSig = sig;
    // A fader still mid-debounce has its value only in `drafts`: commit it
    // against the voice list it belongs to before that list is replaced (a
    // different song opened, or Comping toggled, mid-drag). Tagged RENDER:
    // this already runs inside sheet.js's own render, which picks them up.
    if (applyTimer !== null) {
      clearTimeout(applyTimer);
      applyTimer = null;
      commitDrafts(RENDER);
    }
    const withSlugs = dedupeVoiceSlugs(voices);
    // While Solo plays, the first voice (typically the lead) steps aside.
    const soloOn = voices.some((v) => v.label === "Solo");
    const ownSig = voiceListSignature(voices.filter((v) => v.label !== "Solo" && !isCompingLabel(v.label)));
    if (!soloOn || ownSig !== ownVoicesSig) leadUnmuted = false;
    ownVoicesSig = ownSig;
    ctx.store.set("mixer", {
      mixerVoices: withSlugs.map((v) => {
        const muted = readPref(voiceMutedKey(v.slug)) === "1";
        const storedProgram = readPref(voiceProgramKey(v.slug));
        const program = storedProgram === null || storedProgram === "" ? null : Number(storedProgram);
        const storedVolume = readPref(voiceVolumeKey(v.slug));
        const volume = storedVolume === null ? 100 : clampPercent(storedVolume);
        return {
          ...v, muted, program, volume, autoMuted: soloOn && v.index === 0 && !leadUnmuted,
        };
      }),
    }, RENDER);
    rebuildVoiceStrips();
  }

  function updateStripVisual(channel) {
    const percent = channelVolume(channel);
    const muted = mixerState()[`${channel}Muted`];
    const ids = elementIds(channel);

    // .is-muted on the whole strip (not just the mute button) so the fader
    // itself can grey out too (split.css) — a muted fader still shows its
    // last level, but shouldn't read as "live" the way an unmuted one does.
    const strip = byId(ids.strip);
    if (strip) strip.classList.toggle("is-muted", muted);

    const fill = byId(ids.fill);
    if (fill) fill.style.width = `${percent}%`;

    const readout = byId(ids.readout);
    if (readout) readout.textContent = `${percent}%`;

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

  // updateGate/updatePatternGate above already hide Bass/Chords/Pattern
  // individually, but a chordless tune (e.g. a funk groove with no chord
  // symbols at all) would otherwise leave the "Auto-accompaniment" section
  // title sitting over an empty group with nothing under it — hide the whole
  // section, title included, the same way.
  function updateAccompanimentSectionGate() {
    const section = byId("mixerSectionAccompaniment");
    if (section) section.classList.toggle("is-inactive", !ctx.state.hasChords);
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
    const label = `${enabled ? "Disable" : "Enable"} high quality audio`;
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }

  // Swing's own fader/readout, mirroring updateStripVisual's fill+readout
  // pair but without a channel's mute/gate concerns.
  function updateSwingVisual() {
    const percent = swingValue();
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
    updateAccompanimentSectionGate();
    updateQualityToggleVisual();
    updateSwingVisual();
    voiceRows.forEach(drawVoiceRow);
  }

  function wireStrip(channel) {
    const ids = elementIds(channel);
    const range = byId(ids.range);
    if (range) {
      range.value = String(mixerState()[`${channel}Volume`]);
      range.addEventListener("input", () => {
        drafts.set(channel, clampPercent(range.value));
        updateStripVisual(channel);
        scheduleApply();
      });
      range.addEventListener("change", applyNow);
    }
    on(ids.muteBtn, "click", () => {
      const key = `${channel}Muted`;
      setChannel({ [key]: !mixerState()[key] });
      updateStripVisual(channel);
      applyNow();
    });

    const select = byId(ids.voiceSelect);
    if (select) {
      buildVoiceOptions(select);
      const program = mixerState()[`${channel}Program`];
      select.value = String(resolveEffectiveProgram(program, DEFAULT_PROGRAM[channel]));
      select.addEventListener("change", () => {
        setChannel({ [`${channel}Program`]: Number(select.value) });
        applyNow();
      });
    }
  }

  function setOpen(next) {
    open = next;
    const panel = byId("mixerPanel");
    const backdrop = byId("mixerBackdrop");
    const btn = byId("mixerBtn");
    // #mixerPanel is a <dialog>, but <dialog> itself is Safari 15.4+ — on
    // Safari 12 it's an unrecognised element with no HTMLDialogElement
    // interface at all, so `panel.open = open` would just set a plain JS
    // expando property with no effect on the real `open` attribute, and
    // there'd be no UA-stylesheet dialog:not([open]) rule to hide it either
    // — the panel would sit permanently visible in the page from load, with
    // this button's clicks changing nothing on screen (the exact "Mixer
    // stays, button has no effect" symptom this replaced). Setting the
    // content attribute directly works on every browser regardless of
    // <dialog> support, and split.css's own .mixer-panel:not([open]) rule
    // (rather than the native UA default) is what actually hides it.
    if (panel) {
      if (open) panel.setAttribute("open", "");
      else panel.removeAttribute("open");
    }
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
    if (panel && panel.contains(e.target)) return;
    if (btn && btn.contains(e.target)) return;
    setOpen(false);
  }

  function wirePattern() {
    const select = byId("mixerGchordPatternSelect");
    if (!select) return;
    buildGchordPatternOptions(select);
    select.value = ctx.state.gchordPattern;
    select.addEventListener("change", () => {
      ctx.state.gchordPattern = select.value;
    });
  }

  // Same drag-to-adjust shape as a channel fader (a draft while dragging,
  // committed on settle/release) — reuses clampPercent since Swing shares
  // the same 0-100 domain as a volume fader.
  function wireSwing() {
    const range = byId("mixerSwingRange");
    if (!range) return;
    range.value = String(ctx.state.swing);
    range.addEventListener("input", () => {
      drafts.set("swing", clampPercent(range.value));
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
      updateQualityToggleVisual();
    });
  }

  function init() {
    CHANNELS.forEach(wireStrip);
    wirePattern();
    wireQuality();
    wireSwing();

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

  // The gates (hasChords) and the voice rows follow the live sheet.
  ctx.store.subscribe("tune", refresh);

  return {
    init,
    refresh,
    syncVoices,
    setOpen,
    isOpen: () => open,
    toggle() {
      setOpen(!open);
    },
  };
}
