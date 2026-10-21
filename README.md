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
- **Test runner (pytest):** green ▶ icons next to every `def test_…` and `class Test…`, a results tree (file → class → parametrized cases) with durations, the selected test's output and traceback, Rerun Failed, a Show Passed toggle, and gutter icons that show each test's last result. Test files (`test_*.py` / `*_test.py`) run with pytest from the Run button, and folders from the project tree's context menu. If pytest is missing, Pyrite offers to install it.
- **Debugger (debugpy):** click the gutter to set breakpoints (they move with your edits and are saved per project), Debug the current file (test files run pytest under the debugger), step over/into/out, pause and resume, frames and an expandable variables tree, Evaluate Expression, a stop on uncaught exceptions, and the execution line highlighted in the editor. The program's output and `input()` stay in the console.
- **Projects:** a welcome screen with project search, and a **New Project** dialog like PyCharm's (location, `.venv` via venv or uv, or a base Python, an optional git repository and `main.py` welcome script)
- **Main menu:** the ☰ button on Windows/Linux and the menu bar on macOS (File, View, Navigate, Run), plus **New…** (file, directory, Python file, Python package) and Open File…
- **Go to File**, **Go to Line**, **Recent Files**, Reload All from Disk

Code insight needs basedpyright and Ruff, and the debugger needs debugpy. When they're missing, Pyrite offers to install them into its own environment in the app data folder, so your project's environment isn't touched. Versions you already have on PATH (`basedpyright-langserver` or `pyright-langserver`, `ruff`) work too. Ruff uses your project's `pyproject.toml` / `ruff.toml` settings.

## Shortcuts

Pyrite uses PyCharm's default keymap for each OS.

| Action | macOS | Windows / Linux |
|---|---|---|
| Go to File | `⇧⇧` / `⌘⇧O` | `Shift Shift` / `Ctrl+Shift+N` |
| Go to Line | `⌘L` | `Ctrl+G` |
| Recent Files | `⌘E` | `Ctrl+E` |
| New… (file, directory, package) | `⌘N` | `Alt+Insert` |
| Reload All from Disk | `⌥⌘Y` | `Ctrl+Alt+Y` |
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
| Debug current file | `⌃D` | `Shift+F9` |
| Toggle line breakpoint | `⌘F8` | `Ctrl+F8` |
| Resume program | `⌥⌘R` | `F9` |
| Step over / into / out | `F8` / `F7` / `⇧F8` | `F8` / `F7` / `Shift+F8` |
| Evaluate expression | `⌥F8` | `Alt+F8` |

## Development

```bash
npm install
npm run app      # dev mode with hot reload
npm run bundle   # release .app / .dmg in src-tauri/target/release/bundle
```

`npm install` also enables the repo's git hooks, which keep `main` changing only through pull requests (see `CLAUDE.md`).

Requirements on every OS: Node.js 20+ and Rust (stable). Plus, per OS:

- **macOS:** Xcode Command Line Tools (`xcode-select --install`)
- **Windows:** [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) ("Desktop development with C++"); WebView2 is already part of Windows 10/11

On Linux the libraries are the same everywhere, but the package names are not:

| Distribution | Build dependencies |
|---|---|
| Debian, Ubuntu, Mint, Pop!_OS | `sudo apt install build-essential curl wget file libwebkit2gtk-4.1-dev libgtk-3-dev libxdo-dev libssl-dev librsvg2-dev` |
| Fedora, RHEL | `sudo dnf install @development-tools webkit2gtk4.1-devel gtk3-devel libxdo-devel openssl-devel librsvg2-devel` |
| Arch, Manjaro | `sudo pacman -S --needed base-devel webkit2gtk-4.1 gtk3 xdotool openssl librsvg` |
| openSUSE | `sudo zypper install -t pattern devel_basis && sudo zypper install webkitgtk3-devel gtk3-devel xdotool-devel libopenssl-devel librsvg-devel` |

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) if your distribution is not listed.

## Installers

The **Release** workflow builds installers for macOS, Windows and Linux and attaches them to a draft GitHub release. To start it, push a tag (`git tag v0.2.0 && git push --tags`) or run it from the Actions tab. The builds are unsigned, so on first launch:

- **macOS:** right-click the app → Open, or run `xattr -cr /Applications/Pyrite.app`
- **Windows:** SmartScreen → More info → Run anyway

`examples/demo` is a small project to try Run, stdin, and traceback links on.

### Installing on Linux

| Distribution | Install |
|---|---|
| Ubuntu, Debian, Mint, Pop!_OS | `sudo apt install ./Pyrite_0.1.0_amd64.deb` |
| Fedora, RHEL | `sudo dnf install ./Pyrite-0.1.0-1.x86_64.rpm` |
| openSUSE | `sudo zypper install ./Pyrite-0.1.0-1.x86_64.rpm` |
| Arch, Manjaro, EndeavourOS | `cd packaging/arch && makepkg -si` |
| Anything else | `chmod +x Pyrite_*.AppImage && ./Pyrite_*.AppImage` |

The same `.rpm` serves Fedora and openSUSE because it asks for library sonames
(`libwebkit2gtk-4.1.so.0`) instead of package names, which the two distributions
spell differently. Every release is installed into a container for each of these
families before it ships.

Releases are built on Ubuntu 22.04, so the packages need glibc 2.35 or newer:
Ubuntu 22.04+, Debian 12+, Mint 21+, Pop!_OS 22.04+, Fedora 36+, openSUSE Leap
15.6+ and any rolling release. On anything older, build from source.

Pyrite needs a Python interpreter to run your code. The deb and rpm recommend
`python3`, which your package manager installs by default, but Pyrite also works
with any virtualenv you point it at from the status bar.

### If the window comes up blank

WebKitGTK's DMA-BUF renderer misbehaves on the proprietary NVIDIA driver and
under software rendering. Pyrite detects both and disables it, but if you hit a
case it misses, start it with:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 pyrite
```

Setting the variable yourself always overrides the detection. If the **AppImage**
will not start at all, your distribution is probably missing FUSE 2 (Fedora and
Arch no longer ship it); either install it (`sudo dnf install fuse`,
`sudo pacman -S fuse2`) or run it with `--appimage-extract-and-run`.

## Roadmap

- Quick fixes (⌥⏎ / Alt+Enter) from Ruff and basedpyright
- Create venvs and manage pip packages
