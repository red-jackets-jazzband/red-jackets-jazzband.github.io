// A tiny DOM toolkit for the songs-page orchestration modules: enough to stop
// every builder from hand-rolling `document.createElement` + a dozen property
// assignments, and every wiring site from repeating the `getElementById` +
// null-check dance. No framework, no vdom — thin sugar over the platform.

export const byId = (id) => document.getElementById(id);

export const qs = (selector, root = document) =>
  (root ? root.querySelector(selector) : null);

export const qsa = (selector, root = document) =>
  (root ? Array.from(root.querySelectorAll(selector)) : []);

// Empty a node; returns it for chaining. No-op on null.
export function clear(node) {
  if (node) node.replaceChildren();
  return node;
}

// Toggle [hidden]; returns the node. No-op on null.
export function setHidden(node, hidden) {
  if (node) node.hidden = Boolean(hidden);
  return node;
}

/*
  Guarded event binding. `target` is an element id or an element; returns the
  element (so callers can chain / detect a missing node), or null when the id
  resolved to nothing.
*/
export function on(target, event, handler, options) {
  const node = typeof target === "string" ? byId(target) : target;
  if (!node) return null;
  node.addEventListener(event, handler, options);
  return node;
}

function appendChildren(node, children) {
  if (children == null) return;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
}

// Named prop handlers for `el`; anything not listed is set as a direct
// property (id, type, href, disabled, ...).
const PROP_HANDLERS = {
  class: (node, value) => { node.className = value; },
  className: (node, value) => { node.className = value; },
  text: (node, value) => { node.textContent = value; },
  textContent: (node, value) => { node.textContent = value; },
  html: (node, value) => { node.innerHTML = value; },
  innerHTML: (node, value) => { node.innerHTML = value; },
  dataset: (node, value) => Object.assign(node.dataset, value),
  style: (node, value) => {
    for (const [prop, val] of Object.entries(value)) {
      // Custom properties (--x) only take through setProperty, not assignment.
      if (prop.startsWith("--")) node.style.setProperty(prop, val);
      else node.style[prop] = val;
    }
  },
  attrs: (node, value) => {
    for (const [name, val] of Object.entries(value)) {
      if (val != null) node.setAttribute(name, val);
    }
  },
  on: (node, value) => {
    for (const [event, handler] of Object.entries(value)) {
      node.addEventListener(event, handler);
    }
  },
};

/*
  Element factory. `props` keys: class/className, text/textContent,
  html/innerHTML (trusted markup only), dataset, style, attrs (setAttribute per
  entry, nullish skipped), on ({ event: handler } listeners); any other key is
  assigned as a direct DOM property. `children` is a node, a string, or an
  array of them; nullish / false entries are skipped.
*/
export function el(tag, props = {}, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    const handler = PROP_HANDLERS[key];
    if (handler) handler(node, value);
    else node[key] = value;
  }
  appendChildren(node, children);
  return node;
}

// Append nodes (nullish skipped) to an element or element id; returns the parent.
export function mount(parent, ...nodes) {
  const target = typeof parent === "string" ? byId(parent) : parent;
  if (target) {
    for (const node of nodes) {
      if (node != null) target.append(node);
    }
  }
  return target;
}

// Save a Blob to disk via a throwaway object-URL anchor — the shared trigger
// behind every "export as a file" button (setlist .txt export, the sheet's
// Export WAV).
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
