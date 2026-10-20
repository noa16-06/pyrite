# Pyrite

A fast, lightweight Python IDE modelled on PyCharm: Tauri 2 (Rust backend) + CodeMirror 6 frontend.
It must work on macOS, Windows and Linux.

## Git workflow

Every change goes through a branch and a pull request, so `main` stays clean and the history is easy to follow.

### Never work directly on `main`

- Before changing anything, create a branch from an up-to-date `main`:
  `git switch main && git pull && git switch -c <type>/<short-name>`
- `main` only changes by merging a pull request.
- Git hooks in `.githooks/` enforce this locally: `pre-commit` refuses commits on `main` and `pre-push` refuses pushes to it. `npm install` enables them (`git config core.hooksPath .githooks`). GitHub can't enforce it, because branch protection isn't available for private repos on the free plan. Never bypass the hooks with `--no-verify`.

### Branch names

`<type>/<short-kebab-description>`:

| Prefix | Use for | Example |
|---|---|---|
| `feature/` | new functionality | `feature/debugger` |
| `fix/` | bug fixes | `fix/terminal-resize-windows` |
| `test/` | experiments, spikes, trying out an approach | `test/jedi-vs-pyright` |
| `refactor/` | code changes without behaviour change | `refactor/run-panel` |
| `docs/` | README, CLAUDE.md, comments only | `docs/install-guide` |
| `ci/` | GitHub Actions and release workflow | `ci/universal-macos-build` |
| `chore/` | dependency updates, tooling | `chore/update-tauri` |

A `test/` branch can be thrown away. If an experiment works out, redo it cleanly on a `feature/` or `fix/` branch, or rename the branch before opening a pull request.

### Commits

- **Commit everything.** Never end a task with uncommitted or unpushed changes; `git status` must be clean at the end.
- Make small, logical commits: one step per commit (e.g. backend command, then UI, then docs), not one giant commit at the end.
- Use [Conventional Commits](https://www.conventionalcommits.org) for messages:
  `<type>(<optional scope>): <summary in imperative mood>`, with types `feat`, `fix`, `test`, `refactor`, `docs`, `ci`, `chore`, `perf`, `style`.
  - `feat(tests): show parametrized cases as a group in the results tree`
  - `fix(terminal): start PowerShell without the logo banner on Windows`
- Keep the summary line at 72 characters or fewer. Add a body (after a blank line) explaining *why* when it isn't obvious.
- Never commit build output, secrets or local files (`node_modules/`, `dist/`, `src-tauri/target/`, `.venv/`, `.env`).

### Pull requests

1. Push the branch: `git push -u origin <branch>`.
2. Open a pull request with `gh pr create --base main`. Give it a Conventional Commit-style title, and a description covering **what** changed, **why**, and **how it was tested**.
3. CI (`.github/workflows/ci.yml`) must pass on macOS, Windows and Linux before merging.
4. Merge with **Squash and merge** (`gh pr merge --squash --delete-branch`), so `main` gets one clear commit per pull request and the branch is deleted.
5. Ask the user before merging unless they have already said to merge.

### Releases

Tag a version on `main` (`git tag v0.3.0 && git push origin v0.3.0`). The release workflow then builds installers into a draft GitHub release. Bump `version` in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` first, in a `chore/release-x.y.z` pull request.

### Pushing from this Mac

`git push` over HTTPS can hang waiting for a hidden macOS Keychain prompt. Use the GitHub CLI login instead:
`git -c credential.helper= -c credential.helper='!gh auth git-credential' push`

## Project layout

- `src/`: frontend (plain ES modules, no framework)
  - `main.js`: app shell, layout, shortcuts, project/interpreter handling
  - `editor.js`: tabs and CodeMirror setup; `intelligence.js`: LSP (basedpyright) and Ruff
  - `run.js`: Run tool window; `tests.js`: pytest results tree and gutter icons
  - `debugger.js`: DAP client and Debug pane; `breakpoints.js`: breakpoint gutter and execution line
  - `terminal.js`: xterm.js terminal; `tree.js`: project tree; `platform.js`: per-OS keymaps and paths
- `src-tauri/src/`: Rust backend (`fs_ops`, `runner`, `terminal`, `lsp`, `dap`, `tools`, `util`)
- `src-tauri/helpers/pyrite_pytest.py`: pytest plugin, embedded in the binary
- `examples/demo/`: small project for manual testing

## Commands

```bash
npm install
npm run app                              # run in dev mode
npm run build                            # frontend build only (quick check)
cd src-tauri && cargo test               # Rust unit tests
npm run bundle                           # release build + installers
```

Before every commit, run at least `npm run build` and `cargo test`.

## Conventions

- Cross-platform first: use `util::slash`, `util::venv_python`, `util::command` and the helpers in `platform.js`; never hard-code `/` paths, `bin/python` or macOS-only shortcuts.
- Shortcuts follow PyCharm's default keymap per OS (`platform.js`).
- Use `innerHTML` only for the built-in SVG icons. Set file names, test output and other dynamic text with `textContent`. HTML from the language server goes through `sanitizeHTML`.
- Keep the README feature list and shortcut table up to date in the same pull request as the feature.
