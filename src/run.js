import { api, Channel, join } from "./api.js";
import { icons } from "./icons.js";
import { keymap, label, normalizePath } from "./platform.js";
import { TestTree } from "./tests.js";

const MAX_NODES = 8000;
// Python tracebacks (`File "/path/x.py", line 12`) and pytest locations (`tests/test_x.py:12:`).
const LINK_RE = /File "([^"]+)", line (\d+)|((?:[A-Za-z]:)?[\w./\\-]*\.py):(\d+)(?=:)/g;

/**
 * The Run tool window. A run is one of:
 *   { kind: "script", interpreter, file, cwd }
 *   { kind: "tests", interpreter, targets, cwd, title }   — pytest, with the results tree
 *   { kind: "command", interpreter, args, cwd, title, next? } — e.g. pip install; `next` runs after success
 */
export class RunPanel {
  constructor(el, { results, onOpenLocation, onStateChange, onContextMenu }) {
    this.onOpenLocation = onOpenLocation;
    this.onStateChange = onStateChange;
    this.running = false;
    this.runId = 0;
    this.last = null;
    this.cwd = null;
    this.pending = { stdout: null, stderr: null }; // span holding an unfinished line per stream

    el.innerHTML = `
      <div class="run-side">
        <button class="icon-btn" data-act="rerun" title="Rerun  ${label(keymap.rerun)}">${icons.rerun}</button>
        <button class="icon-btn" data-act="stop" title="Stop  ${label(keymap.stop)}">${icons.stop}</button>
        <button class="icon-btn" data-act="clear" title="Clear All">${icons.clear}</button>
      </div>
      <div class="test-pane" style="display: none"></div>
      <div class="run-console" tabindex="0">
        <pre class="run-output"></pre>
        <pre class="run-output run-detail" style="display: none"></pre>
        <input class="run-stdin" spellcheck="false" autocomplete="off" placeholder="" />
      </div>`;
    this.out = el.querySelector(".run-output");
    this.detail = el.querySelector(".run-detail");
    this.testPane = el.querySelector(".test-pane");
    this.consoleEl = el.querySelector(".run-console");
    this.stdin = el.querySelector(".run-stdin");
    this.stopBtn = el.querySelector('[data-act="stop"]');
    this.tests = new TestTree(this.testPane, {
      results,
      onOpen: (file, line) => onOpenLocation(file, line),
      onRun: (targets, title) => this.last && this.run({ ...this.last, kind: "tests", targets, title }),
      onSelect: (test) => this.showDetail(test),
      onContextMenu,
    });

    el.querySelector('[data-act="rerun"]').addEventListener("click", () => this.rerun());
    this.stopBtn.addEventListener("click", () => this.stop());
    el.querySelector('[data-act="clear"]').addEventListener("click", () => this.clear());

    this.consoleEl.addEventListener("mouseup", () => {
      if (this.running && !window.getSelection()?.toString()) this.stdin.focus();
    });
    this.stdin.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const line = this.stdin.value;
      this.stdin.value = "";
      this.flushPending("stdout");
      this.append(line + "\n", "stdin");
      api.sendStdin(line + "\n").catch(() => {});
    });
    this.setRunning(false);
  }

  setRunning(running) {
    this.running = running;
    this.stopBtn.disabled = !running;
    this.stdin.style.display = running ? "" : "none";
    this.onStateChange?.(running);
  }

  clear() {
    this.out.replaceChildren();
    this.pending = { stdout: null, stderr: null };
  }

  commandLine(spec) {
    if (spec.kind === "script") return `${spec.interpreter} ${spec.file}`;
    if (spec.kind === "tests") return `${spec.interpreter} -m pytest ${spec.targets.join(" ")}`;
    return `${spec.interpreter} ${spec.args.join(" ")}`;
  }

  async run(spec) {
    this.last = spec.kind === "command" && spec.next ? spec.next : spec;
    const id = ++this.runId;
    const isTests = spec.kind === "tests";
    this.cwd = spec.cwd;
    this.clear();
    this.showDetail(null);
    this.testPane.style.display = isTests ? "" : "none";
    if (isTests) this.tests.begin(spec);
    this.append(this.commandLine(spec) + "\n", "meta");
    this.setRunning(true);

    let stderr = "";
    const channel = new Channel();
    channel.onmessage = (ev) => {
      if (id !== this.runId) return; // event from a run we already replaced
      if (ev.kind === "exit") {
        this.flushPending("stdout");
        this.flushPending("stderr");
        this.append(`\nProcess finished with exit code ${ev.code}\n`, "meta");
        this.setRunning(false);
        if (isTests) {
          this.tests.finish(ev.code);
          if (/No module named pytest/.test(stderr)) this.offerPytestInstall(spec);
        }
        if (spec.kind === "command" && spec.next && ev.code === 0) this.run(spec.next);
      } else {
        if (ev.kind === "stderr") stderr = (stderr + ev.data).slice(-4000);
        this.write(ev.data, ev.kind);
      }
    };
    try {
      if (isTests) {
        const testChannel = new Channel();
        testChannel.onmessage = (line) => id === this.runId && this.tests.handle(JSON.parse(line));
        await api.runTests(spec.interpreter, spec.targets, spec.cwd, channel, testChannel);
      } else {
        const args = spec.kind === "script" ? ["-u", spec.file] : spec.args;
        await api.runPython(spec.interpreter, args, spec.cwd, channel);
        requestAnimationFrame(() => this.stdin.focus());
      }
    } catch (err) {
      this.append(String(err) + "\n", "stderr");
      this.setRunning(false);
      if (isTests) this.tests.finish(-1);
    }
  }

  /** PyCharm offers to install a missing test framework; so do we. */
  offerPytestInstall(spec) {
    const a = document.createElement("a");
    a.className = "trace-link action";
    a.textContent = "Install pytest";
    a.addEventListener("click", () =>
      this.run({
        kind: "command",
        interpreter: spec.interpreter,
        args: ["-m", "pip", "install", "pytest"],
        cwd: spec.cwd,
        title: "Install pytest",
        next: spec,
      })
    );
    this.out.append(document.createTextNode("\npytest is not installed for this interpreter. "), a, document.createTextNode("\n"));
  }

  rerun() {
    if (this.last) this.run(this.last); // the backend stops a run that is still going
  }

  async stop() {
    if (this.running) await api.stopRun();
  }

  /** Shows one test's report instead of the whole console (null = back to the console). */
  showDetail(test) {
    this.detail.replaceChildren();
    this.out.style.display = test ? "none" : "";
    this.detail.style.display = test ? "" : "none";
    if (!test) return;
    this.append(`${test.name}\n\n`, "meta", false, this.detail);
    if (test.output) this.appendLinked(test.output + "\n", test.status === "failed" || test.status === "error" ? "stderr" : "stdout", this.detail);
    else this.append(test.status === "passed" ? "Test passed — no output.\n" : `Test ${test.status}.\n`, "meta", false, this.detail);
    this.consoleEl.scrollTop = 0;
  }

  /** Streams text; whole lines get links, a partial line (e.g. an input() prompt) shows immediately. */
  write(data, stream) {
    const stick = this.atBottom();
    let text = data;
    const prev = this.pending[stream];
    if (prev) {
      text = prev.textContent + text;
      prev.remove();
      this.pending[stream] = null;
    }
    const nl = text.lastIndexOf("\n");
    if (nl >= 0) this.appendLinked(text.slice(0, nl + 1), stream);
    const rest = text.slice(nl + 1);
    if (rest) this.pending[stream] = this.append(rest, stream, false);
    this.trim();
    if (stick) this.scrollToEnd();
  }

  flushPending(stream) {
    const span = this.pending[stream];
    if (span) {
      this.pending[stream] = null;
      const text = span.textContent;
      span.remove();
      this.appendLinked(text, stream);
    }
  }

  appendLinked(text, stream, target = this.out) {
    let last = 0;
    for (const m of text.matchAll(LINK_RE)) {
      if (m.index > last) this.append(text.slice(last, m.index), stream, false, target);
      const a = document.createElement("a");
      a.className = "trace-link";
      a.textContent = m[0];
      const file = this.resolve(m[1] ?? m[3]);
      const line = Number(m[2] ?? m[4]);
      a.addEventListener("click", () => this.onOpenLocation?.(file, line));
      target.append(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) this.append(text.slice(last), stream, false, target);
  }

  /** pytest prints paths relative to where it ran. */
  resolve(file) {
    const p = normalizePath(file);
    return /^(\/|[A-Za-z]:\/)/.test(p) || !this.cwd ? p : join(this.cwd, p);
  }

  append(text, cls, scroll = true, target = this.out) {
    const stick = scroll && this.atBottom();
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    target.append(span);
    if (stick) this.scrollToEnd();
    return span;
  }

  trim() {
    while (this.out.childNodes.length > MAX_NODES) this.out.firstChild.remove();
  }

  atBottom() {
    const c = this.consoleEl;
    return c.scrollHeight - c.scrollTop - c.clientHeight < 24;
  }

  scrollToEnd() {
    this.consoleEl.scrollTop = this.consoleEl.scrollHeight;
  }
}
