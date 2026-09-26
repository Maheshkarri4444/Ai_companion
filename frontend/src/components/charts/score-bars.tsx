import { cn } from "@/lib/utils";

/** Horizontal bars for average scores (0–1) per category, with counts — values are labelled, never colour-only. */
export function ScoreBars({ rows, empty = "No answers in this period." }: { rows: Array<{ label: string; value: number | null; count: number }>; empty?: string }) {
  if (rows.every((r) => r.count === 0)) return <p className="py-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,7.5rem)_minmax(3rem,1fr)_72px] items-center gap-3 text-sm">
          <span className="truncate text-ink-soft">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-slate-100">
            <span
              className={cn("block h-full rounded-full", r.value === null ? "" : r.value >= 0.8 ? "bg-emerald-500" : r.value >= 0.5 ? "bg-amber-400" : "bg-rose-500")}
              style={{ width: `${Math.max(r.count ? 3 : 0, (r.value ?? 0) * 100)}%` }}
            />
          </span>
          <span className="text-right text-xs text-muted tabular-nums">
            <strong className="font-semibold text-ink">{r.value === null ? "—" : `${Math.round(r.value * 100)}%`}</strong> · {r.count}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Mastery band distribution as one stacked bar (2 px gaps) plus a labelled legend. */
export function BandBar({ bands }: { bands: Record<"not_assessed" | "needs_attention" | "developing" | "strong", number> }) {
  const parts = [
    { key: "strong", label: "Strong", color: "bg-emerald-500", n: bands.strong },
    { key: "developing", label: "Developing", color: "bg-amber-400", n: bands.developing },
    { key: "needs_attention", label: "Needs attention", color: "bg-rose-500", n: bands.needs_attention },
    { key: "not_assessed", label: "Not assessed", color: "bg-slate-300", n: bands.not_assessed },
  ];
  const total = parts.reduce((n, p) => n + p.n, 0);
  if (!total) return <p className="py-4 text-sm text-muted">No concepts yet.</p>;
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {parts.filter((p) => p.n > 0).map((p) => (
          <span key={p.key} className={p.color} style={{ width: `${(p.n / total) * 100}%` }} title={`${p.label}: ${p.n}`} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className={cn("size-2.5 rounded-sm", p.color)} />
            <span className="text-ink-soft">{p.label}</span>
            <span className="ml-auto text-muted tabular-nums">{p.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
