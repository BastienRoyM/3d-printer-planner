import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createQueue,
  deleteProject,
  deleteQueue,
  errorText,
  listQueues,
  openInSlicer,
  renameQueue,
  updateProject,
  type ProjectSummary,
  type QueueSummary,
} from "../api";
import { useLibrary } from "../hooks/useLibrary";
import { formatGrams, formatMinutes } from "../lib/format";
import { percent } from "../lib/progress";
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
          <h1>{project.name}</h1>
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
          <div className="label">Filament left</div>
          <div className="value">{summary.remainingGrams ? formatGrams(summary.remainingGrams) : "—"}</div>
        </div>
      </div>

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
              <h3>{q.queue.name}</h3>
              <Menu
                label={`Actions for ${q.queue.name}`}
                entries={[
                  { label: "Rename", icon: <Pencil size={14} />, onClick: () => setDialog({ kind: "rename-queue", queue: q }) },
                  { label: "Delete queue", icon: <Trash2 size={14} />, danger: true, onClick: () => setDialog({ kind: "delete-queue", queue: q }) },
                ]}
              />
            </div>
            <LayerBar done={q.donePrints} total={q.totalPrints} />
            <div className="queue-stats">
              <span>{q.donePrints}/{q.totalPrints} printed</span>
              {q.printingCount > 0 && <span className="printing">{q.printingCount} printing</span>}
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
          onSubmit={(name) => act(() => renameQueue(dialog.queue.queue.id, name))}
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
