use crate::util::{self, Utf8Stream};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::thread;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};

/// Packages Pyrite installs into its private tools environment.
const PACKAGES: &[&str] = &["basedpyright", "ruff"];

#[derive(Serialize)]
pub struct ToolsStatus {
    /// Language server executable (basedpyright or pyright), if found.
    language_server: Option<String>,
    ruff: Option<String>,
    /// Where `tools_install` puts them.
    tools_dir: String,
}

/// Pyrite keeps its own virtualenv for code tools, like PyCharm bundles its helpers,
/// so they never end up in (or depend on) the user's project environment.
fn tools_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|d| d.join("tools")).map_err(|e| e.to_string())
}

fn exe(dir: &Path, name: &str) -> PathBuf {
    dir.join(util::VENV_BIN).join(if cfg!(windows) { format!("{name}.exe") } else { name.to_string() })
}

fn find(app: &AppHandle, names: &[&str]) -> Option<String> {
    let own = tools_dir(app).ok();
    names
        .iter()
        .find_map(|n| own.as_ref().map(|d| exe(d, n)).filter(|p| p.is_file()).or_else(|| util::which(n)))
        .map(|p| util::slash(&p))
}

#[tauri::command(async)]
pub fn tools_status(app: AppHandle) -> Result<ToolsStatus, String> {
    Ok(ToolsStatus {
        language_server: find(&app, &["basedpyright-langserver", "pyright-langserver"]),
        ruff: find(&app, &["ruff"]),
        tools_dir: util::slash(&tools_dir(&app)?),
    })
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InstallEvent {
    Log { data: String },
}

fn run_logged(program: &Path, args: &[&str], log: &Channel<InstallEvent>) -> Result<(), String> {
    let _ = log.send(InstallEvent::Log { data: format!("$ {} {}\n", program.display(), args.join(" ")) });
    let mut child = util::command(program)
        .args(args)
        .env("PATH", util::user_path())
        .env("PIP_DISABLE_PIP_VERSION_CHECK", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Cannot start {}: {e}", program.display()))?;
    let pumps: Vec<_> = [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as _)]
        .into_iter()
        .flatten()
        .map(|mut src| {
            let log = log.clone();
            thread::spawn(move || {
                let mut buf = [0u8; 4096];
                let mut decoder = Utf8Stream::default();
                while let Ok(n) = src.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let _ = log.send(InstallEvent::Log { data: decoder.push(&buf[..n]) });
                }
            })
        })
        .collect();
    for p in pumps {
        let _ = p.join();
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{} failed ({status})", program.display()))
    }
}

/// Creates the tools virtualenv with a system Python and installs basedpyright + Ruff.
#[tauri::command(async)]
pub fn tools_install(app: AppHandle, on_event: Channel<InstallEvent>) -> Result<ToolsStatus, String> {
    let dir = tools_dir(&app)?;
    let python = util::venv_python(&dir);
    if !python.is_file() {
        let system = util::which("python3")
            .or_else(|| util::which("python"))
            .or_else(|| util::which("py"))
            .ok_or("No Python found to create the tools environment with")?;
        std::fs::create_dir_all(dir.parent().unwrap_or(&dir)).map_err(|e| e.to_string())?;
        run_logged(&system, &["-m", "venv", &dir.to_string_lossy()], &on_event)?;
    }
    let mut args = vec!["-m", "pip", "install", "--upgrade"];
    args.extend(PACKAGES);
    run_logged(&python, &args, &on_event)?;
    tools_status(app)
}

/// Runs `program` with `input` on stdin and returns (success, stdout, stderr).
fn run_with_stdin(program: &str, args: &[&str], cwd: &str, input: String) -> Result<(bool, String, String), String> {
    let mut child = util::command(program)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Cannot start {program}: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    // Write on another thread so a large file can't deadlock against a full stdout pipe.
    let writer = thread::spawn(move || stdin.write_all(input.as_bytes()));
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let _ = writer.join();
    Ok((
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    ))
}

/// Lints unsaved editor text. Returns Ruff's JSON diagnostics.
#[tauri::command(async)]
pub fn ruff_check(ruff: String, path: String, cwd: String, text: String) -> Result<String, String> {
    let args = ["check", "--output-format=json", "--exit-zero", "--no-cache", "--stdin-filename", &path, "-"];
    let (ok, stdout, stderr) = run_with_stdin(&ruff, &args, &cwd, text)?;
    if ok { Ok(stdout) } else { Err(stderr) }
}

/// "Reformat Code": returns the formatted text.
#[tauri::command(async)]
pub fn ruff_format(ruff: String, path: String, cwd: String, text: String) -> Result<String, String> {
    let (ok, stdout, stderr) = run_with_stdin(&ruff, &["format", "--stdin-filename", &path, "-"], &cwd, text)?;
    if ok { Ok(stdout) } else { Err(first_line(&stderr)) }
}

/// "Optimize Imports": sorts imports and removes unused ones, like PyCharm.
#[tauri::command(async)]
pub fn ruff_optimize_imports(ruff: String, path: String, cwd: String, text: String) -> Result<String, String> {
    let args = ["check", "--select", "I,F401", "--fix", "--exit-zero", "--quiet", "--no-cache", "--stdin-filename", &path, "-"];
    let (ok, stdout, stderr) = run_with_stdin(&ruff, &args, &cwd, text)?;
    if ok { Ok(stdout) } else { Err(first_line(&stderr)) }
}

fn first_line(s: &str) -> String {
    s.lines().find(|l| !l.trim().is_empty()).unwrap_or("Ruff failed").to_string()
}
