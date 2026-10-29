mod commands;
mod config;
mod db;
mod error;
mod library;
mod models;
mod repo;
mod slicer;
mod status;
mod sync;
mod watcher;

use std::sync::Mutex;

use commands::{AppState, Inner};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config_file = config::config_file();
            let cfg = config::load(&config_file);
            app.manage(AppState(Mutex::new(Inner {
                conn: None,
                lib: cfg.library_path.clone(),
                config_file,
                watcher: None,
            })));
            let (conn, w) = commands::open_library(app.handle(), cfg.library_path)?;
            let state = app.state::<AppState>();
            let mut inner = state.0.lock().expect("fresh state");
            inner.conn = Some(conn);
            inner.watcher = Some(w);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::set_setting,
            commands::move_library,
            commands::list_projects,
            commands::create_project,
            commands::update_project,
            commands::delete_project,
            commands::list_queues,
            commands::create_queue,
            commands::rename_queue,
            commands::delete_queue,
            commands::list_items,
            commands::import_files,
            commands::update_item,
            commands::item_action,
            commands::delete_item,
            commands::item_history,
            commands::list_unassigned,
            commands::attach_file,
            commands::item_from_file,
            commands::open_in_slicer,
            commands::reveal_item,
            commands::read_model,
            commands::save_thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
