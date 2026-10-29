use std::collections::HashSet;
use std::path::Path;

use rusqlite::{Connection, params};

use crate::error::AppResult;
use crate::library;
use crate::repo;

const SEPARATORS: &[char] = &['_', '-', '.', ' ', '('];
const TEMP_SUFFIXES: &[&str] = &[".tmp", ".part", ".bak", ".crdownload"];

fn candidate_stem(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if let Some(s) = lower.strip_suffix(".gcode.3mf") {
        return s.to_string();
    }
    Path::new(&lower)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or(lower)
}

/// Finds the item a slicer-written file belongs to: its name must start with an item's
/// original file stem followed by the end of the stem or a separator. Longest stem wins.
pub fn match_item(file_name: &str, originals: &[(i64, String)]) -> Option<i64> {
    let candidate = candidate_stem(file_name);
    originals
        .iter()
        .filter(|(_, stem)| {
            let stem = stem.to_lowercase();
            match candidate.strip_prefix(&stem) {
                Some("") => true,
                Some(rest) => rest.starts_with(SEPARATORS),
                None => false,
            }
        })
        .max_by_key(|(_, stem)| stem.len())
        .map(|(id, _)| *id)
}

pub fn is_ignored(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    lower.starts_with('.')
        || lower.starts_with('~')
        || TEMP_SUFFIXES.iter().any(|s| lower.ends_with(s))
        || !library::SUPPORTED_EXTS
            .iter()
            .any(|e| lower.ends_with(&format!(".{e}")))
}

/// Supported, non-temporary file names directly inside the queue folder.
fn folder_files(lib: &Path, folder_rel: &str) -> AppResult<Vec<String>> {
    let dir = library::abs(lib, folder_rel);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| !is_ignored(n))
        .collect();
    names.sort();
    Ok(names)
}

fn tracked(conn: &Connection, queue_id: i64) -> AppResult<HashSet<String>> {
    let mut stmt = conn.prepare(
        "SELECT f.rel_path FROM item_files f JOIN items i ON i.id = f.item_id WHERE i.queue_id = ?1",
    )?;
    let set = stmt
        .query_map([queue_id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    Ok(set)
}

fn originals(conn: &Connection, queue_id: i64) -> AppResult<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT i.id, f.rel_path FROM item_files f JOIN items i ON i.id = f.item_id
         WHERE i.queue_id = ?1 AND f.is_original = 1",
    )?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([queue_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(id, rel)| {
            let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
            (id, candidate_stem(&name))
        })
        .collect())
}

/// Attaches new slicer-written files in the queue folder to their items and forgets
/// derived files that were deleted. Returns true when anything changed.
pub fn sync_queue(conn: &Connection, lib: &Path, queue_id: i64) -> AppResult<bool> {
    let queue = repo::get_queue(conn, queue_id)?;
    let mut changed = false;

    let mut stmt = conn.prepare(
        "SELECT f.id, f.rel_path FROM item_files f JOIN items i ON i.id = f.item_id
         WHERE i.queue_id = ?1 AND f.is_original = 0",
    )?;
    let derived: Vec<(i64, String)> = stmt
        .query_map([queue_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (id, rel) in derived {
        if !library::abs(lib, &rel).exists() {
            conn.execute("DELETE FROM item_files WHERE id = ?1", [id])?;
            changed = true;
        }
    }

    let known = tracked(conn, queue_id)?;
    let originals = originals(conn, queue_id)?;
    for name in folder_files(lib, &queue.folder_rel)? {
        let rel = format!("{}/{}", queue.folder_rel, name);
        // Only slicer output is attached automatically; new models stay unassigned for the user.
        if known.contains(&rel) || library::file_kind(&name) == "model" {
            continue;
        }
        if let Some(item_id) = match_item(&name, &originals) {
            conn.execute(
                "INSERT OR IGNORE INTO item_files (item_id, rel_path, kind, is_original) VALUES (?1, ?2, ?3, 0)",
                params![item_id, rel, library::file_kind(&name)],
            )?;
            changed = true;
        }
    }
    Ok(changed)
}

/// Files in the queue folder that belong to no item.
pub fn unassigned(conn: &Connection, lib: &Path, queue_id: i64) -> AppResult<Vec<String>> {
    let queue = repo::get_queue(conn, queue_id)?;
    let known = tracked(conn, queue_id)?;
    Ok(folder_files(lib, &queue.folder_rel)?
        .into_iter()
        .filter(|n| !known.contains(&format!("{}/{}", queue.folder_rel, n)))
        .collect())
}

/// The queue whose folder directly contains `path`, if any.
pub fn queue_for_path(conn: &Connection, lib: &Path, path: &Path) -> AppResult<Option<i64>> {
    let Some(parent) = path.parent() else {
        return Ok(None);
    };
    let Ok(rel) = library::to_rel(lib, parent) else {
        return Ok(None);
    };
    Ok(repo::all_queues(conn)?
        .into_iter()
        .find(|q| q.folder_rel == rel)
        .map(|q| q.id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repo::{
        self,
        tests::{fixture, source},
    };

    fn originals(names: &[(i64, &str)]) -> Vec<(i64, String)> {
        names.iter().map(|(i, n)| (*i, n.to_string())).collect()
    }

    #[test]
    fn match_gcode_3mf() {
        let o = originals(&[(1, "bracket")]);
        assert_eq!(match_item("bracket.gcode.3mf", &o), Some(1));
        assert_eq!(match_item("Bracket.3MF", &o), Some(1));
    }

    #[test]
    fn match_plate_suffix() {
        let o = originals(&[(1, "bracket")]);
        assert_eq!(match_item("bracket_plate_1.gcode", &o), Some(1));
        assert_eq!(match_item("bracket - copy.3mf", &o), Some(1));
    }

    #[test]
    fn longest_stem_wins() {
        let o = originals(&[(1, "bracket"), (2, "bracket_long")]);
        assert_eq!(match_item("bracket_long.3mf", &o), Some(2));
        assert_eq!(match_item("bracket_long_plate_2.gcode", &o), Some(2));
        assert_eq!(match_item("bracket_plate_2.gcode", &o), Some(1));
    }

    #[test]
    fn no_false_prefix() {
        let o = originals(&[(1, "bracket")]);
        assert_eq!(match_item("bracketry.3mf", &o), None);
        assert_eq!(match_item("other.3mf", &o), None);
    }

    #[test]
    fn ignored_temp_files() {
        assert!(is_ignored(".bracket.3mf"));
        assert!(is_ignored("~bracket.3mf"));
        assert!(is_ignored("bracket.3mf.tmp"));
        assert!(is_ignored("notes.txt"));
        assert!(!is_ignored("bracket.gcode"));
    }

    #[test]
    fn sync_attaches_and_open_target_prefers_newest_project() {
        let fx = fixture();
        let p = source(&fx, "s", "bracket.stl", "x");
        let item = repo::import_files(&fx.conn, &fx.lib, fx.queue_id, &[p])
            .unwrap()
            .imported
            .remove(0);
        let folder = fx.lib.join("projects/helmet/pla-black");
        assert_eq!(repo::open_target(&item).rel_path, item.files[0].rel_path);

        std::fs::write(folder.join("bracket.3mf"), "proj").unwrap();
        std::fs::write(folder.join("bracket_plate_1.gcode"), "g").unwrap();
        assert!(sync_queue(&fx.conn, &fx.lib, fx.queue_id).unwrap());
        assert!(!sync_queue(&fx.conn, &fx.lib, fx.queue_id).unwrap());

        let item = repo::get_item(&fx.conn, item.id).unwrap();
        assert_eq!(item.files.len(), 3);
        assert!(repo::open_target(&item).rel_path.ends_with("bracket.3mf"));
        let g = item
            .files
            .iter()
            .find(|f| f.rel_path.ends_with(".gcode"))
            .unwrap();
        assert_eq!(g.kind, "gcode");
    }

    #[test]
    fn sync_drops_missing_derived_files() {
        let fx = fixture();
        let p = source(&fx, "s", "bracket.stl", "x");
        let item = repo::import_files(&fx.conn, &fx.lib, fx.queue_id, &[p])
            .unwrap()
            .imported
            .remove(0);
        let folder = fx.lib.join("projects/helmet/pla-black");
        std::fs::write(folder.join("bracket.3mf"), "proj").unwrap();
        sync_queue(&fx.conn, &fx.lib, fx.queue_id).unwrap();
        std::fs::remove_file(folder.join("bracket.3mf")).unwrap();
        assert!(sync_queue(&fx.conn, &fx.lib, fx.queue_id).unwrap());
        assert_eq!(repo::get_item(&fx.conn, item.id).unwrap().files.len(), 1);
    }

    #[test]
    fn unassigned_lists_unknown() {
        let fx = fixture();
        let p = source(&fx, "s", "bracket.stl", "x");
        repo::import_files(&fx.conn, &fx.lib, fx.queue_id, &[p]).unwrap();
        let folder = fx.lib.join("projects/helmet/pla-black");
        std::fs::write(folder.join("other.stl"), "x").unwrap();
        std::fs::write(folder.join("readme.txt"), "x").unwrap();
        sync_queue(&fx.conn, &fx.lib, fx.queue_id).unwrap();
        assert_eq!(unassigned(&fx.conn, &fx.lib, fx.queue_id).unwrap(), ["other.stl"]);

        let it = repo::item_from_file(&fx.conn, &fx.lib, fx.queue_id, "other.stl").unwrap();
        assert_eq!(it.name, "other");
        assert!(unassigned(&fx.conn, &fx.lib, fx.queue_id).unwrap().is_empty());
    }

    #[test]
    fn attach_file_adds_derived() {
        let fx = fixture();
        let p = source(&fx, "s", "bracket.stl", "x");
        let item = repo::import_files(&fx.conn, &fx.lib, fx.queue_id, &[p])
            .unwrap()
            .imported
            .remove(0);
        let folder = fx.lib.join("projects/helmet/pla-black");
        std::fs::write(folder.join("weird name.3mf"), "x").unwrap();
        let it = repo::attach_file(&fx.conn, item.id, "weird name.3mf").unwrap();
        assert_eq!(it.files.len(), 2);
        assert!(!it.files[1].is_original);
    }

    #[test]
    fn queue_for_path_finds_owner() {
        let fx = fixture();
        let file = fx
            .lib
            .join("projects")
            .join("helmet")
            .join("pla-black")
            .join("x.3mf");
        assert_eq!(
            queue_for_path(&fx.conn, &fx.lib, &file).unwrap(),
            Some(fx.queue_id)
        );
        assert_eq!(
            queue_for_path(&fx.conn, &fx.lib, &fx.lib.join("planner.db")).unwrap(),
            None
        );
    }

    #[test]
    fn new_model_files_stay_unassigned() {
        let fx = fixture();
        let p = source(&fx, "s", "bracket.stl", "x");
        let item = repo::import_files(&fx.conn, &fx.lib, fx.queue_id, &[p])
            .unwrap()
            .imported
            .remove(0);
        let folder = fx.lib.join("projects/helmet/pla-black");
        std::fs::write(folder.join("bracket_v2.stl"), "x").unwrap();
        sync_queue(&fx.conn, &fx.lib, fx.queue_id).unwrap();
        assert_eq!(repo::get_item(&fx.conn, item.id).unwrap().files.len(), 1);
        assert_eq!(
            unassigned(&fx.conn, &fx.lib, fx.queue_id).unwrap(),
            ["bracket_v2.stl"]
        );
    }
}
