use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

/// Apps launched from Finder get a minimal PATH (/usr/bin:/bin:...), so
/// Homebrew/pyenv/uv Pythons would be invisible. Ask the login shell once.
pub fn user_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let mut parts: Vec<String> = Vec::new();
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        if let Ok(out) = Command::new(&shell)
            .args(["-lc", "printf %s \"$PATH\""])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
        {
            if out.status.success() {
                parts.extend(String::from_utf8_lossy(&out.stdout).split(':').map(String::from));
            }
        }
        if let Ok(p) = env::var("PATH") {
            parts.extend(p.split(':').map(String::from));
        }
        if let Ok(home) = env::var("HOME") {
            parts.push(format!("{home}/.local/bin"));
        }
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
            parts.push(extra.into());
        }
        let mut seen = std::collections::HashSet::new();
        parts
            .into_iter()
            .filter(|p| !p.is_empty() && seen.insert(p.clone()))
            .collect::<Vec<_>>()
            .join(":")
    })
}

pub fn which(bin: &str) -> Option<PathBuf> {
    user_path()
        .split(':')
        .map(|dir| Path::new(dir).join(bin))
        .find(|p| p.is_file())
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
