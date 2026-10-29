use std::path::{Path, PathBuf};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};

use crate::error::{AppError, AppResult};

pub type LibraryWatcher = Debouncer<RecommendedWatcher>;

/// Watches `<lib>/projects` recursively and calls `on_change` with the changed paths,
/// debounced so a slicer writing a file in several chunks produces one callback.
pub fn start(lib: &Path, on_change: impl Fn(Vec<PathBuf>) + Send + 'static) -> AppResult<LibraryWatcher> {
    let root = lib.join("projects");
    std::fs::create_dir_all(&root)?;
    let mut debouncer = new_debouncer(Duration::from_millis(800), move |res: DebounceEventResult| {
        if let Ok(events) = res {
            on_change(events.into_iter().map(|e| e.path).collect());
        }
    })
    .map_err(|e| AppError::Invalid(format!("cannot watch library: {e}")))?;
    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| AppError::Invalid(format!("cannot watch library: {e}")))?;
    Ok(debouncer)
}
