use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::models::{Item, ItemPatch, PrintEvent, Project, ProjectSummary, Queue, QueueSummary};
use crate::repo::{self, ImportResult};
use crate::status::{self, Action};
use crate::watcher::{self, LibraryWatcher};
use crate::{config, db, library, slicer, sync};

pub const LIBRARY_CHANGED: &str = "library-changed";

pub struct Inner {
    pub conn: Option<Connection>,
    pub lib: PathBuf,
    pub config_file: PathBuf,
    pub watcher: Option<LibraryWatcher>,
}

pub struct AppState(pub Mutex<Inner>);

impl AppState {
    fn with<T>(&self, f: impl FnOnce(&Connection, &PathBuf) -> AppResult<T>) -> AppResult<T> {
        let inner = self
            .0
            .lock()
            .map_err(|_| AppError::Invalid("state poisoned".into()))?;
        let conn = inner
            .conn
            .as_ref()
            .ok_or_else(|| AppError::Invalid("library is not open".into()))?;
        f(conn, &inner.lib)
    }
}

/// Opens the library database and starts watching its folders.
pub fn open_library(app: &AppHandle, lib: PathBuf) -> AppResult<(Connection, LibraryWatcher)> {
    let conn = db::open(&lib.join("planner.db"))?;
    let handle = app.clone();
    let watch_lib = lib.clone();
    let w = watcher::start(&lib, move |paths| {
        let state = handle.state::<AppState>();
        if let Ok(inner) = state.0.lock() {
            if let Some(conn) = inner.conn.as_ref() {
                let mut queues: Vec<i64> = paths
                    .iter()
                    .filter_map(|p| sync::queue_for_path(conn, &watch_lib, p).ok().flatten())
                    .collect();
                queues.sort();
                queues.dedup();
                for q in queues {
                    let _ = sync::sync_queue(conn, &watch_lib, q);
                }
            }
        }
        let _ = handle.emit(LIBRARY_CHANGED, ());
    })?;
    Ok((conn, w))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    library_path: String,
    slicer_path: Option<String>,
    detected_slicer: Option<String>,
    theme: String,
}

fn slicer_path(conn: &Connection) -> AppResult<Option<PathBuf>> {
    Ok(repo::get_setting(conn, "slicer_path")?
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(slicer::detect))
}

#[tauri::command]
pub fn get_app_info(state: State<AppState>) -> AppResult<AppInfo> {
    state.with(|conn, lib| {
        Ok(AppInfo {
            library_path: lib.display().to_string(),
            slicer_path: repo::get_setting(conn, "slicer_path")?.filter(|s| !s.is_empty()),
            detected_slicer: slicer::detect().map(|p| p.display().to_string()),
            theme: repo::get_setting(conn, "theme")?.unwrap_or_else(|| "dark".into()),
        })
    })
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> AppResult<()> {
    if !matches!(key.as_str(), "theme" | "slicer_path") {
        return Err(AppError::Invalid(format!("unknown setting {key}")));
    }
    state.with(|conn, _| repo::set_setting(conn, &key, &value))
}

#[tauri::command]
pub fn move_library(app: AppHandle, state: State<AppState>, new_path: String) -> AppResult<MoveResult> {
    let new_lib = PathBuf::from(new_path);
    let (old_lib, config_file, old_watcher) = {
        let mut inner = state
            .0
            .lock()
            .map_err(|_| AppError::Invalid("state poisoned".into()))?;
        inner.conn = None;
        (inner.lib.clone(), inner.config_file.clone(), inner.watcher.take())
    };
    // Dropped outside the lock: the watcher thread may be waiting on it.
    drop(old_watcher);

    // Once the files are at the new location the move is done, whatever happens to the old folder.
    let result = library::move_library(&old_lib, &new_lib).and_then(|warning| {
        config::save(
            &config_file,
            &config::AppConfig {
                library_path: new_lib.clone(),
            },
        )?;
        Ok(warning)
    });
    let lib = match &result {
        Ok(_) => new_lib,
        Err(_) if old_lib.join("planner.db").exists() => old_lib,
        // The move failed after the old database was gone: the copy is the only complete library.
        Err(_) => new_lib,
    };
    let (conn, w) = open_library(&app, lib.clone())?;
    {
        let mut inner = state
            .0
            .lock()
            .map_err(|_| AppError::Invalid("state poisoned".into()))?;
        inner.conn = Some(conn);
        inner.watcher = Some(w);
        inner.lib = lib.clone();
    }
    let _ = app.emit(LIBRARY_CHANGED, ());
    Ok(MoveResult {
        library_path: lib.display().to_string(),
        warning: result?,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveResult {
    library_path: String,
    warning: Option<String>,
}

#[tauri::command]
pub fn list_projects(state: State<AppState>) -> AppResult<Vec<ProjectSummary>> {
    state.with(|conn, _| repo::list_projects(conn))
}

#[tauri::command]
pub fn create_project(
    state: State<AppState>,
    name: String,
    description: Option<String>,
    color: Option<String>,
) -> AppResult<Project> {
    state.with(|conn, lib| repo::create_project(conn, lib, &name, description, color))
}

#[tauri::command]
pub fn update_project(
    state: State<AppState>,
    id: i64,
    name: Option<String>,
    description: Option<String>,
    color: Option<String>,
    archived: Option<bool>,
) -> AppResult<Project> {
    state.with(|conn, _| repo::update_project(conn, id, name, description, color, archived))
}

#[tauri::command]
pub fn delete_project(state: State<AppState>, id: i64) -> AppResult<()> {
    state.with(|conn, lib| repo::delete_project(conn, lib, id))
}

#[tauri::command]
pub fn list_queues(state: State<AppState>, project_id: i64) -> AppResult<Vec<QueueSummary>> {
    state.with(|conn, _| repo::list_queues(conn, project_id))
}

#[tauri::command]
pub fn create_queue(state: State<AppState>, project_id: i64, name: String) -> AppResult<Queue> {
    state.with(|conn, lib| repo::create_queue(conn, lib, project_id, &name))
}

#[tauri::command]
pub fn rename_queue(state: State<AppState>, id: i64, name: String) -> AppResult<Queue> {
    state.with(|conn, _| repo::rename_queue(conn, id, &name))
}

#[tauri::command]
pub fn delete_queue(state: State<AppState>, id: i64) -> AppResult<()> {
    state.with(|conn, lib| repo::delete_queue(conn, lib, id))
}

#[tauri::command]
pub fn list_items(state: State<AppState>, queue_id: i64) -> AppResult<Vec<Item>> {
    state.with(|conn, lib| {
        sync::sync_queue(conn, lib, queue_id)?;
        repo::list_items(conn, queue_id)
    })
}

#[tauri::command]
pub fn import_files(state: State<AppState>, queue_id: i64, paths: Vec<String>) -> AppResult<ImportResult> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    state.with(|conn, lib| repo::import_files(conn, lib, queue_id, &paths))
}

#[tauri::command]
pub fn update_item(state: State<AppState>, id: i64, patch: ItemPatch) -> AppResult<Item> {
    state.with(|conn, _| repo::update_item(conn, id, &patch))
}

#[tauri::command]
pub fn item_action(state: State<AppState>, id: i64, action: Action, index: Option<usize>) -> AppResult<Item> {
    state.with(|conn, _| status::apply(conn, id, action, index))
}

#[tauri::command]
pub fn delete_item(state: State<AppState>, id: i64) -> AppResult<()> {
    state.with(|conn, lib| repo::delete_item(conn, lib, id))
}

#[tauri::command]
pub fn item_history(state: State<AppState>, id: i64) -> AppResult<Vec<PrintEvent>> {
    state.with(|conn, _| status::history(conn, id))
}

#[tauri::command]
pub fn list_unassigned(state: State<AppState>, queue_id: i64) -> AppResult<Vec<String>> {
    state.with(|conn, lib| sync::unassigned(conn, lib, queue_id))
}

#[tauri::command]
pub fn attach_file(state: State<AppState>, item_id: i64, file_name: String) -> AppResult<Item> {
    state.with(|conn, _| repo::attach_file(conn, item_id, &file_name))
}

#[tauri::command]
pub fn item_from_file(state: State<AppState>, queue_id: i64, file_name: String) -> AppResult<Item> {
    state.with(|conn, lib| repo::item_from_file(conn, lib, queue_id, &file_name))
}

#[tauri::command]
pub fn open_in_slicer(state: State<AppState>, item_id: i64) -> AppResult<()> {
    state.with(|conn, lib| {
        let item = repo::get_item(conn, item_id)?;
        let file = library::abs(lib, &repo::open_target(&item).rel_path);
        slicer::launch(slicer_path(conn)?.as_deref(), &file)
    })
}

#[tauri::command]
pub fn reveal_item(state: State<AppState>, item_id: i64) -> AppResult<()> {
    state.with(|conn, lib| {
        let item = repo::get_item(conn, item_id)?;
        slicer::reveal(&library::abs(lib, &repo::open_target(&item).rel_path))
    })
}

#[tauri::command]
pub fn read_model(state: State<AppState>, item_id: i64) -> AppResult<tauri::ipc::Response> {
    state.with(|conn, lib| {
        let item = repo::get_item(conn, item_id)?;
        let original = item
            .files
            .iter()
            .find(|f| f.is_original)
            .unwrap_or(&item.files[0]);
        let bytes = std::fs::read(library::abs(lib, &original.rel_path))?;
        Ok(tauri::ipc::Response::new(bytes))
    })
}

#[tauri::command]
pub fn save_thumbnail(state: State<AppState>, item_id: i64, data_url: String) -> AppResult<()> {
    if !data_url.starts_with("data:image/") {
        return Err(AppError::Invalid("thumbnail must be an image data URL".into()));
    }
    state.with(|conn, _| repo::set_thumbnail(conn, item_id, &data_url))
}
