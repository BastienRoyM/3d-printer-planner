import { useState } from "react";
import { Boxes, ChevronRight, Layers, Plus, Settings } from "lucide-react";
import type { ProjectSummary } from "../api";
import { percent } from "../lib/progress";
import { AppLogo } from "./AppLogo";
import { EntityIcon } from "./Icons";
import { LayerBar } from "./ProgressBar";

const COLLAPSED_KEY = "sidebar-collapsed";

function loadCollapsed(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function Sidebar({ projects, projectId, queueId, onSelectProject, onSelectQueue, onNew, onSettings }: {
  projects: ProjectSummary[] | undefined;
  projectId: number | null;
  queueId: number | null;
  onSelectProject: (id: number) => void;
  onSelectQueue: (projectId: number, queueId: number) => void;
  onNew: () => void;
  onSettings: () => void;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const active = projects?.filter((p) => !p.project.archived) ?? [];
  const archived = projects?.filter((p) => p.project.archived) ?? [];

  const toggle = (id: number) => {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
    } catch {
      // Only a convenience: the sidebar still works without it.
    }
  };

  const group = (p: ProjectSummary) => {
    const { project } = p;
    const open = !collapsed.has(project.id);
    const color = project.color ?? "var(--accent)";
    return (
      <li key={project.id} className="project-group">
        <div className={`project-row${project.id === projectId && queueId == null ? " is-selected" : ""}`}>
          <button
            className="project-toggle"
            onClick={() => toggle(project.id)}
            aria-expanded={open}
            aria-label={open ? `Hide queues of ${project.name}` : `Show queues of ${project.name}`}
            disabled={p.queues.length === 0}
          >
            <ChevronRight size={14} className={open && p.queues.length > 0 ? "rot90" : ""} />
          </button>
          <button className="project-main" onClick={() => onSelectProject(project.id)}>
            <EntityIcon name={project.icon} fallback={Boxes} color={color} />
            <span className="project-row-name">{project.name}</span>
            <span className="project-row-pct">{percent(p.donePrints, p.totalPrints)}%</span>
            <LayerBar done={p.donePrints} total={p.totalPrints} size="sm" />
          </button>
        </div>
        {open && p.queues.length > 0 && (
          <ul className="queue-list" style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}>
            {p.queues.map((q) => (
              <li key={q.queue.id}>
                <button
                  className={`queue-row${q.queue.id === queueId ? " is-selected" : ""}`}
                  onClick={() => onSelectQueue(project.id, q.queue.id)}
                >
                  <EntityIcon name={q.queue.icon} fallback={Layers} size={14} />
                  <span className="queue-row-name">{q.queue.name}</span>
                  {q.printingCount > 0 && <span className="status-dot status-printing" title={`${q.printingCount} printing`} />}
                  <span className="queue-row-count">{q.donePrints}/{q.totalPrints}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <AppLogo size={24} />
        <span>Print Planner</span>
      </div>

      <div className="sidebar-head">
        <h2>Projects</h2>
        <button className="icon-btn" onClick={onNew} aria-label="New project" title="New project">
          <Plus size={18} />
        </button>
      </div>

      <div className="sidebar-scroll">
        <ul className="project-list">
          {active.map(group)}
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
            {showArchived && <ul className="project-list is-archived">{archived.map(group)}</ul>}
          </>
        )}
      </div>

      <button className="sidebar-settings" onClick={onSettings}>
        <Settings size={16} /> Settings
      </button>
    </aside>
  );
}
