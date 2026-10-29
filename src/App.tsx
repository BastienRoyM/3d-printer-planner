import { useEffect, useState } from "react";
import { Layers, Plus } from "lucide-react";
import { createProject, errorText, getAppInfo, listProjects, listQueues } from "./api";
import { useLibrary } from "./hooks/useLibrary";
import { Sidebar } from "./components/Sidebar";
import { SettingsDialog } from "./components/SettingsDialog";
import { PromptModal } from "./components/Modal";
import { ToastProvider, useToast } from "./components/Toast";
import { ProjectView } from "./components/ProjectView";
import { QueueBoard } from "./components/QueueBoard";

type View = { projectId: number; queueId: number | null } | null;

function Shell() {
  const toast = useToast();
  const [projects, refreshProjects] = useLibrary(listProjects, []);
  const [info, refreshInfo] = useLibrary(getAppInfo, []);
  const [view, setView] = useState<View>(null);
  const [dialog, setDialog] = useState<"new-project" | "settings" | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = info?.theme ?? "dark";
  }, [info?.theme]);

  // Open the first active project on start, and leave a project that was deleted.
  useEffect(() => {
    if (!projects) return;
    if (view && projects.some((p) => p.project.id === view.projectId)) return;
    const first = projects.find((p) => !p.project.archived);
    setView(first ? { projectId: first.project.id, queueId: null } : null);
  }, [projects, view]);

  const onCreateProject = async (name: string) => {
    try {
      const p = await createProject(name);
      setDialog(null);
      refreshProjects();
      setView({ projectId: p.id, queueId: null });
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const selected = projects?.find((p) => p.project.id === view?.projectId);

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        selectedId={view?.projectId ?? null}
        onSelect={(id) => setView({ projectId: id, queueId: null })}
        onNew={() => setDialog("new-project")}
        onSettings={() => setDialog("settings")}
      />
      <main className="main">
        {selected ? (
          view?.queueId != null ? (
            <QueueRoute
              projectId={selected.project.id}
              queueId={view.queueId}
              projectName={selected.project.name}
              onBack={() => setView({ projectId: selected.project.id, queueId: null })}
            />
          ) : (
            <ProjectView
              summary={selected}
              onChanged={refreshProjects}
              onOpenQueue={(queueId) => setView({ projectId: selected.project.id, queueId })}
            />
          )
        ) : (
          <div className="empty">
            <div className="empty-inner">
              <Layers size={36} color="var(--accent)" />
              <h1>Plan your first build</h1>
              <p>A project holds queues of models, for example one queue per filament. Add files, open the next one in your slicer, and track every print.</p>
              <button className="btn primary" onClick={() => setDialog("new-project")}>
                <Plus size={16} /> New project
              </button>
            </div>
          </div>
        )}
      </main>

      {dialog === "new-project" && (
        <PromptModal
          title="New project"
          label="Project name"
          confirm="Create project"
          onSubmit={onCreateProject}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "settings" && info && (
        <SettingsDialog info={info} onChanged={refreshInfo} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function QueueRoute({ projectId, queueId, projectName, onBack }: {
  projectId: number;
  queueId: number;
  projectName: string;
  onBack: () => void;
}) {
  const [queues] = useLibrary(() => listQueues(projectId), [projectId]);
  const queue = queues?.find((q) => q.queue.id === queueId)?.queue;
  useEffect(() => {
    if (queues && !queue) onBack();
  }, [queues, queue, onBack]);
  return queue ? <QueueBoard key={queue.id} queue={queue} projectName={projectName} onBack={onBack} /> : null;
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
