// OS differences: keymaps (PyCharm's macOS vs. Windows/Linux defaults) and path display.
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const isWindows = /Win/.test(navigator.platform || navigator.userAgent);

document.documentElement.dataset.os = isMac ? "mac" : isWindows ? "windows" : "linux";

// Shortcut specs are "Mod+Mod+Key"; Meta is ⌘ on macOS.
const KEYMAP = {
  mac: {
    saveAll: "Meta+S",
    settings: "Meta+,",
    newElement: "Meta+N",
    recentFiles: "Meta+E",
    reloadAll: "Meta+Alt+Y",
    runFile: "Ctrl+Shift+R",
    rerun: "Ctrl+R",
    stop: "Meta+F2",
    terminal: "Alt+F12",
    project: "Meta+1",
    runTool: "Meta+4",
    goToFile: "Meta+Shift+O",
    goToLine: "Meta+L",
    closeTab: "Meta+W",
    nextTab: "Meta+Shift+]",
    prevTab: "Meta+Shift+[",
    goToDeclaration: "Meta+B",
    findUsages: "Alt+F7",
    rename: "Shift+F6",
    parameterInfo: "Meta+P",
    reformat: "Meta+Alt+L",
    optimizeImports: "Ctrl+Alt+O",
    nextProblem: "F2",
    prevProblem: "Shift+F2",
    debugFile: "Ctrl+D",
    resume: "Meta+Alt+R",
    stepOver: "F8",
    stepInto: "F7",
    stepOut: "Shift+F8",
    toggleBreakpoint: "Meta+F8",
    evaluate: "Alt+F8",
  },
  other: {
    saveAll: "Ctrl+S",
    settings: "Ctrl+Alt+S",
    newElement: "Alt+Insert",
    recentFiles: "Ctrl+E",
    reloadAll: "Ctrl+Alt+Y",
    runFile: "Ctrl+Shift+F10",
    rerun: "Shift+F10",
    stop: "Ctrl+F2",
    terminal: "Alt+F12",
    project: "Alt+1",
    runTool: "Alt+4",
    goToFile: "Ctrl+Shift+N",
    goToLine: "Ctrl+G",
    closeTab: "Ctrl+F4",
    nextTab: "Alt+ArrowRight",
    prevTab: "Alt+ArrowLeft",
    goToDeclaration: "Ctrl+B",
    findUsages: "Alt+F7",
    rename: "Shift+F6",
    parameterInfo: "Ctrl+P",
    reformat: "Ctrl+Alt+L",
    optimizeImports: "Ctrl+Alt+O",
    nextProblem: "F2",
    prevProblem: "Shift+F2",
    debugFile: "Shift+F9",
    resume: "F9",
    stepOver: "F8",
    stepInto: "F7",
    stepOut: "Shift+F8",
    toggleBreakpoint: "Ctrl+F8",
    evaluate: "Alt+F8",
  },
};

/** PyCharm's default shortcut for each action on this OS. */
export const defaultKeymap = Object.freeze({ ...(isMac ? KEYMAP.mac : KEYMAP.other) });

// Settings | Keymap: action -> shortcuts the user changed (an empty list removes all of them).
let overrides = {};

/** Every shortcut of an action, custom ones replacing the defaults. */
export function shortcuts(action) {
  if (Object.hasOwn(overrides, action)) return overrides[action];
  return defaultKeymap[action] ? [defaultKeymap[action]] : [];
}

/** The first shortcut of each action, for labels and tooltips; updated by `setKeymapOverrides`. */
export const keymap = { ...defaultKeymap };

export function setKeymapOverrides(next = {}) {
  overrides = next;
  for (const action of new Set([...Object.keys(defaultKeymap), ...Object.keys(next)])) {
    const [first] = shortcuts(action);
    if (first) keymap[action] = first;
    else delete keymap[action];
  }
}

/** CodeMirror bindings that differ between PyCharm's keymaps. */
export const editorKeys = isMac
  ? { deleteLine: "Mod-Backspace", selectNextOccurrence: "Ctrl-g" }
  : { deleteLine: "Mod-y", selectNextOccurrence: "Alt-j" };

const CODES = {
  "[": "BracketLeft", "]": "BracketRight", ",": "Comma", ".": "Period", "/": "Slash", ";": "Semicolon",
  "'": "Quote", "-": "Minus", "=": "Equal", "`": "Backquote", "\\": "Backslash",
};
const KEYS_BY_CODE = Object.fromEntries(Object.entries(CODES).map(([k, c]) => [c, k]));

/** Physical-key code for a spec key, so ⌥/⇧ don't change what is matched (⌥1 types "¡" on macOS). */
function code(key) {
  if (/^[A-Z]$/.test(key)) return "Key" + key;
  if (/^[0-9]$/.test(key)) return "Digit" + key;
  return CODES[key];
}

/** True when the event matches any of the action's shortcuts. */
export const matchesAction = (e, action) => shortcuts(action).some((spec) => matches(e, spec));

/**
 * Turns a key press into a shortcut spec ("Meta+Shift+O"), or null for a lone modifier.
 * Letters, digits and punctuation use the physical key, so ⌥/⇧ don't change the spec.
 */
export function specFromEvent(e) {
  if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Unidentified"].includes(e.key)) return null;
  let key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (KEYS_BY_CODE[e.code]) key = KEYS_BY_CODE[e.code];
  else if (e.key === " ") key = "Space";
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta"].filter(Boolean);
  return [...mods, key].join("+");
}

const MOD_ORDER = ["Ctrl", "Alt", "Shift", "Meta"];
/** "Shift+Meta+o" and "Meta+Shift+O" are the same shortcut. */
export function sameShortcut(a, b) {
  const norm = (spec) => {
    const parts = spec.split("+");
    const key = parts.pop();
    return [...MOD_ORDER.filter((m) => parts.includes(m)), key.length === 1 ? key.toUpperCase() : key].join("+");
  };
  return norm(a) === norm(b);
}

export function matches(e, spec) {
  if (!spec) return false;
  const parts = spec.split("+");
  const key = parts.pop();
  const mods = new Set(parts);
  if (e.ctrlKey !== mods.has("Ctrl") || e.metaKey !== mods.has("Meta")) return false;
  if (e.altKey !== mods.has("Alt") || e.shiftKey !== mods.has("Shift")) return false;
  const c = code(key);
  if (key === "Space") return e.key === " ";
  return c ? e.code === c : e.key === key;
}

const GLYPHS = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" };
const KEY_LABELS = {
  ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  ...(isMac ? { Backspace: "⌫", Delete: "⌦", Enter: "↩", Escape: "⎋", Tab: "⇥", Space: "Space" } : {}),
};

/** "Meta+Shift+O" → "⇧⌘O" on macOS, "Ctrl+Shift+N" elsewhere. */
export function label(spec) {
  if (!spec) return "";
  const parts = spec.split("+");
  const key = KEY_LABELS[parts.at(-1)] ?? parts.at(-1);
  if (!isMac) return [...parts.slice(0, -1), key].join("+");
  const order = ["Ctrl", "Alt", "Shift", "Meta"];
  return order.filter((m) => parts.includes(m)).map((m) => GLYPHS[m]).join("") + key;
}

export const doubleShiftLabel = isMac ? "⇧⇧" : "Shift Shift";

/** Shortens the home folder to "~" for display (macOS, Linux and Windows layouts). */
export const tildify = (p) => p.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\/Users\/[^/]+)(?=\/|$)/, "~");

/** Forward slashes everywhere: the backend returns them, but dialogs and tracebacks use "\" on Windows. */
export const normalizePath = (p) =>
  isWindows ? p.replace(/\\/g, "/").replace(/^([a-z]):/, (_, d) => d.toUpperCase() + ":") : p;
