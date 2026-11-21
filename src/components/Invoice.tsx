import { useEffect, useState } from "react";
import { Check, Copy, Printer, Trash2, Undo2, X } from "lucide-react";
import { deleteInvoice, errorText, updateInvoice, type Invoice, type Item } from "../api";
import { formatMoney } from "../lib/money";
import { ConfirmModal, Modal } from "./Modal";
import { useToast } from "./Toast";

export const invoiceDate = (at: string) =>
  new Date(at.replace(" ", "T") + "Z").toLocaleDateString(undefined, { dateStyle: "medium" });

const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** The invoice as plain text, to paste into a message. */
export function invoiceText(invoice: Invoice, projectName: string): string {
  const lines = invoice.lines.map(
    (l) => `- ${l.name} ×${l.qty}${l.grams != null ? ` (${l.grams} g)` : ""}: ${formatMoney(l.priceCents)}`,
  );
  return [
    `${projectName}${invoice.recipient ? ` for ${invoice.recipient}` : ""} (${invoiceDate(invoice.createdAt)})`,
    ...lines,
    `Total: ${formatMoney(invoice.totalCents)}${invoice.paid ? " (paid, thanks!)" : ""}`,
    ...(invoice.note ? ["", invoice.note] : []),
  ].join("\n");
}

/** Who the invoice is for and an optional note, before creating it from the picked items. */
export function CreateInvoiceModal({ items, recipients, onSubmit, onClose }: {
  items: Item[];
  recipients: string[];
  onSubmit: (recipient: string, note: string) => void;
  onClose: () => void;
}) {
  const total = sum(items.map((i) => i.priceCents));
  const unpriced = items.filter((i) => i.priceCents == null).length;
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    onSubmit(String(data.get("recipient") ?? ""), String(data.get("note") ?? ""));
  };
  return (
    <Modal title="New invoice" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <p className="muted">
          {items.length} item{items.length > 1 ? "s" : ""} for <strong>{formatMoney(total)}</strong>
          {unpriced > 0 && <>. {unpriced} ha{unpriced > 1 ? "ve" : "s"} no price yet and will count as {formatMoney(0)}.</>}
        </p>
        <label className="field">
          <span>Who is it for?</span>
          <input name="recipient" list="recipients" placeholder="A friend's name" autoFocus />
          <datalist id="recipients">{recipients.map((r) => <option key={r} value={r} />)}</datalist>
        </label>
        <label className="field">
          <span>Note (optional)</span>
          <input name="note" placeholder="Pay me back by e-transfer…" />
        </label>
        <div className="row-end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Create invoice</button>
        </div>
      </form>
    </Modal>
  );
}

export function InvoiceSheet({ invoice: initial, projectName, queueName, onChanged, onClose }: {
  invoice: Invoice;
  projectName: string;
  queueName?: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [invoice, setInvoice] = useState(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => setInvoice(initial), [initial]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !confirmDelete && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmDelete]);

  const setPaid = async (paid: boolean) => {
    try {
      setInvoice(await updateInvoice(invoice.id, { paid }));
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(invoiceText(invoice, projectName));
      toast("Copied. Paste it in a message.");
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const remove = async () => {
    try {
      await deleteInvoice(invoice.id);
      onChanged();
      onClose();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const grams = invoice.lines.some((l) => l.grams != null) ? sum(invoice.lines.map((l) => l.grams)) : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal invoice-modal" role="dialog" aria-modal="true" aria-label={`Invoice ${invoice.id}`}>
        <header className="modal-head no-print">
          <h2>Invoice #{invoice.id}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="invoice-sheet">
          <div className="invoice-top">
            <div>
              <div className="invoice-label">For</div>
              <div className="invoice-who">{invoice.recipient || "—"}</div>
              <div className="muted">{projectName}{queueName ? ` · ${queueName}` : ""}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="invoice-label">#{invoice.id} · {invoiceDate(invoice.createdAt)}</div>
              <span className={`invoice-status ${invoice.paid ? "is-paid" : "is-owed"}`}>{invoice.paid ? "Paid" : "Owed"}</span>
            </div>
          </div>

          <table className="invoice-table">
            <thead>
              <tr><th>Item</th><th className="num">Qty</th><th className="num">Grams</th><th className="num">Price</th></tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td className="num">{l.qty}</td>
                  <td className="num">{l.grams != null ? `${l.grams} g` : "—"}</td>
                  <td className="num">{formatMoney(l.priceCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td className="num">{grams != null ? `${grams} g` : ""}</td>
                <td className="num">{formatMoney(invoice.totalCents)}</td>
              </tr>
            </tfoot>
          </table>
          {invoice.note && <p className="invoice-note">{invoice.note}</p>}
        </div>

        <footer className="modal-foot invoice-actions no-print">
          <button className="btn ghost" style={{ color: "var(--failed)", marginRight: "auto" }} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} /> Delete
          </button>
          <button className="btn" onClick={copy}><Copy size={15} /> Copy as text</button>
          <button className="btn" onClick={() => window.print()}><Printer size={15} /> Print / PDF</button>
          {invoice.paid ? (
            <button className="btn" onClick={() => setPaid(false)}><Undo2 size={15} /> Mark as owed</button>
          ) : (
            <button className="btn primary" onClick={() => setPaid(true)}><Check size={15} /> Mark as paid</button>
          )}
        </footer>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title={`Delete invoice #${invoice.id}?`}
          message="The items stay; only this invoice is removed."
          confirm="Delete invoice"
          danger
          onConfirm={remove}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
