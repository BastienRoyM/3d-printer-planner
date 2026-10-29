use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::library;
use crate::models::{Item, ItemFile, ItemPatch, Project, ProjectSummary, Queue, QueueSummary};

const PROJECT_COLS: &str = "id, name, description, color, folder_rel, archived, created_at";
const QUEUE_COLS: &str = "id, project_id, name, folder_rel";
const ITEM_COLS: &str = "id, queue_id, name, status, qty_total, qty_done, copies_per_plate, material, \
    color, notes, est_minutes, est_grams, printer_id, thumbnail, sort, created_at, updated_at";
const FILE_COLS: &str = "id, item_id, rel_path, kind, is_original, added_at";
const STATUS_ORDER: &str = "CASE status WHEN 'todo' THEN 0 WHEN 'printing' THEN 1 WHEN 'done' THEN 2 ELSE 3 END";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: Vec<Item>,
    pub skipped: Vec<String>,
}

fn project_from_row(r: &Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        color: r.get(3)?,
        folder_rel: r.get(4)?,
        archived: r.get(5)?,
        created_at: r.get(6)?,
    })
}

fn queue_from_row(r: &Row) -> rusqlite::Result<Queue> {
    Ok(Queue { id: r.get(0)?, project_id: r.get(1)?, name: r.get(2)?, folder_rel: r.get(3)? })
}

fn file_from_row(r: &Row) -> rusqlite::Result<ItemFile> {
    Ok(ItemFile {
        id: r.get(0)?,
        item_id: r.get(1)?,
        rel_path: r.get(2)?,
        kind: r.get(3)?,
        is_original: r.get(4)?,
        added_at: r.get(5)?,
    })
}

fn item_from_row(r: &Row) -> rusqlite::Result<Item> {
    Ok(Item {
        id: r.get(0)?,
        queue_id: r.get(1)?,
        name: r.get(2)?,
        status: r.get(3)?,
        qty_total: r.get(4)?,
        qty_done: r.get(5)?,
        copies_per_plate: r.get(6)?,
        material: r.get(7)?,
        color: r.get(8)?,
        notes: r.get(9)?,
        est_minutes: r.get(10)?,
        est_grams: r.get(11)?,
        printer_id: r.get(12)?,
        thumbnail: r.get(13)?,
        sort: r.get(14)?,
        created_at: r.get(15)?,
        updated_at: r.get(16)?,
        files: Vec::new(),
    })
}

fn load_files(conn: &Connection, item: &mut Item) -> AppResult<()> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {FILE_COLS} FROM item_files WHERE item_id = ?1 ORDER BY is_original DESC, added_at"
    ))?;
    item.files = stmt.query_map([item.id], file_from_row)?.collect::<Result<_, _>>()?;
    Ok(())
}

fn plates_remaining(total: i64, done: i64, cpp: i64) -> i64 {
    let left = (total - done).max(0);
    (left + cpp.max(1) - 1) / cpp.max(1)
}

// ---------- projects ----------

pub fn get_project(conn: &Connection, id: i64) -> AppResult<Project> {
    conn.query_row(&format!("SELECT {PROJECT_COLS} FROM projects WHERE id = ?1"), [id], project_from_row)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("project {id}")))
}

pub fn create_project(
    conn: &Connection,
    lib: &Path,
    name: &str,
    description: Option<String>,
    color: Option<String>,
) -> AppResult<Project> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Project name cannot be empty".into()));
    }
    let dir = library::unique_dir(&lib.join("projects"), &library::slugify(name));
    std::fs::create_dir_all(&dir)?;
    let folder_rel = library::to_rel(lib, &dir)?;
    conn.execute(
        "INSERT INTO projects (name, description, color, folder_rel, sort)
         VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(sort), 0) + 1 FROM projects))",
        params![name, description.unwrap_or_default(), color, folder_rel],
    )?;
    get_project(conn, conn.last_insert_rowid())
}

pub fn update_project(
    conn: &Connection,
    id: i64,
    name: Option<String>,
    description: Option<String>,
    color: Option<String>,
    archived: Option<bool>,
) -> AppResult<Project> {
    let current = get_project(conn, id)?;
    let name = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).unwrap_or(current.name);
    conn.execute(
        "UPDATE projects SET name = ?2, description = ?3, color = ?4, archived = ?5 WHERE id = ?1",
        params![
            id,
            name,
            description.unwrap_or(current.description),
            color.or(current.color),
            archived.unwrap_or(current.archived)
        ],
    )?;
    get_project(conn, id)
}

pub fn delete_project(conn: &Connection, lib: &Path, id: i64) -> AppResult<()> {
    let p = get_project(conn, id)?;
    library::remove_path(&library::abs(lib, &p.folder_rel))?;
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    Ok(())
}

pub fn list_projects(conn: &Connection) -> AppResult<Vec<ProjectSummary>> {
    let mut stmt = conn.prepare(&format!("SELECT {PROJECT_COLS} FROM projects ORDER BY archived, sort, id"))?;
    let projects: Vec<Project> = stmt.query_map([], project_from_row)?.collect::<Result<_, _>>()?;
    let mut items = conn.prepare(
        "SELECT i.qty_total, i.qty_done, i.copies_per_plate, i.est_minutes, i.est_grams, i.status
         FROM items i JOIN queues q ON q.id = i.queue_id WHERE q.project_id = ?1",
    )?;
    let mut out = Vec::with_capacity(projects.len());
    for project in projects {
        let mut s = ProjectSummary {
            project,
            total_prints: 0,
            done_prints: 0,
            items_total: 0,
            items_done: 0,
            remaining_minutes: 0,
            remaining_grams: 0,
        };
        let rows = items.query_map([s.project.id], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<i64>>(3)?,
                r.get::<_, Option<i64>>(4)?,
                r.get::<_, String>(5)?,
            ))
        })?;
        for row in rows {
            let (total, done, cpp, minutes, grams, status) = row?;
            let plates = plates_remaining(total, done, cpp);
            s.total_prints += total;
            s.done_prints += done;
            s.items_total += 1;
            s.items_done += (status == "done") as i64;
            s.remaining_minutes += minutes.unwrap_or(0) * plates;
            s.remaining_grams += grams.unwrap_or(0) * plates;
        }
        out.push(s);
    }
    Ok(out)
}

// ---------- queues ----------

pub fn get_queue(conn: &Connection, id: i64) -> AppResult<Queue> {
    conn.query_row(&format!("SELECT {QUEUE_COLS} FROM queues WHERE id = ?1"), [id], queue_from_row)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("queue {id}")))
}

pub fn all_queues(conn: &Connection) -> AppResult<Vec<Queue>> {
    let mut stmt = conn.prepare(&format!("SELECT {QUEUE_COLS} FROM queues"))?;
    let qs = stmt.query_map([], queue_from_row)?.collect::<Result<_, _>>()?;
    Ok(qs)
}

pub fn create_queue(conn: &Connection, lib: &Path, project_id: i64, name: &str) -> AppResult<Queue> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Queue name cannot be empty".into()));
    }
    let project = get_project(conn, project_id)?;
    let dir = library::unique_dir(&library::abs(lib, &project.folder_rel), &library::slugify(name));
    std::fs::create_dir_all(&dir)?;
    let folder_rel = library::to_rel(lib, &dir)?;
    conn.execute(
        "INSERT INTO queues (project_id, name, folder_rel, sort)
         VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort), 0) + 1 FROM queues WHERE project_id = ?1))",
        params![project_id, name, folder_rel],
    )?;
    get_queue(conn, conn.last_insert_rowid())
}

pub fn rename_queue(conn: &Connection, id: i64, name: &str) -> AppResult<Queue> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Queue name cannot be empty".into()));
    }
    conn.execute("UPDATE queues SET name = ?2 WHERE id = ?1", params![id, name])?;
    get_queue(conn, id)
}

pub fn delete_queue(conn: &Connection, lib: &Path, id: i64) -> AppResult<()> {
    let q = get_queue(conn, id)?;
    library::remove_path(&library::abs(lib, &q.folder_rel))?;
    conn.execute("DELETE FROM queues WHERE id = ?1", [id])?;
    Ok(())
}

pub fn list_queues(conn: &Connection, project_id: i64) -> AppResult<Vec<QueueSummary>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {QUEUE_COLS} FROM queues WHERE project_id = ?1 ORDER BY sort, id"
    ))?;
    let queues: Vec<Queue> = stmt.query_map([project_id], queue_from_row)?.collect::<Result<_, _>>()?;
    let mut out = Vec::with_capacity(queues.len());
    for queue in queues {
        let (total_prints, done_prints, printing_count): (i64, i64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(qty_total), 0), COALESCE(SUM(qty_done), 0),
                    COALESCE(SUM(status = 'printing'), 0)
             FROM items WHERE queue_id = ?1",
            [queue.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let next_id: Option<i64> = conn
            .query_row(
                "SELECT id FROM items WHERE queue_id = ?1 AND status = 'todo' ORDER BY sort, id LIMIT 1",
                [queue.id],
                |r| r.get(0),
            )
            .optional()?;
        let next_item = next_id.map(|id| get_item(conn, id)).transpose()?;
        out.push(QueueSummary { queue, total_prints, done_prints, printing_count, next_item });
    }
    Ok(out)
}

// ---------- items ----------

pub fn get_item(conn: &Connection, id: i64) -> AppResult<Item> {
    let mut item = conn
        .query_row(&format!("SELECT {ITEM_COLS} FROM items WHERE id = ?1"), [id], item_from_row)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("item {id}")))?;
    load_files(conn, &mut item)?;
    Ok(item)
}

pub fn list_items(conn: &Connection, queue_id: i64) -> AppResult<Vec<Item>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ITEM_COLS} FROM items WHERE queue_id = ?1 ORDER BY {STATUS_ORDER}, sort, id"
    ))?;
    let mut items: Vec<Item> = stmt.query_map([queue_id], item_from_row)?.collect::<Result<_, _>>()?;
    for item in &mut items {
        load_files(conn, item)?;
    }
    Ok(items)
}

fn next_sort(conn: &Connection, queue_id: i64, status: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(sort), -1) + 1 FROM items WHERE queue_id = ?1 AND status = ?2",
        params![queue_id, status],
        |r| r.get(0),
    )?)
}

/// Creates a to-do item whose original file is `rel_path` (already inside the library).
pub fn insert_item_for_file(conn: &Connection, queue_id: i64, rel_path: &str) -> AppResult<Item> {
    let file_name = rel_path.rsplit('/').next().unwrap_or(rel_path);
    let name = Path::new(file_name)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_name.to_string());
    let sort = next_sort(conn, queue_id, "todo")?;
    conn.execute(
        "INSERT INTO items (queue_id, name, sort, printer_id) VALUES (?1, ?2, ?3, 1)",
        params![queue_id, name, sort],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO item_files (item_id, rel_path, kind, is_original) VALUES (?1, ?2, ?3, 1)",
        params![id, rel_path, library::file_kind(file_name)],
    )?;
    get_item(conn, id)
}

pub fn import_files(conn: &Connection, lib: &Path, queue_id: i64, paths: &[PathBuf]) -> AppResult<ImportResult> {
    let queue = get_queue(conn, queue_id)?;
    let folder = library::abs(lib, &queue.folder_rel);
    std::fs::create_dir_all(&folder)?;
    let mut res = ImportResult { imported: Vec::new(), skipped: Vec::new() };
    for src in paths {
        let display = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        if !library::is_supported(src) {
            res.skipped.push(display);
            continue;
        }
        let dest = library::unique_path(&folder, &display);
        std::fs::copy(src, &dest)?;
        let rel = library::to_rel(lib, &dest)?;
        res.imported.push(insert_item_for_file(conn, queue_id, &rel)?);
    }
    Ok(res)
}

pub fn update_item(conn: &Connection, id: i64, patch: &ItemPatch) -> AppResult<Item> {
    let cur = get_item(conn, id)?;
    let name = patch.name.clone().map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).unwrap_or(cur.name);
    let qty_total = patch.qty_total.unwrap_or(cur.qty_total).max(1);
    let qty_done = patch.qty_done.unwrap_or(cur.qty_done).clamp(0, qty_total);
    let cpp = patch.copies_per_plate.unwrap_or(cur.copies_per_plate).max(1);
    conn.execute(
        "UPDATE items SET name = ?2, qty_total = ?3, qty_done = ?4, copies_per_plate = ?5,
            material = ?6, color = ?7, notes = ?8, est_minutes = ?9, est_grams = ?10,
            updated_at = datetime('now')
         WHERE id = ?1",
        params![
            id,
            name,
            qty_total,
            qty_done,
            cpp,
            patch.material.clone().unwrap_or(cur.material),
            patch.color.clone().unwrap_or(cur.color),
            patch.notes.clone().unwrap_or(cur.notes),
            patch.est_minutes.unwrap_or(cur.est_minutes).map(|v| v.max(0)),
            patch.est_grams.unwrap_or(cur.est_grams).map(|v| v.max(0)),
        ],
    )?;
    get_item(conn, id)
}

pub fn set_thumbnail(conn: &Connection, id: i64, data_url: &str) -> AppResult<()> {
    conn.execute("UPDATE items SET thumbnail = ?2 WHERE id = ?1", params![id, data_url])?;
    Ok(())
}

pub fn delete_item(conn: &Connection, lib: &Path, id: i64) -> AppResult<()> {
    let item = get_item(conn, id)?;
    for f in &item.files {
        library::remove_path(&library::abs(lib, &f.rel_path))?;
    }
    conn.execute("DELETE FROM items WHERE id = ?1", [id])?;
    Ok(())
}

/// Sets the item's status column and places it at `index` within that column.
pub fn reorder(conn: &Connection, item_id: i64, status: &str, index: usize) -> AppResult<()> {
    let item = get_item(conn, item_id)?;
    let mut stmt = conn.prepare(
        "SELECT id FROM items WHERE queue_id = ?1 AND status = ?2 AND id != ?3 ORDER BY sort, id",
    )?;
    let mut ids: Vec<i64> = stmt
        .query_map(params![item.queue_id, status, item_id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    ids.insert(index.min(ids.len()), item_id);
    conn.execute(
        "UPDATE items SET status = ?2, updated_at = datetime('now') WHERE id = ?1",
        params![item_id, status],
    )?;
    for (i, id) in ids.iter().enumerate() {
        conn.execute("UPDATE items SET sort = ?2 WHERE id = ?1", params![id, i as i64])?;
    }
    Ok(())
}

pub fn column_len(conn: &Connection, queue_id: i64, status: &str) -> AppResult<usize> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM items WHERE queue_id = ?1 AND status = ?2",
        params![queue_id, status],
        |r| r.get(0),
    )?;
    Ok(n as usize)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db;
    use crate::models::ItemPatch;
    use std::fs;

    pub struct Fx {
        pub _dir: tempfile::TempDir,
        pub lib: PathBuf,
        pub src: PathBuf,
        pub conn: Connection,
        pub queue_id: i64,
    }

    pub fn fixture() -> Fx {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().join("lib");
        let src = dir.path().join("src");
        fs::create_dir_all(&src).unwrap();
        let conn = db::open(&lib.join("planner.db")).unwrap();
        let p = create_project(&conn, &lib, "Helmet", None, None).unwrap();
        let q = create_queue(&conn, &lib, p.id, "PLA Black").unwrap();
        Fx { _dir: dir, lib, src, conn, queue_id: q.id }
    }

    pub fn source(fx: &Fx, sub: &str, name: &str, content: &str) -> PathBuf {
        let d = fx.src.join(sub);
        fs::create_dir_all(&d).unwrap();
        let p = d.join(name);
        fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn import_copies_and_creates_item() {
        let fx = fixture();
        let a = source(&fx, "a", "bracket.stl", "solid a");
        let res = import_files(&fx.conn, &fx.lib, fx.queue_id, &[a]).unwrap();
        assert_eq!(res.imported.len(), 1);
        let item = &res.imported[0];
        assert_eq!(item.name, "bracket");
        assert_eq!(item.status, "todo");
        assert_eq!(item.files.len(), 1);
        assert!(item.files[0].is_original);
        let stored = fx.lib.join(&item.files[0].rel_path);
        assert_eq!(fs::read_to_string(stored).unwrap(), "solid a");
        assert!(item.files[0].rel_path.starts_with("projects/helmet/pla-black/"));
    }

    #[test]
    fn import_name_collision_gets_suffix() {
        let fx = fixture();
        let a = source(&fx, "a", "bracket.stl", "first");
        let b = source(&fx, "b", "bracket.stl", "second");
        import_files(&fx.conn, &fx.lib, fx.queue_id, &[a]).unwrap();
        let res = import_files(&fx.conn, &fx.lib, fx.queue_id, &[b]).unwrap();
        assert!(res.imported[0].files[0].rel_path.ends_with("bracket (2).stl"));
        let folder = fx.lib.join("projects/helmet/pla-black");
        assert_eq!(fs::read_to_string(folder.join("bracket.stl")).unwrap(), "first");
        assert_eq!(fs::read_to_string(folder.join("bracket (2).stl")).unwrap(), "second");
    }

    #[test]
    fn import_skips_unsupported() {
        let fx = fixture();
        let a = source(&fx, "a", "a.stl", "x");
        let b = source(&fx, "a", "b.png", "x");
        let dir = fx.src.join("folder");
        fs::create_dir_all(&dir).unwrap();
        let res = import_files(&fx.conn, &fx.lib, fx.queue_id, &[a, b, dir]).unwrap();
        assert_eq!(res.imported.len(), 1);
        assert_eq!(res.skipped.len(), 2);
        assert!(res.skipped.iter().any(|s| s.contains("b.png")));
        assert!(res.skipped.iter().any(|s| s.contains("folder")));
    }

    #[test]
    fn update_item_clamps() {
        let fx = fixture();
        let a = source(&fx, "a", "a.stl", "x");
        let item = import_files(&fx.conn, &fx.lib, fx.queue_id, &[a]).unwrap().imported.remove(0);
        let patch = ItemPatch { qty_total: Some(2), ..Default::default() };
        update_item(&fx.conn, item.id, &patch).unwrap();
        let patch = ItemPatch { qty_done: Some(5), copies_per_plate: Some(0), ..Default::default() };
        let item = update_item(&fx.conn, item.id, &patch).unwrap();
        assert_eq!(item.qty_done, 2);
        assert_eq!(item.copies_per_plate, 1);
    }

    #[test]
    fn project_summary_remaining() {
        let fx = fixture();
        let a = source(&fx, "a", "a.stl", "x");
        let item = import_files(&fx.conn, &fx.lib, fx.queue_id, &[a]).unwrap().imported.remove(0);
        let patch = ItemPatch {
            qty_total: Some(4),
            qty_done: Some(1),
            copies_per_plate: Some(2),
            est_minutes: Some(Some(60)),
            est_grams: Some(Some(30)),
            ..Default::default()
        };
        update_item(&fx.conn, item.id, &patch).unwrap();
        let s = list_projects(&fx.conn).unwrap().remove(0);
        assert_eq!(s.total_prints, 4);
        assert_eq!(s.done_prints, 1);
        assert_eq!(s.remaining_minutes, 120);
        assert_eq!(s.remaining_grams, 60);
    }

    #[test]
    fn delete_item_removes_row_and_file() {
        let fx = fixture();
        let a = source(&fx, "a", "a.stl", "x");
        let item = import_files(&fx.conn, &fx.lib, fx.queue_id, &[a]).unwrap().imported.remove(0);
        let path = fx.lib.join(&item.files[0].rel_path);
        delete_item(&fx.conn, &fx.lib, item.id).unwrap();
        assert!(!path.exists());
        assert!(list_items(&fx.conn, fx.queue_id).unwrap().is_empty());
    }

    #[test]
    fn reorder_places_item_at_index() {
        let fx = fixture();
        let paths: Vec<_> = ["a.stl", "b.stl", "c.stl"].iter().map(|n| source(&fx, "s", n, "x")).collect();
        let items = import_files(&fx.conn, &fx.lib, fx.queue_id, &paths).unwrap().imported;
        reorder(&fx.conn, items[2].id, "todo", 0).unwrap();
        let names: Vec<_> = list_items(&fx.conn, fx.queue_id).unwrap().into_iter().map(|i| i.name).collect();
        assert_eq!(names, ["c", "a", "b"]);
    }
}
