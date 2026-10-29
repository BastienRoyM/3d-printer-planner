import { useState } from "react";
import { ChevronRight, Plus, Settings } from "lucide-react";
import type { ProjectSummary } from "../api";
import { percent } from "../lib/progress";
import { LayerBar } from "./ProgressBar";

export function Sidebar({ projects, selectedId, onSelect, onNew, onSettings }: {
  projects: ProjectSummary[] | undefined;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onSettings: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const active = projects?.filter((p) => !p.project.archived) ?? [];
  const archived = projects?.filter((p) => p.project.archived) ?? [];

  const row = (p: ProjectSummary) => (
    <li key={p.project.id}>
      <button
        className={`project-row${p.project.id === selectedId ? " is-selected" : ""}`}
        onClick={() => onSelect(p.project.id)}
      >
        <span className="project-swatch" style={{ background: p.project.color ?? "var(--accent)" }} />
        <span className="project-row-name">{p.project.name}</span>
        <span className="project-row-pct">{percent(p.donePrints, p.totalPrints)}%</span>
        <LayerBar done={p.donePrints} total={p.totalPrints} size="sm" />
      </button>
    </li>
  );

  return (
    <aside className="sidebar">
      <div className="brand">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <rect x="4" y="16" width="16" height="3" rx="1" fill="var(--accent)" />
          <rect x="6" y="12" width="12" height="3" rx="1" fill="var(--accent)" opacity=".7" />
          <rect x="8" y="8" width="8" height="3" rx="1" fill="var(--accent)" opacity=".45" />
          <path d="M12 2v4" stroke="var(--text-2)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span>Print Planner</span>
      </div>

      <div className="sidebar-head">
        <h2>Projects</h2>
        <button className="icon-btn" onClick={onNew} aria-label="New project" title="New project">
          <Plus size={18} />
        </button>
      </div>

      <ul className="project-list">
        {active.map(row)}
        {projects && active.length === 0 && (
          <li className="sidebar-empty">
            <button className="btn primary block" onClick={onNew}>
              <Plus size={16} /> New project
            </button>
          </li>
        )}
      </ul>

      {archived.length > 0 && (
        <>
          <button className="archived-toggle" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived}>
            <ChevronRight size={14} className={showArchived ? "rot90" : ""} /> Archived ({archived.length})
          </button>
          {showArchived && <ul className="project-list is-archived">{archived.map(row)}</ul>}
        </>
      )}

      <button className="sidebar-settings" onClick={onSettings}>
        <Settings size={16} /> Settings
      </button>
    </aside>
  );
}
