use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub library_path: PathBuf,
}

pub fn default_library_path() -> PathBuf {
    dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("3D Planner")
}

/// Location of the app config file (outside the library).
pub fn config_file() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("3d-printer-planner")
        .join("config.json")
}

/// Loads the config, falling back to defaults when the file is missing or unreadable.
pub fn load(config_file: &Path) -> AppConfig {
    std::fs::read_to_string(config_file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| AppConfig { library_path: default_library_path() })
}

pub fn save(config_file: &Path, cfg: &AppConfig) -> AppResult<()> {
    if let Some(parent) = config_file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(cfg).expect("config serialises");
    std::fs::write(config_file, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_missing_returns_default() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = load(&dir.path().join("nope.json"));
        assert!(cfg.library_path.ends_with("3D Planner"));
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sub/config.json");
        let cfg = AppConfig { library_path: dir.path().join("lib") };
        save(&file, &cfg).unwrap();
        assert_eq!(load(&file).library_path, dir.path().join("lib"));
    }
}
