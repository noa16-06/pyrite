import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";
import { open as openDialog, ask } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import { api, basename, dirname, join } from "./api.js";
import { keymap, matchesAction, label, doubleShiftLabel, tildify, normalizePath, isMac } from "./platform.js";
import { icons, logo } from "./icons.js";
import { EditorArea } from "./editor.js";
import { ProjectTree } from "./tree.js";
import { RunPanel } from "./run.js";
import { TerminalPanel } from "./terminal.js";
import { Intelligence } from "./intelligence.js";
import { TestResults, isTestFile, testGutter, refreshTestGutter } from "./tests.js";
import { Breakpoints, breakpointGutter, refreshBreakpoints } from "./breakpoints.js";
import { Debugger } from "./debugger.js";
import { overlay, closeOverlay, contextMenu, promptModal, toast } from "./popups.js";
import { newProjectDialog } from "./newproject.js";
import { settings, saveSettings, onSettingsChange, openSettings, applyAppearance, indentLabel, effectiveTheme, THEMES } from "./settings.js";

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
  recentFiles: [], // most recent first, saved per project
  layout: store.get("layout", { left: 280, bottom: 280, project: true, bottomView: null }),
};

// ---------------------------------------------------------------- icons
for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = icons[el.dataset.icon];
$("#btn-run").innerHTML = icons.run;
$("#btn-debug").innerHTML = icons.debug;
$("#btn-stop").innerHTML = icons.stop;
$("#btn-search").innerHTML = icons.search;
$("#main-menu").innerHTML = icons.hamburger;
$('.stripe-btn[data-panel="project"]').innerHTML = icons.project;
$('.stripe-btn[data-panel="run"]').innerHTML = icons.runTool;
$('.stripe-btn[data-panel="terminal"]').innerHTML = icons.terminal;
$("#tree-new-file").innerHTML = icons.newFile;
$("#tree-new-dir").innerHTML = icons.newDir;
$("#tree-refresh").innerHTML = icons.refresh;
$("#tree-collapse").innerHTML = icons.collapse;
$("#bottom-hide").innerHTML = icons.minimize;
$("#welcome-logo").innerHTML = logo(32);
$("#banner-icon").innerHTML = icons.python;
/** Shortcut hints in tooltips and <kbd> elements; re-run when the keymap changes. */
function renderShortcutLabels() {
  for (const el of document.querySelectorAll("[data-key]")) {
    const text = el.dataset.key === "doubleShift" ? doubleShiftLabel : label(keymap[el.dataset.key]);
    if (el.tagName === "KBD") {
      el.textContent = text;
      el.parentElement.style.display = text ? "" : "none";
    } else {
      el.dataset.title ??= el.title;
      el.title = text ? `${el.dataset.title}  ${text}` : el.dataset.title;
    }
  }
  $("#btn-search").title += ` / ${doubleShiftLabel}`;
}

// ---------------------------------------------------------------- components
const editor = new EditorArea({
  editorEl: $("#editor"),
  tabsEl: $("#tabs"),
  emptyEl: $("#editor-empty"),
  onActiveChange(path) {
    if (path) state.recentFiles = [path, ...state.recentFiles.filter((p) => p !== path)].slice(0, 50);
    $("#sb-path").textContent = path && state.root ? path.replace(state.root, basename(state.root)).split("/").join(" › ") : "";
    $("#run-target-name").textContent =
      path && isTestFile(path) ? `pytest in ${basename(path)}` : path && /\.py$/.test(path) ? basename(path) : "Current File";
    if (path) tree.select(path);
    saveSession();
  },
  onCursor(pos) {
    $("#sb-pos").textContent = pos ? `${pos.line}:${pos.col}` : "";
  },
});

const intel = new Intelligence({
  editor,
  openFile: (path) => openFile(path),
  toast,
  statusEl: $("#sb-lsp"),
  problemsEl: $("#inspections"),
  bannerEl: $("#tools-banner"),
});
const testResults = new TestResults();
const breakpoints = new Breakpoints();
testResults.onChange = () => editor.active && isTestFile(editor.active) && refreshTestGutter(editor.view);
editor.hooks = {
  extension: (path) => [
    intel.extension(path),
    isTestFile(path) ? testGutter(path, { results: testResults, run: (target, name) => runTests([target], name) }) : [],
    /\.pyw?$/.test(path) ? breakpointGutter(path, breakpoints) : [],
  ],
  beforeSwitch: () => intel.sync(),
  activated: (path) => intel.activated(path),
  changed: (path) => intel.changed(path),
  closed: (path) => intel.closed(path),
};
$("#banner-install").addEventListener("click", () => intel.install());
$("#banner-dismiss").addEventListener("click", () => intel.dismissBanner());

const tree = new ProjectTree($("#tree"), {
  onOpen: (path) => openFile(path),
  onContextMenu: ({ x, y, path, isDir }) => {
    const dir = isDir ? path : dirname(path);
    const items = [{ label: "New", children: newItems(dir) }, "-"];
    if (!isDir && isTestFile(path)) {
      items.push({ label: `Run 'pytest in ${basename(path)}'`, icon: icons.run, action: () => runTests([path], basename(path)) }, "-");
    } else if (!isDir && /\.py$/.test(path)) {
      items.push(
        { label: `Run '${basename(path)}'`, icon: icons.run, action: () => runFile(path) },
        { label: `Debug '${basename(path)}'`, icon: icons.debug, action: () => debugFile(path) },
        "-"
      );
    } else if (isDir) {
      items.push({ label: `Run 'pytest in ${basename(path)}'`, icon: icons.run, action: () => runTests([path], basename(path)) });
    }
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
  results: testResults,
  onContextMenu: (x, y, items) => contextMenu(x, y, items),
  onOpenLocation: (file, line) => openFile(normalizePath(file), line),
  onStateChange(running) {
    state.running = running;
    $("#btn-stop").disabled = !running;
    $("#run-widget").classList.toggle("running", running);
  },
  onModeChange(kind) {
    $('.tool-tab[data-view="run"]').textContent = kind === "debug" ? "Debug" : "Run";
  },
});

const debug = new Debugger(runPanel.debugPane, {
  breakpoints,
  openFile: (path, line) => openFile(path, line),
  refreshEditor: () => editor.active && refreshBreakpoints(editor.view),
});
runPanel.debugger = debug;
breakpoints.onChange = (path) => {
  if (state.root) store.set("project." + state.root, { ...store.get("project." + state.root, {}), breakpoints: breakpoints.toJSON() });
  debug.sendBreakpoints(path);
};

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
  const q = $("#welcome-search").value.trim().toLowerCase();
  const shown = recents.filter((p) => !q || p.toLowerCase().includes(q));
  // PyCharm swaps the project list for a big "Welcome" page until something has been opened.
  $("#welcome").classList.toggle("first-run", !recents.length);
  list.replaceChildren(
    ...shown.map((path) => {
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.innerHTML = `<span class="proj-badge"></span><div class="recent-text"><div class="recent-name"></div><div class="recent-path"></div></div><button class="icon-btn more" title="Options">${icons.more}</button>`;
      li.querySelector(".proj-badge").textContent = badge(basename(path));
      li.querySelector(".recent-name").textContent = basename(path);
      li.querySelector(".recent-path").textContent = tildify(path);
      const remove = () => {
        store.set("recent", recentProjects().filter((p) => p !== path));
        renderWelcome();
      };
      const options = (x, y) =>
        contextMenu(x, y, [
          { label: "Open", icon: icons.folder, action: () => openProject(path) },
          "-",
          { label: "Remove from Recent Projects…", action: remove },
        ]);
      li.addEventListener("click", (e) => {
        if (e.target.closest(".more")) {
          const r = e.target.closest(".more").getBoundingClientRect();
          options(r.left, r.bottom + 4);
        } else openProject(path);
      });
      li.addEventListener("contextmenu", (e) => (e.preventDefault(), options(e.clientX, e.clientY)));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter") openProject(path);
        else if (e.key === "Delete" || e.key === "Backspace") remove();
        else if (e.key === "ArrowDown") li.nextElementSibling?.focus();
        else if (e.key === "ArrowUp") (li.previousElementSibling ?? $("#welcome-search")).focus();
        else return;
        e.preventDefault();
      });
      return li;
    })
  );
  if (recents.length && !shown.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nothing to show";
    list.append(li);
  }
}

$("#welcome-search").addEventListener("input", renderWelcome);
$("#welcome-search").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") $("#recent-list li:not(.empty)")?.focus(), e.preventDefault();
  if (e.key === "Enter") $("#recent-list li:not(.empty)")?.click();
});
getVersion().then((v) => ($("#welcome-version").textContent = v)).catch(() => {});

function badge(name) {
  const parts = name.split(/[-_ .]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "P") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}

async function chooseProject() {
  const dir = await openDialog({ directory: true, multiple: false, title: "Open File or Project" });
  if (dir) await openProject(normalizePath(dir));
}

/** File | Open File…: opens a file in the current project, or its folder as a project when none is open. */
async function chooseFile() {
  const file = await openDialog({ directory: false, multiple: false, title: "Open File" });
  if (!file) return;
  const path = normalizePath(file);
  if (!state.root) await openProject(dirname(path));
  await openFile(path);
}

async function newProject() {
  const created = await newProjectDialog();
  if (!created) return;
  const session = store.get("project." + created.root, {});
  store.set("project." + created.root, { ...session, interpreter: created.interpreter.path });
  await openProject(created.root);
  if (created.welcome) await openFile(created.welcome);
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
  state.recentFiles = session.recentFiles ?? [];
  breakpoints.load(session.breakpoints);
  await loadInterpreter(session.interpreter);
  for (const f of session.tabs ?? []) await editor.open(f).catch(() => {});
  if (session.active && editor.has(session.active)) editor.activate(session.active);
  applyLayout();
}

async function closeProject(showWelcome = true) {
  await editor.closeAll();
  intel.stop();
  intel.root = null;
  $("#tools-banner").style.display = "none";
  $("#sb-lsp").textContent = "";
  await runPanel.stop();
  runPanel.clear();
  debug.end();
  breakpoints.load({});
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
    recentFiles: state.recentFiles,
  });
}

for (const id of ["#welcome-open", "#welcome-open-big"]) $(id).addEventListener("click", chooseProject);
for (const id of ["#welcome-new", "#welcome-new-big"]) $(id).addEventListener("click", newProject);

function recentProjectItems() {
  return recentProjects()
    .filter((p) => p !== state.root)
    .slice(0, 10)
    .map((p) => ({ label: basename(p), hint: tildify(p), action: () => openProject(p) }));
}

$("#project-switcher").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const items = [
    { label: "New Project…", icon: icons.plus, action: newProject },
    { label: "Open…", icon: icons.folder, action: chooseProject },
  ];
  const recents = recentProjectItems();
  if (recents.length) items.push("-", { header: "Recent Projects" }, ...recents);
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
  intel.start(state.root, state.interpreter); // the language server resolves imports with this interpreter
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
    intel.restart(state.interpreter);
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

/** The "New" group (File | New…, and New in the project view's context menu). */
function newItems(dir) {
  return [
    { label: "File", icon: icons.text, action: () => newFile(dir, false) },
    { label: "Directory", icon: icons.folder, action: () => newDir(dir) },
    "-",
    { label: "Python File", icon: icons.python, action: () => newFile(dir) },
    { label: "Python Package", icon: icons.package, action: () => newPackage(dir) },
  ];
}

/** ⌘N / Alt+Insert: the "New" popup for the folder selected in the project view. */
function newElement() {
  if (!state.root) return;
  const r = $("#tree").getBoundingClientRect();
  const sel = $("#tree .selected")?.getBoundingClientRect();
  const visible = state.layout.project && r.width > 0;
  const x = visible ? r.left + 24 : window.innerWidth / 2 - 110;
  const y = visible && sel ? sel.bottom + 2 : visible ? r.top + 8 : window.innerHeight / 3;
  contextMenu(x, y, [{ header: "New" }, ...newItems(tree.targetDir())]);
}

async function newPackage(dir) {
  const name = await promptModal({ title: "New Python Package", placeholder: "Name (e.g. app or app.models)" });
  if (!name) return;
  const pkg = join(dir, name.replace(/\./g, "/"));
  try {
    // Every level of a dotted name becomes a package, as in PyCharm.
    for (let d = pkg; d.startsWith(dir) && d !== dir; d = dirname(d)) await api.createFile(join(d, "__init__.py")).catch(() => {});
    tree.expand(dir);
    for (let d = pkg; d !== dir; d = dirname(d)) tree.expand(d);
    await tree.refresh();
    tree.select(join(pkg, "__init__.py"));
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
    const moved = editor.order.filter((p) => p === path || p.startsWith(path + "/"));
    editor.renamed(path, to);
    intel.renamed(moved);
    breakpoints.renamed(path, to);
    breakpoints.onChange?.(to);
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
  if (isTestFile(file)) return runTests([file], basename(file)); // PyCharm runs test files with pytest
  await editor.saveAll(); // PyCharm saves everything before running
  showBottom("run", false);
  runPanel.run({ kind: "script", interpreter: state.interpreter.path, file, cwd: dirname(file) });
}

/** Runs pytest from the project root on files, folders or `file::Class::test` targets. */
async function runTests(targets, title) {
  if (!state.root) return;
  if (!state.interpreter) {
    toast("No Python interpreter configured — click the interpreter in the status bar.", "error");
    return;
  }
  await editor.saveAll();
  showBottom("run", false);
  runPanel.run({ kind: "tests", interpreter: state.interpreter.path, targets, cwd: state.root, title });
}

function runCurrent() {
  runFile(editor.active);
}

$("#btn-run").addEventListener("click", runCurrent);
$("#btn-debug").addEventListener("click", () => debugFile(editor.active));

/** Debugs a file with debugpy; test files run pytest under the debugger. */
async function debugFile(file) {
  if (!state.root) return;
  if (!file || !/\.pyw?$/.test(file)) {
    toast("Open a Python file to debug it.", "info");
    return;
  }
  if (!state.interpreter) {
    toast("No Python interpreter configured — click the interpreter in the status bar.", "error");
    return;
  }
  if (!intel.tools?.debugpy) {
    const ok = await ask("The debugger needs debugpy. Install Pyrite's code tools (basedpyright, Ruff and debugpy) now?", {
      title: "Debugger",
      okLabel: "Install",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    await intel.install();
    if (!intel.tools?.debugpy) return;
  }
  await editor.saveAll();
  showBottom("run", false);
  const test = isTestFile(file);
  runPanel.run({
    kind: "debug",
    interpreter: state.interpreter.path,
    file,
    cwd: test ? state.root : dirname(file),
    debugpy: intel.tools.debugpy,
    program: test ? ["-m", "pytest", file] : undefined,
  });
}

function toggleBreakpoint() {
  const path = editor.active;
  if (!path || !/\.pyw?$/.test(path)) return;
  const view = editor.view;
  breakpoints.toggle(path, view.state.doc.lineAt(view.state.selection.main.head).number);
  refreshBreakpoints(view);
}
$("#btn-stop").addEventListener("click", () => runPanel.stop());

function openTerminalAt(dir) {
  terminalCwd = dir;
  showBottom("terminal", false);
  terminals.create().finally(() => (terminalCwd = null));
}

// ---------------------------------------------------------------- go to file
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

const goToFile = () =>
  filePopup("Files", () => api.listFiles(state.root).catch(() => []), () => [...editor.order].reverse());

/** ⌘E / Ctrl+E: recently opened files, newest first, with the current file second so Enter switches back. */
const recentFiles = () => {
  const recent = () => {
    const list = state.recentFiles.filter((p) => p !== editor.active);
    return editor.active ? [list[0], editor.active, ...list.slice(1)].filter(Boolean) : list;
  };
  const inProject = () => recent().filter((p) => p.startsWith(state.root + "/"));
  return filePopup("Recent Files", async () => inProject().map((p) => p.slice(state.root.length + 1)), inProject);
};

/** Search popup over project-relative paths; `recent()` (absolute paths) is shown while the query is empty. */
async function filePopup(title, load, recent) {
  if (!state.root) return;
  closeOverlay();
  const box = document.createElement("div");
  box.className = "modal search-everywhere";
  box.innerHTML = `<div class="se-tabs"><span class="active"></span></div><input spellcheck="false" autocomplete="off" placeholder="Type a file name…" /><div class="se-results"></div>`;
  box.querySelector(".se-tabs .active").textContent = title;
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
      : recent().map((p) => p.slice(state.root.length + 1)).slice(0, 50);
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
  files = await load();
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

$("#btn-search").addEventListener("click", goToFile);

$("#editor").addEventListener("contextmenu", (e) => {
  if (!editor.active || !/\.pyi?$/.test(editor.active)) return;
  e.preventDefault();
  const pos = editor.view.posAtCoords({ x: e.clientX, y: e.clientY });
  const sel = editor.view.state.selection.main;
  if (pos != null && (sel.empty || pos < sel.from || pos > sel.to)) editor.view.dispatch({ selection: { anchor: pos } });
  const item = (text, key, icon) => ({ label: text, hint: label(keymap[key]), icon, action: () => (actions[key](), editor.view.focus()) });
  contextMenu(e.clientX, e.clientY, [
    item("Go to Declaration", "goToDeclaration"),
    item("Find Usages", "findUsages"),
    item("Rename…", "rename"),
    "-",
    item("Reformat Code", "reformat"),
    item("Optimize Imports", "optimizeImports"),
    "-",
    item(isTestFile(editor.active) ? `Run 'pytest in ${basename(editor.active)}'` : `Run '${basename(editor.active)}'`, "runFile", icons.run),
    item(`Debug '${basename(editor.active)}'`, "debugFile", icons.debug),
    item("Toggle Line Breakpoint", "toggleBreakpoint"),
  ]);
});

// ---------------------------------------------------------------- main menu
async function reloadAll() {
  if (!state.root) return;
  await tree.refresh();
  await editor.reloadFromDisk();
}

/** Menu-only commands; the rest come from `actions`, so a menu click and its shortcut do the same thing. */
const menuCommands = {
  newProject: () => newProject(),
  open: () => chooseProject(),
  openFile: () => chooseFile(),
  closeProject: () => state.root && closeProject(),
  recentProjects: () => {
    const items = recentProjectItems();
    contextMenu(window.innerWidth / 2 - 150, 80, items.length ? [{ header: "Recent Projects" }, ...items] : [{ label: "No recent projects" }]);
  },
  exit: () => appWindow.close(),
};

function runCommand(id) {
  (menuCommands[id] ?? actions[id])?.();
}

/** PyCharm's main menu (the ☰ button on Windows and Linux; the menu bar on macOS is native). */
function mainMenuItems() {
  const open = !!state.root;
  const item = (text, id, { icon, enabled = true } = {}) => ({
    label: text,
    icon,
    hint: keymap[id] ? label(keymap[id]) : "",
    action: () => runCommand(id),
    disabled: !enabled,
  });
  const recents = recentProjectItems();
  return [
    {
      label: "File",
      children: [
        { label: "New", children: [item("New Project…", "newProject"), item("New…", "newElement", { enabled: open })] },
        item("Open…", "open", { icon: icons.folder }),
        item("Open File…", "openFile"),
        { label: "Recent Projects", children: recents.length ? recents : [{ label: "No recent projects" }] },
        item("Close Project", "closeProject", { enabled: open }),
        "-",
        item("Settings…", "settings", { icon: icons.config }),
        "-",
        item("Save All", "saveAll", { enabled: open }),
        item("Reload All from Disk", "reloadAll", { icon: icons.refresh, enabled: open }),
        "-",
        item("Exit", "exit"),
      ],
    },
    {
      label: "View",
      children: [
        { label: "Tool Windows", children: [item("Project", "project"), item("Run", "runTool"), item("Terminal", "terminal")] },
        "-",
        item("Recent Files", "recentFiles", { enabled: open }),
      ],
    },
    {
      label: "Navigate",
      children: [item("File…", "goToFile", { enabled: open }), item("Line/Column…", "goToLine", { enabled: !!editor.active })],
    },
    {
      label: "Run",
      children: [
        item("Run", "runFile", { icon: icons.run, enabled: open }),
        item("Debug", "debugFile", { icon: icons.debug, enabled: open }),
        item("Stop", "stop", { icon: icons.stop, enabled: state.running }),
        "-",
        item("Toggle Line Breakpoint", "toggleBreakpoint", { enabled: !!editor.active }),
      ],
    },
  ];
}

$("#main-menu").addEventListener("click", (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  contextMenu(r.left, r.bottom + 4, mainMenuItems());
});
if (isMac) $("#main-menu").remove();
listen("menu", (e) => runCommand(e.payload)).catch(() => {});

// ---------------------------------------------------------------- shortcuts (PyCharm keymap for this OS)
const actions = {
  saveAll: () => editor.saveAll(),
  settings: () => showSettings(),
  newElement: () => newElement(),
  recentFiles: () => recentFiles(),
  reloadAll: () => reloadAll(),
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
  goToDeclaration: () => intel.goToDeclaration(),
  findUsages: () => intel.findUsages(),
  rename: () => intel.rename(),
  parameterInfo: () => intel.parameterInfo(),
  reformat: () => intel.reformat(),
  optimizeImports: () => intel.optimizeImports(),
  nextProblem: () => intel.nextProblem(),
  prevProblem: () => intel.nextProblem(true),
  debugFile: () => debugFile(editor.active),
  resume: () => debug.resume(),
  stepOver: () => debug.stepOver(),
  stepInto: () => debug.stepInto(),
  stepOut: () => debug.stepOut(),
  toggleBreakpoint: () => toggleBreakpoint(),
  evaluate: () => (showBottom("run", false), debug.focusEvaluate()),
};
// Stepping keys only do something while a debug session is paused; otherwise they stay free.
const WHILE_PAUSED = new Set(["resume", "stepOver", "stepInto", "stepOut", "evaluate"]);
// Inside the terminal these keys belong to the shell (⌘L/Ctrl+G, ⌘W/Ctrl+F4 are fine elsewhere).
const NOT_IN_TERMINAL = new Set(["goToLine", "closeTab"]);
// Code actions work on the symbol at the cursor, so they need the editor to have focus.
const CODE_ACTIONS = new Set([
  "goToDeclaration", "findUsages", "rename", "parameterInfo", "reformat", "optimizeImports", "nextProblem", "prevProblem",
  "toggleBreakpoint",
]);

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
    if (overlay.classList.contains("locked")) return; // a dialog is open and handles its own keys
    if (e.key === "Shift") {
      shiftClean = !e.repeat;
      return;
    }
    shiftClean = false;
    // The shell owns plain Ctrl-keys (Ctrl+C, Ctrl+R history search, …) and Esc inside the terminal.
    const inTerminal = !!e.target.closest?.(".xterm");
    let action = null;
    if (!(inTerminal && e.ctrlKey && !e.shiftKey)) {
      const inEditor = !!e.target.closest?.("#editor");
      action = Object.keys(actions).find(
        (a) =>
          matchesAction(e, a) &&
          !(inTerminal && NOT_IN_TERMINAL.has(a)) &&
          (inEditor || !CODE_ACTIONS.has(a)) &&
          (!WHILE_PAUSED.has(a) || debug.state === "paused")
      );
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

// Save on frame deactivation and when the built-in terminal takes focus, like PyCharm.
window.addEventListener("blur", () => settings().saveOnDeactivation && editor.saveAll());
$("#terminal-view").addEventListener("focusin", () => settings().saveOnDeactivation && editor.saveAll());

// ---------------------------------------------------------------- settings
function showSettings(page) {
  openSettings(
    {
      projectName: state.root ? basename(state.root) : null,
      interpreter: state.interpreter,
      setInterpreter,
      defaultProjectsDir: null,
    },
    page
  );
}

function applySettings() {
  applyAppearance();
  renderShortcutLabels();
  const theme = effectiveTheme();
  terminals.setTheme(theme.startsWith("light"));
  // Native window frame (title bar on Windows/Linux) follows the theme too.
  appWindow.setTheme(theme.startsWith("light") ? "light" : "dark").catch(() => {});
  editor.applySettings();
  $("#sb-indent").textContent = indentLabel();
  renderCustomize();
}
onSettingsChange(applySettings);
$("#sb-indent").addEventListener("click", () => state.root && showSettings("codestyle"));

// Welcome screen | Customize: the few settings PyCharm puts on its welcome screen.
function renderCustomize() {
  const s = settings();
  const sizes = (sel, values, current) => {
    sel.replaceChildren(...values.map((v) => new Option(String(v), String(v))));
    sel.value = String(current);
  };
  sizes($("#cz-ui-size"), [11, 12, 13, 14, 15, 16], s.uiCustomFont ? s.uiFontSize : 13);
  sizes($("#cz-editor-size"), [11, 12, 13, 14, 15, 16, 18, 20], s.editorFontSize);
  $("#cz-keymap").textContent = isMac ? "macOS" : "Windows / Linux";
  const theme = $("#cz-theme");
  theme.replaceChildren(...Object.entries(THEMES).map(([id, name]) => new Option(name, id)));
  theme.value = effectiveTheme();
  theme.disabled = s.syncTheme;
  $("#cz-sync").checked = s.syncTheme;
}
$("#cz-theme").addEventListener("change", (e) => saveSettings({ theme: e.target.value }));
$("#cz-sync").addEventListener("change", (e) => saveSettings({ syncTheme: e.target.checked }));
$("#cz-ui-size").addEventListener("change", (e) => {
  const size = Number(e.target.value);
  saveSettings({ uiCustomFont: size !== 13 || settings().uiCustomFont, uiFontSize: size });
});
$("#cz-editor-size").addEventListener("change", (e) => saveSettings({ editorFontSize: Number(e.target.value) }));
$("#cz-all").addEventListener("click", () => showSettings());
for (const b of document.querySelectorAll(".welcome-nav")) {
  b.addEventListener("click", () => {
    for (const n of document.querySelectorAll(".welcome-nav")) n.classList.toggle("active", n === b);
    $("#welcome-projects").style.display = b.dataset.page === "projects" ? "" : "none";
    $("#welcome-customize").style.display = b.dataset.page === "customize" ? "" : "none";
  });
}

// ---------------------------------------------------------------- start
applyLayout();
renderWelcome();
const [lastProject] = recentProjects();
applySettings();
if (lastProject && settings().reopenLast) openProject(lastProject).catch(() => closeProject());

if (import.meta.env.DEV) window.__pyrite = { editor, intel, debug, breakpoints }; // for automated UI checks
