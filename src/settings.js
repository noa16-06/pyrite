// Settings (⌘, / Ctrl+Alt+S): PyCharm's Settings dialog with the options Pyrite supports.
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api } from "./api.js";
import { keymap, label, doubleShiftLabel, isMac, tildify, normalizePath } from "./platform.js";
import { overlay, closeOverlay } from "./popups.js";

const DEFAULTS = {
  // Appearance & Behavior | Appearance
  theme: "dark", // "dark", "light" or "light-header"
  syncTheme: false,
  uiCustomFont: false,
  uiFont: "",
  uiFontSize: 13,
  // Appearance & Behavior | System Settings
  reopenLast: true,
  projectsDir: "", // empty: ~/PyriteProjects
  saveIdle: true,
  saveIdleSeconds: 1,
  saveOnDeactivation: true,
  // Editor | General
  lineNumbers: true,
  showWhitespace: false,
  softWrap: true,
  softWrapFiles: "*.md; *.txt; *.rst; *.adoc",
  // Editor | Font
  editorFont: "JetBrains Mono",
  editorFontSize: 13,
  lineHeight: 1.7,
  ligatures: false,
  // Editor | Code Style | Python
  useTabs: false,
  tabSize: 4,
  indent: 4,
};

const KEY = "pyrite.settings";

function load() {
  try {
    // `reopenLast` used to be stored on its own.
    const legacy = JSON.parse(localStorage.getItem("pyrite.reopenLast") ?? "null");
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { ...DEFAULTS, ...(legacy == null ? {} : { reopenLast: legacy }), ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

let current = load();
const listeners = new Set();

export const settings = () => current;
export const onSettingsChange = (fn) => listeners.add(fn);

export function saveSettings(next) {
  const prev = current;
  current = { ...current, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
  for (const fn of listeners) fn(current, prev);
}

/** "Soft-wrap these files:" uses PyCharm's "*.md; *.txt" pattern list. */
export function softWrapped(path) {
  if (!current.softWrap || !path) return false;
  const name = path.split("/").pop();
  return current.softWrapFiles
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .some((p) => new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i").test(name));
}

export const THEMES = { dark: "Dark", light: "Light", "light-header": "Light with Light Header" };
const osDark = window.matchMedia("(prefers-color-scheme: dark)");

/** The theme in use: the chosen one, or Dark/Light following the OS when "Sync with OS" is on. */
export function effectiveTheme() {
  if (current.syncTheme) return osDark.matches ? "dark" : "light";
  return THEMES[current.theme] ? current.theme : "dark";
}

/** Re-applies settings when the OS switches between light and dark (only matters with "Sync with OS"). */
osDark.addEventListener("change", () => current.syncTheme && saveSettings({}));

export function indentLabel() {
  return current.useTabs ? "Tab" : `${current.indent} spaces`;
}

/** Applies Appearance settings to the window. */
export function applyAppearance() {
  const root = document.documentElement;
  root.dataset.theme = effectiveTheme();
  if (current.uiCustomFont) {
    if (current.uiFont) root.style.setProperty("--ui-font", `"${current.uiFont}", -apple-system, "Segoe UI", sans-serif`);
    else root.style.removeProperty("--ui-font");
    document.body.style.fontSize = `${current.uiFontSize}px`;
  } else {
    root.style.removeProperty("--ui-font");
    document.body.style.fontSize = "";
  }
}

// ---------------------------------------------------------------- fonts
const MONO_FONTS = ["JetBrains Mono", "Menlo", "Monaco", "SF Mono", "Consolas", "Cascadia Code", "Cascadia Mono", "Fira Code", "Source Code Pro", "DejaVu Sans Mono", "Ubuntu Mono", "Liberation Mono", "Noto Sans Mono"];
const UI_FONTS = ["Inter", "SF Pro Text", "Helvetica Neue", "Segoe UI", "Ubuntu", "Cantarell", "Noto Sans", "DejaVu Sans", "Roboto"];

/** Fonts that are installed (or bundled), found by comparing text widths against the fallback font. */
function installed(fonts, fallback) {
  const ctx = document.createElement("canvas").getContext("2d");
  const sample = "mmmmmmmmmwwwwwlli10O";
  const width = (f) => ((ctx.font = `20px ${f}`), ctx.measureText(sample).width);
  const base = width(fallback);
  return fonts.filter((f) => f === "JetBrains Mono" || width(`"${f}", ${fallback}`) !== base);
}

// ---------------------------------------------------------------- keymap page
const ACTION_NAMES = {
  goToFile: "Go to File",
  recentFiles: "Recent Files",
  goToLine: "Go to Line/Column",
  newElement: "New…",
  saveAll: "Save All",
  reloadAll: "Reload All from Disk",
  settings: "Settings…",
  runFile: "Run Current File",
  rerun: "Rerun",
  stop: "Stop",
  debugFile: "Debug Current File",
  toggleBreakpoint: "Toggle Line Breakpoint",
  resume: "Resume Program",
  stepOver: "Step Over",
  stepInto: "Step Into",
  stepOut: "Step Out",
  evaluate: "Evaluate Expression",
  project: "Project Tool Window",
  runTool: "Run Tool Window",
  terminal: "Terminal Tool Window",
  closeTab: "Close Tab",
  nextTab: "Select Next Tab",
  prevTab: "Select Previous Tab",
  goToDeclaration: "Go to Declaration",
  findUsages: "Find Usages",
  rename: "Rename…",
  parameterInfo: "Parameter Info",
  reformat: "Reformat Code",
  optimizeImports: "Optimize Imports",
  nextProblem: "Next Highlighted Error",
  prevProblem: "Previous Highlighted Error",
};

// ---------------------------------------------------------------- dialog building blocks
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

function row(text, ...controls) {
  return el("div", { className: "form-row" }, el("label", { textContent: text }), el("div", { className: "form-controls" }, ...controls));
}

function checkbox(draft, key, text, onChange) {
  const input = el("input", { type: "checkbox", checked: !!draft[key] });
  input.addEventListener("change", () => ((draft[key] = input.checked), onChange?.()));
  return el("label", { className: "checkbox" }, input, document.createTextNode(text));
}

function number(draft, key, { min, max, step = 1, width = 64 }) {
  const input = el("input", { type: "number", value: draft[key], min, max, step });
  input.style.width = `${width}px`;
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v)) draft[key] = Math.min(max, Math.max(min, v));
  });
  return input;
}

function select(draft, key, options) {
  const s = el("select");
  for (const o of options) s.append(new Option(o, o));
  if (!options.includes(draft[key])) s.prepend(new Option(draft[key], draft[key]));
  s.value = draft[key];
  s.addEventListener("change", () => (draft[key] = s.value));
  return s;
}

const section = (text) => el("div", { className: "form-section", textContent: text });
const hint = (text) => el("div", { className: "form-hint", textContent: text });

// ---------------------------------------------------------------- pages
function pages(ctx) {
  const list = [
    {
      id: "appearance",
      group: "Appearance & Behavior",
      title: "Appearance",
      keywords: "ui font size custom theme dark light color sync os",
      render(draft) {
        const fontSel = el("select");
        fontSel.append(new Option("System default", ""), ...installed(UI_FONTS, "sans-serif").map((f) => new Option(f, f)));
        fontSel.value = draft.uiFont;
        fontSel.addEventListener("change", () => (draft.uiFont = fontSel.value));
        const size = number(draft, "uiFontSize", { min: 10, max: 18 });
        const sync = () => (fontSel.disabled = size.disabled = !draft.uiCustomFont);
        sync();
        const theme = el("select");
        for (const [id, name] of Object.entries(THEMES)) theme.append(new Option(name, id));
        theme.value = draft.theme;
        theme.addEventListener("change", () => (draft.theme = theme.value));
        const syncTheme = () => (theme.disabled = draft.syncTheme);
        syncTheme();
        return [
          row("Theme:", theme, checkbox(draft, "syncTheme", "Sync with OS", syncTheme)),
          row("", checkbox(draft, "uiCustomFont", "Use custom font:", sync), fontSel, el("span", { textContent: "Size:" }), size),
        ];
      },
    },
    {
      id: "system",
      group: "Appearance & Behavior",
      title: "System Settings",
      keywords: "reopen projects startup autosave save idle deactivation project directory location",
      render(draft) {
        const dir = el("input", { value: draft.projectsDir, placeholder: tildify(ctx.defaultProjectsDir || "~/PyriteProjects"), spellcheck: false });
        dir.addEventListener("input", () => (draft.projectsDir = dir.value.trim()));
        const browse = el("button", { className: "secondary small", textContent: "Browse…" });
        browse.addEventListener("click", async () => {
          const d = await openDialog({ directory: true, title: "Default Project Directory" });
          if (d) dir.value = draft.projectsDir = normalizePath(d);
        });
        const seconds = number(draft, "saveIdleSeconds", { min: 1, max: 300, width: 56 });
        return [
          section("Project"),
          row("", checkbox(draft, "reopenLast", "Reopen projects on startup")),
          row("Default project directory:", dir, browse),
          section("Autosave"),
          row("", checkbox(draft, "saveIdle", "Save files if the IDE is idle for"), seconds, el("span", { textContent: "sec" })),
          row("", checkbox(draft, "saveOnDeactivation", "Save files when switching to a different application or a built-in terminal")),
        ];
      },
    },
    {
      id: "keymap",
      title: "Keymap",
      keywords: "shortcuts keyboard keys " + Object.values(ACTION_NAMES).join(" "),
      render() {
        const filter = el("input", { type: "search", placeholder: "Search actions", spellcheck: false });
        const table = el("div", { className: "keymap-table" });
        const entries = Object.entries(ACTION_NAMES)
          .map(([id, name]) => [name, id === "settings" ? (isMac ? "⌘," : "Ctrl+Alt+S") : keymap[id] ? label(keymap[id]) : ""])
          .concat([["Go to File (Search Everywhere)", doubleShiftLabel]]);
        const render = () => {
          const q = filter.value.trim().toLowerCase();
          table.replaceChildren(
            ...entries
              .filter(([n, k]) => !q || n.toLowerCase().includes(q) || k.toLowerCase().includes(q))
              .map(([n, k]) => el("div", { className: "keymap-row" }, el("span", { textContent: n }), el("kbd", { textContent: k })))
          );
        };
        filter.addEventListener("input", render);
        render();
        return [
          row("Keymap:", select({ km: isMac ? "macOS" : "Windows / Linux" }, "km", [isMac ? "macOS" : "Windows / Linux"])),
          hint("PyCharm's default keymap for this OS. Custom shortcuts aren't supported yet."),
          filter,
          table,
        ];
      },
    },
    {
      id: "editor-general",
      group: "Editor",
      title: "General",
      keywords: "line numbers whitespaces soft wrap",
      render(draft) {
        const files = el("input", { value: draft.softWrapFiles, spellcheck: false });
        files.addEventListener("input", () => (draft.softWrapFiles = files.value));
        return [
          section("Appearance"),
          row("", checkbox(draft, "lineNumbers", "Show line numbers")),
          row("", checkbox(draft, "showWhitespace", "Show whitespaces")),
          section("Soft Wraps"),
          row("", checkbox(draft, "softWrap", "Soft-wrap these files:"), files),
        ];
      },
    },
    {
      id: "font",
      group: "Editor",
      title: "Font",
      keywords: "font size line height ligatures",
      render(draft) {
        const preview = el("pre", { className: "font-preview" });
        preview.textContent = `def fib(n: int) -> int:\n    """Returns the n-th Fibonacci number."""\n    return n if n < 2 else fib(n - 1) + fib(n - 2)  # != <= -> ==\n\nprint([fib(i) for i in range(10)])`;
        const update = () => {
          preview.style.fontFamily = `"${draft.editorFont}", "JetBrains Mono", monospace`;
          preview.style.fontSize = `${draft.editorFontSize}px`;
          preview.style.lineHeight = String(draft.lineHeight);
          preview.style.fontVariantLigatures = draft.ligatures ? "normal" : "none";
          preview.style.fontFeatureSettings = draft.ligatures ? "normal" : '"liga" 0, "calt" 0';
        };
        const controls = [
          row("Font:", select(draft, "editorFont", installed(MONO_FONTS, "monospace"))),
          row("Size:", number(draft, "editorFontSize", { min: 8, max: 32 })),
          row("Line height:", number(draft, "lineHeight", { min: 1, max: 3, step: 0.1 })),
          row("", checkbox(draft, "ligatures", "Enable ligatures", update)),
          preview,
        ];
        for (const c of controls) c.addEventListener?.("input", update);
        for (const c of controls) c.addEventListener?.("change", update);
        update();
        return controls;
      },
    },
    {
      id: "codestyle",
      group: "Editor",
      title: "Code Style › Python",
      keywords: "tab size indent tabs spaces code style",
      render(draft) {
        const tab = number(draft, "tabSize", { min: 1, max: 16 });
        const ind = number(draft, "indent", { min: 1, max: 16 });
        return [
          row("", checkbox(draft, "useTabs", "Use tab character")),
          row("Tab size:", tab),
          row("Indent:", ind),
          hint("Reformat Code (Ruff) uses the project's pyproject.toml / ruff.toml instead."),
        ];
      },
    },
  ];
  if (ctx.projectName) {
    list.push({
      id: "interpreter",
      group: `Project: ${ctx.projectName}`,
      title: "Python Interpreter",
      keywords: "python interpreter venv packages pip",
      render(draft) {
        const sel = el("select");
        const cur = ctx.interpreter;
        if (cur) sel.append(new Option(`Python ${cur.version}  ${tildify(cur.path)}`, cur.path));
        else sel.append(new Option("<No interpreter>", ""));
        sel.value = draft.interpreter ?? cur?.path ?? "";
        api.findPythons().then((list) => {
          for (const i of list) if (i.path !== cur?.path) sel.append(new Option(`Python ${i.version}  ${tildify(i.path)}`, i.path));
        });
        const add = el("button", { className: "link", textContent: "Add Interpreter…" });
        add.addEventListener("click", async () => {
          const file = await openDialog({ directory: false, title: "Select Python Interpreter" });
          if (!file) return;
          const path = normalizePath(file);
          sel.append(new Option(tildify(path), path));
          sel.value = path;
          sel.dispatchEvent(new Event("change"));
        });
        const table = el("div", { className: "packages" });
        const loadPackages = (path) => {
          table.replaceChildren(el("div", { className: "packages-status", textContent: path ? "Loading packages…" : "No interpreter" }));
          if (!path) return;
          api.listPackages(path).then(
            (pkgs) =>
              sel.value === path &&
              table.replaceChildren(
                el("div", { className: "packages-row head" }, el("span", { textContent: "Package" }), el("span", { textContent: "Version" })),
                ...pkgs.map((p) => el("div", { className: "packages-row" }, el("span", { textContent: p.name }), el("span", { textContent: p.version })))
              ),
            (err) => sel.value === path && table.replaceChildren(el("div", { className: "packages-status", textContent: String(err) }))
          );
        };
        sel.addEventListener("change", () => {
          draft.interpreter = sel.value;
          loadPackages(sel.value);
        });
        loadPackages(sel.value);
        return [row("Python Interpreter:", sel, add), table, hint("To install packages, use pip or uv in the Terminal for now.")];
      },
    });
  }
  return list;
}

/**
 * Opens the Settings dialog. `ctx` = { projectName, interpreter, defaultProjectsDir, setInterpreter(path) }.
 * Changes apply on Apply / OK, like PyCharm.
 */
export function openSettings(ctx = {}, pageId) {
  closeOverlay();
  const all = pages(ctx);
  let draft = { ...current, interpreter: undefined };
  let page = all.find((p) => p.id === pageId) ?? all[0];

  const box = el("div", { className: "modal dialog settings" });
  const search = el("input", { type: "search", placeholder: "Search settings", spellcheck: false, className: "settings-search" });
  const tree = el("nav", { className: "settings-tree" });
  const title = el("div", { className: "settings-crumb" });
  const content = el("div", { className: "dialog-content settings-content" });
  const footer = el("div", { className: "dialog-footer" });
  const cancel = el("button", { className: "secondary", textContent: "Cancel" });
  const apply = el("button", { className: "secondary", textContent: "Apply" });
  const ok = el("button", { className: "primary", textContent: "OK" });
  footer.append(el("span", { className: "dialog-error" }), cancel, apply, ok);
  box.append(
    el("div", { className: "dialog-title", textContent: "Settings" }),
    el("div", { className: "dialog-body" }, el("div", { className: "dialog-side settings-side" }, search, tree), el("div", { className: "settings-main" }, title, content)),
    footer
  );

  function renderTree() {
    const q = search.value.trim().toLowerCase();
    const match = (p) => !q || `${p.group ?? ""} ${p.title} ${p.keywords}`.toLowerCase().includes(q);
    tree.replaceChildren();
    let lastGroup = null;
    for (const p of all.filter(match)) {
      if (p.group && p.group !== lastGroup) tree.append(el("div", { className: "tree-group", textContent: p.group }));
      lastGroup = p.group ?? null;
      const item = el("div", { className: "side-item" + (p.group ? " nested" : "") + (p === page ? " selected" : ""), textContent: p.title });
      item.addEventListener("click", () => show(p));
      tree.append(item);
    }
    if (!tree.childElementCount) tree.append(el("div", { className: "tree-empty", textContent: "Nothing found" }));
  }

  function show(p) {
    page = p;
    title.textContent = p.group ? `${p.group} › ${p.title}` : p.title;
    content.replaceChildren(...p.render(draft));
    renderTree();
  }

  function commit() {
    const { interpreter, ...next } = draft;
    saveSettings(next);
    if (interpreter && interpreter !== ctx.interpreter?.path) ctx.setInterpreter?.(interpreter);
    draft = { ...current, interpreter: undefined };
  }
  const finish = () => {
    document.removeEventListener("keydown", onKey, true);
    closeOverlay();
  };
  function onKey(e) {
    if (e.key === "Escape") finish(), e.stopPropagation();
    else if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target !== search) commit(), finish(), e.preventDefault();
  }
  document.addEventListener("keydown", onKey, true);
  cancel.addEventListener("click", finish);
  apply.addEventListener("click", () => (commit(), show(page)));
  ok.addEventListener("click", () => (commit(), finish()));
  search.addEventListener("input", () => {
    renderTree();
    // Keep the page while it still matches; otherwise jump to the first match, like PyCharm.
    if (!tree.querySelector(".side-item.selected")) tree.querySelector(".side-item")?.click();
  });

  overlay.append(box);
  overlay.classList.add("open", "dim", "locked");
  show(page);
  search.focus();
}
