mod dap;
mod fs_ops;
#[cfg(target_os = "linux")]
mod linux;
mod lsp;
mod projects;
mod runner;
mod terminal;
mod tools;
mod util;

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Emitter, Wry};

/// macOS needs an Edit menu for clipboard shortcuts to reach the webview.
/// Undo/redo and "Close Window" are left out on purpose so that ⌘Z / ⌘W reach
/// the editor instead of being swallowed by native menu accelerators.
/// File, View and Settings… have no accelerators for the same reason: the webview
/// handles their shortcuts (which the user can change in Settings | Keymap), and a
/// click is sent to it as a "menu" event.
#[cfg(target_os = "macos")]
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let app_menu = Submenu::with_items(
        app,
        "Pyrite",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Pyrite"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Quit Pyrite"))?,
        ],
    )?;
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("newProject", "New Project…")?,
            &item("newElement", "New…")?,
            &PredefinedMenuItem::separator(app)?,
            &item("open", "Open…")?,
            &item("openFile", "Open File…")?,
            &item("recentProjects", "Recent Projects…")?,
            &item("closeProject", "Close Project")?,
            &PredefinedMenuItem::separator(app)?,
            &item("saveAll", "Save All")?,
            &item("reloadAll", "Reload All from Disk")?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("recentFiles", "Recent Files")?,
            &item("goToFile", "Go to File…")?,
            &PredefinedMenuItem::separator(app)?,
            &item("project", "Project")?,
            &item("runTool", "Run")?,
            &item("terminal", "Terminal")?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Has to come before GTK is initialised and before any thread exists,
    // because it works by setting environment variables.
    #[cfg(target_os = "linux")]
    linux::prepare();

    // Resolve the user's login-shell PATH early, off the main thread.
    std::thread::spawn(|| {
        util::user_path();
    });

    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    // Windows and Linux keep their native window frame and need no app menu.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_menu).on_menu_event(|app, event| {
        let _ = app.emit("menu", event.id().0.as_str());
    });
    builder
        .manage(runner::RunState::default())
        .manage(terminal::Terminals::default())
        .manage(lsp::LspServers::default())
        .manage(dap::DapSessions::default())
        .invoke_handler(tauri::generate_handler![
            fs_ops::list_dir,
            fs_ops::read_file,
            fs_ops::write_file,
            fs_ops::create_file,
            fs_ops::create_dir,
            fs_ops::rename_path,
            fs_ops::delete_path,
            fs_ops::list_files,
            runner::detect_interpreter,
            runner::interpreter_info,
            runner::run_python,
            runner::run_tests,
            runner::stop_run,
            runner::send_stdin,
            terminal::term_spawn,
            terminal::term_write,
            terminal::term_resize,
            terminal::term_kill,
            dap::free_port,
            dap::dap_connect,
            dap::dap_send,
            dap::dap_close,
            projects::projects_home,
            projects::find_pythons,
            projects::create_project,
            projects::has_uv,
            projects::list_packages,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            tools::tools_status,
            tools::tools_install,
            tools::ruff_check,
            tools::ruff_format,
            tools::ruff_optimize_imports,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pyrite");
}
