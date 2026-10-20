use crate::lsp::read_message;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufReader, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::State;

/// Connections to debugpy's adapter. The program runs in the Run tool window
/// (`python debugpy --listen … script.py`), so its console and stdin work as usual;
/// this side only carries Debug Adapter Protocol messages over TCP.
#[derive(Default)]
pub struct DapSessions {
    sessions: Mutex<HashMap<u32, TcpStream>>,
    next_id: AtomicU32,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DapEvent {
    Message { data: String },
    Closed,
}

/// A free localhost port for debugpy to listen on.
#[tauri::command]
pub fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

/// Connects to the debug adapter, retrying while debugpy starts up.
#[tauri::command(async)]
pub fn dap_connect(port: u16, on_event: Channel<DapEvent>, state: State<'_, DapSessions>) -> Result<u32, String> {
    let deadline = Instant::now() + Duration::from_secs(20);
    let stream = loop {
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(s) => break s,
            Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(format!("Could not connect to the debugger: {e}")),
        }
    };
    let _ = stream.set_nodelay(true);
    let reader = stream.try_clone().map_err(|e| e.to_string())?;
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        while let Some(data) = read_message(&mut reader) {
            if on_event.send(DapEvent::Message { data }).is_err() {
                return;
            }
        }
        let _ = on_event.send(DapEvent::Closed);
    });
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.sessions.lock().unwrap().insert(id, stream);
    Ok(id)
}

#[tauri::command]
pub fn dap_send(id: u32, message: String, state: State<'_, DapSessions>) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let stream = sessions.get_mut(&id).ok_or("debug session has ended")?;
    let frame = format!("Content-Length: {}\r\n\r\n{message}", message.len());
    stream.write_all(frame.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dap_close(id: u32, state: State<'_, DapSessions>) {
    if let Some(stream) = state.sessions.lock().unwrap().remove(&id) {
        let _ = stream.shutdown(Shutdown::Both);
    }
}
