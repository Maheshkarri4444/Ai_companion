"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface ColumnPoint {
  key: string;
  label: string;
  value: number;
  /** Optional secondary line shown in the tooltip/table (e.g. "3 errors"). */
  detail?: string;
}

const PLOT_HEIGHT = 132;

function niceMax(max: number) {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= max / 4) ?? max / 4;
  return Math.ceil(max / step) * step;
}

/**
 * Single-series column chart: one hue, thin columns with rounded caps on a square baseline, hairline grid,
 * direct label on the latest value only, hover/focus tooltip, and a table view so nothing is tooltip-gated.
 */
export function ColumnChart({
  data,
  format = (v) => v.toLocaleString(),
  label,
  tone = "blue",
}: {
  data: ColumnPoint[];
  format?: (value: number) => string;
  label: string;
  tone?: "blue" | "violet" | "emerald";
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const fill = { blue: "bg-blue-500", violet: "bg-violet-500", emerald: "bg-emerald-500" }[tone];
  const last = data.length - 1;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{label}</p>
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn("rounded-md px-2 py-1 capitalize", view === v ? "bg-white font-medium text-ink shadow-card" : "text-muted")}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === "table" ? (
        <div className="scrollbar-thin max-h-52 overflow-y-auto rounded-lg border border-line text-xs">
          <table className="w-full">
            <tbody>
              {data.map((d) => (
                <tr key={d.key} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5 text-muted">{d.label}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-ink tabular-nums">{format(d.value)}</td>
                  {data.some((x) => x.detail) && <td className="px-3 py-1.5 text-right text-muted">{d.detail ?? ""}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <div className="relative flex items-end gap-[2px] border-b border-line-strong" style={{ height: PLOT_HEIGHT }}>
            {[0.5, 1].map((f) => (
              <div key={f} className="pointer-events-none absolute right-0 left-0 border-t border-line" style={{ bottom: PLOT_HEIGHT * f }}>
                <span className="absolute -top-2 right-0 bg-white pl-1 text-[10px] text-slate-400 tabular-nums">{format(max * f)}</span>
              </div>
            ))}
            {data.map((d, i) => (
              <button
                key={d.key}
                type="button"
                className="group relative flex h-full flex-1 items-end justify-center outline-none"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${d.label}: ${format(d.value)}${d.detail ? `, ${d.detail}` : ""}`}
              >
                <span
                  className={cn("w-full max-w-6 rounded-t-[4px] transition-opacity", fill, active !== null && active !== i && "opacity-45")}
                  style={{ height: d.value > 0 ? Math.max(2, (d.value / max) * PLOT_HEIGHT) : 0 }}
                />
                {i === last && d.value > 0 && active === null && (
                  <span className="absolute text-[10px] font-medium text-ink tabular-nums" style={{ bottom: (d.value / max) * PLOT_HEIGHT + 4 }}>
                    {format(d.value)}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400">
            <span>{data[0]?.label}</span>
            <span>{data[last]?.label}</span>
          </div>
          {active !== null && data[active] && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-navy-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lift"
              style={{ left: `${((active + 0.5) / data.length) * 100}%` }}
            >
              <p className="text-[10px] text-blue-200">{data[active].label}</p>
              <p className="font-semibold tabular-nums">{format(data[active].value)}</p>
              {data[active].detail && <p className="text-[10px] text-blue-200">{data[active].detail}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RangeTabs({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex rounded-xl border border-line bg-white p-1 shadow-card" role="tablist" aria-label="Time range">
      {[
        ["24h", "24 hours"],
        ["7d", "7 days"],
        ["30d", "30 days"],
      ].map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", value === key ? "bg-blue-600 text-white" : "text-muted hover:text-ink")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Bucket keys from the API ('YYYY-MM-DD' or 'YYYY-MM-DDTHH') → short labels. */
export function bucketLabel(bucket: string) {
  if (bucket.length > 10) return `${bucket.slice(11, 13)}:00`;
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${bucket}T00:00:00Z`));
}
