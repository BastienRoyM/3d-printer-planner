import { percent } from "../lib/progress";

/** Progress drawn as stacked print layers filling from the bottom of the bar. */
export function LayerBar({ done, total, size = "md" }: { done: number; total: number; size?: "sm" | "md" | "lg" }) {
  const pct = percent(done, total);
  return (
    <div
      className={`layerbar layerbar-${size}${pct === 100 ? " is-complete" : ""}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`${done} of ${total} printed`}
    >
      <div className="layerbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
