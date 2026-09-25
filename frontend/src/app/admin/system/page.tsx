"use client";

import { AlertTriangle, Bot, CheckCircle2, CircleDashed, Database, HardDrive, RefreshCw, Server, Workflow, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/misc";
import { formatBytes, formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { useSystemHealth } from "@/lib/queries";
import { cn } from "@/lib/utils";

type Tone = "ok" | "warn" | "down" | "idle";

const toneStyle: Record<Tone, { pill: string; icon: ReactNode; label: string }> = {
  ok: { pill: "bg-emerald-50 text-emerald-700 ring-emerald-600/15", icon: <CheckCircle2 className="size-3.5" />, label: "Operational" },
  warn: { pill: "bg-amber-50 text-amber-800 ring-amber-600/20", icon: <AlertTriangle className="size-3.5" />, label: "Degraded" },
  down: { pill: "bg-red-50 text-red-700 ring-red-600/15", icon: <XCircle className="size-3.5" />, label: "Down" },
  idle: { pill: "bg-slate-100 text-slate-600 ring-slate-500/15", icon: <CircleDashed className="size-3.5" />, label: "Not running" },
};

function StatusPill({ tone, label }: { tone: Tone; label?: string }) {
  const style = toneStyle[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", style.pill)}>
      {style.icon}
      {label ?? style.label}
    </span>
  );
}

function ComponentCard({ icon, title, tone, statusLabel, rows, note }: {
  icon: ReactNode;
  title: string;
  tone: Tone;
  statusLabel?: string;
  rows: Array<[string, ReactNode]>;
  note?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 [&>svg]:size-[18px]">{icon}</span>
          <h2 className="font-display font-semibold text-ink">{title}</h2>
        </div>
        <StatusPill tone={tone} label={statusLabel} />
      </div>
      <dl className="mt-4 divide-y divide-line text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-medium text-ink tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="mt-3 rounded-lg bg-canvas px-3 py-2 text-xs text-muted">{note}</p>}
    </Card>
  );
}

export default function SystemHealthPage() {
  const { data, isLoading, error, refetch, isFetching } = useSystemHealth();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 rounded-2xl" />
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const healthy = data.status === "ok";

  return (
    <div className="animate-rise">
      <PageHeader
        title="System health"
        description="Live status of the platform's components. Refreshes every 30 seconds."
        actions={
          <Button variant="secondary" size="sm" onClick={() => refetch()} loading={isFetching}>
            {!isFetching && <RefreshCw className="size-3.5" />} Check now
          </Button>
        }
      />

      <div
        className={cn(
          "mb-6 flex items-center gap-3 rounded-2xl border px-5 py-4",
          healthy ? "border-emerald-200 bg-emerald-50/70 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900",
        )}
      >
        {healthy ? <CheckCircle2 className="size-5 text-emerald-600" /> : <AlertTriangle className="size-5 text-amber-600" />}
        <div>
          <p className="font-medium">{healthy ? "All core systems operational" : "Some systems are degraded"}</p>
          <p className="text-xs opacity-75">Last checked {formatDateTime(data.checkedAt)}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <ComponentCard
          icon={<Server />}
          title="API server"
          tone="ok"
          rows={[
            ["Version", data.api.version],
            ["Environment", data.api.environment],
            ["Process role", data.api.role],
            ["Node.js", data.api.nodeVersion],
            ["Uptime", formatDuration(data.api.uptimeSec)],
            ["Memory (RSS / heap)", `${data.api.memory.rssMb} MB / ${data.api.memory.heapUsedMb} MB`],
          ]}
        />
        <ComponentCard
          icon={<Database />}
          title="Database (MongoDB)"
          tone={data.database.status === "up" ? "ok" : "down"}
          rows={[
            ["Round-trip latency", data.database.latencyMs != null ? `${data.database.latencyMs} ms` : "—"],
            ["Database", data.database.name],
            ["Collections", formatNumber(data.database.collections)],
            ["Documents", formatNumber(data.database.objects)],
            ["Data size", formatBytes(data.database.dataSizeBytes)],
            ["Index size", formatBytes(data.database.indexSizeBytes)],
          ]}
        />
        <ComponentCard
          icon={<HardDrive />}
          title="File storage"
          tone={data.storage.status === "up" ? "ok" : "warn"}
          rows={[
            ["Provider", "MongoDB GridFS"],
            ["Stored files", formatNumber(data.storage.files)],
            ["Total size", formatBytes(data.storage.totalBytes)],
          ]}
        />
        <ComponentCard
          icon={<Bot />}
          title="AI provider"
          tone={data.ai.status === "configured" ? "ok" : "warn"}
          statusLabel={data.ai.status === "configured" ? "Configured" : "Not configured"}
          rows={[
            ["Provider", "Google Gemini"],
            ["Primary model", data.ai.models.primary],
            ["Fallback models", data.ai.models.fallbacks.join(", ") || "—"],
            ["Light model", data.ai.models.light],
            ["Embedding model", data.ai.models.embedding],
          ]}
          note="Live AI call metrics (latency, tokens, cost, errors) appear in AI usage once the Tutor is enabled."
        />
        <ComponentCard
          icon={<Workflow />}
          title="Background worker"
          tone="idle"
          rows={[["Status", "Not running"]]}
          note={data.worker.detail}
        />
      </div>
    </div>
  );
}
