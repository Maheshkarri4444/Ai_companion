"use client";

import { Activity, AlertTriangle, Coins, Cpu, Gauge, Hash, Timer, Zap } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { AiCallDialog, ms, StatusBadge, usd } from "@/components/admin/ai-call-dialog";
import { bucketLabel, ColumnChart, RangeTabs } from "@/components/admin/column-chart";
import { UserFilter } from "@/components/admin/filters";
import { EmptyRow, FilterBar, Table, Td, Th, useUrlFilters } from "@/components/admin/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { PageHeader, Pagination, StatCard } from "@/components/ui/misc";
import { formatNumber, timeAgo } from "@/lib/format";
import { useAiCalls, useAiOverview } from "@/lib/queries";
import type { UsageGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 1000) / 10}%`);

function UsageTable({ title, rows, keyLabel }: { title: string; rows: UsageGroup[]; keyLabel: string }) {
  return (
    <Card className="overflow-hidden">
      <p className="border-b border-line px-5 py-3 font-display text-[15px] font-semibold text-ink">{title}</p>
      <Table>
        <thead>
          <tr>
            <Th>{keyLabel}</Th>
            <Th className="text-right">Calls</Th>
            <Th className="text-right">Errors</Th>
            <Th className="text-right">Fallback</Th>
            <Th className="text-right">p50 / p95</Th>
            <Th className="text-right">Avg TTFT</Th>
            <Th className="text-right">Tokens</Th>
            <Th className="text-right">Cost</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={8}>No AI calls in this period.</EmptyRow>
          ) : (
            rows.map((r) => (
              <tr key={r.key}>
                <Td className="font-medium text-ink">{r.key}</Td>
                <Td className="text-right tabular-nums">{formatNumber(r.calls)}</Td>
                <Td className={cn("text-right tabular-nums", r.errorRate > 0.05 && "font-medium text-red-600")}>{pct(r.errorRate)}</Td>
                <Td className="text-right tabular-nums">{pct(r.fallbackRate)}</Td>
                <Td className="text-right tabular-nums">
                  {ms(r.p50LatencyMs)} / {ms(r.p95LatencyMs)}
                </Td>
                <Td className="text-right tabular-nums">{ms(r.avgTtftMs)}</Td>
                <Td className="text-right tabular-nums">{formatNumber(r.tokens.total)}</Td>
                <Td className="text-right tabular-nums">{usd(r.costUsd)}</Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </Card>
  );
}

function AiUsageView() {
  const [filters, setFilters] = useUrlFilters({ range: "7d", feature: "", status: "", userId: "", page: "1", call: "" });
  const page = Number(filters.page) || 1;
  const overview = useAiOverview(filters.range);
  const calls = useAiCalls({ feature: filters.feature, status: filters.status, userId: filters.userId, page, limit: 15 });
  const [openCall, setOpenCall] = useState<string | null>(filters.call || null);
  const data = overview.data;

  return (
    <div className="animate-rise space-y-6">
      <PageHeader
        title="AI usage"
        description="Every model call is traced: feature, model, attempts, latency, tokens, estimated cost and outcome."
        actions={<RangeTabs value={filters.range} onChange={(range) => setFilters({ range })} />}
      />

      {overview.error ? (
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="AI calls" value={formatNumber(data.totals.calls)} icon={<Hash />} hint={`${pct(data.totals.errorRate)} errors`} />
            <StatCard label="Estimated cost" value={usd(data.totals.costUsd)} icon={<Coins />} tone="emerald" hint={`${formatNumber(data.totals.tokens.total)} tokens`} />
            <StatCard label="Latency p50 / p95" value={`${ms(data.totals.p50LatencyMs)}`} icon={<Timer />} tone="indigo" hint={`p95 ${ms(data.totals.p95LatencyMs)}`} />
            <StatCard label="Fallback rate" value={pct(data.totals.fallbackRate)} icon={<Zap />} tone="amber" hint={`${formatNumber(data.totals.retries)} retries`} />
          </div>

          <Card className="grid gap-6 p-5 lg:grid-cols-2">
            <ColumnChart
              label="Calls"
              data={data.series.map((s) => ({ key: s.bucket, label: bucketLabel(s.bucket), value: s.calls, detail: s.errors ? `${s.errors} errors` : undefined }))}
            />
            <ColumnChart
              label="Estimated cost (USD)"
              tone="emerald"
              format={(v) => usd(v)}
              data={data.series.map((s) => ({ key: s.bucket, label: bucketLabel(s.bucket), value: s.costUsd, detail: `${formatNumber(s.tokens)} tokens` }))}
            />
          </Card>

          <UsageTable title="By feature" rows={data.byFeature} keyLabel="Feature" />
          <UsageTable title="By model" rows={data.byModel} keyLabel="Model" />

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-5">
              <p className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
                <Cpu className="size-4 text-blue-600" /> Model gateway
              </p>
              <dl className="space-y-2 text-sm">
                {Object.entries(data.gateway.chains).map(([tier, chain]) => (
                  <div key={tier} className="flex flex-wrap items-center gap-1.5">
                    <dt className="w-16 text-xs text-muted capitalize">{tier}</dt>
                    {chain.map((model, i) => {
                      const breaker = data.gateway.breakers.find((b) => b.model === model);
                      return (
                        <dd key={model} className="flex items-center gap-1">
                          {i > 0 && <span className="text-slate-300">→</span>}
                          <Badge tone={breaker?.open ? "red" : "slate"}>
                            {model}
                            {breaker?.open ? ` · open ${breaker.reopensInSec}s` : ""}
                          </Badge>
                        </dd>
                      );
                    })}
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted">
                Models with an open circuit breaker (rate limits, overload, repeated failures) are skipped until they recover. In flight: {data.gateway.inFlight}.
              </p>
            </Card>
            <Card className="p-5">
              <p className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
                <Activity className="size-4 text-blue-600" /> Top learners by AI cost
              </p>
              {data.topUsers.length === 0 ? (
                <p className="text-sm text-muted">No usage yet.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {data.topUsers.map((u) => (
                    <li key={u.user.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/admin/users/${u.user.id}`} className="truncate font-medium text-ink hover:text-blue-700">
                        {u.user.name}
                      </Link>
                      <span className="text-xs text-muted tabular-nums">
                        {formatNumber(u.calls)} calls · {formatNumber(u.tokens)} tokens · <strong className="text-ink">{usd(u.costUsd)}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {data.recentErrors.length > 0 && (
            <Card className="p-5">
              <p className="mb-3 flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
                <AlertTriangle className="size-4 text-amber-500" /> Recent failures
              </p>
              <ul className="divide-y divide-line text-sm">
                {data.recentErrors.map((e) => (
                  <li key={e.id}>
                    <button type="button" onClick={() => setOpenCall(e.id)} className="flex w-full flex-wrap items-center gap-2 py-2 text-left hover:bg-slate-50">
                      <Badge tone="red">{e.errorKind}</Badge>
                      <span className="font-medium text-ink">{e.feature}</span>
                      <span className="text-muted">{e.model}</span>
                      <span className="ml-auto text-xs text-muted">{timeAgo(e.createdAt)}</span>
                      {e.errorMessage && <span className="w-full truncate text-xs text-muted">{e.errorMessage}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      <div>
        <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-semibold text-ink">
          <Gauge className="size-5 text-blue-600" /> Call explorer
        </h2>
        <FilterBar>
          <Select value={filters.feature} onChange={(e) => setFilters({ feature: e.target.value })} className="sm:w-52" aria-label="Feature">
            <option value="">All features</option>
            {(data?.byFeature ?? []).map((f) => (
              <option key={f.key} value={f.key}>
                {f.key}
              </option>
            ))}
          </Select>
          <Select value={filters.status} onChange={(e) => setFilters({ status: e.target.value })} className="sm:w-40" aria-label="Status">
            <option value="">Any status</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </Select>
          <UserFilter value={filters.userId} onChange={(userId) => setFilters({ userId })} />
        </FilterBar>
        <Card className="overflow-hidden">
          {calls.error ? (
            <div className="p-5">
              <ErrorState error={calls.error} onRetry={() => calls.refetch()} />
            </div>
          ) : (
            <>
              <Table className={cn(calls.isPlaceholderData && "opacity-60")}>
                <thead>
                  <tr>
                    <Th>Feature</Th>
                    <Th>Model</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Latency</Th>
                    <Th className="text-right">Tokens</Th>
                    <Th className="text-right">Cost</Th>
                    <Th>Input</Th>
                    <Th>When</Th>
                  </tr>
                </thead>
                <tbody>
                  {calls.isLoading ? (
                    <EmptyRow colSpan={8}>Loading…</EmptyRow>
                  ) : !calls.data || calls.data.items.length === 0 ? (
                    <EmptyRow colSpan={8}>No calls match these filters.</EmptyRow>
                  ) : (
                    calls.data.items.map((c) => (
                      <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpenCall(c.id)}>
                        <Td className="font-medium text-ink">{c.feature}</Td>
                        <Td>
                          {c.model ?? "—"}
                          {c.fallbackUsed && <Badge tone="amber" className="ml-1.5">fallback</Badge>}
                        </Td>
                        <Td>
                          <StatusBadge status={c.status === "success" ? "success" : (c.errorKind ?? "error")} />
                        </Td>
                        <Td className="text-right tabular-nums">{ms(c.latencyMs)}</Td>
                        <Td className="text-right tabular-nums">{formatNumber(c.tokens)}</Td>
                        <Td className="text-right tabular-nums">{usd(c.costUsd)}</Td>
                        <Td className="max-w-64 truncate text-xs">{c.inputPreview ?? "—"}</Td>
                        <Td className="text-xs whitespace-nowrap">{timeAgo(c.createdAt)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
              {calls.data && (
                <Pagination page={page} limit={calls.data.limit} total={calls.data.total} onPageChange={(p) => setFilters({ page: String(p) })} />
              )}
            </>
          )}
        </Card>
      </div>

      <AiCallDialog callId={openCall} onClose={() => setOpenCall(null)} />
    </div>
  );
}

export default function AiUsagePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <AiUsageView />
    </Suspense>
  );
}
