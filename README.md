# Pyrite

A fast, lightweight Python IDE inspired by PyCharm, built with Tauri 2 (Rust core) and CodeMirror 6.

## Features (v0.1)

- **Project tree:** create, rename, delete (moves to the Trash), and an "Open in Terminal" action
- **Editor:** tabs, Python/JSON/Markdown highlighting, PyCharm Dark colors and keymap (macOS or Windows/Linux), autosave
- **Run:** runs the current file with the project interpreter, accepts stdin, and turns traceback lines into links
- **Terminal:** several tabs, uses your login shell, activates the project venv automatically
- **Interpreter:** auto-detects `.venv`/`venv`/`env`, or you pick one from the status bar
- **Code insight** ([basedpyright](https://docs.basedpyright.com)): completion, hover docs, parameter info, go to declaration (also ⌘/Ctrl-click), find usages, rename, and type errors as you type
- **Inspections and formatting** ([Ruff](https://docs.astral.sh/ruff)): lint warnings, Reformat Code, Optimize Imports, and PyCharm's error/warning counter in the editor corner
- **Go to File**, **Go to Line**, and recent projects

Code insight needs basedpyright and Ruff. When they're missing, Pyrite offers to install them into its own environment in the app data folder, so your project's environment isn't touched. Versions you already have on PATH (`basedpyright-langserver` or `pyright-langserver`, `ruff`) work too. Ruff uses your project's `pyproject.toml` / `ruff.toml` settings.

## Shortcuts

Pyrite uses PyCharm's default keymap for each OS.

| Action | macOS | Windows / Linux |
|---|---|---|
| Go to File | `⇧⇧` / `⌘⇧O` | `Shift Shift` / `Ctrl+Shift+N` |
| Go to Line | `⌘L` | `Ctrl+G` |
| Run current file | `⌃⇧R` | `Ctrl+Shift+F10` |
| Rerun | `⌃R` | `Shift+F10` |
| Stop | `⌘F2` | `Ctrl+F2` |
| Project / Run / Terminal | `⌘1` / `⌘4` / `⌥F12` | `Alt+1` / `Alt+4` / `Alt+F12` |
| Duplicate line / Delete line | `⌘D` / `⌘⌫` | `Ctrl+D` / `Ctrl+Y` |
| Select next occurrence | `⌃G` | `Alt+J` |
| Move line up/down | `⌥⇧↑` / `⌥⇧↓` | `Alt+Shift+↑` / `Alt+Shift+↓` |
| Close tab | `⌘W` | `Ctrl+F4` |
| Next/previous tab | `⌘⇧]` / `⌘⇧[` | `Alt+→` / `Alt+←` |
| Go to Declaration | `⌘B` / `⌘`-click | `Ctrl+B` / `Ctrl`-click |
| Find Usages | `⌥F7` | `Alt+F7` |
| Rename | `⇧F6` | `Shift+F6` |
| Parameter Info | `⌘P` | `Ctrl+P` |
| Basic completion | `⌃Space` | `Ctrl+Space` |
| Reformat Code | `⌥⌘L` | `Ctrl+Alt+L` |
| Optimize Imports | `⌃⌥O` | `Ctrl+Alt+O` |
| Next/previous problem | `F2` / `⇧F2` | `F2` / `Shift+F2` |

## Development

```bash
npm install
npm run app      # dev mode with hot reload
npm run bundle   # release .app / .dmg in src-tauri/target/release/bundle
```

Requirements on every OS: Node.js 20+ and Rust (stable). Plus, per OS:

- **macOS:** Xcode Command Line Tools (`xcode-select --install`)
- **Windows:** [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktop development with C++"); WebView2 is already part of Windows 10/11
- **Linux (Debian/Ubuntu):**
  `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for other distros.

## Installers

The **Release** workflow builds installers for macOS, Windows and Linux and attaches them to a draft GitHub release. To start it, push a tag (`git tag v0.2.0 && git push --tags`) or run it from the Actions tab. The builds are unsigned, so on first launch:

- **macOS:** right-click the app → Open, or run `xattr -cr /Applications/Pyrite.app`
- **Windows:** SmartScreen → More info → Run anyway

`examples/demo` is a small project to try Run, stdin, and traceback links on.

## Roadmap

- Quick fixes (⌥⏎ / Alt+Enter) from Ruff and basedpyright
- Debugger (debugpy): breakpoints, stepping, variables
- pytest runner with a results tree
- Create venvs and manage pip packages
