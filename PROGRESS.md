# Pyrite: progress log and handoff

This file records how Pyrite was built, why it's built that way, and what's left to do. It lets work carry on from another computer or a new Claude session, because conversation history doesn't move between machines.

*Last updated: 2026-10-20, moving development from macOS to Fedora Linux.*

---

## 1. Where things stand

| | |
|---|---|
| **Repo** | https://github.com/noa16-06/pyrite (private) |
| **`main`** | v0.1, cross-platform support, code insight, test runner, CLAUDE.md, git hooks |
| **Open PR #3** | `feature/debugger`: the debugger. All CI checks pass, but **it isn't merged yet** (waiting for the owner to try it) |
| **This file** | arrives through its own `docs/` pull request |

To merge the debugger from any machine: `gh pr merge 3 --squash --delete-branch`

---

## 2. Setting up on Fedora

```bash
# System libraries for Tauri (WebKitGTK etc.)
sudo dnf check-update
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel libxdo-devel
sudo dnf group install c-development      # on older dnf: "C Development Tools and Libraries"

# Rust (via rustup), Node.js, GitHub CLI, Python
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sudo dnf install nodejs gh python3
gh auth login

# Project
git clone https://github.com/noa16-06/pyrite.git
cd pyrite
npm install          # also enables the git hooks that protect main
npm run app          # start Pyrite in dev mode
```

Useful checks: `npm run build` (frontend), `cd src-tauri && cargo test` (Rust unit tests).

**Tip:** Fedora's system Python allows `pip install --user`, but use a project venv instead (`python3 -m venv .venv`). Pyrite picks `.venv` up automatically.

---

## 3. What has been built (in order)

### v0.1: the IDE shell (`bfcde67`)
The brief: work out how PyCharm works (`/Applications/PyCharm.app`, 2026.1.4) and rebuild its key Python features. The owner asked for "something fast like Rust", so the stack is **Tauri 2 (Rust) + CodeMirror 6**, with no bundled Chromium.
- Project tree: create, rename, delete (to the trash), open in terminal
- Editor tabs: PyCharm Dark colours, PyCharm keymap, autosave (PyCharm saves automatically too)
- Run tool window: runs the current file, accepts stdin, makes traceback lines clickable
- Terminal: xterm.js + portable-pty, several tabs, activates the project venv
- Interpreter detection (`.venv`/`venv`/`env`, then system Python), picker in the status bar
- Go to File (⇧⇧), Go to Line, recent projects, welcome screen
- Name: *Pyrite* (fool's gold, which forms cubes; the logo is a gold cube)

### Cross-platform support (`18939a5`)
- Rust: PATH handling per OS, `Scripts\python.exe` venvs on Windows, default shell (PowerShell/cmd on Windows; `$SHELL`/bash/sh on Unix), no console windows on Windows, forward-slash paths sent to the frontend, native menu on macOS only
- Frontend: PyCharm's **Windows/Linux keymap** (Ctrl+Shift+N, Ctrl+G, …), shortcut labels per OS, path normalisation (`normalizePath`, `tildify`)
- CI: `.github/workflows/ci.yml` builds and tests on macOS, Windows and Ubuntu on every push and PR
- Release: `.github/workflows/release.yml` builds installers into a draft release when a `v*` tag is pushed

### Code insight (`60c2db4`)
- **basedpyright** (LSP) through `@codemirror/lsp-client`: completion, hover, parameter info, go to declaration (⌘B / Ctrl+B, ⌘/Ctrl-click), find usages (⌥F7), rename (⇧F6), type errors
- **Ruff** over stdin: lint warnings, Reformat Code (⌥⌘L / Ctrl+Alt+L), Optimize Imports (⌃⌥O / Ctrl+Alt+O)
- PyCharm's inspection widget (error/warning counts, F2 = next problem), an install banner, a status bar item, and an editor context menu
- Tools are installed into **Pyrite's own venv** in the app data folder (on Linux: `~/.local/share/dev.pyrite.ide/tools`), never the user's project
- Decisions:
  - A custom LSP workspace (`TabWorkspace`), because one EditorView swaps state per tab, and keeping files open on the server avoids constant close/open churn.
  - Pyrite answers `workspace/configuration` itself. basedpyright asks for the `basedpyright` section with `analysis` nested inside, and `typeCheckingMode: "standard"` is used, because basedpyright's own default is far too strict.
  - Hover HTML is sanitised, because the webview can reach the backend.

### Test runner (`c41bb49`)
- Bundled pytest plugin `src-tauri/helpers/pyrite_pytest.py`, embedded with `include_str!`. It writes JSON lines to a report file that Rust follows live; PyCharm uses teamcity messages on stdout instead, and the separate file keeps the console clean.
- Results tree (file → class → parametrized cases), durations, per-test output, Rerun Failed, Show Passed, auto-select of the first failure, clickable `file.py:12:` links
- Green ▶ gutter icons for `def test_*` / `class Test*`, showing the last result; test files run with pytest; "Run pytest in …" on folders
- An "Install pytest" link appears when pytest is missing

### Git workflow (PR #1, PR #2)
- `CLAUDE.md`: branches (`feature/`, `fix/`, `test/`, `docs/`, `refactor/`, `ci/`, `chore/`), Conventional Commits, PRs that must pass CI, squash merges, **ask before merging**
- GitHub branch protection isn't possible (private repo on the free plan → HTTP 403 "Upgrade to GitHub Pro"), so `.githooks/pre-commit` and `.githooks/pre-push` block commits and pushes to `main` locally. `npm install` enables them.

### Debugger (PR #3, `feature/debugger`, not merged yet)
- **debugpy** over DAP. `python -Xfrozen_modules=off <debugpy> --listen 127.0.0.1:PORT --wait-for-client file.py` runs in the Run window, so output and `input()` keep working, and Pyrite connects over TCP (`dap.rs`).
- debugpy's **pure-Python wheel** is installed into `…/dev.pyrite.ide/debugpy-lib`, so any project interpreter can run it.
- Breakpoint gutter: click left of the line numbers or press ⌘F8 / Ctrl+F8. Breakpoints move with edits and are saved per project.
- Debug pane with Frames | Variables side by side, Evaluate (⌥F8 / Alt+F8), resume/pause/step (F8/F7/⇧F8; ⌥⌘R / F9), stop on uncaught exceptions with their type, the execution line highlighted
- Test files are debugged by running `pytest` under debugpy
- Important detail: debugpy only exits after the client sends `disconnect` in reply to `terminated`.

---

## 4. How things were tested

- **Rust unit tests** (`cargo test`): LSP/DAP framing, report following, venv layout, UTF-8 stream decoder
- **Headless UI tests:** the real frontend (Vite dev server) running in headless Chromium, driven over the Chrome DevTools Protocol. The Tauri IPC was mocked; LSP, Ruff, pytest and debugpy calls were bridged to the **real** tools. This covered completion, go to declaration, find usages, reformat, the whole test runner flow, and a full debug session.
  - The harness scripts were scratch files on the Mac and are **not in the repo**. Rebuilding them as a proper `tools/ui-tests/` suite (for example with Playwright) would be a good task.
- Screenshots from the Mac couldn't be taken of the real window (no Screen Recording permission), so the headless browser was used for visual checks.

---

## 5. Not verified yet (good things to check on Fedora)

These run in CI only as "it builds and the unit tests pass". Nobody has used them on Linux yet:

- [ ] `npm run app` starts, and the window and fonts look right under WebKitGTK
- [ ] Terminal: `$SHELL` starts, venv activation works, resizing, colours
- [ ] Run: output, stdin, traceback links
- [ ] Code insight: the **Install** banner button really installs basedpyright + Ruff + debugpy (never tested in the real app on any OS)
- [ ] Test runner with a real project
- [ ] Debugger (after merging PR #3): breakpoints, stepping, variables
- [ ] Linux shortcuts (Ctrl+Shift+N, Ctrl+G, Shift+F10, Alt+F12, …), and that none clash with GNOME
- [ ] File dialogs (Open Folder, select interpreter)
- [ ] Moving to the trash (`trash` crate) on Linux
- [ ] `npm run bundle`: `.rpm` / `.AppImage` / `.deb` build and install

---

## 6. To do (roadmap)

**Next up**
1. **Merge PR #3** (debugger) after trying it.
2. **Virtual environments and packages** (#6 in the original list): create a `.venv` from Pyrite, a packages tool window (list/install/update/remove with pip or uv). This also solves "pip is blocked by the system Python" when installing pytest.
3. **Quick fixes (⌥⏎ / Alt+Enter)** from basedpyright and Ruff code actions (add import, remove unused, …).

**Later**
- Find in Files (⌘⇧F / Ctrl+Shift+F), with ripgrep-style search in Rust
- Git integration: change markers in the gutter, coloured files in the tree, a commit/push panel
- Run configurations: arguments, environment variables, working directory per project
- Python console (interactive REPL tool window)
- Debug tests from a gutter icon (currently only whole test files), conditional breakpoints
- Structure view / breadcrumbs, split editor, local history, settings page (theme, font size, keymap)
- Jupyter notebook viewer (biggest item)
- A proper UI test suite in the repo (see section 4)

---

## 7. Known issues and limitations

- pyright logs `File or directory "/<default workspace root>" does not exist` at startup. It's harmless: `@codemirror/lsp-client` sends `rootUri` but no `workspaceFolders`.
- Branch protection is only local (hooks); `--no-verify` bypasses it. Enforcing it on GitHub needs GitHub Pro or a public repo.
- Breakpoints sit in their own gutter left of the line numbers. PyCharm draws them over the line numbers instead.
- debugpy groups globals into "special/function/class variables" folders, unlike PyCharm's flat list.
- The release builds are unsigned (macOS Gatekeeper / Windows SmartScreen warnings).
- macOS only: `git push` over HTTPS could hang on a hidden Keychain prompt; `git -c credential.helper= -c credential.helper='!gh auth git-credential' push` was used instead. On Fedora a plain `git push` should be fine after `gh auth setup-git`.
