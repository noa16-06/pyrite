import { api, basename } from "./api.js";
import { tildify } from "./platform.js";
import { fileIcon, folderIcon, icons } from "./icons.js";

const INDENT = 16;

export class ProjectTree {
  constructor(el, { onOpen, onContextMenu }) {
    this.el = el;
    this.onOpen = onOpen;
    this.onContextMenu = onContextMenu;
    this.root = null;
    this.expanded = new Set();
    this.selected = null;

    el.addEventListener("contextmenu", (e) => {
      if (!this.root) return;
      e.preventDefault();
      const row = e.target.closest(".tree-row");
      const path = row ? row.dataset.path : this.root;
      const isDir = row ? row.dataset.dir === "1" : true;
      if (row) this.select(path);
      this.onContextMenu?.({ x: e.clientX, y: e.clientY, path, isDir });
    });
  }

  async load(root) {
    this.root = root;
    this.expanded = new Set([root]);
    this.selected = null;
    await this.refresh();
  }

  async refresh() {
    if (!this.root) return this.el.replaceChildren();
    const frag = document.createDocumentFragment();
    frag.append(this.row({ name: basename(this.root), path: this.root, is_dir: true }, 0, true));
    const children = document.createElement("div");
    frag.append(children);
    await this.fill(children, this.root, 1);
    this.el.replaceChildren(frag);
    this.highlight();
  }

  async fill(container, dir, depth) {
    let entries;
    try {
      entries = await api.listDir(dir);
    } catch {
      this.expanded.delete(dir);
      return;
    }
    for (const entry of entries) {
      container.append(this.row(entry, depth));
      if (entry.is_dir) {
        const children = document.createElement("div");
        children.className = "tree-children";
        container.append(children);
        if (this.expanded.has(entry.path)) await this.fill(children, entry.path, depth + 1);
      }
    }
  }

  row(entry, depth, isRoot = false) {
    const el = document.createElement("div");
    el.className = "tree-row" + (isRoot ? " root" : "");
    el.dataset.path = entry.path;
    el.dataset.dir = entry.is_dir ? "1" : "0";
    el.style.paddingLeft = `${8 + depth * INDENT}px`;

    const open = this.expanded.has(entry.path);
    const chevron = entry.is_dir ? (open ? icons.chevronDown : icons.chevronRight) : "";
    const icon = entry.is_dir ? folderIcon(entry.name) : fileIcon(entry.name);
    el.innerHTML = `<span class="chev">${chevron}</span><span class="icon">${icon}</span><span class="name"></span>`;
    el.querySelector(".name").textContent = entry.name;
    if (isRoot) {
      const hint = document.createElement("span");
      hint.className = "hint";
      hint.textContent = tildify(entry.path);
      el.append(hint);
    }
    if (entry.is_dir && /^(\.?venv|env|node_modules|build|dist|\.tox|target)$/.test(entry.name)) {
      el.classList.add("excluded");
    }

    el.addEventListener("click", () => {
      this.select(entry.path);
      if (entry.is_dir) this.toggle(entry.path, el);
      else this.onOpen?.(entry.path);
    });
    return el;
  }

  async toggle(path, rowEl) {
    const children = rowEl.nextElementSibling;
    if (this.expanded.has(path)) {
      this.expanded.delete(path);
      children.replaceChildren();
    } else {
      this.expanded.add(path);
      const depth = Math.round((parseInt(rowEl.style.paddingLeft) - 8) / INDENT) + 1;
      await this.fill(children, path, depth);
    }
    rowEl.querySelector(".chev").innerHTML = this.expanded.has(path) ? icons.chevronDown : icons.chevronRight;
  }

  collapseAll() {
    this.expanded = new Set([this.root]);
    this.refresh();
  }

  expand(path) {
    this.expanded.add(path);
  }

  select(path) {
    this.selected = path;
    this.highlight();
  }

  highlight() {
    for (const r of this.el.querySelectorAll(".tree-row.selected")) r.classList.remove("selected");
    if (!this.selected) return;
    const row = this.el.querySelector(`.tree-row[data-path="${CSS.escape(this.selected)}"]`);
    row?.classList.add("selected");
  }

  /** Folder that "New File" should target, based on the current selection. */
  targetDir() {
    if (!this.selected) return this.root;
    const row = this.el.querySelector(`.tree-row[data-path="${CSS.escape(this.selected)}"]`);
    if (row?.dataset.dir === "1") return this.selected;
    return this.selected.split("/").slice(0, -1).join("/") || this.root;
  }
}
