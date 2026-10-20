use crate::util;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use tauri::ipc::Channel;
use tauri::State;

/// A language server speaking JSON-RPC over stdio. The frontend's LSP client
/// does the protocol work; this side only frames messages and owns the process.
struct Server {
    child: Child,
    stdin: ChildStdin,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
pub struct LspServers {
    servers: Mutex<HashMap<u32, Server>>,
    next_id: AtomicU32,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LspEvent {
    Message { data: String },
    Exit { stderr: String },
}

/// Reads one `Content-Length`-framed message (LSP and DAP use the same framing).
/// Returns None at end of stream.
pub(crate) fn read_message(reader: &mut impl BufRead) -> Option<String> {
    let mut length = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse::<usize>().ok();
            }
        }
    }
    let mut body = vec![0; length?];
    reader.read_exact(&mut body).ok()?;
    Some(String::from_utf8_lossy(&body).into_owned())
}

/// Starts a language server. `interpreter` (the project's Python) goes first on
/// PATH so the server resolves the same packages the code will run with.
#[tauri::command(async)]
pub fn lsp_start(
    command: String,
    args: Vec<String>,
    cwd: String,
    interpreter: Option<String>,
    on_event: Channel<LspEvent>,
    state: State<'_, LspServers>,
) -> Result<u32, String> {
    let mut path = util::user_path().to_string();
    let mut cmd = util::command(&command);
    if let Some(python) = interpreter.as_deref().map(Path::new) {
        if let Some(bin) = python.parent() {
            let dirs = std::iter::once(bin.to_path_buf()).chain(std::env::split_paths(&path));
            path = std::env::join_paths(dirs).map(|p| p.to_string_lossy().into_owned()).unwrap_or(path);
            if let Some(venv) = bin.parent().filter(|v| v.join("pyvenv.cfg").is_file()) {
                cmd.env("VIRTUAL_ENV", venv);
            }
        }
    }
    let mut child = cmd
        .args(&args)
        .current_dir(&cwd)
        .env("PATH", path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Cannot start {command}: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let stdin = child.stdin.take().ok_or("no stdin")?;

    // Keep the tail of stderr so a crashing server can be explained to the user.
    let stderr_thread = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        let text = String::from_utf8_lossy(&buf);
        let tail: Vec<&str> = text.lines().rev().take(20).collect();
        tail.into_iter().rev().collect::<Vec<_>>().join("\n")
    });
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Some(data) = read_message(&mut reader) {
            if on_event.send(LspEvent::Message { data }).is_err() {
                return;
            }
        }
        let stderr = stderr_thread.join().unwrap_or_default();
        let _ = on_event.send(LspEvent::Exit { stderr });
    });

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.servers.lock().unwrap().insert(id, Server { child, stdin });
    Ok(id)
}

#[tauri::command]
pub fn lsp_send(id: u32, message: String, state: State<'_, LspServers>) -> Result<(), String> {
    let mut servers = state.servers.lock().unwrap();
    let server = servers.get_mut(&id).ok_or("language server is not running")?;
    let frame = format!("Content-Length: {}\r\n\r\n{message}", message.len());
    server.stdin.write_all(frame.as_bytes()).and_then(|_| server.stdin.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lsp_stop(id: u32, state: State<'_, LspServers>) {
    state.servers.lock().unwrap().remove(&id); // Drop kills the process
}

#[cfg(test)]
mod tests {
    use super::read_message;
    use std::io::Cursor;

    #[test]
    fn reads_framed_messages() {
        let body = r#"{"jsonrpc":"2.0","id":1,"result":"✓"}"#;
        let input = format!("Content-Length: {}\r\nContent-Type: x\r\n\r\n{body}Content-Length: 2\r\n\r\n{{}}", body.len());
        let mut cursor = Cursor::new(input.into_bytes());
        assert_eq!(read_message(&mut cursor).as_deref(), Some(body));
        assert_eq!(read_message(&mut cursor).as_deref(), Some("{}"));
        assert_eq!(read_message(&mut cursor), None);
    }
}
