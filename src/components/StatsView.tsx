import { Boxes } from "lucide-react";
import type { ProjectSummary } from "../api";
import { formatGrams, formatMinutes } from "../lib/format";
import { formatMoney } from "../lib/money";
import { percent } from "../lib/progress";
import { EntityIcon } from "./Icons";

type Totals = Pick<
  ProjectSummary,
  "totalPrints" | "donePrints" | "gramsUsed" | "minutesUsed" | "valueCents" | "paidCents" | "owedCents"
>;

const KEYS: (keyof Totals)[] = ["totalPrints", "donePrints", "gramsUsed", "minutesUsed", "valueCents", "paidCents", "owedCents"];

function add(projects: ProjectSummary[]): Totals {
  const t = Object.fromEntries(KEYS.map((k) => [k, 0])) as Totals;
  for (const p of projects) for (const k of KEYS) t[k] += p[k];
  return t;
}

/** Totals across every project: parts, filament, print time and money. */
export function StatsView({ projects, onOpenProject }: {
  projects: ProjectSummary[];
  onOpenProject: (id: number) => void;
}) {
  const t = add(projects);
  const tiles = [
    { label: "Parts printed", value: `${t.donePrints}`, sub: `of ${t.totalPrints} planned (${percent(t.donePrints, t.totalPrints)}%)` },
    { label: "Filament used", value: formatGrams(t.gramsUsed), sub: "from items' grams used" },
    { label: "Print time", value: formatMinutes(t.minutesUsed), sub: "from items' print time" },
    { label: "Value", value: formatMoney(t.valueCents), sub: "sum of item prices" },
    { label: "Paid back", value: formatMoney(t.paidCents), sub: "paid invoices" },
    { label: "Owed to you", value: formatMoney(t.owedCents), sub: "unpaid invoices" },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Stats</h1>
      </div>

      <div className="stat-grid">
        {tiles.map((s) => (
          <div key={s.label} className="stat-tile">
            <div className="label">{s.label}</div>
            <div className={`value${s.label === "Owed to you" && t.owedCents > 0 ? " is-owed" : ""}`}>{s.value}</div>
            <div className="sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="section-head">
        <h2>By project</h2>
      </div>
      <table className="stat-table">
        <thead>
          <tr>
            <th>Project</th>
            <th className="num">Printed</th>
            <th className="num">Filament</th>
            <th className="num">Print time</th>
            <th className="num">Value</th>
            <th className="num">Paid</th>
            <th className="num">Owed</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.project.id} className={p.project.archived ? "is-archived" : undefined} onClick={() => onOpenProject(p.project.id)}>
              <td>
                <span className="stat-name">
                  <EntityIcon name={p.project.icon} fallback={Boxes} color={p.project.color ?? "var(--accent)"} />
                  {p.project.name}
                </span>
              </td>
              <td className="num">{p.donePrints}/{p.totalPrints}</td>
              <td className="num">{p.gramsUsed ? formatGrams(p.gramsUsed) : "—"}</td>
              <td className="num">{p.minutesUsed ? formatMinutes(p.minutesUsed) : "—"}</td>
              <td className="num">{p.valueCents ? formatMoney(p.valueCents) : "—"}</td>
              <td className="num">{p.paidCents ? formatMoney(p.paidCents) : "—"}</td>
              <td className={`num${p.owedCents > 0 ? " is-owed" : ""}`}>{p.owedCents ? formatMoney(p.owedCents) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="num">{t.donePrints}/{t.totalPrints}</td>
            <td className="num">{formatGrams(t.gramsUsed)}</td>
            <td className="num">{formatMinutes(t.minutesUsed)}</td>
            <td className="num">{formatMoney(t.valueCents)}</td>
            <td className="num">{formatMoney(t.paidCents)}</td>
            <td className="num">{formatMoney(t.owedCents)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
