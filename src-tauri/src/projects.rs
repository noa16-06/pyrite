use crate::runner::{self, InterpreterInfo};
use crate::util;
use serde::Deserialize;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Manager};

/// Where new projects go by default, like PyCharm's `~/PycharmProjects`.
#[tauri::command]
pub fn projects_home(app: AppHandle) -> Result<String, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(util::slash(&home.join("PyriteProjects")))
}

/// `python3.12`, `python3`, `python`, … (and `py` on Windows).
fn is_python_name(name: &str) -> bool {
    let stem = name.strip_suffix(".exe").unwrap_or(name);
    let Some(rest) = stem.strip_prefix("python") else { return stem == "py" };
    rest.is_empty() || rest.chars().all(|c| c.is_ascii_digit() || c == '.')
}

/// System interpreters on PATH, offered as the base for a new project's virtualenv.
#[tauri::command(async)]
pub fn find_pythons() -> Vec<InterpreterInfo> {
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    for dir in env::split_paths(util::user_path()) {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        let mut names: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .filter(|e| is_python_name(&e.file_name().to_string_lossy()))
            .map(|e| e.path())
            .filter(|p| p.is_file() && !p.to_string_lossy().contains("WindowsApps"))
            .collect();
        names.sort();
        for path in names {
            // python, python3 and python3.12 are usually links to one binary.
            let real = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
            if !seen.insert(real) {
                continue;
            }
            if let Ok(info) = runner::describe(&path) {
                if info.version.chars().next().is_some_and(|c| c.is_ascii_digit()) {
                    found.push(info);
                }
            }
        }
    }
    found
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    path: String,
    /// "venv" (python -m venv), "uv" (uv venv) or "base" (use `python` directly).
    env: String,
    python: String,
    git: bool,
}

fn run(program: &Path, args: &[&str], cwd: &Path) -> Result<(), String> {
    let out = util::command(program)
        .args(args)
        .current_dir(cwd)
        .env("PATH", util::user_path())
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Cannot start {}: {e}", program.display()))?;
    if out.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(format!("{} {} failed: {}", program.display(), args.join(" "), err.trim()))
    }
}

/// Creates the project folder, its interpreter environment and (optionally) a git repository,
/// and returns the interpreter the project should use.
#[tauri::command(async)]
pub fn create_project(project: NewProject) -> Result<InterpreterInfo, String> {
    let root = PathBuf::from(&project.path);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let python = Path::new(&project.python);
    let interpreter = match project.env.as_str() {
        "venv" | "uv" => {
            let venv = root.join(".venv");
            if venv.exists() {
                return Err(format!("Environment \"{}\" already exists in the specified folder", util::slash(&venv)));
            }
            if project.env == "uv" {
                let uv = util::which("uv").ok_or("No uv executable found")?;
                run(&uv, &["venv", ".venv", "--python", &project.python], &root)?;
            } else {
                run(python, &["-m", "venv", ".venv"], &root)?;
            }
            util::venv_python(&venv)
        }
        _ => python.to_path_buf(),
    };
    if project.git {
        let git = util::which("git").ok_or("Git is not installed, so no repository was created")?;
        if !root.join(".git").exists() {
            run(&git, &["init", "--quiet"], &root)?;
        }
        let ignore = root.join(".gitignore");
        if !ignore.exists() {
            fs::write(&ignore, ".venv/\n__pycache__/\n*.py[cod]\n").map_err(|e| e.to_string())?;
        }
    }
    runner::describe(&interpreter)
}

#[derive(Deserialize, serde::Serialize)]
pub struct Package {
    name: String,
    version: String,
}

/// Settings | Project | Python Interpreter: the packages installed for an interpreter.
#[tauri::command(async)]
pub fn list_packages(interpreter: String) -> Result<Vec<Package>, String> {
    let out = util::command(&interpreter)
        .args(["-m", "pip", "list", "--format=json", "--disable-pip-version-check"])
        .env("PATH", util::user_path())
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Cannot start {interpreter}: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(if err.contains("No module named pip") {
            "pip is not installed for this interpreter".into()
        } else {
            err.trim().lines().last().unwrap_or("pip list failed").to_string()
        });
    }
    // pip can print warnings before the JSON, so parse from the first '['.
    let text = String::from_utf8_lossy(&out.stdout);
    let json = &text[text.find('[').unwrap_or(0)..];
    serde_json::from_str(json).map_err(|e| e.to_string())
}

/// Whether uv is installed, so the New Project dialog can offer it.
#[tauri::command(async)]
pub fn has_uv() -> bool {
    util::which("uv").is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_a_project_with_venv_and_git() {
        let Some(python) = util::which("python3").or_else(|| util::which("python")) else { return };
        let root = env::temp_dir().join(format!("pyrite-new-project-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let project = NewProject {
            path: util::slash(&root),
            env: "venv".into(),
            python: util::slash(&python),
            git: util::which("git").is_some(),
        };
        let info = create_project(project).expect("project is created");
        assert!(util::venv_python(&root.join(".venv")).is_file());
        assert!(info.venv.is_some());
        if util::which("git").is_some() {
            assert!(root.join(".git").is_dir());
            assert!(fs::read_to_string(root.join(".gitignore")).unwrap().contains(".venv/"));
        }
        let packages = list_packages(util::slash(&util::venv_python(&root.join(".venv")))).expect("pip list works");
        assert!(packages.iter().any(|p| p.name == "pip"));
        let again = NewProject { path: util::slash(&root), env: "venv".into(), python: util::slash(&python), git: false };
        assert!(create_project(again).unwrap_err().contains("already exists"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn recognises_python_executables() {
        for name in ["python", "python3", "python3.12", "python.exe", "py", "py.exe"] {
            assert!(is_python_name(name), "{name}");
        }
        for name in ["python3-config", "python3.12-config", "pydoc3", "pyright", "ipython"] {
            assert!(!is_python_name(name), "{name}");
        }
    }
}
