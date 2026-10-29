import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ExternalLink, Play, RotateCcw, X } from "lucide-react";
import type { Action, Item } from "../api";
import { LayerBar } from "./ProgressBar";
import { Thumbnail } from "./Thumbnail";

export function ItemCardView({ item, isNext, overlay, onAction, onOpen, onSlicer }: {
  item: Item;
  isNext?: boolean;
  overlay?: boolean;
  onAction?: (a: Action) => void;
  onOpen?: () => void;
  onSlicer?: () => void;
}) {
  const stop = (fn?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };

  return (
    <div className={`card${isNext ? " is-next" : ""}${overlay ? " is-overlay" : ""}`} onClick={onOpen}>
      {isNext && <span className="card-next">Next up</span>}
      <Thumbnail item={item} />
      <div className="card-body">
        <div className="card-name" title={item.name}>{item.name}</div>
        {(item.material || item.color) && (
          <div className="card-meta">
            <span className="chip">
              {item.color && <span className="chip-swatch" style={{ background: item.color }} />}
              {item.material ?? ""}
            </span>
          </div>
        )}
        <div className="card-qty">
          <span>{item.qtyDone}/{item.qtyTotal}</span>
          <LayerBar done={item.qtyDone} total={item.qtyTotal} size="sm" />
        </div>
        {onAction && (
          <div className="card-actions" onPointerDown={(e) => e.stopPropagation()}>
            {item.status === "todo" && (
              <>
                <button className="btn sm" onClick={stop(onSlicer)} title="Open in slicer">
                  <ExternalLink size={13} /> Slicer
                </button>
                <button className="btn sm" onClick={stop(() => onAction({ type: "start" }))} title="Mark as printing">
                  <Play size={13} /> Start
                </button>
              </>
            )}
            {item.status === "printing" && (
              <>
                <button className="btn sm" onClick={stop(() => onAction({ type: "finish" }))}>
                  <Check size={13} /> Finished
                </button>
                <button className="btn sm ghost" onClick={stop(() => onAction({ type: "fail" }))}>
                  <X size={13} /> Failed
                </button>
              </>
            )}
            {item.status === "failed" && (
              <button className="btn sm" onClick={stop(() => onAction({ type: "moveTo", status: "todo" }))}>
                <RotateCcw size={13} /> Retry
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function SortableItemCard(props: Parameters<typeof ItemCardView>[0]) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
    data: { status: props.item.status },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "card-slot is-dragging" : "card-slot"}
      {...attributes}
      {...listeners}
    >
      <ItemCardView {...props} />
    </div>
  );
}
