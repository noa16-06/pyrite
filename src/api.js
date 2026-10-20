import { invoke, Channel } from "@tauri-apps/api/core";

export { Channel };

export const api = {
  listDir: (path) => invoke("list_dir", { path }),
  readFile: (path) => invoke("read_file", { path }),
  writeFile: (path, contents) => invoke("write_file", { path, contents }),
  createFile: (path) => invoke("create_file", { path }),
  createDir: (path) => invoke("create_dir", { path }),
  renamePath: (from, to) => invoke("rename_path", { from, to }),
  deletePath: (path) => invoke("delete_path", { path }),
  listFiles: (root) => invoke("list_files", { root }),

  detectInterpreter: (root) => invoke("detect_interpreter", { root }),
  interpreterInfo: (path) => invoke("interpreter_info", { path }),
  runPython: (interpreter, args, cwd, onEvent) => invoke("run_python", { interpreter, args, cwd, onEvent }),
  runTests: (interpreter, targets, cwd, onEvent, onTest) => invoke("run_tests", { interpreter, targets, cwd, onEvent, onTest }),
  stopRun: () => invoke("stop_run"),
  sendStdin: (data) => invoke("send_stdin", { data }),

  termSpawn: (cwd, cols, rows, venv, onEvent) => invoke("term_spawn", { cwd, cols, rows, venv, onEvent }),
  termWrite: (id, data) => invoke("term_write", { id, data }),
  termResize: (id, cols, rows) => invoke("term_resize", { id, cols, rows }),
  termKill: (id) => invoke("term_kill", { id }),

  lspStart: (command, args, cwd, interpreter, onEvent) => invoke("lsp_start", { command, args, cwd, interpreter, onEvent }),
  lspSend: (id, message) => invoke("lsp_send", { id, message }),
  lspStop: (id) => invoke("lsp_stop", { id }),

  toolsStatus: () => invoke("tools_status"),
  toolsInstall: (onEvent) => invoke("tools_install", { onEvent }),
  ruffCheck: (ruff, path, cwd, text) => invoke("ruff_check", { ruff, path, cwd, text }),
  ruffFormat: (ruff, path, cwd, text) => invoke("ruff_format", { ruff, path, cwd, text }),
  ruffOptimizeImports: (ruff, path, cwd, text) => invoke("ruff_optimize_imports", { ruff, path, cwd, text }),
};

export const basename = (p) => p.replace(/\/+$/, "").split("/").pop();
export const dirname = (p) => p.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
export const join = (...parts) => parts.join("/").replace(/\/{2,}/g, "/");
