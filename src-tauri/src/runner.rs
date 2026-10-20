use crate::util::{self, Utf8Stream};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;

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

#[tauri::command]
pub fn run_python(
    interpreter: String,
    script: String,
    cwd: String,
    on_event: Channel<RunEvent>,
    state: State<'_, RunState>,
) -> Result<(), String> {
    kill_current(&state);

    let mut cmd = util::command(&interpreter);
    cmd.arg("-u")
        .arg(&script)
        .current_dir(&cwd)
        .env("PATH", util::user_path())
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(venv) = venv_root(Path::new(&interpreter)) {
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
        let _ = on_event.send(RunEvent::Exit { code });
    });
    Ok(())
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
