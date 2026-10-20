// pytest integration: run icons in the editor gutter, a shared results store,
// and the test results tree shown in the Run tool window (like PyCharm's test runner).
import { gutter, GutterMarker } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { basename, dirname } from "./api.js";
import { icons } from "./icons.js";
import { normalizePath } from "./platform.js";

export const isTestFile = (path) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(path ?? "");

const STATUS_ICON = {
  passed: icons.testPassed,
  xpassed: icons.testPassed,
  failed: icons.testFailed,
  error: icons.testError,
  skipped: icons.testSkipped,
  xfailed: icons.testSkipped,
  stopped: icons.testSkipped,
  running: icons.testRunning,
  pending: icons.testPending,
};
const PASSED = new Set(["passed", "xpassed"]);
const FAILED = new Set(["failed", "error"]);

/** Status of a group: running wins, then failure, then pending; all-skipped stays skipped. */
function aggregate(statuses) {
  if (!statuses.length) return null;
  if (statuses.includes("running")) return "running";
  if (statuses.some((s) => FAILED.has(s))) return "failed";
  if (statuses.includes("pending")) return "pending";
  if (statuses.every((s) => !PASSED.has(s))) return "skipped";
  return "passed";
}

/** pytest target for one test: absolute path, so it works whatever pytest's rootdir is. */
const targetOf = (t) => `${t.path}::${t.cls ? t.cls + "::" : ""}${t.name}`;

function formatDuration(seconds) {
  const ms = seconds * 1000;
  if (ms < 1) return "<1 ms";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

// ------------------------------------------------------------ results store
/** Latest known status of every test, shared by the gutter icons and the results tree. */
export class TestResults {
  constructor() {
    this.tests = new Map(); // node id -> { path, cls, func, status }
    this.onChange = null;
    this.frame = 0;
  }

  begin(tests) {
    for (const t of tests) this.tests.set(t.id, { path: t.path, cls: t.cls, func: t.func, status: "pending" });
    this.changed();
  }

  setStatus(id, status) {
    const t = this.tests.get(id);
    if (t) t.status = status;
    this.changed();
  }

  /** `func` null means the whole class. */
  statusOf(path, cls, func) {
    const statuses = [];
    for (const t of this.tests.values()) {
      if (t.path === path && t.cls === cls && (func == null || t.func === func)) statuses.push(t.status);
    }
    return aggregate(statuses);
  }

  changed() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.onChange?.();
    });
  }
}

// ------------------------------------------------------------ gutter run icons
const testsChanged = StateEffect.define();

/** Line number → test found on that line (top-level `def test_*`, `class Test*` and its methods). */
function scanTests(doc) {
  const found = new Map();
  let cls = null;
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (!text.trim() || /^\s*[#@]/.test(text)) continue;
    let m;
    if (!/^\s/.test(text)) {
      if ((m = /^class\s+(Test\w*)\s*[:(]/.exec(text))) {
        cls = m[1];
        found.set(n, { cls, func: null });
        continue;
      }
      cls = null;
      if ((m = /^(?:async\s+)?def\s+(test\w*)\s*\(/.exec(text))) found.set(n, { cls: null, func: m[1] });
    } else if (cls && (m = /^\s+(?:async\s+)?def\s+(test\w*)\s*\(/.exec(text))) {
      found.set(n, { cls, func: m[1] });
    }
  }
  return found;
}

const testLines = StateField.define({
  create: (state) => scanTests(state.doc),
  update: (value, tr) => (tr.docChanged ? scanTests(tr.state.doc) : value),
});

class RunMarker extends GutterMarker {
  constructor(status, title) {
    super();
    this.status = status;
    this.title = title;
  }

  eq(other) {
    return other.status === this.status && other.title === this.title;
  }

  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-test-run";
    el.innerHTML = STATUS_ICON[this.status] ?? icons.run;
    el.title = this.title;
    return el;
  }
}

/** Run icons for a test file; clicking one runs that test or class. */
export function testGutter(path, { results, run }) {
  const testAt = (view, from) => view.state.field(testLines).get(view.state.doc.lineAt(from).number);
  const target = (t) => (t.func ? `${path}::${t.cls ? t.cls + "::" : ""}${t.func}` : `${path}::${t.cls}`);
  return [
    testLines,
    gutter({
      class: "cm-test-gutter",
      lineMarker(view, block) {
        const t = testAt(view, block.from);
        return t ? new RunMarker(results.statusOf(path, t.cls, t.func), `Run 'pytest for ${t.func ?? t.cls}'`) : null;
      },
      lineMarkerChange: (u) => u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(testsChanged))),
      initialSpacer: () => new RunMarker(null, ""),
      domEventHandlers: {
        mousedown(view, block, event) {
          const t = testAt(view, block.from);
          if (!t || event.button !== 0) return false;
          run(target(t), t.func ?? t.cls);
          return true;
        },
      },
    }),
  ];
}

export const refreshTestGutter = (view) => view.dispatch({ effects: testsChanged.of(null) });

// ------------------------------------------------------------ results tree
export class TestTree {
  constructor(el, { results, onOpen, onRun, onSelect, onContextMenu }) {
    this.results = results;
    this.onOpen = onOpen;
    this.onRun = onRun; // (targets, title)
    this.onSelect = onSelect; // ({ name, output } | null)
    this.onContextMenu = onContextMenu;
    this.showPassed = true;
    this.collapsed = new Set();
    this.leaves = new Map();
    this.errors = [];
    this.frame = 0;

    el.innerHTML = `
      <div class="test-header">
        <span class="test-summary"></span>
        <button class="icon-btn" data-act="passed" title="Show Passed">${icons.showPassed}</button>
        <button class="icon-btn" data-act="failed" title="Rerun Failed Tests">${icons.rerunFailed}</button>
      </div>
      <div class="test-tree" tabindex="0"></div>`;
    this.summaryEl = el.querySelector(".test-summary");
    this.treeEl = el.querySelector(".test-tree");
    this.passedBtn = el.querySelector('[data-act="passed"]');
    this.failedBtn = el.querySelector('[data-act="failed"]');
    this.passedBtn.classList.add("toggled");
    this.passedBtn.addEventListener("click", () => {
      this.showPassed = !this.showPassed;
      this.passedBtn.classList.toggle("toggled", this.showPassed);
      this.render();
    });
    this.failedBtn.addEventListener("click", () => {
      const failed = [...this.leaves.values()].filter((l) => FAILED.has(l.status)).map((l) => targetOf(l.test));
      if (failed.length) this.onRun(failed, "Failed tests");
    });
  }

  begin(spec) {
    this.spec = spec;
    this.leaves = new Map();
    this.errors = [];
    this.selected = "root";
    this.finished = false;
    this.exitCode = null;
    this.render();
  }

  handle(ev) {
    const leaf = ev.id != null ? this.leaves.get(ev.id) : null;
    switch (ev.event) {
      case "collected":
        for (const t of ev.tests) {
          t.path = normalizePath(t.path);
          this.leaves.set(t.id, { test: t, status: "pending", duration: 0, output: "" });
        }
        this.results.begin(ev.tests);
        break;
      case "start":
        if (leaf) leaf.status = "running";
        this.results.setStatus(ev.id, "running");
        break;
      case "result":
        if (leaf) Object.assign(leaf, { status: ev.outcome, duration: ev.duration, output: ev.output });
        this.results.setStatus(ev.id, ev.outcome);
        break;
      case "collect_error":
        this.errors.push({ path: normalizePath(ev.path), output: ev.output });
        break;
    }
    this.scheduleRender();
  }

  finish(exitCode) {
    this.finished = true;
    this.exitCode = exitCode;
    for (const [id, leaf] of this.leaves) {
      if (leaf.status === "pending" || leaf.status === "running") {
        leaf.status = "stopped";
        this.results.setStatus(id, "stopped");
      }
    }
    // Like PyCharm, jump to the first failure.
    const tree = this.build();
    const firstFailed = this.flatten(tree).find((n) => (n.leaf || n.error) && FAILED.has(this.status(n)));
    if (firstFailed && this.selected === "root") this.select(firstFailed);
    this.render();
  }

  // ---------------------------------------------------------- model
  build() {
    const root = { key: "root", name: "Test Results", children: new Map(), targets: this.spec?.targets ?? [] };
    const child = (node, key, props) => {
      if (!node.children.has(key)) node.children.set(key, { key: node.key + "\u0000" + key, children: new Map(), ...props });
      return node.children.get(key);
    };
    const fileNode = (path) =>
      child(root, path, { name: basename(path), hint: this.relDir(path), path, line: 1, targets: [path] });
    for (const leaf of this.leaves.values()) {
      const t = leaf.test;
      let node = fileNode(t.path);
      if (t.cls) node = child(node, t.cls, { name: t.cls, path: t.path, targets: [`${t.path}::${t.cls}`] });
      const param = t.name !== t.func;
      if (param) {
        const prefix = t.cls ? `${t.path}::${t.cls}::` : `${t.path}::`;
        node = child(node, t.func, { name: t.func, path: t.path, line: t.line, targets: [prefix + t.func] });
      }
      node.children.set(t.id, {
        key: t.id,
        name: param ? t.name.slice(t.func.length) : t.name,
        leaf,
        path: t.path,
        line: t.line,
        targets: [targetOf(t)],
        children: new Map(),
      });
    }
    for (const e of this.errors) Object.assign(fileNode(e.path), { error: e });
    return root;
  }

  relDir(path) {
    const root = this.spec?.cwd;
    const dir = dirname(path);
    return root && dir.startsWith(root) ? dir.slice(root.length + 1) : dir;
  }

  status(node) {
    if (node.leaf) return node.leaf.status;
    if (node.error) return "error";
    return aggregate([...node.children.values()].map((c) => this.status(c))) ?? (this.finished ? "skipped" : "pending");
  }

  duration(node) {
    if (node.leaf) return node.leaf.duration;
    let sum = 0;
    for (const c of node.children.values()) sum += this.duration(c);
    return sum;
  }

  flatten(node, out = []) {
    out.push(node);
    for (const c of node.children.values()) this.flatten(c, out);
    return out;
  }

  // ---------------------------------------------------------- view
  scheduleRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  select(node) {
    this.selected = node.key;
    if (node.leaf) this.onSelect({ name: node.leaf.test.name, output: node.leaf.output, status: node.leaf.status });
    else if (node.error) this.onSelect({ name: `${node.name} (collection error)`, output: node.error.output, status: "error" });
    else this.onSelect(null);
  }

  render() {
    const tree = this.build();
    this.renderSummary(tree);
    const rows = [];
    const visit = (node, depth) => {
      const status = this.status(node);
      if (!this.showPassed && depth > 0 && PASSED.has(status)) return;
      rows.push(this.row(node, depth, status));
      if (node.children.size && !this.collapsed.has(node.key)) {
        for (const c of node.children.values()) visit(c, depth + 1);
      }
    };
    visit(tree, 0);
    this.treeEl.replaceChildren(...rows);
    this.failedBtn.disabled = ![...this.leaves.values()].some((l) => FAILED.has(l.status)) || !this.finished;
  }

  row(node, depth, status) {
    const el = document.createElement("div");
    el.className = "test-row" + (node.key === this.selected ? " selected" : "");
    el.style.paddingLeft = `${6 + depth * 16}px`;
    const chevron = node.children.size ? (this.collapsed.has(node.key) ? icons.chevronRight : icons.chevronDown) : "";
    el.innerHTML = `<span class="chev">${chevron}</span><span class="icon">${STATUS_ICON[status] ?? ""}</span><span class="name"></span><span class="hint"></span><span class="time"></span>`;
    el.querySelector(".name").textContent = node.name;
    el.querySelector(".hint").textContent = node.hint ?? "";
    const done = node.leaf ? !["pending", "running", "stopped"].includes(status) : this.finished && node.children.size;
    el.querySelector(".time").textContent = done ? formatDuration(this.duration(node)) : "";

    el.addEventListener("click", (e) => {
      if (e.target.closest(".chev") && node.children.size) {
        this.collapsed.has(node.key) ? this.collapsed.delete(node.key) : this.collapsed.add(node.key);
      } else this.select(node);
      this.render();
    });
    el.addEventListener("dblclick", () => node.path && this.onOpen(node.path, node.line ?? 1));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.select(node);
      this.render();
      const label = node.key === "root" ? "Rerun" : `Run '${node.name.replace(/^\[/, node.leaf?.test.func + "[")}'`;
      const items = [{ label, icon: icons.run, action: () => this.onRun(node.targets, node.name) }];
      if (node.path) items.push({ label: "Jump to Source", action: () => this.onOpen(node.path, node.line ?? 1) });
      this.onContextMenu(e.clientX, e.clientY, items);
    });
    return el;
  }

  renderSummary(tree) {
    const leaves = [...this.leaves.values()];
    const count = (pred) => leaves.filter((l) => pred(l.status)).length;
    const failed = count((s) => FAILED.has(s));
    const passed = count((s) => PASSED.has(s));
    const skipped = count((s) => s === "skipped" || s === "xfailed");
    const total = leaves.length;
    const el = this.summaryEl;
    el.className = "test-summary";
    if (!this.finished) {
      el.textContent = total ? `Running… ${failed + passed + skipped} of ${total}` : "Collecting tests…";
      return;
    }
    if (!total) {
      el.textContent = this.errors.length ? "Errors during collection" : this.exitCode === 5 ? "No tests were found" : "Test run failed";
      el.classList.add(this.exitCode === 5 ? "muted" : "bad");
      return;
    }
    const parts = failed ? [`Tests failed: ${failed}`, `passed: ${passed}`] : [`Tests passed: ${passed}`];
    if (skipped) parts.push(`skipped: ${skipped}`);
    const stopped = count((s) => s === "stopped");
    if (stopped) parts.push(`stopped: ${stopped}`);
    el.textContent = `${parts.join(", ")} of ${total} test${total === 1 ? "" : "s"} – ${formatDuration(this.duration(tree))}`;
    el.classList.add(failed || this.errors.length ? "bad" : "good");
  }
}
