use rusqlite::{params, Connection};
use serde::Deserialize;

use crate::error::AppResult;
use crate::models::{Item, PrintEvent};
use crate::repo;

/// v1 has a single printer; every event is recorded against it.
const DEFAULT_PRINTER: i64 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Todo,
    Printing,
    Done,
    Failed,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Todo => "todo",
            Status::Printing => "printing",
            Status::Done => "done",
            Status::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
    Start,
    Finish,
    Fail,
    MoveTo { status: Status },
    ResetProgress,
}

enum Place {
    Top,
    End,
}

fn log(conn: &Connection, item_id: i64, kind: &str, copies: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO print_events (item_id, printer_id, kind, copies) VALUES (?1, ?2, ?3, ?4)",
        params![item_id, DEFAULT_PRINTER, kind, copies],
    )?;
    Ok(())
}

fn set_done(conn: &Connection, item_id: i64, qty_done: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE items SET qty_done = ?2, updated_at = datetime('now') WHERE id = ?1",
        params![item_id, qty_done],
    )?;
    Ok(())
}

/// The single entry point for every status change. Records history in `print_events`.
/// `index` places the item within its target column; when absent a sensible default is used.
pub fn apply(conn: &Connection, item_id: i64, action: Action, index: Option<usize>) -> AppResult<Item> {
    let item = repo::get_item(conn, item_id)?;
    let tx = conn.unchecked_transaction()?;
    let (target, place) = match action {
        Action::Start | Action::MoveTo { status: Status::Printing } => {
            if item.status != "printing" {
                log(conn, item_id, "started", item.copies_per_plate)?;
            }
            (Status::Printing, Place::End)
        }
        Action::Finish => {
            let added = item.copies_per_plate.min(item.qty_total - item.qty_done).max(0);
            let done = item.qty_done + added;
            set_done(conn, item_id, done)?;
            log(conn, item_id, "finished", added)?;
            if done >= item.qty_total { (Status::Done, Place::Top) } else { (Status::Todo, Place::Top) }
        }
        Action::Fail | Action::MoveTo { status: Status::Failed } => {
            if item.status != "failed" {
                log(conn, item_id, "failed", item.copies_per_plate)?;
            }
            (Status::Failed, Place::Top)
        }
        Action::MoveTo { status: Status::Done } => {
            let added = item.qty_total - item.qty_done;
            if added > 0 {
                set_done(conn, item_id, item.qty_total)?;
                log(conn, item_id, "finished", added)?;
            }
            (Status::Done, Place::Top)
        }
        Action::MoveTo { status: Status::Todo } => {
            if item.status == "printing" {
                log(conn, item_id, "reset", 0)?;
            }
            let place = if item.status == "todo" { Place::End } else { Place::Top };
            (Status::Todo, place)
        }
        Action::ResetProgress => {
            set_done(conn, item_id, 0)?;
            log(conn, item_id, "reset", 0)?;
            (Status::Todo, Place::Top)
        }
    };
    let index = index.unwrap_or_else(|| match place {
        Place::Top => 0,
        Place::End => usize::MAX,
    });
    repo::reorder(conn, item_id, target.as_str(), index)?;
    tx.commit()?;
    repo::get_item(conn, item_id)
}

pub fn history(conn: &Connection, item_id: i64) -> AppResult<Vec<PrintEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, item_id, printer_id, kind, copies, at FROM print_events
         WHERE item_id = ?1 ORDER BY at DESC, id DESC",
    )?;
    let events = stmt
        .query_map([item_id], |r| {
            Ok(PrintEvent {
                id: r.get(0)?,
                item_id: r.get(1)?,
                printer_id: r.get(2)?,
                kind: r.get(3)?,
                copies: r.get(4)?,
                at: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ItemPatch;
    use crate::repo::{self, tests::{fixture, source, Fx}};

    fn item(fx: &Fx, name: &str, total: i64, done: i64, cpp: i64) -> i64 {
        let p = source(fx, "s", &format!("{name}.stl"), "x");
        let it = repo::import_files(&fx.conn, &fx.lib, fx.queue_id, &[p]).unwrap().imported.remove(0);
        let patch = ItemPatch {
            qty_total: Some(total),
            qty_done: Some(done),
            copies_per_plate: Some(cpp),
            ..Default::default()
        };
        repo::update_item(&fx.conn, it.id, &patch).unwrap().id
    }

    fn kinds(fx: &Fx, id: i64) -> Vec<(String, i64)> {
        history(&fx.conn, id).unwrap().into_iter().map(|e| (e.kind, e.copies)).collect()
    }

    #[test]
    fn start_logs_started() {
        let fx = fixture();
        let id = item(&fx, "a", 4, 0, 2);
        let it = apply(&fx.conn, id, Action::Start, None).unwrap();
        assert_eq!(it.status, "printing");
        assert_eq!(kinds(&fx, id), [("started".to_string(), 2)]);
        assert_eq!(history(&fx.conn, id).unwrap()[0].printer_id, Some(1));
    }

    #[test]
    fn finish_partial_returns_to_top_of_todo() {
        let fx = fixture();
        let _other = item(&fx, "other", 1, 0, 1);
        let id = item(&fx, "a", 4, 0, 1);
        apply(&fx.conn, id, Action::Start, None).unwrap();
        let it = apply(&fx.conn, id, Action::Finish, None).unwrap();
        assert_eq!(it.status, "todo");
        assert_eq!(it.sort, 0);
        assert_eq!(it.qty_done, 1);
    }

    #[test]
    fn finish_caps_at_total() {
        let fx = fixture();
        let id = item(&fx, "a", 5, 3, 3);
        apply(&fx.conn, id, Action::Start, None).unwrap();
        let it = apply(&fx.conn, id, Action::Finish, None).unwrap();
        assert_eq!(it.qty_done, 5);
        assert_eq!(it.status, "done");
        assert_eq!(kinds(&fx, id)[0], ("finished".to_string(), 2));
    }

    #[test]
    fn fail_keeps_done() {
        let fx = fixture();
        let id = item(&fx, "a", 4, 2, 1);
        apply(&fx.conn, id, Action::Start, None).unwrap();
        let it = apply(&fx.conn, id, Action::Fail, None).unwrap();
        assert_eq!(it.status, "failed");
        assert_eq!(it.qty_done, 2);
        assert_eq!(kinds(&fx, id)[0].0, "failed");
    }

    #[test]
    fn drag_to_done_sets_total() {
        let fx = fixture();
        let id = item(&fx, "a", 4, 1, 1);
        let it = apply(&fx.conn, id, Action::MoveTo { status: Status::Done }, Some(0)).unwrap();
        assert_eq!(it.qty_done, 4);
        assert_eq!(it.status, "done");
        assert_eq!(kinds(&fx, id), [("finished".to_string(), 3)]);
    }

    #[test]
    fn printing_to_todo_logs_reset() {
        let fx = fixture();
        let id = item(&fx, "a", 1, 0, 1);
        apply(&fx.conn, id, Action::Start, None).unwrap();
        let it = apply(&fx.conn, id, Action::MoveTo { status: Status::Todo }, Some(0)).unwrap();
        assert_eq!(it.status, "todo");
        assert_eq!(kinds(&fx, id)[0], ("reset".to_string(), 0));
    }

    #[test]
    fn same_column_move_no_event() {
        let fx = fixture();
        let a = item(&fx, "a", 1, 0, 1);
        let b = item(&fx, "b", 1, 0, 1);
        let it = apply(&fx.conn, b, Action::MoveTo { status: Status::Todo }, Some(0)).unwrap();
        assert_eq!(it.sort, 0);
        assert_eq!(repo::get_item(&fx.conn, a).unwrap().sort, 1);
        assert!(history(&fx.conn, b).unwrap().is_empty());
    }

    #[test]
    fn reset_progress_zeroes() {
        let fx = fixture();
        let id = item(&fx, "a", 3, 0, 1);
        apply(&fx.conn, id, Action::MoveTo { status: Status::Done }, None).unwrap();
        let it = apply(&fx.conn, id, Action::ResetProgress, None).unwrap();
        assert_eq!(it.qty_done, 0);
        assert_eq!(it.status, "todo");
        assert_eq!(kinds(&fx, id)[0].0, "reset");
    }

    #[test]
    fn action_deserialises_from_frontend_shape() {
        let a: Action = serde_json::from_str(r#"{"type":"moveTo","status":"done"}"#).unwrap();
        assert!(matches!(a, Action::MoveTo { status: Status::Done }));
        let a: Action = serde_json::from_str(r#"{"type":"finish"}"#).unwrap();
        assert!(matches!(a, Action::Finish));
    }
}
