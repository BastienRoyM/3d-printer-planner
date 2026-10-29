import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronLeft, ExternalLink, FilePlus2, FileQuestion, Upload } from "lucide-react";
import {
  STATUSES,
  SUPPORTED_EXTENSIONS,
  errorText,
  importFiles,
  itemAction,
  itemFromFile,
  listItems,
  listUnassigned,
  openInSlicer,
  type Action,
  type Item,
  type Queue,
  type Status,
} from "../api";
import { useLibrary } from "../hooks/useLibrary";
import { ItemCardView, SortableItemCard } from "./ItemCard";
import { ItemPanel } from "./ItemPanel";
import { useToast } from "./Toast";

const TITLES: Record<Status, string> = { todo: "To do", printing: "Printing", done: "Done", failed: "Failed" };
const EMPTY: Record<Status, string> = {
  todo: "Drop model files here or use Add files",
  printing: "Drag a card here when it starts printing",
  done: "Finished prints land here",
  failed: "Failed prints land here",
};

type Columns = Record<Status, Item[]>;

function group(items: Item[]): Columns {
  const cols: Columns = { todo: [], printing: [], done: [], failed: [] };
  for (const it of items) cols[it.status].push(it);
  for (const s of STATUSES) cols[s].sort((a, b) => a.sort - b.sort || a.id - b.id);
  return cols;
}

function Column({ status, items, children }: { status: Status; items: Item[]; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${status}`, data: { status } });
  return (
    <section className={`column${isOver ? " is-over" : ""}`} aria-label={TITLES[status]}>
      <header className="column-head">
        <span className={`status-dot status-${status}`} />
        {TITLES[status]}
        <span className="count">{items.length}</span>
      </header>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="column-body" ref={setNodeRef}>
          {children}
          {items.length === 0 && <div className="column-empty">{EMPTY[status]}</div>}
        </div>
      </SortableContext>
    </section>
  );
}

export function QueueBoard({ queue, projectName, onBack }: { queue: Queue; projectName: string; onBack: () => void }) {
  const toast = useToast();
  const [items, refresh] = useLibrary(() => listItems(queue.id), [queue.id]);
  const [unassigned, refreshUnassigned] = useLibrary(() => listUnassigned(queue.id), [queue.id]);
  const [columns, setColumns] = useState<Columns>(group([]));
  const [activeId, setActiveId] = useState<number | null>(null);
  const [openItemId, setOpenItemId] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);

  useEffect(() => setColumns(group(items ?? [])), [items]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const all = useMemo(() => STATUSES.flatMap((s) => columns[s]), [columns]);
  const active = all.find((i) => i.id === activeId) ?? null;
  const openItem = items?.find((i) => i.id === openItemId) ?? null;
  const next = columns.todo[0];

  const reloadAll = () => {
    refresh();
    refreshUnassigned();
  };

  const doImport = async (paths: string[]) => {
    if (paths.length === 0) return;
    try {
      const res = await importFiles(queue.id, paths);
      if (res.imported.length) toast(`Added ${res.imported.length} file${res.imported.length > 1 ? "s" : ""}`);
      if (res.skipped.length) toast(`Skipped ${res.skipped.join(", ")}: not a supported 3D file`, "error");
      reloadAll();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  // OS file drag-and-drop onto the window imports into this queue.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") setDropping(true);
      else if (p.type === "leave") setDropping(false);
      else if (p.type === "drop") {
        setDropping(false);
        doImport(p.paths);
      }
    });
    return () => void un.then((f) => f());
  }, [queue.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addFiles = async () => {
    const picked = await open({
      multiple: true,
      title: "Add model files",
      filters: [{ name: "3D files", extensions: SUPPORTED_EXTENSIONS }],
    });
    if (picked) doImport(Array.isArray(picked) ? picked : [picked]);
  };

  const run = async (id: number, action: Action, index?: number) => {
    try {
      await itemAction(id, action, index);
    } catch (e) {
      toast(errorText(e), "error");
    }
    refresh();
  };

  const slicer = async (id: number) => {
    try {
      await openInSlicer(id);
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  const columnOf = (id: number | string): Status | null => {
    if (typeof id === "string" && id.startsWith("col-")) return id.slice(4) as Status;
    return all.find((i) => i.id === id)?.status ?? null;
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(Number(e.active.id));

  // Live-move the card between columns while dragging so the drop position is visible.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = columnOf(active.id);
    const to = columnOf(over.id);
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const moving = cols[from].find((i) => i.id === active.id);
      if (!moving) return cols;
      const target = cols[to].filter((i) => i.id !== active.id);
      const overIdx = target.findIndex((i) => i.id === over.id);
      target.splice(overIdx < 0 ? target.length : overIdx, 0, { ...moving, status: to });
      return { ...cols, [from]: cols[from].filter((i) => i.id !== active.id), [to]: target };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return setColumns(group(items ?? []));
    const to = columnOf(over.id);
    if (!to) return;
    const list = columns[to];
    const current = list.findIndex((i) => i.id === active.id);
    const overIdx = list.findIndex((i) => i.id === over.id);
    const original = items?.find((i) => i.id === active.id);
    // Cross-column moves were already placed by onDragOver; same-column moves land on the hovered card.
    const index = original?.status !== to || overIdx < 0 ? Math.max(0, current) : overIdx;
    run(Number(active.id), { type: "moveTo", status: to }, index);
  };

  const makeItem = async (name: string) => {
    try {
      await itemFromFile(queue.id, name);
      reloadAll();
    } catch (e) {
      toast(errorText(e), "error");
    }
  };

  return (
    <div className="board-page">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <button className="crumb" onClick={onBack}>
            <ChevronLeft size={14} /> {projectName}
          </button>
          <h1>{queue.name}</h1>
        </div>
        <div className="board-toolbar">
          {next && (
            <button className="btn" onClick={() => slicer(next.id)} title={`Open ${next.name} in the slicer`}>
              <ExternalLink size={15} /> Open next in slicer
            </button>
          )}
          <button className="btn primary" onClick={addFiles}>
            <FilePlus2 size={15} /> Add files
          </button>
        </div>
      </div>

      {unassigned && unassigned.length > 0 && (
        <div className="banner">
          <FileQuestion size={16} />
          <span>New files in this queue's folder:</span>
          <div className="banner-files">
            {unassigned.map((f) => (
              <button key={f} className="btn sm" onClick={() => makeItem(f)} title="Add as a new item">
                + {f}
              </button>
            ))}
          </div>
          <span className="hint">Add as a new item, or attach from an item's details.</span>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setColumns(group(items ?? []));
        }}
      >
        <div className="board">
          {STATUSES.map((s) => (
            <Column key={s} status={s} items={columns[s]}>
              {columns[s].map((item) => (
                <SortableItemCard
                  key={item.id}
                  item={item}
                  isNext={item.id === next?.id}
                  onAction={(a) => run(item.id, a)}
                  onOpen={() => setOpenItemId(item.id)}
                  onSlicer={() => slicer(item.id)}
                />
              ))}
            </Column>
          ))}
        </div>
        <DragOverlay>{active ? <ItemCardView item={active} overlay /> : null}</DragOverlay>
      </DndContext>

      {dropping && (
        <div className="drop-overlay">
          <div><Upload size={22} /> Drop to add to {queue.name}</div>
        </div>
      )}

      {openItem && (
        <ItemPanel
          item={openItem}
          unassigned={unassigned ?? []}
          onChanged={reloadAll}
          onClose={() => setOpenItemId(null)}
        />
      )}
    </div>
  );
}
