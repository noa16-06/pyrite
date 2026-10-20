use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Never shown in the project tree.
const HIDDEN: &[&str] = &[
    ".git", ".DS_Store", "__pycache__", ".idea", ".mypy_cache", ".pytest_cache", ".ruff_cache",
];

/// Shown in the tree, but not indexed for "Go to File" (like PyCharm's excluded folders).
const EXCLUDED: &[&str] = &[".venv", "venv", "env", "node_modules", "build", "dist", ".tox", "target"];

const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_INDEXED_FILES: usize = 20_000;

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut entries: Vec<Entry> = fs::read_dir(&path)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if HIDDEN.contains(&name.as_str()) {
                return None;
            }
            let path = e.path();
            // fs::metadata follows symlinks, so linked folders behave like folders.
            let is_dir = fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false);
            Some(Entry { name, path: path.to_string_lossy().into_owned(), is_dir })
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("File is too large to open ({} MB)", meta.len() / 1024 / 1024));
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "Binary or non-UTF-8 file — cannot be opened in the editor".into())
}

#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_file(path: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err("A file or folder with that name already exists".into());
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err("A file or folder with that name already exists".into());
    }
    fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// Moves to the system Trash rather than deleting permanently.
#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// Project-relative paths of all files, for "Go to File".
#[tauri::command(async)]
pub fn list_files(root: String) -> Result<Vec<String>, String> {
    let root = PathBuf::from(root);
    let mut out = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(read) = fs::read_dir(&dir) else { continue };
        for entry in read.filter_map(Result::ok) {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if HIDDEN.contains(&name.as_ref()) || EXCLUDED.contains(&name.as_ref()) {
                continue;
            }
            let Ok(ft) = entry.file_type() else { continue };
            let path = entry.path();
            if ft.is_dir() {
                stack.push(path);
            } else if let Ok(rel) = path.strip_prefix(&root) {
                out.push(rel.to_string_lossy().into_owned());
                if out.len() >= MAX_INDEXED_FILES {
                    return Ok(out);
                }
            }
        }
    }
    out.sort();
    Ok(out)
}
