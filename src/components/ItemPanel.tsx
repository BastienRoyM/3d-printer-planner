import { useEffect, useState } from "react";
import { ExternalLink, FolderOpen, Paperclip, RotateCcw, Trash2, X } from "lucide-react";
import {
  attachFile,
  deleteItem,
  errorText,
  fileName,
  itemAction,
  itemHistory,
  openInSlicer,
  revealItem,
  updateItem,
  type Item,
  type ItemPatch,
  type PrintEvent,
} from "../api";
import { formatGrams, formatMinutes } from "../lib/format";
import { platesRemaining } from "../lib/progress";
import { ConfirmModal } from "./Modal";
import { LayerBar } from "./ProgressBar";
import { Thumbnail } from "./Thumbnail";
import { useToast } from "./Toast";

const MATERIALS = ["PLA", "PLA+", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "Resin"];
const EVENT_TEXT: Record<PrintEvent["kind"], (c: number) => string> = {
  started: (c) => `Started printing (${c} per plate)`,
  finished: (c) => `Finished ${c} cop${c === 1 ? "y" : "ies"}`,
  failed: () => "Print failed",
  reset: () => "Moved back to To do",
};

/** Newest slicer project, else the original: mirrors the backend's open target. */
function openTargetId(item: Item): number | undefined {
  const projects = item.files.filter((f) => f.kind === "project" && !f.isOriginal);
  projects.sort((a, b) => (a.addedAt === b.addedAt ? a.id - b.id : a.addedAt < b.addedAt ? -1 : 1));
  return (projects.at(-1) ?? item.files.find((f) => f.isOriginal))?.id;
}

function NumberField({ label, value, min, onSave, suffix }: {
  label: string;
  value: number | null;
  min?: number;
  onSave: (v: number | null) => void;
  suffix?: string;
}) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const v = text.trim() === "" ? null : Math.max(min ?? 0, Math.round(Number(text)));
    if (v !== value && !Number.isNaN(v)) onSave(v);
    else setText(value == null ? "" : String(value));
  };
  return (
    <label className="field">
      <span>{label}{suffix && <em className="hint" style={{ fontStyle: "normal" }}> {suffix}</em>}</span>
      <input
        type="number"
        min={min}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

export function ItemPanel({ item, unassigned, onChanged, onClose }: {
  item: Item;
  unassigned: string[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [history, setHistory] = useState<PrintEvent[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(item.name);
  const [notes, setNotes] = useState(item.notes);
  const [material, setMaterial] = useState(item.material ?? "");

  useEffect(() => {
    setName(item.name);
    setNotes(item.notes);
    setMaterial(item.material ?? "");
    itemHistory(item.id).then(setHistory).catch(console.error);
  }, [item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !confirmDelete && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirmDelete]);

  const save = async (patch: ItemPatch) => {
    try {
      await updateItem(item.id, patch);
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const guard = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
      onChanged();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const remove = guard(async () => {
    await deleteItem(item.id);
    toast(`Deleted ${item.name}. Its files are in the Recycle Bin.`);
    onClose();
  });

  const target = openTargetId(item);
  const plates = platesRemaining(item);

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <aside className="panel" aria-label={`Details for ${item.name}`}>
        <div className="panel-head">
          <input
            value={name}
            aria-label="Item name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== item.name && save({ name })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <button className="icon-btn" onClick={onClose} aria-label="Close details">
            <X size={18} />
          </button>
        </div>

        <Thumbnail item={item} size="lg" />

        <div className="panel-actions">
          <button className="btn primary" onClick={guard(() => openInSlicer(item.id))}>
            <ExternalLink size={15} /> Open in slicer
          </button>
          <button className="btn" onClick={guard(() => revealItem(item.id))}>
            <FolderOpen size={15} /> Show in folder
          </button>
        </div>

        <section>
          <h3>Progress</h3>
          <div className="card-qty" style={{ marginBottom: 10 }}>
            <span>{item.qtyDone} of {item.qtyTotal} printed</span>
            <LayerBar done={item.qtyDone} total={item.qtyTotal} />
          </div>
          <div className="grid2">
            <NumberField label="Quantity" value={item.qtyTotal} min={1} onSave={(v) => save({ qtyTotal: v ?? 1 })} />
            <NumberField label="Printed" value={item.qtyDone} min={0} onSave={(v) => save({ qtyDone: v ?? 0 })} />
            <NumberField
              label="Copies per plate"
              value={item.copiesPerPlate}
              min={1}
              onSave={(v) => save({ copiesPerPlate: v ?? 1 })}
            />
            <div className="field">
              <span>Plates left</span>
              <div className="num" style={{ paddingTop: 7 }}>{plates}</div>
            </div>
          </div>
          {item.qtyDone > 0 && (
            <button
              className="btn ghost sm"
              style={{ marginTop: 8 }}
              onClick={guard(() => itemAction(item.id, { type: "resetProgress" }))}
            >
              <RotateCcw size={13} /> Reset progress
            </button>
          )}
        </section>

        <section>
          <h3>Filament</h3>
          <div className="grid2">
            <label className="field">
              <span>Material</span>
              <input
                list="materials"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                onBlur={() => material !== (item.material ?? "") && save({ material: material.trim() || null })}
              />
              <datalist id="materials">{MATERIALS.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            <label className="field">
              <span>Colour</span>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input
                  type="color"
                  value={item.color ?? "#8b9cff"}
                  onChange={(e) => save({ color: e.target.value })}
                  style={{ width: 44, padding: 2 }}
                />
                {item.color && (
                  <button className="btn ghost sm" onClick={() => save({ color: null })}>Clear</button>
                )}
              </div>
            </label>
            <NumberField
              label="Time per plate"
              suffix={item.estMinutes != null ? `(${formatMinutes(item.estMinutes)})` : "(minutes)"}
              value={item.estMinutes}
              onSave={(v) => save({ estMinutes: v })}
            />
            <NumberField label="Grams per plate" value={item.estGrams} onSave={(v) => save({ estGrams: v })} />
          </div>
          {(item.estMinutes != null || item.estGrams != null) && plates > 0 && (
            <p className="hint">
              Left to print: {formatMinutes(item.estMinutes != null ? item.estMinutes * plates : null)} and{" "}
              {formatGrams(item.estGrams != null ? item.estGrams * plates : null)}
            </p>
          )}
        </section>

        <section>
          <h3>Notes</h3>
          <label className="field">
            <textarea
              value={notes}
              placeholder="Supports, infill, orientation…"
              aria-label="Notes"
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== item.notes && save({ notes })}
            />
          </label>
        </section>

        <section>
          <h3>Files</h3>
          <ul className="file-list">
            {item.files.map((f) => (
              <li key={f.id} title={f.relPath}>
                <span className={`kind kind-${f.kind}`}>{f.kind === "gcode" ? "G-code" : f.kind === "project" ? "Project" : "Model"}</span>
                <span className="fname">{fileName(f.relPath)}</span>
                {f.isOriginal && <span className="hint" style={{ margin: 0 }}>original</span>}
                {f.id === target && <span className="tag">opens</span>}
              </li>
            ))}
          </ul>
          {unassigned.length > 0 && (
            <div className="row" style={{ marginTop: 8 }}>
              <Paperclip size={14} className="muted" />
              <select
                className="btn sm"
                value=""
                aria-label="Attach a file from this queue's folder"
                onChange={(e) => e.target.value && guard(() => attachFile(item.id, e.target.value))()}
              >
                <option value="">Attach a file from the folder…</option>
                {unassigned.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          )}
          <p className="hint">Files the slicer saves next to this model, like {item.name}.3mf, are added here automatically.</p>
        </section>

        <section>
          <h3>History</h3>
          {history.length === 0 ? (
            <p className="hint">No prints yet.</p>
          ) : (
            <ul className="history">
              {history.map((e) => (
                <li key={e.id}>
                  <time dateTime={e.at}>{new Date(e.at.replace(" ", "T") + "Z").toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
                  <span>{EVENT_TEXT[e.kind](e.copies)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <button className="btn ghost" style={{ color: "var(--failed)" }} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} /> Delete item
          </button>
        </section>
      </aside>

      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${item.name}?`}
          message={`Its ${item.files.length} file${item.files.length > 1 ? "s" : ""} will be moved to the Recycle Bin and its print history removed.`}
          confirm="Delete item"
          danger
          onConfirm={() => {
            setConfirmDelete(false);
            remove();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
