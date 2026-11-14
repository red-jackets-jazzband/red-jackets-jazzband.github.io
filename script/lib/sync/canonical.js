/*
   JSON with sorted keys, so two documents compare by content, not key order.
   Its own module (not engine.js) so band-store.js, band-vault.js and doc.js can use it
   without importing the engine, which imports them.
*/
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join()}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort((a, b) => { return a.localeCompare(b); }).map((key) => {
      return `${JSON.stringify(key)}:${canonical(value[key])}`;
    }).join()}}`;
  }
  return JSON.stringify(value);
}
