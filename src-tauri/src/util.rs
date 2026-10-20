use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

/// Apps launched from Finder get a minimal PATH (/usr/bin:/bin:...), so
/// Homebrew/pyenv/uv Pythons would be invisible. Ask the login shell once.
/// Windows GUI apps inherit the full user PATH, so there it is used as-is.
pub fn user_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let mut parts: Vec<PathBuf> = Vec::new();
        #[cfg(unix)]
        if let Ok(out) = Command::new(default_shell())
            .args(["-lc", "printf %s \"$PATH\""])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
        {
            if out.status.success() {
                parts.extend(env::split_paths(&String::from_utf8_lossy(&out.stdout).into_owned()));
            }
        }
        if let Some(p) = env::var_os("PATH") {
            parts.extend(env::split_paths(&p));
        }
        #[cfg(unix)]
        {
            if let Some(home) = env::var_os("HOME") {
                parts.push(Path::new(&home).join(".local/bin"));
            }
            for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
                parts.push(extra.into());
            }
        }
        let mut seen = std::collections::HashSet::new();
        parts.retain(|p| !p.as_os_str().is_empty() && seen.insert(p.clone()));
        env::join_paths(parts).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
    })
}

pub fn which(bin: &str) -> Option<PathBuf> {
    let name = if cfg!(windows) { format!("{bin}.exe") } else { bin.to_string() };
    env::split_paths(user_path())
        .map(|dir| dir.join(&name))
        // Skip the Microsoft Store "python.exe" stubs, which only open the Store.
        .find(|p| p.is_file() && !p.to_string_lossy().contains("WindowsApps"))
}

/// The user's interactive shell: $SHELL on Unix, PowerShell (or cmd) on Windows.
pub fn default_shell() -> PathBuf {
    #[cfg(windows)]
    {
        which("pwsh")
            .or_else(|| which("powershell"))
            .or_else(|| env::var_os("COMSPEC").map(PathBuf::from))
            .unwrap_or_else(|| "cmd.exe".into())
    }
    #[cfg(unix)]
    {
        env::var_os("SHELL")
            .map(PathBuf::from)
            .filter(|p| p.is_file())
            .or_else(|| ["/bin/zsh", "/bin/bash"].into_iter().map(PathBuf::from).find(|p| p.is_file()))
            .unwrap_or_else(|| "/bin/sh".into())
    }
}

/// Where a virtualenv keeps its executables.
pub const VENV_BIN: &str = if cfg!(windows) { "Scripts" } else { "bin" };

pub fn venv_python(venv: &Path) -> PathBuf {
    venv.join(VENV_BIN).join(if cfg!(windows) { "python.exe" } else { "python" })
}

/// Paths are sent to the frontend with forward slashes on every OS
/// (Windows accepts them too), so it only has to deal with one separator.
pub fn slash(path: &Path) -> String {
    let s = path.to_string_lossy();
    if cfg!(windows) { s.replace('\\', "/") } else { s.into_owned() }
}

/// Keeps console programs started from the GUI from flashing a window on Windows.
pub fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Turns a byte stream into UTF-8 text without splitting multi-byte characters
/// across chunk boundaries.
#[derive(Default)]
pub struct Utf8Stream {
    pending: Vec<u8>,
}

impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        match std::str::from_utf8(&self.pending) {
            Ok(s) => {
                let s = s.to_owned();
                self.pending.clear();
                s
            }
            Err(e) if e.error_len().is_none() => {
                // Incomplete character at the end: keep it for the next chunk.
                let valid = e.valid_up_to();
                let s = String::from_utf8_lossy(&self.pending[..valid]).into_owned();
                self.pending.drain(..valid);
                s
            }
            Err(_) => {
                let s = String::from_utf8_lossy(&self.pending).into_owned();
                self.pending.clear();
                s
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Utf8Stream;

    #[test]
    fn keeps_split_multibyte_chars_together() {
        let bytes = "héllo ✓".as_bytes();
        let mut s = Utf8Stream::default();
        let mut out = String::new();
        for b in bytes {
            out += &s.push(std::slice::from_ref(b));
        }
        assert_eq!(out, "héllo ✓");
    }

    #[test]
    fn replaces_invalid_bytes() {
        let mut s = Utf8Stream::default();
        assert_eq!(s.push(&[b'a', 0xFF, b'b']), "a\u{FFFD}b");
    }
}

#[cfg(test)]
mod path_tests {
    use super::*;

    #[test]
    fn venv_python_uses_platform_layout() {
        let p = venv_python(Path::new("proj/.venv"));
        let expected = if cfg!(windows) { "proj/.venv/Scripts/python.exe" } else { "proj/.venv/bin/python" };
        assert_eq!(slash(&p), expected);
    }

    #[test]
    fn user_path_is_not_empty() {
        assert!(!user_path().is_empty());
    }
}
