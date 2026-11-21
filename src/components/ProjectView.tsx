import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, Boxes, ExternalLink, Layers, Pencil, Plus, Smile, Trash2 } from "lucide-react";
import {
  createQueue,
  deleteProject,
  deleteQueue,
  errorText,
  listInvoices,
  listQueues,
  openInSlicer,
  updateProject,
  updateQueue,
  type Invoice,
  type ProjectSummary,
  type QueueSummary,
} from "../api";
import { useLibrary } from "../hooks/useLibrary";
import { formatGrams, formatMinutes } from "../lib/format";
import { formatMoney } from "../lib/money";
import { percent } from "../lib/progress";
import { EntityIcon, IconPicker } from "./Icons";
import { InvoiceSheet, invoiceDate } from "./Invoice";
import { Menu } from "./Menu";
import { ConfirmModal, PromptModal } from "./Modal";
import { LayerBar } from "./ProgressBar";
import { Thumbnail } from "./Thumbnail";
import { useToast } from "./Toast";

const SWATCHES = ["#8b9cff", "#4cc38a", "#f2b544", "#f0716a", "#5cc8e6", "#c88bff", "#a3abba"];

type Dialog =
  | { kind: "new-queue" }
  | { kind: "rename-queue"; queue: QueueSummary }
  | { kind: "delete-queue"; queue: QueueSummary }
  | { kind: "queue-icon"; queue: QueueSummary }
  | { kind: "project-icon" }
  | { kind: "rename-project" }
  | { kind: "delete-project" }
  | null;

export function ProjectView({ summary, onOpenQueue, onChanged }: {
  summary: ProjectSummary;
  onOpenQueue: (queueId: number) => void;
  onChanged: () => void;
}) {
  const { project } = summary;
  const toast = useToast();
  const [queues, refreshQueues] = useLibrary(() => listQueues(project.id), [project.id]);
  const [invoices, refreshInvoices] = useLibrary(() => listInvoices(project.id), [project.id]);
  const [shownInvoice, setShownInvoice] = useState<Invoice | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [description, setDescription] = useState(project.description);

  useEffect(() => setDescription(project.description), [project.description]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setDialog(null);
      refreshQueues();
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const pct = percent(summary.donePrints, summary.totalPrints);

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="title-with-icon">
            <button
              className="icon-pick"
              onClick={() => setDialog({ kind: "project-icon" })}
              title="Change icon"
              aria-label="Change project icon"
            >
              <EntityIcon name={project.icon} fallback={Boxes} size={24} color={project.color ?? "var(--accent)"} />
            </button>
            {project.name}
          </h1>
          <input
            className="desc-input"
            value={description}
            placeholder="Add a short description"
            aria-label="Project description"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== project.description && act(() => updateProject(project.id, { description }))}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <div className="row" role="radiogroup" aria-label="Project colour" style={{ gap: 4 }}>
            {SWATCHES.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={project.color === c}
                aria-label={`Colour ${c}`}
                onClick={() => act(() => updateProject(project.id, { color: c }))}
                style={{
                  width: 16, height: 16, borderRadius: 5, background: c, cursor: "pointer",
                  border: project.color === c ? "2px solid var(--text)" : "2px solid transparent",
                }}
              />
            ))}
          </div>
          <Menu
            label="Project actions"
            entries={[
              { label: "Rename", icon: <Pencil size={14} />, onClick: () => setDialog({ kind: "rename-project" }) },
              { label: "Change icon", icon: <Smile size={14} />, onClick: () => setDialog({ kind: "project-icon" }) },
              project.archived
                ? { label: "Restore", icon: <ArchiveRestore size={14} />, onClick: () => act(() => updateProject(project.id, { archived: false })) }
                : { label: "Archive", icon: <Archive size={14} />, onClick: () => act(() => updateProject(project.id, { archived: true })) },
              { label: "Delete project", icon: <Trash2 size={14} />, danger: true, onClick: () => setDialog({ kind: "delete-project" }) },
            ]}
          />
        </div>
      </div>

      <div className="overview">
        <div>
          <div className="label">Printed</div>
          <div className="value">
            {pct}%<small>{summary.donePrints} of {summary.totalPrints} parts</small>
          </div>
          <LayerBar done={summary.donePrints} total={summary.totalPrints} size="lg" />
        </div>
        <div>
          <div className="label">Print time left</div>
          <div className="value">{summary.remainingMinutes ? formatMinutes(summary.remainingMinutes) : "—"}</div>
        </div>
        <div>
          <div className="label">Value</div>
          <div className="value">{summary.valueCents ? formatMoney(summary.valueCents) : "—"}</div>
        </div>
        <div>
          <div className="label">Owed to you</div>
          <div className={`value${summary.owedCents > 0 ? " is-owed" : ""}`}>
            {summary.owedCents ? formatMoney(summary.owedCents) : "—"}
          </div>
        </div>
      </div>

      {(summary.gramsUsed > 0 || summary.minutesUsed > 0 || summary.paidCents > 0) && (
        <div className="usage-line">
          <span>Filament used <strong>{formatGrams(summary.gramsUsed)}</strong></span>
          <span>Print time <strong>{formatMinutes(summary.minutesUsed)}</strong></span>
          <span>Paid back <strong>{formatMoney(summary.paidCents)}</strong></span>
        </div>
      )}

      <div className="section-head">
        <h2>Queues</h2>
      </div>
      <div className="queue-grid">
        {queues?.map((q) => (
          <div
            key={q.queue.id}
            className="queue-card"
            role="button"
            tabIndex={0}
            onClick={() => onOpenQueue(q.queue.id)}
            onKeyDown={(e) => e.key === "Enter" && onOpenQueue(q.queue.id)}
          >
            <div className="queue-card-head">
              <h3 className="title-with-icon">
                <EntityIcon name={q.queue.icon} fallback={Layers} size={16} />
                <span>{q.queue.name}</span>
              </h3>
              <Menu
                label={`Actions for ${q.queue.name}`}
                entries={[
                  { label: "Rename", icon: <Pencil size={14} />, onClick: () => setDialog({ kind: "rename-queue", queue: q }) },
                  { label: "Change icon", icon: <Smile size={14} />, onClick: () => setDialog({ kind: "queue-icon", queue: q }) },
                  { label: "Delete queue", icon: <Trash2 size={14} />, danger: true, onClick: () => setDialog({ kind: "delete-queue", queue: q }) },
                ]}
              />
            </div>
            <LayerBar done={q.donePrints} total={q.totalPrints} />
            <div className="queue-stats">
              <span>{q.donePrints}/{q.totalPrints} printed</span>
              {q.printingCount > 0 && <span className="printing">{q.printingCount} printing</span>}
              {q.owedCents > 0 && <span className="is-owed">{formatMoney(q.owedCents)} owed</span>}
            </div>
            {q.nextItem ? (
              <div className="next-up">
                <Thumbnail item={q.nextItem} size="sm" />
                <div style={{ minWidth: 0 }}>
                  <div className="label">Next up</div>
                  <div className="name">{q.nextItem.name}</div>
                </div>
                <button
                  className="btn sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    openInSlicer(q.nextItem!.id).catch((err) => toast(errorText(err), "error"));
                  }}
                >
                  <ExternalLink size={13} /> Slicer
                </button>
              </div>
            ) : (
              <div className="next-up is-empty">
                {q.totalPrints === 0 ? "Empty. Open it to add model files." : "Nothing left to start."}
              </div>
            )}
          </div>
        ))}
        <button className="add-queue" onClick={() => setDialog({ kind: "new-queue" })}>
          <span className="row"><Plus size={16} /> New queue</span>
        </button>
      </div>

      {invoices && invoices.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 28 }}>
            <h2>Invoices</h2>
          </div>
          <ul className="invoice-list">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <button className="invoice-row" onClick={() => setShownInvoice(inv)}>
                  <span className="invoice-row-who">{inv.recipient || "No name"}</span>
                  <span className="muted">
                    #{inv.id} · {invoiceDate(inv.createdAt)} · {queues?.find((q) => q.queue.id === inv.queueId)?.queue.name ?? "Deleted queue"}
                    {" · "}{inv.lines.length} item{inv.lines.length > 1 ? "s" : ""}
                  </span>
                  <span className={`invoice-status ${inv.paid ? "is-paid" : "is-owed"}`}>{inv.paid ? "Paid" : "Owed"}</span>
                  <span className="invoice-row-total">{formatMoney(inv.totalCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {shownInvoice && (
        <InvoiceSheet
          invoice={shownInvoice}
          projectName={project.name}
          queueName={queues?.find((q) => q.queue.id === shownInvoice.queueId)?.queue.name}
          onChanged={() => {
            refreshInvoices();
            onChanged();
          }}
          onClose={() => setShownInvoice(null)}
        />
      )}

      {dialog?.kind === "new-queue" && (
        <PromptModal
          title="New queue"
          label="Queue name, for example PLA black or Plate 1"
          confirm="Create queue"
          onSubmit={(name) => act(async () => onOpenQueue((await createQueue(project.id, name)).id))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename-queue" && (
        <PromptModal
          title="Rename queue"
          label="Queue name"
          initial={dialog.queue.queue.name}
          confirm="Rename"
          onSubmit={(name) => act(() => updateQueue(dialog.queue.queue.id, { name }))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "queue-icon" && (
        <IconPicker
          title={`Icon for ${dialog.queue.queue.name}`}
          current={dialog.queue.queue.icon}
          onPick={(icon) => act(() => updateQueue(dialog.queue.queue.id, { icon }))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "project-icon" && (
        <IconPicker
          title={`Icon for ${project.name}`}
          current={project.icon}
          color={project.color ?? "var(--accent)"}
          onPick={(icon) => act(() => updateProject(project.id, { icon }))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete-queue" && (
        <ConfirmModal
          title={`Delete ${dialog.queue.queue.name}?`}
          message="All its items are removed and its folder, with every model file, is moved to the Recycle Bin."
          confirm="Delete queue"
          danger
          onConfirm={() => act(() => deleteQueue(dialog.queue.queue.id))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename-project" && (
        <PromptModal
          title="Rename project"
          label="Project name"
          initial={project.name}
          confirm="Rename"
          onSubmit={(name) => act(() => updateProject(project.id, { name }))}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete-project" && (
        <ConfirmModal
          title={`Delete ${project.name}?`}
          message="All queues and items are removed and the project folder is moved to the Recycle Bin. To keep it out of the way instead, archive it."
          confirm="Delete project"
          danger
          onConfirm={() => act(() => deleteProject(project.id))}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
