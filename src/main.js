import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";
import { open as openDialog, ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, basename, dirname, join } from "./api.js";
import { keymap, matches, label, doubleShiftLabel, tildify, normalizePath } from "./platform.js";
import { icons, logo } from "./icons.js";
import { EditorArea } from "./editor.js";
import { ProjectTree } from "./tree.js";
import { RunPanel } from "./run.js";
import { TerminalPanel } from "./terminal.js";

const $ = (sel) => document.querySelector(sel);
const appWindow = getCurrentWindow();

// ---------------------------------------------------------------- storage
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem("pyrite." + key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("pyrite." + key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

const state = {
  root: null,
  interpreter: null, // { path, version, venv }
  running: false,
  layout: store.get("layout", { left: 280, bottom: 280, project: true, bottomView: null }),
};

// ---------------------------------------------------------------- icons
for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = icons[el.dataset.icon];
$("#btn-run").innerHTML = icons.run;
$("#btn-stop").innerHTML = icons.stop;
$("#btn-search").innerHTML = icons.search;
$('.stripe-btn[data-panel="project"]').innerHTML = icons.project;
$('.stripe-btn[data-panel="run"]').innerHTML = icons.runTool;
$('.stripe-btn[data-panel="terminal"]').innerHTML = icons.terminal;
$("#tree-new-file").innerHTML = icons.newFile;
$("#tree-new-dir").innerHTML = icons.newDir;
$("#tree-refresh").innerHTML = icons.refresh;
$("#tree-collapse").innerHTML = icons.collapse;
$("#bottom-hide").innerHTML = icons.minimize;
$("#welcome-logo").innerHTML = logo(56);
for (const el of document.querySelectorAll("[data-key]")) {
  const text = el.dataset.key === "doubleShift" ? doubleShiftLabel : label(keymap[el.dataset.key]);
  if (el.tagName === "KBD") el.textContent = text;
  else el.title += `  ${text}`;
}
$("#btn-search").title += ` / ${doubleShiftLabel}`;

// ---------------------------------------------------------------- components
const editor = new EditorArea({
  editorEl: $("#editor"),
  tabsEl: $("#tabs"),
  emptyEl: $("#editor-empty"),
  onActiveChange(path) {
    $("#sb-path").textContent = path && state.root ? path.replace(state.root, basename(state.root)).split("/").join(" › ") : "";
    $("#run-target-name").textContent = path && /\.py$/.test(path) ? basename(path) : "Current File";
    if (path) tree.select(path);
    saveSession();
  },
  onCursor(pos) {
    $("#sb-pos").textContent = pos ? `${pos.line}:${pos.col}` : "";
  },
});

const tree = new ProjectTree($("#tree"), {
  onOpen: (path) => openFile(path),
  onContextMenu: ({ x, y, path, isDir }) => {
    const dir = isDir ? path : dirname(path);
    const items = [
      { label: "New Python File", icon: icons.python, action: () => newFile(dir) },
      { label: "New File", icon: icons.text, action: () => newFile(dir, false) },
      { label: "New Directory", icon: icons.folder, action: () => newDir(dir) },
      "-",
    ];
    if (!isDir && /\.py$/.test(path)) items.push({ label: `Run '${basename(path)}'`, icon: icons.run, action: () => runFile(path) }, "-");
    if (isDir) items.push({ label: "Open in Terminal", icon: icons.terminal, action: () => openTerminalAt(path) });
    if (path !== state.root) {
      items.push({ label: "Rename…", action: () => renamePath(path) });
      items.push({ label: "Delete", action: () => deletePath(path) });
    }
    items.push("-", { label: "Reload from Disk", icon: icons.refresh, action: () => tree.refresh() });
    contextMenu(x, y, items);
  },
});

const runPanel = new RunPanel($("#run-view"), {
  onOpenLocation: (file, line) => openFile(normalizePath(file), line),
  onStateChange(running) {
    state.running = running;
    $("#btn-stop").disabled = !running;
    $("#run-widget").classList.toggle("running", running);
  },
});

let terminalCwd = null;
const terminals = new TerminalPanel($("#terminal-view"), {
  getContext: () => ({ cwd: terminalCwd ?? state.root ?? "/", venv: state.interpreter?.venv }),
});

// ---------------------------------------------------------------- layout
function applyLayout() {
  const { left, bottom, project, bottomView } = state.layout;
  $("#project-panel").style.width = `${left}px`;
  $("#project-panel").style.display = project ? "" : "none";
  $("#split-left").style.display = project ? "" : "none";
  $("#bottom-panel").style.height = `${bottom}px`;
  $("#bottom-panel").style.display = bottomView ? "" : "none";
  $("#split-bottom").style.display = bottomView ? "" : "none";
  for (const v of ["run", "terminal"]) {
    $(`#${v}-view`).style.display = bottomView === v ? "" : "none";
    $(`.tool-tab[data-view="${v}"]`).classList.toggle("active", bottomView === v);
  }
  for (const b of document.querySelectorAll(".stripe-btn")) {
    const p = b.dataset.panel;
    b.classList.toggle("active", p === "project" ? project : bottomView === p);
  }
  store.set("layout", state.layout);
  if (bottomView === "terminal" && state.root) terminals.ensure();
}

function toggleProject() {
  state.layout.project = !state.layout.project;
  applyLayout();
}

function showBottom(view, toggle = true) {
  state.layout.bottomView = toggle && state.layout.bottomView === view ? null : view;
  applyLayout();
  if (!state.layout.bottomView) editor.view.focus();
}

for (const b of document.querySelectorAll(".stripe-btn")) {
  b.addEventListener("click", () => (b.dataset.panel === "project" ? toggleProject() : showBottom(b.dataset.panel)));
}
for (const t of document.querySelectorAll(".tool-tab")) t.addEventListener("click", () => showBottom(t.dataset.view, false));
$("#bottom-hide").addEventListener("click", () => showBottom(null, false));

function splitter(el, onDrag) {
  el.addEventListener("mousedown", (e) => {
    e.preventDefault();
    document.body.classList.add(el.classList.contains("vertical") ? "resizing-x" : "resizing-y");
    const move = (ev) => onDrag(ev);
    const up = () => {
      document.body.classList.remove("resizing-x", "resizing-y");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      store.set("layout", state.layout);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });
}
splitter($("#split-left"), (e) => {
  const x = e.clientX - $("#project-panel").getBoundingClientRect().left;
  state.layout.left = Math.max(160, Math.min(x, window.innerWidth - 300));
  $("#project-panel").style.width = `${state.layout.left}px`;
});
splitter($("#split-bottom"), (e) => {
  const h = $("#workspace").getBoundingClientRect().bottom - e.clientY;
  state.layout.bottom = Math.max(100, Math.min(h, window.innerHeight - 200));
  $("#bottom-panel").style.height = `${state.layout.bottom}px`;
});

// ---------------------------------------------------------------- projects
function recentProjects() {
  return store.get("recent", []).filter((p) => typeof p === "string");
}

function renderWelcome() {
  const list = $("#recent-list");
  const recents = recentProjects();
  list.replaceChildren(
    ...recents.map((path) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="proj-badge"></span><div class="recent-text"><div class="recent-name"></div><div class="recent-path"></div></div><button class="icon-btn remove" title="Remove from list">${icons.close}</button>`;
      li.querySelector(".proj-badge").textContent = badge(basename(path));
      li.querySelector(".recent-name").textContent = basename(path);
      li.querySelector(".recent-path").textContent = tildify(path);
      li.addEventListener("click", (e) => {
        if (e.target.closest(".remove")) {
          store.set("recent", recentProjects().filter((p) => p !== path));
          renderWelcome();
        } else openProject(path);
      });
      return li;
    })
  );
  if (!recents.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No recent projects yet — open a folder to get started.";
    list.append(li);
  }
}

function badge(name) {
  const parts = name.split(/[-_ .]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "P") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}

async function chooseProject() {
  const dir = await openDialog({ directory: true, multiple: false, title: "Open Project Folder" });
  if (dir) await openProject(normalizePath(dir));
}

async function openProject(root) {
  if (state.root) await closeProject(false);
  state.root = root;
  store.set("recent", [root, ...recentProjects().filter((p) => p !== root)].slice(0, 12));

  $("#welcome").style.display = "none";
  $("#app").classList.remove("no-project");
  $("#project-name").textContent = basename(root);
  $("#project-badge").textContent = badge(basename(root));
  appWindow.setTitle(`${basename(root)} — Pyrite`).catch(() => {});

  await tree.load(root);
  const session = store.get("project." + root, {});
  loadInterpreter(session.interpreter);
  for (const f of session.tabs ?? []) await editor.open(f).catch(() => {});
  if (session.active && editor.has(session.active)) editor.activate(session.active);
  applyLayout();
}

async function closeProject(showWelcome = true) {
  await editor.closeAll();
  await runPanel.stop();
  runPanel.clear();
  terminals.closeAll();
  state.root = null;
  state.interpreter = null;
  tree.load(null);
  if (showWelcome) {
    renderWelcome();
    $("#welcome").style.display = "";
    $("#app").classList.add("no-project");
    $("#project-name").textContent = "Pyrite";
    $("#project-badge").textContent = "PY";
    $("#sb-interp").textContent = "No interpreter";
    $("#sb-path").textContent = "";
    appWindow.setTitle("Pyrite").catch(() => {});
  }
}

function saveSession() {
  if (!state.root) return;
  store.set("project." + state.root, {
    ...store.get("project." + state.root, {}),
    tabs: editor.order,
    active: editor.active,
  });
}

$("#welcome-open").addEventListener("click", chooseProject);
$("#project-switcher").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const items = [{ label: "Open…", icon: icons.folder, action: chooseProject }];
  const recents = recentProjects().filter((p) => p !== state.root).slice(0, 8);
  if (recents.length) {
    items.push("-", { header: "Recent Projects" });
    for (const p of recents) items.push({ label: basename(p), hint: tildify(p), action: () => openProject(p) });
  }
  if (state.root) items.push("-", { label: "Close Project", action: () => closeProject() });
  contextMenu(r.left, r.bottom + 4, items);
});

// ---------------------------------------------------------------- interpreter
async function loadInterpreter(saved) {
  $("#sb-interp").textContent = "Detecting interpreter…";
  try {
    state.interpreter = saved ? await api.interpreterInfo(saved) : await api.detectInterpreter(state.root);
  } catch {
    state.interpreter = await api.detectInterpreter(state.root).catch(() => null);
  }
  renderInterpreter();
}

function renderInterpreter() {
  const i = state.interpreter;
  const el = $("#sb-interp");
  if (!i) {
    el.textContent = "No interpreter";
    el.classList.add("warn");
    return;
  }
  el.classList.remove("warn");
  el.textContent = `Python ${i.version}` + (i.venv ? ` (${basename(i.venv)})` : "");
  el.title = i.path;
}

async function setInterpreter(path) {
  try {
    state.interpreter = await api.interpreterInfo(path);
    store.set("project." + state.root, { ...store.get("project." + state.root, {}), interpreter: path });
    renderInterpreter();
  } catch (err) {
    toast(String(err), "error");
  }
}

$("#sb-interp").addEventListener("click", (e) => {
  if (!state.root) return;
  const r = e.currentTarget.getBoundingClientRect();
  contextMenu(r.right - 280, r.top - 4, [
    { header: "Python Interpreter" },
    ...(state.interpreter ? [{ label: `Python ${state.interpreter.version}`, hint: state.interpreter.path, checked: true }] : []),
    "-",
    {
      label: "Select Virtualenv Folder…",
      icon: icons.folderExcluded,
      action: async () => {
        // Choosing the folder (not bin/python) avoids the dialog resolving the venv symlink.
        const dir = await openDialog({ directory: true, defaultPath: state.root, title: "Select a virtual environment folder" });
        if (dir) setInterpreter(normalizePath(dir)); // the backend finds bin/python or Scripts\\python.exe
      },
    },
    {
      label: "Select Python Executable…",
      icon: icons.python,
      action: async () => {
        const file = await openDialog({ directory: false, title: "Select a Python executable" });
        if (file) setInterpreter(normalizePath(file));
      },
    },
    {
      label: "Auto-detect",
      icon: icons.refresh,
      action: async () => {
        const s = store.get("project." + state.root, {});
        delete s.interpreter;
        store.set("project." + state.root, s);
        loadInterpreter(null);
      },
    },
  ], { anchorBottom: true });
});

// ---------------------------------------------------------------- files
async function openFile(path, line) {
  try {
    await editor.open(path, line);
  } catch (err) {
    toast(String(err), "error");
  }
}

async function newFile(dir, pythonFile = true) {
  let name = await promptModal({
    title: pythonFile ? "New Python File" : "New File",
    placeholder: pythonFile ? "Name (e.g. utils or pkg/module)" : "Name with extension",
  });
  if (!name) return;
  if (pythonFile && !/\.\w+$/.test(name)) name += ".py";
  const path = join(dir, name);
  try {
    await api.createFile(path);
    tree.expand(dir);
    for (let d = dirname(path); d.startsWith(state.root) && d !== state.root; d = dirname(d)) tree.expand(d);
    await tree.refresh();
    await openFile(path);
  } catch (err) {
    toast(String(err), "error");
  }
}

async function newDir(dir) {
  const name = await promptModal({ title: "New Directory", placeholder: "Name (e.g. src/app)" });
  if (!name) return;
  try {
    await api.createDir(join(dir, name));
    tree.expand(dir);
    await tree.refresh();
  } catch (err) {
    toast(String(err), "error");
  }
}

async function renamePath(path) {
  const old = basename(path);
  const name = await promptModal({ title: `Rename '${old}'`, value: old, selectStem: true });
  if (!name || name === old) return;
  const to = join(dirname(path), name);
  try {
    await editor.saveAll();
    await api.renamePath(path, to);
    editor.renamed(path, to);
    await tree.refresh();
    tree.select(to);
  } catch (err) {
    toast(String(err), "error");
  }
}

async function deletePath(path) {
  const ok = await ask(`Move '${basename(path)}' to the Trash?`, { title: "Delete", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" });
  if (!ok) return;
  try {
    await api.deletePath(path);
    editor.deleted(path);
    await tree.refresh();
  } catch (err) {
    toast(String(err), "error");
  }
}

$("#tree-new-file").addEventListener("click", () => state.root && newFile(tree.targetDir()));
$("#tree-new-dir").addEventListener("click", () => state.root && newDir(tree.targetDir()));
$("#tree-refresh").addEventListener("click", () => tree.refresh());
$("#tree-collapse").addEventListener("click", () => tree.collapseAll());

// ---------------------------------------------------------------- run
async function runFile(file) {
  if (!state.root) return;
  if (!file || !/\.py$/.test(file)) {
    toast("Open a Python file to run it.", "info");
    return;
  }
  if (!state.interpreter) {
    toast("No Python interpreter configured — click the interpreter in the status bar.", "error");
    return;
  }
  await editor.saveAll(); // PyCharm saves everything before running
  showBottom("run", false);
  runPanel.run({ interpreter: state.interpreter.path, file, cwd: dirname(file) });
}

function runCurrent() {
  runFile(editor.active);
}

$("#btn-run").addEventListener("click", runCurrent);
$("#btn-stop").addEventListener("click", () => runPanel.stop());

function openTerminalAt(dir) {
  terminalCwd = dir;
  showBottom("terminal", false);
  terminals.create().finally(() => (terminalCwd = null));
}

// ---------------------------------------------------------------- popups
const overlay = $("#overlay");

function closeOverlay() {
  overlay.replaceChildren();
  overlay.classList.remove("open", "dim");
}
overlay.addEventListener("mousedown", (e) => {
  if (e.target === overlay) closeOverlay();
});

function contextMenu(x, y, items, { anchorBottom = false } = {}) {
  closeOverlay();
  const menu = document.createElement("div");
  menu.className = "menu";
  for (const item of items) {
    if (item === "-") {
      menu.append(Object.assign(document.createElement("div"), { className: "menu-sep" }));
      continue;
    }
    const el = document.createElement("div");
    if (item.header) {
      el.className = "menu-header";
      el.textContent = item.header;
      menu.append(el);
      continue;
    }
    el.className = "menu-item" + (item.action ? "" : " disabled") + (item.checked ? " checked" : "");
    el.innerHTML = `<span class="icon">${item.icon ?? ""}</span><span class="label"></span><span class="hint"></span>`;
    el.querySelector(".label").textContent = item.label;
    el.querySelector(".hint").textContent = item.hint ?? "";
    if (item.action) {
      el.addEventListener("click", () => {
        closeOverlay();
        item.action();
      });
    }
    menu.append(el);
  }
  overlay.append(menu);
  overlay.classList.add("open");
  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
  const top = anchorBottom ? Math.max(8, y - rect.height) : Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function promptModal({ title, value = "", placeholder = "", selectStem = false }) {
  return new Promise((resolve) => {
    closeOverlay();
    const box = document.createElement("div");
    box.className = "modal";
    box.innerHTML = `<div class="modal-title"></div><input spellcheck="false" autocomplete="off" />`;
    box.querySelector(".modal-title").textContent = title;
    const input = box.querySelector("input");
    input.value = value;
    input.placeholder = placeholder;
    overlay.append(box);
    overlay.classList.add("open", "dim");
    input.focus();
    if (selectStem && value.includes(".")) input.setSelectionRange(0, value.lastIndexOf("."));
    else input.select();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      closeOverlay();
      resolve(v);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(input.value.trim() || null);
      if (e.key === "Escape") finish(null);
    });
    overlay.addEventListener("mousedown", (e) => e.target === overlay && finish(null), { once: true });
  });
}

/** Fuzzy subsequence match; rewards matches in the file name and consecutive characters. */
function fuzzyScore(query, path) {
  const q = query.toLowerCase();
  const p = path.toLowerCase();
  const nameStart = p.lastIndexOf("/") + 1;
  let score = 0;
  let pi = 0;
  let streak = 0;
  for (const ch of q) {
    const found = p.indexOf(ch, pi);
    if (found < 0) return -1;
    streak = found === pi ? streak + 1 : 0;
    score += 1 + streak * 2 + (found >= nameStart ? 3 : 0) + (found === nameStart ? 5 : 0);
    pi = found + 1;
  }
  return score - p.length * 0.01;
}

async function goToFile() {
  if (!state.root) return;
  closeOverlay();
  const box = document.createElement("div");
  box.className = "modal search-everywhere";
  box.innerHTML = `<div class="se-tabs"><span class="active">Files</span></div><input spellcheck="false" autocomplete="off" placeholder="Type a file name…" /><div class="se-results"></div>`;
  const input = box.querySelector("input");
  const results = box.querySelector(".se-results");
  overlay.append(box);
  overlay.classList.add("open", "dim");
  input.focus();

  let files = [];
  let matches = [];
  let selected = 0;
  const render = () => {
    const q = input.value.trim();
    matches = q
      ? files
          .map((f) => ({ f, s: fuzzyScore(q, f) }))
          .filter((m) => m.s >= 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 50)
          .map((m) => m.f)
      : [...editor.order].reverse().map((p) => p.slice(state.root.length + 1)).slice(0, 50);
    selected = Math.min(selected, Math.max(0, matches.length - 1));
    results.replaceChildren(
      ...matches.map((rel, i) => {
        const row = document.createElement("div");
        row.className = "se-row" + (i === selected ? " selected" : "");
        row.innerHTML = `<span class="icon"></span><span class="name"></span><span class="hint"></span>`;
        row.querySelector(".icon").innerHTML = rel.endsWith(".py") ? icons.python : icons.text;
        row.querySelector(".name").textContent = basename(rel);
        row.querySelector(".hint").textContent = dirname("/" + rel).slice(1);
        row.addEventListener("click", () => pick(i));
        return row;
      })
    );
    results.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  };
  const pick = (i) => {
    const rel = matches[i];
    closeOverlay();
    if (rel) openFile(join(state.root, rel));
  };
  input.addEventListener("input", () => {
    selected = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") (selected = Math.min(selected + 1, matches.length - 1)), render(), e.preventDefault();
    else if (e.key === "ArrowUp") (selected = Math.max(selected - 1, 0)), render(), e.preventDefault();
    else if (e.key === "Enter") pick(selected);
    else if (e.key === "Escape") closeOverlay();
  });
  render();
  files = await api.listFiles(state.root).catch(() => []);
  render();
}

async function goToLine() {
  if (!editor.active) return;
  const pos = editor.view.state.selection.main.head;
  const line = editor.view.state.doc.lineAt(pos);
  const v = await promptModal({ title: "Go to Line:Column", value: `${line.number}:${pos - line.from + 1}` });
  if (!v) return;
  const [l, c] = v.split(":").map((n) => parseInt(n, 10));
  if (l) editor.goToLine(l, c || 1);
}

let toastTimer;
function toast(text, kind = "info") {
  let el = $("#toast");
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "toast" });
    document.body.append(el);
  }
  el.className = kind;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4000);
}

$("#btn-search").addEventListener("click", goToFile);

// ---------------------------------------------------------------- shortcuts (PyCharm keymap for this OS)
const actions = {
  saveAll: () => editor.saveAll(),
  runFile: () => runCurrent(),
  rerun: () => (runPanel.last ? runPanel.rerun() : runCurrent()),
  stop: () => runPanel.stop(),
  terminal: () => showBottom("terminal"),
  project: () => toggleProject(),
  runTool: () => showBottom("run"),
  goToFile: () => goToFile(),
  goToLine: () => editor.active && goToLine(),
  closeTab: () => editor.active && editor.close(editor.active),
  nextTab: () => cycleTab(1),
  prevTab: () => cycleTab(-1),
};
// Inside the terminal these keys belong to the shell (⌘L/Ctrl+G, ⌘W/Ctrl+F4 are fine elsewhere).
const NOT_IN_TERMINAL = new Set(["goToLine", "closeTab"]);

function cycleTab(step) {
  if (!editor.order.length) return;
  const i = editor.order.indexOf(editor.active) + step;
  editor.activate(editor.order[(i + editor.order.length) % editor.order.length]);
}

let lastShift = 0;
let shiftClean = false;
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key === "Shift") {
      shiftClean = !e.repeat;
      return;
    }
    shiftClean = false;
    // The shell owns plain Ctrl-keys (Ctrl+C, Ctrl+R history search, …) and Esc inside the terminal.
    const inTerminal = !!e.target.closest?.(".xterm");
    let action = null;
    if (!(inTerminal && e.ctrlKey && !e.shiftKey)) {
      action = Object.keys(actions).find((a) => matches(e, keymap[a]) && !(inTerminal && NOT_IN_TERMINAL.has(a)));
    }
    if (action) actions[action]();
    else if (e.key === "Escape" && overlay.classList.contains("open")) closeOverlay();
    else if (e.key === "Escape" && state.layout.bottomView && document.activeElement?.closest("#run-view")) editor.view.focus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  },
  true
);
// Double ⇧ opens "Go to File", like Search Everywhere.
window.addEventListener("keyup", (e) => {
  if (e.key !== "Shift" || !shiftClean) return;
  const now = performance.now();
  if (now - lastShift < 350) {
    lastShift = 0;
    goToFile();
  } else lastShift = now;
});

window.addEventListener("blur", () => editor.saveAll()); // save on frame deactivation, like PyCharm

// ---------------------------------------------------------------- start
applyLayout();
renderWelcome();
const [lastProject] = recentProjects();
if (lastProject && store.get("reopenLast", true)) openProject(lastProject).catch(() => closeProject());
