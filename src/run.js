import { api, Channel } from "./api.js";
import { icons } from "./icons.js";

const MAX_NODES = 8000;
// `File "/path/x.py", line 12` in Python tracebacks.
const TRACE_RE = /File "([^"]+)", line (\d+)/g;

export class RunPanel {
  constructor(el, { onOpenLocation, onStateChange }) {
    this.onOpenLocation = onOpenLocation;
    this.onStateChange = onStateChange;
    this.running = false;
    this.runId = 0;
    this.last = null;
    this.pending = { stdout: null, stderr: null }; // span holding an unfinished line per stream

    el.innerHTML = `
      <div class="run-side">
        <button class="icon-btn" data-act="rerun" title="Rerun  ⌃R">${icons.rerun}</button>
        <button class="icon-btn" data-act="stop" title="Stop  ⌘F2">${icons.stop}</button>
        <button class="icon-btn" data-act="clear" title="Clear All">${icons.clear}</button>
      </div>
      <div class="run-console" tabindex="0">
        <pre class="run-output"></pre>
        <input class="run-stdin" spellcheck="false" autocomplete="off" placeholder="" />
      </div>`;
    this.out = el.querySelector(".run-output");
    this.consoleEl = el.querySelector(".run-console");
    this.stdin = el.querySelector(".run-stdin");
    this.stopBtn = el.querySelector('[data-act="stop"]');

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

  async run({ interpreter, file, cwd }) {
    this.last = { interpreter, file, cwd };
    const id = ++this.runId;
    this.clear();
    this.append(`${interpreter} ${file}\n`, "meta");
    this.setRunning(true);

    const channel = new Channel();
    channel.onmessage = (ev) => {
      if (id !== this.runId) return; // event from a run we already replaced
      if (ev.kind === "exit") {
        this.flushPending("stdout");
        this.flushPending("stderr");
        this.append(`\nProcess finished with exit code ${ev.code}\n`, "meta");
        this.setRunning(false);
      } else {
        this.write(ev.data, ev.kind);
      }
    };
    try {
      await api.runPython(interpreter, file, cwd, channel);
      requestAnimationFrame(() => this.stdin.focus());
    } catch (err) {
      this.append(String(err) + "\n", "stderr");
      this.setRunning(false);
    }
  }

  rerun() {
    if (this.last) this.run(this.last);
  }

  async stop() {
    if (this.running) await api.stopRun();
  }

  /** Streams text; whole lines get traceback links, a partial line (e.g. an input() prompt) shows immediately. */
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

  appendLinked(text, stream) {
    let last = 0;
    for (const m of text.matchAll(TRACE_RE)) {
      if (m.index > last) this.append(text.slice(last, m.index), stream, false);
      const a = document.createElement("a");
      a.className = "trace-link";
      a.textContent = m[0];
      const [, file, line] = m;
      a.addEventListener("click", () => this.onOpenLocation?.(file, Number(line)));
      this.out.append(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) this.append(text.slice(last), stream, false);
  }

  append(text, cls, scroll = true) {
    const stick = scroll && this.atBottom();
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    this.out.append(span);
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
