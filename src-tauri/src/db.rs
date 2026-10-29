use std::path::Path;

use rusqlite::Connection;

use crate::error::AppResult;

const SCHEMA_V1: &str = "
CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT,
    folder_rel TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE queues (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    folder_rel TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE printers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    queue_id INTEGER NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo',
    qty_total INTEGER NOT NULL DEFAULT 1,
    qty_done INTEGER NOT NULL DEFAULT 0,
    copies_per_plate INTEGER NOT NULL DEFAULT 1,
    material TEXT,
    color TEXT,
    notes TEXT NOT NULL DEFAULT '',
    est_minutes INTEGER,
    est_grams INTEGER,
    printer_id INTEGER REFERENCES printers(id) ON DELETE SET NULL,
    thumbnail TEXT,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE item_files (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    rel_path TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    is_original INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE TABLE print_events (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    printer_id INTEGER REFERENCES printers(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    copies INTEGER NOT NULL DEFAULT 0,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE INDEX idx_items_queue ON items(queue_id, status, sort);
CREATE INDEX idx_files_item ON item_files(item_id);
CREATE INDEX idx_events_item ON print_events(item_id);
INSERT INTO printers (id, name) VALUES (1, 'My printer');
";

/// Opens (creating if needed) the library database and brings its schema up to date.
pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> AppResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        conn.execute_batch(&format!("BEGIN; {SCHEMA_V1} PRAGMA user_version = 1; COMMIT;"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("planner.db");
        drop(open(&path).unwrap());
        let conn = open(&path).unwrap();
        let v: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1);
    }

    #[test]
    fn default_printer_seeded() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open(&dir.path().join("planner.db")).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM printers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
}
