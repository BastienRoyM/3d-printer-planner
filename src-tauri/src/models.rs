use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub folder_rel: String,
    pub archived: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub project: Project,
    pub total_prints: i64,
    pub done_prints: i64,
    pub items_total: i64,
    pub items_done: i64,
    pub remaining_minutes: i64,
    /// Sum of item prices.
    pub value_cents: i64,
    /// Sum of unpaid invoices.
    pub owed_cents: i64,
    /// Sum of paid invoices.
    pub paid_cents: i64,
    /// Sum of item grams used.
    pub grams_used: i64,
    /// Sum of item print times, in minutes.
    pub minutes_used: i64,
    pub queues: Vec<QueueStats>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Queue {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub icon: Option<String>,
    pub folder_rel: String,
}

/// A queue with its progress counts: what the sidebar lists under each project.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueStats {
    pub queue: Queue,
    pub total_prints: i64,
    pub done_prints: i64,
    pub printing_count: i64,
    pub value_cents: i64,
    pub owed_cents: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSummary {
    #[serde(flatten)]
    pub stats: QueueStats,
    pub next_item: Option<Item>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemFile {
    pub id: i64,
    pub item_id: i64,
    pub rel_path: String,
    pub kind: String,
    pub is_original: bool,
    pub added_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: i64,
    pub queue_id: i64,
    pub name: String,
    pub status: String,
    pub qty_total: i64,
    pub qty_done: i64,
    pub copies_per_plate: i64,
    pub notes: String,
    pub est_minutes: Option<i64>,
    /// Total price for the whole item, all copies.
    pub price_cents: Option<i64>,
    /// Total filament the item used, all copies.
    pub grams_used: Option<i64>,
    /// Total time the item took to print, all copies, in minutes.
    pub minutes_used: Option<i64>,
    /// Whether the item is on at least one invoice.
    pub invoiced: bool,
    pub printer_id: Option<i64>,
    pub thumbnail: Option<String>,
    pub sort: i64,
    pub created_at: String,
    pub updated_at: String,
    pub files: Vec<ItemFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintEvent {
    pub id: i64,
    pub item_id: i64,
    pub printer_id: Option<i64>,
    pub kind: String,
    pub copies: i64,
    pub at: String,
}

/// Editable item fields. `Some(None)` on an optional column clears it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPatch {
    pub name: Option<String>,
    pub qty_total: Option<i64>,
    pub qty_done: Option<i64>,
    pub copies_per_plate: Option<i64>,
    pub notes: Option<String>,
    #[serde(default, with = "double_option")]
    pub est_minutes: Option<Option<i64>>,
    #[serde(default, with = "double_option")]
    pub price_cents: Option<Option<i64>>,
    #[serde(default, with = "double_option")]
    pub grams_used: Option<Option<i64>>,
    #[serde(default, with = "double_option")]
    pub minutes_used: Option<Option<i64>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceLine {
    pub id: i64,
    pub item_id: Option<i64>,
    pub name: String,
    pub qty: i64,
    pub grams: Option<i64>,
    pub price_cents: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invoice {
    pub id: i64,
    pub project_id: i64,
    pub queue_id: Option<i64>,
    pub recipient: String,
    pub note: String,
    pub paid: bool,
    pub created_at: String,
    pub total_cents: i64,
    pub lines: Vec<InvoiceLine>,
}

mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, T, D>(d: D) -> Result<Option<Option<T>>, D::Error>
    where
        T: Deserialize<'de>,
        D: Deserializer<'de>,
    {
        Option::<T>::deserialize(d).map(Some)
    }
}
