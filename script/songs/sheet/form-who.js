import { clear, el } from "../../lib/core/dom.js";
import { leadChoices } from "../../lib/music/song-form.js";

/*
  The song form editor's "Who plays" suggestions: a list of our own under the
  field, not a <datalist>. A datalist only offers what matches the text
  already in the field, so a duplicated round's "Trumpet solo" offered
  nothing else; this list offers every suggestion while the field holds one
  of them exactly (`leadChoices`). It opens on a click, on typing and on ↓;
  ↑ / ↓ walk it, Enter or a click picks, Escape closes it. It sits in the
  card's flow, below the field, since the editor clips anything that sticks
  out of it.
*/

let lists = 0;
const OPTION = "songForm-who-option";

// `onPick(name)` is called once a suggestion is picked into `input`.
export function withLeadSuggestions(input, getNames, onPick) {
  lists += 1;
  const id = `songFormWho-${lists}`;
  const list = el("ul", { class: "songForm-who-list", attrs: { id, role: "listbox" } });
  list.hidden = true;
  let shown = [];
  let at = -1;

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", id);
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("autocomplete", "off");

  function highlight(k) {
    at = k;
    Array.from(list.children).forEach((node, n) => {
      node.classList.toggle("is-active", n === k);
      node.setAttribute("aria-selected", String(n === k));
    });
    if (k < 0) input.removeAttribute("aria-activedescendant");
    else input.setAttribute("aria-activedescendant", `${id}-${k}`);
  }

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    highlight(-1);
  }

  function pick(k) {
    input.value = shown[k];
    close();
    onPick(input.value);
  }

  function open() {
    shown = leadChoices(input.value, getNames());
    clear(list);
    shown.forEach((name, k) => {
      list.append(el("li", {
        class: OPTION,
        text: name,
        attrs: { id: `${id}-${k}`, role: "option", "aria-selected": "false" },
        on: {
          // Keep the focus in the field, so it doesn't close before the click.
          mousedown: (e) => e.preventDefault(),
          click: () => pick(k),
        },
      }));
    });
    list.hidden = shown.length === 0;
    input.setAttribute("aria-expanded", String(!list.hidden));
    highlight(-1);
  }

  // ↓ goes to the next suggestion, ↑ the one before; with none highlighted
  // yet (or the list closed: it opens) ↓ starts at the first, ↑ at the last.
  function step(by) {
    if (list.hidden) open();
    if (shown.length === 0) return;
    if (at < 0) highlight(by > 0 ? 0 : shown.length - 1);
    else highlight((at + by + shown.length) % shown.length);
  }

  // True when the key was the list's; the field's own keys go on otherwise.
  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      step(e.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    if (list.hidden) return false;
    if (e.key === "Enter" && at >= 0) {
      e.preventDefault();
      pick(at);
      return true;
    }
    if (e.key === "Escape") {
      // Closes the list only, not the editor.
      e.preventDefault();
      e.stopPropagation();
      close();
      return true;
    }
    return false;
  }

  input.addEventListener("click", open);
  input.addEventListener("input", open);
  // A tap on a suggestion can blur the field first (touch): close a moment later.
  input.addEventListener("blur", () => setTimeout(close, 150));

  return { node: el("div", { class: "songForm-who" }, [input, list]), onKey };
}
