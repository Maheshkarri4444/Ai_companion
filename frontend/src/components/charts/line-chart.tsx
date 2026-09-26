"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface LinePoint {
  key: string;
  label: string;
  value: number | null;
  detail?: string;
}

// Drawn in a small coordinate space so axis text stays legible when the chart sits in a narrow card.
const W = 480;
const H = 170;
const PAD = { top: 16, right: 12, bottom: 22, left: 36 };

/**
 * Single-series line (0–100 % by default): 2 px line, hairline grid, the latest value labelled directly,
 * a crosshair + tooltip on hover/focus, and a table view so no value is hover-only. Gaps (null) break the line.
 */
export function LineChart({
  data,
  label,
  format = (v) => `${Math.round(v * 100)}%`,
  max = 1,
  tone = "blue",
  emptyText = "No data in this period yet.",
}: {
  data: LinePoint[];
  label: string;
  format?: (value: number) => string;
  max?: number;
  tone?: "blue" | "emerald" | "violet";
  emptyText?: string;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [active, setActive] = useState<number | null>(null);
  const stroke = { blue: "#2563eb", emerald: "#059669", violet: "#7c3aed" }[tone];
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (Math.min(v, max) / max) * innerH;
  const hasData = data.some((d) => d.value !== null);

  // Break the path at gaps.
  const segments: string[] = [];
  let current = "";
  data.forEach((d, i) => {
    if (d.value === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const lastIndex = data.map((d) => d.value !== null).lastIndexOf(true);
  // A value with no neighbours (e.g. a single study day between gaps) has no line through it — mark it so it stays visible.
  const isolated = (i: number) => data[i].value !== null && (data[i - 1]?.value ?? null) === null && (data[i + 1]?.value ?? null) === null;

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
      {!hasData ? (
        <p className="flex h-[140px] items-center justify-center rounded-xl border border-dashed border-line-strong text-sm text-muted">{emptyText}</p>
      ) : view === "table" ? (
        <div className="scrollbar-thin max-h-52 overflow-y-auto rounded-lg border border-line text-xs">
          <table className="w-full">
            <tbody>
              {data.map((d) => (
                <tr key={d.key} className="border-b border-line last:border-0">
                  <td className="px-3 py-1.5 text-muted">{d.label}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-ink tabular-nums">{d.value === null ? "—" : format(d.value)}</td>
                  {data.some((p) => p.detail) && <td className="px-3 py-1.5 text-right text-muted">{d.detail ?? ""}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke="#e2e8f4" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(max * f) + 3} textAnchor="end" fontSize={10} fill="#94a3b8">
                  {format(max * f)}
                </text>
              </g>
            ))}
            {segments.map((d, i) => (
              <path key={i} d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {data.map((d, i) =>
              d.value === null ? null : (
                <circle
                  key={d.key}
                  cx={x(i)}
                  cy={y(d.value)}
                  r={active === i || i === lastIndex || isolated(i) ? 4 : 0}
                  fill={isolated(i) && active !== i && i !== lastIndex ? stroke : "#fff"}
                  stroke={stroke}
                  strokeWidth={2}
                />
              ),
            )}
            {lastIndex >= 0 && active === null && (
              <text x={Math.min(x(lastIndex), W - PAD.right - 4)} y={y(data[lastIndex].value as number) - 8} textAnchor="end" fontSize={11} fontWeight={600} fill="#0c1730">
                {format(data[lastIndex].value as number)}
              </text>
            )}
            {active !== null && <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} stroke="#94a3b8" strokeDasharray="3 3" />}
            {/* Hit areas bigger than the marks */}
            {data.map((d, i) => (
              <rect
                key={d.key}
                x={x(i) - innerW / Math.max(1, data.length - 1) / 2}
                y={PAD.top}
                width={innerW / Math.max(1, data.length - 1)}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${d.label}: ${d.value === null ? "no data" : format(d.value)}`}
              />
            ))}
            <text x={PAD.left} y={H - 4} fontSize={10} fill="#94a3b8">
              {data[0]?.label}
            </text>
            <text x={W - PAD.right} y={H - 4} fontSize={10} fill="#94a3b8" textAnchor="end">
              {data.at(-1)?.label}
            </text>
          </svg>
          {active !== null && data[active] && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg bg-navy-900 px-2.5 py-1.5 text-xs whitespace-nowrap text-white shadow-lift"
              style={{ left: `${(x(active) / W) * 100}%` }}
            >
              <p className="text-[10px] text-blue-200">{data[active].label}</p>
              <p className="font-semibold tabular-nums">{data[active].value === null ? "No data" : format(data[active].value as number)}</p>
              {data[active].detail && <p className="text-[10px] text-blue-200">{data[active].detail}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Tiny trend line for tables (no axes); the last point is marked. Days before the first value are trimmed so the trend fills the space. */
export function Sparkline({ values: all, className }: { values: Array<number | null>; className?: string }) {
  const values = all.slice(Math.max(0, all.findIndex((v) => v !== null)));
  const points = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (points.length < 2) return <span className={cn("inline-block h-6 w-20", className)} aria-hidden />;
  const w = 80;
  const h = 24;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 2 - v * (h - 4);
  const d = points.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const last = points.at(-1)!;
  const rising = last.v >= points[0].v;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-6 w-20", className)} aria-hidden>
      <path d={d} fill="none" stroke={rising ? "#059669" : "#e11d48"} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.5} fill={rising ? "#059669" : "#e11d48"} />
    </svg>
  );
}

export const shortDate = (date: string) =>
  new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
