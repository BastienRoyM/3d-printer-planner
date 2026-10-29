import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export interface MenuEntry {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void;
}

export function Menu({ entries, label = "More actions" }: { entries: MenuEntry[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="icon-btn sm" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {entries.map((e) => (
            <button
              key={e.label}
              role="menuitem"
              className={e.danger ? "danger" : undefined}
              onClick={() => {
                setOpen(false);
                e.onClick();
              }}
            >
              {e.icon}
              {e.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
