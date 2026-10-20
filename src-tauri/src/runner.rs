use crate::util::{self, Utf8Stream};
use serde::Serialize;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct RunState {
    current: Mutex<Option<Arc<Mutex<Child>>>>,
    stdin: Mutex<Option<ChildStdin>>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunEvent {
    Stdout { data: String },
    Stderr { data: String },
    Exit { code: i32 },
}

#[derive(Serialize)]
pub struct InterpreterInfo {
    path: String,
    version: String,
    /// Root folder of the virtual environment, if this interpreter lives in one.
    venv: Option<String>,
}

fn venv_root(python: &Path) -> Option<PathBuf> {
    // <venv>/bin/python (Scripts\python.exe on Windows)  →  <venv>/pyvenv.cfg
    let root = python.parent()?.parent()?;
    root.join("pyvenv.cfg").is_file().then(|| root.to_path_buf())
}

fn describe(python: &Path) -> Result<InterpreterInfo, String> {
    let out = util::command(python)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Cannot start {}: {e}", python.display()))?;
    let text = if out.stdout.is_empty() { out.stderr } else { out.stdout };
    let version = String::from_utf8_lossy(&text).trim().trim_start_matches("Python ").to_string();
    Ok(InterpreterInfo {
        path: util::slash(python),
        version,
        venv: venv_root(python).map(|p| util::slash(&p)),
    })
}

/// Same order PyCharm uses when it auto-detects a project interpreter:
/// an in-project virtualenv first, then the system Python.
#[tauri::command(async)]
pub fn detect_interpreter(root: String) -> Result<InterpreterInfo, String> {
    let root = Path::new(&root);
    for venv in [".venv", "venv", "env", ".env"] {
        let candidate = util::venv_python(&root.join(venv));
        if candidate.is_file() {
            return describe(&candidate);
        }
    }
    let system = util::which("python3")
        .or_else(|| util::which("python"))
        .or_else(|| util::which("py"))
        .ok_or("No Python interpreter found on PATH")?;
    describe(&system)
}

/// `path` may be a Python executable or a virtualenv folder.
#[tauri::command(async)]
pub fn interpreter_info(path: String) -> Result<InterpreterInfo, String> {
    let path = Path::new(&path);
    if path.is_dir() {
        let python = util::venv_python(path);
        if !python.is_file() {
            return Err(format!("{} is not a virtual environment", path.display()));
        }
        return describe(&python);
    }
    describe(path)
}

fn exit_code(status: ExitStatus) -> i32 {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(sig) = status.signal() {
            return 128 + sig;
        }
    }
    status.code().unwrap_or(-1)
}

fn pump(mut src: impl Read + Send + 'static, ch: Channel<RunEvent>, stderr: bool) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut decoder = Utf8Stream::default();
        while let Ok(n) = src.read(&mut buf) {
            if n == 0 {
                break;
            }
            let data = decoder.push(&buf[..n]);
            if data.is_empty() {
                continue;
            }
            let event = if stderr { RunEvent::Stderr { data } } else { RunEvent::Stdout { data } };
            if ch.send(event).is_err() {
                break;
            }
        }
    })
}

fn kill_current(state: &RunState) {
    if let Some(child) = state.current.lock().unwrap().take() {
        let _ = child.lock().unwrap().kill();
    }
    state.stdin.lock().unwrap().take();
}

/// Follows the pytest plugin's JSON-lines report while the tests run.
fn tail_report(path: PathBuf, ch: Channel<String>, done: Arc<AtomicBool>) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let Ok(file) = File::open(&path) else { return };
        let mut reader = BufReader::new(file);
        let mut line = String::new();
        loop {
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => {
                    // Check `done` before the final read, so nothing written at exit is missed.
                    if done.load(Ordering::Acquire) && reader.read_line(&mut line).map_or(true, |n| n == 0) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(30));
                }
                Ok(_) => {}
            }
            if line.ends_with('\n') {
                if ch.send(line.trim_end().to_string()).is_err() {
                    break;
                }
                line.clear();
            }
        }
        let _ = std::fs::remove_file(&path);
    })
}

/// Runs `interpreter args…` in the Run tool window: output streams to `on_event`,
/// and an optional test report is followed until the process exits.
fn spawn_run(
    interpreter: &str,
    args: &[String],
    cwd: &str,
    env: &[(&str, String)],
    report: Option<(PathBuf, Channel<String>)>,
    on_event: Channel<RunEvent>,
    state: &RunState,
) -> Result<(), String> {
    kill_current(state);

    let mut cmd = util::command(interpreter);
    cmd.args(args)
        .current_dir(cwd)
        .env("PATH", util::user_path())
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in env {
        cmd.env(key, value);
    }
    if let Some(venv) = venv_root(Path::new(interpreter)) {
        cmd.env("VIRTUAL_ENV", venv);
    }

    let mut child = cmd.spawn().map_err(|e| format!("Cannot start {interpreter}: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    *state.stdin.lock().unwrap() = child.stdin.take();

    let child = Arc::new(Mutex::new(child));
    *state.current.lock().unwrap() = Some(child.clone());

    let out_thread = pump(stdout, on_event.clone(), false);
    let err_thread = pump(stderr, on_event.clone(), true);
    let done = Arc::new(AtomicBool::new(false));
    let tail_thread = report.map(|(path, ch)| tail_report(path, ch, done.clone()));

    thread::spawn(move || {
        // Drain all output before announcing the exit so it always comes last.
        let _ = out_thread.join();
        let _ = err_thread.join();
        let code = loop {
            match child.lock().unwrap().try_wait() {
                Ok(Some(status)) => break exit_code(status),
                Ok(None) => {}
                Err(_) => break -1,
            }
            thread::sleep(Duration::from_millis(20));
        };
        done.store(true, Ordering::Release);
        if let Some(t) = tail_thread {
            let _ = t.join();
        }
        let _ = on_event.send(RunEvent::Exit { code });
    });
    Ok(())
}

/// Runs a Python file (`["-u", script]`) or any interpreter arguments, e.g. `-m pip install pytest`.
#[tauri::command]
pub fn run_python(
    interpreter: String,
    args: Vec<String>,
    cwd: String,
    on_event: Channel<RunEvent>,
    state: State<'_, RunState>,
) -> Result<(), String> {
    spawn_run(&interpreter, &args, &cwd, &[], None, on_event, &state)
}

const PYTEST_PLUGIN: &str = include_str!("../helpers/pyrite_pytest.py");

/// Runs pytest on `targets` (files, folders or node ids) with Pyrite's reporting plugin.
/// Test events arrive on `on_test` as JSON strings; console output on `on_event`.
#[tauri::command]
pub fn run_tests(
    app: AppHandle,
    interpreter: String,
    targets: Vec<String>,
    cwd: String,
    on_event: Channel<RunEvent>,
    on_test: Channel<String>,
    state: State<'_, RunState>,
) -> Result<(), String> {
    let helpers = app.path().app_data_dir().map_err(|e| e.to_string())?.join("helpers");
    std::fs::create_dir_all(&helpers).map_err(|e| e.to_string())?;
    std::fs::write(helpers.join("pyrite_pytest.py"), PYTEST_PLUGIN).map_err(|e| e.to_string())?;

    static RUNS: AtomicU32 = AtomicU32::new(0);
    let report = std::env::temp_dir().join(format!(
        "pyrite-tests-{}-{}.jsonl",
        std::process::id(),
        RUNS.fetch_add(1, Ordering::Relaxed)
    ));
    File::create(&report).map_err(|e| e.to_string())?;

    let python_path = std::env::join_paths(
        std::iter::once(helpers).chain(std::env::var_os("PYTHONPATH").iter().flat_map(std::env::split_paths)),
    )
    .map_err(|e| e.to_string())?;
    let env = [
        ("PYTHONPATH", python_path.to_string_lossy().into_owned()),
        ("PYRITE_TEST_REPORT", report.to_string_lossy().into_owned()),
    ];
    let mut args: Vec<String> = ["-m", "pytest", "-p", "pyrite_pytest"].map(String::from).to_vec();
    args.extend(targets);
    spawn_run(&interpreter, &args, &cwd, &env, Some((report, on_test)), on_event, &state)
}

#[tauri::command]
pub fn stop_run(state: State<'_, RunState>) {
    kill_current(&state);
}

#[tauri::command]
pub fn send_stdin(data: String, state: State<'_, RunState>) -> Result<(), String> {
    let mut stdin = state.stdin.lock().unwrap();
    let pipe = stdin.as_mut().ok_or("Process is not running")?;
    pipe.write_all(data.as_bytes()).and_then(|_| pipe.flush()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::InvokeResponseBody;

    #[test]
    fn tail_report_delivers_lines_written_until_exit() {
        let path = std::env::temp_dir().join(format!("pyrite-tail-test-{}.jsonl", std::process::id()));
        std::fs::write(&path, "").unwrap();
        let got = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = got.clone();
        let ch = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(serde_json::from_str(&json).unwrap());
            }
            Ok(())
        });
        let done = Arc::new(AtomicBool::new(false));
        let tail = tail_report(path.clone(), ch, done.clone());

        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        f.write_all(b"{\"a\":1}\n{\"b\":").unwrap(); // second line still being written
        f.flush().unwrap();
        thread::sleep(Duration::from_millis(100));
        f.write_all(b"2}\n{\"c\":3}\n").unwrap();
        f.flush().unwrap();
        done.store(true, Ordering::Release); // the process exited right after writing
        tail.join().unwrap();

        assert_eq!(*got.lock().unwrap(), ["{\"a\":1}", "{\"b\":2}", "{\"c\":3}"]);
        assert!(!path.exists(), "report file is cleaned up");
    }
}
