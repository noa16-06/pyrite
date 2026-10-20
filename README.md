# Pyrite

A fast, lightweight Python IDE inspired by PyCharm, built with Tauri 2 (Rust core) and CodeMirror 6.

## Features (v0.1)

- **Project tree:** create, rename, delete (moves to the Trash), and an "Open in Terminal" action
- **Editor:** tabs, Python/JSON/Markdown highlighting, PyCharm Dark colors and macOS keymap, autosave
- **Run:** runs the current file with the project interpreter, accepts stdin, and turns traceback lines into links
- **Terminal:** several tabs, uses your login shell, activates the project venv automatically
- **Interpreter:** auto-detects `.venv`/`venv`/`env`, or you pick one from the status bar
- **Go to File** (`⇧⇧` / `⌘⇧O`), **Go to Line** (`⌘L`), and recent projects

## Shortcuts

| Action | Keys |
|---|---|
| Run current file / Rerun | `⌃⇧R` / `⌃R` |
| Stop | `⌘F2` |
| Project view / Run / Terminal | `⌘1` / `⌘4` / `⌥F12` |
| Duplicate line / Delete line | `⌘D` / `⌘⌫` |
| Move line up/down | `⌥⇧↑` / `⌥⇧↓` |
| Next/previous tab | `⌘⇧]` / `⌘⇧[` |

## Development

```bash
npm install
npm run app      # dev mode with hot reload
npm run bundle   # release .app / .dmg in src-tauri/target/release/bundle
```

Requirements: Node.js, Rust (cargo), and Xcode Command Line Tools.

`examples/demo` is a small project to try Run, stdin, and traceback links on.

## Roadmap

- Code intelligence (completion, go to definition, inspections) via a Python language server
- Debugger (debugpy): breakpoints, stepping, variables
- pytest runner with a results tree
- Create venvs and manage pip packages
