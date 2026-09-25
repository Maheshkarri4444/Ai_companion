"use client";

import { useState } from "react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Point {
  date: string; // YYYY-MM-DD (UTC)
  events: number;
  activeUsers: number;
  signups: number;
}

const PLOT_HEIGHT = 168;

/** Clean, rounded y-axis ticks (0, 5, 10… / 0, 50, 100…). */
function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

const dayLabel = (date: string, style: "short" | "long") =>
  new Intl.DateTimeFormat("en", style === "short" ? { day: "numeric", month: "short", timeZone: "UTC" } : { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );

/**
 * Single-series column chart (events per day). One hue, thin columns (≤24px, 4px rounded cap, square
 * baseline, surface gap between columns), hairline solid grid, direct label on the latest column only,
 * per-column hover/focus tooltip, and a table view so no value is tooltip-gated.
 */
export function ActivityChart({ data }: { data: Point[] }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [active, setActive] = useState<number | null>(null);
  const ticks = niceTicks(Math.max(...data.map((d) => d.events), 0));
  const top = ticks[ticks.length - 1] || 1;
  const lastIndex = data.length - 1;

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5 text-xs font-medium" role="tablist" aria-label="View as">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("rounded-md px-2.5 py-1 capitalize transition", view === v ? "bg-white text-ink shadow-card" : "text-muted hover:text-ink")}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "table" ? (
        <div className="max-h-[240px] overflow-y-auto rounded-xl border border-line scrollbar-thin">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-canvas text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Day (UTC)</th>
                <th className="px-3 py-2 text-right font-medium">Events</th>
                <th className="px-3 py-2 text-right font-medium">Active users</th>
                <th className="px-3 py-2 text-right font-medium">Sign-ups</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {[...data].reverse().map((d) => (
                <tr key={d.date}>
                  <td className="px-3 py-1.5 text-ink-soft">{dayLabel(d.date, "long")}</td>
                  <td className="px-3 py-1.5 text-right font-medium text-ink">{formatNumber(d.events)}</td>
                  <td className="px-3 py-1.5 text-right text-ink-soft">{formatNumber(d.activeUsers)}</td>
                  <td className="px-3 py-1.5 text-right text-ink-soft">{formatNumber(d.signups)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-2">
          {/* Y axis: clean ticks, tabular so they align */}
          <div className="relative w-8 shrink-0 text-right text-[11px] text-muted tabular-nums" style={{ height: PLOT_HEIGHT }} aria-hidden>
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: PLOT_HEIGHT - (t / top) * PLOT_HEIGHT }}>
                {formatNumber(t)}
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            <div className="relative" style={{ height: PLOT_HEIGHT }}>
              {ticks.map((t) => (
                <div
                  key={t}
                  className={cn("absolute inset-x-0 h-px", t === 0 ? "bg-line-strong" : "bg-line/70")}
                  style={{ top: PLOT_HEIGHT - (t / top) * PLOT_HEIGHT }}
                  aria-hidden
                />
              ))}

              <div className="absolute inset-0 flex items-end gap-[2px]" role="list" aria-label="Events per day, last 14 days">
                {data.map((d, i) => {
                  const height = (d.events / top) * PLOT_HEIGHT;
                  const isActive = active === i;
                  return (
                    <div
                      key={d.date}
                      role="listitem"
                      tabIndex={0}
                      aria-label={`${dayLabel(d.date, "long")}: ${d.events} events, ${d.activeUsers} active users, ${d.signups} sign-ups`}
                      onPointerEnter={() => setActive(i)}
                      onPointerLeave={() => setActive((cur) => (cur === i ? null : cur))}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive((cur) => (cur === i ? null : cur))}
                      className="relative flex h-full flex-1 cursor-default items-end justify-center outline-none"
                    >
                      {/* Hit target is the full column slot, not just the painted bar. */}
                      {isActive && <span className="absolute inset-0 rounded-md bg-blue-500/[0.06]" aria-hidden />}
                      <span
                        className={cn("relative w-full max-w-6 rounded-t-[4px] transition-colors", isActive ? "bg-blue-500" : "bg-blue-600")}
                        style={{ height: d.events > 0 ? Math.max(height, 2) : 0 }}
                      />
                      {i === lastIndex && d.events > 0 && !isActive && (
                        <span className="absolute text-[11px] font-semibold text-ink tabular-nums" style={{ bottom: height + 4 }}>
                          {formatNumber(d.events)}
                        </span>
                      )}
                      {isActive && (
                        <div
                          className={cn(
                            "pointer-events-none absolute z-10 w-40 rounded-xl border border-line bg-white p-2.5 text-left shadow-lift",
                            i > data.length / 2 ? "right-0" : "left-0",
                          )}
                          style={{ bottom: Math.min(height + 8, PLOT_HEIGHT - 20) }}
                        >
                          <p className="text-[11px] font-medium text-muted">{dayLabel(d.date, "long")}</p>
                          <p className="mt-1 flex items-baseline justify-between gap-2">
                            <span className="text-base font-semibold text-ink tabular-nums">{formatNumber(d.events)}</span>
                            <span className="text-xs text-muted">events</span>
                          </p>
                          <p className="mt-1 flex justify-between text-xs text-ink-soft">
                            <span>Active users</span>
                            <span className="font-medium tabular-nums">{d.activeUsers}</span>
                          </p>
                          <p className="flex justify-between text-xs text-ink-soft">
                            <span>Sign-ups</span>
                            <span className="font-medium tabular-nums">{d.signups}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* X axis: every other day to avoid collisions; the table view has all of them. */}
            <div className="mt-2 flex gap-[2px] text-[11px] text-muted" aria-hidden>
              {data.map((d, i) => (
                <span key={d.date} className="flex-1 text-center whitespace-nowrap">
                  {(lastIndex - i) % 2 === 0 ? dayLabel(d.date, "short") : ""}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars for nominal categories: one hue for every bar, value at the tip. */
export function BarList({ items, emptyLabel = "No data yet" }: { items: Array<{ label: string; value: number }>; emptyLabel?: string }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">{emptyLabel}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink-soft">{item.label}</span>
            <span className="font-medium text-ink tabular-nums">{formatNumber(item.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
