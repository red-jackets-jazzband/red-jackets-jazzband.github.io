/*
  Declarative persistence for store slices (lib/core/store.js): a feature
  describes which of its slice keys are sticky, and how each maps onto a
  localStorage pref, as a schema of codecs —

    export const PLAYBACK_PREFS = {
      repeatCount: intPref(PREF_KEYS.repeatCount, { fallback: 1, min: 1, max: 20 }),
      metronomeEnabled: boolPref(PREF_KEYS.metronomeEnabled, false),
    };

  — and the composition root binds it once (bindPersisted): the stored values
  are loaded into the slice, and from then on every change to one of those
  keys is written back. So no module reads or writes these prefs by hand, and
  the full persisted contract is visible in the schemas.

  A codec is `{ load(read) -> value, save(value, write) }`; `read`/`write`
  are lib/core/preferences.js's readPref/writePref (injectable for tests).
  `load` must always return a valid value: a missing, corrupt or out-of-date
  pref falls back to the codec's default.
*/
import { readPref, writePref } from "./preferences.js";

export function boolPref(key, fallback) {
  return {
    load(read) {
      const raw = read(key);
      return raw === null ? fallback : raw === "1";
    },
    save(value, write) {
      write(key, value ? "1" : "0");
    },
  };
}

// An integer in [min, max]. A missing pref is `fallback`; a non-numeric one
// is `corrupt` (defaults to `fallback`). `invalid` decides what an
// out-of-range or fractional stored value becomes: "clamp" rounds it and
// pulls it to the nearest bound, "fallback" discards it.
export function intPref(key, {
  fallback, corrupt = fallback, min = -Infinity, max = Infinity, invalid = "clamp",
}) {
  return {
    load(read) {
      const raw = read(key);
      if (raw === null) return fallback;
      const n = Number(raw);
      if (!Number.isFinite(n)) return corrupt;
      const rounded = Math.round(n);
      if (rounded < min || rounded > max) {
        return invalid === "clamp" ? Math.max(min, Math.min(max, rounded)) : fallback;
      }
      if (invalid === "fallback" && rounded !== n) return fallback;
      return rounded;
    },
    save(value, write) {
      write(key, String(value));
    },
  };
}

// A number or null, stored as "" for null (a Voice picker left un-overridden).
export function nullableNumberPref(key) {
  return {
    load(read) {
      const raw = read(key);
      return raw === null || raw === "" ? null : Number(raw);
    },
    save(value, write) {
      write(key, value === null ? "" : String(value));
    },
  };
}

// One of a fixed set of string values; anything else (a renamed/removed
// option) falls back.
export function enumPref(key, values, fallback) {
  return {
    load(read) {
      const raw = read(key);
      return values.includes(raw) ? raw : fallback;
    },
    save(value, write) {
      write(key, String(value));
    },
  };
}

// Several codecs persisted together as one object-valued slice key (e.g. the
// Mixer's Bass/Chords channel settings), each field under its own pref.
export function objectPref(fields) {
  return {
    load(read) {
      const value = {};
      Object.keys(fields).forEach((field) => {
        value[field] = fields[field].load(read);
      });
      return value;
    },
    save(value, write) {
      Object.keys(fields).forEach((field) => fields[field].save(value[field], write));
    },
  };
}

export function loadPersisted(schema, read = readPref) {
  const values = {};
  Object.keys(schema).forEach((key) => {
    values[key] = schema[key].load(read);
  });
  return values;
}

// Load `schema`'s stored values into `slice`, then write back each persisted
// key whenever it changes. `load: false` skips the load (the slice keeps the
// values it already has — tests seed state this way). Returns the
// unsubscribe function.
export function bindPersisted(store, slice, schema, { read = readPref, write = writePref, load = true } = {}) {
  if (load) store.set(slice, loadPersisted(schema, read));
  return store.subscribe(slice, (state, keys) => {
    keys.forEach((key) => {
      // Object.hasOwn is Safari 15.4+; this code must run on Safari 12.
      if (Object.prototype.hasOwnProperty.call(schema, key)) schema[key].save(state[key], write); // NOSONAR
    });
  });
}
