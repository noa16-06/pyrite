// Code insight: basedpyright (or pyright) over LSP for completion, hover docs, go to
// declaration, usages and rename; Ruff for lint warnings, Reformat Code and Optimize Imports.
import {
  LSPClient, LSPPlugin, Workspace, serverCompletion, hoverTooltips, signatureHelp,
  jumpToDefinition, findReferences, renameSymbol, showSignatureHelp,
} from "@codemirror/lsp-client";
import { setDiagnostics, nextDiagnostic, previousDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { api, Channel, basename } from "./api.js";
import { isMac, normalizePath } from "./platform.js";

const isPython = (path) => /\.(py|pyi|pyw)$/i.test(path ?? "");

export function pathToUri(path) {
  const p = path.startsWith("/") ? path : "/" + path; // C:/x → /C:/x
  return "file://" + p.split("/").map(encodeURIComponent).join("/").replace(/^\/([A-Za-z])%3A/, "/$1:");
}

export function uriToPath(uri) {
  let p = decodeURIComponent(new URL(uri).pathname);
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // /C:/x → C:/x
  return normalizePath(p);
}

// ------------------------------------------------------------ HTML sanitizer
// Hover docs are Markdown rendered to HTML. Docstrings come from any installed package, and
// this webview can reach the backend, so only plain formatting elements survive.
const ALLOWED = new Set("P PRE CODE EM STRONG B I A UL OL LI H1 H2 H3 H4 H5 H6 BR HR SPAN DIV BLOCKQUOTE TABLE THEAD TBODY TR TH TD DL DT DD".split(" "));

export function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const clean = (node) => {
    for (const child of [...node.children]) {
      if (!ALLOWED.has(child.tagName)) {
        child.replaceWith(...(child.tagName === "SCRIPT" || child.tagName === "STYLE" ? [] : child.childNodes));
        continue;
      }
      for (const attr of [...child.attributes]) {
        const keep = attr.name === "class" || (attr.name === "href" && /^https?:/i.test(attr.value));
        if (!keep) child.removeAttribute(attr.name);
      }
      clean(child);
    }
  };
  // Unwrapping can expose new disallowed children, so repeat until stable.
  let prev;
  do {
    prev = doc.body.innerHTML;
    clean(doc.body);
  } while (doc.body.innerHTML !== prev);
  return doc.body.innerHTML;
}

// ------------------------------------------------------------ transport
/** Bridges the LSP client to a server process run by the Rust backend. */
class TauriTransport {
  constructor({ onServerRequest, onExit }) {
    this.handlers = new Set();
    this.onServerRequest = onServerRequest;
    this.onExit = onExit;
    this.id = null;
    this.queue = Promise.resolve(); // keeps outgoing messages in order
  }

  async start(command, args, cwd, interpreter) {
    const channel = new Channel();
    channel.onmessage = (ev) => (ev.kind === "message" ? this.receive(ev.data) : this.exited(ev.stderr));
    this.id = await api.lspStart(command, args, cwd, interpreter ?? null, channel);
  }

  receive(data) {
    const msg = JSON.parse(data);
    // The client library answers every server→client request with "method not found";
    // pyright needs real answers (e.g. workspace/configuration), so they are handled here.
    if (msg.id != null && msg.method) {
      const result = this.onServerRequest(msg.method, msg.params);
      this.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: result ?? null }));
      return;
    }
    for (const h of this.handlers) h(data);
  }

  exited(stderr) {
    const id = this.id;
    this.id = null;
    if (id != null) this.onExit?.(stderr);
  }

  send(message) {
    if (this.id == null) throw new Error("Language server is not running");
    const id = this.id;
    this.queue = this.queue.then(() => api.lspSend(id, message)).catch(() => {});
  }

  subscribe(handler) {
    this.handlers.add(handler);
  }

  unsubscribe(handler) {
    this.handlers.delete(handler);
  }

  stop() {
    const id = this.id;
    this.id = null;
    if (id != null) api.lspStop(id).catch(() => {});
  }
}

// ------------------------------------------------------------ workspace
/**
 * Pyrite shows every tab in one EditorView and swaps its state, which destroys and recreates
 * the LSP plugin on each tab switch. This workspace keeps a file open on the server for as long
 * as its tab exists, and only attaches the view while that tab is the active one.
 */
class TabWorkspace extends Workspace {
  constructor(client, host) {
    super(client);
    this.host = host;
    this.files = [];
    this.versions = Object.create(null);
  }

  nextVersion(uri) {
    return (this.versions[uri] = (this.versions[uri] ?? -1) + 1);
  }

  syncFiles() {
    const result = [];
    for (const file of this.files) {
      const plugin = file.view && LSPPlugin.get(file.view);
      if (!plugin || plugin.uri !== file.uri || plugin.unsyncedChanges.empty) continue;
      result.push({ changes: plugin.unsyncedChanges, file, prevDoc: file.doc });
      file.doc = file.view.state.doc;
      file.version = this.nextVersion(file.uri);
      plugin.clear();
    }
    return result;
  }

  openFile(uri, languageId, view) {
    const existing = this.getFile(uri);
    if (!existing) {
      const file = { uri, languageId, version: this.nextVersion(uri), doc: view.state.doc, view, getView: () => file.view };
      this.files.push(file);
      this.client.didOpen(file);
      return;
    }
    existing.view = view;
    if (!existing.doc.eq(view.state.doc)) {
      // Changed while its tab was in the background (e.g. reloaded): resend the whole text.
      existing.doc = view.state.doc;
      existing.version = this.nextVersion(uri);
      this.client.notification("textDocument/didChange", {
        textDocument: { uri, version: existing.version },
        contentChanges: [{ text: existing.doc.toString() }],
      });
    }
  }

  closeFile(uri, view) {
    const file = this.getFile(uri);
    if (file && file.view === view) file.view = null; // tab switched away; stays open on the server
  }

  /** The tab was really closed. */
  forget(uri) {
    if (!this.getFile(uri)) return;
    this.files = this.files.filter((f) => f.uri !== uri);
    if (this.client.connected) this.client.didClose(uri);
  }

  async displayFile(uri) {
    await this.host.openFile(uriToPath(uri));
    return this.host.editor.view;
  }
}

// ------------------------------------------------------------ diagnostics
const LSP_SEVERITY = { 1: "error", 2: "warning", 3: "info", 4: "hint" };
// Pyright already reports these; showing Ruff's copy too would double every message.
const RUFF_DUPLICATES = new Set(["F821", "F822", "F823", "invalid-syntax", "E999"]);

function toOffset(doc, line, ch) {
  if (line >= doc.lines) return doc.length;
  const l = doc.line(line + 1);
  return Math.min(l.from + Math.max(0, ch), l.to);
}

export class Intelligence {
  constructor({ editor, openFile, toast, statusEl, problemsEl, bannerEl }) {
    this.editor = editor;
    this.openFile = openFile;
    this.toast = toast;
    this.statusEl = statusEl;
    this.problemsEl = problemsEl;
    this.bannerEl = bannerEl;
    this.tools = null; // { language_server, ruff, tools_dir }
    this.client = null;
    this.transport = null;
    this.root = null;
    this.interpreter = null;
    this.diagnostics = new Map(); // path -> { lsp: [], ruff: [] }
    this.ruffTimer = null;
    this.syncTimer = null;
    this.generation = 0; // invalidates async work from a previous project/interpreter
    this.installing = false;
    statusEl.addEventListener("click", () => this.statusMenu());
    problemsEl.addEventListener("click", () => this.nextProblem());
  }

  // ---------------------------------------------------------- lifecycle
  async start(root, interpreter) {
    this.stop();
    const gen = ++this.generation;
    this.root = root;
    this.interpreter = interpreter;
    this.tools = await api.toolsStatus().catch(() => null);
    if (gen !== this.generation) return;
    this.renderBanner();
    if (this.tools?.language_server) await this.startServer(gen);
    else this.setStatus(this.tools?.ruff ? "Ruff only" : "No code insight", "Code insight tools are not installed — click to install", "warn");
    this.editor.reconfigureIntel();
    this.lintActive();
  }

  async startServer(gen) {
    const command = this.tools.language_server;
    const name = basename(command).replace(/(-langserver)?(\.exe)?$/, "");
    this.setStatus(`${name}…`, "Starting the language server");
    const transport = new TauriTransport({
      onServerRequest: (method, params) => this.serverRequest(method, params),
      onExit: (stderr) => {
        if (gen !== this.generation) return;
        this.client?.disconnect();
        this.client = null;
        this.editor.reconfigureIntel();
        this.setStatus(`${name} stopped`, stderr || "The language server exited", "error");
      },
    });
    try {
      await transport.start(command, ["--stdio"], this.root, this.interpreter?.path);
    } catch (err) {
      this.setStatus(`${name} failed`, String(err), "error");
      return;
    }
    if (gen !== this.generation) return transport.stop();
    this.transport = transport;
    this.client = new LSPClient({
      rootUri: pathToUri(this.root),
      timeout: 10000,
      sanitizeHTML,
      workspace: (client) => new TabWorkspace(client, this),
      extensions: [
        serverCompletion({ override: true }),
        hoverTooltips({ hoverTime: 500 }),
        signatureHelp({ keymap: false }),
        {
          clientCapabilities: {
            workspace: { configuration: true },
            textDocument: { publishDiagnostics: { tagSupport: { valueSet: [1, 2] } } },
          },
          notificationHandlers: {
            "textDocument/publishDiagnostics": (_client, params) => {
              this.setLspDiagnostics(uriToPath(params.uri), params.diagnostics);
              return true;
            },
          },
        },
      ],
    }).connect(transport);
    try {
      await this.client.initializing;
      if (gen !== this.generation) return;
      this.client.notification("workspace/didChangeConfiguration", { settings: {} });
      this.setStatus(name, `${name}: ${command}`, "ok");
    } catch (err) {
      this.setStatus(`${name} failed`, err?.message ?? String(err), "error");
    }
  }

  stop() {
    this.generation++;
    clearTimeout(this.ruffTimer);
    clearTimeout(this.syncTimer);
    this.client?.disconnect();
    this.transport?.stop();
    this.client = null;
    this.transport = null;
    this.diagnostics.clear();
    this.renderProblems();
  }

  restart(interpreter) {
    if (this.root) this.start(this.root, interpreter);
  }

  /** Answers requests the server sends to the client. */
  serverRequest(method, params) {
    if (method !== "workspace/configuration") return null;
    // "standard" matches what PyCharm flags; basedpyright's own default is far stricter.
    const analysis = { typeCheckingMode: "standard", diagnosticMode: "openFilesOnly", autoImportCompletions: true };
    // pyright reads python.analysis; basedpyright asks for "basedpyright" with analysis nested inside.
    const sections = {
      python: { pythonPath: this.interpreter?.path, analysis },
      "python.analysis": analysis,
      basedpyright: { analysis },
      "basedpyright.analysis": analysis,
    };
    return params.items.map(({ section }) => sections[section] ?? {});
  }

  // ---------------------------------------------------------- editor hooks
  /** Extensions for a tab's editor state; empty when no server runs or the file isn't Python. */
  extension(path) {
    if (!this.client || !isPython(path)) return [];
    return [
      this.client.plugin(pathToUri(path), "python"),
      EditorView.domEventHandlers({
        // ⌘-click (Ctrl-click elsewhere) goes to the declaration, like PyCharm.
        mousedown: (e, view) => {
          if (e.button !== 0 || !(isMac ? e.metaKey : e.ctrlKey)) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos == null) return false;
          view.dispatch({ selection: { anchor: pos } });
          jumpToDefinition(view);
          e.preventDefault();
          return true;
        },
      }),
    ];
  }

  /** Called before the editor swaps tabs, so edits reach the server first. */
  sync() {
    if (this.client?.connected) this.client.sync();
  }

  activated(path) {
    this.applyDiagnostics(path);
    this.lintActive();
  }

  changed(path) {
    if (path !== this.editor.active || !isPython(path)) return;
    // Push edits to the server shortly after typing stops, so its diagnostics stay fresh.
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.sync(), 400);
    if (!this.tools?.ruff) return;
    clearTimeout(this.ruffTimer);
    this.ruffTimer = setTimeout(() => this.lintActive(), 350);
  }

  closed(path) {
    this.client?.workspace.forget(pathToUri(path));
    this.diagnostics.delete(path);
  }

  /** `paths` are the old paths of tabs whose file (or folder) was renamed. */
  renamed(paths) {
    for (const p of paths) this.closed(p);
    this.editor.reconfigureIntel();
  }

  // ---------------------------------------------------------- diagnostics
  entry(path) {
    let e = this.diagnostics.get(path);
    if (!e) this.diagnostics.set(path, (e = { lsp: [], ruff: [] }));
    return e;
  }

  setLspDiagnostics(path, list) {
    this.entry(path).lsp = list.map((d) => ({
      start: d.range.start,
      end: d.range.end,
      severity: d.tags?.includes(1) ? "hint" : LSP_SEVERITY[d.severity] ?? "error",
      markClass: d.tags?.includes(1) ? "cm-unnecessary" : d.tags?.includes(2) ? "cm-deprecated" : undefined,
      message: d.message,
      source: d.code ? `${d.source} (${d.code})` : d.source,
    }));
    this.applyDiagnostics(path);
  }

  async lintActive() {
    const path = this.editor.active;
    const ruff = this.tools?.ruff;
    if (!ruff || !isPython(path)) return this.renderProblems();
    const gen = this.generation;
    const text = this.editor.view.state.doc.toString();
    let items;
    try {
      items = JSON.parse(await api.ruffCheck(ruff, path, this.root ?? path, text));
    } catch {
      return; // e.g. an invalid ruff config — the language server still reports errors
    }
    if (gen !== this.generation) return;
    const lsp = !!this.client;
    this.entry(path).ruff = items
      .filter((d) => !(lsp && (d.code == null || RUFF_DUPLICATES.has(d.code))))
      .map((d) => ({
        // Ruff counts rows and columns from 1.
        start: { line: d.location.row - 1, character: d.location.column - 1 },
        end: { line: d.end_location.row - 1, character: d.end_location.column - 1 },
        severity: d.code == null || d.code === "invalid-syntax" ? "error" : "warning",
        message: d.message,
        source: d.code ? `Ruff (${d.code})` : "Ruff",
      }));
    this.applyDiagnostics(path);
  }

  applyDiagnostics(path) {
    if (path && path === this.editor.active) {
      const view = this.editor.view;
      const doc = view.state.doc;
      const { lsp = [], ruff = [] } = this.diagnostics.get(path) ?? {};
      const list = [...lsp, ...ruff].map((d) => {
        const from = toOffset(doc, d.start.line, d.start.character);
        const to = Math.max(from, toOffset(doc, d.end.line, d.end.character));
        return { from, to, severity: d.severity, message: d.message, source: d.source, markClass: d.markClass };
      });
      view.dispatch(setDiagnostics(view.state, list));
    }
    this.renderProblems();
  }

  /** PyCharm's inspection widget: error/warning counts for the current file. */
  renderProblems() {
    const path = this.editor.active;
    const el = this.problemsEl;
    const { lsp = [], ruff = [] } = (path && this.diagnostics.get(path)) ?? {};
    const all = [...lsp, ...ruff];
    const errors = all.filter((d) => d.severity === "error").length;
    const warnings = all.filter((d) => d.severity === "warning").length;
    const active = !!path && isPython(path) && (!!this.client || !!this.tools?.ruff);
    el.style.display = active ? "" : "none";
    el.replaceChildren();
    if (!active) return;
    const add = (cls, text) => el.append(Object.assign(document.createElement("span"), { className: cls, textContent: text }));
    if (errors) add("err", `● ${errors}`);
    if (warnings) add("warn", `▲ ${warnings}`);
    if (!errors && !warnings) add("ok", "✓");
    el.title = errors || warnings ? `${errors} errors, ${warnings} warnings — click or F2 for the next problem` : "No problems found";
  }

  nextProblem(back = false) {
    if (!this.editor.active) return;
    (back ? previousDiagnostic : nextDiagnostic)(this.editor.view);
    this.editor.view.focus();
  }

  // ---------------------------------------------------------- actions
  needsServer() {
    if (this.client && isPython(this.editor.active)) return true;
    if (isPython(this.editor.active)) this.toast("Code insight is not running — install the tools from the status bar.", "info");
    return false;
  }

  goToDeclaration() {
    if (this.needsServer()) jumpToDefinition(this.editor.view);
  }

  findUsages() {
    if (this.needsServer()) findReferences(this.editor.view);
  }

  rename() {
    if (this.needsServer()) renameSymbol(this.editor.view);
  }

  parameterInfo() {
    if (this.needsServer()) showSignatureHelp(this.editor.view);
  }

  async reformat() {
    await this.ruffRewrite(api.ruffFormat, "Reformat Code");
  }

  async optimizeImports() {
    await this.ruffRewrite(api.ruffOptimizeImports, "Optimize Imports");
  }

  async ruffRewrite(fn, title) {
    const path = this.editor.active;
    if (!isPython(path)) return;
    if (!this.tools?.ruff) return this.toast(`${title} needs Ruff — install the code tools from the status bar.`, "info");
    const before = this.editor.view.state.doc.toString();
    try {
      const after = await fn(this.tools.ruff, path, this.root ?? path, before);
      if (this.editor.active === path && this.editor.view.state.doc.toString() === before) this.editor.replaceText(after);
    } catch (err) {
      this.toast(`${title}: ${err}`, "error");
    }
  }

  // ---------------------------------------------------------- tools
  setStatus(text, title, kind = "") {
    this.statusEl.textContent = text;
    this.statusEl.title = title ?? "";
    this.statusEl.className = kind;
  }

  statusMenu() {
    if (!this.root || this.installing) return;
    if (!this.tools?.language_server || !this.tools?.ruff) this.install();
    else this.restart(this.interpreter);
  }

  renderBanner() {
    const el = this.bannerEl;
    const missing = this.tools && (!this.tools.language_server || !this.tools.ruff);
    let dismissed = false;
    try {
      dismissed = localStorage.getItem("pyrite.toolsBannerDismissed") === "1";
    } catch {}
    el.style.display = missing && !dismissed && !this.installing ? "" : "none";
  }

  dismissBanner() {
    try {
      localStorage.setItem("pyrite.toolsBannerDismissed", "1");
    } catch {}
    this.renderBanner();
  }

  async install() {
    if (this.installing) return;
    this.installing = true;
    this.renderBanner();
    this.setStatus("Installing code tools…", "Installing basedpyright and Ruff");
    const log = [];
    const channel = new Channel();
    channel.onmessage = (ev) => {
      log.push(ev.data);
      const line = log.join("").trim().split("\n").pop() ?? "";
      this.statusEl.title = line;
    };
    try {
      this.tools = await api.toolsInstall(channel);
      this.installing = false;
      this.toast("Code insight tools installed.", "info");
      if (this.root) await this.start(this.root, this.interpreter);
    } catch (err) {
      this.installing = false;
      console.error(log.join(""));
      const tail = log.join("").trim().split("\n").slice(-3).join("\n");
      this.toast(`Installing the code tools failed: ${err}${tail ? "\n" + tail : ""}`, "error");
      this.setStatus("Install failed", "Click to try again", "error");
      this.renderBanner();
    }
  }
}
