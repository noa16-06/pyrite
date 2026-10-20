use crate::util::{self, Utf8Stream};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use tauri::ipc::Channel;
use tauri::State;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals {
    sessions: Mutex<HashMap<u32, Session>>,
    next_id: AtomicU32,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TermEvent {
    Data { data: String },
    Exit,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

/// Spawns the user's login shell in a pseudo-terminal, like PyCharm's
/// Terminal tool window, and activates the project's virtualenv if there is one.
#[tauri::command(async)]
pub fn term_spawn(
    cwd: String,
    cols: u16,
    rows: u16,
    venv: Option<String>,
    on_event: Channel<TermEvent>,
    state: State<'_, Terminals>,
) -> Result<u32, String> {
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;

    let shell = util::default_shell();
    let mut cmd = CommandBuilder::new(&shell);
    if cfg!(unix) {
        cmd.arg("-l");
    } else if shell.file_stem().is_some_and(|n| n.eq_ignore_ascii_case("pwsh") || n.eq_ignore_ascii_case("powershell")) {
        cmd.arg("-NoLogo");
    }
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Pyrite");

    // Windows has no login profile that rewrites PATH, and PowerShell's execution
    // policy often blocks Activate.ps1, so activate the venv through the environment.
    let mut path = util::user_path().to_string();
    if cfg!(windows) {
        if let Some(venv) = &venv {
            let bin = Path::new(venv).join(util::VENV_BIN);
            path = std::env::join_paths(std::iter::once(bin).chain(std::env::split_paths(&path)))
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or(path);
            cmd.env("VIRTUAL_ENV", venv);
        }
    }
    cmd.env("PATH", path);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Login profiles (e.g. macOS path_helper) rewrite PATH, so activate the venv
    // after the shell has started instead of only setting environment variables.
    #[cfg(unix)]
    if let Some(venv) = venv {
        let fish = Path::new(&shell).file_name().is_some_and(|n| n == "fish");
        let script = Path::new(&venv).join("bin").join(if fish { "activate.fish" } else { "activate" });
        if script.is_file() {
            let quoted = script.to_string_lossy().replace('\'', "'\\''");
            let _ = writer.write_all(format!(" source '{quoted}'\n").as_bytes());
        }
    }

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    thread::spawn(move || {
        let mut buf = [0u8; 16384];
        let mut decoder = Utf8Stream::default();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = decoder.push(&buf[..n]);
                    if !data.is_empty() && on_event.send(TermEvent::Data { data }).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = on_event.send(TermEvent::Exit);
    });

    state
        .sessions
        .lock()
        .unwrap()
        .insert(id, Session { master: pair.master, writer, child });
    Ok(id)
}

#[tauri::command]
pub fn term_write(id: u32, data: String, state: State<'_, Terminals>) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("terminal closed")?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn term_resize(id: u32, cols: u16, rows: u16, state: State<'_, Terminals>) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let session = sessions.get(&id).ok_or("terminal closed")?;
    session.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn term_kill(id: u32, state: State<'_, Terminals>) {
    if let Some(mut session) = state.sessions.lock().unwrap().remove(&id) {
        let _ = session.child.kill();
    }
}
