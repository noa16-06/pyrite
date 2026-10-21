// Settings | Keymap: PyCharm's keymap editor (add, remove and reset shortcuts, find actions by shortcut).
import { defaultKeymap, label, doubleShiftLabel, isMac, specFromEvent, sameShortcut } from "./platform.js";
import { dialogMenu } from "./popups.js";

/** Actions grouped roughly like PyCharm's keymap tree. */
export const KEYMAP_GROUPS = [
  ["File", { newElement: "New…", saveAll: "Save All", reloadAll: "Reload All from Disk", settings: "Settings…" }],
  ["Navigate", {
    goToFile: "Go to File", recentFiles: "Recent Files", goToLine: "Go to Line/Column", goToDeclaration: "Go to Declaration",
    findUsages: "Find Usages", nextProblem: "Next Highlighted Error", prevProblem: "Previous Highlighted Error",
  }],
  ["Code", { parameterInfo: "Parameter Info", reformat: "Reformat Code", optimizeImports: "Optimize Imports" }],
  ["Refactor", { rename: "Rename…" }],
  ["Run", { runFile: "Run Current File", rerun: "Rerun", stop: "Stop", debugFile: "Debug Current File", toggleBreakpoint: "Toggle Line Breakpoint" }],
  ["Debugger", { resume: "Resume Program", stepOver: "Step Over", stepInto: "Step Into", stepOut: "Step Out", evaluate: "Evaluate Expression" }],
  ["Tool Windows", { project: "Project", runTool: "Run", terminal: "Terminal" }],
  ["Editor Tabs", { closeTab: "Close Tab", nextTab: "Select Next Tab", prevTab: "Select Previous Tab" }],
];
export const ACTION_NAMES = Object.assign({}, ...KEYMAP_GROUPS.map(([, actions]) => actions));

const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
};

const defaults = (action) => (defaultKeymap[action] ? [defaultKeymap[action]] : []);
const sameList = (a, b) => a.length === b.length && a.every((s, i) => sameShortcut(s, b[i]));

/** The Keymap page. Edits go into `draft.keymap` (replaced, never mutated) and apply on Apply / OK. */
export function renderKeymapPage(draft) {
  const get = (action) => (Object.hasOwn(draft.keymap, action) ? draft.keymap[action] : defaults(action));
  const modified = (action) => Object.hasOwn(draft.keymap, action);
  function set(action, list) {
    const next = { ...draft.keymap };
    if (sameList(list, defaults(action))) delete next[action];
    else next[action] = list;
    draft.keymap = next;
  }
  const conflicts = (spec, except) =>
    Object.keys(ACTION_NAMES).filter((a) => a !== except && get(a).some((s) => sameShortcut(s, spec)));

  const base = isMac ? "macOS" : "Windows / Linux";
  const keymapName = el("span", { className: "keymap-name" });
  const restore = el("button", { className: "link", textContent: "Restore Defaults" });
  restore.addEventListener("click", () => ((draft.keymap = {}), render()));

  const search = el("input", { type: "search", placeholder: "Search actions", spellcheck: false });
  const findBtn = el("button", { className: "secondary small", textContent: "Find Actions by Shortcut" });
  let findSpec = null; // set while filtering by a recorded shortcut
  const findChip = el("span", { className: "find-chip" });
  findBtn.addEventListener("click", () =>
    shortcutDialog(findBtn, { title: "Find Actions by Shortcut", onOk: (spec) => ((findSpec = spec), render()) })
  );
  findChip.addEventListener("click", () => ((findSpec = null), render()));

  const table = el("div", { className: "keymap-table", tabIndex: 0 });
  let selected = null;

  function rowMenu(action, x, y) {
    const items = [{ label: "Add Keyboard Shortcut", action: () => addShortcut(action) }];
    const list = get(action);
    if (list.length) items.push("-", ...list.map((spec) => ({ label: `Remove ${label(spec)}`, action: () => (set(action, get(action).filter((s) => s !== spec)), render()) })));
    if (modified(action)) items.push("-", { label: "Reset Shortcuts", action: () => (set(action, defaults(action)), render()) });
    dialogMenu(x, y, items);
  }

  function addShortcut(action) {
    shortcutDialog(table, {
      title: `Keyboard Shortcut: ${ACTION_NAMES[action]}`,
      conflictsFor: (spec) => conflicts(spec, action).map((a) => ACTION_NAMES[a]),
      onOk: (spec) => {
        const others = conflicts(spec, action);
        const add = () => {
          if (!get(action).some((s) => sameShortcut(s, spec))) set(action, [...get(action), spec]);
          render();
        };
        if (!others.length) return add();
        confirmDialog(table, {
          title: "Warning",
          message: "This shortcut is already assigned to other actions. Do you want to remove the other assignments?",
          buttons: [
            ["Remove", () => {
              for (const a of others) set(a, get(a).filter((s) => !sameShortcut(s, spec)));
              add();
            }],
            ["Keep", add],
            ["Cancel", () => {}],
          ],
        });
      },
    });
  }

  function render() {
    keymapName.textContent = Object.keys(draft.keymap).length ? `${base} (modified)` : base;
    restore.style.display = Object.keys(draft.keymap).length ? "" : "none";
    findChip.textContent = findSpec ? `${label(findSpec)}  ✕` : "";
    findChip.style.display = findSpec ? "" : "none";
    const q = search.value.trim().toLowerCase();
    const rows = [];
    for (const [group, actions] of KEYMAP_GROUPS) {
      const matching = Object.entries(actions).filter(([id, name]) => {
        const keys = get(id);
        if (findSpec) return keys.some((s) => sameShortcut(s, findSpec));
        return !q || name.toLowerCase().includes(q) || group.toLowerCase().includes(q) || keys.some((s) => label(s).toLowerCase().includes(q));
      });
      if (!matching.length) continue;
      rows.push(el("div", { className: "keymap-group", textContent: group }));
      for (const [id, name] of matching) {
        const r = el(
          "div",
          { className: "keymap-row" + (modified(id) ? " modified" : "") + (selected === id ? " selected" : "") },
          el("span", { className: "action", textContent: name }),
          el("span", { className: "keys" }, ...get(id).map((s) => el("kbd", { textContent: label(s) })))
        );
        r.addEventListener("mousedown", () => {
          selected = id;
          for (const x of table.querySelectorAll(".keymap-row.selected")) x.classList.remove("selected");
          r.classList.add("selected");
        });
        r.addEventListener("dblclick", () => addShortcut(id));
        r.addEventListener("contextmenu", (e) => (e.preventDefault(), rowMenu(id, e.clientX, e.clientY)));
        rows.push(r);
      }
    }
    if (!findSpec && (!q || "go to file search everywhere double shift".includes(q))) {
      rows.push(
        el("div", { className: "keymap-group", textContent: "Other" }),
        el("div", { className: "keymap-row readonly", title: "Built in, can't be changed" },
          el("span", { className: "action", textContent: "Go to File (Search Everywhere)" }),
          el("span", { className: "keys" }, el("kbd", { textContent: doubleShiftLabel })))
      );
    }
    if (!rows.length) rows.push(el("div", { className: "packages-status", textContent: "Nothing found" }));
    table.replaceChildren(...rows);
  }
  search.addEventListener("input", render);
  table.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && selected) addShortcut(selected), e.preventDefault(), e.stopPropagation();
  });
  render();

  return [
    el("div", { className: "form-row" }, el("label", { textContent: "Keymap:" }), el("div", { className: "form-controls" }, keymapName, restore)),
    el("div", { className: "keymap-toolbar" }, search, findChip, findBtn),
    table,
    el("div", { className: "form-hint" }, "Double-click an action or right-click it to add or remove shortcuts. Editor keys such as Duplicate Line aren't listed yet."),
  ];
}

/** A small dialog on top of the Settings dialog. */
function innerDialog(anchor, title, body, buttons) {
  const host = anchor.closest(".modal");
  const back = el("div", { className: "inner-dialog-backdrop" });
  const box = el("div", { className: "inner-dialog" }, el("div", { className: "dialog-title", textContent: title }), body);
  const footer = el("div", { className: "dialog-footer" });
  box.append(footer);
  back.append(box);
  host.append(back);
  const close = () => {
    back.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  for (const [text, fn, primary] of buttons) {
    const b = el("button", { className: primary ? "primary" : "secondary", textContent: text });
    b.addEventListener("click", () => fn(close));
    footer.append(b);
  }
  // Runs before the Settings dialog's own key handler, so Esc / Enter only affect this dialog.
  let onKey = () => {};
  const setKeys = (fn) => {
    onKey = fn;
    document.addEventListener("keydown", onKey, true);
  };
  return { close, setKeys, box };
}

/** Records one keystroke, PyCharm's "Keyboard Shortcut" dialog. */
function shortcutDialog(anchor, { title, conflictsFor, onOk }) {
  let spec = null;
  const field = el("div", { className: "stroke-field recording", tabIndex: 0, textContent: "Press a key combination…" });
  const info = el("div", { className: "stroke-conflicts" });
  const body = el("div", { className: "inner-body" }, el("label", { textContent: "First Stroke:" }), field, info);
  const ok = (close) => {
    if (!spec) return;
    close();
    onOk(spec);
  };
  const d = innerDialog(anchor, title, body, [["Cancel", (close) => close()], ["OK", ok, true]]);
  d.setKeys((e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return d.close();
    if (e.key === "Enter" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && spec) return ok(d.close);
    const next = specFromEvent(e);
    if (!next) return;
    spec = next;
    field.textContent = label(spec);
    field.classList.remove("recording");
    const taken = conflictsFor?.(spec) ?? [];
    info.textContent = taken.length ? `Already assigned to: ${taken.join(", ")}` : conflictsFor ? "No conflicts" : "";
    info.classList.toggle("has-conflicts", taken.length > 0);
  });
  field.focus();
}

function confirmDialog(anchor, { title, message, buttons }) {
  const d = innerDialog(
    anchor,
    title,
    el("div", { className: "inner-body", textContent: message }),
    buttons.map(([text, fn], i) => [text, (close) => (close(), fn()), i === 0])
  );
  d.setKeys((e) => {
    if (e.key === "Escape") d.close(), e.preventDefault(), e.stopImmediatePropagation();
  });
  d.box.querySelector(".primary")?.focus();
}
