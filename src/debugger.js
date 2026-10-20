// Python debugger: a Debug Adapter Protocol client for debugpy, and the Debug pane
// (controls, frames, variables, evaluate) shown in the Run tool window while debugging.
import { api, Channel, basename } from "./api.js";
import { icons } from "./icons.js";
import { isWindows, keymap, label, normalizePath } from "./platform.js";

const toNative = (path) => (isWindows ? path.replace(/\//g, "\\") : path);

/** Minimal DAP client over the backend's TCP bridge. */
class DapClient {
  constructor({ onEvent, onClose }) {
    this.onEvent = onEvent;
    this.onClose = onClose;
    this.seq = 1;
    this.pending = new Map();
    this.id = null;
    this.queue = Promise.resolve(); // keeps outgoing messages in order
  }

  async connect(port) {
    const channel = new Channel();
    channel.onmessage = (ev) => (ev.kind === "message" ? this.receive(JSON.parse(ev.data)) : this.closed());
    this.id = await api.dapConnect(port, channel);
  }

  request(command, args = {}) {
    if (this.id == null) return Promise.reject(new Error("The debug session has ended"));
    const seq = this.seq++;
    const id = this.id;
    const message = JSON.stringify({ seq, type: "request", command, arguments: args });
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      this.queue = this.queue.then(() => api.dapSend(id, message)).catch((err) => {
        this.pending.delete(seq);
        reject(err);
      });
    });
  }

  receive(msg) {
    if (msg.type === "response") {
      const p = this.pending.get(msg.request_seq);
      this.pending.delete(msg.request_seq);
      if (!p) return;
      msg.success ? p.resolve(msg.body ?? {}) : p.reject(new Error(msg.message || `${msg.command} failed`));
    } else if (msg.type === "event") {
      this.onEvent(msg.event, msg.body ?? {});
    } else if (msg.type === "request") {
      // Reverse requests (e.g. runInTerminal) aren't needed: the program already runs in the Run window.
      const reply = { seq: this.seq++, type: "response", request_seq: msg.seq, command: msg.command, success: false, message: "not supported" };
      this.queue = this.queue.then(() => api.dapSend(this.id, JSON.stringify(reply))).catch(() => {});
    }
  }

  closed() {
    if (this.id == null) return;
    this.id = null;
    for (const p of this.pending.values()) p.reject(new Error("The debug session has ended"));
    this.pending.clear();
    this.onClose();
  }

  close() {
    const id = this.id;
    this.closed();
    if (id != null) api.dapClose(id).catch(() => {});
  }
}

/** One debug session at a time, attached to `python debugpy --listen … script.py`. */
export class Debugger {
  constructor(el, { breakpoints, openFile, refreshEditor, onStateChange }) {
    this.breakpoints = breakpoints;
    this.openFile = openFile; // (path, line) => Promise
    this.refreshEditor = refreshEditor; // re-draws breakpoint/execution markers
    this.onStateChange = onStateChange; // (state) => void
    this.client = null;
    this.state = "idle"; // idle | connecting | running | paused | ended
    this.threadId = null;
    this.frames = [];
    this.frameId = null;
    this.expanded = new Set();
    this.children = new Map(); // variablesReference -> variables (valid until the next resume)
    this.evaluations = [];
    this.exception = null;
    this.configured = false; // breakpoint changes are sent live only after configurationDone

    el.innerHTML = `
      <div class="debug-header">
        <button class="icon-btn" data-act="resume">${icons.resume}</button>
        <button class="icon-btn" data-act="pause">${icons.pause}</button>
        <span class="sep"></span>
        <button class="icon-btn" data-act="stepOver">${icons.stepOver}</button>
        <button class="icon-btn" data-act="stepInto">${icons.stepInto}</button>
        <button class="icon-btn" data-act="stepOut">${icons.stepOut}</button>
        <span class="debug-status"></span>
      </div>
      <div class="debug-body">
        <div class="debug-col frames-col">
          <div class="debug-section-title">Frames</div>
          <div class="debug-frames" tabindex="0"></div>
        </div>
        <div class="debug-col vars-col">
          <div class="debug-section-title">Variables</div>
          <input class="debug-eval" spellcheck="false" autocomplete="off" placeholder="Evaluate expression (Enter)" />
          <div class="debug-vars" tabindex="0"></div>
        </div>
      </div>`;
    this.statusEl = el.querySelector(".debug-status");
    this.framesEl = el.querySelector(".debug-frames");
    this.varsEl = el.querySelector(".debug-vars");
    this.evalEl = el.querySelector(".debug-eval");
    const titles = { resume: "Resume Program", pause: "Pause Program", stepOver: "Step Over", stepInto: "Step Into", stepOut: "Step Out" };
    this.buttons = {};
    for (const [act, title] of Object.entries(titles)) {
      const b = el.querySelector(`[data-act="${act}"]`);
      b.title = keymap[act] ? `${title}  ${label(keymap[act])}` : title;
      b.addEventListener("click", () => this[act]());
      this.buttons[act] = b;
    }
    this.evalEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.evalEl.value.trim()) this.evaluate(this.evalEl.value.trim());
      e.stopPropagation(); // keep F8 & co. from firing while typing
    });
    this.render();
  }

  get active() {
    return this.state === "connecting" || this.state === "running" || this.state === "paused";
  }

  setState(state, status) {
    this.state = state;
    this.status = status;
    this.render();
    this.onStateChange?.(state);
  }

  // ---------------------------------------------------------- session
  async start(port) {
    this.end(); // a previous session, if any
    this.reset();
    this.setState("connecting", "Connecting to the debugger…");
    const client = new DapClient({
      onEvent: (event, body) => client === this.client && this.handleEvent(event, body),
      onClose: () => client === this.client && this.finish(),
    });
    this.client = client;
    try {
      await client.connect(port);
      await client.request("initialize", {
        clientID: "pyrite",
        clientName: "Pyrite",
        adapterID: "python",
        linesStartAt1: true,
        columnsStartAt1: true,
        pathFormat: "path",
        supportsVariableType: true,
      });
      const initialized = new Promise((resolve) => (this.onInitialized = resolve));
      // debugpy answers `attach` only after configurationDone, so don't wait for it here.
      const attached = client.request("attach", { justMyCode: true, subProcess: false });
      await initialized;
      await Promise.all(this.breakpoints.paths().map((p) => this.sendBreakpoints(p, true)));
      await client.request("setExceptionBreakpoints", { filters: ["uncaught"] });
      await client.request("configurationDone");
      this.configured = true;
      await attached;
      if (this.state === "connecting") this.setState("running", "Running");
    } catch (err) {
      if (client === this.client) this.setState("ended", String(err.message ?? err));
    }
  }

  reset() {
    this.threadId = null;
    this.frames = [];
    this.frameId = null;
    this.scopes = [];
    this.expanded = new Set();
    this.children = new Map();
    this.evaluations = [];
    this.exception = null;
    this.configured = false;
  }

  /** The program exited or the connection closed. */
  finish(code) {
    if (!this.client && this.state === "ended") return;
    this.client?.close();
    this.client = null;
    this.reset();
    this.setExecution(null);
    this.setState("ended", code != null ? `Finished (exit code ${code})` : "Disconnected");
  }

  /** Called when the debugged process is gone (stop, crash or normal exit). */
  end(code) {
    if (this.client || this.active) this.finish(code);
    else if (code != null && this.state === "ended") {
      // The debug connection usually closes just before the exit code arrives.
      this.status = `Finished (exit code ${code})`;
      this.render();
    }
  }

  /** Sends a file's breakpoints; called again whenever they change during a session. */
  async sendBreakpoints(path, force = false) {
    if (!this.client || !(this.configured || force)) return;
    const lines = this.breakpoints.lines(path);
    try {
      await this.client.request("setBreakpoints", {
        source: { path: toNative(path), name: basename(path) },
        breakpoints: lines.map((line) => ({ line })),
      });
    } catch {
      /* session ended meanwhile */
    }
  }

  handleEvent(event, body) {
    switch (event) {
      case "initialized":
        this.onInitialized?.();
        break;
      case "stopped":
        this.paused(body);
        break;
      case "continued":
        if (body.allThreadsContinued !== false || body.threadId === this.threadId) this.resumed();
        break;
      case "terminated":
        // Let debugpy exit: it waits for the client to disconnect.
        this.client?.request("disconnect", {}).catch(() => {});
        break;
    }
  }

  async paused(body) {
    this.threadId = body.threadId;
    this.children = new Map();
    this.exception = null;
    if (body.reason === "exception") {
      try {
        const info = await this.client.request("exceptionInfo", { threadId: body.threadId });
        const type = (info.exceptionId ?? "").replace(/^builtins\./, "");
        this.exception = [type, info.description].filter(Boolean).join(": ") || "Exception";
      } catch {
        this.exception = body.text || "Exception";
      }
    }
    try {
      const { stackFrames } = await this.client.request("stackTrace", { threadId: body.threadId, levels: 50 });
      this.frames = stackFrames;
    } catch {
      this.frames = [];
    }
    const top = this.frames[0];
    const where = top ? ` at ${top.name} (${basename(top.source?.path ?? "?")}:${top.line})` : "";
    this.setState("paused", (this.exception ? "Exception" : "Paused") + where);
    if (top) await this.selectFrame(top, true);
  }

  resumed() {
    this.frames = [];
    this.frameId = null;
    this.scopes = [];
    this.children = new Map();
    this.exception = null;
    this.setExecution(null);
    if (this.active) this.setState("running", "Running");
  }

  async selectFrame(frame, reveal = true) {
    this.frameId = frame.id;
    const path = frame.source?.path ? normalizePath(frame.source.path) : null;
    if (path && reveal) {
      this.setExecution({ path, line: frame.line });
      await this.openFile(path, frame.line);
    }
    try {
      const { scopes } = await this.client.request("scopes", { frameId: frame.id });
      this.scopes = scopes;
      // Locals open, like PyCharm; globals and the rest stay collapsed.
      this.expanded = new Set(scopes.filter((s) => !s.expensive && /local/i.test(s.name)).map((s) => s.variablesReference));
      await Promise.all([...this.expanded].map((ref) => this.loadChildren(ref)));
    } catch {
      this.scopes = [];
    }
    this.render();
  }

  setExecution(position) {
    this.breakpoints.execution = position;
    this.refreshEditor();
  }

  async loadChildren(ref) {
    if (this.children.has(ref)) return this.children.get(ref);
    const { variables } = await this.client.request("variables", { variablesReference: ref });
    this.children.set(ref, variables);
    return variables;
  }

  // ---------------------------------------------------------- commands
  canStep() {
    return this.state === "paused" && this.client && this.threadId != null;
  }

  resume() {
    if (this.canStep()) this.client.request("continue", { threadId: this.threadId }).catch(() => {});
  }

  stepOver() {
    if (this.canStep()) this.client.request("next", { threadId: this.threadId }).catch(() => {});
  }

  stepInto() {
    if (this.canStep()) this.client.request("stepIn", { threadId: this.threadId }).catch(() => {});
  }

  stepOut() {
    if (this.canStep()) this.client.request("stepOut", { threadId: this.threadId }).catch(() => {});
  }

  async pause() {
    if (this.state !== "running" || !this.client) return;
    try {
      const { threads } = await this.client.request("threads");
      await this.client.request("pause", { threadId: threads[0]?.id ?? 1 });
    } catch {
      /* already stopped */
    }
  }

  focusEvaluate() {
    if (this.state === "paused") this.evalEl.focus();
  }

  async evaluate(expression) {
    if (!this.canStep()) return;
    let entry;
    try {
      const r = await this.client.request("evaluate", { expression, frameId: this.frameId, context: "repl" });
      entry = { name: expression, value: r.result, type: r.type, variablesReference: r.variablesReference ?? 0 };
    } catch (err) {
      entry = { name: expression, value: err.message, error: true, variablesReference: 0 };
    }
    this.evaluations = [entry, ...this.evaluations.filter((e) => e.name !== expression)].slice(0, 10);
    this.evalEl.value = "";
    this.render();
  }

  // ---------------------------------------------------------- view
  render() {
    this.statusEl.textContent = this.status ?? "";
    this.statusEl.className = "debug-status " + this.state + (this.exception ? " exception" : "");
    const paused = this.state === "paused";
    for (const act of ["stepOver", "stepInto", "stepOut", "resume"]) this.buttons[act].disabled = !paused;
    this.buttons.pause.disabled = this.state !== "running";
    this.evalEl.disabled = !paused;
    this.renderFrames();
    this.renderVariables();
  }

  renderFrames() {
    if (!this.frames.length) {
      const empty = document.createElement("div");
      empty.className = "debug-empty";
      empty.textContent = this.state === "running" ? "The program is running" : this.state === "paused" ? "No frames" : "Not paused";
      this.framesEl.replaceChildren(empty);
      return;
    }
    this.framesEl.replaceChildren(
      ...this.frames.map((frame) => {
        const row = document.createElement("div");
        row.className = "debug-row frame" + (frame.id === this.frameId ? " selected" : "");
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = frame.name;
        const where = document.createElement("span");
        where.className = "hint";
        where.textContent = frame.source?.path ? `${basename(frame.source.path)}:${frame.line}` : "";
        row.append(name, where);
        row.addEventListener("click", () => this.selectFrame(frame));
        return row;
      })
    );
  }

  renderVariables() {
    const rows = [];
    if (this.exception) rows.push(this.varRow({ name: "Exception", value: this.exception, error: true, variablesReference: 0 }, 0, "exc"));
    for (const e of this.evaluations) this.pushVar(rows, { ...e, evaluated: true }, 0, "eval:" + e.name);
    for (const scope of this.scopes ?? []) {
      this.pushVar(rows, { name: scope.name, variablesReference: scope.variablesReference, scope: true }, 0, "scope:" + scope.name);
    }
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "debug-empty";
      empty.textContent = this.state === "paused" ? "No variables" : "Variables appear when the program is paused";
      rows.push(empty);
    }
    this.varsEl.replaceChildren(...rows);
  }

  pushVar(rows, v, depth, key) {
    rows.push(this.varRow(v, depth, key));
    if (v.variablesReference && this.expanded.has(v.variablesReference)) {
      const kids = this.children.get(v.variablesReference);
      if (!kids) return;
      for (const child of kids) this.pushVar(rows, child, depth + 1, key + "/" + child.name);
    }
  }

  varRow(v, depth, key) {
    const row = document.createElement("div");
    row.className = "debug-row var" + (v.scope ? " scope" : "") + (v.error ? " error" : "") + (v.evaluated ? " evaluated" : "");
    row.style.paddingLeft = `${6 + depth * 16}px`;
    row.dataset.key = key;
    const expandable = v.variablesReference > 0;
    const open = expandable && this.expanded.has(v.variablesReference);
    row.innerHTML = `<span class="chev">${expandable ? (open ? icons.chevronDown : icons.chevronRight) : ""}</span>`;
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = v.name;
    row.append(name);
    // Groups like "special variables" have no value of their own.
    if (!v.scope && (v.value || !expandable)) {
      const eq = document.createElement("span");
      eq.className = "eq";
      eq.textContent = " = ";
      const type = document.createElement("span");
      type.className = "type";
      type.textContent = v.type ? `{${v.type}} ` : "";
      const value = document.createElement("span");
      value.className = "value";
      value.textContent = v.value ?? "";
      value.title = v.value ?? "";
      row.append(eq, type, value);
    }
    if (expandable) {
      row.addEventListener("click", async () => {
        if (this.expanded.has(v.variablesReference)) this.expanded.delete(v.variablesReference);
        else {
          this.expanded.add(v.variablesReference);
          try {
            await this.loadChildren(v.variablesReference);
          } catch {
            this.expanded.delete(v.variablesReference);
          }
        }
        this.renderVariables();
      });
    }
    return row;
  }
}
