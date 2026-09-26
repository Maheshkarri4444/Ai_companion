"use client";

import type { AnalyticsRange } from "@/lib/types";
import { cn } from "@/lib/utils";

export function WindowTabs({ value, onChange }: { value: AnalyticsRange; onChange: (value: AnalyticsRange) => void }) {
  return (
    <div className="flex rounded-xl border border-line bg-white p-1 shadow-card" role="tablist" aria-label="Time window">
      {(["7d", "30d", "90d"] as const).map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", value === key ? "bg-blue-600 text-white" : "text-muted hover:text-ink")}
        >
          {key === "7d" ? "7 days" : key === "30d" ? "30 days" : "90 days"}
        </button>
      ))}
    </div>
  );
}
