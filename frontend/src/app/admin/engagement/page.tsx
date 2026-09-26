"use client";

import { Activity, CalendarCheck, Repeat, Users } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { bucketLabel, ColumnChart } from "@/components/admin/column-chart";
import { EmptyRow, Table, Td, Th, useUrlFilters } from "@/components/admin/table";
import { WindowTabs } from "@/components/charts/window-tabs";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { Avatar, PageHeader, StatCard } from "@/components/ui/misc";
import { formatNumber, pluralize, timeAgo } from "@/lib/format";
import { useAdminEngagement } from "@/lib/queries";
import type { AnalyticsRange } from "@/lib/types";
import { cn } from "@/lib/utils";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

function EngagementView() {
  const [filters, setFilters] = useUrlFilters({ range: "30d" });
  const range = filters.range as AnalyticsRange;
  const { data, error, refetch, isPlaceholderData } = useAdminEngagement(range);

  return (
    <div className="animate-rise space-y-6">
      <PageHeader
        title="Engagement"
        description="Who is learning, how often they come back, and which features they use."
        actions={<WindowTabs value={range} onChange={(value) => setFilters({ range: value })} />}
      />

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className={cn("space-y-6 transition-opacity", isPlaceholderData && "opacity-60")}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Learners" value={formatNumber(data.kpis.learners)} icon={<Users />} hint={`${formatNumber(data.kpis.newLearners)} new in period`} />
            <StatCard
              label="Daily / weekly active"
              value={`${formatNumber(data.kpis.dau)} / ${formatNumber(data.kpis.wau)}`}
              icon={<Activity />}
              tone="emerald"
              hint={`${formatNumber(data.kpis.mau)} monthly active`}
            />
            <StatCard label="Stickiness" value={pct(data.kpis.stickiness)} icon={<CalendarCheck />} tone="indigo" hint="Daily ÷ monthly active learners" />
            <StatCard
              label="7-day retention"
              value={pct(data.kpis.retention7d)}
              icon={<Repeat />}
              tone="amber"
              hint={data.kpis.retentionCohort ? `Of ${pluralize(data.kpis.retentionCohort, "learner")} who joined 1–8 weeks ago` : "No cohort yet (joined 1–8 weeks ago)"}
            />
          </div>

          <Card className="grid gap-6 p-5 lg:grid-cols-2">
            <ColumnChart
              label="Active learners per day"
              data={data.series.map((d) => ({ key: d.date, label: bucketLabel(d.date), value: d.activeUsers, detail: `${d.events} learning events` }))}
            />
            <ColumnChart
              label="New learners per day"
              tone="violet"
              data={data.series.map((d) => ({ key: d.date, label: bucketLabel(d.date), value: d.signups }))}
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card className="overflow-hidden">
              <p className="border-b border-line px-5 py-3 font-display text-[15px] font-semibold text-ink">Feature adoption</p>
              <ul className="space-y-3 p-5">
                {data.adoption.map((f) => (
                  <li key={f.type} className="grid grid-cols-[minmax(0,12rem)_minmax(3rem,1fr)_88px] items-center gap-3 text-sm">
                    <span className="truncate text-ink-soft">{f.feature}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full rounded-full bg-blue-500" style={{ width: `${Math.max(f.users ? 3 : 0, (f.share ?? 0) * 100)}%` }} />
                    </span>
                    <span className="text-right text-xs text-muted tabular-nums">
                      <strong className="font-semibold text-ink">{f.users}</strong> · {pct(f.share)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
                Learners who used each feature, as a share of the {formatNumber(data.kpis.activeInRange)} active in this period.
              </p>
            </Card>

            <Card className="overflow-hidden">
              <p className="border-b border-line px-5 py-3 font-display text-[15px] font-semibold text-ink">Most active learners</p>
              <Table className="[&_table]:min-w-0">
                <thead>
                  <tr>
                    <Th>Learner</Th>
                    <Th className="text-right">Events</Th>
                    <Th className="text-right">Last active</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.topLearners.length === 0 ? (
                    <EmptyRow colSpan={3}>No learner activity in this period.</EmptyRow>
                  ) : (
                    data.topLearners.map((row) => (
                      <tr key={row.user.id}>
                        <Td>
                          <Link href={`/admin/users/${row.user.id}`} className="flex min-w-0 items-center gap-2 hover:text-blue-700">
                            <Avatar name={row.user.name} size="sm" className="ring-0" />
                            <span className="truncate font-medium text-ink">{row.user.name}</span>
                          </Link>
                        </Td>
                        <Td className="text-right tabular-nums">{formatNumber(row.events)}</Td>
                        <Td className="text-right text-xs whitespace-nowrap text-muted">{timeAgo(row.lastActiveAt)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminEngagementPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
      <EngagementView />
    </Suspense>
  );
}
