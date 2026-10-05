/*
  The songs page's one source of truth for state: a handful of named slices
  (plain objects), each owned by one feature, with change notification.

    const store = createStore({ nav: { tab: "library" }, mixer: { swing: 52 } });
    store.get("nav").tab;                       // read
    store.set("nav", { tab: "setlists" });      // shallow merge + notify
    store.set("nav", { tab: "x" }, { source: "render" });  // tagged write
    const off = store.subscribe("nav", (slice, changed, name, meta) => { ... });
    store.batch(() => { store.set(...); store.set(...); });  // one notify per slice

  A slice's object is replaced, never mutated, on every `set`, so a
  subscriber can keep the previous reference to diff against. `set` only
  notifies when at least one key actually changed (===), and `changed` lists
  those keys, so a subscriber can ignore changes it doesn't care about.
  `meta` is an optional tag describing where a write came from — e.g.
  `{ source: "render" }` for state a render derives itself, which a
  "re-render on change" subscriber must not react to. Inside a batch, a
  slice's merged notification keeps the tag only if every write to it in
  that batch carried the same `source`.

  `store.state` is a flat view across every slice — `store.state.tab` reads
  nav.tab, `store.state.tab = "x"` is `store.set("nav", { tab: "x" })` — which
  is what `ctx.state` is. That's why every key must be unique across slices
  (createStore throws otherwise). Nested values (an array, the mixer's channel
  object) are replaced, not mutated in place: an in-place mutation notifies
  nobody.

  Notification is synchronous. A subscriber that sets another slice simply
  notifies that slice's subscribers in turn; inside `batch`, every
  notification waits until the outermost batch returns. A subscriber that
  throws doesn't stop the others: all of them run, then the first error is
  rethrown to whoever made the write.

  Pure and DOM-free (and Safari-12-safe: no Proxy is needed for the flat
  view, only Object.defineProperty).
*/

function changedKeys(prev, patch) {
  return Object.keys(patch).filter((key) => prev[key] !== patch[key]);
}

export function createStore(initialSlices) {
  const slices = {};
  const sliceOfKey = {};
  const listeners = {};
  const pending = new Map(); // slice -> { keys: Set, meta }, while batching
  let batchDepth = 0;

  Object.keys(initialSlices).forEach((name) => {
    slices[name] = { ...initialSlices[name] };
    listeners[name] = [];
    Object.keys(slices[name]).forEach((key) => {
      // Object.hasOwn is Safari 15.4+; this code must run on Safari 12.
      if (Object.prototype.hasOwnProperty.call(sliceOfKey, key)) { // NOSONAR
        throw new Error(`store: key "${key}" is in both "${sliceOfKey[key]}" and "${name}"`);
      }
      sliceOfKey[key] = name;
    });
  });

  function assertSlice(name) {
    // Object.hasOwn is Safari 15.4+ (see above).
    if (!Object.prototype.hasOwnProperty.call(slices, name)) { // NOSONAR
      throw new Error(`store: unknown slice "${name}"`);
    }
  }

  // Every listener runs even when an earlier one throws — one feature's
  // failure (say, a synth that can't start) mustn't stop the others from
  // following the change. The first error is rethrown afterwards, so it still
  // surfaces. Returns that error rather than throwing when `collect` is set.
  function notify(name, keys, meta, collect = false) {
    let firstError = null;
    // A copy: a listener that unsubscribes (or subscribes) mid-notify must not
    // shift the iteration under it.
    listeners[name].slice().forEach((fn) => {
      try {
        fn(slices[name], keys, meta);
      } catch (error) {
        if (firstError === null) firstError = error;
      }
    });
    if (collect) return firstError;
    if (firstError !== null) throw firstError;
    return null;
  }

  // Deliver every pending notification, even past a throwing listener, so
  // none is left behind to leak into a later, unrelated batch.
  function flush() {
    let firstError = null;
    while (pending.size > 0) {
      const [name, entry] = pending.entries().next().value;
      pending.delete(name);
      const error = notify(name, [...entry.keys], entry.meta, true);
      if (firstError === null) firstError = error;
    }
    if (firstError !== null) throw firstError;
  }

  function defer(name, keys, meta) {
    const entry = pending.get(name);
    if (!entry) {
      pending.set(name, { keys: new Set(keys), meta });
      return;
    }
    keys.forEach((key) => entry.keys.add(key));
    if (entry.meta.source !== meta.source) entry.meta = {};
  }

  function set(name, patch, meta = {}) {
    assertSlice(name);
    // Every key, not just the changed ones: an equal or undefined value for a
    // key that isn't this slice's would otherwise be merged in unnoticed.
    Object.keys(patch).forEach((key) => {
      if (sliceOfKey[key] !== name) throw new Error(`store: key "${key}" isn't part of slice "${name}"`);
    });
    const keys = changedKeys(slices[name], patch);
    if (keys.length === 0) return;
    slices[name] = { ...slices[name], ...patch };
    if (batchDepth > 0) {
      defer(name, keys, meta);
      return;
    }
    notify(name, keys, meta);
  }

  function batch(fn) {
    batchDepth += 1;
    try {
      return fn();
    } finally {
      batchDepth -= 1;
      if (batchDepth === 0) flush();
    }
  }

  // `names` is one slice name or an array of them; `fn(slice, changedKeys,
  // sliceName, meta)`. Returns an unsubscribe function.
  function subscribe(names, fn) {
    const list = Array.isArray(names) ? names : [names];
    const wrapped = list.map((name) => {
      assertSlice(name);
      const listener = (slice, keys, meta) => fn(slice, keys, name, meta);
      listeners[name].push(listener);
      return [name, listener];
    });
    return () => {
      wrapped.forEach(([name, listener]) => {
        const i = listeners[name].indexOf(listener);
        if (i !== -1) listeners[name].splice(i, 1);
      });
    };
  }

  const state = {};
  Object.keys(sliceOfKey).forEach((key) => {
    Object.defineProperty(state, key, {
      enumerable: true,
      get: () => slices[sliceOfKey[key]][key],
      set: (value) => {
        set(sliceOfKey[key], { [key]: value });
      },
    });
  });
  Object.seal(state);

  return {
    get(name) {
      assertSlice(name);
      return slices[name];
    },
    set,
    batch,
    subscribe,
    sliceOf: (key) => sliceOfKey[key],
    state,
  };
}
