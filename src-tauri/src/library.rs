use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

pub const SUPPORTED_EXTS: &[&str] = &["stl", "3mf", "obj", "step", "stp", "amf", "gcode"];

pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() { "untitled".into() } else { out }
}

fn ext_lower(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

pub fn is_supported(path: &Path) -> bool {
    path.is_file() && SUPPORTED_EXTS.contains(&ext_lower(&path.to_string_lossy()).as_str())
}

pub fn file_kind(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    if lower.ends_with(".gcode") || lower.ends_with(".gcode.3mf") {
        "gcode"
    } else if lower.ends_with(".3mf") {
        "project"
    } else {
        "model"
    }
}

/// Returns `dir/file_name`, or `dir/stem (N).ext` with the first free N >= 2.
pub fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let candidate = dir.join(file_name);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(file_name);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = p
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){ext}")))
        .find(|c| !c.exists())
        .expect("some suffix is free")
}

/// Returns `parent/slug`, or `parent/slug-N` with the first free N >= 2.
pub fn unique_dir(parent: &Path, slug: &str) -> PathBuf {
    let candidate = parent.join(slug);
    if !candidate.exists() {
        return candidate;
    }
    (2..)
        .map(|n| parent.join(format!("{slug}-{n}")))
        .find(|c| !c.exists())
        .expect("some suffix is free")
}

/// Library-relative path with forward slashes, as stored in the database.
pub fn to_rel(lib: &Path, path: &Path) -> AppResult<String> {
    let rel = path
        .strip_prefix(lib)
        .map_err(|_| AppError::Invalid(format!("{} is outside the library", path.display())))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

pub fn abs(lib: &Path, rel: &str) -> PathBuf {
    rel.split('/').fold(lib.to_path_buf(), |p, part| p.join(part))
}

/// Sends a file or folder to the recycle bin. Missing paths are ignored.
pub fn remove_path(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }
    #[cfg(test)]
    {
        if path.is_dir() {
            std::fs::remove_dir_all(path)?
        } else {
            std::fs::remove_file(path)?
        }
        Ok(())
    }
    #[cfg(not(test))]
    {
        trash::delete(path).map_err(|e| AppError::Invalid(format!("could not move to recycle bin: {e}")))
    }
}

pub fn copy_dir(from: &Path, to: &Path) -> AppResult<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Moves the whole library to `to`, which must not exist yet or be an empty folder.
/// The database must be closed by the caller first.
pub fn move_library(from: &Path, to: &Path) -> AppResult<()> {
    let canon = |p: &Path| p.canonicalize().unwrap_or_else(|_| p.to_path_buf());
    let (from_c, to_parent_c) = (canon(from), to.parent().map(canon));
    let to_c = to_parent_c
        .map(|p| p.join(to.file_name().unwrap_or_default()))
        .unwrap_or_else(|| to.to_path_buf());
    if to_c.starts_with(&from_c) {
        return Err(AppError::Invalid(
            "The new location cannot be inside the current library".into(),
        ));
    }
    if to.exists() {
        if std::fs::read_dir(to)?.next().is_some() {
            return Err(AppError::Invalid(format!(
                "{} is not empty. Choose an empty folder for the library.",
                to.display()
            )));
        }
        std::fs::remove_dir(to)?;
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if std::fs::rename(from, to).is_err() {
        // Different drive: copy everything, then remove the old copy only once the copy succeeded.
        if let Err(e) = copy_dir(from, to) {
            let _ = std::fs::remove_dir_all(to);
            return Err(e);
        }
        std::fs::remove_dir_all(from)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_basic() {
        assert_eq!(slugify("My Helmet!! v2"), "my-helmet-v2");
        assert_eq!(slugify(""), "untitled");
        assert_eq!(slugify("  ?? "), "untitled");
    }

    #[test]
    fn file_kind_detects_types() {
        assert_eq!(file_kind("a.STL"), "model");
        assert_eq!(file_kind("a.3mf"), "project");
        assert_eq!(file_kind("a.gcode.3mf"), "gcode");
        assert_eq!(file_kind("a_plate_1.gcode"), "gcode");
    }

    #[test]
    fn unique_path_adds_suffix() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.stl"), "x").unwrap();
        std::fs::write(dir.path().join("a (2).stl"), "x").unwrap();
        assert_eq!(unique_path(dir.path(), "a.stl"), dir.path().join("a (3).stl"));
        assert_eq!(unique_path(dir.path(), "b.stl"), dir.path().join("b.stl"));
    }

    #[test]
    fn move_library_refuses_non_empty() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("lib");
        let to = dir.path().join("other");
        std::fs::create_dir_all(&from).unwrap();
        std::fs::write(from.join("planner.db"), "db").unwrap();
        std::fs::create_dir_all(&to).unwrap();
        std::fs::write(to.join("x.txt"), "x").unwrap();
        assert!(move_library(&from, &to).is_err());
        assert!(from.join("planner.db").exists());
    }

    #[test]
    fn move_library_refuses_inside_itself() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("lib");
        std::fs::create_dir_all(&from).unwrap();
        assert!(move_library(&from, &from.join("sub")).is_err());
    }

    #[test]
    fn move_library_moves() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("lib");
        std::fs::create_dir_all(from.join("projects/a")).unwrap();
        std::fs::write(from.join("planner.db"), "db").unwrap();
        std::fs::write(from.join("projects/a/x.stl"), "x").unwrap();
        let to = dir.path().join("empty");
        std::fs::create_dir_all(&to).unwrap();
        move_library(&from, &to).unwrap();
        assert!(to.join("planner.db").exists());
        assert!(to.join("projects/a/x.stl").exists());
        assert!(!from.exists());
    }

    #[test]
    fn copy_dir_recursive_copies_tree() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("a");
        std::fs::create_dir_all(from.join("b/c")).unwrap();
        std::fs::write(from.join("b/c/f.stl"), "x").unwrap();
        copy_dir(&from, &dir.path().join("z")).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join("z/b/c/f.stl")).unwrap(),
            "x"
        );
    }
}
