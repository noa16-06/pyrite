# Pyrite 🪙

**A fast, lightweight Python IDE that looks a lot like PyCharm and starts a lot faster.**

Pyrite is named after *fool's gold*: shiny, golden, and grows in perfect little cubes. It is also, technically, not PyCharm. We studied PyCharm very closely (its menus, its keymaps, its color schemes, the exact wording of its dialogs) and then rebuilt the parts we use every day with **Rust** ([Tauri 2](https://v2.tauri.app)) and **[CodeMirror 6](https://codemirror.net)**. No bundled Chromium. No bundled JVM. No "Indexing…" progress bar to stare at while your coffee goes cold.

It runs on **macOS, Windows and Linux**, and it is very much a v0.1: useful today, with plenty of room to grow (see [what we still need](#roadmap)).

---

## ✨ What it can do

### Code like you mean it
- **Editor** with tabs, Python / JSON / Markdown highlighting, PyCharm's keymap for your OS, and **autosave** (Pyrite never asks "save changes?", just like PyCharm)
- **Code insight** via [basedpyright](https://docs.basedpyright.com): completion, hover docs, parameter info, go to declaration (⌘/Ctrl-click too), find usages, rename, and type errors as you type
- **Inspections and formatting** via [Ruff](https://docs.astral.sh/ruff): lint warnings, *Reformat Code*, *Optimize Imports*, and PyCharm's little error/warning counter in the corner, judging you quietly

### Run it, test it, debug it
- **Run** the current file with your project's interpreter, type into `input()`, and click a traceback line to jump straight to the crime scene
- **pytest runner** with green ▶ icons next to every `def test_…`, a results tree (file → class → parametrized cases), durations, *Rerun Failed*, and gutter icons that remember how each test did last time
- **Debugger** ([debugpy](https://github.com/microsoft/debugpy)): breakpoints that follow your edits, step over / into / out, frames, a variables tree, *Evaluate Expression*, and a polite stop on uncaught exceptions
- **Terminal** with tabs, your login shell, and the project venv activated automatically

### Feel at home
- **Welcome screen** with project search, and a **New Project** dialog straight out of PyCharm: pick a location, get a `.venv` (venv or uv), an optional git repo, and the famous `print_hi('Pyrite')` welcome script
- **Main menu** (☰ on Windows / Linux, the real menu bar on macOS), **New…** for files, directories, Python files and packages, **Go to File** (double ⇧), **Recent Files**, *Reload All from Disk*
- **Settings** (⌘, / Ctrl+Alt+S) laid out like PyCharm's: appearance, autosave, editor font and ligatures, line numbers, soft wraps, tab size, the project interpreter and its packages, and an **editable keymap** with conflict detection
- **Themes**: PyCharm's *Dark*, *Light* and *Light with Light Header*, or *Sync with OS* if you like your IDE to change moods at sunset

> **Batteries sold separately (but delivered for free).** Code insight needs basedpyright and Ruff, and the debugger needs debugpy. If they're missing, Pyrite offers to install them into *its own* environment in the app data folder, so your project's venv stays untouched. Versions already on your `PATH` work too, and Ruff respects your `pyproject.toml` / `ruff.toml`.

---

## ⌨️ Shortcuts

Pyrite uses **PyCharm's default keymap for your OS**, so your fingers already know it. Don't like one? Change it in *Settings › Keymap*.

| Action | macOS | Windows / Linux |
|---|---|---|
| Go to File | `⇧⇧` / `⌘⇧O` | `Shift Shift` / `Ctrl+Shift+N` |
| Recent Files | `⌘E` | `Ctrl+E` |
| Go to Line | `⌘L` | `Ctrl+G` |
| New… (file, directory, package) | `⌘N` | `Alt+Insert` |
| Settings | `⌘,` | `Ctrl+Alt+S` |
| Reload All from Disk | `⌥⌘Y` | `Ctrl+Alt+Y` |
| Run current file | `⌃⇧R` | `Ctrl+Shift+F10` |
| Rerun | `⌃R` | `Shift+F10` |
| Stop | `⌘F2` | `Ctrl+F2` |
| Debug current file | `⌃D` | `Shift+F9` |
| Toggle line breakpoint | `⌘F8` | `Ctrl+F8` |
| Resume program | `⌥⌘R` | `F9` |
| Step over / into / out | `F8` / `F7` / `⇧F8` | `F8` / `F7` / `Shift+F8` |
| Evaluate expression | `⌥F8` | `Alt+F8` |
| Go to Declaration | `⌘B` / `⌘`-click | `Ctrl+B` / `Ctrl`-click |
| Find Usages | `⌥F7` | `Alt+F7` |
| Rename | `⇧F6` | `Shift+F6` |
| Parameter Info | `⌘P` | `Ctrl+P` |
| Basic completion | `⌃Space` | `Ctrl+Space` |
| Reformat Code | `⌥⌘L` | `Ctrl+Alt+L` |
| Optimize Imports | `⌃⌥O` | `Ctrl+Alt+O` |
| Next / previous problem | `F2` / `⇧F2` | `F2` / `Shift+F2` |
| Project / Run / Terminal | `⌘1` / `⌘4` / `⌥F12` | `Alt+1` / `Alt+4` / `Alt+F12` |
| Duplicate line / Delete line | `⌘D` / `⌘⌫` | `Ctrl+D` / `Ctrl+Y` |
| Select next occurrence | `⌃G` | `Alt+J` |
| Move line up / down | `⌥⇧↑` / `⌥⇧↓` | `Alt+Shift+↑` / `Alt+Shift+↓` |
| Close tab | `⌘W` | `Ctrl+F4` |
| Next / previous tab | `⌘⇧]` / `⌘⇧[` | `Alt+→` / `Alt+←` |

---

## 📦 Installing

Installers for every OS land on the [Releases](../../releases) page when a version is tagged. The first one hasn't shipped yet, so for now it's [build from source](#building-from-source) or wait a little. The builds won't be signed at first ([#26](../../issues/26)), so your OS will act suspicious the first time:

- **macOS:** right-click the app → *Open*, or run `xattr -cr /Applications/Pyrite.app`
- **Windows:** SmartScreen → *More info* → *Run anyway*

### Linux

| Distribution | Install |
|---|---|
| Ubuntu, Debian, Mint, Pop!_OS | `sudo apt install ./Pyrite_0.1.0_amd64.deb` |
| Fedora, RHEL | `sudo dnf install ./Pyrite-0.1.0-1.x86_64.rpm` |
| openSUSE | `sudo zypper install ./Pyrite-0.1.0-1.x86_64.rpm` |
| Arch, Manjaro, EndeavourOS | `cd packaging/arch && makepkg -si` |
| Anything else | `chmod +x Pyrite_*.AppImage && ./Pyrite_*.AppImage` |

One `.rpm` serves both Fedora and openSUSE because it asks for library sonames (`libwebkit2gtk-4.1.so.0`) instead of package names, which the two spell differently. Every release is installed into a container for each of these families before it ships.

Releases are built on Ubuntu 22.04, so you need glibc 2.35 or newer: Ubuntu 22.04+, Debian 12+, Mint 21+, Pop!_OS 22.04+, Fedora 36+, openSUSE Leap 15.6+, or any rolling release. Older than that? Build from source (below).

Pyrite needs a Python to run your code. The deb and rpm recommend `python3`, but any virtualenv you point it at from the status bar works.

**Blank window?** WebKitGTK's DMA-BUF renderer sulks on the proprietary NVIDIA driver and under software rendering. Pyrite detects both and turns it off, but if it misses your setup:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 pyrite
```

**AppImage won't start at all?** Your distribution probably dropped FUSE 2 (Fedora and Arch did). Install it (`sudo dnf install fuse`, `sudo pacman -S fuse2`) or run the AppImage with `--appimage-extract-and-run`.

---

<a id="building-from-source"></a>

## 🛠️ Building from source

```bash
npm install          # also turns on the git hooks that protect main
npm run app          # dev mode with hot reload
npm run build        # frontend only, quick check
cd src-tauri && cargo test
npm run bundle       # release build + installers in src-tauri/target/release/bundle
```

You need **Node.js 20+** and **Rust** (stable), plus:

- **macOS:** Xcode Command Line Tools (`xcode-select --install`)
- **Windows:** [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktop development with C++"); WebView2 already comes with Windows 10/11
- **Linux:** the WebKitGTK stack; same libraries everywhere, different package names:

| Distribution | Build dependencies |
|---|---|
| Debian, Ubuntu, Mint, Pop!_OS | `sudo apt install build-essential curl wget file libwebkit2gtk-4.1-dev libgtk-3-dev libxdo-dev libssl-dev librsvg2-dev` |
| Fedora, RHEL | `sudo dnf install @development-tools webkit2gtk4.1-devel gtk3-devel libxdo-devel openssl-devel librsvg2-devel` |
| Arch, Manjaro | `sudo pacman -S --needed base-devel webkit2gtk-4.1 gtk3 xdotool openssl librsvg` |
| openSUSE | `sudo zypper install -t pattern devel_basis && sudo zypper install webkitgtk3-devel gtk3-devel xdotool-devel libopenssl-devel librsvg-devel` |

Not listed? See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). `examples/demo` is a tiny project for poking at Run, stdin, tests and traceback links.

**How it's put together:** the frontend in `src/` is plain ES modules, no framework (`main.js` is the app shell, `editor.js` the tabs and CodeMirror, `intelligence.js` the LSP and Ruff, `settings.js` the Settings dialog). The Rust backend in `src-tauri/src/` does files, processes, the terminal (portable-pty), and speaks LSP and DAP. [PROGRESS.md](PROGRESS.md) explains what was built, why, and in what order.

---

<a id="roadmap"></a>

## 🗺️ What we still need

PyCharm has had a 15-year head start. Here's the catch-up list. Each item is an issue, and contributions are very welcome:

**Big ones**
- [#10](../../issues/10) A packages tool window: create venvs, install / upgrade / remove packages
- [#11](../../issues/11) Quick fixes with ⌥⏎ / Alt+Enter
- [#12](../../issues/12) Find in Files
- [#13](../../issues/13) Git integration (gutter markers, colored files, commit window)
- [#19](../../issues/19) Jupyter notebooks

**Medium ones**
- [#14](../../issues/14) Run configurations (arguments, env vars, working directory)
- [#15](../../issues/15) A Python Console tool window
- [#16](../../issues/16) Debug a single test from the gutter, conditional breakpoints
- [#17](../../issues/17) Structure view and breadcrumbs
- [#18](../../issues/18) Split editor
- [#20](../../issues/20) Editor keys and two-stroke shortcuts in the keymap editor

**Good first issues** 🌱
- [#21](../../issues/21) More themes: Darcula and High Contrast (it's mostly a block of CSS variables)
- [#22](../../issues/22) Draw breakpoints over the line numbers, like PyCharm
- [#23](../../issues/23) Silence basedpyright's "default workspace root" warning

**Help wanted** 🙋
- [#24](../../issues/24) Try it on Linux and Windows and tell us what breaks
- [#25](../../issues/25) A Playwright UI test suite
- [#26](../../issues/26) Signed and notarized releases

---

## 🤝 Contributing

1. Branch from `main` with a prefix: `feature/`, `fix/`, `docs/`, `refactor/`, … (the git hooks won't let you commit to `main`, and that's on purpose)
2. Write [Conventional Commits](https://www.conventionalcommits.org) (`feat(editor): …`, `fix(terminal): …`)
3. Run `npm run build` and `cargo test` before you push
4. Open a pull request; CI builds and tests it on macOS, Windows and Linux

The full rules are in [CLAUDE.md](CLAUDE.md). Yes, that file name is because an AI pair-programmer helped build this. It reads the same rules you do.

---

## 📜 License

[MIT](LICENSE). Pyrite is an independent project, not affiliated with or endorsed by JetBrains. PyCharm is a trademark of JetBrains s.r.o.; we just really like how it works.
