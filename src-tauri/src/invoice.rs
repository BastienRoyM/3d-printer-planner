//! Simple invoices: a list of items with their prices, to keep track of what a friend owes.

use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::error::{AppError, AppResult};
use crate::models::{Invoice, InvoiceLine};
use crate::repo;

const INVOICE_COLS: &str = "id, project_id, queue_id, recipient, note, paid, created_at";

fn invoice_from_row(r: &Row) -> rusqlite::Result<Invoice> {
    Ok(Invoice {
        id: r.get(0)?,
        project_id: r.get(1)?,
        queue_id: r.get(2)?,
        recipient: r.get(3)?,
        note: r.get(4)?,
        paid: r.get(5)?,
        created_at: r.get(6)?,
        total_cents: 0,
        lines: Vec::new(),
    })
}

fn load_lines(conn: &Connection, invoice: &mut Invoice) -> AppResult<()> {
    let mut stmt = conn.prepare(
        "SELECT id, item_id, name, qty, grams, price_cents FROM invoice_lines WHERE invoice_id = ?1 ORDER BY sort, id",
    )?;
    invoice.lines = stmt
        .query_map([invoice.id], |r| {
            Ok(InvoiceLine {
                id: r.get(0)?,
                item_id: r.get(1)?,
                name: r.get(2)?,
                qty: r.get(3)?,
                grams: r.get(4)?,
                price_cents: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    invoice.total_cents = invoice.lines.iter().map(|l| l.price_cents).sum();
    Ok(())
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Invoice> {
    let mut invoice = conn
        .query_row(
            &format!("SELECT {INVOICE_COLS} FROM invoices WHERE id = ?1"),
            [id],
            invoice_from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("invoice {id}")))?;
    load_lines(conn, &mut invoice)?;
    Ok(invoice)
}

/// A project's invoices, newest first.
pub fn list(conn: &Connection, project_id: i64) -> AppResult<Vec<Invoice>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {INVOICE_COLS} FROM invoices WHERE project_id = ?1 ORDER BY created_at DESC, id DESC"
    ))?;
    let mut invoices: Vec<Invoice> = stmt
        .query_map([project_id], invoice_from_row)?
        .collect::<Result<_, _>>()?;
    for invoice in &mut invoices {
        load_lines(conn, invoice)?;
    }
    Ok(invoices)
}

/// Bills `item_ids` (all from `queue_id`) at their current price and grams.
pub fn create(
    conn: &Connection,
    queue_id: i64,
    item_ids: &[i64],
    recipient: &str,
    note: &str,
) -> AppResult<Invoice> {
    if item_ids.is_empty() {
        return Err(AppError::Invalid("Pick at least one item for the invoice".into()));
    }
    let queue = repo::get_queue(conn, queue_id)?;
    let items = item_ids
        .iter()
        .map(|&id| repo::get_item(conn, id))
        .collect::<AppResult<Vec<_>>>()?;
    if let Some(stray) = items.iter().find(|i| i.queue_id != queue_id) {
        return Err(AppError::Invalid(format!("{} is not in {}", stray.name, queue.name)));
    }

    let tx = conn.unchecked_transaction()?;
    conn.execute(
        "INSERT INTO invoices (project_id, queue_id, recipient, note) VALUES (?1, ?2, ?3, ?4)",
        params![queue.project_id, queue_id, recipient.trim(), note.trim()],
    )?;
    let id = conn.last_insert_rowid();
    for (sort, item) in items.iter().enumerate() {
        conn.execute(
            "INSERT INTO invoice_lines (invoice_id, item_id, name, qty, grams, price_cents, sort)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                item.id,
                item.name,
                item.qty_total,
                item.grams_used,
                item.price_cents.unwrap_or(0),
                sort as i64
            ],
        )?;
    }
    tx.commit()?;
    get(conn, id)
}

pub fn update(
    conn: &Connection,
    id: i64,
    recipient: Option<String>,
    note: Option<String>,
    paid: Option<bool>,
) -> AppResult<Invoice> {
    let cur = get(conn, id)?;
    conn.execute(
        "UPDATE invoices SET recipient = ?2, note = ?3, paid = ?4 WHERE id = ?1",
        params![
            id,
            recipient.map(|r| r.trim().to_string()).unwrap_or(cur.recipient),
            note.map(|n| n.trim().to_string()).unwrap_or(cur.note),
            paid.unwrap_or(cur.paid)
        ],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM invoices WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::ItemPatch;
    use crate::repo::tests::{fixture, source};

    fn priced(fx: &crate::repo::tests::Fx, name: &str, cents: i64, grams: i64) -> i64 {
        let path = source(fx, "s", name, "x");
        let item = repo::import_files(&fx.conn, &fx.lib, fx.queue_id, &[path])
            .unwrap()
            .imported
            .remove(0);
        let patch = ItemPatch {
            price_cents: Some(Some(cents)),
            grams_used: Some(Some(grams)),
            minutes_used: Some(Some(grams * 2)),
            ..Default::default()
        };
        repo::update_item(&fx.conn, item.id, &patch).unwrap().id
    }

    #[test]
    fn create_snapshots_items_and_totals() {
        let fx = fixture();
        let a = priced(&fx, "a.stl", 1250, 80);
        let b = priced(&fx, "b.stl", 500, 20);
        let inv = create(&fx.conn, fx.queue_id, &[a, b], " Sam ", "").unwrap();
        assert_eq!(inv.recipient, "Sam");
        assert_eq!(inv.total_cents, 1750);
        assert_eq!(inv.lines.len(), 2);
        assert_eq!(inv.lines[0].grams, Some(80));
        assert!(repo::get_item(&fx.conn, a).unwrap().invoiced);

        // Later price changes leave the invoice alone.
        let patch = ItemPatch {
            price_cents: Some(Some(9999)),
            ..Default::default()
        };
        repo::update_item(&fx.conn, a, &patch).unwrap();
        assert_eq!(get(&fx.conn, inv.id).unwrap().total_cents, 1750);
    }

    #[test]
    fn owed_counts_unpaid_invoices_only() {
        let fx = fixture();
        let a = priced(&fx, "a.stl", 1000, 10);
        let inv = create(&fx.conn, fx.queue_id, &[a], "Sam", "").unwrap();
        let s = repo::list_projects(&fx.conn).unwrap().remove(0);
        assert_eq!(s.value_cents, 1000);
        assert_eq!(s.owed_cents, 1000);
        assert_eq!(s.queues[0].owed_cents, 1000);

        assert_eq!(s.paid_cents, 0);
        assert_eq!(s.grams_used, 10);
        assert_eq!(s.minutes_used, 20);

        update(&fx.conn, inv.id, None, None, Some(true)).unwrap();
        let s = repo::list_projects(&fx.conn).unwrap().remove(0);
        assert_eq!(s.owed_cents, 0);
        assert_eq!(s.paid_cents, 1000);
        assert_eq!(s.queues[0].owed_cents, 0);
    }

    #[test]
    fn deleting_an_item_keeps_its_invoice_line() {
        let fx = fixture();
        let a = priced(&fx, "a.stl", 700, 5);
        let inv = create(&fx.conn, fx.queue_id, &[a], "Sam", "").unwrap();
        repo::delete_item(&fx.conn, &fx.lib, a).unwrap();
        let inv = get(&fx.conn, inv.id).unwrap();
        assert_eq!(inv.lines[0].item_id, None);
        assert_eq!(inv.total_cents, 700);
    }

    #[test]
    fn rejects_empty_and_foreign_items() {
        let fx = fixture();
        assert!(create(&fx.conn, fx.queue_id, &[], "Sam", "").is_err());
        let a = priced(&fx, "a.stl", 100, 1);
        let p = repo::get_queue(&fx.conn, fx.queue_id).unwrap().project_id;
        let other = repo::create_queue(&fx.conn, &fx.lib, p, "Other").unwrap();
        assert!(create(&fx.conn, other.id, &[a], "Sam", "").is_err());
    }

    #[test]
    fn list_and_delete() {
        let fx = fixture();
        let a = priced(&fx, "a.stl", 100, 1);
        let inv = create(&fx.conn, fx.queue_id, &[a], "Sam", "").unwrap();
        assert_eq!(list(&fx.conn, inv.project_id).unwrap().len(), 1);
        delete(&fx.conn, inv.id).unwrap();
        assert!(list(&fx.conn, inv.project_id).unwrap().is_empty());
        assert!(!repo::get_item(&fx.conn, a).unwrap().invoiced);
    }
}
