import { EditorState, Compartment, EditorSelection } from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
  dropCursor, rectangularSelection, crosshairCursor, highlightSpecialChars,
} from "@codemirror/view";
import {
  defaultKeymap, history, historyKeymap, indentWithTab, copyLineDown, deleteLine, moveLineUp, moveLineDown,
} from "@codemirror/commands";
import {
  indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, HighlightStyle, indentUnit,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches, selectNextOccurrence } from "@codemirror/search";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";
import { api, basename } from "./api.js";
import { fileIcon, icons } from "./icons.js";
import { editorKeys } from "./platform.js";

// Colors follow PyCharm's "Dark" (New UI) scheme.
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.bool, t.null], color: "#CF8E6D" },
  { tag: [t.string, t.special(t.string)], color: "#6AAB73" },
  { tag: t.escape, color: "#CF8E6D" },
  { tag: t.number, color: "#2AACB8" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#7A7E85", fontStyle: "italic" },
  { tag: t.function(t.definition(t.variableName)), color: "#56A8F5" },
  { tag: t.definition(t.className), color: "#BCBEC4", fontWeight: "bold" },
  { tag: t.propertyName, color: "#C77DBB" },
  { tag: t.function(t.propertyName), color: "#BCBEC4" },
  { tag: t.self, color: "#94558D" },
  { tag: t.meta, color: "#B3AE60" },
  { tag: t.invalid, color: "#F75464" },
  { tag: t.heading, color: "#CF8E6D", fontWeight: "bold" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "bold" },
  { tag: t.link, color: "#548AF7", textDecoration: "underline" },
  { tag: t.monospace, color: "#6AAB73" },
]);

const theme = EditorView.theme(
  {
    "&": { height: "100%", color: "#BCBEC4", backgroundColor: "#1E1F22", fontSize: "13px" },
    ".cm-scroller": { fontFamily: "'JetBrains Mono', Menlo, monospace", lineHeight: "1.7" },
    ".cm-content": { caretColor: "#CED0D6", padding: "4px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#CED0D6", borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection":
      { backgroundColor: "#214283 !important" },
    ".cm-activeLine": { backgroundColor: "#26282E" },
    ".cm-activeLineGutter": { backgroundColor: "#26282E", color: "#A1A3AB" },
    ".cm-gutters": { backgroundColor: "#1E1F22", color: "#4B5059", border: "none" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 16px", minWidth: "40px" },
    ".cm-foldGutter .cm-gutterElement": { color: "#6F737A", padding: "0 4px" },
    ".cm-foldPlaceholder": { backgroundColor: "#393B40", border: "none", color: "#A1A3AB" },
    ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: "#43454A", outline: "1px solid #6F737A" },
    ".cm-selectionMatch": { backgroundColor: "#373B39" },
    ".cm-searchMatch": { backgroundColor: "#32593D", outline: "1px solid #5FB865" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "#2E436E" },
    ".cm-panels": { backgroundColor: "#2B2D30", color: "#BCBEC4", borderColor: "#1E1F22" },
    ".cm-panels input, .cm-panels button": { fontSize: "12px" },
    ".cm-tooltip": { backgroundColor: "#2B2D30", border: "1px solid #43454A", borderRadius: "6px" },
    ".cm-tooltip-autocomplete > ul > li": { padding: "2px 8px", fontFamily: "'JetBrains Mono', Menlo, monospace" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "#2E436E", color: "#DFE1E5" },
    ".cm-completionIcon": { opacity: 0.8 },
    ".cm-test-gutter .cm-gutterElement": { display: "flex", alignItems: "center", padding: "0 2px" },
    ".cm-test-run": { cursor: "pointer", borderRadius: "3px", display: "flex" },
    ".cm-test-run:hover": { backgroundColor: "#393B40" },
    ".cm-tooltip.cm-tooltip-hover, .cm-tooltip.cm-lsp-signature-tooltip": { maxWidth: "640px", maxHeight: "320px", overflow: "auto" },
    ".cm-lsp-documentation": { fontFamily: "-apple-system, 'Segoe UI', sans-serif", fontSize: "12.5px", lineHeight: "1.5" },
    ".cm-lsp-documentation pre, .cm-lsp-documentation code": { fontFamily: "'JetBrains Mono', Menlo, monospace", fontSize: "12px" },
    ".cm-lsp-documentation pre": { backgroundColor: "#1E1F22", padding: "6px 8px", borderRadius: "4px" },
    ".cm-lsp-active-parameter": { color: "#DFE1E5", fontWeight: "bold" },
    ".cm-tooltip-lint": { padding: "0" },
    ".cm-diagnostic": { padding: "4px 10px", fontFamily: "-apple-system, 'Segoe UI', sans-serif", fontSize: "12.5px" },
    ".cm-diagnostic-error": { borderLeft: "3px solid #F75464" },
    ".cm-diagnostic-warning": { borderLeft: "3px solid #E0A82E" },
    ".cm-diagnostic-info, .cm-diagnostic-hint": { borderLeft: "3px solid #6F737A" },
    ".cm-diagnosticSource": { color: "#868A91", fontSize: "11.5px" },
    // Unused code is greyed out instead of underlined, like PyCharm.
    ".cm-lintRange-hint.cm-unnecessary": { backgroundImage: "none", opacity: 0.55 },
    ".cm-deprecated": { textDecoration: "line-through" },
    ".cm-panel.cm-lsp-reference-panel": { maxHeight: "200px", overflow: "auto", fontSize: "12.5px", outline: "none" },
    ".cm-panels-bottom": { borderTop: "1px solid #393B40" },
    ".cm-lsp-reference-file": { color: "#868A91" },
    ".cm-lsp-reference:hover, .cm-lsp-reference[aria-selected]": { backgroundColor: "#2E436E" },
  },
  { dark: true }
);

// PyCharm shortcuts layered over CodeMirror's defaults ("Mod" is ⌘ on macOS, Ctrl elsewhere).
const pycharmKeymap = [
  { key: "Mod-d", run: copyLineDown, preventDefault: true },
  { key: editorKeys.deleteLine, run: deleteLine, preventDefault: true },
  { key: editorKeys.selectNextOccurrence, run: selectNextOccurrence, preventDefault: true },
  { key: "Alt-Shift-ArrowUp", run: moveLineUp },
  { key: "Alt-Shift-ArrowDown", run: moveLineDown },
];

function languageFor(path) {
  if (/\.(py|pyw|pyi)$/i.test(path)) return python();
  if (/\.json$/i.test(path)) return json();
  if (/\.(md|markdown)$/i.test(path)) return markdown();
  return [];
}

export class EditorArea {
  constructor({ editorEl, tabsEl, emptyEl, onActiveChange, onCursor }) {
    this.tabsEl = tabsEl;
    this.emptyEl = emptyEl;
    this.onActiveChange = onActiveChange;
    this.onCursor = onCursor;
    this.tabs = new Map(); // path -> { state, saved (Text), saveTimer, ref: { path } }
    this.order = [];
    this.active = null;
    this.language = new Compartment();
    this.intel = new Compartment();
    // Set by the code-insight layer: extension(path), beforeSwitch(), activated(path), changed(path), closed(path).
    this.hooks = {};

    this.view = new EditorView({ parent: editorEl, state: EditorState.create({ doc: "" }) });
    this.view.dom.style.display = "none";
  }

  /** `ref.path` follows the file through renames, so listeners never act on a stale path. */
  extensions(ref) {
    const path = ref.path;
    return [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter({ openText: "⌄", closedText: "›" }),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      indentUnit.of("    "),
      EditorState.tabSize.of(4),
      syntaxHighlighting(highlight),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        ...pycharmKeymap,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      this.language.of(languageFor(path)),
      this.intel.of(this.hooks.extension?.(path) ?? []),
      theme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          this.markChanged(ref.path);
          this.hooks.changed?.(ref.path);
        }
        if (u.selectionSet || u.docChanged) this.reportCursor();
      }),
    ];
  }

  has(path) {
    return this.tabs.has(path);
  }

  async open(path, line) {
    if (!this.tabs.has(path)) {
      const text = await api.readFile(path); // throws for binary/huge files
      const ref = { path };
      const state = EditorState.create({ doc: text, extensions: this.extensions(ref) });
      this.tabs.set(path, { state, saved: state.doc, saveTimer: null, ref });
      const idx = this.active ? this.order.indexOf(this.active) + 1 : this.order.length;
      this.order.splice(idx, 0, path);
    }
    this.activate(path);
    if (line) this.goToLine(line);
  }

  activate(path) {
    if (this.active && this.tabs.has(this.active)) {
      this.hooks.beforeSwitch?.();
      this.tabs.get(this.active).state = this.view.state;
    }
    this.active = path;
    if (path) {
      this.view.setState(this.tabs.get(path).state);
      this.view.dom.style.display = "";
      this.emptyEl.style.display = "none";
      requestAnimationFrame(() => this.view.focus());
    } else {
      this.view.dom.style.display = "none";
      this.emptyEl.style.display = "";
    }
    this.renderTabs();
    this.reportCursor();
    this.onActiveChange?.(path);
    if (path) this.hooks.activated?.(path);
  }

  async close(path) {
    const tab = this.tabs.get(path);
    if (!tab) return;
    await this.save(path);
    const idx = this.order.indexOf(path);
    this.order.splice(idx, 1);
    this.tabs.delete(path);
    this.hooks.closed?.(path);
    if (this.active === path) {
      this.active = null;
      this.activate(this.order[Math.min(idx, this.order.length - 1)] ?? null);
    } else {
      this.renderTabs();
    }
  }

  async closeAll() {
    await this.saveAll();
    for (const path of this.order) this.hooks.closed?.(path);
    this.tabs.clear();
    this.order = [];
    this.active = null;
    this.activate(null);
  }

  currentState(path) {
    return path === this.active ? this.view.state : this.tabs.get(path)?.state;
  }

  isDirty(path) {
    const tab = this.tabs.get(path);
    return tab ? !this.currentState(path).doc.eq(tab.saved) : false;
  }

  // PyCharm saves automatically; we do the same shortly after you stop typing.
  markChanged(path) {
    const tab = this.tabs.get(path);
    if (!tab) return;
    clearTimeout(tab.saveTimer);
    tab.saveTimer = setTimeout(() => this.save(path), 1000);
    this.renderTabs();
  }

  async save(path) {
    const tab = this.tabs.get(path);
    if (!tab) return;
    clearTimeout(tab.saveTimer);
    const doc = this.currentState(path).doc;
    if (doc.eq(tab.saved)) return;
    await api.writeFile(path, doc.toString());
    tab.saved = doc;
    this.renderTabs();
  }

  async saveAll() {
    await Promise.all([...this.tabs.keys()].map((p) => this.save(p)));
  }

  goToLine(line, col = 1) {
    const doc = this.view.state.doc;
    const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
    const pos = Math.min(l.from + col - 1, l.to);
    this.view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    this.view.focus();
  }

  reportCursor() {
    if (!this.active) return this.onCursor?.(null);
    const state = this.view.state;
    const pos = state.selection.main.head;
    const line = state.doc.lineAt(pos);
    this.onCursor?.({ line: line.number, col: pos - line.from + 1 });
  }

  // Keep tabs pointing at the right files after a rename/move in the project tree.
  renamed(from, to) {
    const remap = (p) => (p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : p);
    const tabs = new Map();
    for (const [p, tab] of this.tabs) {
      tab.ref.path = remap(p);
      tabs.set(tab.ref.path, tab);
    }
    this.tabs = tabs;
    this.order = this.order.map(remap);
    if (this.active) this.active = remap(this.active);
    this.renderTabs();
    this.onActiveChange?.(this.active);
  }

  /** Re-applies the code-insight extensions to every tab (e.g. after the language server started). */
  reconfigureIntel() {
    for (const path of this.order) {
      const effects = this.intel.reconfigure(this.hooks.extension?.(path) ?? []);
      if (path === this.active) this.view.dispatch({ effects });
      else {
        const tab = this.tabs.get(path);
        tab.state = tab.state.update({ effects }).state;
      }
    }
  }

  /** Replaces the active document with `text`, touching only the part that differs so the cursor stays put. */
  replaceText(text) {
    const doc = this.view.state.doc.toString();
    if (doc === text) return;
    let start = 0;
    while (start < doc.length && start < text.length && doc[start] === text[start]) start++;
    let endA = doc.length;
    let endB = text.length;
    while (endA > start && endB > start && doc[endA - 1] === text[endB - 1]) endA--, endB--;
    this.view.dispatch({ changes: { from: start, to: endA, insert: text.slice(start, endB) }, userEvent: "input.format" });
  }

  deleted(path) {
    for (const p of [...this.order]) {
      if (p === path || p.startsWith(path + "/")) {
        const tab = this.tabs.get(p);
        clearTimeout(tab.saveTimer);
        tab.saved = this.currentState(p).doc; // nothing to save — the file is gone
        this.close(p);
      }
    }
  }

  renderTabs() {
    this.tabsEl.replaceChildren(
      ...this.order.map((path) => {
        const el = document.createElement("div");
        el.className = "tab" + (path === this.active ? " active" : "") + (this.isDirty(path) ? " dirty" : "");
        el.title = path;
        el.innerHTML = `<span class="icon">${fileIcon(path)}</span><span class="name"></span><button class="close">${icons.close}</button>`;
        el.querySelector(".name").textContent = basename(path);
        el.addEventListener("mousedown", (e) => {
          if (e.button === 1) return this.close(path);
          if (!e.target.closest(".close")) this.activate(path);
        });
        el.querySelector(".close").addEventListener("click", (e) => {
          e.stopPropagation();
          this.close(path);
        });
        return el;
      })
    );
    this.tabsEl.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}
