"use client";

import { AlertTriangle, Bot, CheckCircle2, CircleDashed, Database, HardDrive, RefreshCw, Search, Server, Workflow, XCircle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/misc";
import { formatBytes, formatDateTime, formatDuration, formatNumber, timeAgo } from "@/lib/format";
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
        description="Live status of the platform's components. Refreshes every 15 seconds."
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
          title="AI gateway"
          tone={data.ai.status === "up" ? "ok" : data.ai.status === "degraded" ? "warn" : "down"}
          statusLabel={data.ai.status === "up" ? "Operational" : data.ai.status === "degraded" ? "Model breaker open" : "Not configured"}
          rows={[
            ["Provider", data.ai.provider === "gemini" ? "Google Gemini" : data.ai.provider],
            ["Primary chain", [data.ai.models.primary, ...data.ai.models.fallbacks].join(" → ")],
            ["Light chain", [data.ai.models.light, ...data.ai.models.lightFallbacks].join(" → ")],
            ["Embeddings", data.ai.models.embedding],
            ["Calls (24 h)", `${formatNumber(data.ai.last24h.calls)} · ${Math.round(data.ai.last24h.errorRate * 1000) / 10}% errors`],
            ["Cost (24 h)", `$${data.ai.last24h.costUsd.toFixed(4)}`],
            ["Avg latency (24 h)", data.ai.last24h.avgLatencyMs != null ? `${formatNumber(data.ai.last24h.avgLatencyMs)} ms` : "—"],
            [
              "Circuit breakers",
              data.ai.breakers.filter((b) => b.open).length
                ? data.ai.breakers
                    .filter((b) => b.open)
                    .map((b) => `${b.model} (${b.lastError}, ${b.reopensInSec}s)`)
                    .join(", ")
                : "All closed",
            ],
          ]}
          note="Every call is logged with model, latency, tokens and cost — see AI usage for traces."
        />
        <ComponentCard
          icon={<Workflow />}
          title="Background worker"
          tone={data.worker.status === "up" ? "ok" : "down"}
          statusLabel={data.worker.status === "up" ? `${data.worker.alive} alive` : "No live worker"}
          rows={[
            ["Queued (due now)", formatNumber(data.worker.queue.queued)],
            ["Running", formatNumber(data.worker.queue.running)],
            ["Failed (24 h)", formatNumber(data.worker.queue.failed24h)],
            ["Oldest waiting job", data.worker.queue.oldestQueuedSec ? formatDuration(data.worker.queue.oldestQueuedSec) : "—"],
            ...data.worker.workers.slice(0, 3).map(
              (w) =>
                [
                  `${w.host}:${w.pid}`,
                  <span key={w.id} className={w.alive ? "text-emerald-700" : "text-slate-400"}>
                    {w.alive ? `beat ${timeAgo(w.lastBeatAt)}` : "stopped"} · {w.processed} done / {w.failed} failed
                  </span>,
                ] as [string, ReactNode],
            ),
          ]}
          note="Durable MongoDB queue with leases, retries with backoff, dead-lettering and a per-minute reconciler."
        />
        <ComponentCard
          icon={<Search />}
          title="Retrieval"
          tone={data.retrieval.status === "up" ? "ok" : "warn"}
          statusLabel={data.retrieval.status === "up" ? "Vector index ready" : data.retrieval.status === "degraded" ? "Index building" : "Fallback mode"}
          rows={[
            ["Mode", data.retrieval.mode],
            ["Vector index", data.retrieval.vectorIndex.status],
            ["Indexed chunks", formatNumber(data.retrieval.chunks)],
            ["Concepts", formatNumber(data.retrieval.concepts)],
          ]}
          note={data.retrieval.vectorIndex.detail ? `Index detail: ${data.retrieval.vectorIndex.detail}` : undefined}
        />
        <Card className="flex flex-col justify-center gap-2 p-5 text-sm text-muted">
          <p className="font-medium text-ink">Investigate further</p>
          <Link href="/admin/ai-usage" className="text-blue-700 hover:underline">
            AI usage & traces →
          </Link>
          <Link href="/admin/ai-evaluation" className="text-blue-700 hover:underline">
            AI evaluation →
          </Link>
          <Link href="/admin/jobs" className="text-blue-700 hover:underline">
            Background jobs →
          </Link>
        </Card>
      </div>
    </div>
  );
}
