import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, Channel } from "./api.js";
import { icons } from "./icons.js";

// ANSI palettes from PyCharm's Dark and Light (Default) console schemes.
const DARK = {
  background: "#1E1F22",
  foreground: "#BCBEC4",
  cursor: "#CED0D6",
  cursorAccent: "#1E1F22",
  selectionBackground: "#214283",
  black: "#1E1F22",
  red: "#F0524F",
  green: "#5C962C",
  yellow: "#A68A0D",
  blue: "#3993D4",
  magenta: "#A771BF",
  cyan: "#00A3A3",
  white: "#808080",
  brightBlack: "#595959",
  brightRed: "#FF4050",
  brightGreen: "#4FC414",
  brightYellow: "#E5BF00",
  brightBlue: "#1FB0FF",
  brightMagenta: "#ED7EED",
  brightCyan: "#00E5E5",
  brightWhite: "#FFFFFF",
};

const LIGHT = {
  background: "#FFFFFF",
  foreground: "#000000",
  cursor: "#000000",
  cursorAccent: "#FFFFFF",
  selectionBackground: "#A6D2FF",
  black: "#000000",
  red: "#CE0505",
  green: "#067D17",
  yellow: "#B28C00",
  blue: "#063FDB",
  magenta: "#B309B3",
  cyan: "#028E8E",
  white: "#929292",
  brightBlack: "#656565",
  brightRed: "#FF1616",
  brightGreen: "#16B42C",
  brightYellow: "#ECC32C",
  brightBlue: "#2D61F0",
  brightMagenta: "#E617E6",
  brightCyan: "#15C1C1",
  brightWhite: "#C9C9C9",
};

export class TerminalPanel {
  constructor(el, { getContext }) {
    this.getContext = getContext; // () => ({ cwd, venv })
    this.sessions = [];
    this.active = null;
    this.counter = 0;
    this.theme = DARK;

    el.innerHTML = `<div class="term-tabs"><div class="term-tab-list"></div><button class="icon-btn term-new" title="New Tab">${icons.plus}</button></div><div class="term-body"></div>`;
    this.tabList = el.querySelector(".term-tab-list");
    this.body = el.querySelector(".term-body");
    el.querySelector(".term-new").addEventListener("click", () => this.create());

    new ResizeObserver(() => this.fit()).observe(this.body);
  }

  /** Switches every terminal between PyCharm's dark and light console colors. */
  setTheme(light) {
    this.theme = light ? LIGHT : DARK;
    for (const s of this.sessions) s.term.options.theme = this.theme;
  }

  /** Makes sure at least one terminal exists (opened lazily, like PyCharm). */
  ensure() {
    if (!this.sessions.length) return this.create();
    this.fit();
    this.active?.term.focus();
  }

  async create() {
    const { cwd, venv } = this.getContext();
    const container = document.createElement("div");
    container.className = "term-container";
    this.body.append(container);

    const term = new Terminal({
      theme: this.theme,
      fontFamily: "'JetBrains Mono', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      macOptionIsMeta: false, // keep ⌥ for characters like @ { [ on non-US layouts
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    const session = { id: null, term, fit, container, name: this.nextName(), exited: false };
    this.sessions.push(session);
    this.activate(session);
    fit.fit();

    const channel = new Channel();
    channel.onmessage = (ev) => {
      if (ev.kind === "data") term.write(ev.data);
      else {
        session.exited = true;
        term.write("\r\n\x1b[90m[Process completed — press any key to close]\x1b[0m");
      }
    };
    term.onData((data) => {
      if (session.exited) return this.close(session);
      if (session.id != null) api.termWrite(session.id, data).catch(() => {});
    });
    term.onResize(({ cols, rows }) => {
      if (session.id != null) api.termResize(session.id, cols, rows).catch(() => {});
    });

    try {
      session.id = await api.termSpawn(cwd, term.cols, term.rows, venv ?? null, channel);
    } catch (err) {
      term.write(`\x1b[31mCould not start shell: ${err}\x1b[0m\r\n`);
    }
    term.focus();
  }

  nextName() {
    this.counter += 1;
    return this.counter === 1 ? "Local" : `Local (${this.counter})`;
  }

  activate(session) {
    this.active = session;
    for (const s of this.sessions) s.container.style.display = s === session ? "" : "none";
    this.renderTabs();
    requestAnimationFrame(() => {
      this.fit();
      session.term.focus();
    });
  }

  close(session) {
    if (session.id != null) api.termKill(session.id).catch(() => {});
    session.term.dispose();
    session.container.remove();
    const idx = this.sessions.indexOf(session);
    this.sessions.splice(idx, 1);
    if (this.active === session) {
      const next = this.sessions[Math.min(idx, this.sessions.length - 1)];
      this.active = null;
      if (next) this.activate(next);
    }
    if (!this.sessions.length) this.counter = 0;
    this.renderTabs();
  }

  closeAll() {
    for (const s of [...this.sessions]) this.close(s);
  }

  fit() {
    const s = this.active;
    if (!s || !this.body.offsetParent) return;
    try {
      s.fit.fit();
    } catch {
      /* not visible yet */
    }
  }

  renderTabs() {
    this.tabList.replaceChildren(
      ...this.sessions.map((s) => {
        const tab = document.createElement("div");
        tab.className = "term-tab" + (s === this.active ? " active" : "");
        tab.innerHTML = `<span class="name"></span><button class="close" title="Close">${icons.close}</button>`;
        tab.querySelector(".name").textContent = s.name;
        tab.addEventListener("click", (e) => {
          if (e.target.closest(".close")) this.close(s);
          else this.activate(s);
        });
        return tab;
      })
    );
  }
}
