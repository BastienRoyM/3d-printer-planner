import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({ title, onClose, children, footer }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** A small text prompt: used for naming projects and queues. */
export function PromptModal({ title, label, initial = "", confirm, onSubmit, onClose }: {
  title: string;
  label: string;
  initial?: string;
  confirm: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget).get("value") ?? "").trim();
    if (value) onSubmit(value);
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>{label}</span>
          <input name="value" defaultValue={initial} autoFocus required />
        </label>
        <div className="row-end">
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{confirm}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmModal({ title, message, confirm, danger, onConfirm, onClose }: {
  title: string;
  message: ReactNode;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm} autoFocus>{confirm}</button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Modal>
  );
}
