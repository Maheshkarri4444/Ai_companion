"use client";

import { CheckCircle2, Clock, Cpu, Hourglass, ListTodo, RotateCcw, Server, XCircle } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { toast } from "sonner";
import { FilterBar, EmptyRow, Table, Td, Th, useUrlFilters } from "@/components/admin/table";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { PageHeader, Pagination, StatCard } from "@/components/ui/misc";
import { errorMessage } from "@/lib/api";
import { formatDateTime, formatDuration, formatNumber, timeAgo } from "@/lib/format";
import { useJob, useJobs, useJobsOverview, useRetryJob } from "@/lib/queries";
import type { JobRow } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<JobRow["status"], BadgeTone> = {
  queued: "amber",
  running: "blue",
  succeeded: "green",
  failed: "red",
  cancelled: "slate",
};

const JOB_DESCRIPTIONS: Record<string, string> = {
  "material.process": "Extract → OCR → chunk → embed → concepts",
  "tutor.summarize": "Rolling conversation summary + AI title",
  "tutor.memory": "Learner-context extraction",
  "ai.evaluate": "LLM judge for an AI output",
  "system.reconcile": "Recover stale jobs & stuck materials (every minute)",
};

function JobDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useJob(jobId);
  const retry = useRetryJob();
  const job = data?.job;

  async function onRetry() {
    if (!job) return;
    try {
      await retry.mutateAsync(job.id);
      toast.success("Job re-queued (audit-logged)");
      void refetch();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={Boolean(jobId)} onOpenChange={(open) => !open && onClose()} title={job ? job.type : "Job"} description={job?.idempotencyKey} size="lg">
      {isLoading ? (
        <Skeleton className="h-60" />
      ) : error || !job ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[job.status]}>{job.status}</Badge>
            <Badge tone="slate">
              attempt {job.attempts}/{job.maxAttempts}
            </Badge>
            {job.progress.stage && (
              <Badge tone="blue">
                {job.progress.stage} · {job.progress.pct}%
              </Badge>
            )}
            {(job.status === "failed" || job.status === "cancelled") && (
              <Button size="sm" className="ml-auto" onClick={onRetry} loading={retry.isPending}>
                <RotateCcw className="size-3.5" /> Retry job
              </Button>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(
              [
                ["Created", formatDateTime(job.createdAt)],
                ["Started", job.startedAt ? formatDateTime(job.startedAt) : "—"],
                ["Finished", job.finishedAt ? formatDateTime(job.finishedAt) : "—"],
                ["Duration", job.durationMs != null ? `${formatNumber(job.durationMs)} ms` : "—"],
                ["Owner", data.user ? <Link href={`/admin/users/${data.user.id}`} className="text-blue-700 hover:underline">{data.user.name}</Link> : "—"],
                ["Worker", job.lockedBy ?? "—"],
              ] as Array<[string, React.ReactNode]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="truncate font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {job.errorHistory.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">Error history</p>
              <ol className="space-y-1.5">
                {job.errorHistory.map((e, i) => (
                  <li key={i} className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900">
                    <span className="font-semibold">{e.code}</span> {e.retryable ? "(retryable)" : "(permanent)"} · {timeAgo(e.at)}
                    <span className="block break-words opacity-80">{e.message}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Payload</p>
              <pre className="scrollbar-thin max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(job.payload, null, 2)}</pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Result</p>
              <pre className="scrollbar-thin max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(job.result, null, 2)}</pre>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function JobsView() {
  const [filters, setFilters] = useUrlFilters({ type: "", status: "", page: "1", jobId: "" });
  const page = Number(filters.page) || 1;
  const overview = useJobsOverview();
  const jobs = useJobs({ type: filters.type, status: filters.status, page, limit: 20 });
  const data = overview.data;

  return (
    <div className="animate-rise space-y-6">
      <PageHeader
        title="Background jobs"
        description="Durable MongoDB-backed queue: leased jobs, retries with exponential backoff, dead-lettering, idempotency keys and a per-minute reconciler. Refreshes every 5 seconds."
      />

      {overview.error ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Waiting now" value={formatNumber(data.queue.dueNow)} icon={<ListTodo />} hint={`${data.queue.delayed} scheduled for retry`} tone="amber" />
            <StatCard label="Running" value={formatNumber(data.queue.running)} icon={<Cpu />} hint={data.queue.oldestQueuedSec ? `oldest waiting ${formatDuration(data.queue.oldestQueuedSec)}` : "queue is clear"} />
            <StatCard label="Succeeded (24 h)" value={formatNumber(data.last24h.succeeded)} icon={<CheckCircle2 />} tone="emerald" />
            <StatCard label="Failed (24 h)" value={formatNumber(data.last24h.failed)} icon={<XCircle />} tone="violet" hint="Retry from the job detail" />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card className="overflow-hidden">
              <p className="border-b border-line px-5 py-3 font-display text-[15px] font-semibold text-ink">Job types (last 7 days)</p>
              <Table className="[&_table]:min-w-0">
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th className="text-right">Queued</Th>
                    <Th className="text-right">Running</Th>
                    <Th className="text-right">Done</Th>
                    <Th className="text-right">Failed</Th>
                    <Th className="text-right">Avg time</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.byType.map((t) => (
                    <tr key={t.type} className="cursor-pointer hover:bg-slate-50" onClick={() => setFilters({ type: t.type })}>
                      <Td>
                        <span className="font-medium text-ink">{t.type}</span>
                        {JOB_DESCRIPTIONS[t.type] && <span className="block text-xs text-muted">{JOB_DESCRIPTIONS[t.type]}</span>}
                      </Td>
                      <Td className="text-right tabular-nums">{t.queued}</Td>
                      <Td className="text-right tabular-nums">{t.running}</Td>
                      <Td className="text-right tabular-nums">{t.succeeded}</Td>
                      <Td className={cn("text-right tabular-nums", t.failed > 0 && "font-medium text-red-600")}>{t.failed}</Td>
                      <Td className="text-right tabular-nums">{t.avgDurationMs != null ? `${formatNumber(t.avgDurationMs)} ms` : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <Card className="p-5">
              <p className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
                <Server className="size-4 text-blue-600" /> Workers
                <Badge tone={data.workers.alive ? "green" : "red"}>{data.workers.alive} alive</Badge>
              </p>
              {data.workers.workers.length === 0 ? (
                <p className="text-sm text-muted">No worker has reported a heartbeat.</p>
              ) : (
                <ul className="space-y-2.5 text-sm">
                  {data.workers.workers.map((w) => (
                    <li key={w.id} className="rounded-xl border border-line p-3">
                      <p className="flex items-center gap-2">
                        <span className={cn("size-2 rounded-full", w.alive ? "bg-emerald-500" : "bg-slate-300")} />
                        <span className="truncate font-medium text-ink">{w.host}</span>
                        <span className="text-xs text-muted">pid {w.pid}</span>
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {w.role} · {w.concurrency} slots · {w.running} running · {w.processed} done · {w.failed} failed
                      </p>
                      <p className="text-xs text-muted">
                        <Clock className="mr-1 inline size-3" />
                        heartbeat {timeAgo(w.lastBeatAt)} · up since {timeAgo(w.startedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <div>
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <Hourglass className="size-5 text-blue-600" /> Jobs
        </h2>
        <FilterBar>
          <Select value={filters.type} onChange={(e) => setFilters({ type: e.target.value })} className="sm:w-52" aria-label="Job type">
            <option value="">All types</option>
            {(data?.byType ?? []).map((t) => (
              <option key={t.type} value={t.type}>
                {t.type}
              </option>
            ))}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilters({ status: e.target.value })} className="sm:w-44" aria-label="Status">
            <option value="">Any status</option>
            {(["queued", "running", "succeeded", "failed", "cancelled"] as const).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </FilterBar>
        <Card className="overflow-hidden">
          {jobs.error ? (
            <div className="p-5">
              <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
            </div>
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th>Progress</Th>
                    <Th className="text-right">Attempts</Th>
                    <Th>Owner</Th>
                    <Th>Last error</Th>
                    <Th>Created</Th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.isLoading ? (
                    <EmptyRow colSpan={7}>Loading…</EmptyRow>
                  ) : !jobs.data || jobs.data.items.length === 0 ? (
                    <EmptyRow colSpan={7}>No jobs match these filters.</EmptyRow>
                  ) : (
                    jobs.data.items.map((j) => (
                      <tr key={j.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setFilters({ jobId: j.id, page: filters.page })}>
                        <Td className="font-medium text-ink">{j.type}</Td>
                        <Td>
                          <Badge tone={STATUS_TONE[j.status]}>{j.status}</Badge>
                        </Td>
                        <Td className="text-xs">
                          {j.status === "running" || j.status === "queued" ? `${j.progress.stage ?? "waiting"} · ${j.progress.pct}%` : j.durationMs != null ? `${formatNumber(j.durationMs)} ms` : "—"}
                        </Td>
                        <Td className="text-right tabular-nums">
                          {j.attempts}/{j.maxAttempts}
                        </Td>
                        <Td className="text-xs">{j.user?.name ?? "system"}</Td>
                        <Td className="max-w-56 truncate text-xs text-red-700">{j.lastError ? `${j.lastError.code}: ${j.lastError.message}` : ""}</Td>
                        <Td className="text-xs whitespace-nowrap">{timeAgo(j.createdAt)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
              {jobs.data && <Pagination page={page} limit={jobs.data.limit} total={jobs.data.total} onPageChange={(p) => setFilters({ page: String(p) })} />}
            </>
          )}
        </Card>
      </div>

      <JobDialog jobId={filters.jobId || null} onClose={() => setFilters({ jobId: "", page: filters.page })} />
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <JobsView />
    </Suspense>
  );
}
