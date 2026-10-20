// Line breakpoints (click the gutter, like PyCharm) and the highlighted execution line.
import { gutter, GutterMarker, EditorView, Decoration, ViewPlugin } from "@codemirror/view";
import { StateEffect, MapMode, Prec } from "@codemirror/state";

const breakpointsChanged = StateEffect.define();

/** Breakpoint lines per file, plus where the debugger is paused (if it is). */
export class Breakpoints {
  constructor() {
    this.byPath = new Map(); // path -> Set of 1-based line numbers
    this.execution = null; // { path, line }
    this.onChange = null; // (path) => void, after a user toggle or an edit moved breakpoints
  }

  lines(path) {
    return [...(this.byPath.get(path) ?? [])].sort((a, b) => a - b);
  }

  has(path, line) {
    return this.byPath.get(path)?.has(line) ?? false;
  }

  paths() {
    return [...this.byPath.keys()].filter((p) => this.byPath.get(p).size);
  }

  toggle(path, line) {
    const set = this.byPath.get(path) ?? new Set();
    set.has(line) ? set.delete(line) : set.add(line);
    this.byPath.set(path, set);
    this.onChange?.(path);
  }

  set(path, lines) {
    this.byPath.set(path, new Set(lines));
  }

  renamed(from, to) {
    for (const [p, set] of [...this.byPath]) {
      if (p === from || p.startsWith(from + "/")) {
        this.byPath.delete(p);
        this.byPath.set(to + p.slice(from.length), set);
      }
    }
  }

  toJSON() {
    return Object.fromEntries(this.paths().map((p) => [p, this.lines(p)]));
  }

  load(saved) {
    this.byPath = new Map(Object.entries(saved ?? {}).map(([p, lines]) => [p, new Set(lines)]));
  }
}

class DotMarker extends GutterMarker {
  constructor(breakpoint, current) {
    super();
    this.breakpoint = breakpoint;
    this.current = current;
  }

  eq(other) {
    return other.breakpoint === this.breakpoint && other.current === this.current;
  }

  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-bp" + (this.breakpoint ? " set" : "") + (this.current ? " current" : "");
    return el;
  }
}

const execLine = Decoration.line({ class: "cm-exec-line" });

/** Breakpoint gutter (left of the line numbers) and execution-line highlight for one file. */
export function breakpointGutter(path, store) {
  const execution = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = this.build(view);
      }
      update(u) {
        if (u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(breakpointsChanged)))) {
          this.decorations = this.build(u.view);
        }
      }
      build(view) {
        const ex = store.execution;
        if (!ex || ex.path !== path || ex.line > view.state.doc.lines) return Decoration.none;
        return Decoration.set([execLine.range(view.state.doc.line(ex.line).from)]);
      }
    },
    { decorations: (p) => p.decorations }
  );

  return [
    // Highest precedence puts this gutter first, i.e. left of the line numbers.
    Prec.highest(
      gutter({
        class: "cm-breakpoint-gutter",
        lineMarker(view, block) {
          const line = view.state.doc.lineAt(block.from).number;
          const bp = store.has(path, line);
          const current = store.execution?.path === path && store.execution.line === line;
          return bp || current ? new DotMarker(bp, current) : null;
        },
        lineMarkerChange: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(breakpointsChanged))),
        initialSpacer: () => new DotMarker(false, false),
        domEventHandlers: {
          mousedown(view, block, event) {
            if (event.button !== 0) return false;
            store.toggle(path, view.state.doc.lineAt(block.from).number);
            refreshBreakpoints(view);
            return true;
          },
        },
      })
    ),
    execution,
    // Keep breakpoints on their lines while code above them is edited.
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) return;
      const lines = store.lines(path);
      if (!lines.length) return;
      const moved = [];
      for (const line of lines) {
        if (line > u.startState.doc.lines) continue;
        const l = u.startState.doc.line(line);
        // A breakpoint disappears with its line, like in PyCharm (only when both ends are gone).
        const pos = u.changes.mapPos(l.from, 1, MapMode.TrackDel) ?? u.changes.mapPos(l.to, -1, MapMode.TrackDel);
        if (pos == null) continue;
        moved.push(u.state.doc.lineAt(pos).number);
      }
      if (moved.join() !== lines.join()) {
        store.set(path, moved);
        store.onChange?.(path);
      }
    }),
  ];
}

export const refreshBreakpoints = (view) => view.dispatch({ effects: breakpointsChanged.of(null) });
